//! Patient Timeline Layer.
//!
//! Sits ABOVE `event_unification::UnifiedEvent`. Takes the per-document
//! unified events for a whole patient corpus and produces one
//! `PatientEvent` per (event_type, normalised concept), with:
//!
//!   * `first_seen_date` / `last_seen_date` aggregated across documents
//!   * `documents[]` — every contributing document and its date
//!   * a globally-resolved `assertion` computed via a weighted scoring
//!     scheme that intentionally surfaces cross-document conflicts
//!   * `stability_score` — how consistent across the corpus a finding is
//!   * `related_patient_events` — graph links across event types
//!
//! All grouping is reversible: each `PatientEvent` exposes
//! `source_unified_event_ids` and `source_document_ids` so callers can
//! drill back to the raw per-document evidence.
//!
//! No ML. No embeddings. Pure deterministic aggregation.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::clinical_events::{AssertionStatus, DatePrecision, EventParticipant, EventType};
use crate::event_unification::UnifiedEvent;

// ── DocumentReference ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentReference {
    pub doc_id: String,
    pub unified_event_id: String,
    /// `primary_date` from the contributing UnifiedEvent, if any.
    pub date_in_doc: Option<String>,
}

// ── PatientEvent ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientEvent {
    /// Stable across documents — same for the same canonical concept
    /// regardless of which docs contributed.
    pub patient_event_id: String,

    pub event_type: EventType,
    pub concept: String,

    // Longitudinal aggregation
    pub first_seen_date: Option<String>,
    pub last_seen_date: Option<String>,
    pub date_precision: Option<DatePrecision>,

    /// Every contributing document and the date the event was observed in.
    pub documents: Vec<DocumentReference>,
    /// Sum of UnifiedEvent.frequency across all contributing documents.
    pub total_occurrences: u32,

    /// Globally resolved assertion (weighted vote — see assertion module).
    pub global_assertion: AssertionStatus,

    // Provenance — full reversibility back to lower layers.
    pub source_unified_event_ids: Vec<String>,
    pub source_document_ids: Vec<String>,
    pub source_sections: Vec<String>,

    pub participants: Vec<EventParticipant>,

    pub confidence: f32,
    /// How consistent this finding is across the corpus.
    /// In `[0.0, 1.0]`. See `compute_stability_score`.
    pub stability_score: f32,

    /// `patient_event_id`s of related PatientEvents.
    /// Rules (deterministic):
    ///   1. Same normalised concept, different event_type → bidirectional.
    ///   2. {Diagnosis, MedicationMention, Symptom} triad on the same
    ///      concept — fully connected.
    ///   3. Any cross-doc contradiction → fan out to every PatientEvent
    ///      sharing the concept.
    pub related_patient_events: Vec<String>,

    /// `merged_status_set`, `conflict_across_documents`, etc.
    pub metadata: JsonValue,
}

// ── Builder entry point ──────────────────────────────────────────────────

/// Build the patient timeline from a flat `Vec<(doc_id, UnifiedEvent)>`.
/// Convenience for callers that have already flattened. Public surface
/// of the patient-timeline module.
#[allow(dead_code)]
pub fn build_patient_timeline(
    all_events: Vec<(String, UnifiedEvent)>,
) -> Vec<PatientEvent> {
    // Group all input by doc_id so the per-document branch counts
    // (used for stability_score) are accurate.
    let mut by_doc: std::collections::BTreeMap<String, Vec<UnifiedEvent>> =
        std::collections::BTreeMap::new();
    for (doc, ev) in all_events {
        by_doc.entry(doc).or_default().push(ev);
    }
    let total_docs = by_doc.len() as u32;
    let docs: Vec<(String, Vec<UnifiedEvent>)> = by_doc.into_iter().collect();
    build_inner(docs, total_docs)
}

/// Spec'd signature — accepts per-document unified events and produces
/// the patient timeline.
pub fn build_patient_timeline_from_unified(
    docs: Vec<(String, Vec<UnifiedEvent>)>,
) -> Vec<PatientEvent> {
    let total_docs = docs.len() as u32;
    build_inner(docs, total_docs)
}

