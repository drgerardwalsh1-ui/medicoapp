//! Contradiction Graph builder — the ONLY constructor of `ContradictionGraph`.
//!
//! PURE PROJECTION over `ContradictionEngineOutput`. It reads the enriched
//! contradiction stream (`view.enriched_contradictions`) and lowers each
//! contradiction into typed nodes and edges. It computes NO new clinical
//! semantics: every confidence, severity, value, source, and date is carried
//! verbatim from engine fields. The engine output is taken by reference and
//! never mutated.
//!
//! Lowering rules (per enriched contradiction, values in engine order —
//! canonical first, then alternatives):
//!   - ContradictionNode  `cx:{cid}`
//!   - FactNode per observed value        `fact:{cid}:{value}`
//!   - DocumentNode per distinct source   `doc:{source}`   (merged across cx)
//!   - EntityNode per subject             `ent:subject:{subject}` (merged)
//!   - SUPPORTS       fact → cx           weight = value confidence share
//!   - CONTRADICTS    fact_i → fact_j     (i < j) weight = conf_i + conf_j (≤1)
//!   - DERIVED_FROM   fact → doc          weight = doc's share of the value's
//!                                        observations
//!   - RELATES_TO     entity → fact       weight = 1.0
//!   - TEMPORAL_NEXT  fact → fact         consecutive dated values, ordered by
//!                                        (earliest date, id)
//!   - STRENGTHENS    cx → canonical fact weight = resolution_confidence
//!   - WEAKENS        cx → each alt fact  weight = resolution_confidence
//!
//! Determinism: input stream is already deterministically sorted; all merge
//! containers are `BTreeMap`; output vectors come from those maps (sorted by
//! id). No HashMap, no randomness, no clocks.

#![allow(dead_code)]

use std::collections::BTreeMap;

use crate::canonical_case::{CaseContradictionBody, ContradictionSource};
use crate::contradiction_engine::ContradictionEngineOutput;
use crate::contradiction_enrichment::EnrichedCaseContradiction;
use crate::graph_types::{
    ContradictionGraph, ContradictionNode, DocumentNode, Edge, EdgeKind, EntityNode, FactNode,
    GraphMetadata, Node, NodeProvenance, GRAPH_SCHEMA_VERSION,
};

/// One observed value of a contradiction, normalised across the clinical and
/// family ontologies (both are isomorphic: value + support + confidence +
/// sources). Internal to the builder.
struct ValueView {
    value: String,
    support_count: u32,
    confidence: f32,
    /// (source document, optional date) pairs, in engine order.
    sources: Vec<(String, Option<String>)>,
    /// Sentence-level evidence contexts, in engine order.
    contexts: Vec<String>,
}

/// Per-value extraction provenance lifted from the contradiction body's
/// `metadata.value_provenance` (written by `fact_contradiction`): explicit
/// polarity and the matched text span. Absent for clinical-evolution bodies.
struct ValueProvenance {
    polarity: Option<String>,
    text_span: Option<[u64; 2]>,
}

fn value_provenance_of(metadata: &serde_json::Value) -> BTreeMap<String, ValueProvenance> {
    let mut out: BTreeMap<String, ValueProvenance> = BTreeMap::new();
    if let Some(items) = metadata.get("value_provenance").and_then(|v| v.as_array()) {
        for item in items {
            let Some(value) = item.get("value").and_then(|v| v.as_str()) else { continue };
            let polarity = item
                .get("polarity")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let text_span = match (
                item.get("char_offset_start").and_then(|v| v.as_u64()),
                item.get("char_offset_end").and_then(|v| v.as_u64()),
            ) {
                (Some(s), Some(e)) => Some([s, e]),
                _ => None,
            };
            out.insert(value.to_string(), ValueProvenance { polarity, text_span });
        }
    }
    out
}

/// The body's free-form metadata (both ontologies carry one).
fn body_metadata(body: &CaseContradictionBody) -> &serde_json::Value {
    match body {
        CaseContradictionBody::Clinical(c) => &c.metadata,
        CaseContradictionBody::Family(f) => &f.metadata,
    }
}

