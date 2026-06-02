/**
 * Client-side input validation for client identity + ingestion gating.
 *
 * Single canonical implementation of:
 *   - "may this client be saved?" — name validation
 *   - "may documents be ingested for this client?" — saved-client gate
 *
 * These rules exist because the previous draft-client UX allowed
 * uploads to fire against an unsaved-client UUID minted by
 * `defaultClient()` (which calls `crypto.randomUUID()`). The backend
 * then created phantom rows for those UUIDs, producing "Unnamed Client"
 * entries and orphan documents.
 *
 * The fix:
 *   1. No client may be persisted without at least one non-whitespace
 *      character in firstName OR lastName  (`validateClientName`).
 *   2. No document may be ingested unless the client exists in the
 *      projection `clients` table — checked authoritatively via
 *      `TauriAPI.clientExists` at the upload call sites, with
 *      `isPersistedClientId` (in `./client`) as the cheap pre-filter.
 *
 * Ingestion gating deliberately lives at the call sites (it needs an
 * async backend round-trip) rather than here, so this module stays a
 * pure, synchronously-testable validation surface. The earlier
 * `canIngestDocuments({ isSaved })` helper was removed: it trusted a
 * UI flag, which is exactly the desync risk the hardening pass closes.
 */

/** Minimal subset of `Identity` needed to validate a name. */
export interface NameInput {
  firstName?: string | null;
  lastName?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  /**
   * Human-readable message to surface in an `alert()` / toast when
   * `ok === false`. Stable wording — referenced by tests.
   */
  message?: string;
}

/**
 * A client may be saved iff at least one of `firstName` / `lastName`
 * contains a non-whitespace character.
 *
 * Allowed: "A", "J", "Li", "Ng-O".
 * Rejected: "", "   ", null, undefined.
 *
 * Single-character names are explicitly accepted — many medico-legal
 * subjects are referenced as initials.
 */
export function validateClientName(input: NameInput): ValidationResult {
  const first = (input.firstName ?? "").trim();
  const last = (input.lastName ?? "").trim();
  if (first.length === 0 && last.length === 0) {
    return {
      ok: false,
      message:
        "Client must have at least one name field (first or last name).",
    };
  }
  return { ok: true };
}

// NOTE: ingestion gating is intentionally NOT exported from this module.
// It requires an authoritative async existence check against the
// projection DB (`TauriAPI.clientExists`) and therefore lives at the
// upload call sites in ClientHome / DemographicsPage. The pure
// pre-filter is `isPersistedClientId` in `./client`.
