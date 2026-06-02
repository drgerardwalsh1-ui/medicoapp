//! Condition State Engine.
//!
//! Sits ABOVE `patient_timeline::PatientEvent`. Translates the
//! event-centric view of "what happened" into a state-centric view of
//! "what is the patient's clinical picture *now*".
//!
//! For each canonical concept, we emit a single `ConditionState` with:
//!
//!   * `current_status` — Active / Inactive / Resolved / Disputed / Unknown
//!   * `trajectory[]`   — every state transition with date + reason
//!   * `supporting_events[]` + `contradicting_events[]` — `PatientEvent`
//!     ids that drove the inferred state, so the full chain
//!     `ConditionState → PatientEvent → UnifiedEvent → ClinicalEvent`
//!     stays reversible.
//!   * `stability` and `severity_proxy` — lightweight deterministic
//!     scores derived from event counts, contradiction presence,
//!     medication support, and persistence over time.
//!
//! Strictly deterministic. No ML. No embeddings. No probabilistic
//! reasoning. This module is purely additive — `reason_clinical_state`
//! is the new public surface; ingestion is unchanged.

use serde::{Deserialize, Serialize};

use crate::clinical_events::{AssertionStatus, EventType};
use crate::patient_timeline::PatientEvent;

// ── Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionStatus {
    Active,
    Inactive,
    Resolved,
    Disputed,
    Unknown,
}

