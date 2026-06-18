//! Contradiction Engine pipeline — the single end-to-end integration seam (audit F1 + F2).
//!
//! ORCHESTRATION ONLY. No business logic, no contradiction/confidence/sort/
//! identity/temporal/enrichment/export rules live here — every step delegates
//! to an existing, already-tested function:
//!
//!   EventEnvelope
//!     → event_dispatch::dispatch_events            (routing)
//!     → partition into Clinical / Family / Timeline / Ignored
//!     → clinical: group-by-doc → unify_events → build_longitudinal_patient_graph
//!     → family:   build_family_graph
//!     → canonical_case::assemble_canonical_case    (timeline passed through)
//!     → contradiction_enrichment::enrich_contradictions
//!     → contradiction_export::{export_rows, export_csv_lines}
//!
//! Determinism: dispatch preserves order; partitioning preserves order;
//! clinical events are grouped by `source_document_id` via a `BTreeMap`
//! (sorted, no `HashMap`); every downstream builder is already deterministic.

// Additive orchestration; not yet wired to a Tauri command.
#![allow(dead_code)]

use std::collections::BTreeMap;

use crate::canonical_case::{
    assemble_canonical_case, CanonicalCase, SubjectProfile, TimelineEntry,
};
use crate::clinical_events::ClinicalEvent;
use crate::event_dispatch::{dispatch_events, DispatchResult, EventEnvelope};
use crate::event_unification::unify_events;
use crate::fact_assertion::FactAssertion;
use crate::fact_contradiction::build_fact_contradictions;
use crate::family_graph::{build_family_graph, FamilyEvent};
use crate::participant_resolution::Participant;
use crate::patient_longitudinal_reconciliation::build_longitudinal_patient_graph;
use crate::contradiction_enrichment::{enrich_contradictions, ContradictionView};
use crate::contradiction_export::{export_csv_lines, export_rows, ContradictionExport};

/// The full materialised Contradiction Engine result from a single event batch.
pub struct ContradictionEngineOutput {
    pub case: CanonicalCase,
    pub view: ContradictionView,
    pub export: ContradictionExport,
    pub csv_lines: Vec<String>,
}

/// Engine output plus the explorable Contradiction Graph projected from it.
/// The graph is a DOWNSTREAM pure projection: `output` is byte-identical to
/// what `run_contradiction_engine` alone produces.
pub struct ContradictionEngineWithGraph {
    pub output: ContradictionEngineOutput,
    pub graph: crate::graph_types::ContradictionGraph,
}

/// Optional graph-producing entrypoint. Runs the UNCHANGED engine, then
/// projects the Contradiction Graph from the result. Pure function, no side
/// effects; existing callers of `run_contradiction_engine` are unaffected.
#[allow(dead_code)]
pub fn run_contradiction_engine_with_graph(
    events: Vec<EventEnvelope>,
    participants: &[Participant],
) -> ContradictionEngineWithGraph {
    let output = run_contradiction_engine(events, participants);
    let graph = crate::graph_builder::build_contradiction_graph(&output);
    ContradictionEngineWithGraph { output, graph }
}

