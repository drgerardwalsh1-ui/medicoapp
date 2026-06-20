//! Event sourcing — domain event types (Step 3a foundation).
//!
//! `EventEnvelope` is the universal wrapper persisted to `events.db`.
//! Payloads are typed and serialise into the `payload_json` column.
//!
//! Foundation phase: only `DocumentUploaded` is wired. Additional payload
//! variants are reserved here so the enum is exhaustive once producers land.
//!
//! ─── CROSS-LAYER IDENTITY CONTRACT (document_id) ──────────────────────────
//! `document_id` is globally stable and IDENTICAL across every layer:
//!   - `projection.documents.id`          (primary key of the read model)
//!   - `DocumentSummary.id`               (get_client_view → frontend)
//!   - event payload `document_id`        (DocumentExtractedP,
//!                                          ClinicalEventsRecordedP,
//!                                          DocumentDeletedP)
//!   - `clinical_events.document_id`       (FK → documents.id)
//!   - frontend `IngestedDoc.documentId`   (the ONLY operational identifier)
//!
//! It is minted once at upload (UUIDv7) and never re-assigned. Any
//! document operation (notably deletion) keys strictly off `document_id`;
//! the frontend `path` field is display/filesystem only and must never be
//! used for identity (see `IngestedDoc` doc comment).

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
    ClientDeleted,
    // ── Persistence-boundary event types (medico-legal audit) ──
    /// Document text + chain-of-custody anchor (sha256 + pipeline
    /// version + rule-corpus hash). The raw_text retained here is the
    /// definitive forensic-replay source.
    DocumentExtracted,
    /// Boundary-layer ClinicalEvents derived from the cleaned text of a
    /// single document. Persisted verbatim — every higher reasoning
    /// layer is a deterministic projection of this list plus the
    /// attribution payload.
    ClinicalEventsRecorded,
    /// Resolved participant + organisation + patient attribution for a
    /// run. Keyed by `event_id` so each ClinicalEvent can be looked up
    /// to its source clinician.
    AttributionRecorded,
    /// Metadata for a single extraction run (pipeline_version,
    /// rule_corpus_hash, run_id, document set). Lets future audits
    /// reproduce historical extractions even after the rule set has
    /// evolved.
    ExtractionRunRecorded,
    /// Tombstone: a single document was deleted. Mirrors `ClientDeleted`
    /// one level down — the projection hard-deletes the document + all
    /// derived rows, while this event (and the original
    /// DocumentExtracted/ClinicalEventsRecorded) remain in the immutable
    /// log for audit. Honoured by `rebuild_from_events` so deleted
    /// documents never reappear.
    DocumentDeleted,
    // ── Canonical clinical fact spine (Phase 1) ──
    /// One interview Observation appended to the client's clinical fact
    /// log. The payload is the frontend `Observation` JSON, opaque to the
    /// reducer. Append-only versioning matches the frontend doctrine: an
    /// edit appends a NEW event carrying the same observation id; the
    /// current view is the latest entry per id. Tombstoning is likewise
    /// an append (observation JSON with `tombstoned: true`).
    ClinicalObservationRecorded,
    /// One review-surface item appended to the client's clinical state:
    /// criterion attestation, conflict resolution, episode boundary
    /// correction, diagnostic conclusion, or report snapshot. `kind`
    /// discriminates; the item JSON is opaque to the reducer.
    ClinicalReviewRecorded,
}

impl EventType {
    pub fn as_str(self) -> &'static str {
        match self {
            EventType::ClientCreated => "client_created",
            EventType::DemographicsUpdated => "demographics_updated",
            EventType::DocumentUploaded => "document_uploaded",
            EventType::ClientRestoredFromVersion => "client_restored_from_version",
            EventType::ClientDeleted => "client_deleted",
            EventType::DocumentExtracted => "document_extracted",
            EventType::ClinicalEventsRecorded => "clinical_events_recorded",
            EventType::AttributionRecorded => "attribution_recorded",
            EventType::ExtractionRunRecorded => "extraction_run_recorded",
            EventType::DocumentDeleted => "document_deleted",
            EventType::ClinicalObservationRecorded => "clinical_observation_recorded",
            EventType::ClinicalReviewRecorded => "clinical_review_recorded",
        }
    }
}

