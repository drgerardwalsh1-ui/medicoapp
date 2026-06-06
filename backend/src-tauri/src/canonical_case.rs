//! Canonical Case Reconstruction — schema + Contradiction-Surfacing layer.
//!
//! This is the top-of-stack "legal-grade reconstructed reality model"
//! envelope. It does NOT re-extract or re-infer anything: it is a strictly
//! ADDITIVE assembler that sits ABOVE the existing reconstruction stack
//! (`clinical_events` → `event_unification` → `patient_timeline` →
//! `clinical_state` → `patient_longitudinal_reconciliation` →
//! `clinical_knowledge_graph`) and reshapes their deterministic outputs into
//! the case-level `CanonicalCase` object.
//!
//! SCOPE OF THIS PASS — Contradiction Surfacing only.
//! ---------------------------------------------------
//! The full `CanonicalCase` schema (STEP 6 of the spec) is DESIGNED here so
//! the envelope shape is fixed, but only the `contradictions`,
//! `unresolved_questions`, and `confidence_summary` fields are POPULATED in
//! this pass. The remaining vectors (`injury_events`, `diagnoses`, …,
//! `family_graph`, `timeline`) are typed but left empty — they are filled by
//! later gap-fill passes (family graph; Injury/Family/LegalStatus event
//! types). Each is marked `TODO(gap-fill)`.
//!
//! KEY PRINCIPLE — never overwrite a conflicting fact. The dominant value is
//! recorded as the `canonical_value`, and EVERY other observed value is
//! retained verbatim as an `alternative`, each with its own source list and
//! confidence. Nothing is discarded; the canonical pick is just the
//! best-supported one, fully reversible to its raw mentions.
//!
//! Determinism: pure function of the input graph. No ML, no model calls, no
//! clocks, no randomness. Output ordering is sorted for stable serialisation.

// Additive layer: not yet wired to a Tauri command (mirrors the
// `reason_longitudinal_reconciliation` / `build_clinical_knowledge_graph`
// rollout pattern, where the module lands before its command). The public
// API is exercised by the unit tests below.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::collections::{BTreeMap, BTreeSet};

use crate::clinical_events::EventType;
use crate::family_graph::{build_family_contradictions, FamilyContradiction, FamilyGraph};
use crate::participant_resolution::{identity_ambiguity, Participant};
use crate::patient_longitudinal_reconciliation::{EvolutionTrack, LongitudinalPatientGraph};

// ════════════════════════════════════════════════════════════════════════
// STEP 6 — Canonical Case envelope (schema)
// ════════════════════════════════════════════════════════════════════════

/// The legal-grade reconstructed case model. One per patient corpus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalCase {
    pub subject_profile: SubjectProfile,

    // TODO(gap-fill): assembled from CanonicalPatientEvent (EventType::*) +
    // future Injury/Legal event types. Empty in the contradiction-only pass.
    pub injury_events: Vec<CaseEvent>,
    pub diagnoses: Vec<CaseEvent>,
    pub symptoms: Vec<CaseEvent>,
    pub procedures: Vec<CaseEvent>,

    // STEP 5 — family structure graph (parents/siblings/children, per-edge
    // confidence, contradiction_flag). Built by `family_graph::build_family_graph`
    // and passed into the assembler; empty `FamilyGraph::default()` when no
    // family events are supplied.
    pub family_graph: FamilyGraph,

    // TODO(gap-fill): assembled from patient_longitudinal_reconciliation
    // temporal_edges + dates. Empty in this pass.
    pub timeline: Vec<TimelineEntry>,

    // ── POPULATED in this pass ──────────────────────────────────────────
    /// SINGLE unified, domain-tagged contradiction stream. Clinical and family
    /// contradictions are computed independently and wrapped (never merged at
    /// source); they meet only here, sorted by one comparable key.
    pub contradictions: Vec<CaseContradiction>,
    /// Open questions a human reviewer must resolve, derived from the
    /// lowest-confidence / most-contested contradictions.
    pub unresolved_questions: Vec<UnresolvedQuestion>,
    /// Corpus-level confidence rollup focused on contradiction resolution.
    pub confidence_summary: ConfidenceSummary,
}

/// Minimal subject identity. TODO(gap-fill): assemble from
/// `participant_resolution::PatientIdentity` (names, aliases, DOB).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SubjectProfile {
    pub patient_id: Option<String>,
    pub canonical_name: Option<String>,
    pub aliases: Vec<String>,
    pub date_of_birth: Option<String>,
    pub source_document_ids: Vec<String>,
}

/// Placeholder case-event view. TODO(gap-fill).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseEvent {
    pub event_id: String,
    pub event_type: EventType,
    pub concept: String,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub disputed: bool,
    pub source_unified_event_ids: Vec<String>,
}

/// Placeholder timeline entry. TODO(gap-fill) — STEP 4 assembly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEntry {
    pub date: Option<String>,
    pub label: String,
    pub source_unified_event_ids: Vec<String>,
}

// ════════════════════════════════════════════════════════════════════════
// Contradiction model (STEP 3 — surfaced, not resolved-by-deletion)
// ════════════════════════════════════════════════════════════════════════

