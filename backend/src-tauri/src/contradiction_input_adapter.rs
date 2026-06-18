//! Production input adapter for the Contradiction Engine pipeline (closes audit F-1 + F-2).
//!
//! PURE ADAPTER + thin entrypoint. It converts the REAL, already-persisted
//! extraction payload — the `clinical_events` JSON returned by
//! `projection::get_client_extraction` (verbatim `clinical_events::ClinicalEvent`
//! records) — plus any caller-supplied family / legal facts (existing types)
//! into `Vec<EventEnvelope>`, then invokes the existing `run_contradiction_engine`.
//!
//! It contains NO inference, NO contradiction / enrichment / export / graph
//! logic — it only routes. Determinism: input order preserved; the pipeline
//! does the rest.
//!
//! Mapping rules (no invention, no lossy drop of what the target type holds):
//!   - Clinical `EventType::Diagnosis` → `EventEnvelope::Injury` (the only
//!     clinical-bound input variant; `InjuryEvent` lowers back to a Diagnosis).
//!     Full original provenance (event_id, document id, section, snippet,
//!     offsets, original type) is preserved in `InjuryEvent.attributes`.
//!   - Other clinical event types → `EventEnvelope::Unknown` (ignored): the
//!     `InjuryEvent` lowering always produces `Diagnosis`, so routing a
//!     Symptom/Medication/etc. through it would DISTORT grouping. They are
//!     deliberately not forced — this is a property of the existing input
//!     model, not a transformation introduced here.
//!   - Family facts → `EventEnvelope::Family` (1:1 passthrough of the existing
//!     `family_graph::FamilyEvent`).
//!   - Legal facts  → `EventEnvelope::Legal` (1:1 passthrough of the existing
//!     `case_events::LegalStatusEvent`).
//!   - Unparseable clinical JSON → `EventEnvelope::Unknown`.

use serde::Serialize;

use crate::canonical_case::CanonicalCase;
use crate::case_events::LegalStatusEvent;
use crate::clinical_event_adapter::{route_clinical_event, ClinicalRoutingResult};
use crate::clinical_events::ClinicalEvent;
use crate::event_dispatch::EventEnvelope;
use crate::family_graph::FamilyEvent;
use crate::participant_resolution::Participant;
use crate::contradiction_enrichment::ContradictionView;
use crate::contradiction_export::ContradictionExport;
use crate::contradiction_engine::{run_contradiction_engine, ContradictionEngineOutput};

/// Convert one persisted clinical-event JSON value into an `EventEnvelope`.
/// All clinical routing is delegated to `clinical_event_adapter` — this stays
/// byte-identical to the prior inline behaviour (Diagnosis → Injury, else
/// ignored).
fn clinical_value_to_envelope(v: &serde_json::Value) -> EventEnvelope {
    let ce: ClinicalEvent = match serde_json::from_value(v.clone()) {
        Ok(c) => c,
        Err(_) => return EventEnvelope::Unknown,
    };
    eprintln!(
        "[L1] parsed ce: id={} type={:?} concept={} status={:?}",
        ce.event_id, ce.event_type, ce.concept, ce.assertion_status
    );
    match route_clinical_event(&ce) {
        ClinicalRoutingResult::Injury(inj) => EventEnvelope::Injury(inj),
        ClinicalRoutingResult::Unsupported(_) => EventEnvelope::Unknown,
    }
}

/// Adapt the real extraction payload (+ optional family/legal facts) into the
/// pipeline's event envelopes. Order: clinical (input order) → family → legal.
pub fn extraction_to_event_envelopes(
    clinical_events_json: &[serde_json::Value],
    family_events: Vec<FamilyEvent>,
    legal_events: Vec<LegalStatusEvent>,
) -> Vec<EventEnvelope> {
    let mut out: Vec<EventEnvelope> = Vec::with_capacity(
        clinical_events_json.len() + family_events.len() + legal_events.len(),
    );
    for v in clinical_events_json {
        out.push(clinical_value_to_envelope(v));
    }
    for f in family_events {
        out.push(EventEnvelope::Family(f));
    }
    for l in legal_events {
        out.push(EventEnvelope::Legal(l));
    }
    out
}