/// Route a batch of events through the entire Contradiction Engine stack and materialise the
/// case, enriched view, and export projections. Pure orchestration.
pub fn run_contradiction_engine(
    events: Vec<EventEnvelope>,
    participants: &[Participant],
) -> ContradictionEngineOutput {
    // 1–2. Route and partition (order preserved within each domain).
    let mut clinical_events: Vec<ClinicalEvent> = Vec::new();
    let mut family_events: Vec<FamilyEvent> = Vec::new();
    let mut timeline_entries: Vec<TimelineEntry> = Vec::new();
    let mut fact_assertions: Vec<FactAssertion> = Vec::new();
    for result in dispatch_events(events) {
        match result {
            DispatchResult::Clinical(c) => clinical_events.push(c),
            DispatchResult::Family(f) => family_events.push(f),
            DispatchResult::Timeline(t) => timeline_entries.push(t),
            DispatchResult::Fact(f) => fact_assertions.push(f),
            DispatchResult::Ignored => {}
        }
    }

    // 3–4. Clinical graph: group events by document (deterministic BTreeMap),
    // unify per document, then build the longitudinal graph. Reuses existing
    // builders only.
    let mut by_doc: BTreeMap<String, Vec<ClinicalEvent>> = BTreeMap::new();
    for ce in clinical_events {
        by_doc.entry(ce.source_document_id.clone()).or_default().push(ce);
    }
    let docs: Vec<(String, _)> = by_doc
        .into_iter()
        .map(|(doc_id, evs)| (doc_id, unify_events(evs)))
        .collect();
    let clinical_graph = build_longitudinal_patient_graph(docs, None);

    // 4. Family graph (reuses existing builder).
    let family_graph = build_family_graph(participants, None, family_events);

    // 5–6. Assemble the case. Identity ambiguity is derived inside assemble
    // from `participants` (structured-only). Timeline entries are passed
    // through verbatim (F2 fix).
    let case = assemble_canonical_case(
        &clinical_graph,
        SubjectProfile::default(),
        family_graph,
        participants,
        timeline_entries,
    );

    // [L2] constructed contradictions (post-assembly snapshot). Verified struct
    // fields only; member-level Affirmed/Negated grouping is internal to
    // assemble_canonical_case and is not exposed here.
    for c in &case.contradictions {
        eprintln!(
            "[L2] constructed: id={} label={} domain={} subject={}",
            c.contradiction_id,
            c.conflict_label,
            c.domain.as_str(),
            c.subject
        );
    }

    // 6b. Value-disagreement contradictions from factual assertions. These are
    // first-class `CaseContradiction`s that flow through the SAME enrich/graph
    // path as clinical/family contradictions. Appended (not interleaved) so the
    // existing contradiction order is preserved exactly; `case` itself is left
    // intact (the enriched view is the integration surface for Contradiction Engine).
    let fact_contradictions = build_fact_contradictions(fact_assertions);

    // 7–9. Enrich + project. `enrich_contradictions` consumes by value, so clone the
    // already-built (and already-sorted) contradiction stream, then append the
    // fact contradictions — `case` is returned intact.
    let mut contradiction_stream = case.contradictions.clone();
    contradiction_stream.extend(fact_contradictions);
    let view = enrich_contradictions(contradiction_stream);
    let export = export_rows(&view);
    let csv_lines = export_csv_lines(&view);

    ContradictionEngineOutput { case, view, export, csv_lines }
}