/// What KIND of disagreement this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictDimension {
    /// Assertion-status disagreement (affirmed vs negated vs differential …).
    /// The only dimension surfaced in this pass — it is what the existing
    /// `assertion_distribution` / `conflict_flag` machinery already tracks.
    Assertion,
    /// Date / timing disagreement. TODO(gap-fill).
    Timing,
    /// Discrete-value disagreement (e.g. "2 children" vs "3 children").
    /// TODO(gap-fill) — needs the value extractors, not present yet.
    Value,
}

impl ConflictDimension {
    pub fn as_str(self) -> &'static str {
        match self {
            ConflictDimension::Assertion => "assertion",
            ConflictDimension::Timing => "timing",
            ConflictDimension::Value => "value",
        }
    }
}

/// A single source that asserted a particular value, with context for audit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContradictionSource {
    /// Source label (document id / evolution-step source).
    pub source: String,
    pub date: Option<String>,
    /// Verbatim context snippet from the evolution step (provenance).
    pub context: String,
}

/// One observed value within a contradiction (canonical OR alternative),
/// with how strongly it is supported and by whom.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContradictionValue {
    /// The value itself — for assertion conflicts, a snake_case
    /// `AssertionStatus` (e.g. "affirmed", "negated").
    pub value: String,
    /// Number of corpus observations supporting this value.
    pub support_count: u32,
    /// Share of total support in `[0,1]` — this value's local confidence.
    pub confidence: f32,
    /// Every source that asserted this value (sorted; never deduped away).
    pub sources: Vec<ContradictionSource>,
}

/// A flattened, legal-grade contradiction. The dominant value is canonical;
/// every conflicting value survives as an alternative. NOTHING is deleted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contradiction {
    pub contradiction_id: String,
    pub dimension: ConflictDimension,
    /// The concept under dispute (normalised), e.g. "ptsd".
    pub subject: String,
    pub event_type: EventType,

    /// Currently-favoured value — the best-supported one, NOT a deletion of
    /// the rest.
    pub canonical_value: ContradictionValue,
    /// Every other observed value, retained verbatim.
    pub alternatives: Vec<ContradictionValue>,

    /// Mirrors the upstream `CanonicalPatientEvent.conflict_flag`: true iff
    /// genuinely conflicting assertion classes coexist.
    pub conflict_flag: bool,

    /// `[0,1]` — how dominant the canonical pick is (canonical support ÷
    /// total support). Low ⇒ heavily contested ⇒ low trust in the pick.
    pub resolution_confidence: f32,

    // Full provenance back through the layer stack.
    pub source_unified_event_ids: Vec<String>,
    pub source_patient_event_ids: Vec<String>,

    pub metadata: JsonValue,
}

// ════════════════════════════════════════════════════════════════════════
// STEP-6 unified contradiction stream (domain-tagged, never merged at source)
// ════════════════════════════════════════════════════════════════════════

/// Which ontology a surfaced contradiction came from. Clinical and Family are
/// computed independently and never share grouping or confidence — they meet
/// ONLY here, in the presentation stream. Declared Clinical-first so it sorts
/// before Family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContradictionDomain {
    Clinical,
    Family,
}

impl ContradictionDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            ContradictionDomain::Clinical => "clinical",
            ContradictionDomain::Family => "family",
        }
    }
}

/// The full typed contradiction, preserved verbatim inside the wrapper (no
/// field loss — provenance, alternatives, metadata all retained).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CaseContradictionBody {
    Clinical(Contradiction),
    Family(FamilyContradiction),
}

/// One entry in `CanonicalCase.contradictions[]`. The comparable header
/// (`domain`, `conflict_label`, `subject`, `resolution_confidence`,
/// `contradiction_id`) drives a single deterministic sort across both
/// ontologies; `body` carries the untouched typed object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseContradiction {
    pub domain: ContradictionDomain,
    pub contradiction_id: String,
    /// Clinical `dimension` or family `conflict_type`, as a string.
    pub conflict_label: String,
    pub subject: String,
    /// Shared [0,1] scale — identical `dominant/total` semantics in both
    /// domains, so cross-domain comparison/sorting is valid.
    pub resolution_confidence: f32,
    pub body: CaseContradictionBody,
}

impl CaseContradiction {
    fn from_clinical(c: Contradiction) -> Self {
        CaseContradiction {
            domain: ContradictionDomain::Clinical,
            contradiction_id: c.contradiction_id.clone(),
            conflict_label: c.dimension.as_str().to_string(),
            subject: c.subject.clone(),
            resolution_confidence: c.resolution_confidence,
            body: CaseContradictionBody::Clinical(c),
        }
    }
    fn from_family(f: FamilyContradiction) -> Self {
        CaseContradiction {
            domain: ContradictionDomain::Family,
            contradiction_id: f.contradiction_id.clone(),
            conflict_label: f.conflict_type.as_str().to_string(),
            subject: f.subject.clone(),
            resolution_confidence: f.resolution_confidence,
            body: CaseContradictionBody::Family(f),
        }
    }
}

/// An open question for a human reviewer, derived from a contested
/// contradiction whose canonical pick is not confident enough to stand alone.
/// Domain-agnostic — applies identically to clinical and family entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnresolvedQuestion {
    pub question: String,
    pub domain: ContradictionDomain,
    pub conflict_label: String,
    pub subject: String,
    pub related_contradiction_id: String,
    /// Lower ⇒ more urgent to resolve.
    pub resolution_confidence: f32,
}