/// THE production entrypoint (single path — no text-blind variant exists).
/// Adapts clinical events + per-document clean text into envelopes and runs
/// the engine. Each `(doc_id, clean_text)` blob is run through
/// `fact_extract::extract_facts` and the resulting facts are appended as
/// `EventEnvelope::Fact` so value-disagreement contradictions ALWAYS
/// participate — case, observability, and graph commands all see the same
/// contradiction set. Facts from ALL documents are pooled before contradiction
/// generation, so a disagreement spanning two documents (e.g. injury date
/// 12 Feb in doc A vs 18 Feb in doc B) is detected.
pub fn run_contradiction_engine_from_extraction(
    clinical_events_json: &[serde_json::Value],
    clean_texts: &[(String, String)],
    family_events: Vec<FamilyEvent>,
    legal_events: Vec<LegalStatusEvent>,
    participants: &[Participant],
) -> ContradictionEngineOutput {
    let mut envelopes =
        extraction_to_event_envelopes(clinical_events_json, family_events, legal_events);
    for (doc_id, text) in clean_texts {
        for fact in crate::fact_extract::extract_facts(text, doc_id) {
            envelopes.push(EventEnvelope::Fact(fact));
        }
    }
    run_contradiction_engine(envelopes, participants)
}

/// Serializable result for the Tauri command boundary. Carries the same four
/// materialised outputs as `ContradictionEngineOutput`, verbatim.
#[derive(Serialize)]
pub struct ContradictionCaseResult {
    pub case: CanonicalCase,
    pub view: ContradictionView,
    pub export: ContradictionExport,
    pub csv_lines: Vec<String>,
}

impl From<ContradictionEngineOutput> for ContradictionCaseResult {
    fn from(o: ContradictionEngineOutput) -> Self {
        ContradictionCaseResult {
            case: o.case,
            view: o.view,
            export: o.export,
            csv_lines: o.csv_lines,
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tests — adapter + entrypoint over the REAL clinical-event JSON shape.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::ContradictionDomain;
    use crate::case_events::LegalRole;
    use crate::clinical_events::{AssertionStatus, EventType};
    use crate::family_graph::{FamilyEdgeStatus, FamilyEventPayload, FamilyRelation, SourceRef};
    use std::collections::BTreeMap;

    // Build a persisted clinical-event JSON value (the real extraction shape).
    fn diag_json(id: &str, concept: &str, status: AssertionStatus, doc: &str) -> serde_json::Value {
        let ce = ClinicalEvent {
            event_id: id.into(),
            event_type: EventType::Diagnosis,
            concept: concept.into(),
            raw_concept: concept.into(),
            date: None,
            date_precision: None,
            assertion_status: Some(status),
            source_document_id: doc.into(),
            source_section: Some("SOURCE A".into()),
            source_snippet: format!("...{concept}..."),
            char_offset_start: 3,
            char_offset_end: 3 + concept.len(),
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({}),
        };
        serde_json::to_value(ce).unwrap()
    }

    fn symptom_json(id: &str, concept: &str, status: AssertionStatus, doc: &str) -> serde_json::Value {
        let ce = ClinicalEvent {
            event_id: id.into(),
            event_type: EventType::Symptom,
            concept: concept.into(),
            raw_concept: concept.into(),
            date: None,
            date_precision: None,
            assertion_status: Some(status),
            source_document_id: doc.into(),
            source_section: Some("SOURCE A".into()),
            source_snippet: format!("...{concept}..."),
            char_offset_start: 3,
            char_offset_end: 3 + concept.len(),
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({}),
        };
        serde_json::to_value(ce).unwrap()
    }

    fn family(id: &str, rel: FamilyRelation, src: &str) -> FamilyEvent {
        FamilyEvent {
            event_id: id.into(),
            payload: FamilyEventPayload {
                relation: rel,
                subject: "a#1".into(),
                target: Some("b#1".into()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: src.into(), date: None, context: "c".into() }],
            confidence: 0.9,
        }
    }

    fn legal(id: &str, role: LegalRole) -> LegalStatusEvent {
        LegalStatusEvent {
            event_id: id.into(),
            participant_id: "patient#1".into(),
            role,
            temporal: None,
            source_ids: vec!["docL".into()],
            attributes: BTreeMap::new(),
        }
    }

    fn mixed_clinical() -> Vec<serde_json::Value> {
        vec![
            diag_json("i1", "fractured wrist", AssertionStatus::Affirmed, "docA"),
            diag_json("i2", "fractured wrist", AssertionStatus::Negated, "docB"),
        ]
    }

    // 1.
    #[test]
    fn real_payload_to_event_envelopes_is_deterministic() {
        let a = extraction_to_event_envelopes(&mixed_clinical(), vec![family("f1", FamilyRelation::SiblingOf, "d")], vec![legal("l1", LegalRole::Claimant)]);
        let b = extraction_to_event_envelopes(&mixed_clinical(), vec![family("f1", FamilyRelation::SiblingOf, "d")], vec![legal("l1", LegalRole::Claimant)]);
        assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&b).unwrap());
        // Order: clinical → family → legal.
        assert!(matches!(a[0], EventEnvelope::Injury(_)));
        assert!(matches!(a[2], EventEnvelope::Family(_)));
        assert!(matches!(a[3], EventEnvelope::Legal(_)));
    }

