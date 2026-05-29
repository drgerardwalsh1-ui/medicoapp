// ── Zone A — COMMAND API (the ONLY mutation entry points from the UI) ──────────
// Every mutation is a pure, serialisable, deterministic transition
// (state, input) => state. The UI never mutates the store directly; it
// dispatches these commands via Tauri IPC. ids and timestamps are supplied by
// the caller so commands hold no hidden state and are fully reproducible.
// Provenance is logged automatically on every command.

import type {
  AttestationId,
  CriterionId,
  DiagnosisId,
  EpisodeId,
  ObservationId,
  SymptomTypeId,
} from "../types/ontology";
import type { Frame } from "../types/ontology";
import type {
  EntrySource,
  Observation,
  Presence,
  Provenance,
  SymptomSeverity,
} from "../types/observation";
import type {
  CriterionAttestation,
  ConflictResolution,
  DiagnosticConclusion,
  DiagnosisDecision,
  EpisodeBoundaryCorrection,
} from "../types/review";
import type { CriterionSuggestionState, DiagnosisCandidacyState } from "./recompute";
import type { ClinicalState } from "./state";
import { latestObservations } from "./state";

// ── Shared author stamp carried by every command ───────────────────────────────
type Author = {
  readonly clinicianId: string;
  readonly at: string; // ISO, supplied by shell
};

function provenance(a: Author, entrySource: EntrySource): Provenance {
  return { clinicianId: a.clinicianId, at: a.at, entrySource };
}

// ── addObservation ─────────────────────────────────────────────────────────────
export type AddObservationInput = Author & {
  readonly id: ObservationId; // supplied by shell (e.g. uuid) and persisted
  readonly symptomTypeId: SymptomTypeId;
  readonly frame: Frame;
  readonly presence: Presence;
  readonly severity?: SymptomSeverity;
  readonly frequencyCount?: string;
  readonly frequencyUnit?: string;
  readonly durationCount?: string;
  readonly durationUnit?: string;
  readonly onset?: string;
  readonly note?: string;
  readonly entrySource?: EntrySource;
};

export function addObservation(
  state: ClinicalState,
  input: AddObservationInput,
): ClinicalState {
  const observation: Observation = {
    id: input.id,
    symptomTypeId: input.symptomTypeId,
    frame: input.frame,
    presence: input.presence,
    severity: input.severity,
    frequencyCount: input.frequencyCount,
    frequencyUnit: input.frequencyUnit,
    durationCount: input.durationCount,
    durationUnit: input.durationUnit,
    onset: input.onset,
    note: input.note,
    provenance: provenance(input, input.entrySource ?? "chip"),
  };
  return { ...state, observationLog: [...state.observationLog, observation] };
}

// ── updateObservation — appends a NEW version, never overwrites ────────────────
export type UpdateObservationInput = Author & {
  readonly id: ObservationId;
  readonly presence?: Presence;
  readonly severity?: SymptomSeverity;
  readonly frequencyCount?: string;
  readonly frequencyUnit?: string;
  readonly durationCount?: string;
  readonly durationUnit?: string;
  readonly onset?: string;
  readonly note?: string;
  readonly tombstoned?: boolean;
  readonly entrySource?: EntrySource;
};

export function updateObservation(
  state: ClinicalState,
  input: UpdateObservationInput,
): ClinicalState {
  const current = latestObservations(state).find((o) => o.id === input.id);
  if (!current) return state; // unknown id — no-op (no destructive write)

  const next: Observation = {
    ...current,
    presence: input.presence ?? current.presence,
    severity: input.severity ?? current.severity,
    frequencyCount: input.frequencyCount ?? current.frequencyCount,
    frequencyUnit: input.frequencyUnit ?? current.frequencyUnit,
    durationCount: input.durationCount ?? current.durationCount,
    durationUnit: input.durationUnit ?? current.durationUnit,
    onset: input.onset ?? current.onset,
    note: input.note ?? current.note,
    tombstoned: input.tombstoned ?? current.tombstoned,
    provenance: provenance(input, input.entrySource ?? "review_action"),
  };
  return { ...state, observationLog: [...state.observationLog, next] };
}

// ── attestCriterion ─────────────────────────────────────────────────────────────
export type AttestCriterionInput = Author & {
  readonly id: AttestationId;
  readonly diagnosisId: DiagnosisId;
  readonly criterionId: CriterionId;
  readonly episodeId?: EpisodeId;
  readonly status: "met" | "not_met" | "unknown";
  readonly suggestedStatusAtAttest: CriterionSuggestionState;
  readonly agreedWithSuggestion: boolean;
  readonly reason?: string;
};

