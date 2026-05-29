// ── Phase 8 — Clinical Forensic Replay layer (pure, read-only) ─────────────────
// Deterministic audit/replay of a ReportSnapshotV2. NOT an engine, NOT a
// scoring system, NOT an interpretation layer, NOT a transformation layer.
//
// Hard rules honoured here:
//   - No imports of engine / recompute / constraints / semantics / bridge /
//     mappings. The ONLY import is the snapshot + decision TYPES from the
//     decision module (the snapshot is the sole data source).
//   - No recomputation, re-scoring, re-evaluation, inference, or backfilling.
//     Anything not in the snapshot does not appear in the replay.
//   - Input snapshot is never mutated.

import type { ReportSnapshotV2, ClinicalDecision } from "./clinicalDecision";
import type { TemporalQualification } from "./clinicalTemporal";

// Local mirror of the semantic-state union (avoids importing the semantics
// module). Identical string literals remain assignable from the snapshot.
type SemanticState =
  | "excluded"
  | "rule_out"
  | "subthreshold"
  | "unlikely"
  | "possible"
  | "probable"
  | "likely"
  | "differential_primary";

export type ObservationReplayItem = {
  readonly symptomId: string;
  readonly symptomType: string;
  readonly presence: "present"; // snapshot stores present observations verbatim
  readonly severity?: string;
  readonly onsetDate?: string;
  readonly notes?: string;
};

export type ConstraintReplayItem = {
  readonly diagnosisId: string;
  readonly name: string;
  readonly reason: string; // verbatim from snapshot.constraintSuppressions
};

export type SemanticReplayItem = {
  readonly diagnosisId: string;
  readonly name: string;
  // Snapshot stores a single semantic state per diagnosis (no transition
  // history), so this is a single-element trace — never fabricated.
  readonly states: readonly SemanticState[];
  readonly current: SemanticState;
  readonly differentialGroup?: string;
  readonly differentialBasis?: string;
  readonly reason?: string;
};

export type DifferentialReplayItem = {
  readonly group: string;
  readonly basis?: string;
  readonly resolved: false; // replay never resolves a differential
  readonly members: readonly { diagnosisId: string; name: string; state: SemanticState }[];
};

export type DiagnosisReplayItem = {
  readonly diagnosisId: string;
  readonly name: string;
  readonly semanticState: SemanticState;
  readonly candidacyState?: string; // verbatim engine state (not recomputed)
  readonly suppressed: boolean;
  readonly suppressionReason?: string;
  readonly differentialGroup?: string;
  readonly differentialBasis?: string;
};

export type ClinicianDecisionReplay = {
  readonly snapshotHash: string;
  readonly clinicianId?: string;
  readonly timestamp?: string;
  readonly rationale?: string;
  readonly conclusions: readonly {
    readonly diagnosisId: string;
    readonly status: "confirmed" | "rejected" | "deferred";
    readonly episodeId?: string;
    readonly notes?: string;
    readonly overrideFromSystem?: boolean;
  }[];
};

export type ClinicalReplay = {
  readonly meta: {
    readonly snapshotHash: string;
    readonly createdAtReplay: string;
  };
  readonly observations: readonly ObservationReplayItem[];
  readonly constraintEvents: readonly ConstraintReplayItem[];
  readonly semanticEvolution: readonly SemanticReplayItem[];
  readonly differentialMap: readonly DifferentialReplayItem[];
  readonly diagnosisPaths: readonly DiagnosisReplayItem[];
  // Phase 9 — temporal qualifications, displayed verbatim (never reinterpreted).
  readonly temporalQualifications: readonly TemporalQualification[];
  readonly clinicianDecision?: ClinicianDecisionReplay;
};

const cmpStr = <T>(key: (x: T) => string) => (a: T, b: T) =>
  key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

