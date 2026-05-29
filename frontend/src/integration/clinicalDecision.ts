// ── Phase 7 — Clinical Decision Boundary + Medico-legal snapshot ───────────────
// The point where inference STOPS. This module records the clinician's explicit
// conclusions and freezes an immutable, hash-verified snapshot. It is pure,
// write-only, and does NOT:
//   - modify engine / constraints / semantics / bridge
//   - recompute, score, rank, or resolve differential ambiguity
//   - confirm any diagnosis on its own
// It reads only the already-computed overlay (Phases 4–6) and the verbatim
// symptom data. Per the Phase 4.1 architecture the live clinical state is
// `dsmAssessment` (the engine ClinicalState is transient), so observations are
// captured verbatim from there; all derived material comes from the overlay.

import type { DiagnosisCandidacy } from "../engine/recompute";
import type { Episode } from "../engine/episodes";
import type { Conflict } from "../engine/conflicts";
import type { ClinicalOverlay, DiagnosisSummary, SuppressedDiagnosis } from "./clinicalBridge";
import type { DiagnosisInterpretation, SemanticState } from "./clinicalSemantics";
import type { TemporalQualification } from "./clinicalTemporal";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";

// ── Clinician-authored conclusion ──────────────────────────────────────────────
export type ConclusionStatus = "confirmed" | "rejected" | "deferred";

export type DiagnosticConclusion = {
  readonly diagnosisId: string;
  readonly status: ConclusionStatus;
  readonly episodeId?: string; // only for episodic diagnoses
  readonly notes?: string;
  // True when the clinician's status diverges from the system semantic state.
  readonly overrideFromSystem?: boolean;
};

export type ClinicalDecision = {
  readonly id: string;
  readonly clientId: string;
  readonly timestamp: string;
  readonly clinicianId: string;
  readonly conclusions: readonly DiagnosticConclusion[];
  readonly rationale?: string;
  readonly snapshotHash: string;
  readonly semanticSummary: readonly DiagnosisInterpretation[];
};

// ── Immutable medico-legal snapshot ────────────────────────────────────────────
export type ReportSnapshotV2 = {
  readonly version: "v2";
  readonly clientId: string;
  readonly takenAt: string;
  readonly takenBy: string;
  // Verbatim clinical truth.
  readonly observations: readonly SymptomEntity[];
  // Engine-derived (read from overlay — never recomputed here).
  readonly candidacies: readonly DiagnosisCandidacy[];
  readonly conflicts: readonly Conflict[];
  readonly episodes: readonly Episode[];
  readonly semanticStates: readonly DiagnosisInterpretation[];
  readonly constraintSuppressions: readonly SuppressedDiagnosis[];
  readonly summaries: readonly DiagnosisSummary[];
  // Phase 9 — temporal governance qualifications (additive).
  readonly temporalQualifications: readonly TemporalQualification[];
  // Clinician authority.
  readonly conclusions: readonly DiagnosticConclusion[];
  readonly snapshotHash: string;
};

export type ClinicianDecisionInput = {
  readonly clientId: string;
  readonly clinicianId: string;
  readonly conclusions: readonly DiagnosticConclusion[];
  readonly rationale?: string;
  readonly timestamp: string; // supplied by caller (deterministic / testable)
  readonly id: string; // supplied by caller (uuid)
};

// ── Canonical JSON + deterministic hash (self-contained, no engine import) ─────
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
  }
  return "null";
}