/// Corpus-level confidence rollup over the unified contradiction stream.
/// Per-domain counts are tracked separately; cross-domain pairs are never
/// co-counted into a single figure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfidenceSummary {
    pub canonical_event_count: usize,
    pub contradiction_count: usize,
    pub clinical_contradiction_count: usize,
    pub family_contradiction_count: usize,
    /// Domain-qualified disputed labels, e.g. "clinical:assertion",
    /// "family:cardinality". Sorted, deterministic.
    pub disputed_labels: Vec<String>,
    /// Mean `resolution_confidence` across all contradictions (1.0 if none).
    pub mean_resolution_confidence: f32,
    /// Most-contested subjects first (ascending resolution_confidence).
    pub lowest_confidence_subjects: Vec<LowConfidenceSubject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LowConfidenceSubject {
    pub domain: ContradictionDomain,
    pub subject: String,
    pub conflict_label: String,
    pub resolution_confidence: f32,
}

// ════════════════════════════════════════════════════════════════════════
// Assembler
// ════════════════════════════════════════════════════════════════════════

/// Questions are only raised when the canonical pick is genuinely shaky.
const UNRESOLVED_QUESTION_THRESHOLD: f32 = 0.75;
/// Cap on how many subjects are listed in `lowest_confidence_subjects`.
const LOW_CONFIDENCE_LIST_CAP: usize = 10;

/// Assemble the case-level envelope from a `LongitudinalPatientGraph`.
/// Only the contradiction-related fields are populated in this pass.
pub fn assemble_canonical_case(
    graph: &LongitudinalPatientGraph,
    subject_profile: SubjectProfile,
    family_graph: FamilyGraph,
    participants: &[Participant],
    timeline_entries: Vec<TimelineEntry>,
) -> CanonicalCase {
    // Derive the advisory identity-ambiguity signal from resolved participants
    // (strictly additive; does not merge or alter resolution). An empty
    // `participants` slice yields an empty set ⇒ behaviour unchanged.
    let ambiguity = identity_ambiguity(participants, &[]).participant_id_set();
    let contradictions = build_case_contradictions(graph, &family_graph, &ambiguity);
    let unresolved_questions = build_unresolved_questions(&contradictions);
    let confidence_summary = summarise_confidence(graph, &contradictions);

    CanonicalCase {
        subject_profile,
        injury_events: Vec::new(),
        diagnoses: Vec::new(),
        symptoms: Vec::new(),
        procedures: Vec::new(),
        family_graph,
        // Pure pass-through: timeline entries (e.g. legal status) are carried
        // verbatim — no transformation, sorting, filtering, or contradiction
        // participation. They never touch the contradiction stream above.
        timeline: timeline_entries,
        contradictions,
        unresolved_questions,
        confidence_summary,
    }
}

/// Build the unified, domain-tagged STEP-6 contradiction stream. Clinical and
/// family contradictions are computed INDEPENDENTLY (disjoint inputs, no shared
/// grouping, no cross-domain confidence effect), wrapped, then sorted by ONE
/// comparable key. This is the only place the two ontologies meet.
pub fn build_case_contradictions(
    graph: &LongitudinalPatientGraph,
    family_graph: &FamilyGraph,
    identity_ambiguity: &BTreeSet<String>,
) -> Vec<CaseContradiction> {
    let mut out: Vec<CaseContradiction> = Vec::new();
    for c in build_contradictions(graph) {
        out.push(CaseContradiction::from_clinical(c));
    }
    for f in build_family_contradictions(family_graph, identity_ambiguity) {
        out.push(CaseContradiction::from_family(f));
    }
    sort_case_contradictions(&mut out);
    out
}

/// Single sort applied to BOTH domains:
/// resolution_confidence ASC → domain (Clinical<Family) → conflict_label →
/// subject → contradiction_id.
fn sort_case_contradictions(items: &mut [CaseContradiction]) {
    items.sort_by(|a, b| {
        a.resolution_confidence
            .partial_cmp(&b.resolution_confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.domain.cmp(&b.domain))
            .then(a.conflict_label.cmp(&b.conflict_label))
            .then(a.subject.cmp(&b.subject))
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });
}