fn build_inner(
    docs: Vec<(String, Vec<UnifiedEvent>)>,
    total_docs: u32,
) -> Vec<PatientEvent> {
    use std::collections::BTreeMap;

    // 1. Flatten with provenance. Each (event_type, normalised_concept)
    //    accumulates a Vec<(doc_id, UnifiedEvent)>.
    let mut buckets: BTreeMap<(EventType, String), Vec<(String, UnifiedEvent)>> =
        BTreeMap::new();
    for (doc_id, events) in docs {
        for u in events {
            let key = (u.event_type, normalise_concept(&u.concept));
            buckets.entry(key).or_default().push((doc_id.clone(), u));
        }
    }

    // 2. Build PatientEvent per bucket.
    let mut patient_events: Vec<PatientEvent> = buckets
        .into_iter()
        .map(|((etype, normalised), contributions)| {
            build_patient_event(etype, normalised, contributions, total_docs)
        })
        .collect();

    // 3. Cross-link in a second pass.
    populate_related_events(&mut patient_events);

    // 4. Sort: first_seen_date asc (None last), then stability_score desc.
    patient_events.sort_by(|a, b| {
        let ka = a.first_seen_date.as_deref().unwrap_or("\u{FFFE}");
        let kb = b.first_seen_date.as_deref().unwrap_or("\u{FFFE}");
        ka.cmp(kb).then(b.stability_score.partial_cmp(&a.stability_score)
            .unwrap_or(std::cmp::Ordering::Equal))
    });

    patient_events
}