/// Client creation payload (Step 4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientCreatedP {
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
    pub demographics: serde_json::Value,
}

/// Client deletion payload. Marks a client as deleted; projection
/// removes the row (and child rows) so it no longer appears in
/// `list_clients`. Events for the client are retained for audit.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClientDeletedP {
    /// Optional reason supplied by the caller. Opaque to the reducer.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Document upload payload — Step 3a.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentUploadedP {
    pub document_id: String,
    pub file_name: String,
    pub char_count: usize,
    pub method: String,
}

// ── Persistence-boundary payloads ────────────────────────────────────────

/// Document text + chain-of-custody anchor. Emitted by
/// `process_and_persist_document` once OCR/parse has produced raw_text
/// and the rule pipeline has produced clean_text.
///
/// ## Freeze-point contract
///
/// Once this event is appended, `clean_text` becomes IMMUTABLE — it is
/// the canonical representation against which every
/// `ClinicalEvent.source_snippet` is byte-equal. Downstream consumers
/// MUST NOT re-normalise, re-trim, or otherwise mutate `clean_text` if
/// they want offsets to remain valid. The append-only triggers on
/// `events.db` enforce this at the storage layer; the `clean_text_sha256`
/// field exposes a checksum so any caller can reverify the freeze.
///
/// ## Verification model (medico-legal audit)
///
/// The integrity guarantee is **normalised-text fidelity**, not raw-byte
/// fidelity. Concretely:
///   - `source_bytes_sha256` anchors the chain of custody to the original
///     on-disk bytes (PDF/DOCX). It does NOT participate in snippet
///     verification — its role is "this exact file produced this exact
///     raw_text".
///   - `raw_text` is the post-OCR / post-DOCX text. Retained so a future
///     auditor with a different OCR engine can detect drift, and so
///     `text_clean(raw_text, pipeline_version)` can be re-derived and
///     compared against `clean_text_sha256`.
///   - `clean_text` is the post `text_clean` normalisation form. It is
///     the integrity canonical: every `ClinicalEvent.source_snippet` is
///     verified against `clean_text[char_offset_start..char_offset_end]`.
///   - `clean_text_sha256` lets any verifier (audit script, projection
///     rebuild, future replay) confirm the freeze-point form has not
///     drifted without re-shipping the full text.
///
/// `pipeline_version` + `rule_corpus_hash` pin the deterministic rule
/// set used for this extraction, so re-deriving `clean_text` from
/// `raw_text` under the same pinned versions must reproduce the same
/// `clean_text_sha256`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentExtractedP {
    pub document_id: String,
    /// Original uploaded filename (e.g. "FakeClient2.pdf"). Carried from
    /// ingestion so the projection persists it as the document's display
    /// name. `Option` + `serde(default)` keeps backward compatibility:
    /// events written before this field existed deserialise to `None`.
    #[serde(default)]
    pub file_name: Option<String>,
    pub source_bytes_sha256: String,
    pub raw_text: String,
    pub clean_text: String,
    /// SHA-256 of `clean_text` as bytes. Freeze-point digest — exposes
    /// the canonical form's hash so callers can verify the freeze
    /// without re-shipping the full text.
    #[serde(default)]
    pub clean_text_sha256: String,
    pub method: String,
    #[serde(default)]
    pub ocr_engine_version: Option<String>,
    pub pipeline_version: String,
    pub rule_corpus_hash: String,
}

/// Boundary-layer ClinicalEvents for a single document. The events are
/// stored verbatim — they are the lowest-complete-truth layer per the
/// persistence-boundary specification. Higher layers (UnifiedEvent,
/// PatientEvent, CanonicalPatientEvent, EvolutionTrack, ConditionState,
/// ClinicalKnowledgeGraph) MUST be derived from this list and remain
/// in-memory only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalEventsRecordedP {
    pub document_id: String,
    pub run_id: Uuid,
    pub clinical_events: Vec<serde_json::Value>,
}

