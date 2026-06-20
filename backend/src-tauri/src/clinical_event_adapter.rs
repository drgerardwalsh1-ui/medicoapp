//! Clinical event routing + preservation layer (additive, preparation only).
//!
//! Centralises the deterministic decision of which `ClinicalEvent`s the Contradiction Engine
//! adapter consumes. TODAY this is BYTE-IDENTICAL to the previous inline
//! behaviour: `Diagnosis → Injury`, everything else → `Unsupported`. It adds
//! NO new event coverage, NO inference, and changes NO contradiction, confidence,
//! export, grouping, family, legal, or enrichment logic.
//!
//! It exists so future event types can be onboarded here without re-touching
//! `contradiction_input_adapter.rs`, plus two preservation/visibility helpers
//! (`clinical_event_metadata_snapshot`, `clinical_coverage_report`) that are
//! pure functions wired to nothing yet.
//!
//! Audit fact: the contradiction engine (`canonical_case::build_contradictions`)
//! is type-agnostic — it surfaces conflicts for ANY `(event_type, concept)`
//! group. The Diagnosis-only restriction is solely this adapter's choice,
//! because `InjuryEvent::to_clinical_event` always lowers back to `Diagnosis`;
//! routing a non-diagnosis type through it would distort grouping. Hence
//! non-diagnosis types remain `Unsupported` in this stage.

#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use crate::case_events::InjuryEvent;
use crate::clinical_events::{AssertionStatus, ClinicalEvent, DatePrecision, EventType};
use crate::family_graph::TimeRange;

/// Outcome of routing a single clinical event.
pub enum ClinicalRoutingResult {
    /// The event is consumed and lowered to an `InjuryEvent` (Diagnosis only).
    Injury(InjuryEvent),
    /// The event type is not consumed by the adapter (carries the type for
    /// visibility / future onboarding).
    Unsupported(EventType),
}

/// Deterministic routing. `Diagnosis → Injury(...)` reproducing the exact prior
/// behaviour (same attributes, same fields); all other types → `Unsupported`.
/// Pure — no inference, no side effects.
///
/// Delegates to `route_clinical_event_v2` (the classification-driven path);
/// the Diagnosis output stays byte-identical.
pub fn route_clinical_event(event: &ClinicalEvent) -> ClinicalRoutingResult {
    route_clinical_event_v2(event)
}

/// The verbatim Diagnosis → InjuryEvent construction. Kept byte-identical to the
/// prior inline adapter code (same `attributes` keys/values, same fields).
fn injury_from_diagnosis(ce: &ClinicalEvent) -> InjuryEvent {
    let mut attributes: BTreeMap<String, String> = BTreeMap::new();
    attributes.insert("origin".into(), "clinical_extraction".into());
    attributes.insert("orig_event_id".into(), ce.event_id.clone());
    attributes.insert("orig_event_type".into(), ce.event_type.as_str().to_string());
    attributes.insert("source_document_id".into(), ce.source_document_id.clone());
    if let Some(sec) = &ce.source_section {
        attributes.insert("source_section".into(), sec.clone());
    }
    attributes.insert("source_snippet".into(), ce.source_snippet.clone());
    attributes.insert("char_offset_start".into(), ce.char_offset_start.to_string());
    attributes.insert("char_offset_end".into(), ce.char_offset_end.to_string());

    InjuryEvent {
        event_id: ce.event_id.clone(),
        participant_id: "patient".to_string(),
        injury: ce.concept.clone(),
        status: ce.assertion_status.unwrap_or(AssertionStatus::Affirmed),
        temporal: ce.date.clone().map(|d| TimeRange { start: Some(d), end: None }),
        source_ids: vec![ce.source_document_id.clone()],
        attributes,
    }
}

// ── Explicit semantic routing model (preparation only) ─────────────────────

