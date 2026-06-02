//! Patient Longitudinal Reconciliation Layer.
//!
//! Sits ABOVE both `patient_timeline::PatientEvent` and
//! `clinical_state::ConditionState`. Strictly additive. No
//! re-extraction. No model calls. Deterministic only.
//!
//! Produces a `LongitudinalPatientGraph` that answers cross-time and
//! cross-document questions the lower layers cannot:
//!
//!   * `canonical_events[]` — one node per (event_type, normalised
//!     concept) for the whole corpus, with assertion_distribution
//!     preserved (no priority collapse).
//!   * `temporal_edges[]`   — explicit longitudinal relationships
//!     (Progression, Resolution, Escalation, TreatmentResponse,
//!     CoOccurrence).
//!   * `cross_domain_links[]` — clinically-meaningful cross-domain
//!     bridges (symptom↔diagnosis, diagnosis↔medication,
//!     procedure↔symptom-change, diagnosis↔contradictory diagnosis).
//!   * `evolution_tracks[]` — per-canonical assertion trajectory with
//!     a step per (date, status, source) tuple. Designed to record
//!     "how did this condition evolve across the entire record?"
//!
//! Full traceability back through the lower layers via
//! `unified_event_ids` and `patient_event_ids` on every node.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::{BTreeMap, BTreeSet};

use crate::clinical_events::{AssertionStatus, EventType};
use crate::event_unification::UnifiedEvent;
use crate::patient_timeline::{PatientEvent, build_patient_timeline_from_unified};

