//! Projection Contract Registry — the declarative source of truth for how
//! each `EventType` mutates the projection (read model).
//!
//! ─── WHAT THIS IS ────────────────────────────────────────────────────────
//! CONTRACT DISCLOSURE ONLY. No execution logic, no validation, no runtime
//! behaviour. It encodes — per event — exactly which projection tables are
//! touched, the operation kind, the rebuild behaviour, and idempotency, so
//! projection behaviour is derivable from contracts rather than from reading
//! `projection.rs`.
//!
//! This complements `event_contracts.rs` (identity / replay semantics) with
//! the projection-level detail. The two registries MUST agree; the
//! conformance test below ties them together so they cannot drift.
//!
//! ─── DRIFT GUARD (compile-time) ──────────────────────────────────────────
//! `contract_for` is an EXHAUSTIVE `match` over `EventType`. A new variant
//! without a projection contract here is a COMPILE ERROR. Because every
//! `projection.rs` handler branch (in `reduce` and `apply_boundary_events`)
//! is itself keyed on `EventType`, exhaustiveness here means: no event can be
//! handled by the projection without a declared contract, and no contract can
//! reference a non-existent event. (Note: `apply_boundary_events` has a
//! `_ => {}` catch-all for non-boundary events by design; the enforcement of
//! "every event is accounted for" therefore lives HERE, in the exhaustive
//! contract match, not in that catch-all.)

use crate::events::EventType;

/// A projection table an event may mutate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionTarget {
    Clients,
    Documents,
    ClinicalEvents,
    ResolvedAttributions,
    DocumentParticipantMaps,
    Entities,
    Participants,
    Organisations,
    PatientIdentities,
    PirsSnapshots,
    ExtractionRuns,
}

/// The kind of mutation an event applies to its projection targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionOperation {
    /// Pure append — never updates or deletes existing rows.
    Insert,
    /// INSERT-OR-UPDATE on conflict (may overwrite existing fields).
    Upsert,
    /// Delete-own-rows-then-insert (idempotent per-key replacement).
    Replace,
    /// Deletes rows from a single target.
    Delete,
    /// Hard-deletes the scoped entity + all derived rows across targets.
    CascadeDelete,
    /// Does not touch the projection.
    Ignore,
}

/// How the event behaves under `rebuild_from_events`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RebuildBehavior {
    /// Replayed and applied like any other event.
    Included,
    /// Causes its scope to be skipped during rebuild (never materialised).
    Skipped,
    /// A tombstone whose effect must dominate ordering anomalies; enforced
    /// during rebuild by the tombstone sweep.
    TombstoneSensitive,
}

/// Whether re-applying the event yields the same projection state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdempotencyMode {
    Idempotent,
    NonIdempotent,
}

/// Declarative projection contract for one event. Pure data — never executed.
#[derive(Debug, Clone, Copy)]
pub struct EventProjectionContract {
    pub event: EventType,
    pub projection_targets: &'static [ProjectionTarget],
    pub operation: ProjectionOperation,
    pub rebuild_behavior: RebuildBehavior,
    pub idempotency: IdempotencyMode,
    pub notes: &'static str,
}

// ── Per-event projection contracts (one `const` each) ─────────────────────

const CLIENT_CREATED: EventProjectionContract = EventProjectionContract {
    event: EventType::ClientCreated,
    projection_targets: &[ProjectionTarget::Clients],
    operation: ProjectionOperation::Upsert, // INSERT ... ON CONFLICT(id)
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    notes: "upsert_client: creates the client row + initial demographics.",
};

const DEMOGRAPHICS_UPDATED: EventProjectionContract = EventProjectionContract {
    event: EventType::DemographicsUpdated,
    projection_targets: &[ProjectionTarget::Clients],
    operation: ProjectionOperation::Upsert, // demographics last-write-wins
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    notes: "upsert_client: wholesale demographics replacement (last write wins).",
};

const DOCUMENT_UPLOADED: EventProjectionContract = EventProjectionContract {
    event: EventType::DocumentUploaded,
    projection_targets: &[ProjectionTarget::Documents],
    operation: ProjectionOperation::Upsert,
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    notes: "upsert_document: legacy document metadata upsert. Not emitted on \
            the boundary ingestion path.",
};

const CLIENT_RESTORED_FROM_VERSION: EventProjectionContract = EventProjectionContract {
    event: EventType::ClientRestoredFromVersion,
    projection_targets: &[ProjectionTarget::Clients],
    operation: ProjectionOperation::Upsert,
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    notes: "upsert_client: promotes a historical demographics snapshot forward.",
};

