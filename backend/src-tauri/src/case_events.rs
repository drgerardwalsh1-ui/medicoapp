//! Case event-type extension — InjuryEvent, FamilyEvent, LegalStatusEvent.
//!
//! Strictly ADDITIVE structural expansion. These are pure data carriers that
//! LOWER deterministically into the EXISTING graph inputs; they introduce no
//! new contradiction engine, no new truth-resolution system, no identity
//! logic, and they change none of the existing reconciliation math.
//!
//! Integration map:
//!   - `FamilyEvent`     → already exists as `family_graph::FamilyEvent` (the
//!                         canonical family carrier). It is re-used as-is and
//!                         flows into the family contradiction engine
//!                         unchanged — no duplication here.
//!   - `InjuryEvent`     → `clinical_events::ClinicalEvent` (EventType::Diagnosis)
//!                         and from there through the EXISTING clinical pipeline
//!                         (`unify_events` → `build_longitudinal_patient_graph`
//!                         → `canonical_case::build_contradictions`). Injuries
//!                         become Clinical-domain contradictions via the same
//!                         assertion / dominant-over-total math.
//!   - `LegalStatusEvent`→ `canonical_case::TimelineEntry` only. A per-subject
//!                         legal-role record (claimant/applicant/…) that is NOT
//!                         a (pair) relationship and is NOT a clinical
//!                         assertion, so it deliberately produces NO
//!                         contradiction — it cannot affect clinical or family
//!                         math. (Legal-status contradiction handling, if ever
//!                         wanted, is a separate future phase.)
//!
//! No inference fields. Deterministic. Identity is consumed read-only by the
//! downstream family layer exactly as before — these carriers never call it.

// Additive; not yet wired to a Tauri command (mirrors the prior layers).
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;

use crate::clinical_events::{AssertionStatus, ClinicalEvent, EventType};
use crate::family_graph::TimeRange;

/// Re-exported for callers that want one import site for the family carrier.
/// This is the SAME type the family contradiction engine already consumes.
#[allow(unused_imports)] // Convenience re-export; consumed by downstream/tests.
pub use crate::family_graph::FamilyEvent;

// ════════════════════════════════════════════════════════════════════════
// InjuryEvent
// ════════════════════════════════════════════════════════════════════════

/// A pure data carrier for an injury assertion about the subject. Raw
/// attributes only — no inferred/confidence fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InjuryEvent {
    pub event_id: String,
    /// The injured subject (a resolved participant id). Identity is consumed
    /// read-only downstream; this carrier never resolves identity.
    pub participant_id: String,
    /// Raw injury description (body part / nature), e.g. "fractured wrist".
    pub injury: String,
    /// Reused clinical assertion status (affirmed / negated / queried / …).
    pub status: AssertionStatus,
    /// Optional temporal scope (reuses the family `TimeRange`); its `start`
    /// becomes the lowered clinical event's date. Overlap semantics are not
    /// redefined.
    pub temporal: Option<TimeRange>,
    pub source_ids: Vec<String>,
    /// Raw key→value attributes (BTreeMap for deterministic ordering). No
    /// inference.
    pub attributes: BTreeMap<String, String>,
}

impl InjuryEvent {
    /// Normalised concept used for clinical grouping — deterministic.
    fn concept(&self) -> String {
        self.injury.trim().to_lowercase()
    }

    /// Lower into a `ClinicalEvent` so the injury participates in the EXISTING
    /// clinical contradiction pipeline. Maps to `EventType::Diagnosis` (an
    /// injury is an affirmable/deniable clinical condition); the original
    /// surface form is retained in `raw_concept` and the injury nature is
    /// tagged in metadata.
    pub fn to_clinical_event(&self) -> ClinicalEvent {
        let doc_id = self
            .source_ids
            .first()
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());
        ClinicalEvent {
            event_id: self.event_id.clone(),
            event_type: EventType::Diagnosis,
            concept: self.concept(),
            raw_concept: self.injury.clone(),
            date: self.temporal.as_ref().and_then(|t| t.start.clone()),
            date_precision: None,
            assertion_status: Some(self.status),
            source_document_id: doc_id,
            source_section: None,
            source_snippet: self.injury.clone(),
            char_offset_start: 0,
            char_offset_end: 0,
            page: None,
            participants: Vec::new(),
            metadata: json!({
                "kind": "injury",
                "participant_id": self.participant_id,
                "source_ids": self.source_ids,
                // BTreeMap → deterministically-ordered JSON object.
                "attributes": self.attributes,
            }),
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// LegalStatusEvent
// ════════════════════════════════════════════════════════════════════════

/// A subject's legal role at a point/period in time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LegalRole {
    Claimant,
    Applicant,
    Respondent,
    Plaintiff,
    Defendant,
    Unknown,
}

impl LegalRole {
    pub fn as_str(self) -> &'static str {
        match self {
            LegalRole::Claimant => "claimant",
            LegalRole::Applicant => "applicant",
            LegalRole::Respondent => "respondent",
            LegalRole::Plaintiff => "plaintiff",
            LegalRole::Defendant => "defendant",
            LegalRole::Unknown => "unknown",
        }
    }
}

