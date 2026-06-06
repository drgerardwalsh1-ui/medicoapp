//! STEP-6 graph narratives — PURE deterministic summarisation of
//! `GraphAnalytics`. It formats existing metrics into human-readable strings.
//!
//! No AI, no inference, no scoring, no reasoning, no medical judgement — only
//! fixed-template formatting of numbers already computed by the analytics layer.
//! It reads graph + analytics by reference and mutates nothing; it changes no
//! engine, enrichment, graph-construction, analytics, or export logic.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::step6_graph::Step6Graph;
use crate::step6_graph_analysis::{ClinicalSignificance, GraphAnalytics, NodeMetric};

// ── Model ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClusterNarrative {
    pub cluster_id: usize,
    pub headline: String,
    pub summary: String,
    pub dominant_node: Option<String>,
    pub significance: ClinicalSignificance,
    pub node_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphNarrative {
    pub cluster_narratives: Vec<ClusterNarrative>,
    pub graph_summary_text: String,
}

// ── Deterministic helpers ───────────────────────────────────────────────────

fn headline_for(sig: ClinicalSignificance) -> String {
    match sig {
        ClinicalSignificance::High => "High-significance contradiction cluster".to_string(),
        ClinicalSignificance::Medium => "Medium-significance contradiction cluster".to_string(),
        ClinicalSignificance::Low => "Low-significance contradiction cluster".to_string(),
    }
}

/// Dominant node: highest degree → lowest centrality_rank → node_id ASC.
fn dominant_node(members: &[&NodeMetric]) -> Option<String> {
    members
        .iter()
        .min_by(|a, b| {
            b.degree
                .cmp(&a.degree) // degree DESC
                .then(a.centrality_rank.cmp(&b.centrality_rank)) // rank ASC
                .then(a.node_id.cmp(&b.node_id)) // id ASC
        })
        .map(|m| m.node_id.clone())
}

// ── API ─────────────────────────────────────────────────────────────────────

