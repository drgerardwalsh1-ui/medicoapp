//! Contradiction Engine semantic graph — a PURE DERIVATION LAYER above `ContradictionView`.
//!
//! Builds a persistent, serializable graph entirely from the enriched
//! contradiction stream: one node per `EnrichedCaseContradiction`, edges taken
//! verbatim from `ContradictionView.cross_namespace_relations`. Supports traversal,
//! clustering (connected components), and filtered queries.
//!
//! It NEVER touches the engine, enrichment, or export: `build_cluster_graph`
//! takes `&ContradictionView` by reference and reads only. Determinism: every output
//! container is a `Vec` (sorted); `BTreeMap`/`BTreeSet` used only transiently
//! during construction — no `HashMap`/`HashSet` anywhere, so no iteration-order
//! leak.

// Additive derivation layer; not yet wired to a command.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::canonical_case::CaseContradiction;
use crate::fact_contradiction::{fact_namespace, is_fact_contradiction};
use crate::contradiction_enrichment::{CrossNamespaceRelation, ContradictionView};

// ── Core graph types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    /// Namespace classification for graph nodes.
    /// Examples:
    /// - "diagnosis"
    /// - "symptom"
    /// - "fact:clinical"
    /// - "fact:functional"
    /// - "fact:social"
    /// - "fact:family"
    /// - "other"
    ///
    /// All contradiction types are represented as graph nodes.
    /// Only diagnosis/symptom contradictions participate in graph edge generation.
    pub namespace: String,
    pub subject: String,
    pub domain: String,
    /// Copied verbatim from the enriched layer (no recomputation).
    pub confidence: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub relation: CrossNamespaceRelation,
    pub weight: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClusterGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Deterministic undirected adjacency: node id → sorted neighbour ids.
    /// Every node appears (isolated nodes carry an empty list).
    pub adjacency: Vec<(String, Vec<String>)>,
}

/// Optional wiring bundle: the source view paired with its derived graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterGraphBundle {
    pub view: ContradictionView,
    pub graph: ClusterGraph,
}

// ── Namespace label (re-derived; does not touch enrichment internals) ───────

/// Clinical + `"symptom:"` prefix ⇒ "symptom"; Clinical + no prefix ⇒
/// "diagnosis"; any non-clinical domain ⇒ "other". Mirrors the enrichment
/// namespace rule without importing its private helper.
fn namespace_label(base: &CaseContradiction) -> String {
    // FACT contradictions get their own `fact:{fact_domain}` namespace — never
    // "diagnosis"/"symptom". Checked FIRST so a fact can never be mislabelled.
    if is_fact_contradiction(base) {
        return fact_namespace(base);
    }
    if base.domain.as_str() != "clinical" {
        return "other".to_string();
    }
    if base.subject.starts_with("symptom:") {
        "symptom".to_string()
    } else {
        "diagnosis".to_string()
    }
}

// ── Adjacency (undirected, deterministic, Vec output) ───────────────────────

fn build_adjacency(nodes: &[GraphNode], edges: &[GraphEdge]) -> Vec<(String, Vec<String>)> {
    let node_ids: BTreeSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let mut adj: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    // Seed every node so isolated nodes appear with an empty neighbour list.
    for n in nodes {
        adj.entry(n.id.clone()).or_default();
    }
    for e in edges {
        if node_ids.contains(e.from.as_str()) && node_ids.contains(e.to.as_str()) {
            adj.entry(e.from.clone()).or_default().insert(e.to.clone());
            adj.entry(e.to.clone()).or_default().insert(e.from.clone());
        }
    }
    adj.into_iter().map(|(k, v)| (k, v.into_iter().collect())).collect()
}

// ── Construction ────────────────────────────────────────────────────────────

