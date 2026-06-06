//! STEP 5 — Family Graph Model + contradiction-binding layer.
//!
//! A strictly ADDITIVE projection that turns family *events* into a temporal,
//! source-attributed relationship graph for medico-legal reconstruction. It is
//! a PROJECTION, not a reasoning engine: it never overwrites or collapses
//! conflicting family facts, never infers a "best-guess" family tree, and
//! runs no ML / probabilistic guessing.
//!
//! Reuse + boundaries with the existing stack:
//!   - Nodes wrap `participant_resolution::Participant` / `PatientIdentity`.
//!   - The graph is built ONLY from participants + family events (never raw
//!     text): every family statement must first become a `FamilyEvent`.
//!   - Contradictions are NOT recomputed here. Each family-fact group is
//!     reconciled with the SAME deterministic contract the reconciliation
//!     layer uses (`patient_longitudinal_reconciliation`): a conflict exists
//!     when affirmed-class and denied-class assertions coexist (mirrors
//!     affirmed-vs-contradicted), and `resolution_confidence = dominant
//!     support ÷ total support` (the identical formula used in
//!     `canonical_case::build_contradictions`). No duplicate engine — the same
//!     rule, applied to the family domain.
//!
//! Deliberate deviations from the literal task spec, forced by the
//! strictly-additive invariant (see CANONICAL_CASE / module review notes):
//!   * NOT a new `EventType::FamilyEvent(..)` variant — `EventType` is a
//!     `Copy` C-like enum; a payload variant would strip `Copy` and break
//!     every match/serde site across 6 modules. `FamilyEvent` is a dedicated
//!     type instead (same semantics: graph is built from events).
//!   * `FamilyEdgeStatus` is a dedicated enum (Affirmed|Disputed|Denied|
//!     Inferred) — the clinical `AssertionStatus` has a different variant set.
//!   * `adjacency_index` is a `BTreeMap` (not `HashMap`) for deterministic
//!     serialisation, consistent with the rest of the stack.
//!
//! CONTRADICTION PRESERVATION (critical): when family facts conflict, EVERY
//! variant is retained as its OWN edge (e.g. "2 children" and "3 children"
//! become two ChildOf edges, both `contradiction_flag = true`). The graph
//! surfaces the disagreement; it never resolves it.
//!
//! Determinism: pure function of (participants, patient, family_events). No
//! clocks, no randomness, sorted output.

// Additive layer: not yet wired to a Tauri command (mirrors the
// longitudinal / GCKG / canonical_case rollout). Public API exercised by tests.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::collections::{BTreeMap, BTreeSet};

use crate::participant_resolution::{Participant, ParticipantRole, PatientIdentity};

pub type ParticipantId = String;
pub type EventId = String;

// ════════════════════════════════════════════════════════════════════════
// Data model (spec STEP 5)
// ════════════════════════════════════════════════════════════════════════

/// Coarse role of a family-graph node. Patient is the subject of the case;
/// everyone connected by a family relation is a Relative; otherwise Unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyRole {
    Patient,
    Relative,
    Unknown,
}

/// (1) FamilyNode — a wrapper over a resolved Participant / PatientIdentity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FamilyNode {
    pub participant_id: ParticipantId,
    pub name: String,
    pub role: FamilyRole,
    /// True iff this node was NOT a resolved Participant — it appears only as
    /// the subject/target of a family event (no identity record).
    pub inferred: bool,
    pub confidence: f32,
}

/// (2) FamilyRelation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyRelation {
    ParentOf,
    ChildOf,
    SiblingOf,
    SpouseOf,
    PartnerOf,
    DependentOf,
    UnknownRelation,
}

impl FamilyRelation {
    pub fn as_str(self) -> &'static str {
        match self {
            FamilyRelation::ParentOf => "parent_of",
            FamilyRelation::ChildOf => "child_of",
            FamilyRelation::SiblingOf => "sibling_of",
            FamilyRelation::SpouseOf => "spouse_of",
            FamilyRelation::PartnerOf => "partner_of",
            FamilyRelation::DependentOf => "dependent_of",
            FamilyRelation::UnknownRelation => "unknown_relation",
        }
    }
}

/// Family-specific assertion status (distinct from clinical `AssertionStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyEdgeStatus {
    /// Source asserts the relationship holds.
    Affirmed,
    /// Sources disagree on this relationship (binding-time signal).
    Disputed,
    /// Source explicitly denies the relationship.
    Denied,
    /// Relationship implied (e.g. role word "mother" ⇒ ParentOf) — not stated.
    Inferred,
}

impl FamilyEdgeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            FamilyEdgeStatus::Affirmed => "affirmed",
            FamilyEdgeStatus::Disputed => "disputed",
            FamilyEdgeStatus::Denied => "denied",
            FamilyEdgeStatus::Inferred => "inferred",
        }
    }
    /// Affirmed/Inferred are "asserts-it-holds" class; Denied is the opposing
    /// class; Disputed is neutral. Used only to detect cross-class conflict.
    fn is_affirming(self) -> bool {
        matches!(self, FamilyEdgeStatus::Affirmed | FamilyEdgeStatus::Inferred)
    }
    fn is_denying(self) -> bool {
        matches!(self, FamilyEdgeStatus::Denied)
    }
}

/// A half-open temporal validity window. Either bound may be unknown.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: Option<String>,
    pub end: Option<String>,
}

/// A single attributed source for a family fact (provenance-first).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SourceRef {
    pub source: String,
    pub date: Option<String>,
    pub context: String,
}

/// (3) FamilyEdge — one relationship assertion variant. Conflicting variants
/// are SEPARATE edges; nothing is collapsed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FamilyEdge {
    pub edge_id: String,
    pub from: ParticipantId,
    pub to: ParticipantId,
    pub relation: FamilyRelation,
    /// Cardinality of a collective fact (e.g. "3 children"); None for dyadic
    /// edges. Carried on the edge so the contradiction fold can read it
    /// directly (pure fold over `edges`, no edge_id parsing).
    pub cardinality: Option<u32>,
    pub temporal: Option<TimeRange>,
    pub status: FamilyEdgeStatus,
    /// Inherited from reconciliation: `resolution_confidence` of the fact group.
    pub confidence: f32,
    pub sources: Vec<SourceRef>,
    pub event_ids: Vec<EventId>,
    /// Inherited from reconciliation: true iff the fact group conflicts.
    pub contradiction_flag: bool,
}

/// (4) FamilyGraph.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FamilyGraph {
    pub nodes: Vec<FamilyNode>,
    pub edges: Vec<FamilyEdge>,
    /// participant_id → incident edge_ids (BTreeMap for determinism).
    pub adjacency_index: BTreeMap<ParticipantId, Vec<String>>,
    /// Mean edge confidence (0.0 when there are no edges).
    pub graph_confidence: f32,
}

// ════════════════════════════════════════════════════════════════════════
// Event model extension (additive — dedicated type, NOT an EventType variant)
// ════════════════════════════════════════════════════════════════════════

