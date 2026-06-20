// ── Clinical fact spine adapter (Phase 1) ──────────────────────────────────────
// The Rust event store is the single durable truth for interview clinical
// state. This module is the ONLY bridge between the frozen clinical engine's
// ClinicalState (engine/state.ts — a projection cache from here on) and the
// backend spine commands (record_clinical_observation /
// record_clinical_review_item / get_clinical_state).
//
// It lives OUTSIDE engine/ so the architecture-freeze test stays green: the
// engine modules are untouched; this adapter composes their frozen exports.
//
// Write path: every clinician action appends an event via TauriAPI, then the
// caller re-hydrates (or optimistically appends locally with the same
// payload — the next hydration converges because the fold is deterministic).
// Reasoning is NEVER persisted or transferred: runRecompute derives it from
// the hydrated state, matching the engine doctrine.

import { TauriAPI } from "../api/tauriApi";
import type { ClinicalState } from "../engine/state";
import { deserialiseState } from "../engine/state";
import type { Observation } from "../types/observation";

// Review-item kinds the backend accepts (clinical_fact_store::REVIEW_KINDS).
export const REVIEW_KINDS = [
  "attestation",
  "resolution",
  "correction",
  "conclusion",
  "snapshot",
] as const;

export type ReviewKind = (typeof REVIEW_KINDS)[number];

// Pure wire decoder: get_clinical_state returns exactly the JSON shape
// deserialiseState consumes. Kept as a named function so the wire-format
// compatibility is pinned by tests without a Tauri runtime.
export function parseClinicalStateWire(json: string): ClinicalState {
  return deserialiseState(json);
}

/** Rebuild the client's ClinicalState from the backend event log. */
export async function hydrateClinicalState(clientId: string): Promise<ClinicalState> {
  return parseClinicalStateWire(await TauriAPI.getClinicalState(clientId));
}

/**
 * Append one Observation to the client's fact log. Edits and tombstones are
 * appends carrying the same observation id (engine append-only doctrine).
 * Returns the new event-store version.
 */
export async function appendObservation(
  clientId: string,
  observation: Observation,
): Promise<number> {
  return TauriAPI.recordClinicalObservation(clientId, observation);
}

/** Append one review-surface item. Returns the new event-store version. */
export async function appendReviewItem(
  clientId: string,
  kind: ReviewKind,
  item: unknown,
): Promise<number> {
  return TauriAPI.recordClinicalReviewItem(clientId, kind, item);
}