/// A stable semantic classification of a clinical event, decoupled from the
/// wire-level `EventType`. This is preparation for future onboarding; it does
/// NOT change routing — only `Diagnosis` is supported today.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ClinicalSemanticKind {
    Diagnosis,
    Symptom,
    Medication,
    Procedure,
    Investigation,
    Organisation,
    Person,
    DocumentDate,
}

impl ClinicalSemanticKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ClinicalSemanticKind::Diagnosis => "diagnosis",
            ClinicalSemanticKind::Symptom => "symptom",
            ClinicalSemanticKind::Medication => "medication",
            ClinicalSemanticKind::Procedure => "procedure",
            ClinicalSemanticKind::Investigation => "investigation",
            ClinicalSemanticKind::Organisation => "organisation",
            ClinicalSemanticKind::Person => "person",
            ClinicalSemanticKind::DocumentDate => "document_date",
        }
    }
}

/// Total, 1:1 mapping from the wire `EventType` to a `ClinicalSemanticKind`.
/// Pure — no inference.
fn semantic_kind_of(event_type: EventType) -> ClinicalSemanticKind {
    match event_type {
        EventType::Diagnosis => ClinicalSemanticKind::Diagnosis,
        EventType::Symptom => ClinicalSemanticKind::Symptom,
        EventType::MedicationMention => ClinicalSemanticKind::Medication,
        EventType::Procedure => ClinicalSemanticKind::Procedure,
        EventType::InvestigationMention => ClinicalSemanticKind::Investigation,
        EventType::Organisation => ClinicalSemanticKind::Organisation,
        EventType::Person => ClinicalSemanticKind::Person,
        EventType::DocumentDate => ClinicalSemanticKind::DocumentDate,
    }
}

/// The routing decision for one event: its semantic kind, whether the adapter
/// consumes it, and a human-readable reason. `Diagnosis` is the only supported
/// kind today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicalRoutingDecision {
    pub semantic_kind: ClinicalSemanticKind,
    pub supported: bool,
    pub reason: String,
}

/// Pure `EventType` → decision mapping. No inference, no side effects.
/// Supported set is now `{Diagnosis, Symptom}`.
pub fn classify_clinical_event(event: &ClinicalEvent) -> ClinicalRoutingDecision {
    let semantic_kind = semantic_kind_of(event.event_type);
    let (supported, reason) = match semantic_kind {
        ClinicalSemanticKind::Diagnosis => (
            true,
            "diagnosis → injury (clinical contradiction input)".to_string(),
        ),
        ClinicalSemanticKind::Symptom => (
            true,
            "symptom → injury (namespaced 'symptom:' concept; clinical contradiction input)"
                .to_string(),
        ),
        other => (
            false,
            format!("{} not yet onboarded into the clinical input adapter", other.as_str()),
        ),
    };
    ClinicalRoutingDecision { semantic_kind, supported, reason }
}

/// Distinct concept prefix that keeps symptom contradictions in their own
/// grouping namespace. Grouping is by `(event_type, concept)`; both Diagnosis
/// and Symptom lower to a `Diagnosis`-typed `ClinicalEvent` (via
/// `InjuryEvent::to_clinical_event`), so the namespace is what keeps the two
/// streams disjoint — diagnosis "fatigue" never merges with symptom "fatigue".
const SYMPTOM_CONCEPT_NAMESPACE: &str = "symptom:";

/// Classification-driven routing.
///   Diagnosis → Injury (verbatim, byte-identical lowering)
///   Symptom   → Injury with a `"symptom:"`-namespaced concept (new path)
///   else      → Unsupported
/// Engine, grouping, confidence, and export are untouched — only the input
/// concept string is shaped.
pub fn route_clinical_event_v2(event: &ClinicalEvent) -> ClinicalRoutingResult {
    match semantic_kind_of(event.event_type) {
        ClinicalSemanticKind::Diagnosis => {
            ClinicalRoutingResult::Injury(injury_from_diagnosis(event))
        }
        ClinicalSemanticKind::Symptom => {
            ClinicalRoutingResult::Injury(injury_from_symptom(event))
        }
        _ => ClinicalRoutingResult::Unsupported(event.event_type),
    }
}

