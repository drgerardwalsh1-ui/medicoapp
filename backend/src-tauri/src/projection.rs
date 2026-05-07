//! Read-model projection (Step 3b real flow + Step 3c rebuild & integrity).
//!
//! - `project_forward(events)` — incremental upsert from a slice.
//! - `rebuild_from_events(events)` — drop projection tables and rebuild.
//! - `snapshot_canonical()` — deterministic textual snapshot of all four
//!   read-model tables, suitable for byte-identical comparison.
//! - `check_integrity(events)` — compare projection's `clients.last_version`
//!   against `MAX(events.version)` per client; report drift.
//!
//! All writes use `INSERT ... ON CONFLICT(id) DO UPDATE`. `created_at` is
//! derived from the **first** event for the client (via `ClientState.first_seen`)
//! so a rebuild produces a byte-identical projection.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::events::EventEnvelope;
use crate::reducer::{reduce, ClientState, DocumentState};

pub struct Projection {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionSnapshot {
    pub tables: BTreeMap<String, String>,
}

/// Read-only view assembled from `projection.db`. Returned by
/// `get_client_view`; never derived from events directly at read time.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClientViewModel {
    pub id: String,
    /// Full demographics JSON as stored on the projection. Parsed into a
    /// `serde_json::Value` so every key round-trips losslessly.
    pub demographics: Option<serde_json::Value>,
    pub last_version: u64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub document_count: u64,
    pub documents: Vec<DocumentSummary>,
    /// Placeholder — populated when entity extraction lands on the projection.
    pub entities: Vec<serde_json::Value>,
    /// Placeholder — populated when timeline reconstruction lands.
    pub timeline: Vec<serde_json::Value>,
    /// All PIRS snapshot rows for this client, ordered by version.
    pub pirs_snapshots: Vec<PIRSTableViewModel>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DocumentSummary {
    pub id: String,
    pub file_name: Option<String>,
    pub method: Option<String>,
    pub char_count: u64,
    pub uploaded_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PIRSTableViewModel {
    pub version: u64,
    /// Parsed snapshot JSON (whatever shape the producer wrote).
    pub snapshot: serde_json::Value,
    pub created_at: String,
}


#[derive(Debug, Clone)]
pub struct DriftReport {
    pub mismatches: Vec<DriftMismatch>,
}

#[derive(Debug, Clone)]
pub struct DriftMismatch {
    pub client_id: String,
    pub projected_version: u64,
    pub events_max_version: u64,
}

impl std::fmt::Display for DriftReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "projection drift detected ({} client(s)):", self.mismatches.len())?;
        for m in &self.mismatches {
            write!(
                f,
                "\n  client {} — projected last_version={}, events MAX(version)={}",
                m.client_id, m.projected_version, m.events_max_version
            )?;
        }
        Ok(())
    }
}

impl Projection {
    pub fn init(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        create_schema(&conn)?;
        // Step 4 migration: add `demographics` column to pre-existing
        // clients tables. SQLite has no `IF NOT EXISTS` for ADD COLUMN, so
        // we ignore the duplicate-column error.
        let _ = conn.execute("ALTER TABLE clients ADD COLUMN demographics TEXT", []);
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Incremental projection: groups by client, folds, upserts.
    pub fn project_forward(&self, events: &[EventEnvelope]) -> rusqlite::Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        let mut by_client: BTreeMap<String, Vec<EventEnvelope>> = BTreeMap::new();
        for env in events {
            by_client.entry(env.client_id.clone()).or_default().push(env.clone());
        }

        let mut conn = self.conn.lock().expect("projection poisoned");
        let tx = conn.transaction()?;

        for (_cid, group) in by_client {
            let state = reduce(&group);
            upsert_client(&tx, &state)?;
            for doc in &state.documents {
                upsert_document(&tx, &state.client_id, doc)?;
            }
        }

        if let Some(last) = events.last() {
            tx.execute(
                r#"INSERT INTO event_cursor (id, last_event_id, updated_at)
                   VALUES (1, ?1, ?2)
                   ON CONFLICT(id) DO UPDATE SET
                       last_event_id = excluded.last_event_id,
                       updated_at    = excluded.updated_at"#,
                params![last.id.to_string(), chrono::Utc::now().to_rfc3339()],
            )?;
        }

        tx.commit()
    }

