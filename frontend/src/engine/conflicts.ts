// ── Layer 2 — GENERATED: conflict detection ────────────────────────────────────
// Conflicts are detected purely; they surface only on the review surface and
// never interrupt the interview. A symptom enters the queue only if it
// contributes to ≥2 competing diagnoses above approaching_threshold AND its
// removal drops at least one of them below threshold (it is load-bearing).

import type { ConflictId, DiagnosisId, ObservationId } from "../types/ontology";
import type { Observation } from "../types/observation";

// Per-diagnosis support context handed in by recompute (no dependency back on
// recompute's own output types — keeps the dependency one-directional).
export type DiagnosisSupportContext = {
  readonly diagnosisId: DiagnosisId;
  readonly aboveApproaching: boolean; // candidacy ≥ approaching_threshold
  readonly countThreshold: number;
  readonly supportingObservationIds: readonly ObservationId[];
};

export type Conflict = {
  readonly id: ConflictId;
  readonly observationId: ObservationId;
  readonly competingDiagnosisIds: readonly DiagnosisId[];
  readonly loadBearingFor: readonly DiagnosisId[];
  status: "queued" | "resolved" | "dismissed";
};

export function detectConflicts(
  observations: readonly Observation[],
  support: readonly DiagnosisSupportContext[],
): readonly Conflict[] {
  const conflicts: Conflict[] = [];

  for (const o of observations) {
    if (o.presence !== "present" || o.tombstoned) continue;

    const supportsObs = support.filter(
      (s) => s.aboveApproaching && s.supportingObservationIds.includes(o.id),
    );
    if (supportsObs.length < 2) continue;

    // Load-bearing: removing this observation drops the diagnosis below its
    // count threshold (it sits exactly at threshold).
    const loadBearingFor = supportsObs
      .filter((s) => s.supportingObservationIds.length === s.countThreshold)
      .map((s) => s.diagnosisId);

    if (loadBearingFor.length === 0) continue;

    conflicts.push({
      id: `cf:${o.id}` as ConflictId,
      observationId: o.id,
      competingDiagnosisIds: supportsObs.map((s) => s.diagnosisId),
      loadBearingFor,
      status: "queued",
    });
  }

  return conflicts;
}
