//! Contradiction Graph queries — READ-ONLY exploration API.
//!
//! Every function takes `&ContradictionGraph` and derives a view; nothing here
//! mutates the graph or recomputes engine semantics. Ordering is deterministic:
//! BFS frontiers use sorted containers, score ties break on node id, and float
//! ordering uses `total_cmp`.

#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use crate::graph_types::{ContradictionGraph, ContradictionNode, Edge, EdgeKind, GraphMetadata, Node};

/// Undirected BFS subgraph around `node_id`, up to `max_depth` hops.
/// Returns a self-consistent `ContradictionGraph` (recomputed metadata) whose
/// nodes/edges keep the parent ordering. Unknown id ⇒ empty graph.
pub fn subgraph(g: &ContradictionGraph, node_id: &str, max_depth: usize) -> ContradictionGraph {
    let mut keep: BTreeSet<String> = BTreeSet::new();
    if g.node(node_id).is_some() {
        let mut frontier: BTreeSet<String> = BTreeSet::new();
        frontier.insert(node_id.to_string());
        keep.insert(node_id.to_string());
        for _ in 0..max_depth {
            let mut next: BTreeSet<String> = BTreeSet::new();
            for e in &g.edges {
                if frontier.contains(&e.from) && keep.insert(e.to.clone()) {
                    next.insert(e.to.clone());
                }
                if frontier.contains(&e.to) && keep.insert(e.from.clone()) {
                    next.insert(e.from.clone());
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
    }

    let nodes: Vec<Node> = g
        .nodes
        .iter()
        .filter(|n| keep.contains(n.id()))
        .cloned()
        .collect();
    let edges: Vec<Edge> = g
        .edges
        .iter()
        .filter(|e| keep.contains(&e.from) && keep.contains(&e.to))
        .cloned()
        .collect();

    let mut node_counts: BTreeMap<String, usize> = BTreeMap::new();
    for n in &nodes {
        *node_counts.entry(n.kind_str().to_string()).or_default() += 1;
    }
    let mut edge_counts: BTreeMap<String, usize> = BTreeMap::new();
    for e in &edges {
        *edge_counts.entry(e.kind.as_str().to_string()).or_default() += 1;
    }
    ContradictionGraph {
        nodes,
        edges,
        metadata: GraphMetadata {
            schema_version: g.metadata.schema_version.clone(),
            contradiction_count: node_counts.get("contradiction").copied().unwrap_or(0),
            node_counts,
            edge_counts,
        },
    }
}

/// Contradiction nodes ranked by severity: severity_rank DESC, then
/// resolution confidence ASC (more contested first), then id ASC.
pub fn most_severe_contradictions(g: &ContradictionGraph) -> Vec<&ContradictionNode> {
    let mut out: Vec<&ContradictionNode> = g
        .nodes
        .iter()
        .filter_map(|n| match n {
            Node::Contradiction(c) => Some(c),
            _ => None,
        })
        .collect();
    out.sort_by(|a, b| {
        b.severity_rank
            .cmp(&a.severity_rank)
            .then(a.confidence.total_cmp(&b.confidence))
            .then(a.id.cmp(&b.id))
    });
    out
}

/// Full TEMPORAL_NEXT chain through `fact_id`: walk to the chain head, then
/// forward to the tail. Returns the ordered node ids (singleton when the fact
/// has no temporal edges; empty when the id is unknown).
pub fn temporal_drift_chain(g: &ContradictionGraph, fact_id: &str) -> Vec<String> {
    if g.node(fact_id).is_none() {
        return Vec::new();
    }
    let prev_of = |id: &str| -> Option<&str> {
        g.edges
            .iter()
            .find(|e| e.kind == EdgeKind::TemporalNext && e.to == id)
            .map(|e| e.from.as_str())
    };
    let next_of = |id: &str| -> Option<&str> {
        g.edges
            .iter()
            .find(|e| e.kind == EdgeKind::TemporalNext && e.from == id)
            .map(|e| e.to.as_str())
    };

    // Head (guard against cycles with a visited set; builder emits none).
    let mut head = fact_id.to_string();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    seen.insert(head.clone());
    while let Some(p) = prev_of(&head) {
        if !seen.insert(p.to_string()) {
            break;
        }
        head = p.to_string();
    }
    // Forward walk.
    let mut chain = vec![head.clone()];
    let mut cur = head;
    let mut seen_fwd: BTreeSet<String> = BTreeSet::new();
    seen_fwd.insert(cur.clone());
    while let Some(n) = next_of(&cur) {
        if !seen_fwd.insert(n.to_string()) {
            break;
        }
        chain.push(n.to_string());
        cur = n.to_string();
    }
    chain
}

/// High-impact nodes: severity-propagated weighted degree.
///
/// Each incident edge contributes `weight × severity_factor`, where the
/// severity factor is `severity_rank / 3` of a contradiction endpoint (either
/// end), or `1.0` when no contradiction is involved. Deterministic: edges are
/// accumulated in stored order; ties break on node id.
pub fn high_impact_nodes(g: &ContradictionGraph, top_n: usize) -> Vec<(String, f32)> {
    let severity_of = |id: &str| -> Option<f32> {
        match g.node(id) {
            Some(Node::Contradiction(c)) => Some(f32::from(c.severity_rank) / 3.0),
            _ => None,
        }
    };
    let mut scores: BTreeMap<String, f32> = BTreeMap::new();
    for e in &g.edges {
        let factor = severity_of(&e.from)
            .or_else(|| severity_of(&e.to))
            .unwrap_or(1.0);
        let contribution = e.weight * factor;
        *scores.entry(e.from.clone()).or_default() += contribution;
        *scores.entry(e.to.clone()).or_default() += contribution;
    }
    let mut out: Vec<(String, f32)> = scores.into_iter().collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    out.truncate(top_n);
    out
}

/// Plain degree (edge endpoint count) per node, sorted by (degree DESC, id).
pub fn degree_centrality(g: &ContradictionGraph) -> Vec<(String, usize)> {
    let mut deg: BTreeMap<String, usize> = BTreeMap::new();
    for e in &g.edges {
        *deg.entry(e.from.clone()).or_default() += 1;
        *deg.entry(e.to.clone()).or_default() += 1;
    }
    let mut out: Vec<(String, usize)> = deg.into_iter().collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    out
}