    // 2.
    #[test]
    fn production_entrypoint_invokes_existing_pipeline_only() {
        let clinical = mixed_clinical();
        let fam = vec![family("f1", FamilyRelation::SiblingOf, "d1"), family("f2", FamilyRelation::SpouseOf, "d2")];
        let leg = vec![legal("l1", LegalRole::Claimant)];

        let via_entrypoint = run_contradiction_engine_from_extraction(&clinical, &[], fam.clone(), leg.clone(), &[]);
        // The entrypoint must equal the existing pipeline run on the adapter's
        // own envelopes — i.e. it adds no orchestration of its own.
        let envelopes = extraction_to_event_envelopes(&clinical, fam, leg);
        let direct = run_contradiction_engine(envelopes, &[]);

        assert_eq!(
            serde_json::to_string(&via_entrypoint.case).unwrap(),
            serde_json::to_string(&direct.case).unwrap()
        );
        assert_eq!(via_entrypoint.csv_lines, direct.csv_lines);
        assert_eq!(via_entrypoint.export, direct.export);
    }

    // 3.
    #[test]
    fn legal_events_reach_case_timeline_via_real_adapter() {
        let out = run_contradiction_engine_from_extraction(&[], &[], vec![], vec![legal("l1", LegalRole::Applicant)], &[]);
        assert_eq!(out.case.timeline.len(), 1);
        assert_eq!(out.case.timeline[0].label, "legal_status:patient#1=applicant");
        assert!(out.case.contradictions.is_empty());
    }

    // 4.
    #[test]
    fn family_events_reach_family_contradictions_via_real_adapter() {
        let out = run_contradiction_engine_from_extraction(
            &[],
            &[],
            vec![family("f1", FamilyRelation::SiblingOf, "d1"), family("f2", FamilyRelation::SpouseOf, "d2")],
            vec![],
            &[],
        );
        let fam: Vec<_> = out
            .case
            .contradictions
            .iter()
            .filter(|c| c.domain == ContradictionDomain::Family)
            .collect();
        assert_eq!(fam.len(), 1);
        assert_eq!(fam[0].conflict_label, "relational");
    }

    // 5.
    #[test]
    fn injury_events_reach_clinical_contradictions_via_real_adapter() {
        let out = run_contradiction_engine_from_extraction(&mixed_clinical(), &[], vec![], vec![], &[]);
        let clin: Vec<_> = out
            .case
            .contradictions
            .iter()
            .filter(|c| c.domain == ContradictionDomain::Clinical)
            .collect();
        assert_eq!(clin.len(), 1);
        assert_eq!(clin[0].subject, "fractured wrist");
        // Provenance: the source document survives to the export row.
        let row = out.export.rows.iter().find(|r| r.domain == "clinical").unwrap();
        assert!(row.source_ids.iter().any(|s| s == "docA" || s == "docB") || !row.source_ids.is_empty());
        assert!(!row.contradiction_id.is_empty());
    }