/// Build the graph from a `ContradictionView`. Nodes map 1:1 to enriched
/// contradictions; edges come only from `cross_namespace_relations`.
pub fn build_cluster_graph(view: &ContradictionView) -> ClusterGraph {
    let nodes: Vec<GraphNode> = view
        .enriched_contradictions
        .iter()
        .map(|e| GraphNode {
            id: e.base.contradiction_id.clone(),
            namespace: namespace_label(&e.base),
            subject: e.base.subject.clone(),
            domain: e.base.domain.as_str().to_string(),
            confidence: e.base.resolution_confidence as f64,
        })
        .collect();

    let edges: Vec<GraphEdge> = view
        .cross_namespace_relations
        .iter()
        .map(|(from, to, relation)| GraphEdge {
            from: from.clone(),
            to: to.clone(),
            relation: *relation,
            weight: 1.0,
        })
        .collect();

    let adjacency = build_adjacency(&nodes, &edges);
    ClusterGraph { nodes, edges, adjacency }
}

/// Convenience: build the graph and bundle it with a clone of the view.
pub fn build_cluster_graph_bundle(view: ContradictionView) -> ClusterGraphBundle {
    let graph = build_cluster_graph(&view);
    ClusterGraphBundle { view, graph }
}

// ── Traversal API (deterministic, pure) ─────────────────────────────────────

/// Sorted neighbour ids for a node (empty if the node is absent).
pub fn get_neighbors(graph: &ClusterGraph, node_id: &str) -> Vec<String> {
    graph
        .adjacency
        .iter()
        .find(|(id, _)| id == node_id)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// Depth-limited BFS from `start_id`. Returns node ids in deterministic
/// visitation order (each level expanded in sorted order). `max_depth` is the
/// number of hops (0 ⇒ just the start node). Empty if `start_id` is absent.
pub fn traverse_graph(graph: &ClusterGraph, start_id: &str, max_depth: usize) -> Vec<String> {
    if !graph.nodes.iter().any(|n| n.id == start_id) {
        return Vec::new();
    }
    let mut visited: BTreeSet<String> = BTreeSet::new();
    let mut order: Vec<String> = Vec::new();
    visited.insert(start_id.to_string());
    order.push(start_id.to_string());

    let mut frontier: Vec<String> = vec![start_id.to_string()];
    let mut depth = 0;
    while depth < max_depth && !frontier.is_empty() {
        let mut next: BTreeSet<String> = BTreeSet::new();
        for node in &frontier {
            for nb in get_neighbors(graph, node) {
                if visited.insert(nb.clone()) {
                    next.insert(nb);
                }
            }
        }
        for nb in &next {
            order.push(nb.clone());
        }
        frontier = next.into_iter().collect();
        depth += 1;
    }
    order
}

/// Connected components over UNDIRECTED edges. Clusters are sorted by their
/// smallest node id; each cluster is sorted lexicographically. Every node is
/// covered (isolated nodes form singleton clusters).
pub fn compute_clusters(graph: &ClusterGraph) -> Vec<Vec<String>> {
    let mut visited: BTreeSet<String> = BTreeSet::new();
    let mut clusters: Vec<Vec<String>> = Vec::new();

    // Adjacency keys are already sorted ⇒ deterministic component discovery.
    for (id, _) in &graph.adjacency {
        if visited.contains(id) {
            continue;
        }
        let mut comp: BTreeSet<String> = BTreeSet::new();
        let mut stack: Vec<String> = vec![id.clone()];
        visited.insert(id.clone());
        comp.insert(id.clone());
        while let Some(n) = stack.pop() {
            for nb in get_neighbors(graph, &n) {
                if visited.insert(nb.clone()) {
                    comp.insert(nb.clone());
                    stack.push(nb);
                }
            }
        }
        clusters.push(comp.into_iter().collect());
    }
    clusters.sort_by(|a, b| a[0].cmp(&b[0]));
    clusters
}

// ── Query semantics ─────────────────────────────────────────────────────────

/// Deterministic predicate. Any `None` field is unconstrained.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GraphQuery {
    /// Namespace filter.
    /// Examples:
    /// - "diagnosis"
    /// - "symptom"
    /// - "fact:clinical"
    /// - "fact:functional"
    /// - "fact:social"
    /// - "fact:family"
    /// - "other"
    pub namespace: Option<String>,
    pub relation: Option<CrossNamespaceRelation>,
    pub subject_substring: Option<String>,
}

