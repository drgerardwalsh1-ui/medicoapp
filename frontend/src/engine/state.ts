// ── Zone B — CLINICAL STATE STORE (Tauri persistent layer) ─────────────────────
// Runtime-pure, JSON-serialisable, IPC-safe. No class instances, no Map/Set, no
// Date objects, no DOM. The persisted blob is the single source of clinical
// truth; reasoning (episodes / conflicts / suggestions / candidacy) is NEVER
// stored as truth — it is recomputed deterministically from this state.

import type { Ontology } from "../types/ontology";
import type { Observation } from "../types/observation";
import type {
  CriterionAttestation,
  ConflictResolution,
  DiagnosticConclusion,
  EpisodeBoundaryCorrection,
  ReportSnapshot,
} from "../types/review";
import { recompute, type ReasoningOutput } from "./recompute";

// ── Persisted clinical state ───────────────────────────────────────────────────
// observationLog is APPEND-ONLY and versioned: an edit appends a new full
// Observation with the same id (never a destructive overwrite). The current
// view is the latest entry per id (see latestObservations). All other arrays
// are append-only.
export type ClinicalState = {
  readonly observationLog: readonly Observation[];
  readonly attestations: readonly CriterionAttestation[];
  readonly resolutions: readonly ConflictResolution[];
  readonly corrections: readonly EpisodeBoundaryCorrection[];
  readonly conclusions: readonly DiagnosticConclusion[];
  readonly snapshots: readonly ReportSnapshot[];
};

export function emptyState(): ClinicalState {
  return {
    observationLog: [],
    attestations: [],
    resolutions: [],
    corrections: [],
    conclusions: [],
    snapshots: [],
  };
}

// Collapse the append-only log to the current view: latest version per id.
// Order-preserving by first appearance so recompute output is deterministic.
export function latestObservations(state: ClinicalState): readonly Observation[] {
  const latestById: Record<string, Observation> = {};
  const order: string[] = [];
  for (const o of state.observationLog) {
    if (!(o.id in latestById)) order.push(o.id);
    latestById[o.id] = o;
  }
  return order.map((id) => latestById[id]);
}

// Deterministic rebuild — same persisted state always yields identical output,
// across restarts. Reasoning is derived here, never read from storage.
export function runRecompute(
  state: ClinicalState,
  ontology: Ontology,
): ReasoningOutput {
  return recompute({
    ontology,
    observations: latestObservations(state),
    attestations: state.attestations,
    resolutions: state.resolutions,
    corrections: state.corrections,
  });
}

// ── Serialisation (lossless, IPC/file/SQLite-safe) ─────────────────────────────
export function serialiseState(state: ClinicalState): string {
  return JSON.stringify(state);
}

export function deserialiseState(raw: string): ClinicalState {
  const b = JSON.parse(raw) as Partial<ClinicalState>;
  return {
    observationLog: Array.isArray(b.observationLog) ? b.observationLog : [],
    attestations: Array.isArray(b.attestations) ? b.attestations : [],
    resolutions: Array.isArray(b.resolutions) ? b.resolutions : [],
    corrections: Array.isArray(b.corrections) ? b.corrections : [],
    conclusions: Array.isArray(b.conclusions) ? b.conclusions : [],
    snapshots: Array.isArray(b.snapshots) ? b.snapshots : [],
  };
}
