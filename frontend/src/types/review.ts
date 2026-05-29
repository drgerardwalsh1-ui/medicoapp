// ── Layer 1 — WRITABLE (review surface) + Layer 3 — LEGAL ───────────────────────
// The review surface is the second (and only other) writable surface: confirm /
// disagree with suggestions, resolve queued conflicts, correct episode
// boundaries, and author the final diagnostic decision. None of this happens
// during the interview. The ReportSnapshot freezes all three layers as legal
// truth at sign time.

import type {
  AttestationId,
  CriterionId,
  DiagnosisId,
  EpisodeId,
  ObservationId,
} from "./ontology";
import type { Observation, Provenance } from "./observation";
import type {
  CriterionSuggestion,
  CriterionSuggestionState,
  DiagnosisCandidacy,
  EvidenceNode,
} from "../engine/recompute";
import type { Episode, EpisodeMembership } from "../engine/episodes";
import type { Conflict } from "../engine/conflicts";

// ── Criterion attestation — the clinician's verdict ────────────────────────────
// Freezes the system suggestion at decision time so "system said vs clinician
// said" is permanently reconstructable. `reason` is required only when
// disagreeing or confirming against contradicting evidence.
export type CriterionAttestation = {
  readonly id: AttestationId;
  readonly diagnosisId: DiagnosisId;
  readonly criterionId: CriterionId;
  readonly episodeId?: EpisodeId; // present iff diagnosis courseModel is episodic
  status: "met" | "not_met" | "unknown";
  readonly suggestedStatusAtAttest: CriterionSuggestionState;
  agreedWithSuggestion: boolean;
  reason?: string;
  readonly provenance: Provenance;
};

// ── Conflict resolution — attribute a shared, load-bearing symptom ─────────────
export type ConflictResolution = {
  readonly conflictId: string;
  readonly observationId: ObservationId;
  attributeToDiagnosisId: DiagnosisId | "keep_shared";
  readonly provenance: Provenance;
};

// ── Episode boundary correction — sticky review overlay ────────────────────────
export type EpisodeBoundaryCorrection =
  | {
      readonly kind: "merge";
      readonly episodeIds: readonly EpisodeId[];
      readonly into: EpisodeId;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: "split";
      readonly episodeId: EpisodeId;
      readonly atDate: string;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: "adjust";
      readonly episodeId: EpisodeId;
      readonly onset?: string;
      readonly offset?: string;
      readonly provenance: Provenance;
    };

// ── Diagnostic conclusion — clinician-authored FINAL decision ──────────────────
// Distinct from DiagnosisCandidacy (which is system-derived and never confirms).
// This is the clinician's authoritative diagnostic decision and is carried into
// the snapshot as legal truth.
export type DiagnosisDecision = "confirmed" | "excluded" | "deferred";

export type DiagnosticConclusion = {
  readonly diagnosisId: DiagnosisId;
  readonly episodeId?: EpisodeId;
  decision: DiagnosisDecision;
  readonly candidacyAtDecision: DiagnosisCandidacy["state"];
  severity?: string;
  specifiers?: readonly string[];
  notes?: string;
  readonly provenance: Provenance;
};

// ── Layer 3 — ReportSnapshot (immutable, hashed, reproducible) ─────────────────
export type ReportSnapshot = {
  readonly id: string;
  readonly dsmVersion: "DSM-5-TR";
  readonly takenAt: string;
  readonly takenBy: string;

  // writable layers
  readonly observations: readonly Observation[];
  readonly attestations: readonly CriterionAttestation[];
  readonly resolutions: readonly ConflictResolution[];
  readonly corrections: readonly EpisodeBoundaryCorrection[];
  readonly conclusions: readonly DiagnosticConclusion[];

  // generated layer (frozen at sign time)
  readonly evidence: readonly EvidenceNode[];
  readonly suggestions: readonly CriterionSuggestion[];
  readonly candidacies: readonly DiagnosisCandidacy[];
  readonly episodes: readonly Episode[];
  readonly memberships: readonly EpisodeMembership[];
  readonly conflicts: readonly Conflict[];

  readonly contentHash: string;
};
