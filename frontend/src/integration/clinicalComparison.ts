// ── Audit-layer orchestration — Clinical Overlay Comparison ────────────────────
//
// Purpose: make computeClinicalOverlayDelta operational by supplying the two
// missing compositions around it —
//   (1) version → overlay MATERIALIZATION  (overlayAtVersion)
//   (2) deterministic snapshot-PAIR SELECTION  (closed SelectionPolicy set)
//
// This layer is PURE COMPOSITION over existing operators. It does NOT touch the
// inference kernel, the delta operator, the event store, or any ontology. It
// lives in the audit layer: it reads version history and reconstructs state, then
// composes the pure kernel (runClinicalOverlay) and the pure diff
// (computeClinicalOverlayDelta). Per the locked axis invariant, it operates only
// on the SNAPSHOT axis (versions → recomputed overlays); events are used only as
// cursors to RESOLVE versions, never compared directly.
//
// ── KNOWN BACKEND GAP (explicit, not hidden) ───────────────────────────────────
// There is no runtime source for HISTORICAL DSMAssessmentData. `get_client_
// snapshot_at_version` returns `ClientStateSnapshot`, which carries demographics
// and documents but NOT `dsmAssessment` (verified). `dsmAssessment` exists only on
// the live `Client`. Therefore the historical-state source is INJECTED here as
// `DsmAssessmentAtVersion`; no concrete provider can be wired today. This isolates
// the single missing dependency: extend the replay DTO to surface reconstructed
// `DSMAssessmentData` at a version, and this layer becomes fully operational with
// no further change.

import { runClinicalOverlay, type ClinicalOverlay } from "./clinicalBridge";
import { computeClinicalOverlayDelta, type OverlayDelta } from "./clinicalDelta";
import type { DSMAssessmentData } from "../types/dsm";
import { TauriAPI } from "../api/tauriApi";

// ── Injected dependencies (keep this layer pure + testable) ────────────────────

/** Reconstructs DSMAssessmentData at an event-log version. See backend gap above. */
export type DsmAssessmentAtVersion = (
  clientId: string,
  version: number,
) => Promise<DSMAssessmentData | undefined>;

/** Ordered (oldest-first) version list for a client. */
export type EventHistoryProvider = (
  clientId: string,
) => Promise<readonly { readonly version: number; readonly event_type: string }[]>;

export type ComparisonDeps = {
  readonly getDsmAssessmentAtVersion: DsmAssessmentAtVersion;
  readonly getEventHistory: EventHistoryProvider;
};

// ── Closed selection policy set (no ad hoc logic) ──────────────────────────────
// Every value resolves deterministically to a (left, right) VERSION pair.
export type SelectionPolicy =
  | { readonly kind: "latest_vs_previous" }
  | { readonly kind: "current_vs_version"; readonly version: number }
  | { readonly kind: "version_vs_version"; readonly left: number; readonly right: number }
  | { readonly kind: "latest_vs_first" }
  // "eventId" in this API == the version the event produced (no separate event id
  // is exposed by get_client_event_history). Brackets the event: predecessor
  // version (left) vs the event's own version (right).
  | { readonly kind: "event_bracketed"; readonly eventVersion: number };

export type VersionPair = { readonly left: number; readonly right: number };

export type ClinicalComparisonResult = {
  readonly leftOverlay: ClinicalOverlay;
  readonly rightOverlay: ClinicalOverlay;
  readonly delta: OverlayDelta;
  readonly strategyUsed: SelectionPolicy;
  readonly versionPairResolved: VersionPair;
};

// ── (1) Materialization — version → overlay (pure composition) ─────────────────
// runClinicalOverlay tolerates `undefined` (yields an empty overlay), so a
// missing historical state degrades deterministically rather than throwing.
export async function overlayAtVersion(
  clientId: string,
  version: number,
  getDsmAssessmentAtVersion: DsmAssessmentAtVersion,
): Promise<ClinicalOverlay> {
  const dsm = await getDsmAssessmentAtVersion(clientId, version);
  return runClinicalOverlay(dsm);
}

// ── (2) Deterministic version-pair resolution from the policy ──────────────────
async function resolveVersionPair(
  clientId: string,
  policy: SelectionPolicy,
  getEventHistory: EventHistoryProvider,
): Promise<VersionPair> {
  // Two policies need no history at all.
  if (policy.kind === "version_vs_version") {
    return { left: policy.left, right: policy.right };
  }

  const history = [...(await getEventHistory(clientId))].sort((a, b) => a.version - b.version);
  if (history.length === 0) {
    throw new Error(`compareClinicalOverlays: no event history for client ${clientId}`);
  }
  const first = history[0].version;
  const latest = history[history.length - 1].version;

  switch (policy.kind) {
    case "latest_vs_first":
      if (history.length < 2) throw new Error("latest_vs_first: need ≥2 versions");
      return { left: first, right: latest };

    case "latest_vs_previous": {
      if (history.length < 2) throw new Error("latest_vs_previous: need ≥2 versions");
      return { left: history[history.length - 2].version, right: latest };
    }

    case "current_vs_version":
      // "current" == latest recorded version on the event log.
      return { left: policy.version, right: latest };

    case "event_bracketed": {
      const idx = history.findIndex((h) => h.version === policy.eventVersion);
      if (idx < 0) throw new Error(`event_bracketed: version ${policy.eventVersion} not in history`);
      if (idx === 0) throw new Error("event_bracketed: event is first; no predecessor snapshot to bracket");
      return { left: history[idx - 1].version, right: policy.eventVersion };
    }
  }
}

// ── The orchestrator — selection + materialization + delta (pure composition) ──
export async function compareClinicalOverlays(
  clientId: string,
  policy: SelectionPolicy,
  deps: ComparisonDeps,
): Promise<ClinicalComparisonResult> {
  const versionPairResolved = await resolveVersionPair(clientId, policy, deps.getEventHistory);

  const [leftOverlay, rightOverlay] = await Promise.all([
    overlayAtVersion(clientId, versionPairResolved.left, deps.getDsmAssessmentAtVersion),
    overlayAtVersion(clientId, versionPairResolved.right, deps.getDsmAssessmentAtVersion),
  ]);

  const delta = computeClinicalOverlayDelta(leftOverlay, rightOverlay);

  return { leftOverlay, rightOverlay, delta, strategyUsed: policy, versionPairResolved };
}

// ── Default adapters ───────────────────────────────────────────────────────────
// Event history is available today; the DSM-at-version source is NOT (see gap).

/** Real event-history adapter (available now). */
export const tauriEventHistory: EventHistoryProvider = (clientId) =>
  TauriAPI.getClientEventHistory(clientId);

/**
 * Placeholder for the missing dependency. Throws with the exact remediation, so
 * a caller wiring the orchestrator fails loudly and correctly rather than
 * silently comparing empty overlays. Replace once the replay DTO surfaces
 * historical `DSMAssessmentData`.
 */
export const unavailableDsmAssessmentProvider: DsmAssessmentAtVersion = async () => {
  throw new Error(
    "historical DSMAssessmentData is not exposed by the backend: " +
      "get_client_snapshot_at_version (ClientStateSnapshot) omits dsmAssessment. " +
      "Extend the replay DTO to surface reconstructed DSMAssessmentData at a version, " +
      "then supply a concrete DsmAssessmentAtVersion provider.",
  );
};
