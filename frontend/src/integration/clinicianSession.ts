// ── Phase 7 — clinician identity resolution ────────────────────────────────────
// Deterministic, stable-across-reload active-clinician id for decision
// attribution. Backed by localStorage in the browser (stable across reload);
// falls back to an in-memory value where localStorage is unavailable (tests /
// sandbox). Falls back to a stable constant only when no identity is set —
// never random, so re-attribution stays consistent.

const STORAGE_KEY = "medicoapp.activeClinicianId";
const FALLBACK_CLINICIAN_ID = "unattributed-clinician";

let memoryValue: string | null = null;

// localStorage may be absent (node) or present-but-throwing (Node's experimental
// global without a backing file). Both cases fall back to the in-memory value.
function readRaw(): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(STORAGE_KEY);
  } catch {
    /* fall through to memory */
  }
  return memoryValue;
}

function writeRaw(value: string | null): void {
  memoryValue = value;
  try {
    if (typeof localStorage !== "undefined") {
      if (value === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
    }
  } catch {
    /* memory already updated */
  }
}

/** Resolve the active clinician id. Stable across reloads; deterministic. */
export function getActiveClinicianId(): string {
  const value = readRaw()?.trim();
  return value && value.length > 0 ? value : FALLBACK_CLINICIAN_ID;
}

/** Set the active clinician id for this device/session. Blank ids are ignored. */
export function setActiveClinicianId(id: string): void {
  const trimmed = id.trim();
  if (!trimmed) return;
  writeRaw(trimmed);
}

/** Clear the active clinician id (reverts to the fallback). */
export function clearActiveClinicianId(): void {
  writeRaw(null);
  memoryValue = null;
}

export const UNATTRIBUTED_CLINICIAN_ID = FALLBACK_CLINICIAN_ID;