/// Payload of a family statement-as-event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FamilyEventPayload {
    pub relation: FamilyRelation,
    pub subject: ParticipantId,
    pub target: Option<ParticipantId>,
    /// e.g. "has two children" ⇒ cardinality = 2. None when not a count.
    pub cardinality: Option<u32>,
}

/// One family statement converted to an event. The graph is built ONLY from
/// these — never directly from text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FamilyEvent {
    pub event_id: EventId,
    pub payload: FamilyEventPayload,
    pub status: FamilyEdgeStatus,
    pub temporal: Option<TimeRange>,
    pub sources: Vec<SourceRef>,
    /// Per-statement confidence. The reconciliation binding overrides the edge
    /// confidence with the group's `resolution_confidence`; this is retained
    /// for inferred-node confidence and audit.
    pub confidence: f32,
}

// ════════════════════════════════════════════════════════════════════════
// Builder
// ════════════════════════════════════════════════════════════════════════

/// Build the family graph from resolved participants + family events.
///
/// Steps:
///   1. Group events by (subject, target, relation) — the "family fact".
///   2. Reconcile each group with the shared reconciliation contract
///      (conflict detection + resolution_confidence) — NOT a new engine.
///   3. Emit ONE edge per distinct value-variant within a group, so every
///      conflicting fact survives as its own edge (never collapsed).
///   4. Build nodes (resolved vs inferred) and the adjacency index.
pub fn build_family_graph(
    participants: &[Participant],
    patient: Option<&PatientIdentity>,
    family_events: Vec<FamilyEvent>,
) -> FamilyGraph {
    // Index resolved participants for node enrichment.
    let resolved: BTreeMap<&str, &Participant> = participants
        .iter()
        .map(|p| (p.participant_id.as_str(), p))
        .collect();
    let patient_id: Option<&str> = patient.map(|p| p.patient_id.as_str());

    // 1. Group by family-fact key.
    let mut groups: BTreeMap<FactKey, Vec<FamilyEvent>> = BTreeMap::new();
    for ev in family_events {
        groups.entry(FactKey::of(&ev)).or_default().push(ev);
    }

    let mut edges: Vec<FamilyEdge> = Vec::new();
    for (key, members) in &groups {
        let reconciled = reconcile_fact_group(members);

        // 3. One edge per distinct value-variant. Variants are keyed by
        //    (status, cardinality, temporal) so conflicting facts never merge.
        let mut variants: BTreeMap<VariantKey, Vec<&FamilyEvent>> = BTreeMap::new();
        for ev in members {
            variants.entry(VariantKey::of(ev)).or_default().push(ev);
        }

        for (vkey, vevents) in &variants {
            let mut sources: Vec<SourceRef> =
                vevents.iter().flat_map(|e| e.sources.clone()).collect();
            sources.sort();
            sources.dedup();

            let mut event_ids: Vec<EventId> =
                vevents.iter().map(|e| e.event_id.clone()).collect();
            event_ids.sort();
            event_ids.dedup();

            let to = key.target.clone().unwrap_or_default();
            let edge_id = format!(
                "famedge::{}->{}::{}::{}::{}::{}",
                key.subject,
                to,
                key.relation.as_str(),
                vkey.status.as_str(),
                vkey.cardinality_key(),
                vkey.temporal,
            );

            edges.push(FamilyEdge {
                edge_id,
                from: key.subject.clone(),
                to,
                relation: key.relation,
                cardinality: vkey.cardinality,
                temporal: vevents[0].temporal.clone(),
                status: vkey.status,
                confidence: reconciled.resolution_confidence,
                sources,
                event_ids,
                contradiction_flag: reconciled.conflict_flag,
            });
        }
    }

    edges.sort_by(|a, b| a.edge_id.cmp(&b.edge_id));

    // 4. Nodes — every participant_id that appears in any edge, plus the
    //    patient. Resolved ⇒ inferred=false; otherwise inferred=true.
    let mut node_ids: BTreeSet<ParticipantId> = BTreeSet::new();
    for e in &edges {
        node_ids.insert(e.from.clone());
        if !e.to.is_empty() {
            node_ids.insert(e.to.clone());
        }
    }
    if let Some(pid) = patient_id {
        node_ids.insert(pid.to_string());
    }

    // Pre-compute, per node, the relations it participates in and the max
    // referencing-event confidence (for inferred-node confidence).
    let mut max_conf: BTreeMap<&str, f32> = BTreeMap::new();
    let mut non_unknown_rel: BTreeSet<&str> = BTreeSet::new();
    for (_key, members) in &groups {
        for ev in members {
            let s = ev.payload.subject.as_str();
            let entry = max_conf.entry(s).or_insert(0.0);
            *entry = entry.max(ev.confidence);
            if ev.payload.relation != FamilyRelation::UnknownRelation {
                non_unknown_rel.insert(s);
            }
            if let Some(t) = ev.payload.target.as_deref() {
                let entry = max_conf.entry(t).or_insert(0.0);
                *entry = entry.max(ev.confidence);
                if ev.payload.relation != FamilyRelation::UnknownRelation {
                    non_unknown_rel.insert(t);
                }
            }
        }
    }

    let mut nodes: Vec<FamilyNode> = Vec::new();
    for id in &node_ids {
        let is_patient = patient_id == Some(id.as_str());
        let resolved_p = resolved.get(id.as_str());
        let inferred = !is_patient && resolved_p.is_none();

        let role = if is_patient
            || resolved_p.map(|p| p.role == ParticipantRole::Patient).unwrap_or(false)
        {
            FamilyRole::Patient
        } else if non_unknown_rel.contains(id.as_str()) {
            FamilyRole::Relative
        } else {
            FamilyRole::Unknown
        };

        let name = if is_patient {
            patient
                .and_then(|p| p.names.first().cloned())
                .unwrap_or_else(|| id.clone())
        } else {
            resolved_p.map(|p| p.name.clone()).unwrap_or_else(|| id.clone())
        };

        let confidence = if is_patient {
            patient.map(|p| p.confidence).unwrap_or(1.0)
        } else if resolved_p.is_some() {
            1.0
        } else {
            round3(*max_conf.get(id.as_str()).unwrap_or(&0.5))
        };

        nodes.push(FamilyNode {
            participant_id: id.clone(),
            name,
            role,
            inferred,
            confidence,
        });
    }
    nodes.sort_by(|a, b| a.participant_id.cmp(&b.participant_id));

    // Adjacency index — incident edges per node, deterministic.
    let mut adjacency_index: BTreeMap<ParticipantId, Vec<String>> = BTreeMap::new();
    for e in &edges {
        adjacency_index
            .entry(e.from.clone())
            .or_default()
            .push(e.edge_id.clone());
        if !e.to.is_empty() {
            adjacency_index
                .entry(e.to.clone())
                .or_default()
                .push(e.edge_id.clone());
        }
    }
    for v in adjacency_index.values_mut() {
        v.sort();
        v.dedup();
    }

    let graph_confidence = if edges.is_empty() {
        0.0
    } else {
        round3(edges.iter().map(|e| e.confidence).sum::<f32>() / edges.len() as f32)
    };

    FamilyGraph {
        nodes,
        edges,
        adjacency_index,
        graph_confidence,
    }
}

