//! Event Unification Layer.
//!
//! Post-processing aggregator. Takes the flat `ClinicalEvent` records
//! emitted by `clinical_events::build_events` and produces a smaller
//! set of `UnifiedEvent` records — one per (event_type, normalised
//! concept) — that:
//!
//!   * Resolves multiple `AssertionStatus` values into a single
//!     winner using a priority order, AND explicitly marks `conflict`
//!     when both affirmed and contradicted sources exist.
//!   * Merges temporal information into a primary date + optional
//!     range, preferring the most precise source.
//!   * Aggregates source sections, snippets, and participants.
//!   * Computes lightweight `related_event_ids` cross-links (same
//!     concept across types, medication↔symptom within section,
//!     contradicted-concept fan-out).
//!
//! This module is strictly additive: it never mutates the input
//! events. Callers continue to emit `clinical_events`; this layer
//! adds `unified_clinical_events` to the canonical payload.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::clinical_events::{
    AssertionStatus, ClinicalEvent, DatePrecision, EventParticipant, EventType,
};

// ── UnifiedEvent ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedEvent {
    /// Stable id: `{event_type}#{normalised_concept}`.
    pub canonical_id: String,

    pub event_type: EventType,
    pub concept: String,

    /// Most-precise representative date across all source events.
    pub primary_date: Option<String>,
    /// (earliest, latest) when at least two distinct dates contribute.
    pub date_range: Option<(String, String)>,
    pub date_precision: Option<DatePrecision>,

    /// Winning assertion after priority resolution.
    pub assertion: AssertionStatus,

    /// `event_id`s of the raw events merged in. Order is the order in
    /// which they were seen.
    pub source_event_ids: Vec<String>,
    pub source_sections: Vec<String>,
    pub source_snippets: Vec<String>,

    pub participants: Vec<EventParticipant>,

    /// Cross-links to other UnifiedEvent.canonical_ids.
    pub related_event_ids: Vec<String>,

    /// Averaged from per-event metadata.confidence when present;
    /// otherwise 0.5.
    pub confidence: f32,
    pub frequency: u32,

    /// True iff both an affirmed-class and a contradicted-class source
    /// exist for this concept (rule from STEP 2 §2).
    pub conflict: bool,

    /// Open-ended metadata. Currently holds: `merged_status_set` (all
    /// distinct statuses observed) and `event_source_ids` mirror.
    pub metadata: JsonValue,
}

// ── Unification entry point ──────────────────────────────────────────────

/// Group `events` by (event_type, normalised concept) and produce one
/// `UnifiedEvent` per group. Cross-links are populated in a second pass
/// once all groups exist.
pub fn unify_events(events: Vec<ClinicalEvent>) -> Vec<UnifiedEvent> {
    use std::collections::BTreeMap;

    // 1. Group by (event_type, normalised concept). BTreeMap so output
    //    order is deterministic.
    let mut groups: BTreeMap<(EventType, String), Vec<ClinicalEvent>> = BTreeMap::new();
    for ev in events {
        let key = (ev.event_type, normalise_concept(&ev.concept));
        groups.entry(key).or_default().push(ev);
    }

    // 2. Build a UnifiedEvent per group.
    let mut unified: Vec<UnifiedEvent> =
        groups.into_iter().map(|((t, n), evs)| build_unified(t, n, evs)).collect();

    // 3. Cross-link in a second pass — needs the full set so links can
    //    target canonical_ids that don't exist until step 2 completes.
    let canonical_index: std::collections::HashMap<String, usize> =
        unified.iter().enumerate().map(|(i, u)| (u.canonical_id.clone(), i)).collect();

    let snapshot = unified.clone();
    for u in unified.iter_mut() {
        let mut linked: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

        // Rule 1: same normalised concept, different event_type.
        let my_concept_norm = normalise_concept(&u.concept);
        for v in &snapshot {
            if v.canonical_id == u.canonical_id {
                continue;
            }
            if v.event_type != u.event_type
                && normalise_concept(&v.concept) == my_concept_norm
            {
                linked.insert(v.canonical_id.clone());
            }
        }

        // Rule 2: medication ↔ symptom co-occurrence in any shared section.
        let want_link_with =
            if u.event_type == EventType::MedicationMention { Some(EventType::Symptom) }
            else if u.event_type == EventType::Symptom        { Some(EventType::MedicationMention) }
            else { None };
        if let Some(target_type) = want_link_with {
            let my_sections: std::collections::HashSet<&str> =
                u.source_sections.iter().map(String::as_str).collect();
            for v in &snapshot {
                if v.event_type != target_type {
                    continue;
                }
                if v.source_sections.iter().any(|s| my_sections.contains(s.as_str())) {
                    linked.insert(v.canonical_id.clone());
                }
            }
        }

        // Rule 3: when a diagnosis is contradicted somewhere, fan-out
        //    its concept to every other event_type carrying the same
        //    concept (this overlaps rule 1 but explicitly records the
        //    cross-event-type relationship every time a contradiction
        //    exists, even if no participant/snippet linkage was found).
        if u.event_type == EventType::Diagnosis && u.conflict {
            for v in &snapshot {
                if v.canonical_id == u.canonical_id {
                    continue;
                }
                if normalise_concept(&v.concept) == my_concept_norm {
                    linked.insert(v.canonical_id.clone());
                }
            }
        }

        u.related_event_ids = linked.into_iter().collect();
        let _ = &canonical_index; // future: use for symmetric back-links
    }

    unified
}

