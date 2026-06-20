//! Contradiction Graph projection — denormalised, REBUILDABLE read model.
//!
//! Mirrors the house projection pattern (`projection.rs`): SQLite behind a
//! `Mutex<Connection>`, deterministic writes, full reconstruction guarantee.
//!
//! Storage model (4 tables + meta):
//!   - `graph_nodes(id, kind, confidence, timestamp, payload)`
//!   - `graph_edges(id, kind, from_id, to_id, weight, reasoning, payload)`
//!   - `graph_node_metadata(node_id, key, value)`   — queryable provenance
//!   - `graph_edge_metadata(edge_id, key, value)`
//!   - `graph_meta(key, value)`                     — schema version + metadata
//!
//! The `payload` column holds the canonical serde JSON of each node/edge and
//! is the SOURCE OF TRUTH for reconstruction (`load()` parses payloads, never
//! re-derives from scalar columns — this sidesteps any f32↔REAL drift). The
//! scalar and metadata columns are denormalised conveniences for SQL-side
//! inspection only.
//!
//! Guarantees:
//!   - `rebuild()` is idempotent: DELETE-then-INSERT inside one transaction,
//!     rows written in graph (sorted) order — rebuilding twice from the same
//!     graph yields a byte-identical `snapshot_canonical()`.
//!   - `load()` returns a graph byte-identical (serde JSON) to the one passed
//!     to `rebuild()`.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::graph_types::{ContradictionGraph, Edge, GraphMetadata, Node, GRAPH_SCHEMA_VERSION};

pub struct ContradictionGraphProjection {
    conn: Mutex<Connection>,
}

