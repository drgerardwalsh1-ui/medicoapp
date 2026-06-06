//! Event Contract Registry — declarative semantics for every `EventType`.
//!
//! ─── WHAT THIS IS ────────────────────────────────────────────────────────
//! CONTRACT DISCLOSURE ONLY. This module contains **no execution logic, no
//! validation, and no runtime behaviour**. It is a single, centralised,
//! human- and reviewer-facing description of what each event *means* for
//! identity, projection, replay ordering, and cascade responsibility.
//!
//! A reviewer can determine an event's structural behaviour from this file
//! alone, WITHOUT reading `projection.rs` or `lib.rs`.
//!
//! ─── DRIFT GUARD (compile-time) ──────────────────────────────────────────
//! `contract_for` is an EXHAUSTIVE `match` over `EventType`. Adding a new
//! `EventType` variant without declaring its contract here is a COMPILE
//! ERROR — that is the guard against silent event drift. Every new event
//! MUST be registered here (this is the PR review checklist, enforced by
//! the compiler).
//!
//! ─── REPLAY-ORDERING INVARIANT (read-only declaration) ───────────────────
//! All `DocumentScoped` events MUST define deterministic replay ordering
//! within a client group. `DocumentDeleted` in particular DOMINATES all
//! prior `DocumentScoped` events in replay (it has the highest version for
//! its document), which is what makes the projection cascade + rebuild
//! tombstone-sweep correct. See `projection.rs::apply_boundary_events` and
//! `rebuild_from_events` for the enforcement sites; this registry only
//! *declares* the expectation.

use crate::events::EventType;

/// The identity an event is scoped to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityScope {
    /// Keyed by `client_id` (clients table + demographics blob).
    ClientScoped,
    /// Keyed by `document_id` (`documents.id` and every derived FK).
    DocumentScoped,
    /// Keyed by an extraction `run_id` (run-level metadata / attribution).
    RunScoped,
}

/// Whether applying the event hard-deletes derived projection rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CascadeBehavior {
    /// Creates / updates rows only; removes nothing.
    None,
    /// Hard-deletes the scoped entity and all derived projection rows.
    /// (Audit is preserved in the append-only event log.)
    HardDeleteCascade,
}

/// Declarative contract for one event type. Pure data — never executed.
#[derive(Debug, Clone, Copy)]
pub struct EventContract {
    pub event_type: EventType,
    pub identity_scope: IdentityScope,
    /// True if applying the event writes to projection tables.
    pub affects_projection: bool,
    /// True if the event's effect depends on its position in the per-client
    /// version-ordered replay (e.g. last-write-wins, or tombstone dominance).
    pub is_replay_order_sensitive: bool,
    pub cascade_behavior: CascadeBehavior,
    /// Whether the event participates in `rebuild_from_events`.
    pub participates_in_rebuild: bool,
    /// One-line reviewer note on the semantics.
    pub note: &'static str,
}

// ── Per-event contracts (one `const` each) ────────────────────────────────

const CLIENT_CREATED: EventContract = EventContract {
    event_type: EventType::ClientCreated,
    identity_scope: IdentityScope::ClientScoped,
    affects_projection: true,
    is_replay_order_sensitive: true, // must precede all other client events
    cascade_behavior: CascadeBehavior::None,
    participates_in_rebuild: true,
    note: "Creates the client row + initial demographics.",
};

const DEMOGRAPHICS_UPDATED: EventContract = EventContract {
    event_type: EventType::DemographicsUpdated,
    identity_scope: IdentityScope::ClientScoped,
    affects_projection: true,
    is_replay_order_sensitive: true, // last-write-wins by version
    cascade_behavior: CascadeBehavior::None,
    participates_in_rebuild: true,
    note: "Wholesale replacement of the demographics blob (last write wins).",
};

const DOCUMENT_UPLOADED: EventContract = EventContract {
    event_type: EventType::DocumentUploaded,
    identity_scope: IdentityScope::DocumentScoped,
    affects_projection: true,
    is_replay_order_sensitive: true,
    cascade_behavior: CascadeBehavior::None,
    participates_in_rebuild: true,
    note: "Legacy document metadata upsert (file_name/method/char_count). \
           Not emitted on the boundary ingestion path.",
};

