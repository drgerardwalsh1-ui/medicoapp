// ── MedicoApp → Shadow ReferenceEntity bridge probe (DEV/TEST ONLY) ────────────
// One-way, observational, inert. Real clinician capture (clinicalSpine.appendObservation)
// may emit a shadow ReferenceEntity record here. This module:
//   • is GATED to dev/test builds — `import.meta.env.DEV` is replaced with `false`
//     by `vite build`, so in production this is a hard no-op and logs NOTHING (no PHI).
//   • imports nothing from engine/, rules/, integration/, or the backend.
//   • is read by NO production code (only getShadowRefLog / tests).
//   • can never affect the capture path: the emit is guarded and returns void.
// Reuses the capture-layer id space (referenceEntity.newReferenceEntityId); introduces
// no new ontology (kinds are existing labels only).

import { newReferenceEntityId, type KindUnion } from "./referenceEntity";

// Hard dev/test gate. `import.meta.env.DEV` === false in production builds → no-op.
const ENV_DEV: boolean =
  typeof import.meta !== "undefined" && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
let __forceEnabled: boolean | null = null; // test-only override; null = use env gate. Never set in prod.
/** test-only: force the gate on/off (or null to restore env default) */
export function __setShadowEnabledForTest(v: boolean | null): void { __forceEnabled = v; }
function enabled(): boolean { return __forceEnabled !== null ? __forceEnabled : ENV_DEV; }

/** STEP-4 record shape, exactly. provenance.source pins this to MedicoApp capture. */
export type ShadowRefRecord = {
  readonly refId: string;
  readonly kind: KindUnion;
  readonly label: string;
  readonly provenance: { readonly source: "medicoapp"; readonly at: string };
  readonly sourceEventId: string;
};

const refLog: ShadowRefRecord[] = [];

/** Read-only inspection (offline/tests). No production code reads this. */
export function getShadowRefLog(): readonly ShadowRefRecord[] { return refLog; }
/** test-only */
export function __resetShadowRefLog(): void { refLog.length = 0; }

function push(kind: KindUnion, label: string, sourceEventId: string): void {
  refLog.push({
    refId: newReferenceEntityId(),
    kind, label,
    provenance: { source: "medicoapp", at: new Date().toISOString() },
    sourceEventId,
  });
}

// Structural input only (a committed Observation). NOT importing the engine Observation
// type keeps this module fully decoupled from engine/.
type ObservationLike = { id?: string; symptomTypeId?: string; onset?: string };

/**
 * Emit shadow ReferenceEntity record(s) from one committed observation.
 * Dev/test only · guarded · returns void · cannot affect capture.
 * Referent-like fields → existing-label kinds only:
 *   symptomTypeId → "symptom" (clinical_events EventType label)
 *   onset         → "document_date" (clinical_events EventType label)
 */
export function shadowEmitFromObservation(observation: ObservationLike, sourceEventId: string): void {
  if (!enabled()) return; // production build / disabled → no-op, no PHI logged
  try {
    const src = observation && observation.id ? String(observation.id) : String(sourceEventId);
    if (observation && observation.symptomTypeId) push("symptom", String(observation.symptomTypeId), src);
    if (observation && observation.onset) push("document_date", String(observation.onset), src);
  } catch {
    /* shadow must never affect the capture path */
  }
}