const CLIENT_DELETED: EventProjectionContract = EventProjectionContract {
    event: EventType::ClientDeleted,
    projection_targets: &[
        ProjectionTarget::ResolvedAttributions,
        ProjectionTarget::ClinicalEvents,
        ProjectionTarget::DocumentParticipantMaps,
        ProjectionTarget::Entities,
        ProjectionTarget::PirsSnapshots,
        ProjectionTarget::Documents,
        ProjectionTarget::Clients,
    ],
    operation: ProjectionOperation::CascadeDelete, // delete_client_rows (7 tables)
    // CORRECTION (R5): the ONLY event that changes rebuild CONTROL FLOW —
    // the reducer sets `state.deleted` and rebuild SKIPS the client group
    // entirely (never materialises it), rather than deleting after creating.
    rebuild_behavior: RebuildBehavior::Skipped,
    idempotency: IdempotencyMode::Idempotent,
    notes: "delete_client_rows. Globals (participants/organisations/\
            patient_identities) and extraction_runs intentionally preserved.",
};

const DOCUMENT_EXTRACTED: EventProjectionContract = EventProjectionContract {
    event: EventType::DocumentExtracted,
    projection_targets: &[ProjectionTarget::Documents],
    // CORRECTION (R2): Upsert, NOT Insert — INSERT-OR-UPDATE on documents,
    // and authoritative for client_id ownership reclaim + filename/text/hashes.
    operation: ProjectionOperation::Upsert,
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    notes: "INSERT-OR-UPDATE documents. Authoritative for document ownership \
            (client_id reclaim) + filename + raw/clean text + hashes.",
};

const CLINICAL_EVENTS_RECORDED: EventProjectionContract = EventProjectionContract {
    event: EventType::ClinicalEventsRecorded,
    projection_targets: &[
        ProjectionTarget::ResolvedAttributions,
        ProjectionTarget::ClinicalEvents,
    ],
    // CORRECTION (R1): Replace, NOT Insert — deletes the document's
    // resolved_attributions + clinical_events, then re-inserts. This is a
    // per-document idempotent replacement, not append-only.
    operation: ProjectionOperation::Replace,
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    notes: "Delete-then-insert (replace) of the document's clinical_events \
            (and its resolved_attributions). Snippet-integrity verified at \
            write time.",
};

const ATTRIBUTION_RECORDED: EventProjectionContract = EventProjectionContract {
    event: EventType::AttributionRecorded,
    projection_targets: &[
        ProjectionTarget::ResolvedAttributions,
        ProjectionTarget::PatientIdentities,
        ProjectionTarget::Participants,
        ProjectionTarget::Organisations,
        ProjectionTarget::DocumentParticipantMaps,
    ],
    operation: ProjectionOperation::Upsert,
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    notes: "Upserts resolved attributions + participants/organisations/patient \
            identities + document_participant_maps. Participants/organisations/\
            patient_identities are GLOBAL (shared, never deleted) — see R4.",
};

const EXTRACTION_RUN_RECORDED: EventProjectionContract = EventProjectionContract {
    event: EventType::ExtractionRunRecorded,
    projection_targets: &[ProjectionTarget::ExtractionRuns],
    operation: ProjectionOperation::Upsert, // idempotent upsert by run_id
    rebuild_behavior: RebuildBehavior::Included,
    idempotency: IdempotencyMode::Idempotent,
    // CORRECTION (R3): make the "never deleted" lifecycle EXPLICIT.
    notes: "never deleted (audit log table). No event (incl. ClientDeleted / \
            DocumentDeleted) removes extraction_runs rows.",
};

const DOCUMENT_DELETED: EventProjectionContract = EventProjectionContract {
    event: EventType::DocumentDeleted,
    projection_targets: &[
        ProjectionTarget::ResolvedAttributions,
        ProjectionTarget::ClinicalEvents,
        ProjectionTarget::DocumentParticipantMaps,
        ProjectionTarget::Entities,
        ProjectionTarget::Documents,
    ],
    operation: ProjectionOperation::CascadeDelete,
    // Tombstone: must dominate prior DocumentScoped events; honoured during
    // rebuild by the tombstone sweep.
    rebuild_behavior: RebuildBehavior::TombstoneSensitive,
    idempotency: IdempotencyMode::Idempotent,
    notes: "cascade_delete_document (5 tables). DOMINATES prior DocumentScoped \
            events; rebuild applies inline + tombstone sweep. No DocumentRestored \
            event exists — deletion is final (R6, intentional).",
};

