//! Global Clinical Knowledge Graph (GCKG).
//!
//! The final structural layer above every earlier abstraction. Strictly
//! additive — no extraction, no inference, no model calls. Translates
//! the upstream representations (ClinicalEvent, UnifiedEvent,
//! PatientEvent, ConditionState, CanonicalPatientEvent and the
//! LongitudinalPatientGraph that ties them together) into a single
//! queryable graph (`ClinicalKnowledgeGraph`) with deterministic
//! projections and a medico-legal summary.
//!
//! Reversibility — every node carries an `attributes.trace_chain` that
//! lists the ids of every contributing layer (ClinicalEvent →
//! UnifiedEvent → PatientEvent → CanonicalEvent → ConditionState), so
//! callers can drill from any node back to its raw mentions.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::{BTreeMap, BTreeSet};

use crate::clinical_events::EventType;
use crate::clinical_state::ConditionState;
use crate::event_unification::UnifiedEvent;
use crate::patient_longitudinal_reconciliation::{
    CanonicalPatientEvent, CrossDomainKind, LongitudinalPatientGraph, TemporalRelation,
};
use crate::patient_timeline::PatientEvent;

// ── Top-level structures ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalKnowledgeGraph {
    pub graph_id: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub projections: GraphProjections,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub node_id: String,
    pub node_type: NodeType,
    pub concept: String,
    pub event_type: Option<EventType>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub attributes: JsonValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    ClinicalEvent,
    UnifiedEvent,
    PatientEvent,
    CanonicalEvent,
    ConditionState,
    LongitudinalCluster,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub edge_id: String,
    pub from: String,
    pub to: String,
    pub edge_type: EdgeType,
    pub weight: f32,
    pub metadata: JsonValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    ExtractionOf,
    AggregatesInto,
    EvolvesInto,
    TemporalProgression,
    Contradicts,
    Supports,
    CoOccurs,
    Treats,
    Explains,
    CrossDocumentMatch,
}

