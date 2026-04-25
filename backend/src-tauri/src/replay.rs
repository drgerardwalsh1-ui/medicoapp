//! Replay engine + stream validator (Step 3c — integrity layer).
//!
//! `replay_events` is the canonical reconstruction path: pure, deterministic,
//! no sorting, no repair. Identical to the production reducer fold, but
//! operates per-client so a multi-client slice produces a map of states.
//!
//! `validate_event_stream` enforces the medico-legal ordering invariants:
//! per-client versions must form a contiguous, strictly increasing-by-one
//! sequence. Any violation is a hard error — never repaired silently.

use std::collections::BTreeMap;

use crate::events::EventEnvelope;
use crate::reducer::{reduce, ClientState};

#[derive(Debug, Clone)]
pub enum ValidationError {
    /// Two events share `(client_id, version)`.
    DuplicateVersion { client_id: String, version: u64 },
    /// Version did not increment by exactly +1 from the previous event for this client.
    NonContiguousVersion {
        client_id: String,
        previous: u64,
        observed: u64,
    },
    /// First event for a client did not start at version 1.
    BadStartVersion { client_id: String, observed: u64 },
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ValidationError::DuplicateVersion { client_id, version } => write!(
                f,
                "duplicate version {version} for client {client_id}"
            ),
            ValidationError::NonContiguousVersion {
                client_id,
                previous,
                observed,
            } => write!(
                f,
                "non-contiguous version for client {client_id}: previous={previous}, observed={observed} (expected {})",
                previous + 1
            ),
            ValidationError::BadStartVersion { client_id, observed } => write!(
                f,
                "client {client_id} starts at version {observed}, expected 1"
            ),
        }
    }
}

impl std::error::Error for ValidationError {}

/// Verify per-client version sequences are contiguous and start at 1.
/// Mixed-client input is fine; events for each client are checked in the
/// order they appear in the slice (which must match version order).
pub fn validate_event_stream(events: &[EventEnvelope]) -> Result<(), ValidationError> {
    let mut last_seen: BTreeMap<&str, u64> = BTreeMap::new();
    for env in events {
        let cid = env.client_id.as_str();
        match last_seen.get(cid).copied() {
            None => {
                if env.version != 1 {
                    return Err(ValidationError::BadStartVersion {
                        client_id: env.client_id.clone(),
                        observed: env.version,
                    });
                }
            }
            Some(prev) => {
                if env.version == prev {
                    return Err(ValidationError::DuplicateVersion {
                        client_id: env.client_id.clone(),
                        version: env.version,
                    });
                }
                if env.version != prev + 1 {
                    return Err(ValidationError::NonContiguousVersion {
                        client_id: env.client_id.clone(),
                        previous: prev,
                        observed: env.version,
                    });
                }
            }
        }
        last_seen.insert(cid, env.version);
    }
    Ok(())
}

