// ── Layer 2 — GENERATED: the reasoning pipeline ────────────────────────────────
// recompute() is pure, total and side-effect-free. It reads frozen ontology +
// writable surfaces and returns ONLY readonly generated artifacts. It can never
// write the frozen or writable stores. Inference is passive: it outputs
// suggestions and candidacy states and NEVER confirms a DSM criterion.

import type {
  CriterionId,
  DiagnosisId,
  EvidenceNodeId,
  ObservationId,
  Ontology,
} from "../types/ontology";
import type { Observation, Presence } from "../types/observation";
import type {
  CriterionAttestation,
  ConflictResolution,
  EpisodeBoundaryCorrection,
} from "../types/review";
import {
  deriveEpisodes,
  type Episode,
  type EpisodeMembership,
} from "./episodes";
import {
  detectConflicts,
  type Conflict,
  type DiagnosisSupportContext,
} from "./conflicts";

// ── Evidence node — observation reference + intrinsic polarity ONLY ────────────
// It carries no criterionId / diagnosisId. Every criterion/diagnosis linkage is
// derived here in recompute via ontology mappings.
export type EvidencePolarity = "supports" | "contradicts" | "indeterminate";

export type EvidenceNode = {
  readonly id: EvidenceNodeId;
  readonly observationId: ObservationId;
  readonly polarity: EvidencePolarity;
};

export type CriterionSuggestionState =
  | "insufficient_evidence"
  | "suggested_not_met"
  | "suggested_met";

export type CriterionSuggestion = {
  readonly diagnosisId: DiagnosisId;
  readonly criterionId: CriterionId;
  readonly state: CriterionSuggestionState;
  readonly supporting: readonly EvidenceNodeId[];
  readonly contradicting: readonly EvidenceNodeId[];
};

export type DiagnosisCandidacyState =
  | "below_threshold"
  | "approaching_threshold"
  | "threshold_likely_met";

export type DiagnosisCandidacy = {
  readonly diagnosisId: DiagnosisId;
  readonly state: DiagnosisCandidacyState;
  readonly temporalCoOccurrenceSupported: boolean;
  readonly sharedEvidence: boolean;
};

export type ReasoningInput = {
  readonly ontology: Ontology;
  readonly observations: readonly Observation[];
  readonly attestations: readonly CriterionAttestation[];
  readonly resolutions: readonly ConflictResolution[];
  readonly corrections: readonly EpisodeBoundaryCorrection[];
};

export type ReasoningOutput = {
  readonly evidence: readonly EvidenceNode[];
  readonly suggestions: readonly CriterionSuggestion[];
  readonly candidacies: readonly DiagnosisCandidacy[];
  readonly episodes: readonly Episode[];
  readonly memberships: readonly EpisodeMembership[];
  readonly conflicts: readonly Conflict[];
};

function evidenceNodeId(o: ObservationId): EvidenceNodeId {
  return `ev:${o}` as EvidenceNodeId;
}

function polarityOf(presence: Presence): EvidencePolarity {
  // "unknown" → indeterminate. It propagates forward and reduces confidence;
  // it is NEVER treated as absence.
  if (presence === "present") return "supports";
  if (presence === "absent") return "contradicts";
  return "indeterminate";
}

// An observation counts toward a diagnosis unless a resolution attributed it
// elsewhere. "keep_shared" (or no resolution) keeps it shared across diagnoses.
function countsForDiagnosis(
  observationId: ObservationId,
  diagnosisId: DiagnosisId,
  resolutions: readonly ConflictResolution[],
): boolean {
  const r = resolutions.find((x) => x.observationId === observationId);
  if (!r || r.attributeToDiagnosisId === "keep_shared") return true;
  return r.attributeToDiagnosisId === diagnosisId;
}

