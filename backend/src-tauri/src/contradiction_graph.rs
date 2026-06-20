//! Contradiction Graph Model — core façade.
//!
//! Single import surface for the explorable graph layer:
//!   - `graph_types`   — nodes / edges / metadata / invariants
//!   - `graph_builder` — deterministic construction from engine output
//!   - `graph_query`   — read-only exploration queries
//!   - `contradiction_graph_projection` — rebuildable SQLite read model
//!
//! Relationship to the rest of the system:
//!   ContradictionEngineOutput (UNCHANGED list-based output)
//!        └── build_contradiction_graph(&output)  → ContradictionGraph
//!                 ├── graph_query::*             (tracing / ranking / drift)
//!                 └── projection rebuild/load    (idempotent persistence)
//!
//! NOT to be confused with `contradiction_cluster_graph::ClusterGraph`, the
//! flat per-view cluster graph consumed by the observability report stack.

#![allow(unused_imports)]

pub use crate::graph_builder::build_contradiction_graph;
pub use crate::graph_query::{
    degree_centrality, high_impact_nodes, most_severe_contradictions, subgraph,
    temporal_drift_chain,
};
pub use crate::graph_types::{
    graph_is_consistent, ContradictionGraph, ContradictionNode, DocumentNode, Edge, EdgeKind,
    EntityNode, FactNode, GraphMetadata, Node, NodeProvenance, GRAPH_SCHEMA_VERSION,
};