    /// Drop and recreate read-model tables, then replay all events.
    /// `event_cursor` is preserved across calls so its `last_event_id`
    /// reflects the latest event seen.
    pub fn rebuild_from_events(&self, events: &[EventEnvelope]) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().expect("projection poisoned");

        // Defer FK checks for the duration of the rebuild transaction so we
        // can drop parent tables before children. Re-validated at commit.
        conn.execute_batch("PRAGMA defer_foreign_keys = ON")?;

        let tx = conn.transaction()?;

        // Drop child tables first (those holding FKs), then parents.
        for name in ["pirs_snapshots", "entities", "documents", "clients"] {
            tx.execute(&format!("DROP TABLE IF EXISTS {name}"), [])?;
        }
        create_schema_in_tx(&tx)?;

        // Deterministic group order: BTreeMap by client_id.
        let mut by_client: BTreeMap<String, Vec<EventEnvelope>> = BTreeMap::new();
        for env in events {
            by_client.entry(env.client_id.clone()).or_default().push(env.clone());
        }

        for (_cid, group) in by_client {
            let state = reduce(&group);
            upsert_client(&tx, &state)?;
            for doc in &state.documents {
                upsert_document(&tx, &state.client_id, doc)?;
            }
        }

        if let Some(last) = events.last() {
            tx.execute(
                r#"INSERT INTO event_cursor (id, last_event_id, updated_at)
                   VALUES (1, ?1, ?2)
                   ON CONFLICT(id) DO UPDATE SET
                       last_event_id = excluded.last_event_id,
                       updated_at    = excluded.updated_at"#,
                params![last.id.to_string(), chrono::Utc::now().to_rfc3339()],
            )?;
        }