// ── Fact grouping + reconciliation contract ────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct FactKey {
    subject: ParticipantId,
    target: Option<ParticipantId>,
    relation: FamilyRelation,
}

impl FactKey {
    fn of(ev: &FamilyEvent) -> Self {
        FactKey {
            subject: ev.payload.subject.clone(),
            target: ev.payload.target.clone(),
            relation: ev.payload.relation,
        }
    }
}

/// A value-variant within a fact group. Distinct variants ⇒ distinct edges.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct VariantKey {
    status: FamilyEdgeStatus,
    cardinality: Option<u32>,
    temporal: String,
}

impl VariantKey {
    fn of(ev: &FamilyEvent) -> Self {
        VariantKey {
            status: ev.status,
            cardinality: ev.payload.cardinality,
            temporal: temporal_key(&ev.temporal),
        }
    }
    fn cardinality_key(&self) -> String {
        self.cardinality
            .map(|c| c.to_string())
            .unwrap_or_else(|| "_".to_string())
    }
}

/// Result of reconciling one family-fact group — mirrors the reconciliation
/// layer's `conflict_flag` + `resolution_confidence` semantics.
struct ReconciledFact {
    conflict_flag: bool,
    resolution_confidence: f32,
}

/// Apply the SAME deterministic contract used by
/// `patient_longitudinal_reconciliation` / `canonical_case`:
///   * conflict when an affirming-class and a denying-class assertion coexist,
///     OR when ≥2 distinct cardinalities, OR ≥2 distinct temporal windows.
///   * resolution_confidence = dominant value-variant support ÷ total support.
/// This INHERITS the contradiction definition — it does not invent a new one.
fn reconcile_fact_group(members: &[FamilyEvent]) -> ReconciledFact {
    let total = members.len() as u32;
    if total == 0 {
        return ReconciledFact { conflict_flag: false, resolution_confidence: 1.0 };
    }

    let has_affirming = members.iter().any(|e| e.status.is_affirming());
    let has_denying = members.iter().any(|e| e.status.is_denying());
    let status_conflict = has_affirming && has_denying;

    let distinct_cardinalities: BTreeSet<Option<u32>> =
        members.iter().map(|e| e.payload.cardinality).collect();
    // Only count *present* cardinalities toward a conflict (None = unspecified).
    let present_cardinalities: BTreeSet<u32> =
        members.iter().filter_map(|e| e.payload.cardinality).collect();
    let cardinality_conflict = present_cardinalities.len() > 1;

    let distinct_temporal: BTreeSet<String> =
        members.iter().map(|e| temporal_key(&e.temporal)).collect();
    // "_" (no temporal) doesn't conflict with itself; conflict needs ≥2
    // distinct *specified* windows.
    let specified_temporal: BTreeSet<String> = distinct_temporal
        .iter()
        .filter(|t| t.as_str() != "_")
        .cloned()
        .collect();
    let temporal_conflict = specified_temporal.len() > 1;

    let conflict_flag = status_conflict || cardinality_conflict || temporal_conflict;

    // Dominant variant share = resolution_confidence (same formula as the
    // assertion-distribution dominance used upstream).
    let mut variant_counts: BTreeMap<VariantKey, u32> = BTreeMap::new();
    for e in members {
        *variant_counts.entry(VariantKey::of(e)).or_insert(0) += 1;
    }
    let dominant = variant_counts.values().copied().max().unwrap_or(0);
    let resolution_confidence = round3(dominant as f32 / total as f32);

    let _ = distinct_cardinalities; // retained for readability of the rule.
    ReconciledFact { conflict_flag, resolution_confidence }
}

fn temporal_key(t: &Option<TimeRange>) -> String {
    match t {
        None => "_".to_string(),
        Some(r) => format!(
            "{}..{}",
            r.start.as_deref().unwrap_or(""),
            r.end.as_deref().unwrap_or("")
        ),
    }
}

fn round3(f: f32) -> f32 {
    (f * 1000.0).round() / 1000.0
}

/// Convenience JSON projection (mirrors `participant_resolution::graph_node_*`).
pub fn graph_summary(graph: &FamilyGraph) -> JsonValue {
    json!({
        "node_count": graph.nodes.len(),
        "edge_count": graph.edges.len(),
        "contradiction_edges": graph.edges.iter().filter(|e| e.contradiction_flag).count(),
        "graph_confidence": graph.graph_confidence,
    })
}

// ════════════════════════════════════════════════════════════════════════
// Family contradiction binding (STEP-6 surfacing)
//
// A pure deterministic fold over `FamilyGraph.edges`. Grouping identity is
// `(pair, target_mode)` ONLY — relation/axis/cardinality/temporal/status are
// VARIANTS, not identity. Axis is derived AFTER grouping for labelling +
// conflict_type. Reuses the clinical `dominant/total` math; never collapses a
// conflicting fact; preserves all variants + provenance.
// ════════════════════════════════════════════════════════════════════════

/// Conflict category, selected AFTER grouping by the deterministic precedence
/// Identity > Relational > Cardinality > Temporal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyConflictType {
    Identity,
    Relational,
    Cardinality,
    Temporal,
}

impl FamilyConflictType {
    pub fn as_str(self) -> &'static str {
        match self {
            FamilyConflictType::Identity => "identity",
            FamilyConflictType::Relational => "relational",
            FamilyConflictType::Cardinality => "cardinality",
            FamilyConflictType::Temporal => "temporal",
        }
    }
}

/// Relation axis — derived per edge AFTER grouping (labelling only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FamilyAxis {
    Lineage,
    Sibling,
    Spousal,
    Dependency,
    Unknown,
}

impl FamilyAxis {
    pub fn as_str(self) -> &'static str {
        match self {
            FamilyAxis::Lineage => "lineage",
            FamilyAxis::Sibling => "sibling",
            FamilyAxis::Spousal => "spousal",
            FamilyAxis::Dependency => "dependency",
            FamilyAxis::Unknown => "unknown",
        }
    }
    fn of(relation: FamilyRelation) -> Self {
        match relation {
            FamilyRelation::ParentOf | FamilyRelation::ChildOf => FamilyAxis::Lineage,
            FamilyRelation::SiblingOf => FamilyAxis::Sibling,
            FamilyRelation::SpouseOf | FamilyRelation::PartnerOf => FamilyAxis::Spousal,
            FamilyRelation::DependentOf => FamilyAxis::Dependency,
            FamilyRelation::UnknownRelation => FamilyAxis::Unknown,
        }
    }
}