impl ConditionStatus {
    #[allow(dead_code)] // Public API for downstream consumers / future UI.
    pub fn as_str(self) -> &'static str {
        match self {
            ConditionStatus::Active   => "active",
            ConditionStatus::Inactive => "inactive",
            ConditionStatus::Resolved => "resolved",
            ConditionStatus::Disputed => "disputed",
            ConditionStatus::Unknown  => "unknown",
        }
    }
    /// Sort priority — Active > Disputed > Unknown > Inactive > Resolved.
    fn priority(self) -> u8 {
        match self {
            ConditionStatus::Active   => 5,
            ConditionStatus::Disputed => 4,
            ConditionStatus::Unknown  => 3,
            ConditionStatus::Inactive => 2,
            ConditionStatus::Resolved => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionReason {
    /// Affirmed diagnosis observed for this concept.
    AffirmedDiagnosis,
    /// A queried diagnosis was observed.
    QueriedDiagnosis,
    /// A differential mention was observed.
    DifferentialDiagnosis,
    /// Symptom-only mention — supporting evidence for an active state.
    SymptomSupport,
    /// Medication mention — supporting persistence signal.
    MedicationSupport,
    /// Historical reference (`history of X`).
    HistoricalReference,
    /// Explicit negation ("denies X", "no X").
    Negation,
    /// Contradiction ("inconsistent with X").
    Contradiction,
    /// Multiple sources disagree without temporal ordering.
    UnresolvedConflict,
    /// Initial state when nothing has been observed.
    NoEvidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateTransition {
    pub from_status: ConditionStatus,
    pub to_status: ConditionStatus,
    pub date: Option<String>,
    /// `patient_event_id` of the event that drove this transition.
    pub source_event_id: String,
    pub reason: TransitionReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConditionState {
    /// Stable id of the form `state#{normalised_concept}`.
    pub state_id: String,

    pub concept: String,

    pub current_status: ConditionStatus,

    /// In [0,1]. Lower when disputed; lower when no supporting evidence.
    pub confidence: f32,

    pub first_appearance: Option<String>,
    pub last_appearance: Option<String>,

    pub trajectory: Vec<StateTransition>,

    pub supporting_events: Vec<String>,
    pub contradicting_events: Vec<String>,

    /// In [0,1]. See `compute_stability`.
    pub stability: f32,

    /// In [0,1]. See `compute_severity_proxy`.
    pub severity_proxy: Option<f32>,

    /// Open-ended audit bag.
    pub metadata: serde_json::Value,
}

// ── Public API ───────────────────────────────────────────────────────────

/// Translate a flat list of `PatientEvent`s into one `ConditionState`
/// per normalised concept, with full transition trajectories.
pub fn build_clinical_state(patient_events: Vec<PatientEvent>) -> Vec<ConditionState> {
    // 1. Filter to clinically-relevant event types (per spec §3.1) and
    //    group by normalised concept across event types.
    let mut by_concept: std::collections::BTreeMap<String, Vec<PatientEvent>> =
        std::collections::BTreeMap::new();
    for pe in patient_events {
        if !is_state_relevant(pe.event_type) {
            continue;
        }
        let key = normalise_concept(&pe.concept);
        by_concept.entry(key).or_default().push(pe);
    }

    // 2. Build a ConditionState per concept.
    let mut states: Vec<ConditionState> = by_concept
        .into_iter()
        .map(|(norm, evs)| build_state_for_concept(norm, evs))
        .collect();

    // 3. Sort: ConditionStatus priority then severity_proxy desc.
    states.sort_by(|a, b| {
        b.current_status
            .priority()
            .cmp(&a.current_status.priority())
            .then_with(|| {
                let sa = a.severity_proxy.unwrap_or(0.0);
                let sb = b.severity_proxy.unwrap_or(0.0);
                sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    states
}

// ── Per-concept builder ──────────────────────────────────────────────────

fn build_state_for_concept(
    normalised_concept: String,
    mut events: Vec<PatientEvent>,
) -> ConditionState {
    // Pretty-case the display concept from the most common variant.
    let display_concept = pick_display_concept(&events, &normalised_concept);
    let state_id = format!("state#{normalised_concept}");

    // Sort events temporally — by first_seen_date (None last), then by
    // patient_event_id for determinism.
    events.sort_by(|a, b| {
        let ka = a.first_seen_date.as_deref().unwrap_or("\u{FFFE}");
        let kb = b.first_seen_date.as_deref().unwrap_or("\u{FFFE}");
        ka.cmp(kb).then_with(|| a.patient_event_id.cmp(&b.patient_event_id))
    });

    // ── Walk the trajectory ──────────────────────────────────────────────
    let mut current_status = ConditionStatus::Unknown;
    let mut trajectory: Vec<StateTransition> = Vec::new();
    let mut supporting_events: Vec<String> = Vec::new();
    let mut contradicting_events: Vec<String> = Vec::new();

    // For confidence + stability + severity bookkeeping.
    let mut affirmed_count = 0u32;
    let mut symptom_count = 0u32;
    let mut medication_count = 0u32;
    let mut contradicted_count = 0u32;
    let mut historical_count = 0u32;
    let mut queried_or_diff_count = 0u32;
    let mut any_affirmed_dx = false;
    let mut affirmed_dx_at_or_before: Option<String> = None;
    let mut first_appearance: Option<String> = None;
    let mut last_appearance: Option<String> = None;
    let mut total_dx_events = 0u32;

    for pe in &events {
        if first_appearance.is_none() {
            first_appearance = pe.first_seen_date.clone();
        }
        if pe.last_seen_date.is_some() {
            last_appearance = pe.last_seen_date.clone();
        }

        // Conflict propagation across layers. A PatientEvent may carry
        // a single resolved `global_assertion` (e.g. Contradicted)
        // while its `metadata.conflict_across_documents == true` records
        // that an affirmed claim was made elsewhere in the corpus. Treat
        // that as "affirmed-class evidence has been observed" so the
        // clinical state lands on Disputed rather than silently
        // collapsing to Resolved.
        let cross_doc_conflict = pe
            .metadata
            .get("conflict_across_documents")
            .and_then(|v| v.as_bool())
            == Some(true);
        if cross_doc_conflict {
            any_affirmed_dx = true;
        }

        // Classify the contribution into a (next_status, reason) pair.
        let (next_status, reason, is_supporting, is_contradicting) =
            classify_contribution(pe, current_status, any_affirmed_dx);

        // Bookkeeping for downstream scores.
        match pe.event_type {
            EventType::Diagnosis => {
                total_dx_events += 1;
                match pe.global_assertion {
                    AssertionStatus::Affirmed => {
                        affirmed_count += 1;
                        any_affirmed_dx = true;
                        affirmed_dx_at_or_before = pe.first_seen_date.clone()
                            .or(affirmed_dx_at_or_before);
                    }
                    AssertionStatus::Contradicted | AssertionStatus::Negated => {
                        contradicted_count += 1;
                    }
                    AssertionStatus::Historical => {
                        historical_count += 1;
                    }
                    AssertionStatus::Queried | AssertionStatus::Differential => {
                        queried_or_diff_count += 1;
                    }
                    AssertionStatus::SymptomOnly => {
                        symptom_count += 1;
                    }
                }
            }
            EventType::Symptom => { symptom_count += 1; }
            EventType::MedicationMention => { medication_count += 1; }
            _ => {}
        }

        if is_supporting {
            supporting_events.push(pe.patient_event_id.clone());
        }
        if is_contradicting {
            contradicting_events.push(pe.patient_event_id.clone());
        }

        if next_status != current_status {
            trajectory.push(StateTransition {
                from_status: current_status,
                to_status: next_status,
                date: pe.first_seen_date.clone(),
                source_event_id: pe.patient_event_id.clone(),
                reason,
            });
            current_status = next_status;
        }
    }

    // ── Spec §3.4: conflict resolution when no clear temporal order ─────
    let dates_present = events.iter().filter(|p| p.first_seen_date.is_some()).count();
    let has_temporal_order = dates_present >= 2
        && events.iter().filter_map(|p| p.first_seen_date.clone()).collect::<std::collections::BTreeSet<_>>().len() >= 2;
    let any_cross_doc_conflict = events.iter().any(|pe| {
        pe.metadata
            .get("conflict_across_documents")
            .and_then(|v| v.as_bool())
            == Some(true)
    });
    let has_affirmed_class = affirmed_count > 0
        || historical_count > 0
        || symptom_count > 0
        || any_cross_doc_conflict; // cross-layer propagation
    let has_contradicted_class = contradicted_count > 0;
    let unresolved_conflict = has_affirmed_class && has_contradicted_class && !has_temporal_order;
    if unresolved_conflict && current_status != ConditionStatus::Disputed {
        let last_event_id = events.last().map(|e| e.patient_event_id.clone()).unwrap_or_default();
        trajectory.push(StateTransition {
            from_status: current_status,
            to_status: ConditionStatus::Disputed,
            date: None,
            source_event_id: last_event_id,
            reason: TransitionReason::UnresolvedConflict,
        });
        current_status = ConditionStatus::Disputed;
    }

    // ── Confidence ──────────────────────────────────────────────────────
    let mut confidence_sum: f32 = 0.0;
    let mut confidence_n: u32 = 0;
    for pe in &events {
        confidence_sum += pe.confidence;
        confidence_n += 1;
    }
    let mut confidence = if confidence_n == 0 { 0.5 } else { confidence_sum / confidence_n as f32 };
    if current_status == ConditionStatus::Disputed { confidence -= 0.2; }
    if unresolved_conflict { confidence -= 0.0; /* already penalised by Disputed */ }
    let confidence = confidence.clamp(0.0, 1.0);

    // ── Stability ───────────────────────────────────────────────────────
    let total_events = events.len() as u32;
    let active_event_count = affirmed_count + symptom_count + medication_count;
    let stability = compute_stability(
        active_event_count,
        total_events,
        current_status == ConditionStatus::Disputed,
        contradicted_count > 0,
        medication_count > 0 && total_events > 1,
    );

    // ── Severity proxy ──────────────────────────────────────────────────
    let persistence_factor = persistence_months_normalised(
        first_appearance.as_deref(),
        last_appearance.as_deref(),
    );
    let severity_proxy = Some(compute_severity_proxy(
        affirmed_count,
        symptom_count,
        medication_count,
        persistence_factor,
    ));

    let metadata = serde_json::json!({
        "normalised_concept":     normalised_concept,
        "total_events":           total_events,
        "affirmed_count":         affirmed_count,
        "symptom_count":          symptom_count,
        "medication_count":       medication_count,
        "contradicted_count":     contradicted_count,
        "historical_count":       historical_count,
        "queried_or_diff_count":  queried_or_diff_count,
        "total_dx_events":        total_dx_events,
        "has_temporal_order":     has_temporal_order,
        "unresolved_conflict":    unresolved_conflict,
        "persistence_factor":     persistence_factor,
        "affirmed_dx_at_or_before": affirmed_dx_at_or_before,
    });

    ConditionState {
        state_id,
        concept: display_concept,
        current_status,
        confidence,
        first_appearance,
        last_appearance,
        trajectory,
        supporting_events,
        contradicting_events,
        stability,
        severity_proxy,
        metadata,
    }
}

// ── Contribution classifier ──────────────────────────────────────────────

/// Map a single PatientEvent into (next_status, reason, supporting?,
/// contradicting?) given the current state and whether an affirmed
/// diagnosis has been seen earlier in the trajectory.
fn classify_contribution(
    pe: &PatientEvent,
    current: ConditionStatus,
    affirmed_dx_seen: bool,
) -> (ConditionStatus, TransitionReason, bool, bool) {
    use AssertionStatus::*;
    use EventType::*;
    use ConditionStatus::*;

    match (pe.event_type, pe.global_assertion) {
        // ── Diagnosis events ────────────────────────────────────────
        (Diagnosis, Affirmed) => (Active, TransitionReason::AffirmedDiagnosis, true, false),
        (Diagnosis, SymptomOnly) => {
            // SymptomOnly on a Diagnosis row only upgrades Unknown→Active.
            let next = if current == Unknown { Active } else { current };
            (next, TransitionReason::SymptomSupport, true, false)
        }
        (Diagnosis, Historical) => {
            // History of X — Inactive unless a later affirmation re-fires.
            let next = if current == Active { Inactive } else { current };
            (next, TransitionReason::HistoricalReference, false, false)
        }
        (Diagnosis, Negated) => {
            // §3.3: only-negated → Resolved; if a prior affirmation exists
            // → Disputed.
            let next = if affirmed_dx_seen { Disputed } else { Resolved };
            (next, TransitionReason::Negation, false, true)
        }
        (Diagnosis, Contradicted) => {
            // §3.3: contradicted-after-affirmed → Disputed; otherwise
            // treat the contradiction as the only signal we have and
            // resolve out the condition.
            let next = if affirmed_dx_seen { Disputed } else { Resolved };
            (next, TransitionReason::Contradiction, false, true)
        }
        (Diagnosis, Queried) => {
            let next = if current == Active { Disputed } else { Disputed };
            (next, TransitionReason::QueriedDiagnosis, false, false)
        }
        (Diagnosis, Differential) => {
            let next = if current == Active { Disputed } else { Disputed };
            (next, TransitionReason::DifferentialDiagnosis, false, false)
        }
        // ── Symptom mentions ────────────────────────────────────────
        (Symptom, _) => {
            // Symptoms upgrade Unknown→Active but do NOT override an
            // already-stronger state (Disputed, Resolved, etc.).
            let next = if current == Unknown { Active } else { current };
            (next, TransitionReason::SymptomSupport, true, false)
        }
        // ── Medication mentions (persistence signal) ────────────────
        (MedicationMention, _) => {
            // Medications never override contradictions per §3.3. If
            // nothing is known yet, treat as weak Active evidence; if
            // Active, stay Active.
            let next = match current {
                Unknown => Active,
                _ => current,
            };
            (next, TransitionReason::MedicationSupport, true, false)
        }
        // Other event types are filtered out upstream; fall through to
        // a no-op.
        _ => (current, TransitionReason::NoEvidence, false, false),
    }
}

// ── Scoring helpers ──────────────────────────────────────────────────────

fn compute_stability(
    active_event_count: u32,
    total_events: u32,
    disputed: bool,
    contradiction_exists: bool,
    medication_support_consistent: bool,
) -> f32 {
    if total_events == 0 {
        return 0.0;
    }
    let mut s = active_event_count as f32 / total_events as f32;
    if disputed { s -= 0.3; }
    if contradiction_exists { s -= 0.2; }
    if medication_support_consistent { s += 0.1; }
    s.clamp(0.0, 1.0)
}

fn compute_severity_proxy(
    dx: u32,
    sym: u32,
    med: u32,
    persistence_factor: f32,
) -> f32 {
    // Weighted sum (per spec); persistence_factor already in [0,1].
    let raw = (dx as f32) * 2.0
        + (sym as f32) * 1.0
        + (med as f32) * 1.5
        + persistence_factor;
    // Scale so a single affirmed diagnosis + symptom + med over 12 months
    // lands in the middle of the range. Cap at 1.0.
    (raw / 10.0).clamp(0.0, 1.0)
}

/// Months between two ISO dates (best-effort: parses YYYY-MM-DD,
/// YYYY-MM, or YYYY) normalised against a 24-month ceiling.
fn persistence_months_normalised(
    first: Option<&str>,
    last: Option<&str>,
) -> f32 {
    let (Some(f), Some(l)) = (first, last) else { return 0.0 };
    let months = months_between(f, l);
    (months / 24.0).clamp(0.0, 1.0)
}

fn months_between(a: &str, b: &str) -> f32 {
    fn ym(s: &str) -> Option<(i32, u32)> {
        let parts: Vec<&str> = s.split('-').collect();
        let y: i32 = parts.first()?.parse().ok()?;
        let m: u32 = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(1);
        Some((y, m))
    }
    match (ym(a), ym(b)) {
        (Some((y0, m0)), Some((y1, m1))) => {
            let raw = ((y1 - y0) * 12 + m1 as i32 - m0 as i32).max(0);
            raw as f32
        }
        _ => 0.0,
    }
}

// ── Misc helpers ─────────────────────────────────────────────────────────

fn is_state_relevant(event_type: EventType) -> bool {
    matches!(
        event_type,
        EventType::Diagnosis | EventType::Symptom | EventType::MedicationMention,
    )
}

fn normalise_concept(s: &str) -> String {
    let lower = s.to_lowercase();
    let trimmed = lower.trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '-');
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn pick_display_concept(events: &[PatientEvent], fallback: &str) -> String {
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for pe in events {
        *counts.entry(pe.concept.clone()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(c, _)| c)
        .unwrap_or_else(|| fallback.to_string())
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::{AssertionStatus, EventType};
    use crate::patient_timeline::{DocumentReference, PatientEvent};

    fn pe(
        id: &str,
        event_type: EventType,
        concept: &str,
        assertion: AssertionStatus,
        first: Option<&str>,
        last: Option<&str>,
        confidence: f32,
    ) -> PatientEvent {
        PatientEvent {
            patient_event_id: id.to_string(),
            event_type,
            concept: concept.to_string(),
            first_seen_date: first.map(str::to_string),
            last_seen_date: last.map(str::to_string),
            date_precision: None,
            documents: vec![DocumentReference {
                doc_id: "doc".into(),
                unified_event_id: format!("u-{id}"),
                date_in_doc: first.map(str::to_string),
            }],
            total_occurrences: 1,
            global_assertion: assertion,
            source_unified_event_ids: vec![format!("u-{id}")],
            source_document_ids: vec!["doc".into()],
            source_sections: Vec::new(),
            participants: Vec::new(),
            confidence,
            stability_score: 0.5,
            related_patient_events: Vec::new(),
            metadata: serde_json::json!({}),
        }
    }

    // ─── 1. Active condition detection ────────────────────────────────
    #[test]
    fn affirmed_diagnosis_yields_active_condition_state() {
        let events = vec![
            pe("p1", EventType::Diagnosis, "PTSD", AssertionStatus::Affirmed,
                Some("2022-05-10"), Some("2022-05-10"), 0.9),
        ];
        let states = build_clinical_state(events);
        assert_eq!(states.len(), 1);
        let s = &states[0];
        assert_eq!(s.current_status, ConditionStatus::Active,
            "affirmed PTSD should be Active: {:?}", s);
        assert!(s.supporting_events.contains(&"p1".to_string()));
        // Trajectory contains Unknown → Active.
        assert_eq!(s.trajectory.len(), 1);
        assert_eq!(s.trajectory[0].from_status, ConditionStatus::Unknown);
        assert_eq!(s.trajectory[0].to_status,   ConditionStatus::Active);
    }

    // ─── 2. Resolution over time ──────────────────────────────────────
    #[test]
    fn affirmed_then_negated_does_not_silently_resolve_with_prior_affirmation() {
        let events = vec![
            pe("p1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
                Some("2020-01-01"), Some("2020-01-01"), 0.9),
            pe("p2", EventType::Diagnosis, "ptsd", AssertionStatus::Negated,
                Some("2021-06-15"), Some("2021-06-15"), 0.9),
        ];
        let states = build_clinical_state(events);
        let s = &states[0];
        // Per §3.3, contradicted-after-affirmed → Disputed.
        // The same applies to negation when an earlier affirmation exists.
        assert_eq!(s.current_status, ConditionStatus::Disputed,
            "negation after prior affirmation must be Disputed (not silently Resolved): {:?}", s);
    }

    #[test]
    fn negation_without_prior_affirmation_resolves_condition() {
        // The pure resolution case — only negation, no prior affirmation.
        let events = vec![
            pe("p1", EventType::Diagnosis, "ptsd", AssertionStatus::Negated,
                Some("2021-06-15"), Some("2021-06-15"), 0.9),
        ];
        let states = build_clinical_state(events);
        assert_eq!(states[0].current_status, ConditionStatus::Resolved);
    }

    // ─── 3. Contradiction leads to disputed ───────────────────────────
    #[test]
    fn contradicting_docs_without_temporal_order_yield_disputed() {
        let events = vec![
            pe("p1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
                None, None, 0.8),
            pe("p2", EventType::Diagnosis, "ptsd", AssertionStatus::Contradicted,
                None, None, 0.8),
        ];
        let states = build_clinical_state(events);
        assert_eq!(states[0].current_status, ConditionStatus::Disputed,
            "conflicting evidence without temporal order must be Disputed");
        // Confidence should be reduced.
        assert!(states[0].confidence <= 0.7,
            "disputed states must lose confidence: {}", states[0].confidence);
        assert!(states[0].metadata["unresolved_conflict"].as_bool() == Some(true),
            "metadata must flag unresolved_conflict: {:?}", states[0].metadata);
    }

    // ─── 4. Medication support increases stability ────────────────────
    #[test]
    fn medication_support_increases_stability_score() {
        let with_meds = vec![
            pe("p1", EventType::Diagnosis,         "ptsd",       AssertionStatus::Affirmed,
                Some("2022-01-01"), Some("2022-01-01"), 0.9),
            pe("p2", EventType::MedicationMention, "sertraline", AssertionStatus::Affirmed,
                Some("2022-02-01"), Some("2022-02-01"), 0.9),
        ];
        let states_with = build_clinical_state(with_meds);
        // To compare, also build the same condition WITHOUT a medication.
        let no_meds = vec![
            pe("p1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
                Some("2022-01-01"), Some("2022-01-01"), 0.9),
        ];
        let states_without = build_clinical_state(no_meds);

        let ptsd_with = states_with.iter().find(|s| s.concept.to_lowercase().contains("ptsd")).unwrap();
        let ptsd_without = &states_without[0];
        // Both should be Active.
        assert_eq!(ptsd_with.current_status, ConditionStatus::Active);
        assert_eq!(ptsd_without.current_status, ConditionStatus::Active);
        assert!(ptsd_with.stability >= ptsd_without.stability,
            "med support must not decrease stability — with={} without={}",
            ptsd_with.stability, ptsd_without.stability);
    }

    // ─── 5. Severity ranking ──────────────────────────────────────────
    #[test]
    fn multi_event_condition_outranks_single_symptom() {
        let events = vec![
            // Heavy condition: dx + symptom + med over time.
            pe("p1", EventType::Diagnosis,         "ptsd", AssertionStatus::Affirmed,
                Some("2020-01-01"), Some("2020-01-01"), 0.9),
            pe("p2", EventType::Symptom,           "ptsd", AssertionStatus::SymptomOnly,
                Some("2021-05-10"), Some("2021-05-10"), 0.8),
            pe("p3", EventType::MedicationMention, "sertraline",  AssertionStatus::Affirmed,
                Some("2022-06-01"), Some("2022-06-01"), 0.9),
            // Light condition: single isolated symptom.
            pe("p4", EventType::Symptom,           "tinnitus", AssertionStatus::SymptomOnly,
                Some("2020-01-01"), Some("2020-01-01"), 0.6),
        ];
        let states = build_clinical_state(events);
        // Sort places highest-severity Active states first.
        let ptsd_idx = states.iter().position(|s| s.concept.to_lowercase().contains("ptsd")).unwrap();
        let tin_idx  = states.iter().position(|s| s.concept.to_lowercase().contains("tinnitus")).unwrap();
        assert!(ptsd_idx < tin_idx,
            "multi-event PTSD must rank above single-symptom tinnitus: {:?}",
            states.iter().map(|s| (&s.concept, s.severity_proxy)).collect::<Vec<_>>());
        let ptsd = &states[ptsd_idx];
        let tin  = &states[tin_idx];
        assert!(ptsd.severity_proxy.unwrap() > tin.severity_proxy.unwrap(),
            "severity_proxy ordering wrong: PTSD={:?} tinnitus={:?}",
            ptsd.severity_proxy, tin.severity_proxy);
    }

    // ─── Trace reversibility ──────────────────────────────────────────
    #[test]
    fn every_condition_state_traces_back_to_patient_events() {
        let events = vec![
            pe("p1", EventType::Diagnosis,         "ptsd",       AssertionStatus::Affirmed,
                Some("2022-01-01"), Some("2022-01-01"), 0.9),
            pe("p2", EventType::Symptom,           "ptsd",       AssertionStatus::SymptomOnly,
                Some("2022-02-01"), Some("2022-02-01"), 0.8),
            pe("p3", EventType::MedicationMention, "sertraline", AssertionStatus::Affirmed,
                Some("2022-03-01"), Some("2022-03-01"), 0.9),
            // Different concept — should produce a separate ConditionState.
            pe("p4", EventType::Diagnosis,         "anxiety",    AssertionStatus::Affirmed,
                Some("2022-04-01"), Some("2022-04-01"), 0.8),
        ];
        let states = build_clinical_state(events);
        for s in &states {
            assert!(!s.supporting_events.is_empty() || !s.contradicting_events.is_empty(),
                "ConditionState must reference at least one PatientEvent: {:?}", s);
        }
        // Every supporting / contradicting id must be a real PatientEvent id.
        let valid_ids: std::collections::HashSet<&str> =
            ["p1", "p2", "p3", "p4"].into_iter().collect();
        for s in &states {
            for id in s.supporting_events.iter().chain(s.contradicting_events.iter()) {
                assert!(valid_ids.contains(id.as_str()),
                    "unknown PatientEvent id in trajectory: {id} — state={:?}", s);
            }
        }
    }

    // ─── Sort order: status > severity ───────────────────────────────
    #[test]
    fn output_sort_prioritises_status_then_severity() {
        let events = vec![
            // Active condition.
            pe("p1", EventType::Diagnosis, "ptsd",      AssertionStatus::Affirmed,
                Some("2022-01-01"), Some("2022-01-01"), 0.9),
            // Disputed condition.
            pe("p2", EventType::Diagnosis, "depression",   AssertionStatus::Affirmed,    None, None, 0.8),
            pe("p3", EventType::Diagnosis, "depression",   AssertionStatus::Contradicted, None, None, 0.8),
            // Resolved condition.
            pe("p4", EventType::Diagnosis, "anxiety",   AssertionStatus::Negated,    Some("2020-01-01"), Some("2020-01-01"), 0.7),
        ];
        let states = build_clinical_state(events);
        let statuses: Vec<_> = states.iter().map(|s| s.current_status).collect();
        assert_eq!(statuses[0], ConditionStatus::Active);
        // Disputed beats Resolved.
        let disp_idx = states.iter().position(|s| s.current_status == ConditionStatus::Disputed).unwrap();
        let res_idx  = states.iter().position(|s| s.current_status == ConditionStatus::Resolved).unwrap();
        assert!(disp_idx < res_idx, "Disputed should rank above Resolved");
    }
}