export function recompute(input: ReasoningInput): ReasoningOutput {
  const { ontology, observations, resolutions, corrections } = input;

  const active = observations.filter((o) => !o.tombstoned);

  // 1. Evidence nodes — one per active observation, intrinsic polarity only.
  const evidence: EvidenceNode[] = active.map((o) => ({
    id: evidenceNodeId(o.id),
    observationId: o.id,
    polarity: polarityOf(o.presence),
  }));

  // 2. Suggestions — derive criterion/diagnosis linkage from mappings here.
  const suggestions: CriterionSuggestion[] = [];
  const support: DiagnosisSupportContext[] = [];
  const candidacies: DiagnosisCandidacy[] = [];

  // first pass: per-diagnosis support, candidacy state (no sharedEvidence yet)
  type Pass1 = {
    diagnosisId: DiagnosisId;
    state: DiagnosisCandidacyState;
    temporalOk: boolean;
    supportingObsIds: ObservationId[];
    countThreshold: number;
    aboveApproaching: boolean;
  };
  const pass1: Pass1[] = [];

  for (const dx of ontology.diagnoses) {
    let requiredCriteria = 0;
    let metRequired = 0;
    let anyPartial = false;
    let temporalOk = true;
    let countThreshold = 1;
    const dxSupportingObs = new Set<ObservationId>();

    for (const crit of dx.criteria) {
      const mappedSymptomIds = new Set(
        ontology.mappings
          .filter((m) => m.diagnosisId === dx.id && m.criterionId === crit.criterionId)
          .map((m) => m.symptomTypeId),
      );

      const relevant = active.filter(
        (o) =>
          mappedSymptomIds.has(o.symptomTypeId) &&
          countsForDiagnosis(o.id, dx.id, resolutions),
      );

      const supporting = relevant.filter((o) => o.presence === "present");
      const contradicting = relevant.filter((o) => o.presence === "absent");
      // indeterminate (unknown) deliberately excluded from both tallies.

      const minRequired = crit.minRequired ?? 1;
      const anchorsOk =
        !crit.mandatoryAnchorSymptomTypeIds ||
        crit.mandatoryAnchorSymptomTypeIds.every((aid) =>
          supporting.some((o) => o.symptomTypeId === aid),
        );

      let state: CriterionSuggestionState;
      if (supporting.length >= minRequired && anchorsOk) {
        state = "suggested_met";
      } else if (contradicting.length > 0 && supporting.length === 0) {
        state = "suggested_not_met";
      } else {
        state = "insufficient_evidence";
      }

      suggestions.push({
        diagnosisId: dx.id,
        criterionId: crit.criterionId,
        state,
        supporting: supporting.map((o) => evidenceNodeId(o.id)),
        contradicting: contradicting.map((o) => evidenceNodeId(o.id)),
      });

      if (crit.requiresTemporalCoOccurrence) {
        // Honest-cap: co-occurrence is only "supported" if every supporting
        // observation carries an onset. Otherwise candidacy is capped below.
        const allHaveOnset =
          supporting.length >= minRequired &&
          supporting.every((o) => typeof o.onset === "string" && o.onset.length > 0);
        if (!allHaveOnset) temporalOk = false;
      }

      if (crit.type === "symptom_count" || crit.type === "impairment") {
        requiredCriteria += 1;
        if (state === "suggested_met") metRequired += 1;
        if (supporting.length > 0) anyPartial = true;
      }
      if (crit.type === "symptom_count") {
        countThreshold = minRequired;
      }
      for (const o of supporting) dxSupportingObs.add(o.id);
    }

    let state: DiagnosisCandidacyState;
    if (requiredCriteria > 0 && metRequired === requiredCriteria) {
      state = "threshold_likely_met";
    } else if (metRequired > 0 || anyPartial) {
      state = "approaching_threshold";
    } else {
      state = "below_threshold";
    }

    // Cap: episodic diagnosis without temporal co-occurrence can rise no higher
    // than approaching_threshold.
    if (
      dx.courseModel === "episodic" &&
      !temporalOk &&
      state === "threshold_likely_met"
    ) {
      state = "approaching_threshold";
    }

    const aboveApproaching =
      state === "approaching_threshold" || state === "threshold_likely_met";

    pass1.push({
      diagnosisId: dx.id,
      state,
      temporalOk,
      supportingObsIds: [...dxSupportingObs],
      countThreshold,
      aboveApproaching,
    });

    support.push({
      diagnosisId: dx.id,
      aboveApproaching,
      countThreshold,
      supportingObservationIds: [...dxSupportingObs],
    });
  }

  // 3. sharedEvidence — an observation supporting this diagnosis also supports
  //    another above-approaching diagnosis (and was not attributed away).
  for (const p of pass1) {
    const shared = p.supportingObsIds.some((obsId) =>
      pass1.some(
        (other) =>
          other.diagnosisId !== p.diagnosisId &&
          other.aboveApproaching &&
          other.supportingObsIds.includes(obsId),
      ),
    );
    candidacies.push({
      diagnosisId: p.diagnosisId,
      state: p.state,
      temporalCoOccurrenceSupported: p.temporalOk,
      sharedEvidence: shared,
    });
  }

  // 4. Episodes + conflicts (both pure projections).
  const { episodes, memberships } = deriveEpisodes(ontology, active, corrections);
  const conflicts = detectConflicts(active, support);

  return { evidence, suggestions, candidacies, episodes, memberships, conflicts };
}