/// A pure data carrier for a legal-status assertion about one subject.
/// Deliberately NOT a relationship and NOT a clinical assertion, so it
/// produces no contradiction and cannot affect clinical/family math.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegalStatusEvent {
    pub event_id: String,
    pub participant_id: String,
    pub role: LegalRole,
    pub temporal: Option<TimeRange>,
    pub source_ids: Vec<String>,
    /// Raw key→value attributes (BTreeMap for deterministic ordering).
    pub attributes: BTreeMap<String, String>,
}

impl LegalStatusEvent {
    /// Lower into the existing `TimelineEntry` record. Read-only; never enters
    /// a contradiction engine.
    ///
    /// Attributes are projected ONLY here, as a deterministic suffix on the
    /// label — `TimelineEntry`'s structure is locked, so no `attributes` field
    /// is added. BTreeMap iteration is key-sorted, so the suffix is byte-stable
    /// regardless of insertion order. The suffix is emitted only when
    /// attributes are present (empty attributes ⇒ label unchanged).
    pub fn to_timeline_entry(&self) -> crate::canonical_case::TimelineEntry {
        let mut label = format!("legal_status:{}={}", self.participant_id, self.role.as_str());
        if !self.attributes.is_empty() {
            let attrs = self
                .attributes
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(",");
            label.push_str(&format!(" {{{attrs}}}"));
        }
        crate::canonical_case::TimelineEntry {
            date: self.temporal.as_ref().and_then(|t| t.start.clone()),
            label,
            source_unified_event_ids: self.source_ids.clone(),
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tests — additive only; no existing behaviour exercised differently.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::{build_contradictions, CaseContradictionBody, ContradictionDomain};
    use crate::event_unification::unify_events;
    use crate::family_graph::{
        build_family_contradictions, build_family_graph, FamilyEdgeStatus, FamilyEventPayload,
        FamilyRelation, SourceRef,
    };
    use crate::patient_longitudinal_reconciliation::build_longitudinal_patient_graph;
    use std::collections::BTreeSet;

    fn injury(id: &str, what: &str, status: AssertionStatus, doc: &str) -> InjuryEvent {
        InjuryEvent {
            event_id: id.to_string(),
            participant_id: "patient#1".to_string(),
            injury: what.to_string(),
            status,
            temporal: None,
            source_ids: vec![doc.to_string()],
            attributes: BTreeMap::new(),
        }
    }

    // 1. InjuryEvent maps correctly into a ClinicalEvent.
    #[test]
    fn injury_event_lowers_to_clinical_event() {
        let inj = injury("i1", "Fractured Wrist", AssertionStatus::Affirmed, "docA");
        let ce = inj.to_clinical_event();
        assert_eq!(ce.event_type, EventType::Diagnosis);
        assert_eq!(ce.concept, "fractured wrist"); // normalised
        assert_eq!(ce.raw_concept, "Fractured Wrist"); // surface form retained
        assert_eq!(ce.assertion_status, Some(AssertionStatus::Affirmed));
        assert_eq!(ce.source_document_id, "docA");
        assert_eq!(ce.metadata["kind"], "injury");
    }

    // 1a. Raw attributes (BTreeMap) lower deterministically into clinical
    //     metadata regardless of insertion order.
    #[test]
    fn injury_attributes_lower_deterministically() {
        let mut a1 = injury("i1", "whiplash", AssertionStatus::Affirmed, "docA");
        a1.attributes.insert("severity".into(), "moderate".into());
        a1.attributes.insert("body_part".into(), "neck".into());
        let mut a2 = injury("i1", "whiplash", AssertionStatus::Affirmed, "docA");
        // Inserted in the opposite order — BTreeMap normalises ordering.
        a2.attributes.insert("body_part".into(), "neck".into());
        a2.attributes.insert("severity".into(), "moderate".into());

        let m1 = serde_json::to_string(&a1.to_clinical_event().metadata).unwrap();
        let m2 = serde_json::to_string(&a2.to_clinical_event().metadata).unwrap();
        assert_eq!(m1, m2);
        assert!(m1.contains("\"body_part\":\"neck\""));
    }

    // 1b. Conflicting injuries surface as a CLINICAL contradiction via the
    //     EXISTING pipeline (no new engine).
    #[test]
    fn conflicting_injuries_surface_as_clinical_contradiction() {
        let a = injury("i1", "fractured wrist", AssertionStatus::Affirmed, "docA");
        let b = injury("i2", "fractured wrist", AssertionStatus::Negated, "docB");

        // Lower → unify per document → longitudinal → contradictions.
        let ua = unify_events(vec![a.to_clinical_event()]);
        let ub = unify_events(vec![b.to_clinical_event()]);
        let graph = build_longitudinal_patient_graph(
            vec![("docA".to_string(), ua), ("docB".to_string(), ub)],
            None,
        );
        let contradictions = build_contradictions(&graph);
        assert_eq!(contradictions.len(), 1);
        assert_eq!(contradictions[0].subject, "fractured wrist");
        // 1 affirmed vs 1 negated → 0.5, identical dominant/total math.
        assert!((contradictions[0].resolution_confidence - 0.5).abs() < 1e-6);
    }

    // 2. FamilyEvent (the reused carrier) still drives family contradiction
    //    grouping correctly — (pair, target_mode), inverse-collapse intact.
    #[test]
    fn family_event_still_groups_and_contradicts() {
        let ev = |id: &str, rel: FamilyRelation, source: &str| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: rel,
                subject: "a#1".into(),
                target: Some("b#1".into()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: source.into(), date: None, context: "c".into() }],
            confidence: 0.9,
        };
        let g = build_family_graph(
            &[],
            None,
            vec![
                ev("e1", FamilyRelation::SiblingOf, "doc_a"),
                ev("e2", FamilyRelation::SpouseOf, "doc_b"),
            ],
        );
        let cs = build_family_contradictions(&g, &BTreeSet::new());
        assert_eq!(cs.len(), 1);
        // Relational (same pair, different relation) — identity not triggered.
        assert_eq!(cs[0].conflict_type.as_str(), "relational");
    }