// ── Per-group builder ────────────────────────────────────────────────────

fn build_unified(
    event_type: EventType,
    normalised_concept: String,
    sources: Vec<ClinicalEvent>,
) -> UnifiedEvent {
    let canonical_id = format!("{}#{}", event_type.as_str(), normalised_concept);

    // Choose a display concept from the most populous case-normalised
    // form among sources (preserves casing like "PTSD" if that's what
    // most sources spell).
    let display_concept = pick_display_concept(&sources, &normalised_concept);

    // Aggregate statuses (preserve None as a sentinel — only resolved
    // statuses participate in priority).
    let observed_statuses: Vec<Option<AssertionStatus>> =
        sources.iter().map(|s| s.assertion_status).collect();
    let (assertion, conflict) = resolve_assertion(&observed_statuses);
    let merged_status_set: Vec<&'static str> = {
        let mut seen: std::collections::BTreeSet<&'static str> = std::collections::BTreeSet::new();
        for s in observed_statuses.iter().flatten() {
            seen.insert(s.as_str());
        }
        seen.into_iter().collect()
    };

    // Temporal merge.
    let date_specs: Vec<(String, Option<DatePrecision>)> = sources
        .iter()
        .filter_map(|s| s.date.clone().map(|d| (d, s.date_precision)))
        .collect();
    let (primary_date, date_range, date_precision) = merge_temporal(&date_specs);

    // Section + snippet merge (dedup, preserve seen-order).
    let source_sections =
        dedup_preserve_order(sources.iter().filter_map(|s| s.source_section.clone()));
    let source_snippets =
        dedup_preserve_order(sources.iter().map(|s| s.source_snippet.clone()).filter(|s| !s.is_empty()));

    // Participant merge by (role, name).
    let mut participants: Vec<EventParticipant> = Vec::new();
    let mut seen_participants: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();
    for s in &sources {
        for p in &s.participants {
            let key = (p.role.clone(), p.name.clone());
            if seen_participants.insert(key) {
                participants.push(p.clone());
            }
        }
    }

    // Frequency + confidence.
    let frequency = sources.len() as u32;
    let confidence = average_confidence(&sources);

    let source_event_ids: Vec<String> = sources.iter().map(|s| s.event_id.clone()).collect();

    let metadata = serde_json::json!({
        "merged_status_set": merged_status_set,
        "event_source_ids": source_event_ids,
        "normalised_concept": normalised_concept,
    });

    UnifiedEvent {
        canonical_id,
        event_type,
        concept: display_concept,
        primary_date,
        date_range,
        date_precision,
        assertion,
        source_event_ids,
        source_sections,
        source_snippets,
        participants,
        related_event_ids: Vec::new(), // filled in second pass
        confidence,
        frequency,
        conflict,
        metadata,
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Normalise a concept string: lowercase, collapse internal whitespace,
/// strip surrounding punctuation. Used as the dedup key — also lives in
/// canonical_id, so two events with the same medical meaning collapse.
fn normalise_concept(s: &str) -> String {
    let lower = s.to_lowercase();
    let trimmed = lower.trim_matches(|c: char| {
        !c.is_alphanumeric() && c != '/' && c != '-'
    });
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Pick the most-seen casing variant for display purposes.
fn pick_display_concept(sources: &[ClinicalEvent], normalised: &str) -> String {
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for s in sources {
        *counts.entry(s.concept.clone()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(c, _)| c)
        .unwrap_or_else(|| normalised.to_string())
}

/// Assertion priority order (strongest first):
///   contradicted > negated > differential > queried > historical >
///   symptom_only > affirmed
fn assertion_priority(a: AssertionStatus) -> u8 {
    match a {
        AssertionStatus::Contradicted => 6,
        AssertionStatus::Negated      => 5,
        AssertionStatus::Differential => 4,
        AssertionStatus::Queried      => 3,
        AssertionStatus::Historical   => 2,
        AssertionStatus::SymptomOnly  => 1,
        AssertionStatus::Affirmed     => 0,
    }
}

/// Resolve a set of observed statuses into a single winner.
/// Returns (winner, conflict_flag).
///
/// `conflict` fires when BOTH an affirmed-class status (affirmed,
/// historical, symptom_only) AND a contradicted-class status
/// (contradicted, negated) are present. Queried/differential alone do
/// not raise the conflict flag — they are simply unresolved diagnostic
/// hypotheses, not opposed assertions.
fn resolve_assertion(
    statuses: &[Option<AssertionStatus>],
) -> (AssertionStatus, bool) {
    let mut winner: Option<AssertionStatus> = None;
    let mut has_affirmed_class = false;
    let mut has_contradicted_class = false;
    for s in statuses.iter().flatten() {
        match *s {
            AssertionStatus::Affirmed
            | AssertionStatus::Historical
            | AssertionStatus::SymptomOnly => has_affirmed_class = true,
            AssertionStatus::Contradicted
            | AssertionStatus::Negated => has_contradicted_class = true,
            _ => {}
        }
        winner = Some(match winner {
            None => *s,
            Some(w) if assertion_priority(*s) > assertion_priority(w) => *s,
            Some(w) => w,
        });
    }
    let conflict = has_affirmed_class && has_contradicted_class;
    // Default to Affirmed when no source had a status — this is the
    // weakest position in the priority order and matches our existing
    // "if in doubt, treat as a plain mention" stance.
    let resolved = winner.unwrap_or(AssertionStatus::Affirmed);
    (resolved, conflict)
}

/// Pick the most-precise ISO date as `primary_date` and (when at least
/// two distinct dates contribute) compute a (min, max) `date_range`.
fn merge_temporal(
    specs: &[(String, Option<DatePrecision>)],
) -> (Option<String>, Option<(String, String)>, Option<DatePrecision>) {
    if specs.is_empty() {
        return (None, None, None);
    }
    let precision_rank = |p: Option<DatePrecision>| -> u8 {
        match p {
            Some(DatePrecision::Day)   => 3,
            Some(DatePrecision::Month) => 2,
            Some(DatePrecision::Year)  => 1,
            None                       => 0,
        }
    };
    // primary_date — highest-rank precision; among equal precisions, the
    // earliest by lexicographic ISO order is picked (stable).
    let mut best_idx = 0;
    for (i, s) in specs.iter().enumerate() {
        let cur_rank = precision_rank(specs[best_idx].1);
        let new_rank = precision_rank(s.1);
        if new_rank > cur_rank || (new_rank == cur_rank && s.0 < specs[best_idx].0) {
            best_idx = i;
        }
    }
    let primary = specs[best_idx].0.clone();
    let primary_precision = specs[best_idx].1;

    let mut sorted: Vec<String> = specs.iter().map(|(d, _)| d.clone()).collect();
    sorted.sort();
    sorted.dedup();
    let range = if sorted.len() >= 2 {
        Some((sorted.first().unwrap().clone(), sorted.last().unwrap().clone()))
    } else {
        None
    };
    (Some(primary), range, primary_precision)
}

/// Dedup while preserving the order each item was first observed.
fn dedup_preserve_order<I>(items: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for s in items {
        if seen.insert(s.clone()) {
            out.push(s);
        }
    }
    out
}

fn average_confidence(sources: &[ClinicalEvent]) -> f32 {
    let mut sum = 0.0_f32;
    let mut n = 0_u32;
    for s in sources {
        if let Some(c) = s.metadata.get("confidence").and_then(|v| v.as_f64()) {
            sum += c as f32;
            n += 1;
        }
    }
    if n == 0 { 0.5 } else { sum / n as f32 }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::{
        AssertionStatus, ClinicalEvent, DatePrecision, EventParticipant, EventType,
    };

    fn ev(
        id: &str,
        event_type: EventType,
        concept: &str,
        status: Option<AssertionStatus>,
        section: Option<&str>,
        date: Option<(&str, DatePrecision)>,
    ) -> ClinicalEvent {
        ClinicalEvent {
            event_id: id.to_string(),
            event_type,
            concept: concept.to_string(),
            raw_concept: concept.to_string(),
            date: date.map(|(d, _)| d.to_string()),
            date_precision: date.map(|(_, p)| p),
            assertion_status: status,
            source_document_id: "doc".to_string(),
            source_section: section.map(str::to_string),
            source_snippet: format!("snippet for {concept}"),
            // Test fixture: snippet integrity is not enforced inside
            // event_unification tests — these synthetic events do not
            // carry a real `clean_text`. Offsets are zeroed.
            char_offset_start: 0,
            char_offset_end: 0,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({}),
        }
    }

    // ─── 1. Deduplication ─────────────────────────────────────────────
    #[test]
    fn dedup_same_concept_five_times_yields_one_unified_event() {
        let mut events = Vec::new();
        for i in 0..5 {
            events.push(ev(
                &format!("e{i}"),
                EventType::Diagnosis,
                "PTSD",
                Some(AssertionStatus::Affirmed),
                None,
                None,
            ));
        }
        let unified = unify_events(events);
        let diagnoses: Vec<_> = unified
            .iter()
            .filter(|u| u.event_type == EventType::Diagnosis)
            .collect();
        assert_eq!(diagnoses.len(), 1, "expected one unified event: {:?}", unified);
        assert_eq!(diagnoses[0].frequency, 5);
        assert_eq!(diagnoses[0].source_event_ids.len(), 5);
    }

    // ─── 2. Assertion priority + conflict flag ────────────────────────
    #[test]
    fn assertion_priority_contradicted_wins_with_conflict_flag() {
        let events = vec![
            ev("e1", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed),     None, None),
            ev("e2", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Contradicted), None, None),
            ev("e3", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Differential), None, None),
        ];
        let unified = unify_events(events);
        assert_eq!(unified.len(), 1);
        let u = &unified[0];
        assert_eq!(u.assertion, AssertionStatus::Contradicted,
            "contradicted must win the priority: {:?}", u);
        assert!(u.conflict,
            "affirmed + contradicted must set conflict=true; got conflict={}", u.conflict);
        let merged: Vec<&str> = u.metadata["merged_status_set"]
            .as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert!(merged.contains(&"affirmed"));
        assert!(merged.contains(&"contradicted"));
        assert!(merged.contains(&"differential"));
    }

    #[test]
    fn assertion_priority_queried_only_does_not_set_conflict() {
        let events = vec![
            ev("e1", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Queried),  None, None),
            ev("e2", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed), None, None),
        ];
        let unified = unify_events(events);
        let u = &unified[0];
        assert_eq!(u.assertion, AssertionStatus::Queried);
        assert!(!u.conflict, "queried+affirmed is not a conflict");
    }

    // ─── 3. Temporal merge ────────────────────────────────────────────
    #[test]
    fn temporal_merge_chooses_most_precise_and_computes_range() {
        let events = vec![
            ev("e1", EventType::DocumentDate, "2022", None, None, Some(("2022", DatePrecision::Year))),
            ev("e2", EventType::DocumentDate, "2022-05-10", None, None, Some(("2022-05-10", DatePrecision::Day))),
            ev("e3", EventType::DocumentDate, "2023-03", None, None, Some(("2023-03", DatePrecision::Month))),
        ];
        let unified = unify_events(events);
        // Each is a distinct concept (different value) → three groups.
        // Combine into one group by giving them the same concept instead.
        let same_concept = vec![
            ev("a", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed), None, Some(("2022",        DatePrecision::Year))),
            ev("b", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed), None, Some(("2022-05-10",  DatePrecision::Day))),
            ev("c", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed), None, Some(("2023-03",     DatePrecision::Month))),
        ];
        let merged = unify_events(same_concept);
        assert_eq!(merged.len(), 1);
        let u = &merged[0];
        assert_eq!(u.primary_date.as_deref(), Some("2022-05-10"),
            "day precision should win: {:?}", u);
        assert_eq!(u.date_precision, Some(DatePrecision::Day));
        assert_eq!(u.date_range.as_ref().map(|(a, b)| (a.as_str(), b.as_str())),
                   Some(("2022", "2023-03")));
        // Just touch the other variable so compiler doesn't whine.
        assert!(!unified.is_empty());
    }

    // ─── 4. Cross-event linking ───────────────────────────────────────
    #[test]
    fn cross_link_diagnosis_to_symptom_with_same_concept() {
        let events = vec![
            ev("e1", EventType::Diagnosis, "anxiety", Some(AssertionStatus::Affirmed),    None, None),
            ev("e2", EventType::Symptom,   "anxiety", Some(AssertionStatus::SymptomOnly), None, None),
        ];
        let unified = unify_events(events);
        let dx  = unified.iter().find(|u| u.event_type == EventType::Diagnosis).unwrap();
        let sym = unified.iter().find(|u| u.event_type == EventType::Symptom).unwrap();
        assert!(dx.related_event_ids.contains(&sym.canonical_id),
            "diagnosis should link to symptom: {:?}", dx.related_event_ids);
        assert!(sym.related_event_ids.contains(&dx.canonical_id),
            "symptom should link to diagnosis: {:?}", sym.related_event_ids);
    }

    #[test]
    fn cross_link_med_and_symptom_in_same_section() {
        let events = vec![
            ev("e1", EventType::MedicationMention, "sertraline", Some(AssertionStatus::Affirmed),    Some("Treating Psychologist"), None),
            ev("e2", EventType::Symptom,           "anxiety",    Some(AssertionStatus::SymptomOnly), Some("Treating Psychologist"), None),
        ];
        let unified = unify_events(events);
        let med = unified.iter().find(|u| u.event_type == EventType::MedicationMention).unwrap();
        let sym = unified.iter().find(|u| u.event_type == EventType::Symptom).unwrap();
        assert!(med.related_event_ids.contains(&sym.canonical_id),
            "medication should link to symptom via shared section: {:?}", med);
        assert!(sym.related_event_ids.contains(&med.canonical_id),
            "symptom should link back to medication: {:?}", sym);
    }

    #[test]
    fn contradicted_diagnosis_fans_out_to_same_concept() {
        let events = vec![
            ev("e1", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed),     None, None),
            ev("e2", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Contradicted), None, None),
            ev("e3", EventType::Symptom,   "ptsd", Some(AssertionStatus::SymptomOnly),  None, None),
        ];
        let unified = unify_events(events);
        let dx = unified.iter().find(|u| u.event_type == EventType::Diagnosis).unwrap();
        assert!(dx.conflict, "ptsd diagnosis must be flagged as conflict");
        let sym = unified.iter().find(|u| u.event_type == EventType::Symptom).unwrap();
        assert!(dx.related_event_ids.contains(&sym.canonical_id),
            "contradicted diagnosis must fan out to symptom: {:?}", dx.related_event_ids);
    }

    // ─── 5. Frequency = raw count ─────────────────────────────────────
    #[test]
    fn frequency_equals_source_event_count() {
        let events = vec![
            ev("a", EventType::MedicationMention, "sertraline", Some(AssertionStatus::Affirmed), None, None),
            ev("b", EventType::MedicationMention, "sertraline", Some(AssertionStatus::Affirmed), None, None),
            ev("c", EventType::MedicationMention, "Sertraline", Some(AssertionStatus::Affirmed), None, None), // dedup via lowercase
            ev("d", EventType::MedicationMention, "Sertraline.", Some(AssertionStatus::Affirmed), None, None), // strip punct
        ];
        let unified = unify_events(events);
        assert_eq!(unified.len(), 1, "all four should collapse to one: {:?}", unified);
        assert_eq!(unified[0].frequency, 4);
        assert_eq!(unified[0].source_event_ids.len(), 4);
    }

    // ─── Helpers / sanity ─────────────────────────────────────────────
    #[test]
    fn participants_are_deduped_across_sources() {
        let mut e1 = ev("a", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed), None, None);
        e1.participants = vec![EventParticipant { role: "author".into(), name: "Dr Lewis".into() }];
        let mut e2 = ev("b", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed), None, None);
        e2.participants = vec![EventParticipant { role: "author".into(), name: "Dr Lewis".into() }];
        let mut e3 = ev("c", EventType::Diagnosis, "ptsd", Some(AssertionStatus::Affirmed), None, None);
        e3.participants = vec![EventParticipant { role: "psychologist".into(), name: "Dr Brown".into() }];
        let unified = unify_events(vec![e1, e2, e3]);
        let u = &unified[0];
        assert_eq!(u.participants.len(), 2, "two distinct (role,name) participants: {:?}", u.participants);
    }
}
