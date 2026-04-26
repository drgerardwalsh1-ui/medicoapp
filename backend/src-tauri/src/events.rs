//! Event sourcing — domain event types (Step 3a foundation).
//!
//! `EventEnvelope` is the universal wrapper persisted to `events.db`.
//! Payloads are typed and serialise into the `payload_json` column.
//!
//! Foundation phase: only `DocumentUploaded` is wired. Additional payload
//! variants are reserved here so the enum is exhaustive once producers land.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Schema version for the event format. Bump on breaking payload changes.
pub const SCHEMA_VERSION: u32 = 1;

/// Who or what produced the event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Actor {
    User { id: String },
    System { component: String },
}

/// Discriminator stored in the `type` column. Kept in sync with `EventPayload`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    ClientCreated,
    DemographicsUpdated,
    DocumentUploaded,
    ClientRestoredFromVersion,
}

impl EventType {
    pub fn as_str(self) -> &'static str {
        match self {
            EventType::ClientCreated => "client_created",
            EventType::DemographicsUpdated => "demographics_updated",
            EventType::DocumentUploaded => "document_uploaded",
            EventType::ClientRestoredFromVersion => "client_restored_from_version",
        }
    }
}

/// Client creation payload (Step 4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientCreatedP {
    pub name: String,
    /// Free-form demographics JSON. Reducer treats as opaque.
    pub demographics: serde_json::Value,
}

/// Demographics replacement payload (Step 5). The reducer treats
/// `demographics` as opaque JSON and stores it wholesale on the projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemographicsUpdatedP {
    pub demographics: serde_json::Value,
}

/// Snapshot replay payload (Step 6 — Version History). Records that a
/// historical snapshot at `from_version` was promoted forward as a brand
/// new event. Past events are never modified — this is purely additive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientRestoredFromVersionP {
    pub from_version: u64,
    pub name: String,
    pub demographics: serde_json::Value,
}

/// Document upload payload — Step 3a.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentUploadedP {
    pub document_id: String,
    pub file_name: String,
    pub char_count: usize,
    pub method: String,
}

/// Strongly-typed payload variants. Serialised into `payload_json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum EventPayload {
    ClientCreated(ClientCreatedP),
    DemographicsUpdated(DemographicsUpdatedP),
    DocumentUploaded(DocumentUploadedP),
    ClientRestoredFromVersion(ClientRestoredFromVersionP),
}

impl EventPayload {
    pub fn event_type(&self) -> EventType {
        match self {
            EventPayload::ClientCreated(_) => EventType::ClientCreated,
            EventPayload::DemographicsUpdated(_) => EventType::DemographicsUpdated,
            EventPayload::DocumentUploaded(_) => EventType::DocumentUploaded,
            EventPayload::ClientRestoredFromVersion(_) => EventType::ClientRestoredFromVersion,
        }
    }
}

/// Envelope persisted to `events.db`. Append-only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub id: Uuid,
    pub client_id: String,
    pub event_type: EventType,
    pub timestamp: DateTime<Utc>,
    pub version: u64,
    pub schema_version: u32,
    pub actor: Actor,
    pub causation_id: Option<Uuid>,
    pub correlation_id: Option<Uuid>,
    pub payload: EventPayload,
}

impl EventEnvelope {
    /// Construct a new envelope with a freshly-minted UUIDv7 (sortable).
    /// `version` is the next monotonic version for the given client.
    pub fn new(
        client_id: String,
        version: u64,
        actor: Actor,
        payload: EventPayload,
        correlation_id: Option<Uuid>,
        causation_id: Option<Uuid>,
    ) -> Self {
        Self {
            id: Uuid::now_v7(),
            client_id,
            event_type: payload.event_type(),
            timestamp: Utc::now(),
            version,
            schema_version: SCHEMA_VERSION,
            actor,
            causation_id,
            correlation_id,
            payload,
        }
    }
}
