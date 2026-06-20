//! Contradiction Graph Model — types only (no construction, no queries).
//!
//! The explorable, multi-typed reasoning graph built ON TOP of the existing
//! Contradiction Engine output. This is a STRICTLY ADDITIVE layer: the engine's
//! list-based outputs (`CanonicalCase`, `ContradictionView`, `ContradictionExport`)
//! are unchanged; the graph is a pure projection over them.
//!
//! Distinct from `contradiction_cluster_graph::ClusterGraph` (the flat
//! observability cluster graph): this model carries FOUR node types and SEVEN
//! typed edge kinds so a contradiction can be traced to the facts that support
//! it, the documents those facts came from, and the entities they describe.
//!
//! Determinism contract:
//!   - `nodes` sorted by node id, `edges` sorted by edge id (ids embed the
//!     edge kind, so edges group by kind, then endpoints).
//!   - All ids are deterministic composite keys — no hashing, no randomness,
//!     no clocks.
//!   - All weights/confidences are carried over from already-deterministic
//!     engine fields; nothing is re-scored stochastically.

#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Bump only on breaking shape changes of the serialised graph.
pub const GRAPH_SCHEMA_VERSION: &str = "1.0";

// ── Provenance ───────────────────────────────────────────────────────────────

/// Where a node's content came from, traceable back through the engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NodeProvenance {
    /// Source document ids (sorted, deduplicated).
    pub documents: Vec<String>,
    /// Which engine layer produced the underlying record
    /// (e.g. "contradiction_engine:view", "contradiction_engine:value").
    pub extraction_source: String,
}

// ── Nodes ────────────────────────────────────────────────────────────────────

/// An atomic observed value of a disputed subject (one `ContradictionValue`).
/// Id: `fact:{contradiction_id}:{value}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FactNode {
    pub id: String,
    /// Disputed concept (normalised), e.g. "fractured wrist", "marital_status".
    pub subject: String,
    /// The observed value, e.g. "affirmed", "negated", "married".
    pub value: String,
    /// Corpus observations supporting this value.
    pub support_count: u32,
    /// This value's share of total support in `[0,1]` (evidence distribution).
    pub confidence: f32,
    /// Earliest source date attributed to this value (ISO-sortable), if any.
    pub timestamp: Option<String>,
    /// Explicit negation state ("affirmed" | "negated") when the extraction
    /// layer recorded one. Negation is REPRESENTED, never silently filtered.
    pub polarity: Option<String>,
    /// `[start, end)` byte offsets of the matched span in the source
    /// document's clean text, when extraction-level provenance exists.
    pub text_span: Option<[u64; 2]>,
    /// Sentence-level evidence: the sentences/snippets that asserted this
    /// value (sorted, deduplicated).
    pub evidence: Vec<String>,
    pub provenance: NodeProvenance,
}

/// A source document. Id: `doc:{source}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentNode {
    pub id: String,
    pub source: String,
    /// Documents are ground truth carriers: fixed 1.0.
    pub confidence: f32,
    /// Earliest date any fact attributes to this document, if any.
    pub timestamp: Option<String>,
    pub provenance: NodeProvenance,
}

/// A surfaced conflict between facts. Id: `cx:{contradiction_id}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContradictionNode {
    pub id: String,
    pub contradiction_id: String,
    /// "clinical" | "family" (engine domain string).
    pub domain: String,
    /// Engine conflict label (dimension / conflict_type).
    pub conflict_label: String,
    pub subject: String,
    /// 1..=3, higher = more severe (verbatim from enrichment).
    pub severity_rank: u8,
    /// Engine `resolution_confidence` in `[0,1]`.
    pub confidence: f32,
    /// Earliest source date across all member values, if any.
    pub timestamp: Option<String>,
    pub provenance: NodeProvenance,
}

/// A referenced entity (person/condition under dispute).
/// Id: `ent:{entity_kind}:{name}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityNode {
    pub id: String,
    pub name: String,
    /// Currently always "subject"; future kinds: "person", "condition", "date".
    pub entity_kind: String,
    /// Entities are referential: fixed 1.0.
    pub confidence: f32,
    pub timestamp: Option<String>,
    pub provenance: NodeProvenance,
}

/// Strongly-typed node union. Serialises with a `kind` tag.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Node {
    Fact(FactNode),
    Document(DocumentNode),
    Contradiction(ContradictionNode),
    Entity(EntityNode),
}

impl Node {
    pub fn id(&self) -> &str {
        match self {
            Node::Fact(n) => &n.id,
            Node::Document(n) => &n.id,
            Node::Contradiction(n) => &n.id,
            Node::Entity(n) => &n.id,
        }
    }

    pub fn confidence(&self) -> f32 {
        match self {
            Node::Fact(n) => n.confidence,
            Node::Document(n) => n.confidence,
            Node::Contradiction(n) => n.confidence,
            Node::Entity(n) => n.confidence,
        }
    }

