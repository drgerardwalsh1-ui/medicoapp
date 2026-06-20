//! Append-only event store backed by SQLite (`events.db`).
//!
//! Step 3a foundation. Provides:
//!   - `init(path)` — create schema, WAL mode, immutability triggers
//!   - `append_event(env)` — atomic append with per-client monotonic version
//!   - `get_events(client_id)` — replay one client's history (version asc)
//!   - `get_all_events()` — replay everything (timestamp asc)
//!
//! Immutability is enforced at the DB level: triggers raise on UPDATE/DELETE.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::events::{EventEnvelope, EventPayload, EventType};

/// Process-wide handle. Wrapped in `Mutex` because rusqlite `Connection`
/// is not `Sync`. Acceptable for the Step 3a foundation; revisit when
/// throughput matters.
pub struct EventStore {
    conn: Mutex<Connection>,
}

impl EventStore {
    /// Open or create the events DB at `path`, install schema + triggers,
    /// enable WAL with `synchronous=FULL`.
    pub fn init(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS events (
                id              TEXT PRIMARY KEY,
                client_id       TEXT NOT NULL,
                type            TEXT NOT NULL,
                timestamp       TEXT NOT NULL,
                version         INTEGER NOT NULL,
                schema_version  INTEGER NOT NULL,
                actor_json      TEXT NOT NULL,
                causation_id    TEXT,
                correlation_id  TEXT,
                payload_json    TEXT NOT NULL,
                UNIQUE (client_id, version)
            );

            CREATE INDEX IF NOT EXISTS idx_events_client_version
                ON events (client_id, version);
            CREATE INDEX IF NOT EXISTS idx_events_timestamp
                ON events (timestamp);

            CREATE TRIGGER IF NOT EXISTS events_no_update
            BEFORE UPDATE ON events
            BEGIN
                SELECT RAISE(ABORT, 'events table is append-only — UPDATE forbidden');
            END;

            CREATE TRIGGER IF NOT EXISTS events_no_delete
            BEFORE DELETE ON events
            BEGIN
                SELECT RAISE(ABORT, 'events table is append-only — DELETE forbidden');
            END;
            "#,
        )?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Next monotonic version for a client (returns 1 for the first event).
    pub fn next_version(&self, client_id: &str) -> rusqlite::Result<u64> {
        let conn = self.conn.lock().expect("event store poisoned");
        let max: Option<i64> = conn
            .query_row(
                "SELECT MAX(version) FROM events WHERE client_id = ?1",
                params![client_id],
                |row| row.get(0),
            )
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        Ok(max.map(|v| v as u64).unwrap_or(0) + 1)
    }

    /// Append a single event. Fails if `(client_id, version)` already exists.
    pub fn append_event(&self, env: &EventEnvelope) -> rusqlite::Result<()> {
        let actor_json = serde_json::to_string(&env.actor)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let payload_json = serde_json::to_string(&env.payload)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let conn = self.conn.lock().expect("event store poisoned");
        conn.execute(
            r#"INSERT INTO events
               (id, client_id, type, timestamp, version, schema_version,
                actor_json, causation_id, correlation_id, payload_json)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
            params![
                env.id.to_string(),
                env.client_id,
                env.event_type.as_str(),
                env.timestamp.to_rfc3339(),
                env.version as i64,
                env.schema_version as i64,
                actor_json,
                env.causation_id.map(|u| u.to_string()),
                env.correlation_id.map(|u| u.to_string()),
                payload_json,
            ],
        )?;
        Ok(())
    }

    pub fn get_events(&self, client_id: &str) -> rusqlite::Result<Vec<EventEnvelope>> {
        let conn = self.conn.lock().expect("event store poisoned");
        let mut stmt = conn.prepare(
            r#"SELECT id, client_id, type, timestamp, version, schema_version,
                       actor_json, causation_id, correlation_id, payload_json
                 FROM events
                WHERE client_id = ?1
                ORDER BY version ASC"#,
        )?;
        let rows = stmt.query_map(params![client_id], row_to_envelope)?;
        rows.collect()
    }