/// Flatten the longitudinal graph's assertion conflicts into legal-grade
/// `Contradiction`s. A canonical event is surfaced when it is flagged as
/// conflicting OR carries more than one distinct assertion status (genuine
/// disagreement). Single-status, unflagged events are NOT contradictions.
pub fn build_contradictions(graph: &LongitudinalPatientGraph) -> Vec<Contradiction> {
    // Index evolution tracks by canonical_id for per-status source attribution.
    let tracks: BTreeMap<&str, &EvolutionTrack> = graph
        .evolution_tracks
        .iter()
        .map(|t| (t.canonical_id.as_str(), t))
        .collect();

    let mut out: Vec<Contradiction> = Vec::new();

    for ev in &graph.canonical_events {
        let distinct_statuses = ev.assertion_distribution.len();
        if !ev.conflict_flag && distinct_statuses <= 1 {
            continue; // No disagreement → not a contradiction.
        }

        let total_support: u32 = ev.assertion_distribution.values().copied().sum();
        if total_support == 0 {
            continue; // Defensive: nothing to weigh.
        }

        // Per-status source attribution from the evolution timeline.
        let steps = tracks
            .get(ev.canonical_id.as_str())
            .map(|t| t.timeline.as_slice())
            .unwrap_or(&[]);

        let dominant_key = ev.dominant_assertion.as_str().to_string();

        let make_value = |status_key: &str, count: u32| -> ContradictionValue {
            let mut sources: Vec<ContradictionSource> = steps
                .iter()
                .filter(|s| s.assertion.as_str() == status_key)
                .map(|s| ContradictionSource {
                    source: s.source.clone(),
                    date: s.date.clone(),
                    context: s.context.clone(),
                })
                .collect();
            // Stable, deduplicated ordering — but identical-source/different-
            // context rows are KEPT (distinct evidence), only exact dupes drop.
            sources.sort_by(|a, b| {
                a.date
                    .cmp(&b.date)
                    .then(a.source.cmp(&b.source))
                    .then(a.context.cmp(&b.context))
            });
            sources.dedup();
            ContradictionValue {
                value: status_key.to_string(),
                support_count: count,
                confidence: round3(count as f32 / total_support as f32),
                sources,
            }
        };

        // Canonical = dominant assertion. If (defensively) the dominant key is
        // absent from the distribution, fall back to the highest-count status.
        let canonical_count = ev
            .assertion_distribution
            .get(&dominant_key)
            .copied()
            .unwrap_or(0);
        let canonical_value = make_value(&dominant_key, canonical_count);

        // Alternatives = every other status, sorted by descending support then
        // status name for determinism. Nothing dropped.
        let mut alternatives: Vec<ContradictionValue> = ev
            .assertion_distribution
            .iter()
            .filter(|(k, _)| k.as_str() != dominant_key)
            .map(|(k, c)| make_value(k, *c))
            .collect();
        alternatives.sort_by(|a, b| {
            b.support_count
                .cmp(&a.support_count)
                .then(a.value.cmp(&b.value))
        });

        let resolution_confidence = round3(canonical_count as f32 / total_support as f32);

        out.push(Contradiction {
            contradiction_id: format!("contradiction::{}", ev.canonical_id),
            dimension: ConflictDimension::Assertion,
            subject: ev.concept.clone(),
            event_type: ev.event_type,
            canonical_value,
            alternatives,
            conflict_flag: ev.conflict_flag,
            resolution_confidence,
            source_unified_event_ids: ev.unified_event_ids.clone(),
            source_patient_event_ids: ev.patient_event_ids.clone(),
            metadata: json!({
                "total_support": total_support,
                "distinct_statuses": distinct_statuses,
                "stability_score": ev.stability_score,
                "dominant_assertion": dominant_key,
            }),
        });
    }

    // Deterministic output order: most-contested first, then subject/type.
    out.sort_by(|a, b| {
        a.resolution_confidence
            .partial_cmp(&b.resolution_confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.subject.cmp(&b.subject))
            .then(a.event_type.as_str().cmp(b.event_type.as_str()))
    });
    out
}