/// Symptom lowering. Reuses `InjuryEvent` but namespaces the concept as
/// `"symptom:{concept}"` so symptoms never group with diagnoses. The default
/// status mirrors the symptom-event default (`SymptomOnly`). Full provenance is
/// retained in `attributes` (incl. the original un-namespaced concept). The
/// Diagnosis lowering (`injury_from_diagnosis`) is NOT touched.
fn injury_from_symptom(ce: &ClinicalEvent) -> InjuryEvent {
    let mut attributes: BTreeMap<String, String> = BTreeMap::new();
    attributes.insert("origin".into(), "clinical_extraction".into());
    attributes.insert("orig_event_id".into(), ce.event_id.clone());
    attributes.insert("orig_event_type".into(), ce.event_type.as_str().to_string());
    attributes.insert("orig_concept".into(), ce.concept.clone());
    attributes.insert("semantic_kind".into(), "symptom".into());
    attributes.insert("source_document_id".into(), ce.source_document_id.clone());
    if let Some(sec) = &ce.source_section {
        attributes.insert("source_section".into(), sec.clone());
    }
    attributes.insert("source_snippet".into(), ce.source_snippet.clone());
    attributes.insert("char_offset_start".into(), ce.char_offset_start.to_string());
    attributes.insert("char_offset_end".into(), ce.char_offset_end.to_string());

    InjuryEvent {
        event_id: ce.event_id.clone(),
        participant_id: "patient".to_string(),
        injury: format!("{SYMPTOM_CONCEPT_NAMESPACE}{}", ce.concept),
        status: ce.assertion_status.unwrap_or(AssertionStatus::SymptomOnly),
        temporal: ce.date.clone().map(|d| TimeRange { start: Some(d), end: None }),
        source_ids: vec![ce.source_document_id.clone()],
        attributes,
    }
}

fn date_precision_str(p: DatePrecision) -> &'static str {
    match p {
        DatePrecision::Day => "day",
        DatePrecision::Month => "month",
        DatePrecision::Year => "year",
    }
}

/// PRESERVATION CONTRACT — a deterministic, lossless snapshot of every
/// `ClinicalEvent` provenance field that the Diagnosis → Injury lowering does
/// NOT otherwise carry through. `BTreeMap` ⇒ sorted, stable output.
///
/// This is preservation-only: it is wired to nothing and does NOT affect
/// routing, contradictions, grouping, or export. Fixed key set (absent
/// optionals render as empty string) so the contract is stable:
///   event_id, event_type, source_document_id, source_section, page,
///   char_offset_start, char_offset_end, raw_concept, date_precision
pub fn clinical_event_metadata_snapshot(event: &ClinicalEvent) -> BTreeMap<String, String> {
    let mut m: BTreeMap<String, String> = BTreeMap::new();
    m.insert("event_id".into(), event.event_id.clone());
    m.insert("event_type".into(), event.event_type.as_str().to_string());
    m.insert("source_document_id".into(), event.source_document_id.clone());
    m.insert(
        "source_section".into(),
        event.source_section.clone().unwrap_or_default(),
    );
    m.insert(
        "page".into(),
        event.page.map(|p| p.to_string()).unwrap_or_default(),
    );
    m.insert("char_offset_start".into(), event.char_offset_start.to_string());
    m.insert("char_offset_end".into(), event.char_offset_end.to_string());
    m.insert("raw_concept".into(), event.raw_concept.clone());
    m.insert(
        "date_precision".into(),
        event.date_precision.map(date_precision_str).unwrap_or("").to_string(),
    );
    m
}