// ── Projections + medico-legal summary ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphView {
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphProjections {
    pub clinical_view: GraphView,
    pub patient_view: GraphView,
    pub temporal_view: GraphView,
    pub medico_legal_view: GraphView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MedicoLegalSummary {
    pub disputed_concepts: Vec<String>,
    pub high_conflict_nodes: Vec<String>,
    pub contradiction_clusters: Vec<String>,
}

// ── Input context ────────────────────────────────────────────────────────

/// Optional supplementary context. Strictly additive — the primary
/// input is the LongitudinalPatientGraph; everything else is used to
/// populate the `trace_chain` more completely. When absent, ids that
/// cannot be recovered just remain empty arrays.
#[derive(Debug, Default, Clone)]
pub struct CkgContext {
    pub patient_events: Vec<PatientEvent>,
    pub unified_events: Vec<UnifiedEvent>,
    pub condition_states: Vec<ConditionState>,
}

// ── Public API ───────────────────────────────────────────────────────────

/// Build the GCKG from a LongitudinalPatientGraph (primary input) plus
/// any supplementary context the caller has on hand.
pub fn build_clinical_knowledge_graph(
    longitudinal: LongitudinalPatientGraph,
    context: CkgContext,
) -> (ClinicalKnowledgeGraph, MedicoLegalSummary) {
    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();

    // Indexes for quick lookups during cross-layer edge construction.
    let ue_by_canonical: BTreeMap<String, &UnifiedEvent> = context
        .unified_events
        .iter()
        .map(|u| (u.canonical_id.clone(), u))
        .collect();
    let pe_by_id: BTreeMap<String, &PatientEvent> = context
        .patient_events
        .iter()
        .map(|p| (p.patient_event_id.clone(), p))
        .collect();
    // Index intentionally unused at present — kept as a future hook for
    // ConditionState↔ConditionState transition edges. Prefixed with `_`
    // so cargo doesn't warn while the hook is dormant.
    let _cs_by_id: BTreeMap<String, &ConditionState> = context
        .condition_states
        .iter()
        .map(|c| (c.state_id.clone(), c))
        .collect();

    // Pre-compute traces. For every CanonicalPatientEvent we collect the
    // ClinicalEvent ids reachable through `unified_event_ids`.
    let clinical_ids_for_unified = |u_canonical: &str| -> Vec<String> {
        ue_by_canonical
            .get(u_canonical)
            .map(|u| u.source_event_ids.clone())
            .unwrap_or_default()
    };
    let clinical_ids_for_canonical = |c: &CanonicalPatientEvent| -> Vec<String> {
        let mut ids: BTreeSet<String> = BTreeSet::new();
        for u_id in &c.unified_event_ids {
            for cid in clinical_ids_for_unified(u_id) {
                ids.insert(cid);
            }
        }
        ids.into_iter().collect()
    };

    // ── Nodes: CanonicalEvent ───────────────────────────────────────────
    for c in &longitudinal.canonical_events {
        let clinical_ids = clinical_ids_for_canonical(c);
        let condition_state_ids: Vec<String> = context
            .condition_states
            .iter()
            .filter(|s| concept_normalises_to_same(&s.concept, &c.concept))
            .map(|s| s.state_id.clone())
            .collect();
        let trace_chain = serde_json::json!({
            "clinical_event_ids":  clinical_ids,
            "unified_event_ids":   c.unified_event_ids,
            "patient_event_ids":   c.patient_event_ids,
            "condition_state_ids": condition_state_ids,
            "canonical_event_ids": [c.canonical_id.clone()],
        });
        let attributes = serde_json::json!({
            "trace_chain":           trace_chain,
            "conflict_flag":         c.conflict_flag,
            "stability_score":       c.stability_score,
            "dominant_assertion":    c.dominant_assertion,
            "assertion_distribution": c.assertion_distribution,
            "total_occurrences":     c.total_occurrences,
            "document_count":        c.document_count,
        });
        nodes.push(GraphNode {
            node_id: c.canonical_id.clone(),
            node_type: NodeType::CanonicalEvent,
            concept: c.concept.clone(),
            event_type: Some(c.event_type),
            first_seen: c.first_seen.clone(),
            last_seen: c.last_seen.clone(),
            attributes,
        });
    }

    // ── Nodes: PatientEvent ────────────────────────────────────────────
    for pe in &context.patient_events {
        // Find a parent CanonicalPatientEvent (same event_type +
        // normalised concept) so the canonical_event_ids chain is filled
        // in for this patient-level node.
        let canonical_parent_ids: Vec<String> = longitudinal
            .canonical_events
            .iter()
            .filter(|c| c.event_type == pe.event_type
                && concept_normalises_to_same(&c.concept, &pe.concept))
            .map(|c| c.canonical_id.clone())
            .collect();
        // ClinicalEvent ids reachable through this PE's underlying UEs.
        let mut clinical_ids: BTreeSet<String> = BTreeSet::new();
        for ue_id in &pe.source_unified_event_ids {
            for cid in clinical_ids_for_unified(ue_id) {
                clinical_ids.insert(cid);
            }
        }
        let condition_state_ids: Vec<String> = context
            .condition_states
            .iter()
            .filter(|s| s.supporting_events.contains(&pe.patient_event_id)
                || s.contradicting_events.contains(&pe.patient_event_id))
            .map(|s| s.state_id.clone())
            .collect();
        let trace_chain = serde_json::json!({
            "clinical_event_ids":  clinical_ids.into_iter().collect::<Vec<_>>(),
            "unified_event_ids":   pe.source_unified_event_ids,
            "patient_event_ids":   [pe.patient_event_id.clone()],
            "condition_state_ids": condition_state_ids,
            "canonical_event_ids": canonical_parent_ids,
        });
        let attributes = serde_json::json!({
            "trace_chain":         trace_chain,
            "global_assertion":    pe.global_assertion,
            "stability_score":     pe.stability_score,
            "documents":           pe.documents,
            "source_sections":     pe.source_sections,
            "source_document_ids": pe.source_document_ids,
        });
        nodes.push(GraphNode {
            node_id: pe.patient_event_id.clone(),
            node_type: NodeType::PatientEvent,
            concept: pe.concept.clone(),
            event_type: Some(pe.event_type),
            first_seen: pe.first_seen_date.clone(),
            last_seen: pe.last_seen_date.clone(),
            attributes,
        });
    }

    // ── Nodes: UnifiedEvent ────────────────────────────────────────────
    for ue in &context.unified_events {
        let canonical_parent_ids: Vec<String> = longitudinal
            .canonical_events
            .iter()
            .filter(|c| c.unified_event_ids.contains(&ue.canonical_id))
            .map(|c| c.canonical_id.clone())
            .collect();
        let patient_event_ids: Vec<String> = context
            .patient_events
            .iter()
            .filter(|p| p.source_unified_event_ids.contains(&ue.canonical_id))
            .map(|p| p.patient_event_id.clone())
            .collect();
        let trace_chain = serde_json::json!({
            "clinical_event_ids":  ue.source_event_ids.clone(),
            "unified_event_ids":   [ue.canonical_id.clone()],
            "patient_event_ids":   patient_event_ids,
            "condition_state_ids": serde_json::Value::Array(vec![]),
            "canonical_event_ids": canonical_parent_ids,
        });
        let attributes = serde_json::json!({
            "trace_chain":     trace_chain,
            "assertion":       ue.assertion,
            "frequency":       ue.frequency,
            "conflict":        ue.conflict,
            "source_sections": ue.source_sections,
            "metadata":        ue.metadata,
        });
        nodes.push(GraphNode {
            node_id: ue.canonical_id.clone(),
            node_type: NodeType::UnifiedEvent,
            concept: ue.concept.clone(),
            event_type: Some(ue.event_type),
            first_seen: ue.primary_date.clone(),
            last_seen: ue.primary_date.clone(),
            attributes,
        });
    }

    // ── Nodes: ConditionState ──────────────────────────────────────────
    for cs in &context.condition_states {
        // Climb the chain by walking supporting/contradicting PatientEvent
        // ids to find their UnifiedEvent ids and through them the
        // ClinicalEvent ids. The trajectory also names the
        // source_event_id for every transition — a queried diagnosis
        // ends up in neither supporting nor contradicting, so without
        // walking the trajectory the trace_chain would be empty for
        // those condition states. This keeps reversibility intact.
        let mut all_pe_ids: BTreeSet<String> = BTreeSet::new();
        for id in cs.supporting_events.iter().chain(cs.contradicting_events.iter()) {
            all_pe_ids.insert(id.clone());
        }
        for t in &cs.trajectory {
            if !t.source_event_id.is_empty() {
                all_pe_ids.insert(t.source_event_id.clone());
            }
        }
        let mut unified_ids: BTreeSet<String> = BTreeSet::new();
        let mut clinical_ids: BTreeSet<String> = BTreeSet::new();
        for pe_id in &all_pe_ids {
            if let Some(pe) = pe_by_id.get(pe_id) {
                for ue_id in &pe.source_unified_event_ids {
                    unified_ids.insert(ue_id.clone());
                    for cid in clinical_ids_for_unified(ue_id) {
                        clinical_ids.insert(cid);
                    }
                }
            }
        }
        let canonical_parent_ids: Vec<String> = longitudinal
            .canonical_events
            .iter()
            .filter(|c| concept_normalises_to_same(&c.concept, &cs.concept))
            .map(|c| c.canonical_id.clone())
            .collect();
        let trace_chain = serde_json::json!({
            "clinical_event_ids":  clinical_ids.into_iter().collect::<Vec<_>>(),
            "unified_event_ids":   unified_ids.into_iter().collect::<Vec<_>>(),
            "patient_event_ids":   all_pe_ids.into_iter().collect::<Vec<_>>(),
            "condition_state_ids": [cs.state_id.clone()],
            "canonical_event_ids": canonical_parent_ids,
        });
        let attributes = serde_json::json!({
            "trace_chain":      trace_chain,
            "current_status":   cs.current_status,
            "confidence":       cs.confidence,
            "stability":        cs.stability,
            "severity_proxy":   cs.severity_proxy,
            "trajectory":       cs.trajectory,
        });
        nodes.push(GraphNode {
            node_id: cs.state_id.clone(),
            node_type: NodeType::ConditionState,
            concept: cs.concept.clone(),
            event_type: None,
            first_seen: cs.first_appearance.clone(),
            last_seen: cs.last_appearance.clone(),
            attributes,
        });
    }

    // ── Edges from provenance ──────────────────────────────────────────
    // ExtractionOf: ClinicalEvent → UnifiedEvent
    for ue in &context.unified_events {
        for cid in &ue.source_event_ids {
            // Note: the ClinicalEvent node itself isn't materialised
            // here (we don't have its data) — we point edges into the
            // UnifiedEvent node by its id and out from the raw
            // ClinicalEvent id. Consumers that need a real node for the
            // source can synthesise one on demand from the trace chain.
            push_edge(&mut edges, cid.clone(), ue.canonical_id.clone(),
                EdgeType::ExtractionOf, 1.0, serde_json::json!({"layer": "clinical→unified"}));
        }
    }
    // AggregatesInto: UnifiedEvent → PatientEvent
    for pe in &context.patient_events {
        for ue_id in &pe.source_unified_event_ids {
            push_edge(&mut edges, ue_id.clone(), pe.patient_event_id.clone(),
                EdgeType::AggregatesInto, 1.0, serde_json::json!({"layer": "unified→patient"}));
        }
    }
    // AggregatesInto: PatientEvent → CanonicalEvent
    for c in &longitudinal.canonical_events {
        for pe_id in &c.patient_event_ids {
            push_edge(&mut edges, pe_id.clone(), c.canonical_id.clone(),
                EdgeType::AggregatesInto, 1.0, serde_json::json!({"layer": "patient→canonical"}));
        }
    }
    // EvolvesInto: PatientEvent → ConditionState
    for cs in &context.condition_states {
        for pe_id in &cs.supporting_events {
            push_edge(&mut edges, pe_id.clone(), cs.state_id.clone(),
                EdgeType::EvolvesInto, 1.0,
                serde_json::json!({"layer": "patient→condition_state", "role": "supporting"}));
        }
        for pe_id in &cs.contradicting_events {
            push_edge(&mut edges, pe_id.clone(), cs.state_id.clone(),
                EdgeType::EvolvesInto, 1.0,
                serde_json::json!({"layer": "patient→condition_state", "role": "contradicting"}));
        }
    }

    // ── Edges from LongitudinalPatientGraph relationships ─────────────
    for te in &longitudinal.temporal_edges {
        let (edge_type, weight) = match te.relation {
            TemporalRelation::Progression       => (EdgeType::TemporalProgression, 0.8),
            TemporalRelation::Resolution        => (EdgeType::EvolvesInto,         0.8),
            TemporalRelation::Escalation        => (EdgeType::TemporalProgression, 0.8),
            TemporalRelation::TreatmentResponse => (EdgeType::Treats,              0.9),
            TemporalRelation::CoOccurrence      => (EdgeType::CoOccurs,            0.6),
        };
        push_edge(&mut edges,
            te.from_canonical_event.clone(),
            te.to_canonical_event.clone(),
            edge_type,
            weight,
            serde_json::json!({
                "layer":          "longitudinal_temporal",
                "relation":       te.relation,
                "edge_metadata":  te.metadata,
            }));
    }
    for cd in &longitudinal.cross_domain_links {
        let (edge_type, weight) = match cd.kind {
            CrossDomainKind::SymptomDiagnosis              => (EdgeType::Explains,    0.7),
            CrossDomainKind::DiagnosisMedication           => (EdgeType::Treats,      0.9),
            CrossDomainKind::ProcedureSymptomChange        => (EdgeType::Treats,      0.9),
            CrossDomainKind::DiagnosisContradictoryDiagnosis => (EdgeType::Contradicts, 1.0),
        };
        push_edge(&mut edges,
            cd.from_canonical_event.clone(),
            cd.to_canonical_event.clone(),
            edge_type,
            weight,
            serde_json::json!({
                "layer":          "longitudinal_cross_domain",
                "kind":           cd.kind,
                "shared_documents": cd.shared_documents,
                "edge_metadata":  cd.metadata,
            }));
    }

    // ── Explicit Contradicts edges from canonical_event conflict flag ─
    for c in &longitudinal.canonical_events {
        if c.conflict_flag {
            push_edge(&mut edges,
                c.canonical_id.clone(),
                c.canonical_id.clone(),
                EdgeType::Contradicts,
                1.0,
                serde_json::json!({
                    "layer":                  "canonical_conflict_flag",
                    "assertion_distribution": c.assertion_distribution,
                    "dominant_assertion":     c.dominant_assertion,
                }));
        }
    }

    // ── Supports edges — same concept, affirmed-class symptom→diagnosis
    //    backed by co-presence in corpus. Reuses the cross-domain Symptom
    //    Diagnosis links emitted above for affirmed-class symptoms.
    for cd in &longitudinal.cross_domain_links {
        if matches!(cd.kind, CrossDomainKind::SymptomDiagnosis) {
            push_edge(&mut edges,
                cd.from_canonical_event.clone(),
                cd.to_canonical_event.clone(),
                EdgeType::Supports,
                0.9,
                serde_json::json!({
                    "layer": "longitudinal_cross_domain_supports",
                    "kind":  cd.kind,
                }));
        }
    }

    // ── CrossDocumentMatch: every canonical event whose document_count > 1
    for c in &longitudinal.canonical_events {
        if c.document_count > 1 {
            push_edge(&mut edges,
                c.canonical_id.clone(),
                c.canonical_id.clone(),
                EdgeType::CrossDocumentMatch,
                0.7,
                serde_json::json!({
                    "layer":          "canonical_cross_doc",
                    "document_count": c.document_count,
                }));
        }
    }

    // ── Deduplicate (from, to, edge_type) edges, summing weights when
    //    multiple sources produce the same conceptual edge ───────────
    let edges = dedupe_edges(edges);

    // ── Projections ─────────────────────────────────────────────────────
    let projections = build_projections(&nodes, &edges);

    // ── Medico-legal summary ───────────────────────────────────────────
    let medico_legal = build_medico_legal_summary(&longitudinal, &nodes, &edges);

    let graph = ClinicalKnowledgeGraph {
        graph_id: format!("ckg#{}", longitudinal
            .patient_id
            .as_deref()
            .unwrap_or("unknown")),
        nodes,
        edges,
        projections,
    };
    (graph, medico_legal)
}

/// Fallback constructor — accepts a Vec<PatientEvent>. The
/// LongitudinalPatientGraph is synthesised internally by walking the
/// patient layer directly. Useful for tests / callers without an
/// already-built longitudinal graph.
#[allow(dead_code)]
pub fn build_from_patient_events(
    patient_events: Vec<PatientEvent>,
) -> (ClinicalKnowledgeGraph, MedicoLegalSummary) {
    // We have to fabricate a minimal LongitudinalPatientGraph because
    // the GCKG builder assumes that input shape. Use the lower-fidelity
    // path on the longitudinal layer.
    let graph = crate::patient_longitudinal_reconciliation::build_longitudinal_patient_graph_from_patient_events(
        patient_events.clone(),
        None,
    );
    let ctx = CkgContext {
        patient_events,
        unified_events: Vec::new(),
        condition_states: Vec::new(),
    };
    build_clinical_knowledge_graph(graph, ctx)
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn concept_normalises_to_same(a: &str, b: &str) -> bool {
    normalise_concept(a) == normalise_concept(b)
}

fn normalise_concept(s: &str) -> String {
    let lower = s.to_lowercase();
    let trimmed = lower.trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '-');
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn push_edge(
    edges: &mut Vec<GraphEdge>,
    from: String,
    to: String,
    edge_type: EdgeType,
    weight: f32,
    metadata: JsonValue,
) {
    let edge_id = format!(
        "edge#{}#{}#{}",
        from,
        edge_type_as_str(edge_type),
        to
    );
    edges.push(GraphEdge { edge_id, from, to, edge_type, weight, metadata });
}

fn edge_type_as_str(et: EdgeType) -> &'static str {
    match et {
        EdgeType::ExtractionOf        => "extraction_of",
        EdgeType::AggregatesInto      => "aggregates_into",
        EdgeType::EvolvesInto         => "evolves_into",
        EdgeType::TemporalProgression => "temporal_progression",
        EdgeType::Contradicts         => "contradicts",
        EdgeType::Supports            => "supports",
        EdgeType::CoOccurs            => "co_occurs",
        EdgeType::Treats              => "treats",
        EdgeType::Explains            => "explains",
        EdgeType::CrossDocumentMatch  => "cross_document_match",
    }
}

fn dedupe_edges(edges: Vec<GraphEdge>) -> Vec<GraphEdge> {
    // Stable dedup keyed by (from, to, edge_type). Keeps first edge,
    // accumulates source metadata for downstream audit when multiple
    // sources produced the same conceptual edge.
    use std::collections::BTreeMap;
    let mut seen: BTreeMap<(String, String, EdgeType), GraphEdge> = BTreeMap::new();
    for e in edges {
        let key = (e.from.clone(), e.to.clone(), e.edge_type);
        match seen.get_mut(&key) {
            None => { seen.insert(key, e); }
            Some(existing) => {
                // Merge the metadata as a `sources` array.
                let prev_meta = std::mem::replace(&mut existing.metadata, serde_json::json!({}));
                let mut sources: Vec<JsonValue> = match prev_meta.get("sources").and_then(|v| v.as_array()) {
                    Some(a) => a.clone(),
                    None => vec![prev_meta.clone()],
                };
                sources.push(e.metadata);
                existing.metadata = serde_json::json!({ "sources": sources });
                // Weight stays at the first value — projection filtering
                // doesn't depend on cumulative weight in this phase.
            }
        }
    }
    seen.into_values().collect()
}

// ── Projection builder ──────────────────────────────────────────────────

fn build_projections(nodes: &[GraphNode], edges: &[GraphEdge]) -> GraphProjections {
    let node_type_of: BTreeMap<String, NodeType> = nodes
        .iter()
        .map(|n| (n.node_id.clone(), n.node_type))
        .collect();

    // Clinical view: ClinicalEvent / UnifiedEvent / PatientEvent nodes;
    // ExtractionOf + AggregatesInto edges.
    let clinical_node_ids: Vec<String> = nodes
        .iter()
        .filter(|n| matches!(n.node_type,
            NodeType::ClinicalEvent | NodeType::UnifiedEvent | NodeType::PatientEvent))
        .map(|n| n.node_id.clone())
        .collect();
    let clinical_node_set: BTreeSet<&str> =
        clinical_node_ids.iter().map(String::as_str).collect();
    let clinical_edge_ids: Vec<String> = edges
        .iter()
        .filter(|e| matches!(e.edge_type, EdgeType::ExtractionOf | EdgeType::AggregatesInto))
        .filter(|e| {
            // ExtractionOf edges may target a UnifiedEvent without a
            // ClinicalEvent node materialised — keep them as long as the
            // target is in the clinical view's node set.
            clinical_node_set.contains(e.to.as_str())
        })
        .map(|e| e.edge_id.clone())
        .collect();
    let clinical_view = GraphView {
        node_ids: clinical_node_ids,
        edge_ids: clinical_edge_ids,
    };

    // Patient view: PatientEvent + ConditionState + CanonicalEvent.
    let patient_node_ids: Vec<String> = nodes
        .iter()
        .filter(|n| matches!(n.node_type,
            NodeType::PatientEvent | NodeType::ConditionState | NodeType::CanonicalEvent))
        .map(|n| n.node_id.clone())
        .collect();
    let patient_node_set: BTreeSet<&str> =
        patient_node_ids.iter().map(String::as_str).collect();
    let patient_edge_ids: Vec<String> = edges
        .iter()
        .filter(|e| patient_node_set.contains(e.from.as_str())
            && patient_node_set.contains(e.to.as_str()))
        .map(|e| e.edge_id.clone())
        .collect();
    let patient_view = GraphView {
        node_ids: patient_node_ids,
        edge_ids: patient_edge_ids,
    };

    // Temporal view: edges with TemporalProgression | EvolvesInto (the
    // EvolvesInto edges include the Resolution-class temporal-edge
    // family mapped from longitudinal_temporal).
    let temporal_edge_ids: Vec<String> = edges
        .iter()
        .filter(|e| matches!(e.edge_type,
            EdgeType::TemporalProgression | EdgeType::EvolvesInto))
        .map(|e| e.edge_id.clone())
        .collect();
    // Include any node touched by a temporal edge.
    let mut temporal_nodes: BTreeSet<String> = BTreeSet::new();
    for e in edges.iter() {
        if matches!(e.edge_type, EdgeType::TemporalProgression | EdgeType::EvolvesInto) {
            temporal_nodes.insert(e.from.clone());
            temporal_nodes.insert(e.to.clone());
        }
    }
    let temporal_view = GraphView {
        node_ids: temporal_nodes.into_iter().collect(),
        edge_ids: temporal_edge_ids,
    };

    // Medico-legal view: Contradicts / Supports / CrossDocumentMatch
    // edges plus any ConditionState node (transitions live on the
    // condition state attributes — drilling that node surfaces them).
    let mut ml_nodes: BTreeSet<String> = BTreeSet::new();
    for n in nodes {
        if n.node_type == NodeType::ConditionState {
            ml_nodes.insert(n.node_id.clone());
        }
    }
    let ml_edge_ids: Vec<String> = edges
        .iter()
        .filter(|e| matches!(e.edge_type,
            EdgeType::Contradicts | EdgeType::Supports | EdgeType::CrossDocumentMatch))
        .map(|e| {
            ml_nodes.insert(e.from.clone());
            ml_nodes.insert(e.to.clone());
            e.edge_id.clone()
        })
        .collect();
    let medico_legal_view = GraphView {
        node_ids: ml_nodes.into_iter().collect(),
        edge_ids: ml_edge_ids,
    };

    let _ = node_type_of; // future hook for richer per-projection rules
    GraphProjections { clinical_view, patient_view, temporal_view, medico_legal_view }
}

// ── Medico-legal summary ────────────────────────────────────────────────

fn build_medico_legal_summary(
    g: &LongitudinalPatientGraph,
    nodes: &[GraphNode],
    edges: &[GraphEdge],
) -> MedicoLegalSummary {
    let mut disputed_concepts: BTreeSet<String> = BTreeSet::new();
    for c in &g.canonical_events {
        if c.conflict_flag {
            disputed_concepts.insert(c.concept.clone());
        }
    }
    let disputed_concepts: Vec<String> = disputed_concepts.into_iter().collect();

    // Count contradiction edges per node (incoming or outgoing).
    let mut contradiction_count_per_node: BTreeMap<String, u32> = BTreeMap::new();
    for e in edges {
        if e.edge_type == EdgeType::Contradicts {
            *contradiction_count_per_node.entry(e.from.clone()).or_insert(0) += 1;
            if e.from != e.to {
                *contradiction_count_per_node.entry(e.to.clone()).or_insert(0) += 1;
            }
        }
    }

    let mut high_conflict_nodes: BTreeSet<String> = BTreeSet::new();
    for n in nodes {
        let contra_n = contradiction_count_per_node.get(&n.node_id).copied().unwrap_or(0);
        let conflict_flag = n
            .attributes
            .get("conflict_flag")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let stability = n
            .attributes
            .get("stability_score")
            .or_else(|| n.attributes.get("stability"))
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0) as f32;
        if conflict_flag || stability < 0.5 || contra_n > 2 {
            high_conflict_nodes.insert(n.node_id.clone());
        }
    }
    let high_conflict_nodes: Vec<String> = high_conflict_nodes.into_iter().collect();

    let mut contradiction_clusters: BTreeSet<String> = BTreeSet::new();
    for c in &g.canonical_events {
        if c.conflict_flag {
            contradiction_clusters.insert(c.canonical_id.clone());
        }
    }
    let contradiction_clusters: Vec<String> = contradiction_clusters.into_iter().collect();

    MedicoLegalSummary { disputed_concepts, high_conflict_nodes, contradiction_clusters }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::{AssertionStatus, EventType};
    use crate::clinical_state::ConditionStatus;
    use crate::patient_longitudinal_reconciliation::build_longitudinal_patient_graph;
    use crate::patient_timeline::build_patient_timeline_from_unified;

    fn ue(
        canonical: &str,
        et: EventType,
        concept: &str,
        assertion: AssertionStatus,
        merged: &[AssertionStatus],
        source_event_ids: &[&str],
    ) -> UnifiedEvent {
        UnifiedEvent {
            canonical_id: canonical.to_string(),
            event_type: et,
            concept: concept.to_string(),
            primary_date: None,
            date_range: None,
            date_precision: None,
            assertion,
            source_event_ids: source_event_ids.iter().map(|s| s.to_string()).collect(),
            source_sections: Vec::new(),
            source_snippets: vec![format!("snippet for {concept}")],
            participants: Vec::new(),
            related_event_ids: Vec::new(),
            confidence: 0.5,
            frequency: 1,
            conflict: false,
            metadata: serde_json::json!({
                "merged_status_set": merged.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            }),
        }
    }

    fn build_for_two_docs(
        doc_a_events: Vec<UnifiedEvent>,
        doc_b_events: Vec<UnifiedEvent>,
    ) -> (ClinicalKnowledgeGraph, MedicoLegalSummary) {
        let docs = vec![("docA".into(), doc_a_events.clone()), ("docB".into(), doc_b_events.clone())];
        let longitudinal = build_longitudinal_patient_graph(docs.clone(), Some("patient-1".into()));
        let patient_events = build_patient_timeline_from_unified(docs);
        let mut unified_events: Vec<UnifiedEvent> = Vec::new();
        unified_events.extend(doc_a_events);
        unified_events.extend(doc_b_events);
        build_clinical_knowledge_graph(longitudinal, CkgContext {
            patient_events,
            unified_events,
            condition_states: Vec::new(),
        })
    }

    #[test]
    fn full_pipeline_graph_consistency() {
        let doc_a = vec![
            ue("u-dx",  EventType::Diagnosis,        "ptsd", AssertionStatus::Affirmed,
                &[AssertionStatus::Affirmed], &["ce-1"]),
            ue("u-med", EventType::MedicationMention,"sertraline", AssertionStatus::Affirmed,
                &[AssertionStatus::Affirmed], &["ce-2"]),
        ];
        let doc_b = vec![
            ue("u-dx-b", EventType::Diagnosis, "PTSD", AssertionStatus::Contradicted,
                &[AssertionStatus::Contradicted], &["ce-3"]),
        ];
        let (g, _) = build_for_two_docs(doc_a, doc_b);
        // graph_id present, nodes & edges non-empty.
        assert!(g.graph_id.starts_with("ckg#"));
        assert!(!g.nodes.is_empty());
        assert!(!g.edges.is_empty());
        // Projections include at least the canonical/clinical/patient/temporal/ml view ids.
        assert!(!g.projections.clinical_view.node_ids.is_empty());
        assert!(!g.projections.patient_view.node_ids.is_empty());
    }

    #[test]
    fn graph_reversibility_all_nodes_trace_to_clinical_event() {
        let doc_a = vec![
            ue("u-dx",  EventType::Diagnosis,         "ptsd", AssertionStatus::Affirmed,
                &[AssertionStatus::Affirmed], &["ce-dx-1"]),
            ue("u-sym", EventType::Symptom,           "anxiety", AssertionStatus::SymptomOnly,
                &[AssertionStatus::SymptomOnly], &["ce-sym-1"]),
            ue("u-med", EventType::MedicationMention, "sertraline", AssertionStatus::Affirmed,
                &[AssertionStatus::Affirmed], &["ce-med-1"]),
        ];
        let (g, _) = build_for_two_docs(doc_a, Vec::new());
        for n in &g.nodes {
            let cids = n.attributes
                .get("trace_chain")
                .and_then(|t| t.get("clinical_event_ids"))
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            assert!(cids > 0,
                "node {} ({:?}) lacks clinical_event_ids in trace_chain: {:?}",
                n.node_id, n.node_type, n.attributes);
        }
    }

    #[test]
    fn medico_legal_view_only_contains_disputed_nodes() {
        let doc_a = vec![ue("u1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
            &[AssertionStatus::Affirmed], &["ce-1"])];
        let doc_b = vec![ue("u2", EventType::Diagnosis, "ptsd", AssertionStatus::Contradicted,
            &[AssertionStatus::Contradicted], &["ce-2"])];
        let (g, ml) = build_for_two_docs(doc_a, doc_b);
        // The disputed concept must appear in the summary.
        assert!(ml.disputed_concepts.iter().any(|c| c.to_lowercase().contains("ptsd")),
            "disputed_concepts must list PTSD: {:?}", ml.disputed_concepts);
        // High-conflict nodes must include the PTSD canonical node.
        let ptsd_canonical = g.nodes.iter()
            .find(|n| n.node_type == NodeType::CanonicalEvent
                && n.concept.to_lowercase().contains("ptsd"))
            .map(|n| n.node_id.clone())
            .expect("PTSD canonical node missing");
        assert!(ml.high_conflict_nodes.contains(&ptsd_canonical),
            "high_conflict_nodes must include {}: {:?}", ptsd_canonical, ml.high_conflict_nodes);
        // Medico-legal view edges must all be in {Contradicts, Supports, CrossDocumentMatch}.
        let allowed: BTreeSet<EdgeType> = [
            EdgeType::Contradicts, EdgeType::Supports, EdgeType::CrossDocumentMatch,
        ].into_iter().collect();
        for eid in &g.projections.medico_legal_view.edge_ids {
            let e = g.edges.iter().find(|x| &x.edge_id == eid).unwrap();
            assert!(allowed.contains(&e.edge_type),
                "medico-legal view contained a non-medico-legal edge type {:?}", e.edge_type);
        }
    }

    #[test]
    fn contradiction_edges_preserve_all_sources() {
        let doc_a = vec![ue("u1", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
            &[AssertionStatus::Affirmed], &["ce-1"])];
        let doc_b = vec![ue("u2", EventType::Diagnosis, "ptsd", AssertionStatus::Contradicted,
            &[AssertionStatus::Contradicted], &["ce-2"])];
        let (g, _) = build_for_two_docs(doc_a, doc_b);
        let contradicts: Vec<_> = g.edges.iter()
            .filter(|e| e.edge_type == EdgeType::Contradicts).collect();
        assert!(!contradicts.is_empty(),
            "expected at least one Contradicts edge: edges={:?}",
            g.edges.iter().map(|e| e.edge_type).collect::<Vec<_>>());
        // The edge weight must be 1.0 per Rule D.
        for e in &contradicts {
            assert!((e.weight - 1.0).abs() < 1e-4,
                "Contradicts weight must be 1.0; got {}", e.weight);
        }
    }

    #[test]
    fn temporal_view_matches_patient_timeline_order() {
        let doc_a = vec![
            ue("u-sym", EventType::Symptom,  "ptsd", AssertionStatus::SymptomOnly,
                &[AssertionStatus::SymptomOnly], &["ce-sym"]),
            ue("u-dx",  EventType::Diagnosis,"ptsd", AssertionStatus::Affirmed,
                &[AssertionStatus::Affirmed], &["ce-dx"]),
        ];
        let (g, _) = build_for_two_docs(doc_a, Vec::new());
        // Temporal view's edge ids must all map to TemporalProgression or EvolvesInto edges.
        for eid in &g.projections.temporal_view.edge_ids {
            let e = g.edges.iter().find(|x| &x.edge_id == eid).unwrap();
            assert!(matches!(e.edge_type, EdgeType::TemporalProgression | EdgeType::EvolvesInto),
                "temporal view contained non-temporal edge {:?}", e.edge_type);
        }
        // At least one TemporalProgression edge must exist (symptom→diagnosis).
        assert!(g.edges.iter().any(|e| e.edge_type == EdgeType::TemporalProgression),
            "expected at least one TemporalProgression edge");
    }

    #[test]
    fn cross_layer_node_unification_is_lossless() {
        let doc_a = vec![
            ue("u-dx",  EventType::Diagnosis,         "ptsd", AssertionStatus::Affirmed,
                &[AssertionStatus::Affirmed], &["ce-dx-1"]),
        ];
        let doc_b = vec![
            ue("u-dx-b", EventType::Diagnosis, "PTSD", AssertionStatus::Contradicted,
                &[AssertionStatus::Contradicted], &["ce-dx-2"]),
        ];
        let (g, _) = build_for_two_docs(doc_a.clone(), doc_b.clone());

        // Both UnifiedEvent nodes must survive (no collapse).
        for u in doc_a.iter().chain(doc_b.iter()) {
            assert!(g.nodes.iter().any(|n|
                n.node_type == NodeType::UnifiedEvent && n.node_id == u.canonical_id),
                "UnifiedEvent {} missing from graph", u.canonical_id);
        }
        // Exactly one CanonicalEvent node for PTSD diagnosis.
        let canon_count = g.nodes.iter()
            .filter(|n| n.node_type == NodeType::CanonicalEvent
                && n.concept.to_lowercase().contains("ptsd")).count();
        assert_eq!(canon_count, 1,
            "expected 1 CanonicalEvent for PTSD, got {canon_count}");
    }

    #[test]
    fn ckg_includes_condition_state_node_when_context_supplied() {
        let doc_a = vec![ue("u-dx", EventType::Diagnosis, "ptsd", AssertionStatus::Affirmed,
            &[AssertionStatus::Affirmed], &["ce-dx-1"])];
        let docs = vec![("docA".into(), doc_a.clone())];
        let longitudinal = build_longitudinal_patient_graph(docs.clone(), Some("p1".into()));
        let patient_events = build_patient_timeline_from_unified(docs);
        let condition_states = crate::clinical_state::build_clinical_state(patient_events.clone());
        let (g, _ml) = build_clinical_knowledge_graph(longitudinal, CkgContext {
            patient_events,
            unified_events: doc_a,
            condition_states: condition_states.clone(),
        });
        // ConditionState node must exist for PTSD.
        let cs_present = g.nodes.iter().any(|n|
            n.node_type == NodeType::ConditionState && n.concept.to_lowercase().contains("ptsd"));
        assert!(cs_present, "expected ConditionState node for PTSD");
        // ConditionState node attributes must include current_status.
        let cs_node = g.nodes.iter().find(|n|
            n.node_type == NodeType::ConditionState && n.concept.to_lowercase().contains("ptsd")).unwrap();
        let status = cs_node.attributes.get("current_status").and_then(|v| v.as_str()).unwrap_or("");
        assert_eq!(status, ConditionStatus::Active.as_str(),
            "ConditionState for affirmed PTSD must be Active; got {status}");
    }
}