/// Return the filtered subgraph: nodes matching the namespace + subject filters,
/// and edges whose BOTH endpoints survive and which match the relation filter.
/// Adjacency is rebuilt over the surviving nodes/edges. Deterministic.
pub fn query_graph(graph: &ClusterGraph, query: &GraphQuery) -> ClusterGraph {
    let nodes: Vec<GraphNode> = graph
        .nodes
        .iter()
        .filter(|n| {
            query.namespace.as_ref().map_or(true, |ns| &n.namespace == ns)
                && query
                    .subject_substring
                    .as_ref()
                    .map_or(true, |s| n.subject.contains(s.as_str()))
        })
        .cloned()
        .collect();

    let surviving: BTreeSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();

    let edges: Vec<GraphEdge> = graph
        .edges
        .iter()
        .filter(|e| {
            surviving.contains(e.from.as_str())
                && surviving.contains(e.to.as_str())
                && query.relation.map_or(true, |r| e.relation == r)
        })
        .cloned()
        .collect();

    let adjacency = build_adjacency(&nodes, &edges);
    ClusterGraph { nodes, edges, adjacency }
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::{CaseContradictionBody, ContradictionDomain};
    use crate::family_graph::{FamilyConflictType, FamilyContradiction, FamilyValue};
    use crate::contradiction_enrichment::enrich_contradictions;

    // Minimal CaseContradiction (Family body is irrelevant to the graph, which
    // reads only domain/subject/id/confidence).
    fn cc(domain: ContradictionDomain, label: &str, subject: &str, rc: f32) -> CaseContradiction {
        let body = CaseContradictionBody::Family(FamilyContradiction {
            contradiction_id: "x".into(),
            conflict_type: FamilyConflictType::Relational,
            pair: ("a".into(), Some("b".into())),
            subject: subject.into(),
            canonical_value: FamilyValue {
                value: "v".into(),
                support_count: 1,
                confidence: rc,
                sources: vec![],
                edge_ids: vec![],
            },
            alternatives: vec![],
            conflict_flag: true,
            resolution_confidence: rc,
            source_refs: vec![],
            edge_ids: vec![],
            metadata: serde_json::json!({}),
        });
        CaseContradiction {
            domain,
            contradiction_id: format!("{}:{}:{}", domain.as_str(), label, subject),
            conflict_label: label.into(),
            subject: subject.into(),
            resolution_confidence: rc,
            body,
        }
    }

    // A view with a diagnosis/symptom cross-namespace edge + an isolated family node.
    fn sample_view() -> ContradictionView {
        enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "assertion", "fatigue", 0.50), // diagnosis
            cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.55), // symptom
            cc(ContradictionDomain::Family, "relational", "a↔b", 0.40), // isolated (Other)
        ])
    }

    #[test]
    fn graph_is_deterministic_across_runs() {
        let v = sample_view();
        let g1 = build_cluster_graph(&v);
        let g2 = build_cluster_graph(&v);
        assert_eq!(g1, g2);
        assert_eq!(
            serde_json::to_string(&g1).unwrap(),
            serde_json::to_string(&g2).unwrap()
        );
        assert_eq!(g1.nodes.len(), 3);
        assert_eq!(g1.edges.len(), 1); // one diagnosis↔symptom edge
    }

    #[test]
    fn adjacency_lists_are_sorted() {
        let g = build_cluster_graph(&sample_view());
        // Keys sorted.
        let keys: Vec<&str> = g.adjacency.iter().map(|(k, _)| k.as_str()).collect();
        let mut sorted_keys = keys.clone();
        sorted_keys.sort();
        assert_eq!(keys, sorted_keys);
        // Each neighbour list sorted.
        for (_, neigh) in &g.adjacency {
            let mut s = neigh.clone();
            s.sort();
            assert_eq!(neigh, &s);
        }
        // Every node present (incl. the isolated family node, empty list).
        assert_eq!(g.adjacency.len(), 3);
        let fam_id = "family:relational:a↔b";
        assert_eq!(get_neighbors(&g, fam_id), Vec::<String>::new());
    }

    #[test]
    fn traversal_is_depth_limited_and_ordered() {
        let g = build_cluster_graph(&sample_view());
        let diag = "clinical:assertion:fatigue";
        let sym = "clinical:assertion:symptom:fatigue";

        // depth 0 → just the start.
        assert_eq!(traverse_graph(&g, diag, 0), vec![diag.to_string()]);
        // depth 1 → start + its (sorted) neighbour.
        assert_eq!(traverse_graph(&g, diag, 1), vec![diag.to_string(), sym.to_string()]);
        // unknown start → empty.
        assert!(traverse_graph(&g, "nope", 5).is_empty());
        // isolated node → only itself regardless of depth.
        assert_eq!(traverse_graph(&g, "family:relational:a↔b", 9), vec!["family:relational:a↔b".to_string()]);
    }

    #[test]
    fn clustering_is_stable_and_complete() {
        let g = build_cluster_graph(&sample_view());
        let c1 = compute_clusters(&g);
        let c2 = compute_clusters(&g);
        assert_eq!(c1, c2); // stable
        // Two clusters: {diagnosis, symptom} connected; {family} isolated.
        assert_eq!(c1.len(), 2);
        // Every node covered exactly once.
        let total: usize = c1.iter().map(|c| c.len()).sum();
        assert_eq!(total, g.nodes.len());
        // Clusters sorted by smallest id; each cluster sorted.
        for cluster in &c1 {
            let mut s = cluster.clone();
            s.sort();
            assert_eq!(cluster, &s);
        }
        // The connected pair is the clinical cluster.
        let pair = c1.iter().find(|c| c.len() == 2).unwrap();
        assert_eq!(
            pair,
            &vec![
                "clinical:assertion:fatigue".to_string(),
                "clinical:assertion:symptom:fatigue".to_string()
            ]
        );
    }

    #[test]
    fn query_graph_filters_correctly() {
        let g = build_cluster_graph(&sample_view());

        // Namespace filter: only symptom nodes; the cross-namespace edge drops
        // (its diagnosis endpoint is filtered out).
        let q_ns = GraphQuery { namespace: Some("symptom".into()), ..Default::default() };
        let sub = query_graph(&g, &q_ns);
        assert_eq!(sub.nodes.len(), 1);
        assert_eq!(sub.nodes[0].namespace, "symptom");
        assert!(sub.edges.is_empty());

        // Subject substring filter.
        let q_subj = GraphQuery { subject_substring: Some("fatigue".into()), ..Default::default() };
        let sub2 = query_graph(&g, &q_subj);
        assert_eq!(sub2.nodes.len(), 2); // diagnosis + symptom (both contain "fatigue")
        assert_eq!(sub2.edges.len(), 1); // edge survives (both endpoints kept)

        // Relation filter that matches nothing.
        let q_rel = GraphQuery {
            relation: Some(CrossNamespaceRelation::SymptomToDiagnosis),
            ..Default::default()
        };
        let sub3 = query_graph(&g, &q_rel);
        // The single edge is DiagnosisToSymptom, so it is filtered out.
        assert!(sub3.edges.is_empty());
        assert_eq!(sub3.nodes.len(), 3); // nodes unfiltered (no namespace/subject filter)
    }

    #[test]
    fn no_engine_behavior_changes_detected() {
        // Building the graph reads the view by reference and mutates nothing.
        let v = sample_view();
        let before = serde_json::to_string(&v).unwrap();
        let _g = build_cluster_graph(&v);
        let after = serde_json::to_string(&v).unwrap();
        assert_eq!(before, after);
        // The view's engine-derived fields are intact.
        assert_eq!(v.enriched_contradictions.len(), 3);
        assert_eq!(v.cross_namespace_relations.len(), 1);
    }
}