export function computeSnapshotHash(canonicalData: unknown): string {
  const s = canonicalize(canonicalData);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

const by = <T>(key: (x: T) => string) => (a: T, b: T) =>
  key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

function verbatimObservations(assessment: DSMAssessmentData | undefined): SymptomEntity[] {
  if (!assessment?.symptoms) return [];
  return Object.values(assessment.symptoms)
    .filter((e) => e.currentPresence === true)
    .sort(by((e) => e.id));
}

// ── Snapshot freeze ─────────────────────────────────────────────────────────────
export function buildReportSnapshotV2(
  assessment: DSMAssessmentData | undefined,
  overlay: ClinicalOverlay,
  meta: { clientId: string; takenBy: string; takenAt: string },
  conclusions: readonly DiagnosticConclusion[] = [],
): ReportSnapshotV2 {
  const body = {
    version: "v2" as const,
    clientId: meta.clientId,
    takenAt: meta.takenAt,
    takenBy: meta.takenBy,
    observations: verbatimObservations(assessment),
    candidacies: [...overlay.candidacies].sort(by((c) => c.diagnosisId)),
    conflicts: [...overlay.conflicts].sort(by((c) => c.id)),
    episodes: [...overlay.episodes].sort(by((e) => e.id)),
    semanticStates: [...overlay.states].sort(by((s) => s.diagnosisId)),
    constraintSuppressions: [...overlay.suppressed].sort(by((s) => s.diagnosisId)),
    summaries: [...overlay.summaries].sort(by((s) => s.diagnosisId)),
    temporalQualifications: [...overlay.temporalQualifications].sort(by((t) => t.diagnosisId)),
    conclusions: [...conclusions].sort(by((c) => c.diagnosisId)),
  };
  return { ...body, snapshotHash: computeSnapshotHash(body) };
}

// Recompute the hash of a stored snapshot and confirm it matches (audit verify).
export function verifyReportSnapshotV2(snapshot: ReportSnapshotV2): boolean {
  const { snapshotHash, ...body } = snapshot;
  return computeSnapshotHash(body) === snapshotHash;
}

// ── Override detection (records divergence, never resolves it) ──────────────────
const SYSTEM_FAVOURED: ReadonlySet<SemanticState> = new Set([
  "likely",
  "probable",
  "differential_primary",
]);
const SYSTEM_DISFAVOURED: ReadonlySet<SemanticState> = new Set([
  "excluded",
  "rule_out",
  "unlikely",
  "subthreshold",
]);

function isOverride(status: ConclusionStatus, state: SemanticState | undefined): boolean {
  if (!state) return false;
  if (status === "confirmed" && SYSTEM_DISFAVOURED.has(state)) return true;
  if (status === "rejected" && SYSTEM_FAVOURED.has(state)) return true;
  return false;
}

// ── Decision creation (clinician authority — the only place diagnoses become real)
// ── Phase 18 — snapshot-driven finalize (no assessment/overlay needed) ─────────
// Pure helper that produces a final ClinicalDecision + augmented
// ReportSnapshotV2 from an EXISTING snapshot. It does NOT recompute engine
// outputs: every clinical field on the snapshot is preserved verbatim; the
// only mutation is the addition of clinician conclusions and the resulting
// re-hash of the snapshot body (conclusions are part of the snapshot body, so
// the hash changes — this is the expected post-finalization snapshot).
export type ClinicianDecisionInputV2 = {
  readonly clientId: string;
  readonly clinicianId: string;
  readonly conclusions: readonly DiagnosticConclusion[];
  readonly rationale?: string;
  readonly timestamp: string;
  readonly id: string;
};

const by_dx = (a: DiagnosticConclusion, b: DiagnosticConclusion) =>
  a.diagnosisId < b.diagnosisId ? -1 : a.diagnosisId > b.diagnosisId ? 1 : 0;

export function createClinicalDecisionFromSnapshot(
  snapshot: ReportSnapshotV2,
  input: ClinicianDecisionInputV2,
): { decision: ClinicalDecision; snapshot: ReportSnapshotV2 } {
  const stateById = new Map(snapshot.semanticStates.map((s) => [s.diagnosisId, s.state]));

  const conclusions: DiagnosticConclusion[] = input.conclusions
    .map((c) => ({ ...c, overrideFromSystem: isOverride(c.status, stateById.get(c.diagnosisId)) }))
    .sort(by_dx);

  // Rebuild snapshot body with the new conclusions, then re-hash. The pre-input
  // snapshot object is left untouched (purity).
  const { snapshotHash: _ignore, ...body } = snapshot;
  const newBody = { ...body, conclusions };
  const newSnapshot: ReportSnapshotV2 = {
    ...newBody,
    snapshotHash: computeSnapshotHash(newBody),
  };

  const decision: ClinicalDecision = {
    id: input.id,
    clientId: input.clientId,
    timestamp: input.timestamp,
    clinicianId: input.clinicianId,
    conclusions,
    rationale: input.rationale,
    snapshotHash: newSnapshot.snapshotHash,
    semanticSummary: snapshot.semanticStates,
  };

  return { decision, snapshot: newSnapshot };
}

export function createClinicalDecision(
  assessment: DSMAssessmentData | undefined,
  overlay: ClinicalOverlay,
  input: ClinicianDecisionInput,
): { decision: ClinicalDecision; snapshot: ReportSnapshotV2 } {
  const stateById = new Map(overlay.states.map((s) => [s.diagnosisId, s.state]));

  // Stamp overrideFromSystem by comparing clinician status vs system state.
  const conclusions: DiagnosticConclusion[] = input.conclusions.map((c) => ({
    ...c,
    overrideFromSystem: isOverride(c.status, stateById.get(c.diagnosisId)),
  }));

  const snapshot = buildReportSnapshotV2(
    assessment,
    overlay,
    { clientId: input.clientId, takenBy: input.clinicianId, takenAt: input.timestamp },
    conclusions,
  );

  const decision: ClinicalDecision = {
    id: input.id,
    clientId: input.clientId,
    timestamp: input.timestamp,
    clinicianId: input.clinicianId,
    conclusions,
    rationale: input.rationale,
    snapshotHash: snapshot.snapshotHash,
    semanticSummary: overlay.states,
  };

  return { decision, snapshot };
}
