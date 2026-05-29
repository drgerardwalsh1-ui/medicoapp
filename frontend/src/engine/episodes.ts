// ── Layer 2 — GENERATED: episode projection ────────────────────────────────────
// Episodes are DERIVED, never authored. Created only for diagnoses whose
// courseModel is "episodic". Membership is a separate projection
// (Observation → EpisodeMembership); it is NOT stored inside Episode objects.
// Auto-generated boundaries may be reshaped only by review-surface corrections,
// which are sticky across recompute.

import type {
  DiagnosisId,
  EpisodeId,
  ObservationId,
  Ontology,
} from "../types/ontology";
import type { Observation } from "../types/observation";
import type { EpisodeBoundaryCorrection } from "../types/review";

export type EpisodeStatus =
  | "active"
  | "partial_remission"
  | "full_remission"
  | "historical";

// No observationIds array — membership is the projection below.
export type Episode = {
  readonly id: EpisodeId;
  readonly diagnosisId: DiagnosisId;
  readonly status: EpisodeStatus;
  readonly onset?: string;
  readonly offset?: string;
  readonly correctionApplied: boolean;
};

// Derived projection linking an observation to the episode it falls within.
export type EpisodeMembership = {
  readonly episodeId: EpisodeId;
  readonly observationId: ObservationId;
};

export type EpisodeProjection = {
  readonly episodes: readonly Episode[];
  readonly memberships: readonly EpisodeMembership[];
};

// Deterministic id so review corrections keep referencing the same episode
// across recompute runs.
function baseEpisodeId(diagnosisId: DiagnosisId): EpisodeId {
  return `ep:${diagnosisId}` as EpisodeId;
}

function isActive(o: Observation): boolean {
  return o.presence === "present" && !o.tombstoned;
}

function earliestOnset(observations: readonly Observation[]): string | undefined {
  const dates = observations
    .map((o) => o.onset)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  return dates[0];
}

export function deriveEpisodes(
  ontology: Ontology,
  observations: readonly Observation[],
  corrections: readonly EpisodeBoundaryCorrection[],
): EpisodeProjection {
  const mappedSymptomsByDiagnosis = new Map<DiagnosisId, Set<string>>();
  for (const m of ontology.mappings) {
    const set = mappedSymptomsByDiagnosis.get(m.diagnosisId) ?? new Set<string>();
    set.add(m.symptomTypeId);
    mappedSymptomsByDiagnosis.set(m.diagnosisId, set);
  }

  const episodes: Episode[] = [];
  const memberships: EpisodeMembership[] = [];

  for (const dx of ontology.diagnoses) {
    if (dx.courseModel !== "episodic") continue; // continuous: no episode entity

    const mapped = mappedSymptomsByDiagnosis.get(dx.id);
    if (!mapped) continue;

    const present = observations.filter(
      (o) => isActive(o) && mapped.has(o.symptomTypeId),
    );

    // Cluster threshold = the count criterion's minRequired for this diagnosis.
    const countCriterion = dx.criteria.find((c) => c.type === "symptom_count");
    const threshold = countCriterion?.minRequired ?? 1;
    if (present.length < threshold) continue;

    let episode: Episode = {
      id: baseEpisodeId(dx.id),
      diagnosisId: dx.id,
      status: "active",
      onset: earliestOnset(present),
      correctionApplied: false,
    };

    episode = applyCorrections(episode, corrections);
    episodes.push(episode);

    for (const o of present) {
      memberships.push({ episodeId: episode.id, observationId: o.id });
    }
  }

  return { episodes, memberships };
}

// Sticky review overlay — merge / split / adjust. Applied after generation so
// the generator never overwrites a corrected boundary.
function applyCorrections(
  episode: Episode,
  corrections: readonly EpisodeBoundaryCorrection[],
): Episode {
  let next = episode;
  for (const c of corrections) {
    if (c.kind === "adjust" && c.episodeId === episode.id) {
      next = {
        ...next,
        onset: c.onset ?? next.onset,
        offset: c.offset ?? next.offset,
        correctionApplied: true,
      };
    }
    if (c.kind === "merge" && c.into === episode.id) {
      next = { ...next, correctionApplied: true };
    }
    if (c.kind === "split" && c.episodeId === episode.id) {
      next = { ...next, offset: c.atDate, correctionApplied: true };
    }
  }
  return next;
}