    // 3. LegalStatusEvent lowers to a timeline record and produces NO
    //    contradiction (cannot affect clinical/family math).
    #[test]
    fn legal_status_event_is_timeline_only() {
        let le = LegalStatusEvent {
            event_id: "l1".into(),
            participant_id: "patient#1".into(),
            role: LegalRole::Claimant,
            temporal: Some(TimeRange { start: Some("2021-01-01".into()), end: None }),
            source_ids: vec!["docA".into()],
            attributes: BTreeMap::new(),
        };
        let entry = le.to_timeline_entry();
        assert_eq!(entry.date.as_deref(), Some("2021-01-01"));
        assert_eq!(entry.label, "legal_status:patient#1=claimant");
        assert_eq!(entry.source_unified_event_ids, vec!["docA".to_string()]);
        // There is no lowering from LegalStatusEvent into any contradiction
        // engine — by construction it has no such mapper.
    }

    // 4. Temporal: an injury's window start becomes the clinical event date;
    //    overlap semantics are untouched (no temporal redefinition here).
    #[test]
    fn injury_temporal_maps_to_clinical_date() {
        let mut inj = injury("i1", "whiplash", AssertionStatus::Affirmed, "docA");
        inj.temporal = Some(TimeRange { start: Some("2019-06-01".into()), end: Some("2019-07-01".into()) });
        let ce = inj.to_clinical_event();
        assert_eq!(ce.date.as_deref(), Some("2019-06-01"));
    }