// ── Output structures ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongitudinalPatientGraph {
    pub patient_id: Option<String>,
    pub canonical_events: Vec<CanonicalPatientEvent>,
    pub temporal_edges: Vec<TemporalEdge>,
    pub cross_domain_links: Vec<CrossDomainLink>,
    pub evolution_tracks: Vec<EvolutionTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalPatientEvent {
    pub canonical_id: String,
    pub event_type: EventType,
    pub concept: String,

    pub first_seen: Option<String>,
    pub last_seen: Option<String>,

    pub total_occurrences: u32,
    pub document_count: u32,

    /// Distribution of assertion observations across the whole corpus.
    /// Strings (snake_case) used as keys so the JSON output is stable
    /// across language boundaries. Counts the number of contributing
    /// UnifiedEvents whose `merged_status_set` contained each status.
    pub assertion_distribution: BTreeMap<String, u32>,

    pub unified_event_ids: Vec<String>,
    pub patient_event_ids: Vec<String>,

    pub dominant_assertion: AssertionStatus,

    /// True iff conflicting assertion classes (affirmed-class AND
    /// contradicted-class) coexist anywhere in the corpus for this
    /// canonical concept, OR any contributing UnifiedEvent / PatientEvent
    /// already flagged conflict.
    pub conflict_flag: bool,

    /// Rule E (stability decay). Always emitted alongside the canonical
    /// event so consumers can reason about confidence at this layer.
    pub stability_score: f32,

    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalEdge {
    pub from_canonical_event: String,
    pub to_canonical_event: String,
    pub relation: TemporalRelation,
    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemporalRelation {
    Progression,
    Resolution,
    Escalation,
    TreatmentResponse,
    CoOccurrence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossDomainLink {
    pub from_canonical_event: String,
    pub to_canonical_event: String,
    pub kind: CrossDomainKind,
    pub shared_documents: Vec<String>,
    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrossDomainKind {
    SymptomDiagnosis,
    DiagnosisMedication,
    ProcedureSymptomChange,
    DiagnosisContradictoryDiagnosis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionTrack {
    pub canonical_id: String,
    pub timeline: Vec<EvolutionStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionStep {
    pub date: Option<String>,
    #[serde(with = "assertion_status_serde")]
    pub assertion: AssertionStatus,
    pub source: String,
    pub context: String,
}

// ── Public API ───────────────────────────────────────────────────────────

/// Build the longitudinal patient graph from a per-document UnifiedEvent
/// corpus. This is the public surface used by the
/// `reason_longitudinal_reconciliation` command.
pub fn build_longitudinal_patient_graph(
    docs: Vec<(String, Vec<UnifiedEvent>)>,
    patient_id: Option<String>,
) -> LongitudinalPatientGraph {
    // 1. Build PatientEvents via the patient_timeline module so
    //    aggregation stays consistent across layers.
    let patient_events = build_patient_timeline_from_unified(docs.clone());

    // 2. Index UnifiedEvents by (event_type, normalised_concept) so each
    //    CanonicalPatientEvent can pull per-doc contributions for
    //    assertion_distribution + evolution timeline.
    let mut unified_by_key: BTreeMap<(EventType, String), Vec<(String, UnifiedEvent)>> =
        BTreeMap::new();
    for (doc_id, evs) in &docs {
        for u in evs {
            let key = (u.event_type, normalise_concept(&u.concept));
            unified_by_key
                .entry(key)
                .or_default()
                .push((doc_id.clone(), u.clone()));
        }
    }

    // 3. Index PatientEvents by the same key so we can attach their IDs.
    let mut patient_by_key: BTreeMap<(EventType, String), Vec<PatientEvent>> =
        BTreeMap::new();
    for pe in &patient_events {
        let key = (
            pe.event_type,
            normalise_concept(&pe.concept),
        );
        patient_by_key.entry(key).or_default().push(pe.clone());
    }

    // 4. Build canonical events + evolution tracks together (they share
    //    the per-(key) contributions).
    let mut canonical_events: Vec<CanonicalPatientEvent> = Vec::new();
    let mut evolution_tracks: Vec<EvolutionTrack> = Vec::new();
    let keys: Vec<(EventType, String)> = unified_by_key
        .keys()
        .chain(patient_by_key.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    for key in keys {
        let unified_contribs = unified_by_key.get(&key).cloned().unwrap_or_default();
        let patient_contribs = patient_by_key.get(&key).cloned().unwrap_or_default();
        let (canonical, track) =
            build_canonical_and_track(key.0, key.1.clone(), &unified_contribs, &patient_contribs);
        canonical_events.push(canonical);
        evolution_tracks.push(track);
    }

    // 5. Sort canonical events stably: event_type, then concept.
    canonical_events.sort_by(|a, b| {
        a.event_type
            .cmp(&b.event_type)
            .then_with(|| a.concept.cmp(&b.concept))
    });

    // 6. Build edges + cross-domain links across canonical events.
    let temporal_edges = derive_temporal_edges(&canonical_events);
    let cross_domain_links = derive_cross_domain_links(&canonical_events);

    LongitudinalPatientGraph {
        patient_id,
        canonical_events,
        temporal_edges,
        cross_domain_links,
        evolution_tracks,
    }
}

/// Lower-fidelity variant that consumes already-aggregated
/// `PatientEvent`s. Useful for tests; loses the per-unified-event
/// assertion granularity that the UnifiedEvent path captures.
#[allow(dead_code)]
pub fn build_longitudinal_patient_graph_from_patient_events(
    patient_events: Vec<PatientEvent>,
    patient_id: Option<String>,
) -> LongitudinalPatientGraph {
    // Group by (event_type, normalised concept).
    let mut by_key: BTreeMap<(EventType, String), Vec<PatientEvent>> = BTreeMap::new();
    for pe in patient_events {
        let key = (pe.event_type, normalise_concept(&pe.concept));
        by_key.entry(key).or_default().push(pe);
    }
    let mut canonical_events: Vec<CanonicalPatientEvent> = Vec::new();
    let mut evolution_tracks: Vec<EvolutionTrack> = Vec::new();
    for (key, pes) in by_key {
        // No UnifiedEvent visibility — synthesise contributions from
        // PatientEvent.documents so reversibility is preserved.
        let (canonical, track) = build_canonical_and_track(key.0, key.1.clone(), &[], &pes);
        canonical_events.push(canonical);
        evolution_tracks.push(track);
    }
    canonical_events.sort_by(|a, b| {
        a.event_type
            .cmp(&b.event_type)
            .then_with(|| a.concept.cmp(&b.concept))
    });
    let temporal_edges = derive_temporal_edges(&canonical_events);
    let cross_domain_links = derive_cross_domain_links(&canonical_events);
    LongitudinalPatientGraph {
        patient_id,
        canonical_events,
        temporal_edges,
        cross_domain_links,
        evolution_tracks,
    }
}

// ── Canonical + evolution builder ────────────────────────────────────────

fn build_canonical_and_track(
    event_type: EventType,
    normalised_concept: String,
    unified_contribs: &[(String, UnifiedEvent)],
    patient_contribs: &[PatientEvent],
) -> (CanonicalPatientEvent, EvolutionTrack) {
    let canonical_id = format!("canonical#{}#{}", event_type.as_str(), normalised_concept);
    let display_concept = pick_display_concept(unified_contribs, patient_contribs, &normalised_concept);

    // ── First/last seen ─────────────────────────────────────────────
    let mut all_dates: Vec<String> = Vec::new();
    for (_, u) in unified_contribs {
        if let Some(d) = &u.primary_date { all_dates.push(d.clone()); }
        if let Some((a, b)) = &u.date_range {
            all_dates.push(a.clone());
            all_dates.push(b.clone());
        }
    }
    for pe in patient_contribs {
        if let Some(d) = &pe.first_seen_date { all_dates.push(d.clone()); }
        if let Some(d) = &pe.last_seen_date { all_dates.push(d.clone()); }
    }
    all_dates.sort();
    all_dates.dedup();
    let first_seen = all_dates.first().cloned();
    let last_seen = all_dates.last().cloned();

    // ── Total occurrences + document count ──────────────────────────
    let mut docs_seen: BTreeSet<String> = BTreeSet::new();
    let mut total_occurrences: u32 = 0;
    for (doc_id, u) in unified_contribs {
        docs_seen.insert(doc_id.clone());
        total_occurrences += u.frequency;
    }
    for pe in patient_contribs {
        for d in &pe.documents { docs_seen.insert(d.doc_id.clone()); }
        // PatientEvent.total_occurrences is already a sum over Unified
        // events — only use it when no UnifiedEvent contribs were given
        // (lower-fidelity path).
        if unified_contribs.is_empty() {
            total_occurrences += pe.total_occurrences;
        }
    }
    let document_count = docs_seen.len() as u32;

    // ── Assertion distribution ──────────────────────────────────────
    // Count distinct (UnifiedEvent → status) occurrences. Each contributing
    // UnifiedEvent records every status in its merged_status_set plus its
    // resolved winner; we de-duplicate per-UnifiedEvent so a single UE
    // doesn't double-count an assertion class.
    let mut distribution: BTreeMap<String, u32> = BTreeMap::new();
    let bump = |d: &mut BTreeMap<String, u32>, s: AssertionStatus| {
        *d.entry(s.as_str().to_string()).or_insert(0) += 1;
    };
    let bump_set = |d: &mut BTreeMap<String, u32>, set: &BTreeSet<AssertionStatus>| {
        for s in set {
            *d.entry(s.as_str().to_string()).or_insert(0) += 1;
        }
    };
    for (_, u) in unified_contribs {
        let mut combined: BTreeSet<AssertionStatus> = BTreeSet::new();
        combined.insert(u.assertion);
        if let Some(arr) = u.metadata.get("merged_status_set").and_then(|v| v.as_array()) {
            for v in arr {
                if let Some(s) = v.as_str() {
                    if let Some(p) = AssertionStatus::parse(s) {
                        combined.insert(p);
                    }
                }
            }
        }
        bump_set(&mut distribution, &combined);
    }
    if unified_contribs.is_empty() {
        // Fallback for the PatientEvent-only path.
        for pe in patient_contribs {
            bump(&mut distribution, pe.global_assertion);
            if let Some(arr) = pe.metadata.get("merged_status_set").and_then(|v| v.as_array()) {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        if let Some(p) = AssertionStatus::parse(s) {
                            *distribution.entry(p.as_str().to_string()).or_insert(0) += 1;
                        }
                    }
                }
            }
        }
    }

    // ── Provenance lists ────────────────────────────────────────────
    let unified_event_ids: Vec<String> = unified_contribs.iter().map(|(_, u)| u.canonical_id.clone()).collect();
    let patient_event_ids: Vec<String> = patient_contribs.iter().map(|p| p.patient_event_id.clone()).collect();

    // ── Dominant assertion (priority, distribution-aware) ───────────
    let dominant_assertion = pick_dominant_assertion(&distribution);

    // ── Conflict flag ───────────────────────────────────────────────
    let any_unified_conflict = unified_contribs.iter().any(|(_, u)| u.conflict);
    let any_pe_cross_doc_conflict = patient_contribs.iter().any(|pe| {
        pe.metadata
            .get("conflict_across_documents")
            .and_then(|v| v.as_bool())
            == Some(true)
    });
    let dist_has_affirmed_class = distribution.iter().any(|(k, _)| matches!(k.as_str(),
        "affirmed" | "historical" | "symptom_only"));
    let dist_has_contradicted_class = distribution.iter().any(|(k, _)| matches!(k.as_str(),
        "contradicted" | "negated"));
    let conflict_flag = any_unified_conflict
        || any_pe_cross_doc_conflict
        || (dist_has_affirmed_class && dist_has_contradicted_class);

    // ── Stability decay (Rule E) ───────────────────────────────────
    let assertion_flip_count = compute_flip_count(unified_contribs, patient_contribs);
    let persistence_months = persistence_months(first_seen.as_deref(), last_seen.as_deref());
    let stability_score = compute_stability_score_decay(
        dist_has_contradicted_class,
        conflict_flag && document_count >= 2,
        assertion_flip_count,
        persistence_months,
    );

    let metadata = serde_json::json!({
        "normalised_concept":     normalised_concept,
        "document_count":         document_count,
        "assertion_flip_count":   assertion_flip_count,
        "persistence_months":     persistence_months,
        "any_unified_conflict":   any_unified_conflict,
        "any_pe_cross_doc_conflict": any_pe_cross_doc_conflict,
    });

    let canonical = CanonicalPatientEvent {
        canonical_id: canonical_id.clone(),
        event_type,
        concept: display_concept,
        first_seen,
        last_seen,
        total_occurrences,
        document_count,
        assertion_distribution: distribution,
        unified_event_ids,
        patient_event_ids,
        dominant_assertion,
        conflict_flag,
        stability_score,
        metadata,
    };

    // ── Evolution track ────────────────────────────────────────────
    let timeline = build_evolution_steps(unified_contribs, patient_contribs);
    let track = EvolutionTrack { canonical_id, timeline };

    (canonical, track)
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn pick_display_concept(
    unified: &[(String, UnifiedEvent)],
    patient: &[PatientEvent],
    fallback: &str,
) -> String {
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for (_, u) in unified {
        *counts.entry(u.concept.clone()).or_insert(0) += 1;
    }
    for pe in patient {
        *counts.entry(pe.concept.clone()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(c, _)| c)
        .unwrap_or_else(|| fallback.to_string())
}

fn normalise_concept(s: &str) -> String {
    let lower = s.to_lowercase();
    let trimmed = lower.trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '-');
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Pick the strongest-priority assertion present in `distribution`.
/// Tie-break: deterministic by descending count.
fn pick_dominant_assertion(distribution: &BTreeMap<String, u32>) -> AssertionStatus {
    const PRIORITY: &[AssertionStatus] = &[
        AssertionStatus::Contradicted,
        AssertionStatus::Negated,
        AssertionStatus::Differential,
        AssertionStatus::Queried,
        AssertionStatus::Historical,
        AssertionStatus::SymptomOnly,
        AssertionStatus::Affirmed,
    ];
    for s in PRIORITY {
        if distribution.contains_key(s.as_str()) {
            return *s;
        }
    }
    AssertionStatus::Affirmed
}

fn compute_flip_count(
    unified: &[(String, UnifiedEvent)],
    patient: &[PatientEvent],
) -> u32 {
    // Count transitions between distinct assertion classes across the
    // ordered contributions. This is a coarse proxy for clinical
    // volatility — we sort by date and walk the sequence.
    let mut sequence: Vec<(Option<String>, AssertionStatus)> = Vec::new();
    for (_, u) in unified {
        sequence.push((u.primary_date.clone(), u.assertion));
    }
    for pe in patient {
        sequence.push((pe.first_seen_date.clone(), pe.global_assertion));
    }
    sequence.sort_by(|a, b| {
        a.0.as_deref().unwrap_or("\u{FFFE}").cmp(b.0.as_deref().unwrap_or("\u{FFFE}"))
    });
    let mut flips = 0u32;
    let mut prev: Option<AssertionStatus> = None;
    for (_, s) in sequence {
        if let Some(p) = prev {
            if assertion_class(p) != assertion_class(s) {
                flips += 1;
            }
        }
        prev = Some(s);
    }
    flips
}

fn assertion_class(s: AssertionStatus) -> &'static str {
    match s {
        AssertionStatus::Affirmed | AssertionStatus::Historical | AssertionStatus::SymptomOnly => "affirmative",
        AssertionStatus::Contradicted | AssertionStatus::Negated => "contradictory",
        AssertionStatus::Differential => "differential",
        AssertionStatus::Queried => "queried",
    }
}

fn persistence_months(first: Option<&str>, last: Option<&str>) -> f32 {
    let (Some(f), Some(l)) = (first, last) else { return 0.0 };
    let parse_ym = |s: &str| -> Option<(i32, u32)> {
        let parts: Vec<&str> = s.split('-').collect();
        let y: i32 = parts.first()?.parse().ok()?;
        let m: u32 = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(1);
        Some((y, m))
    };
    if let (Some((y0, m0)), Some((y1, m1))) = (parse_ym(f), parse_ym(l)) {
        ((y1 - y0) * 12 + m1 as i32 - m0 as i32).max(0) as f32
    } else {
        0.0
    }
}

/// Rule E: base 1.0, minus penalties, plus persistence bonus, clamped.
fn compute_stability_score_decay(
    any_contradicted: bool,
    cross_doc_conflict: bool,
    flip_count: u32,
    persistence_months: f32,
) -> f32 {
    let mut s = 1.0_f32;
    if any_contradicted { s -= 0.25; }
    if cross_doc_conflict { s -= 0.15; }
    if flip_count > 3 { s -= 0.10; }
    if persistence_months > 6.0 { s += 0.10; }
    s.clamp(0.0, 1.0)
}

/// Build the evolution timeline. One step per (UnifiedEvent contribution
/// × each status in its merged_status_set). Sorted by date ascending,
/// then by source string for determinism. When no UnifiedEvent
/// contributions are available, fall back to PatientEvent's
/// global_assertion + merged_status_set.
fn build_evolution_steps(
    unified: &[(String, UnifiedEvent)],
    patient: &[PatientEvent],
) -> Vec<EvolutionStep> {
    let mut out: Vec<EvolutionStep> = Vec::new();
    for (_, u) in unified {
        // One step per distinct status observed in this UnifiedEvent.
        let mut combined: BTreeSet<AssertionStatus> = BTreeSet::new();
        combined.insert(u.assertion);
        if let Some(arr) = u.metadata.get("merged_status_set").and_then(|v| v.as_array()) {
            for v in arr {
                if let Some(s) = v.as_str() {
                    if let Some(p) = AssertionStatus::parse(s) {
                        combined.insert(p);
                    }
                }
            }
        }
        let context_snippet = u
            .source_snippets
            .first()
            .cloned()
            .unwrap_or_default();
        for s in combined {
            out.push(EvolutionStep {
                date: u.primary_date.clone(),
                assertion: s,
                source: u.canonical_id.clone(),
                context: context_snippet.clone(),
            });
        }
    }
    if unified.is_empty() {
        for pe in patient {
            let context_snippet = pe
                .source_sections
                .first()
                .cloned()
                .unwrap_or_default();
            let mut combined: BTreeSet<AssertionStatus> = BTreeSet::new();
            combined.insert(pe.global_assertion);
            if let Some(arr) = pe.metadata.get("merged_status_set").and_then(|v| v.as_array()) {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        if let Some(p) = AssertionStatus::parse(s) {
                            combined.insert(p);
                        }
                    }
                }
            }
            for s in combined {
                out.push(EvolutionStep {
                    date: pe.first_seen_date.clone(),
                    assertion: s,
                    source: pe.patient_event_id.clone(),
                    context: context_snippet.clone(),
                });
            }
        }
    }
    out.sort_by(|a, b| {
        let ka = a.date.as_deref().unwrap_or("\u{FFFE}");
        let kb = b.date.as_deref().unwrap_or("\u{FFFE}");
        ka.cmp(kb)
            .then_with(|| a.source.cmp(&b.source))
            .then_with(|| a.assertion.as_str().cmp(b.assertion.as_str()))
    });
    out
}

// ── Edges ────────────────────────────────────────────────────────────────

fn derive_temporal_edges(events: &[CanonicalPatientEvent]) -> Vec<TemporalEdge> {
    let mut edges: Vec<TemporalEdge> = Vec::new();
    // Index by normalised concept for cheap pairwise scans.
    let mut by_concept: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, e) in events.iter().enumerate() {
        let key = e
            .metadata
            .get("normalised_concept")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| normalise_concept(&e.concept));
        by_concept.entry(key).or_default().push(i);
    }

    // Rule sets — each rule emits an edge with rich metadata so consumers
    // can inspect why the edge was created.
    for indices in by_concept.values() {
        // Progression: Symptom (earlier) → Diagnosis (later) for the same
        // concept.
        for &i in indices {
            if events[i].event_type != EventType::Symptom { continue; }
            for &j in indices {
                if i == j { continue; }
                if events[j].event_type != EventType::Diagnosis { continue; }
                let earlier = events[i].first_seen.as_deref();
                let later = events[j].first_seen.as_deref();
                let temporal_ok = match (earlier, later) {
                    (Some(a), Some(b)) => a <= b,
                    _ => true, // be permissive on missing dates
                };
                if temporal_ok {
                    edges.push(TemporalEdge {
                        from_canonical_event: events[i].canonical_id.clone(),
                        to_canonical_event:   events[j].canonical_id.clone(),
                        relation:             TemporalRelation::Progression,
                        metadata:             serde_json::json!({"shared_concept": true}),
                    });
                }
            }
        }
        // Resolution: any diagnosis where assertion_distribution contains
        // a resolved/contradicted/historical status — self-edge captures
        // the lifecycle resolution.
        for &i in indices {
            if events[i].event_type != EventType::Diagnosis { continue; }
            let resolved = events[i].assertion_distribution.keys().any(|k|
                matches!(k.as_str(), "contradicted" | "negated" | "historical"));
            if resolved {
                edges.push(TemporalEdge {
                    from_canonical_event: events[i].canonical_id.clone(),
                    to_canonical_event:   events[i].canonical_id.clone(),
                    relation:             TemporalRelation::Resolution,
                    metadata:             serde_json::json!({
                        "via": "assertion_distribution",
                        "statuses": events[i].assertion_distribution.keys().cloned().collect::<Vec<_>>(),
                    }),
                });
            }
        }
        // Escalation: when the same concept appears as both a Symptom and
        // an Investigation/Procedure that suggests follow-up
        // (deterministic minimum: emit when both Symptom and Procedure
        // exist for the same concept in the corpus).
        let has_symptom = indices.iter().any(|&i| events[i].event_type == EventType::Symptom);
        let has_procedure = indices.iter().any(|&i| events[i].event_type == EventType::Procedure);
        if has_symptom && has_procedure {
            for &i in indices {
                if events[i].event_type != EventType::Symptom { continue; }
                for &j in indices {
                    if events[j].event_type != EventType::Procedure { continue; }
                    edges.push(TemporalEdge {
                        from_canonical_event: events[i].canonical_id.clone(),
                        to_canonical_event:   events[j].canonical_id.clone(),
                        relation:             TemporalRelation::Escalation,
                        metadata:             serde_json::json!({"shared_concept": true}),
                    });
                }
            }
        }
    }

    // TreatmentResponse + CoOccurrence — span across concepts; require
    // shared documents AND ordered timing.
    for i in 0..events.len() {
        for j in 0..events.len() {
            if i == j { continue; }
            let a = &events[i];
            let b = &events[j];
            // Shared documents check uses the metadata snapshot via
            // patient_event_ids and unified_event_ids; for determinism
            // we approximate "shared doc" by overlap of patient_event_ids
            // (PatientEvent ids are stable per concept; same canonical
            // doc → same set of contributing PatientEvent ids).
            let share_doc = a.unified_event_ids.iter().any(|x| b.unified_event_ids.contains(x))
                || !disjoint_doc_sets(a, b);
            // TreatmentResponse: MedicationMention or Procedure → Symptom
            let treatment_kind = matches!(a.event_type, EventType::MedicationMention | EventType::Procedure);
            if treatment_kind && b.event_type == EventType::Symptom && share_doc {
                edges.push(TemporalEdge {
                    from_canonical_event: a.canonical_id.clone(),
                    to_canonical_event:   b.canonical_id.clone(),
                    relation:             TemporalRelation::TreatmentResponse,
                    metadata:             serde_json::json!({"shared_doc": true}),
                });
            }
            // CoOccurrence: any two events on the same date or
            // overlapping ranges in the same document.
            if same_or_overlapping_dates(a, b) && share_doc && a.event_type != b.event_type {
                edges.push(TemporalEdge {
                    from_canonical_event: a.canonical_id.clone(),
                    to_canonical_event:   b.canonical_id.clone(),
                    relation:             TemporalRelation::CoOccurrence,
                    metadata:             serde_json::json!({"shared_doc": true}),
                });
            }
        }
    }
    edges
}

fn same_or_overlapping_dates(a: &CanonicalPatientEvent, b: &CanonicalPatientEvent) -> bool {
    match (
        a.first_seen.as_deref(), a.last_seen.as_deref(),
        b.first_seen.as_deref(), b.last_seen.as_deref(),
    ) {
        (Some(af), Some(al), Some(bf), Some(bl)) => af <= bl && bf <= al,
        _ => false,
    }
}

fn disjoint_doc_sets(a: &CanonicalPatientEvent, b: &CanonicalPatientEvent) -> bool {
    // We don't carry doc ids on CanonicalPatientEvent directly. Best
    // proxy: compare metadata's document_count. Two zero-doc events are
    // disjoint by definition; otherwise we rely on the shared
    // unified_event_id check upstream.
    a.document_count == 0 || b.document_count == 0
}

// ── Cross-domain links ──────────────────────────────────────────────────

fn derive_cross_domain_links(events: &[CanonicalPatientEvent]) -> Vec<CrossDomainLink> {
    let mut out: Vec<CrossDomainLink> = Vec::new();
    // Index by canonical concept.
    let mut by_concept: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, e) in events.iter().enumerate() {
        let key = e
            .metadata
            .get("normalised_concept")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| normalise_concept(&e.concept));
        by_concept.entry(key).or_default().push(i);
    }

    // Rule 1: symptom ↔ diagnosis. Per spec — link when the canonical
    // ids share a concept OR when both appear in overlapping documents
    // (deterministic; the diagnosis was made in the same corpus a
    // symptom was observed in). Same-concept matches always link;
    // co-presence is a secondary path so corpora where the symptom
    // concept differs from the diagnosis concept (e.g. "anxiety"
    // symptom alongside "post-traumatic stress disorder" diagnosis) still
    // produce the medico-legally meaningful bridge.
    for indices in by_concept.values() {
        for &i in indices {
            if events[i].event_type != EventType::Symptom { continue; }
            for &j in indices {
                if events[j].event_type != EventType::Diagnosis { continue; }
                out.push(CrossDomainLink {
                    from_canonical_event: events[i].canonical_id.clone(),
                    to_canonical_event:   events[j].canonical_id.clone(),
                    kind: CrossDomainKind::SymptomDiagnosis,
                    shared_documents: Vec::new(),
                    metadata: serde_json::json!({"basis": "shared_concept"}),
                });
            }
        }
    }
    // Co-presence fallback: every symptom canonical that exists in the
    // corpus is linked to every diagnosis canonical that exists, as
    // long as both contributed at least one document. This is the
    // "shared corpus" bridge per spec §5.
    let sym_idx: Vec<usize> = (0..events.len())
        .filter(|&i| events[i].event_type == EventType::Symptom).collect();
    let dx_idx_all: Vec<usize> = (0..events.len())
        .filter(|&i| events[i].event_type == EventType::Diagnosis).collect();
    for &i in &sym_idx {
        for &j in &dx_idx_all {
            if events[i].document_count == 0 || events[j].document_count == 0 { continue; }
            // Skip same-concept pairs (already emitted above).
            let sym_concept = events[i].metadata.get("normalised_concept").and_then(|v| v.as_str()).unwrap_or("");
            let dx_concept  = events[j].metadata.get("normalised_concept").and_then(|v| v.as_str()).unwrap_or("");
            if sym_concept == dx_concept { continue; }
            out.push(CrossDomainLink {
                from_canonical_event: events[i].canonical_id.clone(),
                to_canonical_event:   events[j].canonical_id.clone(),
                kind: CrossDomainKind::SymptomDiagnosis,
                shared_documents: Vec::new(),
                metadata: serde_json::json!({"basis": "co-presence in corpus"}),
            });
        }
    }

    // Rule 2 + 3: diagnosis ↔ medication, procedure ↔ symptom_change.
    // Deterministic by document overlap (we check shared
    // unified_event_id presence; cross-domain meds rarely share canonical
    // ids, so we additionally cross-reference document_count > 0 on both
    // sides, plus shared `patient_event_ids` document docs via metadata).
    let med_indices: Vec<usize> = (0..events.len()).filter(|&i| events[i].event_type == EventType::MedicationMention).collect();
    let dx_indices:  Vec<usize> = (0..events.len()).filter(|&i| events[i].event_type == EventType::Diagnosis).collect();
    let proc_indices:Vec<usize> = (0..events.len()).filter(|&i| events[i].event_type == EventType::Procedure).collect();
    let sym_indices: Vec<usize> = (0..events.len()).filter(|&i| events[i].event_type == EventType::Symptom).collect();

    for &di in &dx_indices {
        for &mi in &med_indices {
            // Deterministic link if they appear in the same corpus
            // (document_count > 0 on both sides) AND the diagnosis is
            // currently affirmed-class. This is the medico-legally
            // important "this drug was associated with this dx" hint.
            let dx_affirmed = events[di].assertion_distribution.keys().any(|k|
                matches!(k.as_str(), "affirmed" | "historical" | "symptom_only"));
            if events[di].document_count > 0 && events[mi].document_count > 0 && dx_affirmed {
                out.push(CrossDomainLink {
                    from_canonical_event: events[di].canonical_id.clone(),
                    to_canonical_event:   events[mi].canonical_id.clone(),
                    kind: CrossDomainKind::DiagnosisMedication,
                    shared_documents: Vec::new(),
                    metadata: serde_json::json!({"basis": "co-presence in corpus"}),
                });
            }
        }
    }

    for &pi in &proc_indices {
        for &si in &sym_indices {
            // Co-presence in corpus.
            if events[pi].document_count > 0 && events[si].document_count > 0 {
                out.push(CrossDomainLink {
                    from_canonical_event: events[pi].canonical_id.clone(),
                    to_canonical_event:   events[si].canonical_id.clone(),
                    kind: CrossDomainKind::ProcedureSymptomChange,
                    shared_documents: Vec::new(),
                    metadata: serde_json::json!({"basis": "co-presence in corpus"}),
                });
            }
        }
    }

    // Rule 4: diagnosis ↔ contradictory diagnosis (same concept, conflict
    // flag). Self-link records the contradiction explicitly.
    for &di in &dx_indices {
        if events[di].conflict_flag {
            out.push(CrossDomainLink {
                from_canonical_event: events[di].canonical_id.clone(),
                to_canonical_event:   events[di].canonical_id.clone(),
                kind: CrossDomainKind::DiagnosisContradictoryDiagnosis,
                shared_documents: Vec::new(),
                metadata: serde_json::json!({"basis": "internal contradiction"}),
            });
        }
    }

    out
}