export function attestCriterion(
  state: ClinicalState,
  input: AttestCriterionInput,
): ClinicalState {
  // Reason is mandatory when disagreeing with the system suggestion (M3).
  if (!input.agreedWithSuggestion && !input.reason?.trim()) {
    throw new Error("attestCriterion: reason required when disagreeing with suggestion");
  }
  const attestation: CriterionAttestation = {
    id: input.id,
    diagnosisId: input.diagnosisId,
    criterionId: input.criterionId,
    episodeId: input.episodeId,
    status: input.status,
    suggestedStatusAtAttest: input.suggestedStatusAtAttest,
    agreedWithSuggestion: input.agreedWithSuggestion,
    reason: input.reason,
    provenance: provenance(input, "review_action"),
  };
  return { ...state, attestations: [...state.attestations, attestation] };
}

// ── resolveConflict ─────────────────────────────────────────────────────────────
export type ResolveConflictInput = Author & {
  readonly conflictId: string;
  readonly observationId: ObservationId;
  readonly attributeToDiagnosisId: DiagnosisId | "keep_shared";
};

export function resolveConflict(
  state: ClinicalState,
  input: ResolveConflictInput,
): ClinicalState {
  const resolution: ConflictResolution = {
    conflictId: input.conflictId,
    observationId: input.observationId,
    attributeToDiagnosisId: input.attributeToDiagnosisId,
    provenance: provenance(input, "review_action"),
  };
  return { ...state, resolutions: [...state.resolutions, resolution] };
}

// ── applyEpisodeCorrection ──────────────────────────────────────────────────────
export type ApplyEpisodeCorrectionInput = Author &
  (
    | { readonly kind: "merge"; readonly episodeIds: readonly EpisodeId[]; readonly into: EpisodeId }
    | { readonly kind: "split"; readonly episodeId: EpisodeId; readonly atDate: string }
    | { readonly kind: "adjust"; readonly episodeId: EpisodeId; readonly onset?: string; readonly offset?: string }
  );

export function applyEpisodeCorrection(
  state: ClinicalState,
  input: ApplyEpisodeCorrectionInput,
): ClinicalState {
  const p = provenance(input, "review_action");
  let correction: EpisodeBoundaryCorrection;
  if (input.kind === "merge") {
    correction = { kind: "merge", episodeIds: input.episodeIds, into: input.into, provenance: p };
  } else if (input.kind === "split") {
    correction = { kind: "split", episodeId: input.episodeId, atDate: input.atDate, provenance: p };
  } else {
    correction = { kind: "adjust", episodeId: input.episodeId, onset: input.onset, offset: input.offset, provenance: p };
  }
  return { ...state, corrections: [...state.corrections, correction] };
}

// ── concludeDiagnosis — clinician-authored final decision (append-only) ─────────
export type ConcludeDiagnosisInput = Author & {
  readonly diagnosisId: DiagnosisId;
  readonly episodeId?: EpisodeId;
  readonly decision: DiagnosisDecision;
  readonly candidacyAtDecision: DiagnosisCandidacyState;
  readonly severity?: string;
  readonly specifiers?: readonly string[];
  readonly notes?: string;
};

export function concludeDiagnosis(
  state: ClinicalState,
  input: ConcludeDiagnosisInput,
): ClinicalState {
  const conclusion: DiagnosticConclusion = {
    diagnosisId: input.diagnosisId,
    episodeId: input.episodeId,
    decision: input.decision,
    candidacyAtDecision: input.candidacyAtDecision,
    severity: input.severity,
    specifiers: input.specifiers,
    notes: input.notes,
    provenance: provenance(input, "review_action"),
  };
  return { ...state, conclusions: [...state.conclusions, conclusion] };
}

// ── IPC command envelope — serialisable, tagged for the Rust side ──────────────
export type Command =
  | { readonly type: "addObservation"; readonly input: AddObservationInput }
  | { readonly type: "updateObservation"; readonly input: UpdateObservationInput }
  | { readonly type: "attestCriterion"; readonly input: AttestCriterionInput }
  | { readonly type: "resolveConflict"; readonly input: ResolveConflictInput }
  | { readonly type: "applyEpisodeCorrection"; readonly input: ApplyEpisodeCorrectionInput }
  | { readonly type: "concludeDiagnosis"; readonly input: ConcludeDiagnosisInput };

export function dispatch(state: ClinicalState, command: Command): ClinicalState {
  switch (command.type) {
    case "addObservation":
      return addObservation(state, command.input);
    case "updateObservation":
      return updateObservation(state, command.input);
    case "attestCriterion":
      return attestCriterion(state, command.input);
    case "resolveConflict":
      return resolveConflict(state, command.input);
    case "applyEpisodeCorrection":
      return applyEpisodeCorrection(state, command.input);
    case "concludeDiagnosis":
      return concludeDiagnosis(state, command.input);
  }
}