    // 5. Identity unchanged: family contradictions from a FamilyEvent never
    //    trigger Identity without a structured-overlap ambiguity set.
    #[test]
    fn new_events_do_not_trigger_identity() {
        let ev = |id: &str, rel: FamilyRelation| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: rel,
                subject: "a#1".into(),
                target: Some("b#1".into()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: "d".into(), date: None, context: "c".into() }],
            confidence: 0.9,
        };
        let g = build_family_graph(
            &[],
            None,
            vec![ev("e1", FamilyRelation::SiblingOf), ev("e2", FamilyRelation::SpouseOf)],
        );
        // Empty ambiguity set ⇒ never Identity.
        let cs = build_family_contradictions(&g, &BTreeSet::new());
        assert_ne!(cs[0].conflict_type.as_str(), "identity");
    }

    // 6. Contradiction Engine unified stream stays byte-identical across re-runs with the
    //    new event-derived contradictions present.
    #[test]
    fn contradiction_ordering_stable_with_new_events() {
        use crate::canonical_case::{assemble_canonical_case, SubjectProfile};

        // Clinical contradictions sourced from conflicting injuries.
        let ua = unify_events(vec![
            injury("i1", "fractured wrist", AssertionStatus::Affirmed, "docA").to_clinical_event(),
        ]);
        let ub = unify_events(vec![
            injury("i2", "fractured wrist", AssertionStatus::Negated, "docB").to_clinical_event(),
        ]);
        let clinical = build_longitudinal_patient_graph(
            vec![("docA".into(), ua), ("docB".into(), ub)],
            None,
        );

        // Family contradiction from a reused FamilyEvent (cardinality 2 vs 3).
        let card = |id: &str, c: u32| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::ParentOf,
                subject: "patient#1".into(),
                target: None,
                cardinality: Some(c),
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: "f".into(), date: None, context: "c".into() }],
            confidence: 0.9,
        };
        let fam = build_family_graph(&[], None, vec![card("e1", 2), card("e2", 3)]);

        let case1 = assemble_canonical_case(&clinical, SubjectProfile::default(), fam.clone(), &[], Vec::new());
        let case2 = assemble_canonical_case(&clinical, SubjectProfile::default(), fam, &[], Vec::new());

        // Both an injury-derived clinical contradiction and a family one present.
        let domains: BTreeSet<&str> = case1
            .contradictions
            .iter()
            .map(|c| match c.domain {
                ContradictionDomain::Clinical => "clinical",
                ContradictionDomain::Family => "family",
            })
            .collect();
        assert!(domains.contains("clinical"));
        assert!(domains.contains("family"));
        // Bodies preserved verbatim per domain.
        assert!(case1.contradictions.iter().any(|c| matches!(c.body, CaseContradictionBody::Family(_))));

        // Byte-identical ordering across re-runs.
        assert_eq!(
            serde_json::to_string(&case1.contradictions).unwrap(),
            serde_json::to_string(&case2.contradictions).unwrap()
        );
    }

    // ── Hardening: attribute / provenance isolation locks ───────────────────

    // 2B. Family isolation — provenance (source/context) never affects grouping
    //     or confidence; only event_ids drive support.
    #[test]
    fn family_provenance_does_not_affect_grouping_or_confidence() {
        let ev = |id: &str, rel: FamilyRelation, source: &str, ctx: &str| FamilyEvent {
            event_id: id.into(),
            payload: FamilyEventPayload {
                relation: rel,
                subject: "a#1".into(),
                target: Some("b#1".into()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: source.into(), date: None, context: ctx.into() }],
            confidence: 0.9,
        };
        let g1 = build_family_graph(
            &[],
            None,
            vec![ev("e1", FamilyRelation::SiblingOf, "docA", "ctx-1"),
                 ev("e2", FamilyRelation::SpouseOf, "docB", "ctx-2")],
        );
        // Same events, entirely different provenance strings.
        let g2 = build_family_graph(
            &[],
            None,
            vec![ev("e1", FamilyRelation::SiblingOf, "docZ", "totally-different"),
                 ev("e2", FamilyRelation::SpouseOf, "docY", "other-context")],
        );
        let c1 = build_family_contradictions(&g1, &BTreeSet::new());
        let c2 = build_family_contradictions(&g2, &BTreeSet::new());
        assert_eq!(c1[0].conflict_type, c2[0].conflict_type);
        assert!((c1[0].resolution_confidence - c2[0].resolution_confidence).abs() < 1e-6);
    }

    // 2C. Legal isolation — attributes appear ONLY in the timeline label,
    //     deterministically sorted; LegalStatusEvent has no contradiction path.
    #[test]
    fn legal_attributes_appear_only_in_timeline() {
        let mut attrs = BTreeMap::new();
        // Insert out of key order; output must be key-sorted.
        attrs.insert("jurisdiction".into(), "NSW".into());
        attrs.insert("claim_no".into(), "ABC-123".into());
        let le = LegalStatusEvent {
            event_id: "l1".into(),
            participant_id: "patient#1".into(),
            role: LegalRole::Applicant,
            temporal: None,
            source_ids: vec!["docA".into()],
            attributes: attrs,
        };
        let entry = le.to_timeline_entry();
        assert_eq!(
            entry.label,
            "legal_status:patient#1=applicant {claim_no=ABC-123,jurisdiction=NSW}"
        );
        // The only lowering LegalStatusEvent exposes is to_timeline_entry —
        // there is no clinical/family converter, so attributes cannot reach a
        // contradiction or graph by construction.
    }

    // 2D / cross-domain. Injury attributes never influence the clinical
    //     contradiction's resolution_confidence.
    #[test]
    fn injury_attributes_do_not_influence_clinical_math() {
        let mut a = injury("i1", "fractured wrist", AssertionStatus::Affirmed, "docA");
        a.attributes.insert("severity".into(), "high".into());
        a.attributes.insert("mechanism".into(), "fall".into());
        let b = injury("i2", "fractured wrist", AssertionStatus::Negated, "docB"); // no attrs

        let ua = unify_events(vec![a.to_clinical_event()]);
        let ub = unify_events(vec![b.to_clinical_event()]);
        let g = build_longitudinal_patient_graph(
            vec![("docA".into(), ua), ("docB".into(), ub)],
            None,
        );
        let cs = build_contradictions(&g);
        assert_eq!(cs.len(), 1);
        // Attributes irrelevant to the dominant/total math.
        assert!((cs[0].resolution_confidence - 0.5).abs() < 1e-6);
    }

    // 3. Contradiction Engine determinism lock: two streams differing ONLY in attribute
    //    insertion order must serialise byte-identically.
    #[test]
    fn contradiction_byte_identical_under_attribute_insertion_order() {
        use crate::canonical_case::{assemble_canonical_case, SubjectProfile};

        let make_case = |order_ab: bool| {
            let mut a = injury("i1", "fractured wrist", AssertionStatus::Affirmed, "docA");
            if order_ab {
                a.attributes.insert("severity".into(), "high".into());
                a.attributes.insert("body_part".into(), "wrist".into());
            } else {
                a.attributes.insert("body_part".into(), "wrist".into());
                a.attributes.insert("severity".into(), "high".into());
            }
            let b = injury("i2", "fractured wrist", AssertionStatus::Negated, "docB");
            let ua = unify_events(vec![a.to_clinical_event()]);
            let ub = unify_events(vec![b.to_clinical_event()]);
            let clinical = build_longitudinal_patient_graph(
                vec![("docA".into(), ua), ("docB".into(), ub)],
                None,
            );
            let card = |id: &str, c: u32| FamilyEvent {
                event_id: id.into(),
                payload: FamilyEventPayload {
                    relation: FamilyRelation::ParentOf,
                    subject: "patient#1".into(),
                    target: None,
                    cardinality: Some(c),
                },
                status: FamilyEdgeStatus::Affirmed,
                temporal: None,
                sources: vec![SourceRef { source: "f".into(), date: None, context: "c".into() }],
                confidence: 0.9,
            };
            let fam = build_family_graph(&[], None, vec![card("e1", 2), card("e2", 3)]);
            assemble_canonical_case(&clinical, SubjectProfile::default(), fam, &[], Vec::new())
        };

        let case1 = make_case(true);
        let case2 = make_case(false);
        // Full envelope byte-identical despite different attribute insertion order.
        assert_eq!(
            serde_json::to_string(&case1).unwrap(),
            serde_json::to_string(&case2).unwrap()
        );
    }
}