/// Deterministic coverage report: how many events of each `event_type` the
/// adapter would consume (`supported`) vs ignore (`unsupported`). Counts are
/// derived from the SAME routing decision, so they always agree with what the
/// adapter actually does. Pure — no logging, no side effects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicalCoverageReport {
    /// Consumed event types → count (keyed by wire `EventType::as_str`).
    pub supported: BTreeMap<String, usize>,
    /// Ignored event types → count (keyed by wire `EventType::as_str`).
    pub unsupported: BTreeMap<String, usize>,
    /// All events counted by semantic kind (keyed by `ClinicalSemanticKind::as_str`).
    /// Deterministic; `BTreeMap` only.
    pub by_semantic_kind: BTreeMap<String, usize>,
}

pub fn clinical_coverage_report(events: &[ClinicalEvent]) -> ClinicalCoverageReport {
    let mut supported: BTreeMap<String, usize> = BTreeMap::new();
    let mut unsupported: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_semantic_kind: BTreeMap<String, usize> = BTreeMap::new();
    for ev in events {
        *by_semantic_kind
            .entry(semantic_kind_of(ev.event_type).as_str().to_string())
            .or_insert(0) += 1;
        match route_clinical_event(ev) {
            ClinicalRoutingResult::Injury(_) => {
                *supported.entry(ev.event_type.as_str().to_string()).or_insert(0) += 1;
            }
            ClinicalRoutingResult::Unsupported(t) => {
                *unsupported.entry(t.as_str().to_string()).or_insert(0) += 1;
            }
        }
    }
    ClinicalCoverageReport { supported, unsupported, by_semantic_kind }
}