/// Raise a reviewer question for each contradiction (either domain) whose
/// canonical pick is below the confidence threshold. Pulls canonical +
/// alternative detail from the preserved typed `body`.
pub fn build_unresolved_questions(contradictions: &[CaseContradiction]) -> Vec<UnresolvedQuestion> {
    contradictions
        .iter()
        .filter(|c| c.resolution_confidence < UNRESOLVED_QUESTION_THRESHOLD)
        .map(|c| {
            let (canonical, alts) = match &c.body {
                CaseContradictionBody::Clinical(cl) => (
                    format!("{} ({})", cl.canonical_value.value, cl.canonical_value.support_count),
                    cl.alternatives
                        .iter()
                        .map(|a| format!("{} ({})", a.value, a.support_count))
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
                CaseContradictionBody::Family(f) => (
                    format!("{} ({})", f.canonical_value.value, f.canonical_value.support_count),
                    f.alternatives
                        .iter()
                        .map(|a| format!("{} ({})", a.value, a.support_count))
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
            };
            UnresolvedQuestion {
                question: format!(
                    "Which {} ({}) value is correct for '{}'? Canonical = {}; contested by: {}.",
                    c.conflict_label,
                    c.domain.as_str(),
                    c.subject,
                    canonical,
                    if alts.is_empty() { "—".to_string() } else { alts },
                ),
                domain: c.domain,
                conflict_label: c.conflict_label.clone(),
                subject: c.subject.clone(),
                related_contradiction_id: c.contradiction_id.clone(),
                resolution_confidence: c.resolution_confidence,
            }
        })
        .collect()
}

/// Corpus-level confidence rollup over the unified stream. Per-domain counts
/// are tracked separately; cross-domain pairs are never co-counted.
pub fn summarise_confidence(
    graph: &LongitudinalPatientGraph,
    contradictions: &[CaseContradiction],
) -> ConfidenceSummary {
    let mut disputed: BTreeSet<String> = BTreeSet::new();
    let mut clinical_n = 0usize;
    let mut family_n = 0usize;
    for c in contradictions {
        disputed.insert(format!("{}:{}", c.domain.as_str(), c.conflict_label));
        match c.domain {
            ContradictionDomain::Clinical => clinical_n += 1,
            ContradictionDomain::Family => family_n += 1,
        }
    }

    let mean = if contradictions.is_empty() {
        1.0
    } else {
        let sum: f32 = contradictions.iter().map(|c| c.resolution_confidence).sum();
        round3(sum / contradictions.len() as f32)
    };

    // Stream is already sorted ascending by resolution_confidence.
    let lowest_confidence_subjects = contradictions
        .iter()
        .take(LOW_CONFIDENCE_LIST_CAP)
        .map(|c| LowConfidenceSubject {
            domain: c.domain,
            subject: c.subject.clone(),
            conflict_label: c.conflict_label.clone(),
            resolution_confidence: c.resolution_confidence,
        })
        .collect();

    ConfidenceSummary {
        canonical_event_count: graph.canonical_events.len(),
        contradiction_count: contradictions.len(),
        clinical_contradiction_count: clinical_n,
        family_contradiction_count: family_n,
        disputed_labels: disputed.into_iter().collect(),
        mean_resolution_confidence: mean,
        lowest_confidence_subjects,
    }
}

/// Round to 3 dp for stable, readable confidence values.
fn round3(f: f32) -> f32 {
    (f * 1000.0).round() / 1000.0
}

// ════════════════════════════════════════════════════════════════════════
// Tests — synthetic LongitudinalPatientGraph inputs (no real cases).
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::AssertionStatus;
    use crate::patient_longitudinal_reconciliation::{CanonicalPatientEvent, EvolutionStep};

    fn step(date: Option<&str>, status: AssertionStatus, source: &str, ctx: &str) -> EvolutionStep {
        EvolutionStep {
            date: date.map(|s| s.to_string()),
            assertion: status,
            source: source.to_string(),
            context: ctx.to_string(),
        }
    }

    fn canon(
        canonical_id: &str,
        event_type: EventType,
        concept: &str,
        dist: &[(AssertionStatus, u32)],
        dominant: AssertionStatus,
        conflict: bool,
    ) -> CanonicalPatientEvent {
        let mut assertion_distribution = BTreeMap::new();
        for (s, c) in dist {
            assertion_distribution.insert(s.as_str().to_string(), *c);
        }
        CanonicalPatientEvent {
            canonical_id: canonical_id.to_string(),
            event_type,
            concept: concept.to_string(),
            first_seen: None,
            last_seen: None,
            total_occurrences: dist.iter().map(|(_, c)| *c).sum(),
            document_count: 2,
            assertion_distribution,
            unified_event_ids: vec!["u1".into(), "u2".into()],
            patient_event_ids: vec!["p1".into()],
            dominant_assertion: dominant,
            conflict_flag: conflict,
            stability_score: 0.5,
            metadata: json!({}),
        }
    }

    fn graph(
        canonical_events: Vec<CanonicalPatientEvent>,
        evolution_tracks: Vec<EvolutionTrack>,
    ) -> LongitudinalPatientGraph {
        LongitudinalPatientGraph {
            patient_id: Some("patient#1".into()),
            canonical_events,
            temporal_edges: Vec::new(),
            cross_domain_links: Vec::new(),
            evolution_tracks,
        }
    }

    #[test]
    fn conflicting_diagnosis_surfaces_with_all_alternatives_retained() {
        // PTSD: affirmed x2 (dominant) vs negated x1 vs differential x1.
        let cid = "canonical#diagnosis#ptsd";
        let ev = canon(
            cid,
            EventType::Diagnosis,
            "ptsd",
            &[
                (AssertionStatus::Affirmed, 2),
                (AssertionStatus::Negated, 1),
                (AssertionStatus::Differential, 1),
            ],
            AssertionStatus::Affirmed,
            true,
        );
        let track = EvolutionTrack {
            canonical_id: cid.to_string(),
            timeline: vec![
                step(Some("2020-01-01"), AssertionStatus::Affirmed, "psychiatrist_report", "PTSD confirmed"),
                step(Some("2020-06-01"), AssertionStatus::Affirmed, "treating_psych", "ongoing PTSD"),
                step(Some("2021-01-01"), AssertionStatus::Negated, "insurer_ime", "does not meet PTSD criteria"),
                step(Some("2021-03-01"), AssertionStatus::Differential, "gp_note", "?PTSD vs adjustment"),
            ],
        };
        let g = graph(vec![ev], vec![track]);

        let contradictions = build_contradictions(&g);
        assert_eq!(contradictions.len(), 1);
        let c = &contradictions[0];

        assert_eq!(c.dimension, ConflictDimension::Assertion);
        assert_eq!(c.subject, "ptsd");
        assert_eq!(c.event_type, EventType::Diagnosis);
        assert!(c.conflict_flag);

        // Canonical = dominant (affirmed), 2 obs, 2/4 = 0.5 confidence.
        assert_eq!(c.canonical_value.value, "affirmed");
        assert_eq!(c.canonical_value.support_count, 2);
        assert!((c.canonical_value.confidence - 0.5).abs() < 1e-6);
        assert_eq!(c.canonical_value.sources.len(), 2);
        assert!((c.resolution_confidence - 0.5).abs() < 1e-6);

        // No data deleted: both non-dominant statuses survive as alternatives.
        assert_eq!(c.alternatives.len(), 2);
        let alt_values: Vec<&str> = c.alternatives.iter().map(|a| a.value.as_str()).collect();
        assert!(alt_values.contains(&"negated"));
        assert!(alt_values.contains(&"differential"));
        // Total support across canonical + alternatives == full distribution.
        let surfaced: u32 = c.canonical_value.support_count
            + c.alternatives.iter().map(|a| a.support_count).sum::<u32>();
        assert_eq!(surfaced, 4);

        // Alternatives carry their own source attribution.
        let negated = c.alternatives.iter().find(|a| a.value == "negated").unwrap();
        assert_eq!(negated.sources.len(), 1);
        assert_eq!(negated.sources[0].source, "insurer_ime");
    }

    #[test]
    fn unanimous_event_is_not_a_contradiction() {
        let ev = canon(
            "canonical#symptom#insomnia",
            EventType::Symptom,
            "insomnia",
            &[(AssertionStatus::SymptomOnly, 3)],
            AssertionStatus::SymptomOnly,
            false,
        );
        let g = graph(vec![ev], vec![]);
        assert!(build_contradictions(&g).is_empty());
    }

    #[test]
    fn multi_status_without_flag_still_surfaces() {
        // Two distinct statuses but conflict_flag=false → still a disagreement.
        let ev = canon(
            "canonical#diagnosis#depression",
            EventType::Diagnosis,
            "depression",
            &[(AssertionStatus::Affirmed, 3), (AssertionStatus::Historical, 1)],
            AssertionStatus::Affirmed,
            false,
        );
        let g = graph(vec![ev], vec![]);
        let cs = build_contradictions(&g);
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].alternatives.len(), 1);
        assert_eq!(cs[0].alternatives[0].value, "historical");
        // 3/4 → above the 0.75 question threshold (0.75 is exclusive).
        assert!((cs[0].resolution_confidence - 0.75).abs() < 1e-6);
    }

    #[test]
    fn unresolved_questions_only_for_low_confidence() {
        let contested = canon(
            "canonical#diagnosis#ptsd",
            EventType::Diagnosis,
            "ptsd",
            &[(AssertionStatus::Affirmed, 1), (AssertionStatus::Negated, 1)],
            AssertionStatus::Affirmed,
            true,
        );
        let confident = canon(
            "canonical#diagnosis#anxiety",
            EventType::Diagnosis,
            "anxiety",
            &[(AssertionStatus::Affirmed, 9), (AssertionStatus::Negated, 1)],
            AssertionStatus::Affirmed,
            true,
        );
        let g = graph(vec![contested, confident], vec![]);
        let cs = build_case_contradictions(&g, &FamilyGraph::default(), &BTreeSet::new());
        let qs = build_unresolved_questions(&cs);

        // contested: 1/2 = 0.5 < 0.75 → question. confident: 9/10 = 0.9 → none.
        assert_eq!(qs.len(), 1);
        assert_eq!(qs[0].subject, "ptsd");
        assert_eq!(qs[0].domain, ContradictionDomain::Clinical);
        assert!(qs[0].question.contains("ptsd"));
        assert!(qs[0].question.contains("negated"));
    }

    #[test]
    fn assemble_fills_only_contradiction_fields_and_is_deterministic() {
        let ev = canon(
            "canonical#diagnosis#ptsd",
            EventType::Diagnosis,
            "ptsd",
            &[(AssertionStatus::Affirmed, 2), (AssertionStatus::Negated, 2)],
            AssertionStatus::Affirmed,
            true,
        );
        let g = graph(vec![ev], vec![]);

        let case1 = assemble_canonical_case(&g, SubjectProfile::default(), FamilyGraph::default(), &[], Vec::new());
        let case2 = assemble_canonical_case(&g, SubjectProfile::default(), FamilyGraph::default(), &[], Vec::new());

        // Deterministic JSON.
        let j1 = serde_json::to_string(&case1).unwrap();
        let j2 = serde_json::to_string(&case2).unwrap();
        assert_eq!(j1, j2);

        // Contradiction fields populated; other envelope fields empty (deferred).
        assert_eq!(case1.contradictions.len(), 1);
        assert!(case1.injury_events.is_empty());
        assert!(case1.diagnoses.is_empty());
        assert!(case1.symptoms.is_empty());
        assert!(case1.procedures.is_empty());
        assert!(case1.timeline.is_empty());
        assert!(case1.family_graph.edges.is_empty());

        // Confidence summary reflects the single contested event.
        let cs = &case1.confidence_summary;
        assert_eq!(cs.canonical_event_count, 1);
        assert_eq!(cs.contradiction_count, 1);
        assert_eq!(cs.clinical_contradiction_count, 1);
        assert_eq!(cs.family_contradiction_count, 0);
        assert_eq!(cs.disputed_labels, vec!["clinical:assertion".to_string()]);
        assert!((cs.mean_resolution_confidence - 0.5).abs() < 1e-6);
        assert_eq!(cs.lowest_confidence_subjects.len(), 1);
        assert_eq!(cs.lowest_confidence_subjects[0].subject, "ptsd");
        assert_eq!(cs.lowest_confidence_subjects[0].domain, ContradictionDomain::Clinical);
    }

    #[test]
    fn family_graph_integrates_into_canonical_envelope() {
        use crate::family_graph::{
            build_family_graph, FamilyEdgeStatus, FamilyEvent, FamilyEventPayload, FamilyRelation,
            SourceRef,
        };

        // Conflicting cardinality ("2 children" vs "3 children") → 2 edges.
        let mk_ev = |id: &str, card: u32, source: &str| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::ParentOf,
                subject: "patient#1".to_string(),
                target: None,
                cardinality: Some(card),
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef {
                source: source.to_string(),
                date: None,
                context: "ctx".to_string(),
            }],
            confidence: 0.9,
        };
        let fam = build_family_graph(
            &[],
            None,
            vec![mk_ev("e1", 2, "gp_note"), mk_ev("e2", 3, "insurer")],
        );

        let g = graph(vec![], vec![]); // no clinical contradictions
        let case = assemble_canonical_case(&g, SubjectProfile::default(), fam, &[], Vec::new());

        // Family graph carried through, conflict preserved as separate edges.
        assert_eq!(case.family_graph.edges.len(), 2);
        assert!(case.family_graph.edges.iter().all(|e| e.contradiction_flag));

        // The family cardinality conflict surfaces in the UNIFIED stream,
        // domain-tagged Family, with no clinical contradictions present.
        assert_eq!(case.contradictions.len(), 1);
        assert_eq!(case.contradictions[0].domain, ContradictionDomain::Family);
        assert_eq!(case.contradictions[0].conflict_label, "cardinality");
        assert_eq!(case.confidence_summary.family_contradiction_count, 1);
        assert_eq!(case.confidence_summary.clinical_contradiction_count, 0);

        // Envelope still serialises deterministically end-to-end.
        let j = serde_json::to_string(&case).unwrap();
        assert!(j.contains("family_graph"));
    }

    // Helper: a same-pair Sibling+Spouse conflict whose endpoints are the
    // given participant ids. Relational by default; becomes Identity iff one
    // endpoint is flagged ambiguous.
    #[cfg(test)]
    fn sibling_spouse_conflict(target_id: &str) -> crate::family_graph::FamilyGraph {
        use crate::family_graph::{
            build_family_graph, FamilyEdgeStatus, FamilyEvent, FamilyEventPayload, FamilyRelation,
            SourceRef,
        };
        let ev = |id: &str, rel: FamilyRelation, source: &str| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: rel,
                subject: "patient#1".to_string(),
                target: Some(target_id.to_string()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: source.to_string(), date: None, context: "c".into() }],
            confidence: 0.9,
        };
        build_family_graph(
            &[],
            None,
            vec![
                ev("e1", FamilyRelation::SiblingOf, "doc_a"),
                ev("e2", FamilyRelation::SpouseOf, "doc_b"),
            ],
        )
    }

    // Case E.C (regression) — with NO participants, no ambiguity is derived, so
    // a same-pair relation conflict surfaces as Relational (unchanged behaviour).
    #[test]
    fn family_conflict_without_ambiguity_is_relational_via_assemble() {
        let fam = sibling_spouse_conflict("participant:smith");
        let g = graph(vec![], vec![]);
        let case = assemble_canonical_case(&g, SubjectProfile::default(), fam, &[], Vec::new());

        assert_eq!(case.contradictions.len(), 1);
        assert_eq!(case.contradictions[0].domain, ContradictionDomain::Family);
        assert_eq!(case.contradictions[0].conflict_label, "relational");
    }

    // Case E.B (reachability) — Identity is REACHABLE through assemble when
    // grounded in STRUCTURED overlap. Two distinct participants share a DOB →
    // identity_ambiguity flags them; the family conflict whose endpoint is the
    // ambiguous id is re-labelled Identity, domain Family.
    #[test]
    fn family_identity_reachable_via_assemble() {
        use crate::participant_resolution::{Participant, ParticipantRole};
        let participants = vec![
            Participant {
                participant_id: "participant:john-smith".into(),
                name: "John Smith".into(),
                role: ParticipantRole::Unknown,
                source_document_ids: vec!["d1".into()],
                organisations: vec![],
                metadata: json!({ "date_of_birth": "1980-05-01" }),
            },
            Participant {
                participant_id: "participant:jane-smith".into(),
                name: "Jane Smith".into(),
                role: ParticipantRole::Unknown,
                source_document_ids: vec!["d2".into()],
                organisations: vec![],
                metadata: json!({ "date_of_birth": "1980-05-01" }),
            },
        ];
        // Endpoint "participant:jane-smith" is in the (DOB-grounded) ambiguity set.
        let fam = sibling_spouse_conflict("participant:jane-smith");
        let g = graph(vec![], vec![]);
        let case = assemble_canonical_case(&g, SubjectProfile::default(), fam, &participants, Vec::new());

        assert_eq!(case.contradictions.len(), 1);
        let c = &case.contradictions[0];
        assert_eq!(c.domain, ContradictionDomain::Family);
        assert_eq!(c.conflict_label, "identity");
        // Provenance preserved: endpoint id retained in the body.
        if let CaseContradictionBody::Family(f) = &c.body {
            assert!(f.pair.1.as_deref() == Some("patient#1") || f.pair.0 == "participant:jane-smith");
            assert!(!f.edge_ids.is_empty());
        } else {
            panic!("expected family body");
        }
    }

    #[test]
    fn output_sorted_most_contested_first() {
        let a = canon(
            "canonical#diagnosis#a",
            EventType::Diagnosis,
            "a",
            &[(AssertionStatus::Affirmed, 4), (AssertionStatus::Negated, 1)], // 0.8
            AssertionStatus::Affirmed,
            true,
        );
        let b = canon(
            "canonical#diagnosis#b",
            EventType::Diagnosis,
            "b",
            &[(AssertionStatus::Affirmed, 1), (AssertionStatus::Negated, 1)], // 0.5
            AssertionStatus::Affirmed,
            true,
        );
        let g = graph(vec![a, b], vec![]);
        let cs = build_contradictions(&g);
        assert_eq!(cs.len(), 2);
        // Most contested (b, 0.5) before less contested (a, 0.8).
        assert_eq!(cs[0].subject, "b");
        assert_eq!(cs[1].subject, "a");
    }

    // ── Cross-domain confidence alignment ───────────────────────────────────

    // The clinical and family layers must compute resolution_confidence with
    // the IDENTICAL observation-weighted dominant/total formula. A 3:1 split
    // yields 0.75 in BOTH domains.
    #[test]
    fn clinical_and_family_confidence_use_identical_formula() {
        // Clinical: affirmed x3 vs negated x1 → 3/4.
        let clin = build_contradictions(&graph(
            vec![canon(
                "canonical#diagnosis#ptsd",
                EventType::Diagnosis,
                "ptsd",
                &[(AssertionStatus::Affirmed, 3), (AssertionStatus::Negated, 1)],
                AssertionStatus::Affirmed,
                true,
            )],
            vec![],
        ));
        assert_eq!(clin.len(), 1);
        assert!((clin[0].resolution_confidence - 0.75).abs() < 1e-6);

        // Family: 3 ParentOf observations vs 1 SiblingOf → 3/4 (observation-weighted).
        use crate::family_graph::{
            build_family_contradictions, build_family_graph, FamilyEdgeStatus, FamilyEvent,
            FamilyEventPayload, FamilyRelation, SourceRef,
        };
        let mk = |id: &str, rel: FamilyRelation, source: &str| FamilyEvent {
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
        let fam_graph = build_family_graph(
            &[],
            None,
            vec![
                mk("p0", FamilyRelation::ParentOf, "doc_a"),
                mk("p1", FamilyRelation::ParentOf, "doc_a"),
                mk("p2", FamilyRelation::ParentOf, "doc_a"),
                mk("s0", FamilyRelation::SiblingOf, "doc_b"),
            ],
        );
        let fam = build_family_contradictions(&fam_graph, &std::collections::BTreeSet::new());
        assert_eq!(fam.len(), 1);
        assert!((fam[0].resolution_confidence - 0.75).abs() < 1e-6);

        // Cross-domain numerical identity.
        assert!((clin[0].resolution_confidence - fam[0].resolution_confidence).abs() < 1e-6);
    }

    // ── Unified-stream sorting stability across domains ──────────────────────

    #[test]
    fn case_contradiction_sort_order_and_stability_across_domains() {
        // Clinical: a @0.8, b @0.5.
        let g = graph(
            vec![
                canon("canonical#diagnosis#a", EventType::Diagnosis, "a",
                    &[(AssertionStatus::Affirmed, 4), (AssertionStatus::Negated, 1)],
                    AssertionStatus::Affirmed, true),
                canon("canonical#diagnosis#b", EventType::Diagnosis, "b",
                    &[(AssertionStatus::Affirmed, 1), (AssertionStatus::Negated, 1)],
                    AssertionStatus::Affirmed, true),
            ],
            vec![],
        );
        // Family: cardinality 2 vs 3 → 0.5.
        use crate::family_graph::{
            build_family_graph, FamilyEdgeStatus, FamilyEvent, FamilyEventPayload, FamilyRelation,
            SourceRef,
        };
        let card = |id: &str, c: u32, source: &str| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::ParentOf,
                subject: "patient#1".into(),
                target: None,
                cardinality: Some(c),
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: source.into(), date: None, context: "c".into() }],
            confidence: 0.9,
        };
        let fam = build_family_graph(&[], None, vec![card("e1", 2, "gp"), card("e2", 3, "ins")]);

        let stream = build_case_contradictions(&g, &fam, &std::collections::BTreeSet::new());
        assert_eq!(stream.len(), 3);

        // Sort: resolution ASC, then domain (Clinical < Family), then label/subject.
        // Two 0.5 entries: clinical "b" before family; then clinical "a" @0.8.
        assert_eq!(stream[0].domain, ContradictionDomain::Clinical);
        assert_eq!(stream[0].subject, "b");
        assert!((stream[0].resolution_confidence - 0.5).abs() < 1e-6);

        assert_eq!(stream[1].domain, ContradictionDomain::Family);
        assert!((stream[1].resolution_confidence - 0.5).abs() < 1e-6);

        assert_eq!(stream[2].domain, ContradictionDomain::Clinical);
        assert_eq!(stream[2].subject, "a");
        assert!((stream[2].resolution_confidence - 0.8).abs() < 1e-6);

        // Stability: rebuilding yields a byte-identical ordering.
        let stream2 = build_case_contradictions(&g, &fam, &std::collections::BTreeSet::new());
        assert_eq!(
            serde_json::to_string(&stream).unwrap(),
            serde_json::to_string(&stream2).unwrap()
        );
    }
}