fn build_patient_event(
    event_type: EventType,
    normalised_concept: String,
    contributions: Vec<(String, UnifiedEvent)>,
    total_docs: u32,
) -> PatientEvent {
    let patient_event_id = format!("patient#{}#{}", event_type.as_str(), normalised_concept);

    // Display concept — most-seen casing across contributing UnifiedEvents.
    let display_concept = pick_display_concept(&contributions, &normalised_concept);

    // Temporal aggregation. We track the per-document date AND the
    // best precision observed — first/last are min/max ISO strings
    // among contributions that have any date.
    let mut dates: Vec<(String, Option<DatePrecision>)> = Vec::new();
    let mut documents: Vec<DocumentReference> = Vec::new();
    let mut source_unified_event_ids: Vec<String> = Vec::new();
    let mut source_document_ids_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut source_sections_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut participants: Vec<EventParticipant> = Vec::new();
    let mut seen_participants: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let mut total_occurrences: u32 = 0;

    let mut observed_statuses: Vec<AssertionStatus> = Vec::new();
    // Track every distinct underlying status seen INSIDE each
    // contributing UnifiedEvent (its merged_status_set), not just the
    // per-document winner. If FakeClient2 internally saw both Affirmed
    // and Contradicted PTSD mentions, the UnifiedEvent winner is
    // "contradicted" but the union still records that an affirmed
    // mention was made. We need that for `conflict_across_documents`.
    let mut underlying_statuses: std::collections::BTreeSet<AssertionStatus> =
        std::collections::BTreeSet::new();
    let mut any_unified_conflict = false;
    let mut confidence_sum: f32 = 0.0;
    let mut confidence_n: u32 = 0;

    for (doc_id, u) in &contributions {
        documents.push(DocumentReference {
            doc_id: doc_id.clone(),
            unified_event_id: u.canonical_id.clone(),
            date_in_doc: u.primary_date.clone(),
        });
        source_unified_event_ids.push(u.canonical_id.clone());
        source_document_ids_set.insert(doc_id.clone());
        for s in &u.source_sections {
            source_sections_set.insert(s.clone());
        }
        for p in &u.participants {
            let key = (p.role.clone(), p.name.clone());
            if seen_participants.insert(key) {
                participants.push(p.clone());
            }
        }
        if let Some(d) = u.primary_date.clone() {
            dates.push((d, u.date_precision));
        }
        total_occurrences += u.frequency;
        observed_statuses.push(u.assertion);
        underlying_statuses.insert(u.assertion);
        // Pull every status from the inner merged set as well so the
        // patient layer can see through within-doc conflict resolution.
        if let Some(arr) = u.metadata.get("merged_status_set").and_then(|v| v.as_array()) {
            for s in arr {
                if let Some(str_s) = s.as_str() {
                    if let Some(parsed) = AssertionStatus::parse(str_s) {
                        underlying_statuses.insert(parsed);
                    }
                }
            }
        }
        if u.conflict { any_unified_conflict = true; }
        confidence_sum += u.confidence;
        confidence_n += 1;
    }

    // First / last seen.
    let mut sorted_dates: Vec<String> = dates.iter().map(|(d, _)| d.clone()).collect();
    sorted_dates.sort();
    let first_seen_date = sorted_dates.first().cloned();
    let last_seen_date = sorted_dates.last().cloned();
    // Pick the precision of whichever contribution drove `first_seen_date`.
    let date_precision = dates
        .iter()
        .find(|(d, _)| Some(d) == first_seen_date.as_ref())
        .and_then(|(_, p)| *p);

    let confidence = if confidence_n == 0 { 0.5 } else { confidence_sum / confidence_n as f32 };

    // Global assertion (weighted vote + special conflict rule).
    // We pass the underlying status set as well so the cross-doc
    // conflict flag fires whenever an affirmed-class mention was made
    // in ANY document — even if that document's intra-doc unification
    // already collapsed it under a stronger contradicted winner.
    let (global_assertion, conflict_across_documents) =
        resolve_global_assertion(&observed_statuses, &underlying_statuses);

    // Distinct docs contributing this concept (for stability_score).
    let docs_with_event = source_document_ids_set.len() as u32;
    let stability_score = compute_stability_score(
        docs_with_event,
        total_docs,
        conflict_across_documents || any_unified_conflict,
        &observed_statuses,
    );

    let merged_status_set: Vec<&'static str> = {
        let mut seen: std::collections::BTreeSet<&'static str> = std::collections::BTreeSet::new();
        for s in &observed_statuses {
            seen.insert(s.as_str());
        }
        seen.into_iter().collect()
    };

    let source_document_ids: Vec<String> = source_document_ids_set.into_iter().collect();
    let source_sections: Vec<String> = source_sections_set.into_iter().collect();

    let metadata = serde_json::json!({
        "merged_status_set":          merged_status_set,
        "conflict_across_documents":  conflict_across_documents,
        "any_unified_conflict":       any_unified_conflict,
        "docs_with_event":            docs_with_event,
        "total_docs":                 total_docs,
        "normalised_concept":         normalised_concept,
    });

    PatientEvent {
        patient_event_id,
        event_type,
        concept: display_concept,
        first_seen_date,
        last_seen_date,
        date_precision,
        documents,
        total_occurrences,
        global_assertion,
        source_unified_event_ids,
        source_document_ids,
        source_sections,
        participants,
        confidence,
        stability_score,
        related_patient_events: Vec::new(),
        metadata,
    }
}

// ── Cross-document linking ──────────────────────────────────────────────