/// Group events by `client_id` (preserving per-client input order) and
/// fold each group through the pure reducer. **Does not sort.** Caller
/// must `validate_event_stream` first.
pub fn replay_events(events: &[EventEnvelope]) -> BTreeMap<String, ClientState> {
    let mut by_client: BTreeMap<String, Vec<EventEnvelope>> = BTreeMap::new();
    for env in events {
        by_client
            .entry(env.client_id.clone())
            .or_default()
            .push(env.clone());
    }

    let mut out = BTreeMap::new();
    for (cid, group) in by_client {
        out.insert(cid, reduce(&group));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{Actor, DocumentUploadedP, EventEnvelope, EventPayload};

    fn evt(client: &str, version: u64, doc_id: &str) -> EventEnvelope {
        EventEnvelope::new(
            client.into(),
            version,
            Actor::System { component: "test".into() },
            EventPayload::DocumentUploaded(DocumentUploadedP {
                document_id: doc_id.into(),
                file_name: format!("{doc_id}.txt"),
                char_count: 1,
                method: "test".into(),
            }),
            None,
            None,
        )
    }

    #[test]
    fn validate_accepts_contiguous() {
        validate_event_stream(&[evt("c1", 1, "d1"), evt("c1", 2, "d2")]).unwrap();
    }

    #[test]
    fn validate_rejects_gap() {
        let err =
            validate_event_stream(&[evt("c1", 1, "d1"), evt("c1", 3, "d3")]).unwrap_err();
        matches!(err, ValidationError::NonContiguousVersion { .. });
    }

    #[test]
    fn validate_rejects_duplicate() {
        let err =
            validate_event_stream(&[evt("c1", 1, "d1"), evt("c1", 1, "d1b")]).unwrap_err();
        matches!(err, ValidationError::DuplicateVersion { .. });
    }

    #[test]
    fn validate_rejects_bad_start() {
        let err = validate_event_stream(&[evt("c1", 2, "d1")]).unwrap_err();
        matches!(err, ValidationError::BadStartVersion { .. });
    }
}

// ── Step 3c integration test: ingest → replay → projection equivalence ───────
//
// 1 client, 3 documents. Append to a temp events.db, project incrementally
// into a temp projection.db, then rebuild from scratch and assert the
// canonical snapshot is byte-identical.

#[cfg(test)]
mod integration {
    use super::*;
    use crate::event_store::EventStore;
    use crate::events::{Actor, DocumentUploadedP, EventEnvelope, EventPayload};
    use crate::projection::Projection;
    use std::path::PathBuf;

    fn temp_path(suffix: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let nonce = uuid::Uuid::now_v7();
        p.push(format!("medicoapp-step3c-{nonce}-{suffix}"));
        p
    }

    fn make_event(client: &str, version: u64, doc_id: &str) -> EventEnvelope {
        EventEnvelope::new(
            client.into(),
            version,
            Actor::System { component: "integration_test".into() },
            EventPayload::DocumentUploaded(DocumentUploadedP {
                document_id: doc_id.into(),
                file_name: format!("{doc_id}.pdf"),
                char_count: 100 + version as usize,
                method: "text".into(),
            }),
            None,
            None,
        )
    }

    #[test]
    fn replay_matches_projection() {
        let events_path = temp_path("events.db");
        let projection_path = temp_path("projection.db");

        let store = EventStore::init(&events_path).expect("events init");
        let proj = Projection::init(&projection_path).expect("projection init");

        // Ingest 3 documents for 1 client. Use deterministic timestamps via
        // the envelope timestamp field for reproducibility — the envelope
        // factory stamps Utc::now(), so we just append in order.
        let client = "client-001";
        let evs: Vec<_> = (1..=3)
            .map(|v| make_event(client, v, &format!("doc-{v}")))
            .collect();

        for env in &evs {
            store.append_event(env).expect("append");
            // Incremental projection mirrors production path.
            proj.project_forward(std::slice::from_ref(env)).expect("project");
        }

        // Validation must pass.
        validate_event_stream(&evs).expect("validate");

        // Snapshot the incrementally-built projection.
        let incremental = proj.snapshot_canonical().expect("snapshot before");

        // Rebuild from scratch using all events from the store.
        let all = store.get_all_events().expect("get_all");
        proj.rebuild_from_events(&all).expect("rebuild");
        let rebuilt = proj.snapshot_canonical().expect("snapshot after");

        assert_eq!(
            incremental, rebuilt,
            "projection rebuild must be byte-identical to incremental"
        );

        // Replay through the pure engine should agree with projection content.
        let replayed = replay_events(&all);
        let state = replayed.get(client).expect("client state");
        assert_eq!(state.last_version, 3);
        assert_eq!(state.documents.len(), 3);
        for (i, d) in state.documents.iter().enumerate() {
            assert_eq!(d.document_id, format!("doc-{}", i + 1));
        }

        // Drift detector should report clean.
        proj.check_integrity(&all).expect("no drift");

        // Cleanup
        let _ = std::fs::remove_file(&events_path);
        let _ = std::fs::remove_file(&projection_path);
        // WAL/SHM siblings
        let _ = std::fs::remove_file(format!("{}-wal", events_path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", events_path.display()));
        let _ = std::fs::remove_file(format!("{}-wal", projection_path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", projection_path.display()));
    }

    #[test]
    fn validation_rejects_corrupted_stream() {
        let evs = vec![
            make_event("c1", 1, "d1"),
            make_event("c1", 3, "d3"), // gap
        ];
        assert!(validate_event_stream(&evs).is_err());
    }

    // ── Step 4G ─────────────────────────────────────────────────────────────
    // create client → project → read view → rebuild → byte-identical.
    #[test]
    fn step4_create_client_projects_and_rebuilds() {
        let events_path = temp_path("events.db");
        let projection_path = temp_path("projection.db");

        let store = EventStore::init(&events_path).expect("events init");
        let proj = Projection::init(&projection_path).expect("projection init");

        let client_id = uuid::Uuid::now_v7().to_string();
        let version = store.next_version(&client_id).expect("next_version");
        assert_eq!(version, 1);

        let demographics = serde_json::json!({
            "forename": "Jane",
            "surname": "Doe",
            "dob": "1980-04-01"
        });

        let env = EventEnvelope::new(
            client_id.clone(),
            version,
            Actor::System { component: "create_client".into() },
            EventPayload::ClientCreated(crate::events::ClientCreatedP {
                name: "Jane Doe".into(),
                demographics: demographics.clone(),
            }),
            None,
            None,
        );

        store.append_event(&env).expect("append");
        proj.project_forward(std::slice::from_ref(&env))
            .expect("project_forward");

        // Read the projection view.
        let view = proj
            .get_client_view(&client_id)
            .expect("read view")
            .expect("client present");
        assert_eq!(view.id, client_id);
        assert_eq!(view.last_version, 1);
        assert_eq!(view.name.as_deref(), Some("Jane Doe"));
        assert_eq!(view.demographics, Some(demographics));
        assert_eq!(view.document_count, 0);

        // Rebuild equivalence (mirrors rebuild_projection_and_verify).
        let before = proj.snapshot_canonical().expect("before");
        let all = store.get_all_events().expect("get_all");
        validate_event_stream(&all).expect("validate");
        proj.rebuild_from_events(&all).expect("rebuild");
        let after = proj.snapshot_canonical().expect("after");
        assert_eq!(before, after, "rebuild must be byte-identical");
        proj.check_integrity(&all).expect("no drift");

        // Cleanup
        let _ = std::fs::remove_file(&events_path);
        let _ = std::fs::remove_file(&projection_path);
        let _ = std::fs::remove_file(format!("{}-wal", events_path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", events_path.display()));
        let _ = std::fs::remove_file(format!("{}-wal", projection_path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", projection_path.display()));
    }
}