/// Sorted, de-duplicated list of the wire event-type names that are currently
/// unsupported in the input corpus. Deterministic (`BTreeSet` → `Vec`).
pub fn unsupported_event_types(events: &[ClinicalEvent]) -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for ev in events {
        if !classify_clinical_event(ev).supported {
            set.insert(ev.event_type.as_str().to_string());
        }
    }
    set.into_iter().collect()
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ce(event_type: EventType, concept: &str, status: Option<AssertionStatus>, doc: &str) -> ClinicalEvent {
        ClinicalEvent {
            event_id: format!("{}#{concept}", event_type.as_str()),
            event_type,
            concept: concept.into(),
            raw_concept: concept.to_uppercase(),
            date: Some("2020-01-01".into()),
            date_precision: Some(DatePrecision::Month),
            assertion_status: status,
            source_document_id: doc.into(),
            source_section: Some("SOURCE A".into()),
            source_snippet: format!("...{concept}..."),
            char_offset_start: 3,
            char_offset_end: 3 + concept.len(),
            page: Some(7),
            participants: Vec::new(),
            metadata: json!({}),
        }
    }

    // 1. Diagnosis routing → Injury with the exact prior attribute set.
    #[test]
    fn diagnosis_routes_to_injury_with_expected_attributes() {
        let d = ce(EventType::Diagnosis, "fractured wrist", Some(AssertionStatus::Affirmed), "docA");
        match route_clinical_event(&d) {
            ClinicalRoutingResult::Injury(inj) => {
                assert_eq!(inj.event_id, "diagnosis#fractured wrist");
                assert_eq!(inj.injury, "fractured wrist");
                assert_eq!(inj.status, AssertionStatus::Affirmed);
                assert_eq!(inj.source_ids, vec!["docA".to_string()]);
                // Exact attribute keys preserved (byte-identity contract).
                assert_eq!(inj.attributes.get("origin").map(String::as_str), Some("clinical_extraction"));
                assert_eq!(inj.attributes.get("orig_event_type").map(String::as_str), Some("diagnosis"));
                assert_eq!(inj.attributes.get("source_document_id").map(String::as_str), Some("docA"));
                assert_eq!(inj.attributes.get("source_section").map(String::as_str), Some("SOURCE A"));
                assert_eq!(inj.attributes.get("char_offset_start").map(String::as_str), Some("3"));
            }
            ClinicalRoutingResult::Unsupported(_) => panic!("expected Injury"),
        }
    }

    // 2. Every type OTHER than the supported set {Diagnosis, Symptom} routes to
    //    Unsupported (carrying its type).
    #[test]
    fn unsupported_types_route_to_unsupported() {
        for t in [
            EventType::MedicationMention,
            EventType::Procedure,
            EventType::InvestigationMention,
            EventType::Organisation,
            EventType::Person,
            EventType::DocumentDate,
        ] {
            let e = ce(t, "x", None, "docA");
            match route_clinical_event(&e) {
                ClinicalRoutingResult::Unsupported(got) => assert_eq!(got, t),
                ClinicalRoutingResult::Injury(_) => panic!("{} must be Unsupported", t.as_str()),
            }
        }
    }

    // 3. Coverage report counts are deterministic and route-consistent.
    #[test]
    fn coverage_report_counts_are_deterministic() {
        let events = vec![
            ce(EventType::Diagnosis, "a", None, "d"),
            ce(EventType::Diagnosis, "b", None, "d"),
            ce(EventType::Symptom, "c", None, "d"),
            ce(EventType::MedicationMention, "m", None, "d"),
            ce(EventType::Symptom, "e", None, "d"),
        ];
        let r1 = clinical_coverage_report(&events);
        let r2 = clinical_coverage_report(&events);
        assert_eq!(r1, r2);
        assert_eq!(r1.supported.get("diagnosis"), Some(&2));
        // Symptom is now SUPPORTED.
        assert_eq!(r1.supported.get("symptom"), Some(&2));
        assert_eq!(r1.unsupported.get("medication_mention"), Some(&1));
        assert!(r1.unsupported.get("symptom").is_none());
    }

    // 4. Snapshot preserves all provenance fields deterministically.
    #[test]
    fn metadata_snapshot_preserves_all_provenance_fields() {
        let e = ce(EventType::Symptom, "insomnia", None, "docZ");
        let s = clinical_event_metadata_snapshot(&e);
        assert_eq!(s.get("event_id").map(String::as_str), Some("symptom#insomnia"));
        assert_eq!(s.get("event_type").map(String::as_str), Some("symptom"));
        assert_eq!(s.get("source_document_id").map(String::as_str), Some("docZ"));
        assert_eq!(s.get("source_section").map(String::as_str), Some("SOURCE A"));
        assert_eq!(s.get("page").map(String::as_str), Some("7"));
        assert_eq!(s.get("char_offset_start").map(String::as_str), Some("3"));
        assert_eq!(s.get("raw_concept").map(String::as_str), Some("INSOMNIA"));
        assert_eq!(s.get("date_precision").map(String::as_str), Some("month"));
        // Deterministic re-run.
        assert_eq!(s, clinical_event_metadata_snapshot(&e));
    }

    // Snapshot renders absent optionals as empty strings (stable key set).
    #[test]
    fn metadata_snapshot_handles_absent_optionals() {
        let mut e = ce(EventType::Diagnosis, "x", None, "d");
        e.source_section = None;
        e.page = None;
        e.date_precision = None;
        let s = clinical_event_metadata_snapshot(&e);
        assert_eq!(s.get("source_section").map(String::as_str), Some(""));
        assert_eq!(s.get("page").map(String::as_str), Some(""));
        assert_eq!(s.get("date_precision").map(String::as_str), Some(""));
    }

    // ── Stage: explicit semantic routing model ──────────────────────────────

    // E1. Every EventType maps to exactly one ClinicalSemanticKind.
    #[test]
    fn every_eventtype_maps_to_one_semantic_kind() {
        let table = [
            (EventType::Diagnosis, ClinicalSemanticKind::Diagnosis),
            (EventType::Symptom, ClinicalSemanticKind::Symptom),
            (EventType::MedicationMention, ClinicalSemanticKind::Medication),
            (EventType::Procedure, ClinicalSemanticKind::Procedure),
            (EventType::InvestigationMention, ClinicalSemanticKind::Investigation),
            (EventType::Organisation, ClinicalSemanticKind::Organisation),
            (EventType::Person, ClinicalSemanticKind::Person),
            (EventType::DocumentDate, ClinicalSemanticKind::DocumentDate),
        ];
        for (et, expected) in table {
            assert_eq!(semantic_kind_of(et), expected, "{}", et.as_str());
        }
        // All 8 kinds are distinct.
        let kinds: BTreeSet<&str> = table.iter().map(|(_, k)| k.as_str()).collect();
        assert_eq!(kinds.len(), 8);
    }

    // E2. Diagnosis remains supported.
    #[test]
    fn diagnosis_classification_is_supported() {
        let d = classify_clinical_event(&ce(EventType::Diagnosis, "x", None, "doc"));
        assert!(d.supported);
        assert_eq!(d.semantic_kind, ClinicalSemanticKind::Diagnosis);
    }

    // E3. Every type outside {Diagnosis, Symptom} remains unsupported.
    #[test]
    fn other_types_classification_is_unsupported() {
        for t in [
            EventType::MedicationMention,
            EventType::Procedure,
            EventType::InvestigationMention,
            EventType::Organisation,
            EventType::Person,
            EventType::DocumentDate,
        ] {
            let d = classify_clinical_event(&ce(t, "x", None, "doc"));
            assert!(!d.supported, "{} must be unsupported", t.as_str());
            assert!(d.reason.contains("not yet onboarded"));
        }
    }

    // E4. Coverage report counts (incl. by_semantic_kind) are deterministic.
    #[test]
    fn coverage_report_by_semantic_kind_is_deterministic() {
        let events = vec![
            ce(EventType::Diagnosis, "a", None, "d"),
            ce(EventType::Symptom, "b", None, "d"),
            ce(EventType::MedicationMention, "m", None, "d"),
            ce(EventType::Symptom, "c", None, "d"),
        ];
        let r1 = clinical_coverage_report(&events);
        let r2 = clinical_coverage_report(&events);
        assert_eq!(r1, r2);
        assert_eq!(r1.by_semantic_kind.get("diagnosis"), Some(&1));
        assert_eq!(r1.by_semantic_kind.get("symptom"), Some(&2));
        assert_eq!(r1.by_semantic_kind.get("medication"), Some(&1));
        // Totals reconcile: diagnosis + symptom supported; medication not.
        assert_eq!(r1.supported.get("diagnosis"), Some(&1));
        assert_eq!(r1.supported.get("symptom"), Some(&2));
        assert_eq!(r1.unsupported.get("medication_mention"), Some(&1));
    }

    // E5. unsupported_event_types output is sorted + deduped.
    #[test]
    fn unsupported_event_types_is_sorted() {
        let events = vec![
            ce(EventType::Symptom, "a", None, "d"), // supported → excluded
            ce(EventType::MedicationMention, "b", None, "d"),
            ce(EventType::Person, "c", None, "d"),
            ce(EventType::Diagnosis, "d", None, "d"), // supported → excluded
            ce(EventType::Person, "e", None, "d"), // dup type
        ];
        let got = unsupported_event_types(&events);
        // Symptom + Diagnosis are supported and excluded; output sorted + deduped.
        assert_eq!(got, vec!["medication_mention", "person"]);
        let mut sorted = got.clone();
        sorted.sort();
        assert_eq!(got, sorted);
        assert!(!got.iter().any(|s| s == "diagnosis" || s == "symptom"));
    }

    // E6. route_clinical_event delegates to route_clinical_event_v2.
    #[test]
    fn route_clinical_event_delegates_to_v2() {
        let d = ce(EventType::Diagnosis, "fractured wrist", Some(AssertionStatus::Affirmed), "docA");
        let s = ce(EventType::Symptom, "insomnia", None, "docA");
        for e in [&d, &s] {
            match (route_clinical_event(e), route_clinical_event_v2(e)) {
                (ClinicalRoutingResult::Injury(a), ClinicalRoutingResult::Injury(b)) => {
                    assert_eq!(
                        serde_json::to_value(&a).unwrap(),
                        serde_json::to_value(&b).unwrap()
                    );
                }
                (ClinicalRoutingResult::Unsupported(a), ClinicalRoutingResult::Unsupported(b)) => {
                    assert_eq!(a, b);
                }
                _ => panic!("route_clinical_event diverged from v2 for {}", e.event_type.as_str()),
            }
        }
    }

    // ── Stage: Symptom as a second supported stream ─────────────────────────

    // Symptom classifies as ClinicalSemanticKind::Symptom and is now supported.
    #[test]
    fn symptom_is_classified_and_supported() {
        let d = classify_clinical_event(&ce(EventType::Symptom, "fatigue", None, "doc"));
        assert_eq!(d.semantic_kind, ClinicalSemanticKind::Symptom);
        assert!(d.supported);
        assert!(d.reason.contains("symptom"));
    }

    // Symptom routes (via v2 and via the public route fn) to an Injury with a
    // `"symptom:"`-namespaced concept and full provenance preserved.
    #[test]
    fn symptom_routes_to_namespaced_injury() {
        let s = ce(EventType::Symptom, "fatigue", None, "docZ");
        match route_clinical_event(&s) {
            ClinicalRoutingResult::Injury(inj) => {
                assert_eq!(inj.injury, "symptom:fatigue"); // distinct namespace
                // Symptom default status.
                assert_eq!(inj.status, AssertionStatus::SymptomOnly);
                // Provenance preserved, incl. original (un-namespaced) concept.
                assert_eq!(inj.attributes.get("orig_concept").map(String::as_str), Some("fatigue"));
                assert_eq!(inj.attributes.get("orig_event_type").map(String::as_str), Some("symptom"));
                assert_eq!(inj.attributes.get("semantic_kind").map(String::as_str), Some("symptom"));
                assert_eq!(inj.attributes.get("source_document_id").map(String::as_str), Some("docZ"));
            }
            ClinicalRoutingResult::Unsupported(_) => panic!("symptom must be supported now"),
        }
    }

    // Symptom routing is deterministic (same input → byte-identical envelope).
    #[test]
    fn symptom_routing_is_deterministic() {
        let s = ce(EventType::Symptom, "insomnia", Some(AssertionStatus::Affirmed), "docA");
        let a = match route_clinical_event(&s) {
            ClinicalRoutingResult::Injury(i) => serde_json::to_value(&i).unwrap(),
            _ => panic!(),
        };
        let b = match route_clinical_event(&s) {
            ClinicalRoutingResult::Injury(i) => serde_json::to_value(&i).unwrap(),
            _ => panic!(),
        };
        assert_eq!(a, b);
    }

    // Symptom provenance survives the metadata snapshot (event_type, raw_concept …).
    #[test]
    fn symptom_metadata_snapshot_preserves_provenance() {
        let s = ce(EventType::Symptom, "insomnia", None, "docY");
        let snap = clinical_event_metadata_snapshot(&s);
        assert_eq!(snap.get("event_type").map(String::as_str), Some("symptom"));
        assert_eq!(snap.get("raw_concept").map(String::as_str), Some("INSOMNIA"));
        assert_eq!(snap.get("source_document_id").map(String::as_str), Some("docY"));
        assert_eq!(snap.get("page").map(String::as_str), Some("7"));
        assert_eq!(snap.get("char_offset_start").map(String::as_str), Some("3"));
    }

    // E7. v2 Diagnosis envelope is byte-identical (exact 8-key attribute set).
    #[test]
    fn v2_diagnosis_envelope_is_byte_identical() {
        let d = ce(EventType::Diagnosis, "fractured wrist", Some(AssertionStatus::Affirmed), "docA");
        match route_clinical_event_v2(&d) {
            ClinicalRoutingResult::Injury(inj) => {
                let keys: Vec<&str> = inj.attributes.keys().map(|k| k.as_str()).collect();
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
                assert_eq!(inj.participant_id, "patient");
                assert_eq!(inj.injury, "fractured wrist");
                assert_eq!(inj.status, AssertionStatus::Affirmed);
            }
            ClinicalRoutingResult::Unsupported(_) => panic!("expected Injury"),
        }
    }
}