        tx.commit()
    }

    /// Deterministic textual snapshot of all four read-model tables.
    /// Two snapshots compare equal iff their underlying state is identical.
    pub fn snapshot_canonical(&self) -> rusqlite::Result<ProjectionSnapshot> {
        let conn = self.conn.lock().expect("projection poisoned");
        let mut tables = BTreeMap::new();
        tables.insert("clients".into(), canon_clients(&conn)?);
        tables.insert("documents".into(), canon_documents(&conn)?);
        tables.insert("entities".into(), canon_entities(&conn)?);
        tables.insert("pirs_snapshots".into(), canon_pirs(&conn)?);
        Ok(ProjectionSnapshot { tables })
    }

    /// List every client id present in the projection, oldest first.
    /// Used by callers that want to enumerate without round-tripping
    /// through full views.
    pub fn list_client_ids(&self) -> rusqlite::Result<Vec<String>> {
        let conn = self.conn.lock().expect("projection poisoned");
        let mut stmt = conn.prepare(
            "SELECT id FROM clients ORDER BY COALESCE(created_at,'') ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    /// Read a client view from the projection. Returns `Ok(None)` if the
    /// client is not present.
    pub fn get_client_view(&self, client_id: &str) -> rusqlite::Result<Option<ClientViewModel>> {
        let conn = self.conn.lock().expect("projection poisoned");

        let row = conn.query_row(
            r#"SELECT id, demographics, last_version, created_at, updated_at
                 FROM clients WHERE id = ?1"#,
            params![client_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            },
        );

        let (id, demographics, last_version, created_at, updated_at) = match row {
            Ok(t) => t,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e),
        };

        // ── Documents ──────────────────────────────────────────────────────
        let document_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM documents WHERE client_id = ?1",
            params![client_id],
            |r| r.get(0),
        )?;

        let mut docs_stmt = conn.prepare(
            r#"SELECT id, file_name, method, COALESCE(char_count, 0), uploaded_at
                 FROM documents
                WHERE client_id = ?1
                ORDER BY uploaded_at ASC, id ASC"#,
        )?;
        let documents: Vec<DocumentSummary> = docs_stmt
            .query_map(params![client_id], |r| {
                Ok(DocumentSummary {
                    id: r.get(0)?,
                    file_name: r.get(1)?,
                    method: r.get(2)?,
                    char_count: r.get::<_, i64>(3)? as u64,
                    uploaded_at: r.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        // ── Demographics — parse the JSON column losslessly ────────────────
        let demographics_parsed: Option<serde_json::Value> = match &demographics {
            Some(raw) if !raw.trim().is_empty() => {
                let parsed = serde_json::from_str::<serde_json::Value>(raw);
                // Debug-mode invariant: if the column holds non-empty text we
                // must always parse it. A panic here means the projection is
                // corrupt or a writer emitted invalid JSON.
                debug_assert!(
                    parsed.is_ok(),
                    "get_client_view: demographics column for client {client_id} contains \
                     non-empty text that failed to parse as JSON: {raw:?}"
                );
                parsed.ok()
            }
            _ => None,
        };

        // Debug-mode invariant: column had a JSON object that decoded but is
        // somehow empty/null while the underlying text was non-empty — that
        // indicates a writer bug we want to catch in dev.
        if let (Some(raw), Some(value)) = (&demographics, &demographics_parsed) {
            let raw_nonempty = !raw.trim().is_empty() && raw.trim() != "null";
            let value_empty = value.is_null()
                || value
                    .as_object()
                    .map(|o| o.is_empty())
                    .unwrap_or(false);
            debug_assert!(
                !(raw_nonempty && value_empty),
                "get_client_view: demographics for {client_id} parsed to empty while DB has JSON: {raw:?}"
            );
        }

        // ── PIRS snapshots ─────────────────────────────────────────────────
        let mut pirs_stmt = conn.prepare(
            r#"SELECT version, snapshot_json, created_at
                 FROM pirs_snapshots
                WHERE client_id = ?1
                ORDER BY version ASC"#,
        )?;
        let pirs_rows = pirs_stmt
            .query_map(params![client_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut pirs_snapshots: Vec<PIRSTableViewModel> = Vec::with_capacity(pirs_rows.len());
        for (version, snapshot_json, created_at) in pirs_rows {
            let snapshot = serde_json::from_str::<serde_json::Value>(&snapshot_json)
                .unwrap_or(serde_json::Value::Null);
            debug_assert!(
                !snapshot.is_null() || snapshot_json.trim() == "null",
                "get_client_view: pirs_snapshot for {client_id} v={version} failed to parse"
            );
            pirs_snapshots.push(PIRSTableViewModel { version: version as u64, snapshot, created_at });
        }

        Ok(Some(ClientViewModel {
            id,
            demographics: demographics_parsed,
            last_version: last_version as u64,
            created_at,
            updated_at,
            document_count: document_count as u64,
            documents,
            entities: Vec::new(),
            timeline: Vec::new(),
            pirs_snapshots,
        }))
    }

    /// Drift detector: per-client compare projected `last_version` against
    /// the events store's `MAX(version)` for that client.
    pub fn check_integrity(&self, all_events: &[EventEnvelope]) -> Result<(), DriftReport> {
        // Compute MAX(version) per client from events.
        let mut max_per_client: BTreeMap<&str, u64> = BTreeMap::new();
        for env in all_events {
            let entry = max_per_client.entry(env.client_id.as_str()).or_insert(0);
            if env.version > *entry {
                *entry = env.version;
            }
        }

        // Pull projected last_version per client.
        let projected = {
            let conn = self.conn.lock().expect("projection poisoned");
            let mut stmt = conn
                .prepare("SELECT id, last_version FROM clients")
                .map_err(|e| DriftReport {
                    mismatches: vec![DriftMismatch {
                        client_id: format!("<sql-error: {e}>"),
                        projected_version: 0,
                        events_max_version: 0,
                    }],
                })?;
            let rows: Vec<(String, i64)> = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                .and_then(|it| it.collect())
                .map_err(|e| DriftReport {
                    mismatches: vec![DriftMismatch {
                        client_id: format!("<sql-error: {e}>"),
                        projected_version: 0,
                        events_max_version: 0,
                    }],
                })?;
            rows
        };

        let mut projected_map: BTreeMap<String, u64> = BTreeMap::new();
        for (id, v) in projected {
            projected_map.insert(id, v as u64);
        }

        let mut mismatches = Vec::new();

        // Every client present in events must have a matching row.
        for (cid, &max_v) in &max_per_client {
            let proj_v = projected_map.get(*cid).copied().unwrap_or(0);
            if proj_v != max_v {
                mismatches.push(DriftMismatch {
                    client_id: (*cid).to_string(),
                    projected_version: proj_v,
                    events_max_version: max_v,
                });
            }
        }
        // Stray clients in projection that aren't in events.
        for (cid, &proj_v) in &projected_map {
            if !max_per_client.contains_key(cid.as_str()) {
                mismatches.push(DriftMismatch {
                    client_id: cid.clone(),
                    projected_version: proj_v,
                    events_max_version: 0,
                });
            }
        }

        if mismatches.is_empty() {
            Ok(())
        } else {
            Err(DriftReport { mismatches })
        }
    }
}

// ── schema ────────────────────────────────────────────────────────────────────

fn create_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)
}

fn create_schema_in_tx(tx: &rusqlite::Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(SCHEMA_SQL)
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS clients (
    id            TEXT PRIMARY KEY,
    demographics  TEXT,
    last_version  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT,
    updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS documents (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    file_name     TEXT,
    method        TEXT,
    char_count    INTEGER,
    uploaded_at   TEXT,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS entities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id   TEXT NOT NULL,
    kind          TEXT NOT NULL,
    value         TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS pirs_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     TEXT NOT NULL,
    version       INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS event_cursor (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    last_event_id TEXT,
    updated_at    TEXT
);
"#;

// ── upserts ───────────────────────────────────────────────────────────────────

fn upsert_client(tx: &rusqlite::Transaction<'_>, state: &ClientState) -> rusqlite::Result<()> {
    let created_at = state
        .first_seen
        .map(|t| t.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let updated_at = state
        .last_updated
        .map(|t| t.to_rfc3339())
        .unwrap_or_else(|| created_at.clone());
    let demographics_json = state
        .demographics
        .as_ref()
        .map(|v| v.to_string()); // canonical compact JSON

    tx.execute(
        // Incremental upsert: the reducer leaves demographics as None
        // for events that don't touch it (e.g. DocumentUploaded), which
        // serialises to SQL NULL — COALESCE then preserves the prior value.
        r#"INSERT INTO clients (id, demographics, last_version, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET
               demographics = COALESCE(excluded.demographics, clients.demographics),
               last_version = MAX(clients.last_version, excluded.last_version),
               updated_at   = excluded.updated_at"#,
        params![
            state.client_id,
            demographics_json,
            state.last_version as i64,
            created_at,
            updated_at,
        ],
    )?;
    Ok(())
}

fn upsert_document(
    tx: &rusqlite::Transaction<'_>,
    client_id: &str,
    doc: &DocumentState,
) -> rusqlite::Result<()> {
    tx.execute(
        r#"INSERT INTO documents
               (id, client_id, file_name, method, char_count, uploaded_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(id) DO UPDATE SET
               client_id   = excluded.client_id,
               file_name   = excluded.file_name,
               method      = excluded.method,
               char_count  = excluded.char_count,
               uploaded_at = excluded.uploaded_at"#,
        params![
            doc.document_id,
            client_id,
            doc.file_name,
            doc.method,
            doc.char_count as i64,
            doc.uploaded_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

// ── canonical snapshots ───────────────────────────────────────────────────────

fn canon_clients(conn: &Connection) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare(
        "SELECT id,
                COALESCE(demographics,''),
                last_version,
                COALESCE(created_at,''),
                COALESCE(updated_at,'')
           FROM clients ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(format!(
            "{}|{}|{}|{}|{}",
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?.join("\n"))
}

fn canon_documents(conn: &Connection) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare(
        "SELECT id, client_id, COALESCE(file_name,''), COALESCE(method,''),
                COALESCE(char_count,0), COALESCE(uploaded_at,'')
           FROM documents ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(format!(
            "{}|{}|{}|{}|{}|{}",
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, String>(5)?,
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?.join("\n"))
}

fn canon_entities(conn: &Connection) -> rusqlite::Result<String> {
    // Skip auto-incrementing id — it isn't deterministic across rebuilds.
    let mut stmt = conn.prepare(
        "SELECT document_id, kind, value
           FROM entities ORDER BY document_id, kind, value",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(format!(
            "{}|{}|{}",
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?.join("\n"))
}

fn canon_pirs(conn: &Connection) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare(
        "SELECT client_id, version, snapshot_json, created_at
           FROM pirs_snapshots ORDER BY client_id, version",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(format!(
            "{}|{}|{}|{}",
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?.join("\n"))
}