fn populate_related_events(patient_events: &mut [PatientEvent]) {
    // Snapshot the (concept -> [(idx, event_type)]) index for quick lookup.
    use std::collections::BTreeMap;
    let mut by_concept: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, p) in patient_events.iter().enumerate() {
        let key = p
            .metadata
            .get("normalised_concept")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| normalise_concept(&p.concept));
        by_concept.entry(key).or_default().push(i);
    }

    // Concepts where ANY contributor was contradicted across docs.
    let contradicted_concepts: std::collections::HashSet<String> = patient_events
        .iter()
        .filter(|p| p.global_assertion == AssertionStatus::Contradicted
            || p.metadata.get("conflict_across_documents").and_then(|v| v.as_bool()) == Some(true))
        .map(|p| p.metadata.get("normalised_concept").and_then(|v| v.as_str()).map(str::to_string).unwrap_or_default())
        .filter(|s| !s.is_empty())
        .collect();

    let ids: Vec<String> = patient_events.iter().map(|p| p.patient_event_id.clone()).collect();
    let event_types: Vec<EventType> = patient_events.iter().map(|p| p.event_type).collect();

    for (i, p) in patient_events.iter_mut().enumerate() {
        let mut linked: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let key = p
            .metadata
            .get("normalised_concept")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| normalise_concept(&p.concept));

        let same_concept_peers: &[usize] = by_concept.get(&key).map(|v| v.as_slice()).unwrap_or(&[]);

        // Rule 1: same concept, different event_type.
        for &j in same_concept_peers {
            if j == i { continue; }
            if event_types[j] != p.event_type {
                linked.insert(ids[j].clone());
            }
        }

        // Rule 2: triad — when ALL three of {Diagnosis, MedicationMention,
        // Symptom} are present for the same concept, fully connect them.
        // Rule 1 already covers this for any 2 of 3; rule 2 makes the
        // fully-connected nature explicit and handles the case where the
        // same concept also appears as other event_types (Procedure etc.)
        // by ensuring at least the dx/med/symptom edges are present.
        let has_dx     = same_concept_peers.iter().any(|&j| event_types[j] == EventType::Diagnosis);
        let has_med    = same_concept_peers.iter().any(|&j| event_types[j] == EventType::MedicationMention);
        let has_symptom = same_concept_peers.iter().any(|&j| event_types[j] == EventType::Symptom);
        if has_dx && has_med && has_symptom {
            for &j in same_concept_peers {
                if j == i { continue; }
                if matches!(event_types[j],
                    EventType::Diagnosis | EventType::MedicationMention | EventType::Symptom)
                {
                    linked.insert(ids[j].clone());
                }
            }
        }

        // Rule 3: any cross-doc contradiction on this concept fans out
        // to every other PatientEvent sharing the concept (this expands
        // the link set when an unrelated event_type, e.g. an
        // InvestigationMention for "ptsd", exists alongside the
        // contradicted diagnosis).
        if contradicted_concepts.contains(&key) {
            for &j in same_concept_peers {
                if j == i { continue; }
                linked.insert(ids[j].clone());
            }
        }

        p.related_patient_events = linked.into_iter().collect();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Normalise a concept string the same way as `event_unification` —