    pub fn timestamp(&self) -> Option<&str> {
        match self {
            Node::Fact(n) => n.timestamp.as_deref(),
            Node::Document(n) => n.timestamp.as_deref(),
            Node::Contradiction(n) => n.timestamp.as_deref(),
            Node::Entity(n) => n.timestamp.as_deref(),
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self {
            Node::Fact(_) => "fact",
            Node::Document(_) => "document",
            Node::Contradiction(_) => "contradiction",
            Node::Entity(_) => "entity",
        }
    }
}

// ── Edges ────────────────────────────────────────────────────────────────────

/// Typed relationship kinds. Serialise as SCREAMING_SNAKE_CASE tokens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EdgeKind {
    /// fact → contradiction: this observed value is one side of the conflict.
    Supports,
    /// fact → fact: mutually exclusive observed values (i < j builder order).
    Contradicts,
    /// fact → document: extraction provenance.
    DerivedFrom,
    /// entity → fact: the fact describes this entity.
    RelatesTo,
    /// fact → fact: chronological succession of dated values (temporal drift).
    TemporalNext,
    /// contradiction → fact: the dominant resolution contests this alternative.
    Weakens,
    /// contradiction → fact: the dominant resolution backs this value.
    Strengthens,
}

impl EdgeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EdgeKind::Supports => "SUPPORTS",
            EdgeKind::Contradicts => "CONTRADICTS",
            EdgeKind::DerivedFrom => "DERIVED_FROM",
            EdgeKind::RelatesTo => "RELATES_TO",
            EdgeKind::TemporalNext => "TEMPORAL_NEXT",
            EdgeKind::Weakens => "WEAKENS",
            EdgeKind::Strengthens => "STRENGTHENS",
        }
    }
}

/// One typed, weighted, provenance-carrying edge.
/// Id: `{KIND}:{from}->{to}` — globally unique and deterministic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    pub kind: EdgeKind,
    pub from: String,
    pub to: String,
    /// `[0,1]`.
    pub weight: f32,
    /// Reasoning type, e.g. "value_support", "mutual_exclusion".
    pub reasoning: String,
    /// Human-auditable note on how the relationship was inferred.
    pub provenance: String,
}

impl Edge {
    /// Deterministic composite edge id.
    pub fn make_id(kind: EdgeKind, from: &str, to: &str) -> String {
        format!("{}:{}->{}", kind.as_str(), from, to)
    }
}

// ── Graph ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphMetadata {
    pub schema_version: String,
    /// Number of engine contradictions the graph was built from.
    pub contradiction_count: usize,
    /// Node count per kind string (BTreeMap ⇒ stable serialisation).
    pub node_counts: BTreeMap<String, usize>,
    /// Edge count per kind token.
    pub edge_counts: BTreeMap<String, usize>,
}

/// The explorable Contradiction Graph. `nodes` sorted by id; `edges` sorted by
/// id (kind token first ⇒ grouped by kind, then endpoints).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContradictionGraph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub metadata: GraphMetadata,
}

impl ContradictionGraph {
    pub fn node(&self, id: &str) -> Option<&Node> {
        // nodes are sorted by id — binary search keeps lookups deterministic.
        self.nodes
            .binary_search_by(|n| n.id().cmp(id))
            .ok()
            .map(|i| &self.nodes[i])
    }

    /// All edges incident to `id`, in stored (sorted) order.
    pub fn edges_touching<'a>(&'a self, id: &str) -> Vec<&'a Edge> {
        self.edges
            .iter()
            .filter(|e| e.from == id || e.to == id)
            .collect()
    }
}

/// Structural invariants: sorted unique ids, endpoints resolve, weights and
/// confidences in `[0,1]`, metadata counts match.
pub fn graph_is_consistent(g: &ContradictionGraph) -> bool {
    let ids_sorted_unique = g
        .nodes
        .windows(2)
        .all(|w| w[0].id() < w[1].id())
        && g.edges.windows(2).all(|w| w[0].id < w[1].id);
    if !ids_sorted_unique {
        return false;
    }
    let nodes_ok = g
        .nodes
        .iter()
        .all(|n| (0.0..=1.0).contains(&n.confidence()));
    let edges_ok = g.edges.iter().all(|e| {
        (0.0..=1.0).contains(&e.weight)
            && g.node(&e.from).is_some()
            && g.node(&e.to).is_some()
            && e.id == Edge::make_id(e.kind, &e.from, &e.to)
    });
    let mut node_counts: BTreeMap<String, usize> = BTreeMap::new();
    for n in &g.nodes {
        *node_counts.entry(n.kind_str().to_string()).or_default() += 1;
    }
    let mut edge_counts: BTreeMap<String, usize> = BTreeMap::new();
    for e in &g.edges {
        *edge_counts.entry(e.kind.as_str().to_string()).or_default() += 1;
    }
    nodes_ok
        && edges_ok
        && node_counts == g.metadata.node_counts
        && edge_counts == g.metadata.edge_counts
}