    pub fn get_all_events(&self) -> rusqlite::Result<Vec<EventEnvelope>> {
        let conn = self.conn.lock().expect("event store poisoned");
        let mut stmt = conn.prepare(
            r#"SELECT id, client_id, type, timestamp, version, schema_version,
                       actor_json, causation_id, correlation_id, payload_json
                 FROM events
                ORDER BY timestamp ASC, version ASC"#,
        )?;
        let rows = stmt.query_map([], row_to_envelope)?;
        rows.collect()
    }
}

fn row_to_envelope(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventEnvelope> {
    let id: String = row.get(0)?;
    let client_id: String = row.get(1)?;
    let _type_str: String = row.get(2)?; // discriminator; payload tag is authoritative
    let timestamp: String = row.get(3)?;
    let version: i64 = row.get(4)?;
    let schema_version: i64 = row.get(5)?;
    let actor_json: String = row.get(6)?;
    let causation_id: Option<String> = row.get(7)?;
    let correlation_id: Option<String> = row.get(8)?;
    let payload_json: String = row.get(9)?;

    let parse_err = |e: serde_json::Error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    };
    let uuid_err = |e: uuid::Error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    };
    let chrono_err = |e: chrono::ParseError| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    };

    let payload: EventPayload = serde_json::from_str(&payload_json).map_err(parse_err)?;
    let actor = serde_json::from_str(&actor_json).map_err(parse_err)?;
    let id = uuid::Uuid::parse_str(&id).map_err(uuid_err)?;
    let causation_id = causation_id
        .map(|s| uuid::Uuid::parse_str(&s))
        .transpose()
        .map_err(uuid_err)?;
    let correlation_id = correlation_id
        .map(|s| uuid::Uuid::parse_str(&s))
        .transpose()
        .map_err(uuid_err)?;
    let timestamp = chrono::DateTime::parse_from_rfc3339(&timestamp)
        .map_err(chrono_err)?
        .with_timezone(&chrono::Utc);
    let event_type: EventType = payload.event_type();

    Ok(EventEnvelope {
        id,
        client_id,
        event_type,
        timestamp,
        version: version as u64,
        schema_version: schema_version as u32,
        actor,
        causation_id,
        correlation_id,
        payload,
    })
}

/// Default on-disk path for the events DB. Resolves under the OS data dir
/// (or the current dir as a fallback) so dev runs don't need Tauri context.
pub fn default_events_db_path() -> PathBuf {
    base_dir().join("events.db")
}

pub fn default_projection_db_path() -> PathBuf {
    base_dir().join("projection.db")
}

/// Standalone append-only store for Phase 7 clinician decisions + snapshots.
/// Opaque JSON-lines; not part of the event-sourced engine schema.
pub fn default_clinical_decisions_path() -> PathBuf {
    base_dir().join("clinical_decisions.jsonl")
}

fn base_dir() -> PathBuf {
    // Test isolation: `cargo test` must never touch the production store.
    // Without this, every unit test that initialises the event store or
    // calls a command appends fixture events (client_id = doc_id) to the
    // REAL ~/.medicoapp databases — phantom clients then surface in the UI.
    #[cfg(test)]
    {
        static TEST_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
        return TEST_DIR
            .get_or_init(|| {
                let dir = std::env::temp_dir()
                    .join(format!("medicoapp_test_{}", std::process::id()));
                let _ = std::fs::create_dir_all(&dir);
                dir
            })
            .clone();
    }
    #[cfg(not(test))]
    {
        if let Some(dir) = std::env::var_os("MEDICOAPP_DATA_DIR").map(PathBuf::from) {
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
        if let Some(home) = dirs_home() {
            let dir = home.join(".medicoapp");
            let _ = std::fs::create_dir_all(&dir);
            dir
        } else {
            PathBuf::from(".")
        }
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}