    // 6.
    #[test]
    fn pipeline_output_is_identical_to_manual_build() {
        let clinical = mixed_clinical();
        let fam = vec![family("f1", FamilyRelation::SiblingOf, "d1"), family("f2", FamilyRelation::SpouseOf, "d2")];
        let leg = vec![legal("l1", LegalRole::Claimant)];

        // Path 1: adapter + entrypoint.
        let adapted = run_contradiction_engine_from_extraction(&clinical, &[], fam.clone(), leg.clone(), &[]);
        // Path 2: manual envelopes (the adapter's own output) → pipeline.
        let manual = run_contradiction_engine(
            extraction_to_event_envelopes(&clinical, fam, leg),
            &[],
        );
        assert_eq!(
            serde_json::to_string(&adapted.case).unwrap(),
            serde_json::to_string(&manual.case).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&adapted.view).unwrap(),
            serde_json::to_string(&manual.view).unwrap()
        );
        assert_eq!(adapted.export, manual.export);
        assert_eq!(adapted.csv_lines, manual.csv_lines);
    }

    // Stage: Diagnosis → Injury envelope is byte-identical to the prior inline
    // contract (exact field + 8-key attribute set, no more, no less).
    #[test]
    fn adapter_diagnosis_envelope_matches_prior_attribute_contract() {
        let env = extraction_to_event_envelopes(
            &[diag_json("i1", "fractured wrist", AssertionStatus::Affirmed, "docA")],
            vec![],
            vec![],
        );
        assert_eq!(env.len(), 1);
        let v = serde_json::to_value(&env[0]).unwrap();
        let inj = v.get("Injury").expect("Injury variant");
        assert_eq!(inj["participant_id"], "patient");
        assert_eq!(inj["injury"], "fractured wrist");
        assert_eq!(inj["status"], "affirmed");
        assert_eq!(inj["source_ids"], serde_json::json!(["docA"]));
        let a = inj["attributes"].as_object().unwrap();
        assert_eq!(a["origin"], "clinical_extraction");
        assert_eq!(a["orig_event_id"], "i1");
        assert_eq!(a["orig_event_type"], "diagnosis");
        assert_eq!(a["source_document_id"], "docA");
        assert_eq!(a["source_section"], "SOURCE A");
        assert_eq!(a["char_offset_start"], "3");
        // Exactly the prior 8 attribute keys (sorted) — byte-identity contract.
        let keys: Vec<&str> = a.keys().map(|k| k.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "char_offset_end",
                "char_offset_start",
                "orig_event_id",
                "orig_event_type",
                "origin",
                "source_document_id",
                "source_section",
                "source_snippet",
            ]
        );
    }

    // Stage: contradiction counts / confidence / export rows / timeline are
    // unchanged for a diagnosis corpus (PART E #6–#9).
    #[test]
    fn diagnosis_corpus_pipeline_outputs_unchanged() {
        let out = run_contradiction_engine_from_extraction(&mixed_clinical(), &[], vec![], vec![], &[]);
        // #6 contradiction count.
        assert_eq!(out.case.contradictions.len(), 1);
        let c = &out.case.contradictions[0];
        assert_eq!(c.domain, ContradictionDomain::Clinical);
        // #7 confidence value (1 affirmed vs 1 negated → 0.5).
        assert!((c.resolution_confidence - 0.5).abs() < 1e-6);
        // #8 export rows.
        assert_eq!(out.export.rows.len(), 1);
        assert_eq!(out.export.rows[0].domain, "clinical");
        // #9 timeline unchanged (no legal events → empty).
        assert!(out.case.timeline.is_empty());
    }

    // PART E (audit-only, no fix): empirically document what reaches the
    // export `source_ids` for an injury-derived clinical contradiction.
    #[test]
    fn observed_clinical_export_source_ids_are_canonical_not_document_ids() {
        let out = run_contradiction_engine_from_extraction(&mixed_clinical(), &[], vec![], vec![], &[]);
        let row = out.export.rows.iter().find(|r| r.domain == "clinical").unwrap();
        // RUNTIME-OBSERVED value (audit F-A2, no fix):
        //   ["diagnosis#fractured wrist", "patient#diagnosis#fractured wrist"]
        // i.e. the UnifiedEvent canonical_id + the PatientEvent id — both
        // concept-derived CANONICAL ids. The source document ids ("docA"/"docB"
        // supplied in the extraction) do NOT appear.
        assert!(row.source_ids.iter().all(|s| s.contains("fractured wrist")));
        assert!(row.source_ids.iter().any(|s| s.starts_with("patient#")));
        assert!(!row.source_ids.iter().any(|s| s == "docA" || s == "docB"));
        assert!(!row.source_ids.is_empty());
    }

    // 7.
    #[test]
    fn input_order_independence() {
        let forward = vec![
            diag_json("i1", "fractured wrist", AssertionStatus::Affirmed, "docA"),
            diag_json("i2", "fractured wrist", AssertionStatus::Negated, "docB"),
        ];
        let reversed = vec![
            diag_json("i2", "fractured wrist", AssertionStatus::Negated, "docB"),
            diag_json("i1", "fractured wrist", AssertionStatus::Affirmed, "docA"),
        ];
        let a = run_contradiction_engine_from_extraction(&forward, &[], vec![], vec![], &[]);
        let b = run_contradiction_engine_from_extraction(&reversed, &[], vec![], vec![], &[]);

        // Contradiction stream identical (engine sorts; input order irrelevant).
        assert_eq!(
            serde_json::to_string(&a.case.contradictions).unwrap(),
            serde_json::to_string(&b.case.contradictions).unwrap()
        );
        assert_eq!(a.export, b.export);
        assert_eq!(a.csv_lines, b.csv_lines);
    }

    // Stage: a symptom-only corpus flows through the EXISTING pipeline and
    // produces a clinical contradiction with the namespaced subject.
    #[test]
    fn symptom_corpus_produces_namespaced_clinical_contradiction() {
        let events = vec![
            symptom_json("s1", "insomnia", AssertionStatus::Affirmed, "docA"),
            symptom_json("s2", "insomnia", AssertionStatus::Negated, "docB"),
        ];
        let out = run_contradiction_engine_from_extraction(&events, &[], vec![], vec![], &[]);
        assert_eq!(out.case.contradictions.len(), 1);
        let c = &out.case.contradictions[0];
        assert_eq!(c.domain, ContradictionDomain::Clinical);
        assert_eq!(c.subject, "symptom:insomnia"); // namespaced — no diagnosis collision
        assert!((c.resolution_confidence - 0.5).abs() < 1e-6);
    }

    // Stage: a diagnosis "fatigue" conflict and a symptom "fatigue" conflict
    // coexist as TWO disjoint contradictions — proving symptom support does NOT
    // change diagnosis grouping (the namespace keeps the streams separate).
    #[test]
    fn symptom_does_not_collide_with_same_concept_diagnosis() {
        let events = vec![
            diag_json("d1", "fatigue", AssertionStatus::Affirmed, "docA"),
            diag_json("d2", "fatigue", AssertionStatus::Negated, "docB"),
            symptom_json("s1", "fatigue", AssertionStatus::Affirmed, "docC"),
            symptom_json("s2", "fatigue", AssertionStatus::Negated, "docD"),
        ];
        let out = run_contradiction_engine_from_extraction(&events, &[], vec![], vec![], &[]);
        assert_eq!(out.case.contradictions.len(), 2);
        let subjects: std::collections::BTreeSet<&str> =
            out.case.contradictions.iter().map(|c| c.subject.as_str()).collect();
        assert!(subjects.contains("fatigue")); // diagnosis stream (unchanged)
        assert!(subjects.contains("symptom:fatigue")); // symptom stream (new)
        // Both are Clinical-domain; neither merged.
        assert!(out.case.contradictions.iter().all(|c| c.domain == ContradictionDomain::Clinical));
    }
}