/// Resolved attribution for a run (one or more documents jointly resolved
/// for participants, organisations, and the patient identity).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributionRecordedP {
    pub run_id: Uuid,
    /// JSON-serialised `ParticipantResolutionPayload` from the
    /// `participant_resolution` module. Carries:
    ///   - patients
    ///   - participants
    ///   - organisations
    ///   - document_maps (DocumentParticipantMap[])
    ///   - attributions (ResolvedEventAttribution[] keyed by event_id)
    pub payload: serde_json::Value,
}

/// Metadata for one extraction run. Pinning these stamps with the run
/// lets a future audit replay the deterministic pipeline against the
/// retained raw_text and validate that today's rule set would produce
/// the same boundary state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionRunRecordedP {
    pub run_id: Uuid,
    pub executed_at: DateTime<Utc>,
    pub pipeline_version: String,
    pub rule_corpus_hash: String,
    pub document_ids: Vec<String>,
    pub clinical_event_count: usize,
    pub attribution_count: usize,
}

/// Document deletion tombstone payload. The projection hard-deletes the
/// document and every derived row keyed by `document_id`. The event is
/// retained in the append-only log for audit (mirrors `ClientDeletedP`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentDeletedP {
    pub document_id: String,
    /// Optional free-form reason, opaque to the reducer/projection.
    #[serde(default)]
    pub reason: Option<String>,
}

/// One clinical Observation (interview fact) appended to the client's
/// fact log. `observation` is the frontend `Observation` shape, opaque
/// here — the canonical fold is `clinical_fact_store::fold_clinical_state`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalObservationRecordedP {
    pub observation: serde_json::Value,
}

/// One review-surface item (attestation / resolution / correction /
/// conclusion / snapshot) appended to the client's clinical state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalReviewRecordedP {
    /// One of `clinical_fact_store::REVIEW_KINDS`. Validated at the
    /// command boundary; the fold routes unknown kinds nowhere (fail
    /// closed) so a corrupt event can never pollute a surface.
    pub kind: String,
    pub item: serde_json::Value,
}

/// Strongly-typed payload variants. Serialised into `payload_json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum EventPayload {
    ClientCreated(ClientCreatedP),
    DemographicsUpdated(DemographicsUpdatedP),
    DocumentUploaded(DocumentUploadedP),
    ClientRestoredFromVersion(ClientRestoredFromVersionP),
    ClientDeleted(ClientDeletedP),
    DocumentExtracted(DocumentExtractedP),
    ClinicalEventsRecorded(ClinicalEventsRecordedP),
    AttributionRecorded(AttributionRecordedP),
    ExtractionRunRecorded(ExtractionRunRecordedP),
    DocumentDeleted(DocumentDeletedP),
    ClinicalObservationRecorded(ClinicalObservationRecordedP),
    ClinicalReviewRecorded(ClinicalReviewRecordedP),
}

impl EventPayload {
    pub fn event_type(&self) -> EventType {
        match self {
            EventPayload::ClientCreated(_) => EventType::ClientCreated,
            EventPayload::DemographicsUpdated(_) => EventType::DemographicsUpdated,
            EventPayload::DocumentUploaded(_) => EventType::DocumentUploaded,
            EventPayload::ClientRestoredFromVersion(_) => EventType::ClientRestoredFromVersion,
            EventPayload::ClientDeleted(_) => EventType::ClientDeleted,
            EventPayload::DocumentExtracted(_) => EventType::DocumentExtracted,
            EventPayload::ClinicalEventsRecorded(_) => EventType::ClinicalEventsRecorded,
            EventPayload::AttributionRecorded(_) => EventType::AttributionRecorded,
            EventPayload::ExtractionRunRecorded(_) => EventType::ExtractionRunRecorded,
            EventPayload::DocumentDeleted(_) => EventType::DocumentDeleted,
            EventPayload::ClinicalObservationRecorded(_) => {
                EventType::ClinicalObservationRecorded
            }
            EventPayload::ClinicalReviewRecorded(_) => EventType::ClinicalReviewRecorded,
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