impl ContradictionGraphProjection {
    /// Open or create the projection DB at `path` and install the schema.
    pub fn init(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS graph_nodes (
                id          TEXT PRIMARY KEY,
                kind        TEXT NOT NULL,
                confidence  REAL NOT NULL,
                timestamp   TEXT,
                payload     TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS graph_edges (
                id          TEXT PRIMARY KEY,
                kind        TEXT NOT NULL,
                from_id     TEXT NOT NULL,
                to_id       TEXT NOT NULL,
                weight      REAL NOT NULL,
                reasoning   TEXT NOT NULL,
                payload     TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS graph_node_metadata (
                node_id     TEXT NOT NULL,
                key         TEXT NOT NULL,
                value       TEXT NOT NULL,
                PRIMARY KEY (node_id, key)
            );
            CREATE TABLE IF NOT EXISTS graph_edge_metadata (
                edge_id     TEXT NOT NULL,
                key         TEXT NOT NULL,
                value       TEXT NOT NULL,
                PRIMARY KEY (edge_id, key)
            );
            CREATE TABLE IF NOT EXISTS graph_meta (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL
            );
            "#,
        )?;
        Ok(ContradictionGraphProjection { conn: Mutex::new(conn) })
    }

    /// Drop all rows and rewrite the graph in sorted order. One transaction;
    /// idempotent; deterministic row order (graph vectors are already sorted).
    pub fn rebuild(&self, graph: &ContradictionGraph) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        for table in [
            "graph_nodes",
            "graph_edges",
            "graph_node_metadata",
            "graph_edge_metadata",
            "graph_meta",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])
                .map_err(|e| e.to_string())?;
        }

        for n in &graph.nodes {
            let payload = serde_json::to_string(n).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO graph_nodes (id, kind, confidence, timestamp, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    n.id(),
                    n.kind_str(),
                    f64::from(n.confidence()),
                    n.timestamp(),
                    payload
                ],
            )
            .map_err(|e| e.to_string())?;
            // Denormalised provenance for SQL-side inspection.
            let docs = match n {
                Node::Fact(x) => &x.provenance.documents,
                Node::Document(x) => &x.provenance.documents,
                Node::Contradiction(x) => &x.provenance.documents,
                Node::Entity(x) => &x.provenance.documents,
            };
            tx.execute(
                "INSERT INTO graph_node_metadata (node_id, key, value) VALUES (?1, 'documents', ?2)",
                params![n.id(), serde_json::to_string(docs).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        }

        for e in &graph.edges {
            let payload = serde_json::to_string(e).map_err(|err| err.to_string())?;
            tx.execute(
                "INSERT INTO graph_edges (id, kind, from_id, to_id, weight, reasoning, payload)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    e.id,
                    e.kind.as_str(),
                    f64::from(e.weight),
                    e.from,
                    e.to,
                    e.reasoning,
                    payload
                ],
            )
            .map_err(|err| err.to_string())?;
            tx.execute(
                "INSERT INTO graph_edge_metadata (edge_id, key, value) VALUES (?1, 'provenance', ?2)",
                params![e.id, e.provenance],
            )
            .map_err(|err| err.to_string())?;
        }

        tx.execute(
            "INSERT INTO graph_meta (key, value) VALUES ('schema_version', ?1)",
            params![GRAPH_SCHEMA_VERSION],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO graph_meta (key, value) VALUES ('metadata', ?1)",
            params![serde_json::to_string(&graph.metadata).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())
    }

    /// Fully reconstruct the graph from stored payloads, ordered by id —
    /// byte-identical (serde JSON) to the graph that was rebuilt.
    pub fn load(&self) -> Result<ContradictionGraph, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let mut nodes: Vec<Node> = Vec::new();
        {
            let mut stmt = conn
                .prepare("SELECT payload FROM graph_nodes ORDER BY id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                let payload = row.map_err(|e| e.to_string())?;
                nodes.push(serde_json::from_str(&payload).map_err(|e| e.to_string())?);
            }
        }

        let mut edges: Vec<Edge> = Vec::new();
        {
            let mut stmt = conn
                .prepare("SELECT payload FROM graph_edges ORDER BY id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                let payload = row.map_err(|e| e.to_string())?;
                edges.push(serde_json::from_str(&payload).map_err(|e| e.to_string())?);
            }
        }

        let metadata: GraphMetadata = {
            let json: String = conn
                .query_row(
                    "SELECT value FROM graph_meta WHERE key = 'metadata'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            serde_json::from_str(&json).map_err(|e| e.to_string())?
        };

        Ok(ContradictionGraph { nodes, edges, metadata })
    }

    /// Deterministic textual snapshot of all five tables, suitable for
    /// byte-identical comparison across rebuilds.
    pub fn snapshot_canonical(&self) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut out = String::new();
        let mut tables: BTreeMap<&str, &str> = BTreeMap::new();
        tables.insert("graph_nodes", "SELECT id, kind, payload FROM graph_nodes ORDER BY id");
        tables.insert("graph_edges", "SELECT id, kind, payload FROM graph_edges ORDER BY id");
        tables.insert(
            "graph_node_metadata",
            "SELECT node_id, key, value FROM graph_node_metadata ORDER BY node_id, key",
        );
        tables.insert(
            "graph_edge_metadata",
            "SELECT edge_id, key, value FROM graph_edge_metadata ORDER BY edge_id, key",
        );
        tables.insert("graph_meta", "SELECT key, '', value FROM graph_meta ORDER BY key");
        for (name, sql) in tables {
            out.push_str(&format!("== {name} ==\n"));
            let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(format!(
                        "{}|{}|{}",
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                out.push_str(&row.map_err(|e| e.to_string())?);
                out.push('\n');
            }
        }
        Ok(out)
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tests — ephemeral SQLite files under a per-test temp dir.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contradiction_engine::run_contradiction_engine;
    use crate::graph_builder::build_contradiction_graph;
    use std::path::PathBuf;

    fn temp_db(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("medicoapp-graph-proj-{label}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&p);
        p.push("graph.db");
        let _ = std::fs::remove_file(&p);
        p
    }

    fn sample_graph() -> ContradictionGraph {
        use crate::event_dispatch::EventEnvelope;
        use crate::fact_extract::extract_facts;
        let facts = extract_facts(
            "The patient is divorced. A later letter records that she is married.",
            "docA",
        );
        let envelopes: Vec<EventEnvelope> =
            facts.into_iter().map(EventEnvelope::Fact).collect();
        let out = run_contradiction_engine(envelopes, &[]);
        build_contradiction_graph(&out)
    }

    #[test]
    fn rebuild_then_load_roundtrips_byte_identically() {
        let g = sample_graph();
        assert!(!g.nodes.is_empty(), "sample graph must not be empty");
        let proj = ContradictionGraphProjection::init(&temp_db("roundtrip")).unwrap();
        proj.rebuild(&g).unwrap();
        let loaded = proj.load().unwrap();
        assert_eq!(
            serde_json::to_string(&g).unwrap(),
            serde_json::to_string(&loaded).unwrap()
        );
    }

    #[test]
    fn rebuild_is_idempotent() {
        let g = sample_graph();
        let proj = ContradictionGraphProjection::init(&temp_db("idempotent")).unwrap();
        proj.rebuild(&g).unwrap();
        let s1 = proj.snapshot_canonical().unwrap();
        proj.rebuild(&g).unwrap();
        let s2 = proj.snapshot_canonical().unwrap();
        assert_eq!(s1, s2, "double rebuild must be byte-identical");
    }

    #[test]
    fn rebuild_replaces_previous_content() {
        let g = sample_graph();
        let proj = ContradictionGraphProjection::init(&temp_db("replace")).unwrap();
        proj.rebuild(&g).unwrap();
        // Rebuild from an EMPTY graph must fully clear the previous rows.
        let empty = ContradictionGraph {
            nodes: vec![],
            edges: vec![],
            metadata: GraphMetadata {
                schema_version: GRAPH_SCHEMA_VERSION.to_string(),
                contradiction_count: 0,
                node_counts: BTreeMap::new(),
                edge_counts: BTreeMap::new(),
            },
        };
        proj.rebuild(&empty).unwrap();
        let loaded = proj.load().unwrap();
        assert!(loaded.nodes.is_empty() && loaded.edges.is_empty());
    }
}