/// Normalise the typed body into ordered values: canonical first, then
/// alternatives, exactly as the engine stores them.
fn values_of(body: &CaseContradictionBody) -> Vec<ValueView> {
    fn clinical_sources(srcs: &[ContradictionSource]) -> Vec<(String, Option<String>)> {
        srcs.iter().map(|s| (s.source.clone(), s.date.clone())).collect()
    }
    match body {
        CaseContradictionBody::Clinical(c) => std::iter::once(&c.canonical_value)
            .chain(c.alternatives.iter())
            .map(|v| ValueView {
                value: v.value.clone(),
                support_count: v.support_count,
                confidence: v.confidence,
                sources: clinical_sources(&v.sources),
                contexts: v.sources.iter().map(|s| s.context.clone()).collect(),
            })
            .collect(),
        CaseContradictionBody::Family(f) => std::iter::once(&f.canonical_value)
            .chain(f.alternatives.iter())
            .map(|v| ValueView {
                value: v.value.clone(),
                support_count: v.support_count,
                confidence: v.confidence,
                sources: v
                    .sources
                    .iter()
                    .map(|s| (s.source.clone(), s.date.clone()))
                    .collect(),
                contexts: v.sources.iter().map(|s| s.context.clone()).collect(),
            })
            .collect(),
    }
}

/// Earliest ISO-sortable date in a list, if any. `Option<String>` min over
/// `Some` values only; lexicographic compare is correct for ISO dates.
fn earliest_date<'a, I: Iterator<Item = &'a Option<String>>>(dates: I) -> Option<String> {
    dates.flatten().min().cloned()
}

/// Keep the smaller `Some` date; `None` never overwrites `Some`.
fn merge_earliest(slot: &mut Option<String>, candidate: &Option<String>) {
    match (slot.as_ref(), candidate) {
        (None, Some(c)) => *slot = Some(c.clone()),
        (Some(s), Some(c)) if c < s => *slot = Some(c.clone()),
        _ => {}
    }
}

