//! STEP-6 graph analytics — PURE, DETERMINISTIC analysis over `Step6Graph`.
//!
//! Answers: which contradictions are most connected, which bridge namespaces,
//! which clusters are clinically significant, which dominate the graph. It reads
//! the graph by reference and mutates nothing; it changes no engine, contradiction,
//! confidence, enrichment, export, or graph-construction logic.
//!
//! Determinism: `Vec`-only outputs; `BTreeMap` only transiently; no `HashMap`/
//! `HashSet`; no ML, no probabilistic ranking, no weighting beyond plain counts.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::step6_graph::{compute_clusters, Step6Graph};

// ── Analytic model ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClinicalSignificance {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeMetric {
    pub node_id: String,
    /// Undirected adjacency count.
    pub degree: usize,
    /// Index of the connected component containing this node.
    pub cluster_id: usize,
    /// Number of incident edges connecting DIFFERENT namespaces.
    pub bridge_score: usize,
    /// Deterministic rank: degree DESC, then node_id ASC (0 = most central).
    pub centrality_rank: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClusterMetric {
    pub cluster_id: usize,
    pub size: usize,
    pub diagnosis_count: usize,
    pub symptom_count: usize,
    pub other_count: usize,
    /// Arithmetic mean of member confidences, rounded to 3 dp.
    pub average_confidence: f64,
    pub significance: ClinicalSignificance,
}

/// Graph metrics reflect a clinical-only edge model.
/// All contradiction types become graph nodes, but edges are generated only
/// for eligible clinical diagnosis/symptom relationships.
/// Therefore edge_count == 0,
/// isolated_node_count == node_count,
/// and cluster_count == node_count
/// is a valid outcome for contradiction sets containing only non-clinical
/// contradictions (fact, family, legal, social, etc.) and does not indicate
/// graph construction failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphSummary {
    pub node_count: usize,
    pub edge_count: usize,
    pub cluster_count: usize,
    pub largest_cluster_size: usize,
    pub isolated_node_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphAnalytics {
    pub node_metrics: Vec<NodeMetric>,
    pub cluster_metrics: Vec<ClusterMetric>,
    pub graph_summary: GraphSummary,
}

fn round3(f: f64) -> f64 {
    (f * 1000.0).round() / 1000.0
}

fn significance_of(size: usize) -> ClinicalSignificance {
    if size >= 5 {
        ClinicalSignificance::High
    } else if size >= 3 {
        ClinicalSignificance::Medium
    } else {
        ClinicalSignificance::Low
    }
}

// ── Analysis ────────────────────────────────────────────────────────────────

/// Compute node metrics, cluster metrics, and the graph summary. Pure.
pub fn analyze_graph(graph: &Step6Graph) -> GraphAnalytics {
    let clusters = compute_clusters(graph);

    // Deterministic lookups.
    let ns: BTreeMap<&str, &str> =
        graph.nodes.iter().map(|n| (n.id.as_str(), n.namespace.as_str())).collect();
    let conf: BTreeMap<&str, f64> =
        graph.nodes.iter().map(|n| (n.id.as_str(), n.confidence)).collect();
    let degree: BTreeMap<&str, usize> =
        graph.adjacency.iter().map(|(id, nb)| (id.as_str(), nb.len())).collect();

    // node → cluster index.
    let mut cluster_of: BTreeMap<&str, usize> = BTreeMap::new();
    for (ci, c) in clusters.iter().enumerate() {
        for id in c {
            cluster_of.insert(id.as_str(), ci);
        }
    }

    // bridge_score: incident edges whose two endpoints differ in namespace.
    let mut bridge: BTreeMap<&str, usize> =
        graph.nodes.iter().map(|n| (n.id.as_str(), 0usize)).collect();
    for e in &graph.edges {
        let nf = ns.get(e.from.as_str()).copied().unwrap_or("");
        let nt = ns.get(e.to.as_str()).copied().unwrap_or("");
        if nf != nt {
            if let Some(x) = bridge.get_mut(e.from.as_str()) {
                *x += 1;
            }
            if let Some(x) = bridge.get_mut(e.to.as_str()) {
                *x += 1;
            }
        }
    }

    // centrality rank: degree DESC, node_id ASC.
    let mut ranked: Vec<(&str, usize)> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), *degree.get(n.id.as_str()).unwrap_or(&0)))
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    let mut rank_of: BTreeMap<&str, usize> = BTreeMap::new();
    for (i, (id, _)) in ranked.iter().enumerate() {
        rank_of.insert(*id, i);
    }

    // node metrics — sorted by node_id for stable output.
    let mut node_metrics: Vec<NodeMetric> = graph
        .nodes
        .iter()
        .map(|n| NodeMetric {
            node_id: n.id.clone(),
            degree: *degree.get(n.id.as_str()).unwrap_or(&0),
            cluster_id: *cluster_of.get(n.id.as_str()).unwrap_or(&0),
            bridge_score: *bridge.get(n.id.as_str()).unwrap_or(&0),
            centrality_rank: *rank_of.get(n.id.as_str()).unwrap_or(&0),
        })
        .collect();
    node_metrics.sort_by(|a, b| a.node_id.cmp(&b.node_id));

    // cluster metrics — cluster_id ascending (compute_clusters is already
    // sorted by smallest member id).
    let cluster_metrics: Vec<ClusterMetric> = clusters
        .iter()
        .enumerate()
        .map(|(ci, c)| {
            let mut diagnosis_count = 0;
            let mut symptom_count = 0;
            let mut other_count = 0;
            let mut sum = 0.0;
            for id in c {
                match ns.get(id.as_str()).copied().unwrap_or("other") {
                    "diagnosis" => diagnosis_count += 1,
                    "symptom" => symptom_count += 1,
                    _ => other_count += 1,
                }
                sum += conf.get(id.as_str()).copied().unwrap_or(0.0);
            }
            let average_confidence = if c.is_empty() { 0.0 } else { round3(sum / c.len() as f64) };
            ClusterMetric {
                cluster_id: ci,
                size: c.len(),
                diagnosis_count,
                symptom_count,
                other_count,
                average_confidence,
                significance: significance_of(c.len()),
            }
        })
        .collect();

    let graph_summary = GraphSummary {
        node_count: graph.nodes.len(),
        edge_count: graph.edges.len(),
        cluster_count: clusters.len(),
        largest_cluster_size: clusters.iter().map(|c| c.len()).max().unwrap_or(0),
        isolated_node_count: graph.adjacency.iter().filter(|(_, nb)| nb.is_empty()).count(),
    };

    GraphAnalytics { node_metrics, cluster_metrics, graph_summary }
}