export function buildClinicalReplay(
  snapshot: ReportSnapshotV2,
  decision?: ClinicalDecision,
): ClinicalReplay {
  // A. Observations — verbatim; sorted by onsetDate when present, else stable
  // index (no DSM enrichment, no mapping).
  const observations: ObservationReplayItem[] = snapshot.observations
    .map((o, _i) => ({
      item: {
        symptomId: o.id,
        symptomType: o.symptomType,
        presence: "present" as const,
        severity: o.severity || undefined,
        onsetDate: o.onsetDate,
        notes: o.notes,
      },
      i: _i,
    }))
    .sort((a, b) => {
      const ao = a.item.onsetDate;
      const bo = b.item.onsetDate;
      if (ao && bo && ao !== bo) return ao < bo ? -1 : 1;
      return a.i - b.i; // stable index fallback
    })
    .map((x) => x.item);

  // B. Constraint events — verbatim reasons only; no symptom-level reconstruction.
  const constraintEvents: ConstraintReplayItem[] = snapshot.constraintSuppressions
    .map((s) => ({ diagnosisId: s.diagnosisId, name: s.name, reason: s.reason }))
    .sort(cmpStr((c) => c.diagnosisId));

  // C. Semantic replay — states preserved exactly (no re-evaluation).
  const semanticEvolution: SemanticReplayItem[] = snapshot.semanticStates
    .map((s) => ({
      diagnosisId: s.diagnosisId,
      name: s.name,
      states: [s.state],
      current: s.state,
      differentialGroup: s.differentialGroup,
      differentialBasis: s.differentialBasis,
      reason: s.reason,
    }))
    .sort(cmpStr((s) => s.diagnosisId));

  // D. Differential map — grouped only; never resolved, never ranked.
  const groups = new Map<string, { group: string; basis?: string; members: { diagnosisId: string; name: string; state: SemanticState }[] }>();
  for (const s of snapshot.semanticStates) {
    if (!s.differentialGroup) continue;
    const g = groups.get(s.differentialGroup);
    const member = { diagnosisId: s.diagnosisId, name: s.name, state: s.state };
    if (g) g.members.push(member);
    else groups.set(s.differentialGroup, { group: s.differentialGroup, basis: s.differentialBasis, members: [member] });
  }
  const differentialMap: DifferentialReplayItem[] = [...groups.values()]
    .map((g) => ({
      group: g.group,
      basis: g.basis,
      resolved: false as const,
      members: [...g.members].sort(cmpStr((m) => m.diagnosisId)),
    }))
    .sort(cmpStr((g) => g.group));

  // E. Diagnosis paths — semantic state + candidacy state + constraint effect.
  const candidacyById = new Map(snapshot.candidacies.map((c) => [String(c.diagnosisId), c.state]));
  const suppressionById = new Map(snapshot.constraintSuppressions.map((s) => [s.diagnosisId, s.reason]));
  const diagnosisPaths: DiagnosisReplayItem[] = snapshot.semanticStates
    .map((s) => ({
      diagnosisId: s.diagnosisId,
      name: s.name,
      semanticState: s.state,
      candidacyState: candidacyById.get(s.diagnosisId),
      suppressed: suppressionById.has(s.diagnosisId),
      suppressionReason: suppressionById.get(s.diagnosisId) ?? s.reason,
      differentialGroup: s.differentialGroup,
      differentialBasis: s.differentialBasis,
    }))
    .sort(cmpStr((d) => d.diagnosisId));

  // F. Clinician decision — verbatim if provided; else from snapshot.conclusions.
  let clinicianDecision: ClinicianDecisionReplay | undefined;
  if (decision) {
    clinicianDecision = {
      snapshotHash: snapshot.snapshotHash,
      clinicianId: decision.clinicianId,
      timestamp: decision.timestamp,
      rationale: decision.rationale,
      conclusions: decision.conclusions,
    };
  } else if (snapshot.conclusions.length > 0) {
    clinicianDecision = {
      snapshotHash: snapshot.snapshotHash,
      clinicianId: snapshot.takenBy,
      timestamp: snapshot.takenAt,
      rationale: undefined, // not stored in snapshot — never invented
      conclusions: snapshot.conclusions,
    };
  }

  return {
    meta: {
      snapshotHash: snapshot.snapshotHash,
      createdAtReplay: new Date().toISOString(), // only permitted runtime Date use
    },
    observations,
    constraintEvents,
    semanticEvolution,
    differentialMap,
    diagnosisPaths,
    // Verbatim passthrough — replay does not reinterpret temporal status.
    temporalQualifications: snapshot.temporalQualifications ?? [],
    clinicianDecision,
  };
}