const CLIENT_RESTORED_FROM_VERSION: EventContract = EventContract {
    event_type: EventType::ClientRestoredFromVersion,
    identity_scope: IdentityScope::ClientScoped,
    affects_projection: true,
    is_replay_order_sensitive: true,
    cascade_behavior: CascadeBehavior::None,
    participates_in_rebuild: true,
    note: "Promotes a historical demographics snapshot forward as a new event.",
};

const CLIENT_DELETED: EventContract = EventContract {
    event_type: EventType::ClientDeleted,
    identity_scope: IdentityScope::ClientScoped,
    affects_projection: true,
    is_replay_order_sensitive: true, // tombstone: dominates all client events
    cascade_behavior: CascadeBehavior::HardDeleteCascade,
    participates_in_rebuild: true,
    note: "Tombstone. Hard-deletes the client + all derived rows; events \
           retained in the log. Rebuild skips deleted clients.",
};

const DOCUMENT_EXTRACTED: EventContract = EventContract {
    event_type: EventType::DocumentExtracted,
    identity_scope: IdentityScope::DocumentScoped,
    affects_projection: true,
    is_replay_order_sensitive: true,
    cascade_behavior: CascadeBehavior::None, // creates data only
    participates_in_rebuild: true,
    note: "Creates the boundary `documents` row (raw/clean text, hashes, \
           filename, ownership). Authoritative for document ownership.",
};

const CLINICAL_EVENTS_RECORDED: EventContract = EventContract {
    event_type: EventType::ClinicalEventsRecorded,
    identity_scope: IdentityScope::DocumentScoped,
    affects_projection: true,
    is_replay_order_sensitive: true,
    cascade_behavior: CascadeBehavior::None, // creates data only
    participates_in_rebuild: true,
    note: "Inserts the document's verbatim ClinicalEvents (snippet-integrity \
           verified at write time).",
};

const ATTRIBUTION_RECORDED: EventContract = EventContract {
    event_type: EventType::AttributionRecorded,
    identity_scope: IdentityScope::RunScoped,
    affects_projection: true,
    is_replay_order_sensitive: true,
    cascade_behavior: CascadeBehavior::None,
    participates_in_rebuild: true,
    note: "Upserts resolved attributions + participants/organisations/patient \
           identities for a run. Globals are shared across documents.",
};

const EXTRACTION_RUN_RECORDED: EventContract = EventContract {
    event_type: EventType::ExtractionRunRecorded,
    identity_scope: IdentityScope::RunScoped,
    affects_projection: true,
    is_replay_order_sensitive: false, // idempotent run metadata, order-free
    cascade_behavior: CascadeBehavior::None,
    participates_in_rebuild: true,
    note: "Records run metadata (pipeline_version, rule_corpus_hash, counts). \
           Idempotent upsert keyed by run_id.",
};

const DOCUMENT_DELETED: EventContract = EventContract {
    event_type: EventType::DocumentDeleted,
    identity_scope: IdentityScope::DocumentScoped,
    affects_projection: true,
    // EXPLICIT DECLARATION: DocumentDeleted DOMINATES all prior
    // DocumentScoped events in replay (highest version for its document),
    // which is what makes the cascade + rebuild tombstone-sweep correct.
    is_replay_order_sensitive: true,
    cascade_behavior: CascadeBehavior::HardDeleteCascade,
    participates_in_rebuild: true,
    note: "Tombstone. Hard-deletes the document + all derived rows \
           (resolved_attributions → clinical_events → document_participant_maps \
           → entities → documents). DOMINATES all prior DocumentScoped events \
           in replay; honoured by rebuild_from_events via the tombstone sweep.",
};

/// Every contract, for iteration (tests, reviewer listing). Kept in sync
/// with `contract_for` by `tests::registry_is_complete_and_consistent`.
pub const EVENT_CONTRACTS: &[EventContract] = &[
    CLIENT_CREATED,
    DEMOGRAPHICS_UPDATED,
    DOCUMENT_UPLOADED,
    CLIENT_RESTORED_FROM_VERSION,
    CLIENT_DELETED,
    DOCUMENT_EXTRACTED,
    CLINICAL_EVENTS_RECORDED,
    ATTRIBUTION_RECORDED,
    EXTRACTION_RUN_RECORDED,
    DOCUMENT_DELETED,
];