// ── Top-N queries (deterministic) ───────────────────────────────────────────

/// Up to `n` most-connected node ids (centrality_rank ascending).
pub fn most_connected_nodes(analytics: &GraphAnalytics, n: usize) -> Vec<String> {
    let mut v: Vec<&NodeMetric> = analytics.node_metrics.iter().collect();
    v.sort_by(|a, b| a.centrality_rank.cmp(&b.centrality_rank));
    v.into_iter().take(n).map(|m| m.node_id.clone()).collect()
}

/// Up to `n` largest cluster ids (size DESC, then cluster_id ASC).
pub fn largest_clusters(analytics: &GraphAnalytics, n: usize) -> Vec<usize> {
    let mut v: Vec<&ClusterMetric> = analytics.cluster_metrics.iter().collect();
    v.sort_by(|a, b| b.size.cmp(&a.size).then(a.cluster_id.cmp(&b.cluster_id)));
    v.into_iter().take(n).map(|m| m.cluster_id).collect()
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step6_enrichment::CrossNamespaceRelation;
    use crate::step6_graph::{GraphEdge, GraphNode, Step6Graph};

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

    // A: diagnosis, B: symptom, C: diagnosis (chain A–B–C, cross-namespace),
    // D: other (isolated). Cluster {A,B,C} + singleton {D}.
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

    fn metric<'a>(a: &'a GraphAnalytics, id: &str) -> &'a NodeMetric {
        a.node_metrics.iter().find(|m| m.node_id == id).unwrap()
    }

    // 1.
    #[test]
    fn graph_summary_counts_are_correct() {
        let a = analyze_graph(&mk_graph());
        let s = &a.graph_summary;
        assert_eq!(s.node_count, 4);
        assert_eq!(s.edge_count, 2);
        assert_eq!(s.cluster_count, 2);
        assert_eq!(s.largest_cluster_size, 3);
        assert_eq!(s.isolated_node_count, 1);
    }

    // 2.
    #[test]
    fn centrality_ranking_is_deterministic() {
        let g = mk_graph();
        let a1 = analyze_graph(&g);
        let a2 = analyze_graph(&g);
        assert_eq!(a1, a2);
        // degree: B=2, A=1, C=1, D=0 → ranks B<A<C<D (A before C by id).
        assert_eq!(metric(&a1, "B").centrality_rank, 0);
        assert_eq!(metric(&a1, "A").centrality_rank, 1);
        assert_eq!(metric(&a1, "C").centrality_rank, 2);
        assert_eq!(metric(&a1, "D").centrality_rank, 3);
    }

    // 3.
    #[test]
    fn bridge_scores_are_correct() {
        let a = analyze_graph(&mk_graph());
        assert_eq!(metric(&a, "A").bridge_score, 1); // A–B different ns
        assert_eq!(metric(&a, "B").bridge_score, 2); // A–B and B–C
        assert_eq!(metric(&a, "C").bridge_score, 1); // B–C
        assert_eq!(metric(&a, "D").bridge_score, 0); // isolated
        // degrees too.
        assert_eq!(metric(&a, "B").degree, 2);
        assert_eq!(metric(&a, "D").degree, 0);
    }

    // 4.
    #[test]
    fn cluster_metrics_are_stable() {
        let g = mk_graph();
        let a1 = analyze_graph(&g);
        let a2 = analyze_graph(&g);
        assert_eq!(a1.cluster_metrics, a2.cluster_metrics);
        // Cluster 0 = {A,B,C}: 2 diagnosis + 1 symptom, mean (0.5+0.6+0.7)/3 = 0.6.
        let c0 = &a1.cluster_metrics[0];
        assert_eq!(c0.cluster_id, 0);
        assert_eq!(c0.size, 3);
        assert_eq!(c0.diagnosis_count, 2);
        assert_eq!(c0.symptom_count, 1);
        assert_eq!(c0.other_count, 0);
        assert!((c0.average_confidence - 0.6).abs() < 1e-9);
        assert_eq!(c0.significance, ClinicalSignificance::Medium);
        // Cluster 1 = {D}: singleton other.
        let c1 = &a1.cluster_metrics[1];
        assert_eq!(c1.size, 1);
        assert_eq!(c1.other_count, 1);
        assert_eq!(c1.significance, ClinicalSignificance::Low);
    }

    // 5.
    #[test]
    fn significance_thresholds_work() {
        assert_eq!(significance_of(1), ClinicalSignificance::Low);
        assert_eq!(significance_of(2), ClinicalSignificance::Low);
        assert_eq!(significance_of(3), ClinicalSignificance::Medium);
        assert_eq!(significance_of(4), ClinicalSignificance::Medium);
        assert_eq!(significance_of(5), ClinicalSignificance::High);
        assert_eq!(significance_of(9), ClinicalSignificance::High);

        // A connected 5-node cluster ⇒ High.
        let big = Step6Graph {
            nodes: (0..5).map(|i| node(&format!("N{i}"), "diagnosis", 0.5)).collect(),
            edges: (0..4)
                .map(|i| edge(&format!("N{i}"), &format!("N{}", i + 1), CrossNamespaceRelation::SameNamespace))
                .collect(),
            adjacency: vec![
                ("N0".into(), vec!["N1".into()]),
                ("N1".into(), vec!["N0".into(), "N2".into()]),
                ("N2".into(), vec!["N1".into(), "N3".into()]),
                ("N3".into(), vec!["N2".into(), "N4".into()]),
                ("N4".into(), vec!["N3".into()]),
            ],
        };
        let a = analyze_graph(&big);
        assert_eq!(a.cluster_metrics.len(), 1);
        assert_eq!(a.cluster_metrics[0].size, 5);
        assert_eq!(a.cluster_metrics[0].significance, ClinicalSignificance::High);
    }

    // 6.
    #[test]
    fn isolated_nodes_are_counted() {
        let a = analyze_graph(&mk_graph());
        assert_eq!(a.graph_summary.isolated_node_count, 1);
        // D is its own singleton cluster.
        assert_eq!(metric(&a, "D").degree, 0);
        assert_eq!(metric(&a, "D").cluster_id, 1);
    }

    // 7.
    #[test]
    fn top_n_queries_are_deterministic() {
        let a = analyze_graph(&mk_graph());
        let mc1 = most_connected_nodes(&a, 2);
        let mc2 = most_connected_nodes(&a, 2);
        assert_eq!(mc1, mc2);
        assert_eq!(mc1, vec!["B".to_string(), "A".to_string()]); // ranks 0,1

        let lc1 = largest_clusters(&a, 1);
        let lc2 = largest_clusters(&a, 1);
        assert_eq!(lc1, lc2);
        assert_eq!(lc1, vec![0]); // cluster {A,B,C} is largest

        // n larger than available → returns all, no panic.
        assert_eq!(most_connected_nodes(&a, 99).len(), 4);
        assert_eq!(largest_clusters(&a, 99).len(), 2);
    }

    // 8.
    #[test]
    fn analyze_graph_does_not_modify_input() {
        let g = mk_graph();
        let before = serde_json::to_string(&g).unwrap();
        let _ = analyze_graph(&g);
        let after = serde_json::to_string(&g).unwrap();
        assert_eq!(before, after);
    }
}
