//! Pure deterministic reducer (Step 3b, hardened in Step 3c).
//!
//! `reduce(events)` folds an in-order slice of events for one or more
//! clients into a `ClientState`. No I/O, no clock, no RNG, **no sorting**.
//! Ordering is the caller's responsibility — `replay::validate_event_stream`
//! enforces it before this function runs.
//!
//! Step 3b/3c only handle `DocumentUploaded`. Additional variants land later.

use chrono::{DateTime, Utc};

use crate::events::{EventEnvelope, EventPayload};


#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DocumentState {
    pub document_id: String,
    pub file_name: String,
    pub char_count: usize,
    pub method: String,
    pub uploaded_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct ClientState {
    pub client_id: String,
    pub last_version: u64,
    /// Timestamp of the first event seen for this client. Used so rebuilds
    /// produce a deterministic `created_at` on the projection.
    pub first_seen: Option<DateTime<Utc>>,
    pub last_updated: Option<DateTime<Utc>>,
    /// Demographics JSON, opaque to the reducer.
    pub demographics: Option<serde_json::Value>,
    pub documents: Vec<DocumentState>,
}

/// Pure, strict in-order fold. **Does not sort.** If `events` mixes clients
/// or arrives out of version order, the result is undefined — callers must
/// run `replay::validate_event_stream` first.
pub fn reduce(events: &[EventEnvelope]) -> ClientState {
    let mut state = ClientState::default();
    for env in events {
        state.client_id = env.client_id.clone();
        state.last_version = env.version;
        if state.first_seen.is_none() {
            state.first_seen = Some(env.timestamp);
        }
        state.last_updated = Some(env.timestamp);
        match &env.payload {
            EventPayload::ClientCreated(p) => {
                state.demographics = Some(p.demographics.clone());
            }
            EventPayload::ClientRestoredFromVersion(p) => {
                state.demographics = Some(p.demographics.clone());
            }
            EventPayload::DemographicsUpdated(p) => {
                state.demographics = Some(p.demographics.clone());
            }
            EventPayload::DocumentUploaded(p) => {
                if let Some(existing) = state
                    .documents
                    .iter_mut()
                    .find(|d| d.document_id == p.document_id)
                {
                    existing.file_name = p.file_name.clone();
                    existing.char_count = p.char_count;
                    existing.method = p.method.clone();
                    existing.uploaded_at = env.timestamp;
                } else {
                    state.documents.push(DocumentState {
                        document_id: p.document_id.clone(),
                        file_name: p.file_name.clone(),
                        char_count: p.char_count,
                        method: p.method.clone(),
                        uploaded_at: env.timestamp,
                    });
                }
            }
        }
    }
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{Actor, DocumentUploadedP, EventEnvelope, EventPayload};

    fn evt(client: &str, version: u64, doc_id: &str) -> EventEnvelope {
        EventEnvelope::new(
            client.to_string(),
            version,
            Actor::System { component: "test".into() },
            EventPayload::DocumentUploaded(DocumentUploadedP {
                document_id: doc_id.into(),
                file_name: format!("{doc_id}.txt"),
                char_count: 10,
                method: "test".into(),
            }),
            None,
            None,
        )
    }

    #[test]
    fn reduce_strict_in_order() {
        let s = reduce(&[evt("c1", 1, "d1"), evt("c1", 2, "d2"), evt("c1", 3, "d3")]);
        assert_eq!(s.client_id, "c1");
        assert_eq!(s.last_version, 3);
        assert_eq!(s.documents.len(), 3);
        assert_eq!(s.documents[0].document_id, "d1");
        assert_eq!(s.documents[2].document_id, "d3");
    }

    #[test]
    fn reduce_dedupes_same_document_id() {
        let s = reduce(&[evt("c1", 1, "d1"), evt("c1", 2, "d1")]);
        assert_eq!(s.documents.len(), 1);
        assert_eq!(s.last_version, 2);
    }
}