/// One observed variant within a family-fact group (mirrors clinical
/// `ContradictionValue`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FamilyValue {
    pub value: String,
    pub support_count: u32,
    pub confidence: f32,
    pub sources: Vec<SourceRef>,
    pub edge_ids: Vec<String>,
}

/// A flattened family contradiction (isomorphic to clinical `Contradiction`).
/// Domain tagging is applied by the STEP-6 wrapper, not stored here, to avoid
/// a dependency cycle with `canonical_case`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyContradiction {
    pub contradiction_id: String,
    pub conflict_type: FamilyConflictType,
    pub pair: (ParticipantId, Option<ParticipantId>),
    /// Display-only label (node names). NEVER identity.
    pub subject: String,
    /// Dominant variant — PRESENTATION ONLY, not a chosen truth.
    pub canonical_value: FamilyValue,
    /// Every other variant, retained verbatim.
    pub alternatives: Vec<FamilyValue>,
    pub conflict_flag: bool,
    /// dominant_support / total_support — identical formula to clinical.
    pub resolution_confidence: f32,
    pub source_refs: Vec<SourceRef>,
    pub edge_ids: Vec<String>,
    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum TargetMode {
    Dyadic,
    Collective,
}

impl TargetMode {
    fn as_str(self) -> &'static str {
        match self {
            TargetMode::Dyadic => "dyadic",
            TargetMode::Collective => "collective",
        }
    }
}

/// Grouping identity — `(pair, target_mode)` ONLY.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ContraKey {
    pair_a: ParticipantId,
    pair_b: Option<ParticipantId>,
    target_mode: TargetMode,
}

impl ContraKey {
    fn of(e: &FamilyEdge) -> Self {
        if e.to.is_empty() {
            ContraKey {
                pair_a: e.from.clone(),
                pair_b: None,
                target_mode: TargetMode::Collective,
            }
        } else {
            let (a, b) = sorted2(&e.from, &e.to);
            ContraKey {
                pair_a: a,
                pair_b: Some(b),
                target_mode: TargetMode::Dyadic,
            }
        }
    }
    fn pair_string(&self) -> String {
        match &self.pair_b {
            Some(b) => format!("{}|{}", self.pair_a, b),
            None => self.pair_a.clone(),
        }
    }
    fn endpoints(&self) -> Vec<&str> {
        match &self.pair_b {
            Some(b) => vec![self.pair_a.as_str(), b.as_str()],
            None => vec![self.pair_a.as_str()],
        }
    }
}

/// Variant identity within a group — canonicalised (inverse-collapsed)
/// relation + cardinality + temporal + status.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct FamilyVariantKey {
    relation_canon: String,
    cardinality: Option<u32>,
    temporal: String,
    status: FamilyEdgeStatus,
}

impl FamilyVariantKey {
    fn of(e: &FamilyEdge) -> Self {
        FamilyVariantKey {
            relation_canon: relation_canon(e),
            cardinality: e.cardinality,
            temporal: temporal_key(&e.temporal),
            status: e.status,
        }
    }
    fn label(&self) -> String {
        format!(
            "{}|card={}|when={}|{}",
            self.relation_canon,
            self.cardinality.map(|c| c.to_string()).unwrap_or_else(|| "_".into()),
            self.temporal,
            self.status.as_str(),
        )
    }
}