fn clamp01(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

/// Build the explorable Contradiction Graph from the engine output.
/// Pure function: no side effects, no mutation of `input`, fully deterministic.
pub fn build_contradiction_graph(input: &ContradictionEngineOutput) -> ContradictionGraph {
    // Deterministic accumulators (sorted by id by construction).
    let mut nodes: BTreeMap<String, Node> = BTreeMap::new();
    let mut edges: BTreeMap<String, Edge> = BTreeMap::new();
    // Merge state for nodes shared across contradictions.
    let mut doc_dates: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut doc_refs: BTreeMap<String, Vec<String>> = BTreeMap::new(); // doc -> cx ids
    let mut entity_docs: BTreeMap<String, Vec<String>> = BTreeMap::new(); // subject -> docs
    let mut entity_dates: BTreeMap<String, Option<String>> = BTreeMap::new();

    let enriched: &[EnrichedCaseContradiction] = &input.view.enriched_contradictions;

    for e in enriched {
        let cid = &e.base.contradiction_id;
        let cx_id = format!("cx:{cid}");
        let values = values_of(&e.base.body);
        let prov_map = value_provenance_of(body_metadata(&e.base.body));

        // ── Per-value fact nodes ────────────────────────────────────────────
        let mut fact_ids: Vec<String> = Vec::with_capacity(values.len());
        let mut cx_docs: Vec<String> = Vec::new();
        for v in &values {
            let fact_id = format!("fact:{cid}:{}", v.value);
            let mut docs: Vec<String> = v.sources.iter().map(|(s, _)| s.clone()).collect();
            docs.sort();
            docs.dedup();
            let ts = earliest_date(v.sources.iter().map(|(_, d)| d));
            nodes.insert(
                fact_id.clone(),
                Node::Fact(FactNode {
                    id: fact_id.clone(),
                    subject: e.base.subject.clone(),
                    value: v.value.clone(),
                    support_count: v.support_count,
                    confidence: clamp01(v.confidence),
                    timestamp: ts,
                    polarity: prov_map.get(&v.value).and_then(|p| p.polarity.clone()),
                    text_span: prov_map.get(&v.value).and_then(|p| p.text_span),
                    evidence: {
                        let mut ev = v.contexts.clone();
                        ev.sort();
                        ev.dedup();
                        ev
                    },
                    provenance: NodeProvenance {
                        documents: docs.clone(),
                        extraction_source: "contradiction_engine:value".to_string(),
                    },
                }),
            );
            cx_docs.extend(docs.iter().cloned());

            // Document accumulation + DERIVED_FROM edges.
            let total = v.sources.len().max(1) as f32;
            for doc in &docs {
                let doc_id = format!("doc:{doc}");
                let date_here =
                    earliest_date(v.sources.iter().filter(|(s, _)| s == doc).map(|(_, d)| d));
                merge_earliest(doc_dates.entry(doc.clone()).or_default(), &date_here);
                doc_refs.entry(doc.clone()).or_default().push(cx_id.clone());
                let count_here =
                    v.sources.iter().filter(|(s, _)| s == doc).count() as f32;
                let edge_id = Edge::make_id(EdgeKind::DerivedFrom, &fact_id, &doc_id);
                edges.insert(
                    edge_id.clone(),
                    Edge {
                        id: edge_id,
                        kind: EdgeKind::DerivedFrom,
                        from: fact_id.clone(),
                        to: doc_id,
                        weight: clamp01(count_here / total),
                        reasoning: "extraction_provenance".to_string(),
                        provenance: format!(
                            "{} of {} observation(s) of value '{}' extracted from this document",
                            count_here as u32, total as u32, v.value
                        ),
                    },
                );
            }

            // SUPPORTS fact → contradiction.
            let edge_id = Edge::make_id(EdgeKind::Supports, &fact_id, &cx_id);
            edges.insert(
                edge_id.clone(),
                Edge {
                    id: edge_id,
                    kind: EdgeKind::Supports,
                    from: fact_id.clone(),
                    to: cx_id.clone(),
                    weight: clamp01(v.confidence),
                    reasoning: "value_support".to_string(),
                    provenance: format!(
                        "observed value '{}' with {} supporting observation(s)",
                        v.value, v.support_count
                    ),
                },
            );

            fact_ids.push(fact_id);
        }
        cx_docs.sort();
        cx_docs.dedup();

        // ── Contradiction node ──────────────────────────────────────────────
        let cx_ts = earliest_date(
            values
                .iter()
                .flat_map(|v| v.sources.iter().map(|(_, d)| d)),
        );
        nodes.insert(
            cx_id.clone(),
            Node::Contradiction(ContradictionNode {
                id: cx_id.clone(),
                contradiction_id: cid.clone(),
                domain: e.base.domain.as_str().to_string(),
                conflict_label: e.base.conflict_label.clone(),
                subject: e.base.subject.clone(),
                severity_rank: e.derived.severity_rank,
                confidence: clamp01(e.base.resolution_confidence),
                timestamp: cx_ts,
                provenance: NodeProvenance {
                    documents: cx_docs.clone(),
                    extraction_source: "contradiction_engine:view".to_string(),
                },
            }),
        );

        // ── Entity accumulation + RELATES_TO ────────────────────────────────
        let ent_id = format!("ent:subject:{}", e.base.subject);
        entity_docs
            .entry(e.base.subject.clone())
            .or_default()
            .extend(cx_docs.iter().cloned());
        {
            let v = values.first();
            let first_ts = v.and_then(|v| earliest_date(v.sources.iter().map(|(_, d)| d)));
            merge_earliest(
                entity_dates.entry(e.base.subject.clone()).or_default(),
                &first_ts,
            );
        }
        for fact_id in &fact_ids {
            let edge_id = Edge::make_id(EdgeKind::RelatesTo, &ent_id, fact_id);
            edges.insert(
                edge_id.clone(),
                Edge {
                    id: edge_id,
                    kind: EdgeKind::RelatesTo,
                    from: ent_id.clone(),
                    to: fact_id.clone(),
                    weight: 1.0,
                    reasoning: "subject_of".to_string(),
                    provenance: format!("fact describes subject '{}'", e.base.subject),
                },
            );
        }

        // ── CONTRADICTS: pairwise mutual exclusion (engine value order) ─────
        for i in 0..fact_ids.len() {
            for j in (i + 1)..fact_ids.len() {
                let edge_id =
                    Edge::make_id(EdgeKind::Contradicts, &fact_ids[i], &fact_ids[j]);
                edges.insert(
                    edge_id.clone(),
                    Edge {
                        id: edge_id,
                        kind: EdgeKind::Contradicts,
                        from: fact_ids[i].clone(),
                        to: fact_ids[j].clone(),
                        weight: clamp01(values[i].confidence + values[j].confidence),
                        reasoning: "mutual_exclusion".to_string(),
                        provenance: format!(
                            "values '{}' and '{}' cannot both hold for '{}'",
                            values[i].value, values[j].value, e.base.subject
                        ),
                    },
                );
            }
        }

        // ── STRENGTHENS / WEAKENS from the dominant resolution ──────────────
        if let Some(canonical) = fact_ids.first() {
            let edge_id = Edge::make_id(EdgeKind::Strengthens, &cx_id, canonical);
            edges.insert(
                edge_id.clone(),
                Edge {
                    id: edge_id,
                    kind: EdgeKind::Strengthens,
                    from: cx_id.clone(),
                    to: canonical.clone(),
                    weight: clamp01(e.base.resolution_confidence),
                    reasoning: "dominant_resolution".to_string(),
                    provenance: "canonical value carries the dominant support share".to_string(),
                },
            );
        }
        for alt in fact_ids.iter().skip(1) {
            let edge_id = Edge::make_id(EdgeKind::Weakens, &cx_id, alt);
            edges.insert(
                edge_id.clone(),
                Edge {
                    id: edge_id,
                    kind: EdgeKind::Weakens,
                    from: cx_id.clone(),
                    to: alt.clone(),
                    weight: clamp01(e.base.resolution_confidence),
                    reasoning: "contested_alternative".to_string(),
                    provenance: "alternative value is contested by the dominant resolution"
                        .to_string(),
                },
            );
        }

        // ── TEMPORAL_NEXT: chronological drift across dated values ──────────
        let mut dated: Vec<(String, String)> = fact_ids
            .iter()
            .zip(values.iter())
            .filter_map(|(fid, v)| {
                earliest_date(v.sources.iter().map(|(_, d)| d)).map(|d| (d, fid.clone()))
            })
            .collect();
        dated.sort(); // by (date, fact id) — deterministic tiebreak
        for pair in dated.windows(2) {
            let (da, fa) = &pair[0];
            let (db, fb) = &pair[1];
            let edge_id = Edge::make_id(EdgeKind::TemporalNext, fa, fb);
            edges.insert(
                edge_id.clone(),
                Edge {
                    id: edge_id,
                    kind: EdgeKind::TemporalNext,
                    from: fa.clone(),
                    to: fb.clone(),
                    weight: 1.0,
                    reasoning: "chronological_drift".to_string(),
                    provenance: format!("recorded {da}, then {db}"),
                },
            );
        }
    }

    // ── Materialise merged document / entity nodes ───────────────────────────
    for (doc, date) in &doc_dates {
        let mut refs = doc_refs.remove(doc).unwrap_or_default();
        refs.sort();
        refs.dedup();
        let id = format!("doc:{doc}");
        nodes.insert(
            id.clone(),
            Node::Document(DocumentNode {
                id,
                source: doc.clone(),
                confidence: 1.0,
                timestamp: date.clone(),
                provenance: NodeProvenance {
                    documents: vec![doc.clone()],
                    extraction_source: "contradiction_engine:source".to_string(),
                },
            }),
        );
    }
    for (subject, docs) in &mut entity_docs {
        docs.sort();
        docs.dedup();
        let id = format!("ent:subject:{subject}");
        nodes.insert(
            id.clone(),
            Node::Entity(EntityNode {
                id,
                name: subject.clone(),
                entity_kind: "subject".to_string(),
                confidence: 1.0,
                timestamp: entity_dates.get(subject).cloned().flatten(),
                provenance: NodeProvenance {
                    documents: docs.clone(),
                    extraction_source: "contradiction_engine:subject".to_string(),
                },
            }),
        );
    }

    // ── Assemble (BTreeMap iteration ⇒ sorted by id) ─────────────────────────
    let node_vec: Vec<Node> = nodes.into_values().collect();
    let edge_vec: Vec<Edge> = edges.into_values().collect();
    let mut node_counts: BTreeMap<String, usize> = BTreeMap::new();
    for n in &node_vec {
        *node_counts.entry(n.kind_str().to_string()).or_default() += 1;
    }
    let mut edge_counts: BTreeMap<String, usize> = BTreeMap::new();
    for e in &edge_vec {
        *edge_counts.entry(e.kind.as_str().to_string()).or_default() += 1;
    }

    ContradictionGraph {
        nodes: node_vec,
        edges: edge_vec,
        metadata: GraphMetadata {
            schema_version: GRAPH_SCHEMA_VERSION.to_string(),
            contradiction_count: enriched.len(),
            node_counts,
            edge_counts,
        },
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tests — graph built from REAL engine output; engines exercised end-to-end.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::{
        CaseContradiction, ConflictDimension, Contradiction, ContradictionDomain,
        ContradictionValue,
    };
    use crate::case_events::InjuryEvent;
    use crate::clinical_events::{AssertionStatus, EventType};
    use crate::contradiction_engine::{
        run_contradiction_engine, run_contradiction_engine_with_graph,
    };
    use crate::contradiction_enrichment::{ContradictionDerivedFields, EnrichedCaseContradiction};
    use crate::event_dispatch::EventEnvelope;
    use crate::graph_query::{
        high_impact_nodes, most_severe_contradictions, subgraph, temporal_drift_chain,
    };
    use crate::graph_types::graph_is_consistent;
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

    fn conflicted_batch() -> Vec<EventEnvelope> {
        vec![
            injury_env("i1", "fractured wrist", AssertionStatus::Affirmed, "docA"),
            injury_env("i2", "fractured wrist", AssertionStatus::Negated, "docB"),
        ]
    }

    #[test]
    fn build_is_deterministic_and_consistent() {
        let g1 = build_contradiction_graph(&run_contradiction_engine(conflicted_batch(), &[]));
        let g2 = build_contradiction_graph(&run_contradiction_engine(conflicted_batch(), &[]));
        assert_eq!(
            serde_json::to_string(&g1).unwrap(),
            serde_json::to_string(&g2).unwrap(),
            "graph build must be byte-identical across runs"
        );
        assert!(graph_is_consistent(&g1));
    }

    #[test]
    fn engine_output_is_unchanged_by_graph_production() {
        let plain = run_contradiction_engine(conflicted_batch(), &[]);
        let with_graph = run_contradiction_engine_with_graph(conflicted_batch(), &[]);
        assert_eq!(
            serde_json::to_string(&plain.case).unwrap(),
            serde_json::to_string(&with_graph.output.case).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&plain.view).unwrap(),
            serde_json::to_string(&with_graph.output.view).unwrap()
        );
        assert_eq!(plain.csv_lines, with_graph.output.csv_lines);
        assert_eq!(plain.export, with_graph.output.export);
    }

    #[test]
    fn clinical_conflict_lowers_to_expected_topology() {
        let g = build_contradiction_graph(&run_contradiction_engine(conflicted_batch(), &[]));

        // 1 contradiction + 2 facts + 1 document + 1 entity. NB: in the clinical
        // evolution path, ContradictionSource.source is the unified-event label
        // (e.g. "diagnosis#fractured wrist"), so both values share one source
        // node here; the fact-extraction path carries real document ids.
        assert_eq!(g.metadata.node_counts.get("contradiction"), Some(&1));
        assert_eq!(g.metadata.node_counts.get("fact"), Some(&2));
        assert_eq!(g.metadata.node_counts.get("document"), Some(&1));
        assert_eq!(g.metadata.node_counts.get("entity"), Some(&1));
        assert_eq!(g.metadata.contradiction_count, 1);

        // Edge kinds: 2 SUPPORTS, 1 CONTRADICTS, 2 DERIVED_FROM, 2 RELATES_TO,
        // 1 STRENGTHENS, 1 WEAKENS (no dates ⇒ no TEMPORAL_NEXT).
        assert_eq!(g.metadata.edge_counts.get("SUPPORTS"), Some(&2));
        assert_eq!(g.metadata.edge_counts.get("CONTRADICTS"), Some(&1));
        assert_eq!(g.metadata.edge_counts.get("DERIVED_FROM"), Some(&2));
        assert_eq!(g.metadata.edge_counts.get("RELATES_TO"), Some(&2));
        assert_eq!(g.metadata.edge_counts.get("STRENGTHENS"), Some(&1));
        assert_eq!(g.metadata.edge_counts.get("WEAKENS"), Some(&1));
        assert_eq!(g.metadata.edge_counts.get("TEMPORAL_NEXT"), None);

        // Documents traceable from the conflict: both source docs present.
        assert!(g.node("doc:diagnosis#fractured wrist").is_some());

        // Example query: most severe contradictions is non-empty and ranked.
        let severe = most_severe_contradictions(&g);
        assert_eq!(severe.len(), 1);
        assert!(severe[0].severity_rank >= 1);

        // High-impact: the contradiction node and facts dominate.
        let impact = high_impact_nodes(&g, 3);
        assert!(!impact.is_empty());
        assert!(impact.iter().all(|(_, s)| *s >= 0.0));
    }

    #[test]
    fn subgraph_expands_by_hops_deterministically() {
        let g = build_contradiction_graph(&run_contradiction_engine(conflicted_batch(), &[]));
        let cx_id = g
            .nodes
            .iter()
            .find_map(|n| match n {
                crate::graph_types::Node::Contradiction(c) => Some(c.id.clone()),
                _ => None,
            })
            .expect("contradiction node");

        // Depth 1: contradiction + its two facts (docs/entity are 2 hops away).
        let d1 = subgraph(&g, &cx_id, 1);
        assert_eq!(d1.metadata.node_counts.get("fact"), Some(&2));
        assert_eq!(d1.metadata.node_counts.get("document"), None);

        // Depth 2: full neighbourhood.
        let d2 = subgraph(&g, &cx_id, 2);
        assert_eq!(d2.metadata.node_counts.get("document"), Some(&1));
        assert_eq!(d2.metadata.node_counts.get("entity"), Some(&1));
        assert!(graph_is_consistent(&d2));

        // Unknown id ⇒ empty graph.
        assert!(subgraph(&g, "nope", 3).nodes.is_empty());
    }

    /// Synthetic dated contradiction (engine fields constructed directly, pub
    /// API only) proves TEMPORAL_NEXT ordering and the drift-chain query.
    #[test]
    fn temporal_drift_chain_orders_dated_values() {
        let mut out = run_contradiction_engine(vec![], &[]);
        let mk_val = |value: &str, date: &str, doc: &str| ContradictionValue {
            value: value.into(),
            support_count: 1,
            confidence: 0.5,
            sources: vec![crate::canonical_case::ContradictionSource {
                source: doc.into(),
                date: Some(date.into()),
                context: "ctx".into(),
            }],
        };
        let c = Contradiction {
            contradiction_id: "cx-dated".into(),
            dimension: ConflictDimension::Assertion,
            subject: "ptsd".into(),
            event_type: EventType::Diagnosis,
            canonical_value: mk_val("affirmed", "2022-03-05", "docLate"),
            alternatives: vec![mk_val("negated", "2022-01-01", "docEarly")],
            conflict_flag: true,
            resolution_confidence: 0.5,
            source_unified_event_ids: vec![],
            source_patient_event_ids: vec![],
            metadata: serde_json::json!({}),
        };
        out.view.enriched_contradictions.push(EnrichedCaseContradiction {
            base: CaseContradiction {
                domain: ContradictionDomain::Clinical,
                contradiction_id: "cx-dated".into(),
                conflict_label: "assertion".into(),
                subject: "ptsd".into(),
                resolution_confidence: 0.5,
                body: crate::canonical_case::CaseContradictionBody::Clinical(c),
            },
            derived: ContradictionDerivedFields {
                severity_rank: 3,
                cross_domain_tag: None,
                presentation_group: "clinical:assertion".into(),
            },
        });

        let g = build_contradiction_graph(&out);
        assert!(graph_is_consistent(&g));
        assert_eq!(g.metadata.edge_counts.get("TEMPORAL_NEXT"), Some(&1));

        // Chain runs earlier → later regardless of canonical/alternative order.
        let early = "fact:cx-dated:negated";
        let late = "fact:cx-dated:affirmed";
        assert_eq!(
            temporal_drift_chain(&g, late),
            vec![early.to_string(), late.to_string()]
        );
        assert_eq!(
            temporal_drift_chain(&g, early),
            vec![early.to_string(), late.to_string()]
        );

        // Fact timestamps carried from source dates.
        match g.node(early).unwrap() {
            crate::graph_types::Node::Fact(f) => {
                assert_eq!(f.timestamp.as_deref(), Some("2022-01-01"))
            }
            _ => panic!("expected fact node"),
        }
    }
}

#[cfg(test)]
mod emma_richardson_fixture {
    //! Canonical ground-truth stress test (Phase-6 validation rules). The text
    //! below is the REAL persisted clean_text of the Emma Richardson document
    //! ("TEST CASE 4.docx", doc 019eb2fd-9416-7082-bf73-25138d6e79a5). The
    //! production graph path must detect ≥10 contradictions, every fact must
    //! be traceable to a text span, and temporal ordering must be derived.

    const EMMA_CLEAN_TEXT: &str = r#"TEST CASE 4 – HIGH CONTRADICTION DENSITY
Claimant: Emma Richardson
Emma Richardson is a 44-year-old accountant who reports sustaining an injury at work on 12 February 2022 while lifting archive boxes. However, an employer incident report records the injury date as 18 February 2022.
She states she ceased work immediately after the incident and has not returned to employment since February 2022. In contrast, a rehabilitation report notes that she resumed part-time duties in April 2022 and continued working until November 2022.
Emma reports chronic lower back pain radiating into the left leg. One treating orthopaedic surgeon diagnosed a lumbar disc prolapse at L4-L5. A later specialist review concluded that imaging showed only mild degenerative change and no disc prolapse.
A psychologist diagnosed post-traumatic stress disorder related to the workplace incident. A psychiatrist subsequently reported that the presentation was more consistent with major depressive disorder and specifically stated that diagnostic criteria for PTSD were not met.
Emma reports severe memory impairment that she attributes to the injury. Neuropsychological testing found significant cognitive deficits. However, a later neuropsychological assessment reported performance validity concerns and concluded that cognitive functioning was within normal limits.
Family history is inconsistent. One report states that Emma has two children aged 9 and 12. Another medico-legal report records three dependent children under the age of 15.
Marital status is inconsistently recorded. Several records describe Emma as divorced. A later treating practitioner notes that she lives with her husband and two children.
Smoking history is inconsistent. One GP record states she has never smoked. Another specialist report records a 20-year smoking history.
Medication history is also inconsistent. Emma denied taking opioid medication during interview. Pharmacy records show regular dispensing of oxycodone throughout 2023.
A treating doctor records that Emma requires a walking stick due to severe mobility restriction. Surveillance footage reviewed by an insurer reportedly shows her walking unassisted and carrying shopping bags.
Emma reports sleeping approximately three hours per night because of pain. Another treating practitioner records that she sleeps seven to eight hours per night with medication.
Her father is described as deceased from a myocardial infarction in 2018. Another family history record describes her father as alive and residing independently in Queensland.
One report states she has one brother. Another report states she has two brothers and one sister.
Emma denies any prior history of lower back problems. GP records from 2017 document recurrent lower back pain with physiotherapy treatment.
She reports that she cannot drive because of pain and concentration difficulties. A vocational assessment records that she drives independently to appointments several times each week."#;

    #[test]
    fn production_graph_detects_planted_contradictions() {
        let cleans = vec![("docEmma".to_string(), EMMA_CLEAN_TEXT.trim().to_string())];
        // PRODUCTION path: the single engine entrypoint, no clinical events —
        // exactly what the build_contradiction_graph command runs.
        let out = crate::contradiction_input_adapter::run_contradiction_engine_from_extraction(
            &[], &cleans, vec![], vec![], &[],
        );
        let graph = crate::graph_builder::build_contradiction_graph(&out);

        // Phase-6 rule 1: ≥10 real contradictions in production graph mode.
        assert!(
            graph.metadata.contradiction_count >= 10,
            "expected ≥10 contradictions, got {}",
            graph.metadata.contradiction_count
        );

        // Phase-4 required set.
        let ids: Vec<&str> = out
            .view
            .enriched_contradictions
            .iter()
            .map(|e| e.base.contradiction_id.as_str())
            .collect();
        for required in [
            "fact:clinical:ptsd_status:patient",        // PTSD vs criteria not met
            "fact:clinical:opioid_use:patient",         // denial vs oxycodone
            "fact:family:marital_status:patient",       // divorced vs married
            "fact:social:smoking_history:patient",      // never vs 20-year history
            "fact:clinical:injury_date:patient",        // 12 Feb vs 18 Feb 2022
            "fact:functional:work_status:patient",      // ceased vs working
        ] {
            assert!(ids.contains(&required), "missing required contradiction {required}; got {ids:?}");
        }

        // Phase-6 rule 2: every fact node traceable to a raw text span, with
        // explicit polarity and sentence-level evidence.
        let mut fact_count = 0;
        for n in &graph.nodes {
            if let crate::graph_types::Node::Fact(f) = n {
                fact_count += 1;
                let span = f.text_span.expect("fact node missing text_span");
                assert!(span[0] < span[1], "degenerate span on {}", f.id);
                assert!(
                    (span[1] as usize) <= EMMA_CLEAN_TEXT.trim().len(),
                    "span out of bounds on {}",
                    f.id
                );
                assert!(f.polarity.is_some(), "fact node missing polarity: {}", f.id);
                assert!(!f.evidence.is_empty(), "fact node missing evidence: {}", f.id);
            }
        }
        assert!(fact_count >= 20, "expected ≥20 fact nodes, got {fact_count}");

        // Temporal ordering derived: the injury-date dispute is a dated chain.
        assert!(
            graph
                .edges
                .iter()
                .any(|e| e.kind == crate::graph_types::EdgeKind::TemporalNext),
            "expected at least one TEMPORAL_NEXT edge"
        );
        let chain = crate::graph_query::temporal_drift_chain(
            &graph,
            "fact:fact:clinical:injury_date:patient:2022-02-12",
        );
        assert_eq!(
            chain,
            vec![
                "fact:fact:clinical:injury_date:patient:2022-02-12".to_string(),
                "fact:fact:clinical:injury_date:patient:2022-02-18".to_string(),
            ],
            "injury-date drift chain must run 12 Feb → 18 Feb"
        );

        // Determinism: byte-identical rebuild.
        let out2 = crate::contradiction_input_adapter::run_contradiction_engine_from_extraction(
            &[], &cleans, vec![], vec![], &[],
        );
        let graph2 = crate::graph_builder::build_contradiction_graph(&out2);
        assert_eq!(
            serde_json::to_string(&graph).unwrap(),
            serde_json::to_string(&graph2).unwrap()
        );
        assert!(crate::graph_types::graph_is_consistent(&graph));
    }
}