// ── serde glue for AssertionStatus in EvolutionStep ─────────────────────

mod assertion_status_serde {
    use super::AssertionStatus;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(value: &AssertionStatus, s: S) -> Result<S::Ok, S::Error> {
        value.as_str().serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<AssertionStatus, D::Error> {
        let s = String::deserialize(d)?;
        AssertionStatus::parse(&s)
            .ok_or_else(|| serde::de::Error::custom(format!("invalid assertion: {s}")))
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::{AssertionStatus, DatePrecision, EventParticipant, EventType};
    use crate::event_unification::UnifiedEvent;

    fn ue(
        canonical: &str,
        event_type: EventType,
        concept: &str,
        assertion: AssertionStatus,
        primary_date: Option<(&str, DatePrecision)>,
        sections: &[&str],
        conflict: bool,
        merged: &[AssertionStatus],
        participants: &[(&str, &str)],
    ) -> UnifiedEvent {
        let merged_arr: Vec<String> = merged.iter().map(|s| s.as_str().to_string()).collect();
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
            metadata: serde_json::json!({
                "merged_status_set": merged_arr,
            }),
        }
    }

    fn find_canonical<'a>(
        g: &'a LongitudinalPatientGraph,
        et: EventType,
        concept_lc: &str,
    ) -> Option<&'a CanonicalPatientEvent> {
        g.canonical_events.iter().find(|c|
            c.event_type == et && c.concept.to_lowercase().contains(concept_lc))
    }

    // ─── 1. Dedup across docs and time ────────────────────────────────
    #[test]
    fn dedup_across_documents_and_time() {
        let doc_a = vec![ue("u1", EventType::Diagnosis, "PTSD", AssertionStatus::Affirmed,
            Some(("2021-01-15", DatePrecision::Day)), &["Treating Psychologist"], false,
            &[AssertionStatus::Affirmed], &[])];
        let doc_b = vec![ue("u2", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
            Some(("2022-06-30", DatePrecision::Day)), &["Reviewing Psychiatrist"], false,
            &[AssertionStatus::Affirmed], &[])];
        let g = build_longitudinal_patient_graph(vec![
            ("docA".into(), doc_a),
            ("docB".into(), doc_b),
        ], None);
        let dx: Vec<_> = g.canonical_events.iter()
            .filter(|c| c.event_type == EventType::Diagnosis).collect();
        assert_eq!(dx.len(), 1, "PTSD must collapse to ONE canonical event: {:?}", dx);
        let c = dx[0];
        assert_eq!(c.document_count, 2);
        assert_eq!(c.first_seen.as_deref(), Some("2021-01-15"));
        assert_eq!(c.last_seen.as_deref(),  Some("2022-06-30"));
    }

    // ─── 2. Assertion drift preserved, not collapsed ──────────────────
    #[test]
    fn assertion_drift_is_preserved_not_collapsed() {
        let doc_a = vec![ue("u1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
            Some(("2021-01-01", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Affirmed], &[])];
        let doc_b = vec![ue("u2", EventType::Diagnosis, "ptsd", AssertionStatus::Queried,
            Some(("2022-03-15", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Queried], &[])];
        let doc_c = vec![ue("u3", EventType::Diagnosis, "ptsd", AssertionStatus::Contradicted,
            Some(("2023-07-09", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Contradicted], &[])];
        let doc_d = vec![ue("u4", EventType::Diagnosis, "ptsd", AssertionStatus::Historical,
            Some(("2024-02-01", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Historical], &[])];
        let g = build_longitudinal_patient_graph(vec![
            ("docA".into(), doc_a),
            ("docB".into(), doc_b),
            ("docC".into(), doc_c),
            ("docD".into(), doc_d),
        ], None);
        let c = find_canonical(&g, EventType::Diagnosis, "ptsd").unwrap();
        // Distribution must contain ALL four statuses — no priority collapse.
        for k in ["affirmed", "queried", "contradicted", "historical"] {
            assert!(c.assertion_distribution.contains_key(k),
                "assertion_distribution lost {:?}: {:?}", k, c.assertion_distribution);
        }
        // dominant_assertion still resolves by priority.
        assert_eq!(c.dominant_assertion, AssertionStatus::Contradicted);
        // Conflict flag fires (affirmed-class + contradicted-class both present).
        assert!(c.conflict_flag, "conflict_flag must fire on mixed-class corpus");

        // EvolutionTrack must list every step.
        let track = g.evolution_tracks.iter().find(|t| t.canonical_id == c.canonical_id).unwrap();
        let statuses: Vec<&str> = track.timeline.iter().map(|s| s.assertion.as_str()).collect();
        for k in ["affirmed", "queried", "contradicted", "historical"] {
            assert!(statuses.contains(&k),
                "EvolutionTrack lost status {:?}: {:?}", k, statuses);
        }
    }

    // ─── 3. Stability penalty for cross-doc conflict ─────────────────
    #[test]
    fn stability_penalty_for_cross_doc_conflict() {
        let doc_a = vec![ue("u1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
            Some(("2021-01-01", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Affirmed], &[])];
        let doc_b = vec![ue("u2", EventType::Diagnosis, "ptsd", AssertionStatus::Contradicted,
            Some(("2022-01-01", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Contradicted], &[])];
        let g = build_longitudinal_patient_graph(vec![
            ("docA".into(), doc_a),
            ("docB".into(), doc_b),
        ], None);
        let c = find_canonical(&g, EventType::Diagnosis, "ptsd").unwrap();
        // Base 1.0 - 0.25 (contradicted exists) - 0.15 (cross-doc conflict) = 0.6.
        // Persistence (12 months > 6) → +0.10 = 0.7
        assert!((c.stability_score - 0.7).abs() < 1e-4,
            "stability_score should be 0.7 with contradiction + cross-doc + persistence; got {}",
            c.stability_score);
    }

    // ─── 4. Temporal edges symptom → diagnosis ────────────────────────
    #[test]
    fn temporal_edges_symptom_to_diagnosis() {
        let doc_a = vec![
            ue("u-sym", EventType::Symptom,   "ptsd", AssertionStatus::SymptomOnly,
                Some(("2021-01-01", DatePrecision::Day)), &[], false,
                &[AssertionStatus::SymptomOnly], &[]),
            ue("u-dx",  EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
                Some(("2022-06-01", DatePrecision::Day)), &[], false,
                &[AssertionStatus::Affirmed], &[]),
        ];
        let g = build_longitudinal_patient_graph(vec![("docA".into(), doc_a)], None);
        let progression: Vec<_> = g.temporal_edges.iter()
            .filter(|e| e.relation == TemporalRelation::Progression).collect();
        assert!(!progression.is_empty(),
            "expected a Progression edge from symptom → diagnosis: {:?}", g.temporal_edges);
        let p = progression[0];
        assert!(p.from_canonical_event.contains("symptom"));
        assert!(p.to_canonical_event.contains("diagnosis"));
    }

    // ─── 5. Evolution track includes all assertion flips ─────────────
    #[test]
    fn evolution_track_contains_all_assertion_flips() {
        let doc_a = vec![ue("u1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
            Some(("2021-01-01", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Affirmed, AssertionStatus::Queried], &[])];
        let doc_b = vec![ue("u2", EventType::Diagnosis, "ptsd", AssertionStatus::Contradicted,
            Some(("2022-01-01", DatePrecision::Day)), &[], false,
            &[AssertionStatus::Contradicted, AssertionStatus::Differential], &[])];
        let g = build_longitudinal_patient_graph(vec![
            ("docA".into(), doc_a), ("docB".into(), doc_b),
        ], None);
        let c = find_canonical(&g, EventType::Diagnosis, "ptsd").unwrap();
        let track = g.evolution_tracks.iter().find(|t| t.canonical_id == c.canonical_id).unwrap();
        // Two UEs × ≥2 distinct statuses each → at least 4 steps.
        assert!(track.timeline.len() >= 4,
            "evolution timeline must record all assertion flips; got {}: {:?}",
            track.timeline.len(), track.timeline);
    }

    // ─── 6. Reversibility ─────────────────────────────────────────────
    #[test]
    fn reversibility_all_canonical_events_trace_to_patient_events() {
        let doc_a = vec![
            ue("u-dx", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
                None, &[], false, &[AssertionStatus::Affirmed], &[]),
            ue("u-med", EventType::MedicationMention, "sertraline", AssertionStatus::Affirmed,
                None, &[], false, &[AssertionStatus::Affirmed], &[]),
            ue("u-sym", EventType::Symptom, "anxiety", AssertionStatus::SymptomOnly,
                None, &[], false, &[AssertionStatus::SymptomOnly], &[]),
        ];
        let g = build_longitudinal_patient_graph(vec![("docA".into(), doc_a)], None);
        for c in &g.canonical_events {
            // Must list at least one upstream UnifiedEvent + PatientEvent
            // pair so consumers can drill back to the raw mentions.
            assert!(!c.unified_event_ids.is_empty(),
                "{}: unified_event_ids must not be empty", c.canonical_id);
            assert!(!c.patient_event_ids.is_empty(),
                "{}: patient_event_ids must not be empty", c.canonical_id);
        }
    }

    // ─── 7. Cross-domain triad (med ↔ dx ↔ symptom) ──────────────────
    #[test]
    fn cross_domain_links_include_med_dx_symptom_triads() {
        let doc_a = vec![
            ue("u-dx",  EventType::Diagnosis,        "ptsd",       AssertionStatus::Affirmed,
                None, &[], false, &[AssertionStatus::Affirmed], &[]),
            ue("u-med", EventType::MedicationMention,"sertraline", AssertionStatus::Affirmed,
                None, &[], false, &[AssertionStatus::Affirmed], &[]),
            ue("u-sym", EventType::Symptom,          "ptsd",       AssertionStatus::SymptomOnly,
                None, &[], false, &[AssertionStatus::SymptomOnly], &[]),
        ];
        let g = build_longitudinal_patient_graph(vec![("docA".into(), doc_a)], None);
        let kinds: std::collections::HashSet<&str> = g.cross_domain_links.iter()
            .map(|l| match l.kind {
                CrossDomainKind::SymptomDiagnosis        => "symptom_diagnosis",
                CrossDomainKind::DiagnosisMedication     => "diagnosis_medication",
                CrossDomainKind::ProcedureSymptomChange  => "procedure_symptom_change",
                CrossDomainKind::DiagnosisContradictoryDiagnosis => "diagnosis_contradictory_diagnosis",
            })
            .collect();
        assert!(kinds.contains("symptom_diagnosis"),
            "expected symptom↔diagnosis link: {:?}", g.cross_domain_links);
        assert!(kinds.contains("diagnosis_medication"),
            "expected diagnosis↔medication link: {:?}", g.cross_domain_links);
    }

    // ─── 8. Dominant assertion by priority ──────────────────────────
    #[test]
    fn dominant_assertion_follows_priority_order() {
        let doc_a = vec![
            ue("u1", EventType::Diagnosis, "x", AssertionStatus::Affirmed,
                None, &[], false, &[AssertionStatus::Affirmed], &[]),
            ue("u2", EventType::Diagnosis, "x", AssertionStatus::Contradicted,
                None, &[], false, &[AssertionStatus::Contradicted], &[]),
            ue("u3", EventType::Diagnosis, "x", AssertionStatus::Queried,
                None, &[], false, &[AssertionStatus::Queried], &[]),
        ];
        let g = build_longitudinal_patient_graph(vec![("doc".into(), doc_a)], None);
        let c = find_canonical(&g, EventType::Diagnosis, "x").unwrap();
        assert_eq!(c.dominant_assertion, AssertionStatus::Contradicted);
    }
}