fn sorted2(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

/// Canonical, orientation-collapsed relation label. `ParentOf(A,B)` and
/// `ChildOf(B,A)` map to the SAME `lineage:parent>child` string (inverse
/// collapse); symmetric relations use the sorted pair.
fn relation_canon(e: &FamilyEdge) -> String {
    match e.relation {
        FamilyRelation::ParentOf => format!("lineage:{}>{}", e.from, e.to),
        FamilyRelation::ChildOf => format!("lineage:{}>{}", e.to, e.from),
        FamilyRelation::SiblingOf => {
            let (a, b) = sorted2(&e.from, &e.to);
            format!("sibling:{}~{}", a, b)
        }
        FamilyRelation::SpouseOf => {
            let (a, b) = sorted2(&e.from, &e.to);
            format!("spouse:{}~{}", a, b)
        }
        FamilyRelation::PartnerOf => {
            let (a, b) = sorted2(&e.from, &e.to);
            format!("partner:{}~{}", a, b)
        }
        FamilyRelation::DependentOf => format!("dependency:{}>{}", e.from, e.to),
        FamilyRelation::UnknownRelation => {
            let (a, b) = sorted2(&e.from, &e.to);
            format!("unknown:{}~{}", a, b)
        }
    }
}

/// Lexicographic ISO-date overlap (None start = -∞, None end = +∞).
fn ranges_overlap(a: &TimeRange, b: &TimeRange) -> bool {
    let lo = "\u{0}".to_string();
    let hi = "\u{10FFFF}".to_string();
    let a_start = a.start.clone().unwrap_or_else(|| lo.clone());
    let b_start = b.start.clone().unwrap_or_else(|| lo.clone());
    let a_end = a.end.clone().unwrap_or_else(|| hi.clone());
    let b_end = b.end.clone().unwrap_or_else(|| hi.clone());
    a_start <= b_end && b_start <= a_end
}

/// Temporal spread within a group: per relation_canon, count distinct
/// specified windows and detect any non-overlapping pair.
fn temporal_spread(edges: &[&FamilyEdge]) -> (usize, bool) {
    let mut by_rel: BTreeMap<String, Vec<&TimeRange>> = BTreeMap::new();
    for e in edges {
        if let Some(t) = &e.temporal {
            by_rel.entry(relation_canon(e)).or_default().push(t);
        }
    }
    let mut max_distinct = 0usize;
    let mut conflict = false;
    for windows in by_rel.values() {
        let distinct: BTreeSet<String> =
            windows.iter().map(|w| temporal_key(&Some((*w).clone()))).collect();
        max_distinct = max_distinct.max(distinct.len());
        // Any non-overlapping pair of distinct windows ⇒ temporal conflict.
        for i in 0..windows.len() {
            for j in (i + 1)..windows.len() {
                if !ranges_overlap(windows[i], windows[j]) {
                    conflict = true;
                }
            }
        }
    }
    (max_distinct, conflict)
}

/// Build family contradictions as a pure fold over `graph.edges`.
///
/// `identity_ambiguity` is the set of participant_ids that the
/// participant-resolution layer has flagged as possibly-the-same-person. It is
/// the ONLY external signal consulted (never recomputed here); pass an empty
/// set when no identity bridge is wired.
pub fn build_family_contradictions(
    graph: &FamilyGraph,
    identity_ambiguity: &BTreeSet<ParticipantId>,
) -> Vec<FamilyContradiction> {
    // Node-name lookup for display-only subjects.
    let names: BTreeMap<&str, &str> = graph
        .nodes
        .iter()
        .map(|n| (n.participant_id.as_str(), n.name.as_str()))
        .collect();

    // 1. GROUP by (pair, target_mode) only.
    let mut groups: BTreeMap<ContraKey, Vec<&FamilyEdge>> = BTreeMap::new();
    for e in &graph.edges {
        groups.entry(ContraKey::of(e)).or_default().push(e);
    }

    let mut out: Vec<FamilyContradiction> = Vec::new();

    for (key, edges) in &groups {
        // 2. Partition into variants.
        let mut variant_map: BTreeMap<FamilyVariantKey, Vec<&FamilyEdge>> = BTreeMap::new();
        for e in edges {
            variant_map.entry(FamilyVariantKey::of(e)).or_default().push(*e);
        }

        // Observation-weighted support. `build_family_graph` collapses N
        // identical events into ONE edge, retaining multiplicity in
        // `event_ids`; the contradiction layer therefore counts OBSERVATIONS
        // (`event_ids.len()`), NOT edges, so `resolution_confidence` matches
        // `FamilyEdge.confidence` and the clinical dominant/total model. This
        // does NOT alter FamilyGraph reconciliation — only contradiction-layer
        // accounting. `.max(1)` guards a malformed empty edge from contributing
        // zero support.
        let total: u32 = edges.iter().map(|e| e.event_ids.len().max(1) as u32).sum();
        let has_aff = edges.iter().any(|e| e.status.is_affirming());
        let has_den = edges.iter().any(|e| e.status.is_denying());
        let status_conflict = has_aff && has_den;

        // 4. Conflict iff ≥2 variants OR affirm/deny coexist.
        let conflict_flag = variant_map.len() >= 2 || status_conflict;
        if !conflict_flag {
            continue;
        }

        // FamilyValues (sorted dominant-first; deterministic tie-break by label).
        let mut values: Vec<FamilyValue> = variant_map
            .iter()
            .map(|(vk, ves)| {
                let support_count: u32 =
                    ves.iter().map(|e| e.event_ids.len().max(1) as u32).sum();
                let mut sources: Vec<SourceRef> =
                    ves.iter().flat_map(|e| e.sources.clone()).collect();
                sources.sort();
                sources.dedup();
                let mut edge_ids: Vec<String> =
                    ves.iter().map(|e| e.edge_id.clone()).collect();
                edge_ids.sort();
                edge_ids.dedup();
                FamilyValue {
                    value: vk.label(),
                    support_count,
                    confidence: round3(support_count as f32 / total as f32),
                    sources,
                    edge_ids,
                }
            })
            .collect();
        values.sort_by(|a, b| {
            b.support_count
                .cmp(&a.support_count)
                .then(a.value.cmp(&b.value))
        });
        let canonical_value = values[0].clone();
        let alternatives = values[1..].to_vec();
        let resolution_confidence = round3(canonical_value.support_count as f32 / total as f32);

        // 3 + 6. Derive axes + conflict_type AFTER grouping.
        let distinct_relations: BTreeSet<String> =
            variant_map.keys().map(|k| k.relation_canon.clone()).collect();
        let distinct_cardinalities: BTreeSet<u32> =
            edges.iter().filter_map(|e| e.cardinality).collect();
        let (temporal_n, temporal_conflict) = temporal_spread(edges);
        let identity_n = key
            .endpoints()
            .iter()
            .filter(|id| identity_ambiguity.contains(**id))
            .count();

        let relational_n = distinct_relations.len();
        let cardinality_n = distinct_cardinalities.len();
        let is_collective = key.target_mode == TargetMode::Collective;

        // Precedence: Identity > Relational > Cardinality > Temporal.
        let relational_active = relational_n >= 2 || status_conflict;
        let cardinality_active = is_collective && cardinality_n >= 2;
        let conflict_type = if identity_n >= 1 {
            FamilyConflictType::Identity
        } else if relational_active {
            FamilyConflictType::Relational
        } else if cardinality_active {
            FamilyConflictType::Cardinality
        } else if temporal_conflict {
            FamilyConflictType::Temporal
        } else {
            // Conflict by variant multiplicity that isn't relation/card/time
            // (e.g. pure status spread) — classify as Relational (relation
            // existence is disputed).
            FamilyConflictType::Relational
        };

        // Secondary conflicting axes (for audit).
        let mut also: Vec<FamilyConflictType> = Vec::new();
        if identity_n >= 1 {
            also.push(FamilyConflictType::Identity);
        }
        if relational_active {
            also.push(FamilyConflictType::Relational);
        }
        if cardinality_active {
            also.push(FamilyConflictType::Cardinality);
        }
        if temporal_conflict {
            also.push(FamilyConflictType::Temporal);
        }
        also.retain(|t| *t != conflict_type);

        // Axes present (labelling).
        let axes: BTreeSet<&'static str> = edges
            .iter()
            .map(|e| FamilyAxis::of(e.relation).as_str())
            .collect();

        // Subject — display only.
        let name_a = names.get(key.pair_a.as_str()).copied().unwrap_or(key.pair_a.as_str());
        let subject = match &key.pair_b {
            Some(b) => {
                let name_b = names.get(b.as_str()).copied().unwrap_or(b.as_str());
                format!("{} ↔ {}", name_a, name_b)
            }
            None => format!("{}: collective", name_a),
        };

        // Union provenance.
        let mut source_refs: Vec<SourceRef> =
            edges.iter().flat_map(|e| e.sources.clone()).collect();
        source_refs.sort();
        source_refs.dedup();
        let mut edge_ids: Vec<String> = edges.iter().map(|e| e.edge_id.clone()).collect();
        edge_ids.sort();
        edge_ids.dedup();

        out.push(FamilyContradiction {
            contradiction_id: format!(
                "famcontra::{}::{}",
                key.pair_string(),
                key.target_mode.as_str()
            ),
            conflict_type,
            pair: (key.pair_a.clone(), key.pair_b.clone()),
            subject,
            canonical_value,
            alternatives,
            conflict_flag,
            resolution_confidence,
            source_refs,
            edge_ids,
            metadata: json!({
                "total_support": total,
                "distinct_variants": values.len(),
                "spread": {
                    "cardinality_n": cardinality_n,
                    "relational_n": relational_n,
                    "temporal_n": temporal_n,
                    "identity_n": identity_n,
                },
                "also_conflicting": also.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
                "axes": axes.into_iter().collect::<Vec<_>>(),
            }),
        });
    }

    // Deterministic output: most-contested first, then subject, then id.
    out.sort_by(|a, b| {
        a.resolution_confidence
            .partial_cmp(&b.resolution_confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.subject.cmp(&b.subject))
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });
    out
}

// ════════════════════════════════════════════════════════════════════════
// Tests — synthetic FamilyEvents (no real cases, no text extraction).
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn src(source: &str, ctx: &str) -> SourceRef {
        SourceRef { source: source.to_string(), date: None, context: ctx.to_string() }
    }

    fn fam_event(
        id: &str,
        relation: FamilyRelation,
        subject: &str,
        target: Option<&str>,
        cardinality: Option<u32>,
        status: FamilyEdgeStatus,
        source: &str,
    ) -> FamilyEvent {
        FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation,
                subject: subject.to_string(),
                target: target.map(|t| t.to_string()),
                cardinality,
            },
            status,
            temporal: None,
            sources: vec![src(source, "ctx")],
            confidence: 0.9,
        }
    }

    fn patient(id: &str, name: &str) -> PatientIdentity {
        PatientIdentity {
            patient_id: id.to_string(),
            names: vec![name.to_string()],
            date_of_birth: None,
            aliases: vec![],
            source_document_ids: vec![],
            confidence: 0.95,
            metadata: json!({}),
        }
    }

    #[test]
    fn unanimous_relationship_single_edge_no_contradiction() {
        let ev = fam_event(
            "e1", FamilyRelation::ParentOf, "mother#1", Some("patient#1"),
            None, FamilyEdgeStatus::Affirmed, "report_a",
        );
        let g = build_family_graph(&[], Some(&patient("patient#1", "Sarah")), vec![ev]);
        assert_eq!(g.edges.len(), 1);
        assert!(!g.edges[0].contradiction_flag);
        assert!((g.edges[0].confidence - 1.0).abs() < 1e-6);
        // Patient + mother nodes; mother is inferred (no Participant record).
        assert_eq!(g.nodes.len(), 2);
        let mother = g.nodes.iter().find(|n| n.participant_id == "mother#1").unwrap();
        assert!(mother.inferred);
        assert_eq!(mother.role, FamilyRole::Relative);
    }

    #[test]
    fn conflicting_cardinality_produces_two_edges_never_collapsed() {
        // "two children" vs "three children" — same subject/relation/target.
        let two = fam_event(
            "e1", FamilyRelation::ParentOf, "patient#1", None,
            Some(2), FamilyEdgeStatus::Affirmed, "gp_note",
        );
        let three = fam_event(
            "e2", FamilyRelation::ParentOf, "patient#1", None,
            Some(3), FamilyEdgeStatus::Affirmed, "insurance_form",
        );
        let g = build_family_graph(&[], Some(&patient("patient#1", "Sarah")), vec![two, three]);

        // Both cardinalities preserved as separate edges; both flagged.
        assert_eq!(g.edges.len(), 2);
        assert!(g.edges.iter().all(|e| e.contradiction_flag));
        // Dominant share = 1/2 = 0.5.
        assert!(g.edges.iter().all(|e| (e.confidence - 0.5).abs() < 1e-6));
        // Distinct sources retained per edge (no merge across variants).
        let sources: BTreeSet<&str> = g
            .edges
            .iter()
            .flat_map(|e| e.sources.iter().map(|s| s.source.as_str()))
            .collect();
        assert!(sources.contains("gp_note"));
        assert!(sources.contains("insurance_form"));
    }

    #[test]
    fn conflicting_status_affirmed_vs_denied_flags_and_preserves_both() {
        let aff = fam_event(
            "e1", FamilyRelation::SiblingOf, "patient#1", Some("john#1"),
            None, FamilyEdgeStatus::Affirmed, "doc_a",
        );
        let den = fam_event(
            "e2", FamilyRelation::SiblingOf, "patient#1", Some("john#1"),
            None, FamilyEdgeStatus::Denied, "doc_b",
        );
        let g = build_family_graph(&[], Some(&patient("patient#1", "Sarah")), vec![aff, den]);
        assert_eq!(g.edges.len(), 2);
        assert!(g.edges.iter().all(|e| e.contradiction_flag));
        let statuses: BTreeSet<&str> =
            g.edges.iter().map(|e| e.status.as_str()).collect();
        assert!(statuses.contains("affirmed"));
        assert!(statuses.contains("denied"));
    }

    #[test]
    fn confidence_mirrors_dominant_share() {
        // affirmed x3 vs denied x1 → dominant 3/4 = 0.75, conflict (cross-class).
        let mut evs = vec![];
        for i in 0..3 {
            evs.push(fam_event(
                &format!("a{i}"), FamilyRelation::SpouseOf, "patient#1", Some("alex#1"),
                None, FamilyEdgeStatus::Affirmed, "doc_a",
            ));
        }
        evs.push(fam_event(
            "d0", FamilyRelation::SpouseOf, "patient#1", Some("alex#1"),
            None, FamilyEdgeStatus::Denied, "doc_b",
        ));
        let g = build_family_graph(&[], Some(&patient("patient#1", "Sarah")), evs);
        assert!(g.edges.iter().all(|e| e.contradiction_flag));
        assert!(g.edges.iter().all(|e| (e.confidence - 0.75).abs() < 1e-6));
    }

    #[test]
    fn resolved_participant_is_not_inferred() {
        let p = Participant {
            participant_id: "john#1".to_string(),
            name: "John O'Neill".to_string(),
            role: ParticipantRole::Unknown,
            source_document_ids: vec!["d1".into()],
            organisations: vec![],
            metadata: json!({}),
        };
        let ev = fam_event(
            "e1", FamilyRelation::SiblingOf, "patient#1", Some("john#1"),
            None, FamilyEdgeStatus::Affirmed, "doc_a",
        );
        let g = build_family_graph(&[p], Some(&patient("patient#1", "Sarah")), vec![ev]);
        let john = g.nodes.iter().find(|n| n.participant_id == "john#1").unwrap();
        assert!(!john.inferred);
        assert_eq!(john.name, "John O'Neill");
        assert!((john.confidence - 1.0).abs() < 1e-6);
    }

    #[test]
    fn adjacency_index_links_both_endpoints() {
        let ev = fam_event(
            "e1", FamilyRelation::ChildOf, "patient#1", Some("father#1"),
            None, FamilyEdgeStatus::Affirmed, "doc_a",
        );
        let g = build_family_graph(&[], Some(&patient("patient#1", "Sarah")), vec![ev]);
        let eid = &g.edges[0].edge_id;
        assert!(g.adjacency_index.get("patient#1").unwrap().contains(eid));
        assert!(g.adjacency_index.get("father#1").unwrap().contains(eid));
    }

    #[test]
    fn deterministic_same_input_same_graph() {
        let mk = || {
            vec![
                fam_event("e1", FamilyRelation::ParentOf, "patient#1", None, Some(2),
                    FamilyEdgeStatus::Affirmed, "gp_note"),
                fam_event("e2", FamilyRelation::ParentOf, "patient#1", None, Some(3),
                    FamilyEdgeStatus::Affirmed, "insurer"),
            ]
        };
        let g1 = build_family_graph(&[], Some(&patient("patient#1", "Sarah")), mk());
        let g2 = build_family_graph(&[], Some(&patient("patient#1", "Sarah")), mk());
        assert_eq!(
            serde_json::to_string(&g1).unwrap(),
            serde_json::to_string(&g2).unwrap()
        );
    }

    // ── Contradiction binding ──────────────────────────────────────────────

    fn empty_ambiguity() -> BTreeSet<ParticipantId> {
        BTreeSet::new()
    }

    #[test]
    fn cardinality_conflict_surfaces_as_family_contradiction() {
        let g = build_family_graph(
            &[],
            Some(&patient("patient#1", "Sarah")),
            vec![
                fam_event("e1", FamilyRelation::ParentOf, "patient#1", None, Some(2),
                    FamilyEdgeStatus::Affirmed, "gp_note"),
                fam_event("e2", FamilyRelation::ParentOf, "patient#1", None, Some(3),
                    FamilyEdgeStatus::Affirmed, "insurer"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        let c = &cs[0];
        assert_eq!(c.conflict_type, FamilyConflictType::Cardinality);
        assert!(c.conflict_flag);
        // 1/2 dominant share.
        assert!((c.resolution_confidence - 0.5).abs() < 1e-6);
        // Both cardinalities preserved: canonical + 1 alternative, all edge_ids.
        assert_eq!(c.alternatives.len(), 1);
        assert_eq!(c.edge_ids.len(), 2);
        assert!(c.contradiction_id.starts_with("famcontra::patient#1::collective"));
        // No axis in the id.
        assert!(!c.contradiction_id.contains("lineage"));
    }

    #[test]
    fn status_conflict_surfaces_relational() {
        let g = build_family_graph(
            &[],
            Some(&patient("patient#1", "Sarah")),
            vec![
                fam_event("e1", FamilyRelation::SiblingOf, "patient#1", Some("john#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::SiblingOf, "patient#1", Some("john#1"),
                    None, FamilyEdgeStatus::Denied, "doc_b"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].conflict_type, FamilyConflictType::Relational);
        assert!(cs[0].conflict_flag);
    }

    #[test]
    fn agreement_is_not_a_contradiction() {
        // Two sources affirm the SAME relation — corroboration, not conflict.
        let g = build_family_graph(
            &[],
            Some(&patient("patient#1", "Sarah")),
            vec![
                fam_event("e1", FamilyRelation::SpouseOf, "patient#1", Some("alex#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::SpouseOf, "patient#1", Some("alex#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_b"),
            ],
        );
        assert!(build_family_contradictions(&g, &empty_ambiguity()).is_empty());
    }

    #[test]
    fn inverse_relations_collapse_no_false_conflict() {
        // ParentOf(parent#1, patient#1) and ChildOf(patient#1, parent#1) are
        // the SAME fact — must NOT register as a relational conflict.
        let g = build_family_graph(
            &[],
            Some(&patient("patient#1", "Sarah")),
            vec![
                fam_event("e1", FamilyRelation::ParentOf, "parent#1", Some("patient#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::ChildOf, "patient#1", Some("parent#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_b"),
            ],
        );
        // Same pair (sorted), inverse-collapsed to one variant ⇒ no conflict.
        assert!(build_family_contradictions(&g, &empty_ambiguity()).is_empty());
    }

    #[test]
    fn relational_conflict_same_pair_different_relation() {
        // Same two people described as siblings AND spouses → relational conflict.
        let g = build_family_graph(
            &[],
            Some(&patient("patient#1", "Sarah")),
            vec![
                fam_event("e1", FamilyRelation::SiblingOf, "patient#1", Some("kim#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::SpouseOf, "patient#1", Some("kim#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_b"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].conflict_type, FamilyConflictType::Relational);
        assert_eq!(cs[0].alternatives.len(), 1);
    }

    #[test]
    fn identity_ambiguity_takes_precedence() {
        let g = build_family_graph(
            &[],
            Some(&patient("patient#1", "Sarah")),
            vec![
                fam_event("e1", FamilyRelation::SiblingOf, "patient#1", Some("john#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::SpouseOf, "patient#1", Some("john#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_b"),
            ],
        );
        let mut amb = BTreeSet::new();
        amb.insert("john#1".to_string());
        let cs = build_family_contradictions(&g, &amb);
        assert_eq!(cs.len(), 1);
        // Relational spread exists, but Identity outranks it.
        assert_eq!(cs[0].conflict_type, FamilyConflictType::Identity);
    }

    #[test]
    fn family_contradictions_deterministic() {
        let mk = || {
            build_family_graph(
                &[],
                Some(&patient("patient#1", "Sarah")),
                vec![
                    fam_event("e1", FamilyRelation::ParentOf, "patient#1", None, Some(2),
                        FamilyEdgeStatus::Affirmed, "gp_note"),
                    fam_event("e2", FamilyRelation::ParentOf, "patient#1", None, Some(3),
                        FamilyEdgeStatus::Affirmed, "insurer"),
                ],
            )
        };
        let c1 = build_family_contradictions(&mk(), &empty_ambiguity());
        let c2 = build_family_contradictions(&mk(), &empty_ambiguity());
        assert_eq!(
            serde_json::to_string(&c1).unwrap(),
            serde_json::to_string(&c2).unwrap()
        );
    }

    // ── Audit hardening pass: explicit case + weighting + temporal coverage ──

    // Case A — ParentOf(A,B) vs SiblingOf(A,B).
    #[test]
    fn case_a_parentof_vs_siblingof_relational() {
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                fam_event("e1", FamilyRelation::ParentOf, "a#1", Some("b#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::SiblingOf, "a#1", Some("b#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_b"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].conflict_type, FamilyConflictType::Relational);
        assert!(cs[0].conflict_flag);
        assert!((cs[0].resolution_confidence - 0.5).abs() < 1e-6);
        assert_eq!(cs[0].alternatives.len(), 1);
    }

    // Case B — ParentOf(A,B), ChildOf(B,A), SiblingOf(A,B).
    #[test]
    fn case_b_parent_child_sibling_mixed_collapse() {
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                fam_event("e1", FamilyRelation::ParentOf, "a#1", Some("b#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::ChildOf, "b#1", Some("a#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_b"),
                fam_event("e3", FamilyRelation::SiblingOf, "a#1", Some("b#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_c"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        let c = &cs[0];
        // ParentOf + ChildOf collapse to one variant (support 2); Sibling separate (1).
        assert_eq!(c.conflict_type, FamilyConflictType::Relational);
        assert_eq!(c.canonical_value.support_count, 2);
        assert_eq!(c.alternatives.len(), 1);
        assert_eq!(c.alternatives[0].support_count, 1);
        // 2/3 dominant share.
        assert!((c.resolution_confidence - round3(2.0 / 3.0)).abs() < 1e-6);
        // The collapsed variant references both lineage edge_ids (no loss).
        assert_eq!(c.canonical_value.edge_ids.len(), 2);
    }

    // Case C — observation-weighting: 3× ParentOf collapse to one edge but keep
    // support 3; SiblingOf once. Dominant 3 / total 4 = 0.75.
    #[test]
    fn case_c_observation_weighting_preserved() {
        let mut evs = vec![];
        for i in 0..3 {
            evs.push(fam_event(
                &format!("p{i}"), FamilyRelation::ParentOf, "a#1", Some("b#1"),
                None, FamilyEdgeStatus::Affirmed, "doc_a",
            ));
        }
        evs.push(fam_event("s0", FamilyRelation::SiblingOf, "a#1", Some("b#1"),
            None, FamilyEdgeStatus::Affirmed, "doc_b"));
        let g = build_family_graph(&[], Some(&patient("a#1", "A")), evs);

        // The 3 ParentOf events collapse to ONE edge carrying 3 event_ids.
        let lineage_edge = g
            .edges
            .iter()
            .find(|e| e.relation == FamilyRelation::ParentOf)
            .unwrap();
        assert_eq!(lineage_edge.event_ids.len(), 3);

        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        let c = &cs[0];
        assert_eq!(c.conflict_type, FamilyConflictType::Relational);
        // Observation-weighted: dominant support 3, alternative 1, total 4.
        assert_eq!(c.canonical_value.support_count, 3);
        assert_eq!(c.alternatives[0].support_count, 1);
        assert!((c.resolution_confidence - 0.75).abs() < 1e-6);
        // FamilyValue.confidence also observation-weighted.
        assert!((c.canonical_value.confidence - 0.75).abs() < 1e-6);
    }

    // Case D — temporal conflict: two fully-specified, non-overlapping windows
    // on the SAME relation variant. Confirms temporal_spread is live, not dead.
    #[test]
    fn case_d_temporal_conflict_surfaces() {
        let win = |s: &str, e: &str| {
            Some(TimeRange { start: Some(s.to_string()), end: Some(e.to_string()) })
        };
        let mk = |id: &str, t: Option<TimeRange>, source: &str| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::SpouseOf,
                subject: "a#1".to_string(),
                target: Some("b#1".to_string()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: t,
            sources: vec![src(source, "ctx")],
            confidence: 0.9,
        };
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                mk("e1", win("2010-01-01", "2010-12-31"), "doc_a"),
                mk("e2", win("2020-01-01", "2020-12-31"), "doc_b"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].conflict_type, FamilyConflictType::Temporal);
        assert!(cs[0].conflict_flag);
        // Two distinct windows reflected in spread metadata.
        assert_eq!(cs[0].metadata["spread"]["temporal_n"], 2);
    }

    // Overlapping windows on the same relation must NOT be a temporal conflict.
    #[test]
    fn overlapping_temporal_windows_no_conflict() {
        let win = |s: &str, e: &str| {
            Some(TimeRange { start: Some(s.to_string()), end: Some(e.to_string()) })
        };
        let mk = |id: &str, t: Option<TimeRange>| FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::SpouseOf,
                subject: "a#1".to_string(),
                target: Some("b#1".to_string()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: t,
            sources: vec![src("doc", "ctx")],
            confidence: 0.9,
        };
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                mk("e1", win("2010-01-01", "2015-12-31")),
                mk("e2", win("2012-01-01", "2018-12-31")),
            ],
        );
        // Distinct windows (2 variants ⇒ conflict_flag true) but OVERLAPPING,
        // so the conflict is not classified Temporal.
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_ne!(cs[0].conflict_type, FamilyConflictType::Temporal);
    }

    // Case E.1 — Identity reachable via a DIRECT call with a populated set.
    #[test]
    fn case_e_identity_reachable_via_direct_call() {
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                fam_event("e1", FamilyRelation::SiblingOf, "a#1", Some("b#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_a"),
                fam_event("e2", FamilyRelation::SpouseOf, "a#1", Some("b#1"),
                    None, FamilyEdgeStatus::Affirmed, "doc_b"),
            ],
        );
        let mut amb = BTreeSet::new();
        amb.insert("b#1".to_string());
        let cs = build_family_contradictions(&g, &amb);
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].conflict_type, FamilyConflictType::Identity);
        assert_eq!(cs[0].metadata["spread"]["identity_n"], 1);
    }

    // ── Temporal edge cases ─────────────────────────────────────────────────

    // Build a SpouseOf(a#1,b#1) event with an explicit window.
    fn spouse_t(id: &str, start: Option<&str>, end: Option<&str>, source: &str) -> FamilyEvent {
        FamilyEvent {
            event_id: id.to_string(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::SpouseOf,
                subject: "a#1".to_string(),
                target: Some("b#1".to_string()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: Some(TimeRange {
                start: start.map(|s| s.to_string()),
                end: end.map(|s| s.to_string()),
            }),
            sources: vec![src(source, "ctx")],
            confidence: 0.9,
        }
    }

    // Identical windows ⇒ one variant ⇒ NOT a contradiction at all.
    #[test]
    fn temporal_identical_windows_no_conflict() {
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                spouse_t("e1", Some("2010-01-01"), Some("2010-12-31"), "doc_a"),
                spouse_t("e2", Some("2010-01-01"), Some("2010-12-31"), "doc_b"),
            ],
        );
        assert!(build_family_contradictions(&g, &empty_ambiguity()).is_empty());
    }

    // Open-ended window overlapping a closed one ⇒ conflict exists (2 variants)
    // but is NOT classified Temporal (overlap ⇒ no temporal conflict).
    #[test]
    fn temporal_open_ended_overlap_not_temporal() {
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                spouse_t("e1", Some("2010-01-01"), None, "doc_a"),
                spouse_t("e2", Some("2012-01-01"), Some("2014-12-31"), "doc_b"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_ne!(cs[0].conflict_type, FamilyConflictType::Temporal);
    }

    // Adjacent windows that touch at a boundary overlap ⇒ NOT Temporal.
    #[test]
    fn temporal_adjacent_touching_not_temporal() {
        let g = build_family_graph(
            &[],
            Some(&patient("a#1", "A")),
            vec![
                spouse_t("e1", Some("2010-01-01"), Some("2010-12-31"), "doc_a"),
                spouse_t("e2", Some("2010-12-31"), Some("2011-12-31"), "doc_b"),
            ],
        );
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_ne!(cs[0].conflict_type, FamilyConflictType::Temporal);
    }

    // Non-overlapping windows on DIFFERENT relations ⇒ Relational outranks
    // Temporal (temporal_spread is grouped per relation_canon, so each relation
    // has only one window — no temporal conflict).
    #[test]
    fn temporal_nonoverlapping_different_relations_is_relational() {
        let sibling = FamilyEvent {
            event_id: "e1".into(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::SiblingOf,
                subject: "a#1".into(),
                target: Some("b#1".into()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: Some(TimeRange { start: Some("2010-01-01".into()), end: Some("2010-12-31".into()) }),
            sources: vec![src("doc_a", "ctx")],
            confidence: 0.9,
        };
        let spouse = spouse_t("e2", Some("2020-01-01"), Some("2020-12-31"), "doc_b");
        let g = build_family_graph(&[], Some(&patient("a#1", "A")), vec![sibling, spouse]);
        let cs = build_family_contradictions(&g, &empty_ambiguity());
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].conflict_type, FamilyConflictType::Relational);
    }
}
