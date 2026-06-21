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
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ClientViewModel {
    pub id: String,
    /// Full demographics JSON as stored on the projection. Parsed into a
    /// `serde_json::Value` so every key round-trips losslessly.
    #[specta(type = Option<specta_typescript::Unknown>)]
    pub demographics: Option<serde_json::Value>,
    #[specta(type = specta_typescript::Number)]
    pub last_version: u64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub document_count: u64,
    pub documents: Vec<DocumentSummary>,
    /// Placeholder — populated when entity extraction lands on the projection.
    #[specta(type = Vec<specta_typescript::Unknown>)]
    pub entities: Vec<serde_json::Value>,
    /// Placeholder — populated when timeline reconstruction lands.
    #[specta(type = Vec<specta_typescript::Unknown>)]
    pub timeline: Vec<serde_json::Value>,
    /// All PIRS snapshot rows for this client, ordered by version.
    pub pirs_snapshots: Vec<PIRSTableViewModel>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct DocumentSummary {
    pub id: String,
    pub file_name: Option<String>,
    pub method: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub char_count: u64,
    pub uploaded_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct PIRSTableViewModel {
    #[specta(type = specta_typescript::Number)]
    pub version: u64,
    /// Parsed snapshot JSON (whatever shape the producer wrote).
    #[specta(type = specta_typescript::Unknown)]
    pub snapshot: serde_json::Value,
    pub created_at: String,
}

/// Read-model view of one event's resolved attribution, with the
/// participant + organisation NAMES already joined in (so the frontend
/// does not need a second lookup). Sourced entirely from existing
/// projection tables — no new persistence.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ResolvedAttributionView {
    pub event_id: String,
    pub participant_id: Option<String>,
    pub participant_name: Option<String>,
    pub participant_role: Option<String>,
    pub organisation_id: Option<String>,
    pub organisation_name: Option<String>,
    pub patient_id: Option<String>,
}

/// Per-document bundle of persisted extraction results. Assembled by
/// `get_client_extraction` from the boundary tables that the ingestion
/// pipeline already populated (`documents`, `clinical_events`,
/// `resolved_attributions`, `participants`, `organisations`). This is a
/// pure READ projection — it stores nothing and derives nothing new; it
/// just exposes rows that `get_client_view` does not currently surface,
/// so the UI can rehydrate clinical content after navigation without
/// reprocessing.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DocumentExtraction {
    pub document_id: String,
    pub file_name: Option<String>,
    /// Persisted source texts (chain-of-custody raw + cleaned). Already
    /// stored on the `documents` row; exposed here so the raw/clean text
    /// toggle survives navigation.
    pub raw_text: Option<String>,
    pub clean_text: Option<String>,
    /// The verbatim `ClinicalEvent` records (parsed from `event_json`),
    /// ordered by `event_id` for determinism.
    pub clinical_events: Vec<serde_json::Value>,
    /// Resolved attribution per event, names pre-joined.
    pub attributions: Vec<ResolvedAttributionView>,
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
        // Persistence-boundary migration (medico-legal audit). Idempotent
        // ALTERs — swallow duplicate-column errors so existing databases
        // pick up the new columns on first open.
        for stmt in [
            "ALTER TABLE documents ADD COLUMN source_bytes_sha256 TEXT",
            "ALTER TABLE documents ADD COLUMN raw_text            TEXT",
            "ALTER TABLE documents ADD COLUMN clean_text          TEXT",
            "ALTER TABLE documents ADD COLUMN clean_text_sha256   TEXT",
            "ALTER TABLE documents ADD COLUMN ocr_engine_version  TEXT",
            "ALTER TABLE documents ADD COLUMN pipeline_version    TEXT",
            "ALTER TABLE documents ADD COLUMN rule_corpus_hash    TEXT",
        ] {
            let _ = conn.execute(stmt, []);
        }
        // Integrity-status column on clinical_events. NULL = OK,
        // non-NULL = warning message. See snippet_integrity gate
        // redesign (RC3): writes never fail on integrity; instead they
        // record the status here for audit surfacing.
        let _ = conn.execute(
            "ALTER TABLE clinical_events ADD COLUMN integrity_status TEXT",
            [],
        );
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
            if state.deleted {
                // Incremental delete: remove child rows then the client.
                delete_client_rows(&tx, &state.client_id)?;
                continue;
            }
            upsert_client(&tx, &state)?;
            for doc in &state.documents {
                upsert_document(&tx, &state.client_id, doc)?;
            }
            // Persistence-boundary application — folds the four new
            // event variants into the boundary tables. Done after the
            // base reducer so document rows exist when child rows are
            // inserted (FK constraint).
            apply_boundary_events(&tx, &group)?;
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
        // Order matters: boundary tables FK-ref documents and each other,
        // so they go first.
        for name in [
            "resolved_attributions",
            "clinical_events",
            "document_participant_maps",
            "patient_identities",
            "participants",
            "organisations",
            "extraction_runs",
            "pirs_snapshots",
            "entities",
            "documents",
            "clients",
        ] {
            tx.execute(&format!("DROP TABLE IF EXISTS {name}"), [])?;
        }
        create_schema_in_tx(&tx)?;

        // Deterministic group order: BTreeMap by client_id.
        let mut by_client: BTreeMap<String, Vec<EventEnvelope>> = BTreeMap::new();
        for env in events {
            by_client.entry(env.client_id.clone()).or_default().push(env.clone());
        }

        // INVARIANT (rebuild correctness): `rebuild_from_events` correctness
        // depends on DocumentDeleted being REPLAYED — the original
        // DocumentExtracted / ClinicalEventsRecorded events are never
        // removed from the append-only log, so without replaying the
        // tombstone a rebuild would resurrect the document. Within a client
        // group, events fold in (timestamp, version) order, and
        // DocumentDeleted is the highest-version event for its document
        // (see `apply_boundary_events`), so the inline handler leaves the
        // document removed at the end of the group.
        for (_cid, group) in by_client {
            let state = reduce(&group);
            // Rebuild path: skip deleted clients entirely so they don't
            // reappear in the read model.
            if state.deleted {
                continue;
            }
            upsert_client(&tx, &state)?;
            for doc in &state.documents {
                upsert_document(&tx, &state.client_id, doc)?;
            }
            apply_boundary_events(&tx, &group)?;
        }

        // ── Tombstone sweep (order-independent deletion guarantee) ──────────
        // INVARIANT: the tombstone sweep ensures DocumentDeleted DOMINATES
        // any ordering anomalies (including legacy phantom DocumentUploaded
        // artifacts). The inline handler above already removes a document's
        // rows within its own client group — but a LEGACY phantom
        // DocumentUploaded (client_id == doc_id, pre-ownership-fix) lives in
        // a DIFFERENT client group whose `upsert_document` could re-create
        // the row if that group is processed AFTER the real client's
        // tombstone. By collecting every DocumentDeleted document_id across
        // ALL events and re-running the cascade once more — after every
        // group has been folded — deletion becomes strictly
        // order-independent. Idempotent: re-deleting an absent document is
        // a no-op.
        {
            let mut deleted_doc_ids: std::collections::BTreeSet<String> =
                std::collections::BTreeSet::new();
            for env in events {
                if let crate::events::EventPayload::DocumentDeleted(p) = &env.payload {
                    deleted_doc_ids.insert(p.document_id.clone());
                }
            }
            for doc_id in &deleted_doc_ids {
                cascade_delete_document(&tx, doc_id)?;
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

    /// Lightweight existence check against the projection's `clients`
    /// table. This is the SINGLE SOURCE OF TRUTH for "does this client
    /// exist?" — used by the ingestion defensive guard so document
    /// uploads can never target a client that was never persisted.
    ///
    /// Cheaper than `get_client_view` (no demographics parse, no
    /// document/pirs joins) because the only question is presence.
    pub fn client_exists(&self, client_id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().expect("projection poisoned");
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM clients WHERE id = ?1",
            params![client_id],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    /// Read persisted extraction results for a client, per document.
    ///
    /// Pure READ over the boundary tables the ingestion pipeline already
    /// populated — NO new persistence, NO recomputation, NO reprocessing.
    /// Surfaces the clinical content that `get_client_view` does not
    /// expose, so the UI can rehydrate it after navigation. Source of
    /// truth remains `projection.db`.
    pub fn get_client_extraction(
        &self,
        client_id: &str,
    ) -> rusqlite::Result<Vec<DocumentExtraction>> {
        let conn = self.conn.lock().expect("projection poisoned");

        // 1. Documents for this client (id, file_name, persisted texts).
        let mut doc_stmt = conn.prepare(
            r#"SELECT id, file_name, raw_text, clean_text
                 FROM documents
                WHERE client_id = ?1
                ORDER BY uploaded_at ASC, id ASC"#,
        )?;
        let doc_rows: Vec<(String, Option<String>, Option<String>, Option<String>)> = doc_stmt
            .query_map(params![client_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
            .collect::<Result<_, _>>()?;

        // 2. Per document, gather clinical_events (parsed) + attributions.
        let mut ce_stmt = conn.prepare(
            r#"SELECT event_json
                 FROM clinical_events
                WHERE document_id = ?1
                ORDER BY event_id ASC"#,
        )?;
        // Attribution join: names pre-resolved from participants /
        // organisations so the frontend needs no second lookup.
        let mut attr_stmt = conn.prepare(
            r#"SELECT ra.event_id,
                      ra.participant_id, p.name  AS participant_name, p.role AS participant_role,
                      ra.organisation_id, o.name AS organisation_name,
                      ra.patient_id
                 FROM resolved_attributions ra
                 JOIN clinical_events ce ON ce.event_id = ra.event_id
                 LEFT JOIN participants  p ON p.participant_id  = ra.participant_id
                 LEFT JOIN organisations o ON o.organisation_id = ra.organisation_id
                WHERE ce.document_id = ?1
                ORDER BY ra.event_id ASC"#,
        )?;

        let mut out: Vec<DocumentExtraction> = Vec::with_capacity(doc_rows.len());
        for (doc_id, file_name, raw_text, clean_text) in doc_rows {
            let clinical_events: Vec<serde_json::Value> = ce_stmt
                .query_map(params![doc_id], |r| r.get::<_, String>(0))?
                .filter_map(|res| res.ok())
                .filter_map(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .collect();

            let attributions: Vec<ResolvedAttributionView> = attr_stmt
                .query_map(params![doc_id], |r| {
                    Ok(ResolvedAttributionView {
                        event_id: r.get(0)?,
                        participant_id: r.get(1)?,
                        participant_name: r.get(2)?,
                        participant_role: r.get(3)?,
                        organisation_id: r.get(4)?,
                        organisation_name: r.get(5)?,
                        patient_id: r.get(6)?,
                    })
                })?
                .collect::<Result<_, _>>()?;

            out.push(DocumentExtraction {
                document_id: doc_id,
                file_name,
                raw_text,
                clean_text,
                clinical_events,
                attributions,
            });
        }
        Ok(out)
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
        // Compute MAX(version) per client from events, and remember which
        // clients have been deleted — those legitimately have no row in
        // the projection and must be excluded from the drift check.
        let mut max_per_client: BTreeMap<&str, u64> = BTreeMap::new();
        let mut deleted_clients: std::collections::BTreeSet<&str> =
            std::collections::BTreeSet::new();
        for env in all_events {
            let entry = max_per_client.entry(env.client_id.as_str()).or_insert(0);
            if env.version > *entry {
                *entry = env.version;
            }
            if matches!(env.payload, crate::events::EventPayload::ClientDeleted(_)) {
                deleted_clients.insert(env.client_id.as_str());
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

        // Every client present in events must have a matching row,
        // unless it has been deleted (in which case the absence of a
        // projection row is correct).
        for (cid, &max_v) in &max_per_client {
            if deleted_clients.contains(cid) {
                continue;
            }
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
    -- Persistence-boundary columns (medico-legal audit). NULL until a
    -- DocumentExtracted event lands for this row.
    source_bytes_sha256 TEXT,
    raw_text            TEXT,
    clean_text          TEXT,
    clean_text_sha256   TEXT,   -- freeze-point digest (RC1)
    ocr_engine_version  TEXT,
    pipeline_version    TEXT,
    rule_corpus_hash    TEXT,
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

-- ─── Persistence-boundary tables (medico-legal audit) ───────────────────
-- These tables materialise the lowest-complete-truth layer. Higher
-- layers (UnifiedEvent, PatientEvent, etc.) are NEVER stored — they are
-- pure in-memory derivations rebuildable from these rows + the rule
-- corpus pinned by `documents.pipeline_version` and
-- `documents.rule_corpus_hash`. See snippet_integrity.rs for the
-- byte-equality rule enforced at write time on clinical_events.

CREATE TABLE IF NOT EXISTS clinical_events (
    event_id            TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL,
    event_type          TEXT NOT NULL,
    concept             TEXT NOT NULL,
    raw_concept         TEXT NOT NULL,
    assertion_status    TEXT,
    source_section      TEXT,
    source_snippet      TEXT NOT NULL,
    char_offset_start   INTEGER NOT NULL,
    char_offset_end     INTEGER NOT NULL,
    date                TEXT,
    date_precision      TEXT,
    -- Integrity-status column (RC3). NULL = snippet integrity check
    -- passed for this row; a non-empty string captures the diagnostic
    -- message so audits can surface the row without rejecting ingestion.
    integrity_status    TEXT,
    -- Full JSON of the ClinicalEvent for fields not promoted to columns
    -- (participants, metadata, page). Lets downstream reasoning rebuild
    -- the in-memory struct exactly.
    event_json          TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id)
);
CREATE INDEX IF NOT EXISTS idx_clinical_events_document
    ON clinical_events(document_id);
CREATE INDEX IF NOT EXISTS idx_clinical_events_concept
    ON clinical_events(concept);

CREATE TABLE IF NOT EXISTS resolved_attributions (
    event_id        TEXT PRIMARY KEY,
    participant_id  TEXT,
    organisation_id TEXT,
    patient_id      TEXT,
    FOREIGN KEY (event_id) REFERENCES clinical_events(event_id)
);

CREATE TABLE IF NOT EXISTS patient_identities (
    patient_id   TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    dob          TEXT,
    confidence   REAL NOT NULL,
    source_documents_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
    participant_id        TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    role                  TEXT NOT NULL,
    role_evidence_json    TEXT NOT NULL,
    source_documents_json TEXT NOT NULL,
    source_sections_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organisations (
    organisation_id       TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    org_type              TEXT NOT NULL,
    source_documents_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_participant_maps (
    document_id           TEXT PRIMARY KEY,
    patient_ids_json      TEXT NOT NULL,
    participant_ids_json  TEXT NOT NULL,
    organisation_ids_json TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS extraction_runs (
    run_id                TEXT PRIMARY KEY,
    executed_at           TEXT NOT NULL,
    pipeline_version      TEXT NOT NULL,
    rule_corpus_hash      TEXT NOT NULL,
    document_ids_json     TEXT NOT NULL,
    clinical_event_count  INTEGER NOT NULL,
    attribution_count     INTEGER NOT NULL
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

// ─── Persistence-boundary application ────────────────────────────────────
// Folds the four new event types (DocumentExtracted, ClinicalEventsRecorded,
// AttributionRecorded, ExtractionRunRecorded) into the boundary tables.
// Run after the base reducer so document rows already exist (FK target).
// Snippet integrity is verified at write time — failure aborts the
// transaction so no event whose snippet has drifted from its offsets can
// reach the audit-of-record.
fn apply_boundary_events(
    tx: &rusqlite::Transaction<'_>,
    events: &[crate::events::EventEnvelope],
) -> rusqlite::Result<()> {
    use crate::events::EventPayload;

    for env in events {
        match &env.payload {
            EventPayload::DocumentExtracted(p) => {
                // INSERT-OR-UPDATE so the boundary handler is self-
                // sufficient: a `documents` row is created when this
                // is the first event for the doc (no prior
                // DocumentUploaded), AND filled correctly when a prior
                // DocumentUploaded already created the row. Either path
                // satisfies the FK constraint for clinical_events.
                tx.execute(
                    r#"INSERT INTO documents
                           (id, client_id, file_name, method, char_count, uploaded_at,
                            source_bytes_sha256, raw_text, clean_text, clean_text_sha256,
                            ocr_engine_version, pipeline_version, rule_corpus_hash)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                       ON CONFLICT(id) DO UPDATE SET
                           -- DocumentExtracted is BOUNDARY-OWNED and therefore
                           -- AUTHORITATIVE for document ownership. If a legacy
                           -- DocumentUploaded (client_id = doc_id) created this
                           -- row first as a phantom self-owned document, the
                           -- real client_id reclaims it here. Without this line
                           -- the document stays attached to a phantom client and
                           -- never appears under the real client.
                           client_id           = excluded.client_id,
                           -- Persist the uploaded filename. COALESCE so a NULL
                           -- (legacy event without file_name) never wipes a
                           -- name an earlier writer already set.
                           file_name           = COALESCE(excluded.file_name, documents.file_name),
                           source_bytes_sha256 = excluded.source_bytes_sha256,
                           raw_text            = excluded.raw_text,
                           clean_text          = excluded.clean_text,
                           clean_text_sha256   = excluded.clean_text_sha256,
                           method              = COALESCE(excluded.method, documents.method),
                           ocr_engine_version  = excluded.ocr_engine_version,
                           pipeline_version    = excluded.pipeline_version,
                           rule_corpus_hash    = excluded.rule_corpus_hash"#,
                    params![
                        p.document_id,
                        env.client_id,                       // client FK
                        p.file_name,                         // uploaded filename (Option → NULL if legacy)
                        p.method,
                        p.raw_text.len() as i64,             // char_count (best-effort; legacy DocumentUploaded refines if it lands first)
                        env.timestamp.to_rfc3339(),          // uploaded_at
                        p.source_bytes_sha256,
                        p.raw_text,
                        p.clean_text,
                        p.clean_text_sha256,
                        p.ocr_engine_version,
                        p.pipeline_version,
                        p.rule_corpus_hash,
                    ],
                )?;
            }
            EventPayload::ClinicalEventsRecorded(p) => {
                // Idempotent: re-recording the same run for the same
                // document replaces the previous ClinicalEvents. This
                // is allowed because every event_id is deterministic.
                tx.execute(
                    "DELETE FROM resolved_attributions
                       WHERE event_id IN
                             (SELECT event_id FROM clinical_events WHERE document_id = ?1)",
                    params![p.document_id],
                )?;
                tx.execute(
                    "DELETE FROM clinical_events WHERE document_id = ?1",
                    params![p.document_id],
                )?;
                // Pull the document's clean_text for the integrity check.
                // If the DocumentExtracted event hasn't landed yet — e.g.
                // a malformed event stream — refuse to write boundary
                // ClinicalEvents whose snippets we cannot validate.
                let clean_text: Option<String> = tx
                    .query_row(
                        "SELECT clean_text FROM documents WHERE id = ?1",
                        params![p.document_id],
                        |r| r.get(0),
                    )
                    .ok();
                let clean_text = clean_text.unwrap_or_default();
                for ev_json in &p.clinical_events {
                    insert_clinical_event(tx, &p.document_id, ev_json, &clean_text)?;
                }
            }
            EventPayload::AttributionRecorded(p) => {
                if let Some(obj) = p.payload.as_object() {
                    if let Some(arr) = obj.get("attributions").and_then(|v| v.as_array()) {
                        for a in arr {
                            upsert_attribution(tx, a)?;
                        }
                    }
                    if let Some(arr) = obj.get("patients").and_then(|v| v.as_array()) {
                        for it in arr {
                            upsert_patient_identity(tx, it)?;
                        }
                    }
                    if let Some(arr) = obj.get("participants").and_then(|v| v.as_array()) {
                        for it in arr {
                            upsert_participant(tx, it)?;
                        }
                    }
                    if let Some(arr) = obj.get("organisations").and_then(|v| v.as_array()) {
                        for it in arr {
                            upsert_organisation(tx, it)?;
                        }
                    }
                    if let Some(arr) = obj.get("document_maps").and_then(|v| v.as_array()) {
                        for it in arr {
                            upsert_document_participant_map(tx, it)?;
                        }
                    }
                }
            }
            EventPayload::ExtractionRunRecorded(p) => {
                tx.execute(
                    r#"INSERT INTO extraction_runs
                           (run_id, executed_at, pipeline_version, rule_corpus_hash,
                            document_ids_json, clinical_event_count, attribution_count)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                       ON CONFLICT(run_id) DO UPDATE SET
                           executed_at          = excluded.executed_at,
                           pipeline_version     = excluded.pipeline_version,
                           rule_corpus_hash     = excluded.rule_corpus_hash,
                           document_ids_json    = excluded.document_ids_json,
                           clinical_event_count = excluded.clinical_event_count,
                           attribution_count    = excluded.attribution_count"#,
                    params![
                        p.run_id.to_string(),
                        p.executed_at.to_rfc3339(),
                        p.pipeline_version,
                        p.rule_corpus_hash,
                        serde_json::to_string(&p.document_ids).unwrap_or_default(),
                        p.clinical_event_count as i64,
                        p.attribution_count as i64,
                    ],
                )?;
            }
            EventPayload::DocumentDeleted(p) => {
                // INVARIANT (event ordering): DocumentDeleted MUST be the
                // highest-version event for a document within its client
                // group. Because events replay in strict (timestamp,
                // version) order, this guarantees the DocumentExtracted /
                // ClinicalEventsRecorded / AttributionRecorded events for
                // the same document have ALREADY been folded (rows exist)
                // by the time this tombstone runs, so the cascade removes
                // real rows. delete_document upholds this by appending the
                // tombstone with the next monotonic version, strictly
                // after the document's create/extract events.
                //
                // Hard-delete the document + every derived row keyed by
                // document_id. Idempotent (0 rows is fine if already gone).
                // The event itself stays in the append-only log for audit.
                cascade_delete_document(tx, &p.document_id)?;
            }
            _ => {} // non-boundary events handled by the base reducer
        }
    }
    Ok(())
}

/// Hard-delete a single document and all derived projection rows, in
/// FK-safe order (children → parent). Idempotent: deleting an absent
/// document affects 0 rows and is not an error.
///
/// Scope (exactly the locked cascade): `resolved_attributions` (via its
/// `clinical_events.event_id`), `clinical_events`, `document_participant_maps`,
/// `entities`, then `documents`. Global tables (`participants`,
/// `organisations`, `patient_identities`) and run metadata
/// (`extraction_runs`) are intentionally left untouched.
///
/// INVARIANT (derived-data dependency): `resolved_attributions` is NOT
/// directly keyed by `document_id`. It is bound to the document only
/// INDIRECTLY, via `clinical_events.event_id → document_id`. Therefore
/// deletion correctness depends on CASCADE ORDER, not on an FK
/// constraint: `resolved_attributions` must be deleted FIRST (resolving
/// its `event_id`s through `clinical_events` while those rows still
/// exist), BEFORE `clinical_events` is deleted. Reordering these two
/// statements would orphan attribution rows.
fn cascade_delete_document(
    tx: &rusqlite::Transaction<'_>,
    document_id: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM resolved_attributions
          WHERE event_id IN (SELECT event_id FROM clinical_events WHERE document_id = ?1)",
        params![document_id],
    )?;
    tx.execute(
        "DELETE FROM clinical_events WHERE document_id = ?1",
        params![document_id],
    )?;
    tx.execute(
        "DELETE FROM document_participant_maps WHERE document_id = ?1",
        params![document_id],
    )?;
    tx.execute(
        "DELETE FROM entities WHERE document_id = ?1",
        params![document_id],
    )?;
    tx.execute(
        "DELETE FROM documents WHERE id = ?1",
        params![document_id],
    )?;
    Ok(())
}

fn insert_clinical_event(
    tx: &rusqlite::Transaction<'_>,
    document_id: &str,
    ev_json: &serde_json::Value,
    clean_text: &str,
) -> rusqlite::Result<()> {
    // Deserialise into the typed struct. Structural malformation still
    // aborts — events that can't even be parsed are unambiguously bad.
    let ce: crate::clinical_events::ClinicalEvent =
        serde_json::from_value(ev_json.clone()).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("clinical_event deserialise failed: {e}"),
            )))
        })?;
    // RC3 — integrity gate redesign. Snippet integrity is REPORTED, not
    // enforced at the projection write boundary. Environmental OCR /
    // text variance must not block ingestion. The integrity_status
    // column captures any diagnostic so an audit query
    // (`SELECT … FROM clinical_events WHERE integrity_status IS NOT NULL`)
    // can surface them. Hard enforcement still exists in
    //   - `build_events`'s debug_assert
    //   - the snippet_integrity::verify call surface
    // so dev/test builds catch drift loudly; production audits surface
    // it without dropping events.
    let integrity_status: Option<String> =
        match crate::snippet_integrity::verify(&ce, clean_text) {
            Ok(()) => None,
            Err(e) => Some(e.to_string()),
        };
    let assertion = ce.assertion_status.map(|a| a.as_str().to_string());
    let date_prec = ce.date_precision.map(|p| match p {
        crate::clinical_events::DatePrecision::Day => "day",
        crate::clinical_events::DatePrecision::Month => "month",
        crate::clinical_events::DatePrecision::Year => "year",
    });
    tx.execute(
        r#"INSERT INTO clinical_events
               (event_id, document_id, event_type, concept, raw_concept,
                assertion_status, source_section, source_snippet,
                char_offset_start, char_offset_end, date, date_precision,
                integrity_status, event_json)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
           ON CONFLICT(event_id) DO UPDATE SET
               document_id       = excluded.document_id,
               event_type        = excluded.event_type,
               concept           = excluded.concept,
               raw_concept       = excluded.raw_concept,
               assertion_status  = excluded.assertion_status,
               source_section    = excluded.source_section,
               source_snippet    = excluded.source_snippet,
               char_offset_start = excluded.char_offset_start,
               char_offset_end   = excluded.char_offset_end,
               date              = excluded.date,
               date_precision    = excluded.date_precision,
               integrity_status  = excluded.integrity_status,
               event_json        = excluded.event_json"#,
        params![
            ce.event_id,
            document_id,
            ce.event_type.as_str(),
            ce.concept,
            ce.raw_concept,
            assertion,
            ce.source_section,
            ce.source_snippet,
            ce.char_offset_start as i64,
            ce.char_offset_end as i64,
            ce.date,
            date_prec,
            integrity_status,
            ev_json.to_string(),
        ],
    )?;
    Ok(())
}

fn upsert_attribution(
    tx: &rusqlite::Transaction<'_>,
    a: &serde_json::Value,
) -> rusqlite::Result<()> {
    let event_id = a.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
    if event_id.is_empty() {
        return Ok(());
    }
    let participant_id = a.get("participant_id").and_then(|v| v.as_str());
    let organisation_id = a.get("organisation_id").and_then(|v| v.as_str());
    let patient_id = a.get("patient_id").and_then(|v| v.as_str());
    tx.execute(
        r#"INSERT INTO resolved_attributions
               (event_id, participant_id, organisation_id, patient_id)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(event_id) DO UPDATE SET
               participant_id  = excluded.participant_id,
               organisation_id = excluded.organisation_id,
               patient_id      = excluded.patient_id"#,
        params![event_id, participant_id, organisation_id, patient_id],
    )?;
    Ok(())
}

fn upsert_patient_identity(
    tx: &rusqlite::Transaction<'_>,
    p: &serde_json::Value,
) -> rusqlite::Result<()> {
    let id = p.get("patient_id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return Ok(());
    }
    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let dob = p.get("dob").and_then(|v| v.as_str());
    let confidence = p.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let source_docs = p.get("source_document_ids").cloned().unwrap_or(serde_json::json!([]));
    tx.execute(
        r#"INSERT INTO patient_identities
               (patient_id, name, dob, confidence, source_documents_json)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(patient_id) DO UPDATE SET
               name                  = excluded.name,
               dob                   = excluded.dob,
               confidence            = excluded.confidence,
               source_documents_json = excluded.source_documents_json"#,
        params![id, name, dob, confidence, source_docs.to_string()],
    )?;
    Ok(())
}

fn upsert_participant(
    tx: &rusqlite::Transaction<'_>,
    p: &serde_json::Value,
) -> rusqlite::Result<()> {
    let id = p.get("participant_id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return Ok(());
    }
    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let role = p.get("role").and_then(|v| v.as_str()).unwrap_or("unknown");
    let role_evidence = p.get("role_evidence").cloned().unwrap_or(serde_json::json!([]));
    let source_docs = p.get("source_document_ids").cloned().unwrap_or(serde_json::json!([]));
    let source_sections = p.get("source_sections").cloned().unwrap_or(serde_json::json!([]));
    tx.execute(
        r#"INSERT INTO participants
               (participant_id, name, role, role_evidence_json, source_documents_json, source_sections_json)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(participant_id) DO UPDATE SET
               name                  = excluded.name,
               role                  = excluded.role,
               role_evidence_json    = excluded.role_evidence_json,
               source_documents_json = excluded.source_documents_json,
               source_sections_json  = excluded.source_sections_json"#,
        params![
            id,
            name,
            role,
            role_evidence.to_string(),
            source_docs.to_string(),
            source_sections.to_string(),
        ],
    )?;
    Ok(())
}

fn upsert_organisation(
    tx: &rusqlite::Transaction<'_>,
    o: &serde_json::Value,
) -> rusqlite::Result<()> {
    let id = o.get("organisation_id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return Ok(());
    }
    let name = o.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let org_type = o.get("org_type").and_then(|v| v.as_str()).unwrap_or("unknown");
    let source_docs = o.get("source_document_ids").cloned().unwrap_or(serde_json::json!([]));
    tx.execute(
        r#"INSERT INTO organisations
               (organisation_id, name, org_type, source_documents_json)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(organisation_id) DO UPDATE SET
               name                  = excluded.name,
               org_type              = excluded.org_type,
               source_documents_json = excluded.source_documents_json"#,
        params![id, name, org_type, source_docs.to_string()],
    )?;
    Ok(())
}

fn upsert_document_participant_map(
    tx: &rusqlite::Transaction<'_>,
    m: &serde_json::Value,
) -> rusqlite::Result<()> {
    let doc_id = m.get("document_id").and_then(|v| v.as_str()).unwrap_or("");
    if doc_id.is_empty() {
        return Ok(());
    }
    let pats = m.get("patient_ids").cloned().unwrap_or(serde_json::json!([]));
    let parts = m.get("participant_ids").cloned().unwrap_or(serde_json::json!([]));
    let orgs = m.get("organisation_ids").cloned().unwrap_or(serde_json::json!([]));
    tx.execute(
        r#"INSERT INTO document_participant_maps
               (document_id, patient_ids_json, participant_ids_json, organisation_ids_json)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(document_id) DO UPDATE SET
               patient_ids_json      = excluded.patient_ids_json,
               participant_ids_json  = excluded.participant_ids_json,
               organisation_ids_json = excluded.organisation_ids_json"#,
        params![doc_id, pats.to_string(), parts.to_string(), orgs.to_string()],
    )?;
    Ok(())
}

fn delete_client_rows(
    tx: &rusqlite::Transaction<'_>,
    client_id: &str,
) -> rusqlite::Result<()> {
    // Child rows first to honour FK constraints. The persistence-
    // boundary tables (clinical_events, resolved_attributions,
    // document_participant_maps) reference `documents.id`, so they must
    // go before `documents`. patient_identities / participants /
    // organisations are per-record but not per-client today — kept
    // global to support cross-client reasoning — so they are not
    // touched by per-client deletes.
    tx.execute(
        "DELETE FROM resolved_attributions
          WHERE event_id IN (SELECT event_id FROM clinical_events
                              WHERE document_id IN (SELECT id FROM documents WHERE client_id = ?1))",
        params![client_id],
    )?;
    tx.execute(
        "DELETE FROM clinical_events
          WHERE document_id IN (SELECT id FROM documents WHERE client_id = ?1)",
        params![client_id],
    )?;
    tx.execute(
        "DELETE FROM document_participant_maps
          WHERE document_id IN (SELECT id FROM documents WHERE client_id = ?1)",
        params![client_id],
    )?;
    tx.execute(
        "DELETE FROM entities WHERE document_id IN (SELECT id FROM documents WHERE client_id = ?1)",
        params![client_id],
    )?;
    tx.execute(
        "DELETE FROM pirs_snapshots WHERE client_id = ?1",
        params![client_id],
    )?;
    tx.execute(
        "DELETE FROM documents WHERE client_id = ?1",
        params![client_id],
    )?;
    tx.execute("DELETE FROM clients WHERE id = ?1", params![client_id])?;
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