// ════════════════════════════════════════════════════════════════════════
// Tests — end-to-end integration; engines exercised through their real APIs.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::{CaseContradictionBody, ContradictionDomain};
    use crate::case_events::{InjuryEvent, LegalRole, LegalStatusEvent};
    use crate::clinical_events::AssertionStatus;
    use crate::family_graph::{FamilyEdgeStatus, FamilyEventPayload, FamilyRelation, SourceRef};
    use std::collections::BTreeMap;

    fn injury_env(id: &str, what: &str, status: AssertionStatus, doc: &str) -> EventEnvelope {
        EventEnvelope::Injury(InjuryEvent {
            event_id: id.into(),
            participant_id: "patient#1".into(),
            injury: what.into(),
            status,
            temporal: None,
            source_ids: vec![doc.into()],
            attributes: BTreeMap::new(),
        })
    }

    fn family_env(id: &str, rel: FamilyRelation, src: &str) -> EventEnvelope {
        EventEnvelope::Family(FamilyEvent {
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
        })
    }

    fn legal_env(id: &str, role: LegalRole) -> EventEnvelope {
        EventEnvelope::Legal(LegalStatusEvent {
            event_id: id.into(),
            participant_id: "patient#1".into(),
            role,
            temporal: None,
            source_ids: vec!["docL".into()],
            attributes: BTreeMap::new(),
        })
    }

    // ── Fact / value-disagreement end-to-end (TEST CASE 4) ────────────────────

    /// Prove the WHOLE path: clean_text → extract_facts → EventEnvelope::Fact →
    /// dispatch → build_fact_contradictions → enrich_contradictions → graph nodes.
    #[test]
    fn fact_value_contradictions_reach_graph_nodes() {
        use crate::fact_extract::extract_facts;
        use crate::contradiction_cluster_graph::build_cluster_graph;

        // TEST CASE 4 — a single clean_text blob with 6 contradictory fact pairs.
        let clean_text = "\
            The patient is divorced. A later letter records that she is married. \
            She has never smoked, though another note describes a 20-year smoker. \
            Her father is deceased; elsewhere the father is alive. \
            He cannot drive since the accident, yet he drives independently. \
            Injury date 12 Feb 2022 is recorded; a second form gives injury date 18 Feb 2022. \
            He ceased work Feb 2022, but payroll shows he worked until Nov 2022.";

        // clean_text → facts → Fact envelopes
        let facts = extract_facts(clean_text, "docA");
        assert!(!facts.is_empty(), "extractor produced no facts");
        let envelopes: Vec<EventEnvelope> =
            facts.into_iter().map(EventEnvelope::Fact).collect();

        // → pipeline (dispatch → fact contradictions → enrich)
        let out = run_contradiction_engine(envelopes, &[]);

        // enriched contradictions now contain the 6 value disagreements …
        let ids: Vec<String> = out
            .view
            .enriched_contradictions
            .iter()
            .map(|e| e.base.contradiction_id.clone())
            .collect();
        for expect in [
            "fact:family:marital_status:patient",
            "fact:social:smoking_history:patient",
            "fact:family:father_vital_status:father",
            "fact:functional:driving_ability:patient",
            "fact:clinical:injury_date:patient",
            "fact:functional:work_status:patient",
        ] {
            assert!(ids.contains(&expect.to_string()), "missing contradiction {expect}; got {ids:?}");
        }
        assert_eq!(out.view.enriched_contradictions.len(), 6);

        // … and they materialise as graph nodes (was 0 before this feature).
        let graph = build_cluster_graph(&out.view);
        assert_eq!(graph.nodes.len(), 6, "expected 6 fact nodes");

        // Domain-separation invariants (the refactor):
        //   (1) every fact node sits in a `fact:` namespace — NEVER diagnosis/symptom.
        for n in &graph.nodes {
            assert!(
                n.namespace.starts_with("fact:"),
                "fact node {} leaked into namespace {}",
                n.id,
                n.namespace
            );
            assert_ne!(n.namespace, "diagnosis");
            assert_ne!(n.namespace, "symptom");
        }
        //   (2) facts form NO edges (no spurious SameNamespace clustering).
        assert!(graph.edges.is_empty(), "facts must not create edges, got {:?}", graph.edges);
    }

    /// Both-affirmed values still contradict, and the existing diagnosis polarity
    /// path is untouched when mixed in.
    #[test]
    fn facts_and_clinical_contradictions_coexist() {
        use crate::fact_extract::extract_facts;

        // Diagnosis polarity contradiction (affirmed in docA, negated in docB).
        let mut envelopes = vec![
            injury_env("i1", "fractured wrist", AssertionStatus::Affirmed, "docA"),
            injury_env("i2", "fractured wrist", AssertionStatus::Negated, "docB"),
        ];
        // Plus a marital-status value disagreement.
        for f in extract_facts("patient is married. she is divorced.", "docA") {
            envelopes.push(EventEnvelope::Fact(f));
        }

        let out = run_contradiction_engine(envelopes, &[]);
        let ids: Vec<String> = out
            .view
            .enriched_contradictions
            .iter()
            .map(|e| e.base.contradiction_id.clone())
            .collect();
        // Fact value contradiction present …
        assert!(ids.iter().any(|i| i == "fact:family:marital_status:patient"));
        // … and at least one clinical contradiction (polarity path intact).
        assert!(out.view.enriched_contradictions.iter().any(|e| matches!(
            e.base.domain,
            ContradictionDomain::Clinical
        )));

        // The diagnosis contradiction and the marital fact must NOT be edged
        // together: clinical clustering reflects medical concepts only.
        let graph = crate::contradiction_cluster_graph::build_cluster_graph(&out.view);
        let diag_node = graph
            .nodes
            .iter()
            .find(|n| n.namespace == "diagnosis")
            .map(|n| n.id.clone());
        if let Some(diag) = diag_node {
            for (from, to, _) in &out.view.cross_namespace_relations {
                assert!(
                    !(from.starts_with("fact:") || to.starts_with("fact:")),
                    "fact node leaked into a cross-namespace edge: {from} ⟂ {to}"
                );
                let _ = &diag; // diagnosis stays in its own clinical relations only
            }
        }
    }

    // A representative mixed batch: one clinical (injury) conflict, one family
    // conflict, one legal status event.
    fn mixed_batch() -> Vec<EventEnvelope> {
        vec![
            injury_env("i1", "fractured wrist", AssertionStatus::Affirmed, "docA"),
            injury_env("i2", "fractured wrist", AssertionStatus::Negated, "docB"),
            family_env("f1", FamilyRelation::SiblingOf, "docC"),
            family_env("f2", FamilyRelation::SpouseOf, "docD"),
            legal_env("l1", LegalRole::Claimant),
        ]
    }

    // A. Full pipeline is byte-identical across runs.
    #[test]
    fn dispatch_to_export_end_to_end_is_byte_identical() {
        let o1 = run_contradiction_engine(mixed_batch(), &[]);
        let o2 = run_contradiction_engine(mixed_batch(), &[]);

        assert_eq!(o1.csv_lines, o2.csv_lines);
        assert_eq!(o1.export, o2.export);
        assert_eq!(
            serde_json::to_string(&o1.view).unwrap(),
            serde_json::to_string(&o2.view).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&o1.case).unwrap(),
            serde_json::to_string(&o2.case).unwrap()
        );

        // Sanity: one clinical + one family contradiction present.
        assert_eq!(o1.case.contradictions.len(), 2);
    }

    // B. Legal events reach the case timeline and produce no contradiction.
    #[test]
    fn legal_events_reach_case_timeline() {
        let out = run_contradiction_engine(vec![legal_env("l1", LegalRole::Applicant)], &[]);
        assert_eq!(out.case.timeline.len(), 1);
        assert_eq!(out.case.timeline[0].label, "legal_status:patient#1=applicant");
        assert!(out.case.contradictions.is_empty());
    }

    // C. Adding a legal event does not change the contradiction stream.
    #[test]
    fn legal_events_do_not_affect_contradictions() {
        let without = run_contradiction_engine(
            vec![
                injury_env("i1", "fractured wrist", AssertionStatus::Affirmed, "docA"),
                injury_env("i2", "fractured wrist", AssertionStatus::Negated, "docB"),
                family_env("f1", FamilyRelation::SiblingOf, "docC"),
                family_env("f2", FamilyRelation::SpouseOf, "docD"),
            ],
            &[],
        );
        let with = run_contradiction_engine(mixed_batch(), &[]);

        assert_eq!(
            serde_json::to_string(&without.case.contradictions).unwrap(),
            serde_json::to_string(&with.case.contradictions).unwrap()
        );
        // Only the timeline differs.
        assert_eq!(without.case.timeline.len(), 0);
        assert_eq!(with.case.timeline.len(), 1);
    }

    // D. Domain separation: injury → Clinical, family → Family, no Legal domain.
    #[test]
    fn pipeline_preserves_domain_separation() {
        let out = run_contradiction_engine(mixed_batch(), &[]);
        let domains: Vec<ContradictionDomain> =
            out.case.contradictions.iter().map(|c| c.domain).collect();
        assert!(domains.contains(&ContradictionDomain::Clinical));
        assert!(domains.contains(&ContradictionDomain::Family));
        // No contradiction carries a legal label; bodies are only Clinical/Family.
        for c in &out.case.contradictions {
            assert_ne!(c.conflict_label, "legal");
            assert!(matches!(
                c.body,
                CaseContradictionBody::Clinical(_) | CaseContradictionBody::Family(_)
            ));
        }
    }

    // E. Timeline preserves insertion order exactly.
    #[test]
    fn pipeline_order_preservation() {
        let out = run_contradiction_engine(
            vec![
                legal_env("l1", LegalRole::Claimant),
                legal_env("l2", LegalRole::Applicant),
                legal_env("l3", LegalRole::Respondent),
            ],
            &[],
        );
        let labels: Vec<&str> = out.case.timeline.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(
            labels,
            vec![
                "legal_status:patient#1=claimant",
                "legal_status:patient#1=applicant",
                "legal_status:patient#1=respondent",
            ]
        );
    }

    // Part 5 — audit lock: with REAL clinical + family contradictions, the
    // cross_domain_tag is never "aligned" (clinical label is always "assertion";
    // family labels are relational/cardinality/temporal/identity — they cannot
    // match). Documentation test; asserts current behaviour, changes nothing.
    #[test]
    fn cross_domain_tag_never_aligned_with_real_clinical_and_family() {
        let out = run_contradiction_engine(mixed_batch(), &[]);
        assert_eq!(out.case.contradictions.len(), 2);
        for e in &out.view.enriched_contradictions {
            assert_eq!(e.derived.cross_domain_tag, None);
        }
    }

    // PART D — one integration test spanning the whole real stack, asserting
    // provenance survives into the export.
    #[test]
    fn contradiction_end_to_end_pipeline_with_provenance() {
        // Injury (clinical conflict) + Family (relational conflict) + Legal.
        let out = run_contradiction_engine(mixed_batch(), &[]);

        // contradiction stream produced
        assert_eq!(out.case.contradictions.len(), 2);
        // legal timeline populated
        assert_eq!(out.case.timeline.len(), 1);
        assert_eq!(out.case.timeline[0].label, "legal_status:patient#1=claimant");
        // enrichment present
        assert_eq!(out.view.enriched_contradictions.len(), 2);

        // export contains provenance.
        let rows = &out.export.rows;
        assert!(rows.iter().all(|r| !r.contradiction_id.is_empty()));
        let clinical = rows.iter().find(|r| r.domain == "clinical").expect("clinical row");
        assert!(!clinical.source_ids.is_empty(), "clinical source_ids must survive to export");
        let family = rows.iter().find(|r| r.domain == "family").expect("family row");
        assert!(!family.edge_ids.is_empty(), "family edge_ids must survive to export");

        // CSV deterministic + provenance columns present.
        let csv2 = run_contradiction_engine(mixed_batch(), &[]).csv_lines;
        assert_eq!(out.csv_lines, csv2);
        assert!(out.csv_lines[0].ends_with(",contradiction_id,source_ids,edge_ids"));
    }
}