/// Build deterministic narratives from the analytics. Pure: `graph` and
/// `analytics` are read by reference and never mutated. (`graph` is accepted to
/// honour the layering contract; the text is derived entirely from `analytics`.)
pub fn build_graph_narrative(graph: &Step6Graph, analytics: &GraphAnalytics) -> GraphNarrative {
    let _ = graph; // intentionally unused — narratives derive only from metrics.

    let cluster_narratives: Vec<ClusterNarrative> = analytics
        .cluster_metrics
        .iter()
        .map(|cm| {
            // Members of this cluster (node_metrics is sorted by node_id).
            let members: Vec<&NodeMetric> = analytics
                .node_metrics
                .iter()
                .filter(|m| m.cluster_id == cm.cluster_id)
                .collect();

            let dominant = dominant_node(&members);
            let has_bridge = members.iter().any(|m| m.bridge_score > 0);
            let bridge_text = if has_bridge {
                " Contains cross-namespace relationships."
            } else {
                " No cross-namespace relationships."
            };
            let dom_text = dominant.clone().unwrap_or_else(|| "none".to_string());

            let summary = format!(
                "Cluster {} contains {} contradictions ({} diagnosis, {} symptom, {} other). \
                 Average confidence {:.3}. Dominant contradiction: {}.{}",
                cm.cluster_id,
                cm.size,
                cm.diagnosis_count,
                cm.symptom_count,
                cm.other_count,
                cm.average_confidence,
                dom_text,
                bridge_text,
            );

            ClusterNarrative {
                cluster_id: cm.cluster_id,
                headline: headline_for(cm.significance),
                summary,
                dominant_node: dominant,
                significance: cm.significance,
                node_count: cm.size,
            }
        })
        .collect();

    let s = &analytics.graph_summary;
    let graph_summary_text = format!(
        "Graph contains {} nodes, {} edges, {} clusters, largest cluster size {}, isolated nodes {}.",
        s.node_count, s.edge_count, s.cluster_count, s.largest_cluster_size, s.isolated_node_count
    );

    GraphNarrative { cluster_narratives, graph_summary_text }
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step6_enrichment::CrossNamespaceRelation;
    use crate::step6_graph::{GraphEdge, GraphNode, Step6Graph};
    use crate::step6_graph_analysis::analyze_graph;

    fn node(id: &str, ns: &str, conf: f64) -> GraphNode {
        GraphNode {
            id: id.into(),
            namespace: ns.into(),
            subject: id.into(),
            domain: if ns == "other" { "family" } else { "clinical" }.into(),
            confidence: conf,
        }
    }
    fn edge(a: &str, b: &str, rel: CrossNamespaceRelation) -> GraphEdge {
        GraphEdge { from: a.into(), to: b.into(), relation: rel, weight: 1.0 }
    }

    // Cluster {A(diag),B(sym),C(diag)} chain + isolated D(other).
    fn mk_graph() -> Step6Graph {
        Step6Graph {
            nodes: vec![
                node("A", "diagnosis", 0.5),
                node("B", "symptom", 0.6),
                node("C", "diagnosis", 0.7),
                node("D", "other", 0.4),
            ],
            edges: vec![
                edge("A", "B", CrossNamespaceRelation::DiagnosisToSymptom),
                edge("B", "C", CrossNamespaceRelation::SymptomToDiagnosis),
            ],
            adjacency: vec![
                ("A".into(), vec!["B".into()]),
                ("B".into(), vec!["A".into(), "C".into()]),
                ("C".into(), vec!["B".into()]),
                ("D".into(), vec![]),
            ],
        }
    }

    fn narrative() -> (Step6Graph, GraphAnalytics, GraphNarrative) {
        let g = mk_graph();
        let a = analyze_graph(&g);
        let n = build_graph_narrative(&g, &a);
        (g, a, n)
    }

    // 1.
    #[test]
    fn dominant_node_is_deterministic() {
        let (g, a, n1) = narrative();
        let n2 = build_graph_narrative(&g, &a);
        assert_eq!(n1, n2);
        // Cluster 0 {A,B,C}: B has highest degree (2) ⇒ dominant.
        assert_eq!(n1.cluster_narratives[0].dominant_node.as_deref(), Some("B"));
        // Cluster 1 {D}: singleton ⇒ dominant is D.
        assert_eq!(n1.cluster_narratives[1].dominant_node.as_deref(), Some("D"));
    }

    // 2.
    #[test]
    fn headline_matches_significance() {
        let (_, _, n) = narrative();
        assert_eq!(n.cluster_narratives[0].headline, "Medium-significance contradiction cluster"); // size 3
        assert_eq!(n.cluster_narratives[1].headline, "Low-significance contradiction cluster"); // size 1
        // High path.
        assert_eq!(headline_for(ClinicalSignificance::High), "High-significance contradiction cluster");
    }

    // 3.
    #[test]
    fn summary_contains_expected_metrics() {
        let (_, _, n) = narrative();
        let s = &n.cluster_narratives[0].summary;
        assert!(s.contains("Cluster 0 contains 3 contradictions"));
        assert!(s.contains("(2 diagnosis, 1 symptom, 0 other)"));
        assert!(s.contains("Average confidence 0.600"));
        assert!(s.contains("Dominant contradiction: B."));
    }

    // 4.
    #[test]
    fn bridge_text_appears_when_present() {
        let (_, _, n) = narrative();
        // Cluster 0 has cross-namespace edges (B bridges).
        assert!(n.cluster_narratives[0].summary.ends_with(" Contains cross-namespace relationships."));
    }

    // 5.
    #[test]
    fn bridge_text_absent_when_not_present() {
        let (_, _, n) = narrative();
        // Cluster 1 {D} is isolated — no bridges.
        assert!(n.cluster_narratives[1].summary.ends_with(" No cross-namespace relationships."));
        assert!(!n.cluster_narratives[1].summary.contains("Contains cross-namespace"));
    }

    // 6.
    #[test]
    fn graph_summary_is_correct() {
        let (_, _, n) = narrative();
        assert_eq!(
            n.graph_summary_text,
            "Graph contains 4 nodes, 2 edges, 2 clusters, largest cluster size 3, isolated nodes 1."
        );
    }

    // 7.
    #[test]
    fn narratives_are_stable_across_runs() {
        let g = mk_graph();
        let a = analyze_graph(&g);
        let n1 = build_graph_narrative(&g, &a);
        let n2 = build_graph_narrative(&g, &a);
        assert_eq!(
            serde_json::to_string(&n1).unwrap(),
            serde_json::to_string(&n2).unwrap()
        );
    }

    // 8.
    #[test]
    fn build_graph_narrative_does_not_modify_inputs() {
        let g = mk_graph();
        let a = analyze_graph(&g);
        let g_before = serde_json::to_string(&g).unwrap();
        let a_before = serde_json::to_string(&a).unwrap();
        let _ = build_graph_narrative(&g, &a);
        assert_eq!(serde_json::to_string(&g).unwrap(), g_before);
        assert_eq!(serde_json::to_string(&a).unwrap(), a_before);
    }
}