/// keeping the layers compatible so PatientEvent.normalised_concept ==
/// UnifiedEvent.normalised_concept.
fn normalise_concept(s: &str) -> String {
    let lower = s.to_lowercase();
    let trimmed = lower.trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '-');
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn pick_display_concept(
    contributions: &[(String, UnifiedEvent)],
    fallback: &str,
) -> String {
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for (_, u) in contributions {
        *counts.entry(u.concept.clone()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(c, _)| c)
        .unwrap_or_else(|| fallback.to_string())
}

/// Weighted global-assertion resolver.
///
/// Weights (per spec):
///   contradicted = -3
///   negated      = -2
///   differential = -1
///   queried      =  0
///   historical   = +1
///   symptom_only = +1
///   affirmed     = +2
///
/// Then:
///   score >=  1  → Affirmed
///   score ==  0  → Queried
///   score <= -1  → Contradicted
///
/// Special: if BOTH affirmed-class AND contradicted-class statuses are
/// present, global_assertion = Contradicted AND conflict_across_documents
/// = true.
fn resolve_global_assertion(
    statuses: &[AssertionStatus],
    underlying: &std::collections::BTreeSet<AssertionStatus>,
) -> (AssertionStatus, bool) {
    let mut score: i32 = 0;
    for s in statuses {
        match *s {
            AssertionStatus::Contradicted => { score -= 3; }
            AssertionStatus::Negated      => { score -= 2; }
            AssertionStatus::Differential => { score -= 1; }
            AssertionStatus::Queried      => { /* 0 */ }
            AssertionStatus::Historical   => { score += 1; }
            AssertionStatus::SymptomOnly  => { score += 1; }
            AssertionStatus::Affirmed     => { score += 2; }
        }
    }
    // `conflict_across_documents` looks at the FULL status union — the
    // per-doc winners plus everything inside each contributing UE's
    // `merged_status_set`. This catches the case where doc-level
    // unification already collapsed an affirmed mention under a
    // stronger contradicted winner: at the patient layer, both claims
    // were still made somewhere in the corpus.
    let class_has_affirmed = underlying.iter().any(|s| matches!(s,
        AssertionStatus::Affirmed | AssertionStatus::Historical | AssertionStatus::SymptomOnly));
    let class_has_contradicted = underlying.iter().any(|s| matches!(s,
        AssertionStatus::Contradicted | AssertionStatus::Negated));
    let conflict = class_has_affirmed && class_has_contradicted;
    if conflict {
        return (AssertionStatus::Contradicted, true);
    }
    let resolved = if score >= 1 {
        AssertionStatus::Affirmed
    } else if score == 0 {
        AssertionStatus::Queried
    } else {
        AssertionStatus::Contradicted
    };
    (resolved, false)
}

/// stability_score = docs_with_event / total_docs, then:
///   - subtract 0.2 if any contradiction (cross-doc or within-doc) exists
///   - subtract 0.1 if observations are ONLY queried/differential
/// Clamped to [0.0, 1.0].
fn compute_stability_score(
    docs_with_event: u32,
    total_docs: u32,
    any_contradiction: bool,
    statuses: &[AssertionStatus],
) -> f32 {
    if total_docs == 0 {
        return 0.0;
    }
    let mut s = docs_with_event as f32 / total_docs as f32;
    if any_contradiction {
        s -= 0.2;
    }
    let only_queried_or_differential = !statuses.is_empty()
        && statuses.iter().all(|x| matches!(x,
            AssertionStatus::Queried | AssertionStatus::Differential));
    if only_queried_or_differential {
        s -= 0.1;
    }
    s.clamp(0.0, 1.0)
}

// ── Output shape (future-ready container) ────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientTimelinePayload {
    pub patient_timeline: Vec<PatientEvent>,
    /// Cluster scaffold — empty for now. Reserved for the future cluster
    /// layer (concept + event_types + documents_involved + conflict).
    pub clusters: Vec<JsonValue>,
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::{
        AssertionStatus, DatePrecision, EventParticipant, EventType,
    };

    fn ue(
        canonical: &str,
        event_type: EventType,
        concept: &str,
        assertion: AssertionStatus,
        primary_date: Option<(&str, DatePrecision)>,
        sections: &[&str],
        conflict: bool,
        participants: &[(&str, &str)],
    ) -> UnifiedEvent {
        UnifiedEvent {
            canonical_id: canonical.to_string(),
            event_type,
            concept: concept.to_string(),
            primary_date: primary_date.map(|(d, _)| d.to_string()),
            date_range: None,
            date_precision: primary_date.map(|(_, p)| p),
            assertion,
            source_event_ids: vec![format!("{canonical}-src")],
            source_sections: sections.iter().map(|s| s.to_string()).collect(),
            source_snippets: vec![format!("snippet for {concept}")],
            participants: participants
                .iter()
                .map(|(r, n)| EventParticipant { role: r.to_string(), name: n.to_string() })
                .collect(),
            related_event_ids: Vec::new(),
            confidence: 0.5,
            frequency: 1,
            conflict,
            metadata: serde_json::json!({}),
        }
    }

    // ─── 1. Cross-document dedup ─────────────────────────────────────
    #[test]
    fn cross_document_dedup_three_docs_same_concept_yields_one_event() {
        let doc_a = vec![ue("dx#ptsd", EventType::Diagnosis, "PTSD", AssertionStatus::Affirmed, None, &[], false, &[])];
        let doc_b = vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed, None, &[], false, &[])];
        let doc_c = vec![ue("dx#ptsd", EventType::Diagnosis, "Ptsd",  AssertionStatus::Affirmed, None, &[], false, &[])];
        let timeline = build_patient_timeline_from_unified(vec![
            ("docA".into(), doc_a),
            ("docB".into(), doc_b),
            ("docC".into(), doc_c),
        ]);
        let dx: Vec<_> = timeline.iter().filter(|e| e.event_type == EventType::Diagnosis).collect();
        assert_eq!(dx.len(), 1, "expected one patient event; got {:?}", timeline);
        let p = dx[0];
        assert_eq!(p.documents.len(), 3);
        assert_eq!(p.source_document_ids.len(), 3);
        assert!(p.source_unified_event_ids.iter().all(|id| id == "dx#ptsd"),
            "all sources should map to the unified canonical: {:?}", p.source_unified_event_ids);
    }

    // ─── 2. Temporal merge across docs ────────────────────────────────
    #[test]
    fn temporal_merge_across_docs_computes_first_and_last() {
        let doc_a = vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
            AssertionStatus::Affirmed, Some(("2020-03-12", DatePrecision::Day)), &[], false, &[])];
        let doc_b = vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
            AssertionStatus::Affirmed, Some(("2023-11-01", DatePrecision::Day)), &[], false, &[])];
        let doc_c = vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
            AssertionStatus::Affirmed, Some(("2021-06-04", DatePrecision::Day)), &[], false, &[])];
        let tl = build_patient_timeline_from_unified(vec![
            ("docA".into(), doc_a), ("docB".into(), doc_b), ("docC".into(), doc_c),
        ]);
        let p = tl.iter().find(|e| e.event_type == EventType::Diagnosis).unwrap();
        assert_eq!(p.first_seen_date.as_deref(), Some("2020-03-12"));
        assert_eq!(p.last_seen_date.as_deref(),  Some("2023-11-01"));
    }

    // ─── 3. Contradiction across docs ─────────────────────────────────
    #[test]
    fn contradiction_across_docs_resolves_to_contradicted_with_flag() {
        let doc_a = vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
            AssertionStatus::Affirmed, None, &[], false, &[])];
        let doc_b = vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
            AssertionStatus::Contradicted, None, &[], false, &[])];
        let tl = build_patient_timeline_from_unified(vec![
            ("docA".into(), doc_a), ("docB".into(), doc_b),
        ]);
        let p = tl.iter().find(|e| e.event_type == EventType::Diagnosis).unwrap();
        assert_eq!(p.global_assertion, AssertionStatus::Contradicted,
            "affirmed + contradicted must resolve to Contradicted: {:?}", p);
        assert_eq!(
            p.metadata.get("conflict_across_documents").and_then(|v| v.as_bool()),
            Some(true),
            "conflict_across_documents must be true: {:?}", p.metadata
        );
    }

    // ─── 4. Stability score ───────────────────────────────────────────
    #[test]
    fn stability_score_three_of_five_documents_is_0_6() {
        let mut docs: Vec<(String, Vec<UnifiedEvent>)> = Vec::new();
        // Three docs HAVE the concept, two don't.
        for d in ["docA", "docB", "docC"] {
            docs.push((d.into(), vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
                AssertionStatus::Affirmed, None, &[], false, &[])]));
        }
        // The other two docs are present but contain a different concept.
        for d in ["docD", "docE"] {
            docs.push((d.into(), vec![ue("dx#mdd", EventType::Diagnosis, "mdd",
                AssertionStatus::Affirmed, None, &[], false, &[])]));
        }
        let tl = build_patient_timeline_from_unified(docs);
        let ptsd = tl.iter().find(|e| e.concept.to_lowercase() == "ptsd").unwrap();
        // 3/5 = 0.6 (no contradiction penalty).
        assert!((ptsd.stability_score - 0.6).abs() < 1e-5,
            "expected stability 0.6 for 3/5 docs, got {}", ptsd.stability_score);
    }

    #[test]
    fn stability_score_drops_when_contradiction_present() {
        let mut docs: Vec<(String, Vec<UnifiedEvent>)> = Vec::new();
        for d in ["docA", "docB"] {
            docs.push((d.into(), vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
                AssertionStatus::Affirmed, None, &[], false, &[])]));
        }
        docs.push(("docC".into(), vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
            AssertionStatus::Contradicted, None, &[], false, &[])]));
        for d in ["docD", "docE"] {
            docs.push((d.into(), Vec::new()));
        }
        let tl = build_patient_timeline_from_unified(docs);
        let ptsd = tl.iter().find(|e| e.concept.to_lowercase() == "ptsd").unwrap();
        // 3/5 base = 0.6; cross-doc contradiction → -0.2 → 0.4
        assert!((ptsd.stability_score - 0.4).abs() < 1e-5,
            "expected stability 0.4 after contradiction penalty, got {}", ptsd.stability_score);
        // Global assertion must reflect the cross-doc contradiction.
        assert_eq!(ptsd.global_assertion, AssertionStatus::Contradicted);
    }

    // ─── 5. Triad linking: medication ↔ diagnosis ↔ symptom ──────────
    #[test]
    fn triad_med_dx_symptom_fully_connected_on_same_concept() {
        let doc_a = vec![
            ue("dx#ptsd",  EventType::Diagnosis,          "ptsd", AssertionStatus::Affirmed,     None, &[], false, &[]),
            ue("med#ptsd", EventType::MedicationMention,  "ptsd", AssertionStatus::Affirmed,     None, &[], false, &[]),
            ue("sym#ptsd", EventType::Symptom,            "ptsd", AssertionStatus::SymptomOnly,  None, &[], false, &[]),
        ];
        let tl = build_patient_timeline_from_unified(vec![("docA".into(), doc_a)]);
        let dx  = tl.iter().find(|e| e.event_type == EventType::Diagnosis).unwrap();
        let med = tl.iter().find(|e| e.event_type == EventType::MedicationMention).unwrap();
        let sym = tl.iter().find(|e| e.event_type == EventType::Symptom).unwrap();
        // Each must list the other two.
        for (a, b, label) in [(dx, med, "dx->med"), (dx, sym, "dx->sym"),
                              (med, dx, "med->dx"), (med, sym, "med->sym"),
                              (sym, dx, "sym->dx"), (sym, med, "sym->med")]
        {
            assert!(a.related_patient_events.contains(&b.patient_event_id),
                "{label}: expected {} in {:?}", b.patient_event_id, a.related_patient_events);
        }
    }

    // ─── Reversibility ────────────────────────────────────────────────
    #[test]
    fn reversibility_every_patient_event_lists_sources() {
        let doc_a = vec![
            ue("dx#anxiety", EventType::Diagnosis, "anxiety", AssertionStatus::Affirmed, None, &[], false, &[]),
            ue("sym#low_mood", EventType::Symptom, "low mood", AssertionStatus::SymptomOnly, None, &[], false, &[]),
        ];
        let doc_b = vec![
            ue("sym#low_mood", EventType::Symptom, "low mood", AssertionStatus::SymptomOnly, None, &[], false, &[]),
        ];
        let tl = build_patient_timeline_from_unified(vec![
            ("docA".into(), doc_a), ("docB".into(), doc_b),
        ]);
        for p in &tl {
            assert!(!p.source_unified_event_ids.is_empty(),
                "every PatientEvent must list at least one source unified id: {:?}", p);
            assert!(!p.source_document_ids.is_empty(),
                "every PatientEvent must list at least one source document: {:?}", p);
        }
    }

    // ─── Sort order ──────────────────────────────────────────────────
    #[test]
    fn output_sorted_by_first_seen_then_stability() {
        let doc_a = vec![ue("dx#ptsd", EventType::Diagnosis, "ptsd",
            AssertionStatus::Affirmed, Some(("2021-01-01", DatePrecision::Day)), &[], false, &[])];
        let doc_b = vec![ue("dx#mdd", EventType::Diagnosis, "mdd",
            AssertionStatus::Affirmed, Some(("2019-06-15", DatePrecision::Day)), &[], false, &[])];
        let tl = build_patient_timeline_from_unified(vec![
            ("docA".into(), doc_a), ("docB".into(), doc_b),
        ]);
        // MDD has the earlier first_seen → must come first.
        assert!(tl[0].concept.to_lowercase() == "mdd",
            "earliest first_seen should sort first; got {:?}",
            tl.iter().map(|p| (&p.concept, &p.first_seen_date)).collect::<Vec<_>>());
    }
}