/// The declared contract for an event type.
///
/// DRIFT GUARD: this is an EXHAUSTIVE `match`. A new `EventType` variant
/// without a contract here will NOT compile — forcing every new event to
/// declare its semantics in this registry.
#[allow(dead_code)] // Contract-disclosure surface; consumed by tests + reviewers.
pub fn contract_for(t: EventType) -> &'static EventContract {
    match t {
        EventType::ClientCreated => &CLIENT_CREATED,
        EventType::DemographicsUpdated => &DEMOGRAPHICS_UPDATED,
        EventType::DocumentUploaded => &DOCUMENT_UPLOADED,
        EventType::ClientRestoredFromVersion => &CLIENT_RESTORED_FROM_VERSION,
        EventType::ClientDeleted => &CLIENT_DELETED,
        EventType::DocumentExtracted => &DOCUMENT_EXTRACTED,
        EventType::ClinicalEventsRecorded => &CLINICAL_EVENTS_RECORDED,
        EventType::AttributionRecorded => &ATTRIBUTION_RECORDED,
        EventType::ExtractionRunRecorded => &EXTRACTION_RUN_RECORDED,
        EventType::DocumentDeleted => &DOCUMENT_DELETED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every variant returned by `contract_for` must report itself, and the
    /// `EVENT_CONTRACTS` slice must agree with `contract_for` — so the two
    /// disclosure surfaces can never drift apart.
    #[test]
    fn registry_is_complete_and_consistent() {
        for c in EVENT_CONTRACTS {
            // The slice entry must equal what contract_for returns for that type.
            let looked_up = contract_for(c.event_type);
            assert_eq!(looked_up.event_type, c.event_type);
            assert_eq!(looked_up.cascade_behavior, c.cascade_behavior);
            assert_eq!(looked_up.identity_scope, c.identity_scope);
            assert_eq!(looked_up.affects_projection, c.affects_projection);
            assert_eq!(looked_up.is_replay_order_sensitive, c.is_replay_order_sensitive);
        }
        // No duplicate event_type entries in the slice.
        let mut seen = std::collections::BTreeSet::new();
        for c in EVENT_CONTRACTS {
            assert!(seen.insert(c.event_type.as_str()),
                "duplicate contract for {}", c.event_type.as_str());
        }
    }

    /// The three document-pipeline contracts required by spec, declared
    /// exactly. Locks the disclosed semantics so they cannot silently change.
    #[test]
    fn document_pipeline_contracts_are_declared() {
        let de = contract_for(EventType::DocumentExtracted);
        assert_eq!(de.identity_scope, IdentityScope::DocumentScoped);
        assert!(de.affects_projection);
        assert!(de.is_replay_order_sensitive);
        assert_eq!(de.cascade_behavior, CascadeBehavior::None);

        let ce = contract_for(EventType::ClinicalEventsRecorded);
        assert_eq!(ce.identity_scope, IdentityScope::DocumentScoped);
        assert!(ce.affects_projection);
        assert!(ce.is_replay_order_sensitive);
        assert_eq!(ce.cascade_behavior, CascadeBehavior::None);

        let dd = contract_for(EventType::DocumentDeleted);
        assert_eq!(dd.identity_scope, IdentityScope::DocumentScoped);
        assert!(dd.affects_projection);
        assert!(dd.is_replay_order_sensitive);
        assert_eq!(dd.cascade_behavior, CascadeBehavior::HardDeleteCascade,
            "DocumentDeleted MUST declare HARD_DELETE_CASCADE");
    }

    /// Declared invariant: any HARD_DELETE_CASCADE tombstone must be
    /// replay-order-sensitive (it has to dominate the events it removes).
    #[test]
    fn hard_delete_cascade_implies_replay_order_sensitive() {
        for c in EVENT_CONTRACTS {
            if c.cascade_behavior == CascadeBehavior::HardDeleteCascade {
                assert!(c.is_replay_order_sensitive,
                    "{} is a hard-delete cascade and MUST be replay-order-sensitive \
                     (it must dominate the events it removes)", c.event_type.as_str());
            }
        }
    }
}