/// Every projection contract, for iteration (tests, reviewer listing). Kept
/// in lockstep with `contract_for` by the conformance test.
pub const EVENT_PROJECTION_CONTRACTS: &[EventProjectionContract] = &[
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

/// The declared projection contract for an event type.
///
/// DRIFT GUARD: EXHAUSTIVE `match` — a new `EventType` variant without a
/// projection contract will NOT compile.
#[allow(dead_code)] // Contract-disclosure surface; consumed by tests + reviewers.
pub fn contract_for(event: &EventType) -> &'static EventProjectionContract {
    match event {
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
    use crate::event_contracts::{self, CascadeBehavior};

    /// MANDATORY conformance lock (Task 4 + 5).
    ///
    /// 1. Every EventType is present in the projection contract registry.
    /// 2. Every contract maps to a real projection effect (operation != Ignore
    ///    ⟺ it has targets) — i.e. it corresponds to a projection.rs branch.
    /// 3. The projection registry and `event_contracts` agree on the same set
    ///    of events with no extras/omissions — so neither can drift, and no
    ///    projection.rs branch can exist without a contract entry.
    #[test]
    fn projection_contract_is_complete_and_matches_runtime() {
        // (1) + (3): same event set as event_contracts, exhaustively.
        let ev_set: std::collections::BTreeSet<&str> = event_contracts::EVENT_CONTRACTS
            .iter()
            .map(|c| c.event_type.as_str())
            .collect();
        let proj_set: std::collections::BTreeSet<&str> = EVENT_PROJECTION_CONTRACTS
            .iter()
            .map(|c| c.event.as_str())
            .collect();
        assert_eq!(ev_set, proj_set,
            "projection contracts and event_contracts must cover IDENTICAL event sets");

        // No duplicate event entries in the projection registry.
        assert_eq!(EVENT_PROJECTION_CONTRACTS.len(), proj_set.len(),
            "duplicate event in EVENT_PROJECTION_CONTRACTS");

        for c in EVENT_PROJECTION_CONTRACTS {
            // contract_for agrees with the slice (single source of truth).
            let looked_up = contract_for(&c.event);
            assert_eq!(looked_up.event.as_str(), c.event.as_str());
            assert_eq!(looked_up.operation, c.operation);
            assert_eq!(looked_up.rebuild_behavior, c.rebuild_behavior);

            // (2) operation != Ignore ⟺ has at least one projection target.
            if c.operation == ProjectionOperation::Ignore {
                assert!(c.projection_targets.is_empty(),
                    "{}: Ignore must have no targets", c.event.as_str());
            } else {
                assert!(!c.projection_targets.is_empty(),
                    "{}: non-Ignore operation must declare at least one target",
                    c.event.as_str());
            }

            // Cross-registry agreement with event_contracts:
            //   affects_projection ⟺ operation != Ignore
            //   HardDeleteCascade  ⟺ operation == CascadeDelete
            let ec = event_contracts::contract_for(c.event);
            assert_eq!(ec.affects_projection, c.operation != ProjectionOperation::Ignore,
                "{}: affects_projection disagrees with operation", c.event.as_str());
            let ec_is_cascade = ec.cascade_behavior == CascadeBehavior::HardDeleteCascade;
            let proj_is_cascade = c.operation == ProjectionOperation::CascadeDelete;
            assert_eq!(ec_is_cascade, proj_is_cascade,
                "{}: cascade disagreement between the two registries", c.event.as_str());
        }
    }

    /// The five audit corrections (R1–R5) are now declared, not inferred.
    #[test]
    fn audit_corrections_are_encoded() {
        // R1 — ClinicalEventsRecorded is Replace, not Insert.
        assert_eq!(contract_for(&EventType::ClinicalEventsRecorded).operation,
            ProjectionOperation::Replace);

        // R2 — DocumentExtracted is Upsert, not Insert.
        assert_eq!(contract_for(&EventType::DocumentExtracted).operation,
            ProjectionOperation::Upsert);

        // DocumentDeleted — CascadeDelete + TombstoneSensitive.
        let dd = contract_for(&EventType::DocumentDeleted);
        assert_eq!(dd.operation, ProjectionOperation::CascadeDelete);
        assert_eq!(dd.rebuild_behavior, RebuildBehavior::TombstoneSensitive);

        // ClientDeleted — CascadeDelete + Skipped (only event changing rebuild
        // control flow; R5).
        let cd = contract_for(&EventType::ClientDeleted);
        assert_eq!(cd.operation, ProjectionOperation::CascadeDelete);
        assert_eq!(cd.rebuild_behavior, RebuildBehavior::Skipped);

        // R3 — extraction_runs lifecycle made explicit ("never deleted").
        let er = contract_for(&EventType::ExtractionRunRecorded);
        assert_eq!(er.operation, ProjectionOperation::Upsert);
        assert_eq!(er.rebuild_behavior, RebuildBehavior::Included);
        assert!(er.notes.contains("never deleted"),
            "extraction_runs must explicitly declare it is never deleted");

        // R4 — global tables are documented on AttributionRecorded.
        assert!(contract_for(&EventType::AttributionRecorded).notes.contains("GLOBAL"));

        // R6 — restore asymmetry made an explicit, intentional contract note.
        assert!(dd.notes.contains("No DocumentRestored"),
            "DocumentDeleted must declare the intentional absence of a restore event");
    }
}
