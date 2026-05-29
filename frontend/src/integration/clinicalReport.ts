// ── Phase 10 — Clinical Report assembly (pure, additive, read-only) ────────────
// Renders ReportSnapshotV2 + ClinicalReplay into structured medico-legal report
// sections. This is a FORENSIC ASSEMBLY layer, not an interpretation layer:
//   - no engine / recompute / scoring / mapping / semantics / constraint imports
//   - no mutation, no inference, no synthesis, no AI prose generation
//   - no ranking, no winner-picking, no "final diagnosis"
//   - every field copied verbatim from the snapshot/replay; missing → undefined

import type { ReportSnapshotV2 } from "./clinicalDecision";
import type { ClinicalReplay } from "./clinicalReplay";

// ── Section types ──────────────────────────────────────────────────────────────
export type ObservationNarrative = {
  readonly symptomId: string;
  readonly symptomName: string;
  readonly presence: string;
  readonly severity?: string;
  readonly onsetDate?: string;
  readonly duration?: string;
  readonly notes?: string;
};
export type ObservationReportSection = {
  readonly title: string;
  readonly observations: readonly ObservationNarrative[];
};

export type SemanticStateName =
  | "excluded"
  | "rule_out"
  | "differential_primary"
  | "likely"
  | "probable"
  | "possible"
  | "subthreshold"
  | "unlikely";

export type DiagnosisNarrative = {
  readonly diagnosisId: string;
  readonly diagnosisName: string;
  readonly semanticState: SemanticStateName;
  readonly candidacyState: string;
  readonly temporalQualification?: string;
  readonly clinicianConclusion?: "confirmed" | "rejected" | "deferred";
  readonly rationale?: string;
};
export type DiagnosticSummarySection = {
  readonly title: string;
  readonly diagnoses: readonly DiagnosisNarrative[];
};

export type DifferentialNarrative = {
  readonly groupId: string;
  readonly diagnoses: readonly string[];
  readonly resolved: false;
};
export type DifferentialSection = {
  readonly title: string;
  readonly groups: readonly DifferentialNarrative[];
};

export type TemporalNarrative = {
  readonly diagnosisId: string;
  readonly diagnosisName: string;
  readonly temporalState:
    | "temporally_supported"
    | "temporally_unknown"
    | "temporally_inconsistent";
  readonly reason: string;
};
export type TemporalSection = {
  readonly title: string;
  readonly qualifications: readonly TemporalNarrative[];
};

export type ClinicianConclusionNarrative = {
  readonly diagnosisId: string;
  readonly diagnosisName: string;
  readonly conclusion: "confirmed" | "rejected" | "deferred";
  readonly overrideFromSystem: boolean;
  readonly rationale?: string;
};
export type ClinicianDecisionSection = {
  readonly title: string;
  readonly conclusions: readonly ClinicianConclusionNarrative[];
};

export type AuditSection = {
  readonly title: string;
  readonly snapshotHash: string;
  readonly replayHash?: string;
  readonly generatedAt: string;
};

export type ClinicalReport = {
  readonly meta: { readonly snapshotHash: string; readonly generatedAt: string };
  readonly observationsSection: ObservationReportSection;
  readonly diagnosticSummarySection: DiagnosticSummarySection;
  readonly differentialSection: DifferentialSection;
  readonly temporalSection: TemporalSection;
  readonly clinicianDecisionSection: ClinicianDecisionSection;
  readonly auditSection: AuditSection;
};

// ── Helpers (pure, no recomputation) ──────────────────────────────────────────
const cmp = <T>(key: (x: T) => string) => (a: T, b: T) =>
  key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

function formatDuration(count?: string, unit?: string): string | undefined {
  if (!count || !unit) return undefined;
  return `${count} ${unit}`;
}

// ── The assembly function ─────────────────────────────────────────────────────
export function buildClinicalReport(
  snapshot: ReportSnapshotV2,
  replay: ClinicalReplay,
): ClinicalReport {
  const generatedAt = new Date().toISOString();

  // Name lookup — drawn from replay.diagnosisPaths (which already carries names
  // verbatim from the snapshot). Never invented.
  const nameById = new Map<string, string>();
  for (const d of replay.diagnosisPaths) nameById.set(d.diagnosisId, d.name);
  const nameOf = (id: string) => nameById.get(id) ?? id;

  // Cross-reference snapshot observations for fields not exposed by replay
  // (durationCount / durationUnit). Verbatim — no fabrication.
  const snapObsById = new Map(snapshot.observations.map((o) => [o.id, o]));

  // ── Observations section — verbatim, chronological as stored in replay ─────
  const observationsSection: ObservationReportSection = {
    title: "Observations",
    observations: replay.observations.map((o) => {
      const raw = snapObsById.get(o.symptomId);
      return {
        symptomId: o.symptomId,
        symptomName: o.symptomType, // no display-name field in snapshot — verbatim
        presence: o.presence,
        severity: o.severity,
        onsetDate: o.onsetDate,
        duration: formatDuration(raw?.durationCount, raw?.durationUnit),
        notes: o.notes,
      };
    }),
  };

  // ── Diagnostic summary — verbatim from replay.diagnosisPaths ────────────────
  const conclusionsById = new Map(
    (replay.clinicianDecision?.conclusions ?? []).map((c) => [c.diagnosisId, c]),
  );
  const temporalById = new Map(
    replay.temporalQualifications.map((t) => [t.diagnosisId, t]),
  );

  const diagnosticSummarySection: DiagnosticSummarySection = {
    title: "Diagnostic Summary",
    diagnoses: [...replay.diagnosisPaths]
      .sort(cmp((d) => d.diagnosisId))
      .map((d) => {
        const conclusion = conclusionsById.get(d.diagnosisId);
        const temporal = temporalById.get(d.diagnosisId);
        const temporalQualification =
          temporal && temporal.status !== "temporally_not_applicable"
            ? temporal.status
            : undefined;
        return {
          diagnosisId: d.diagnosisId,
          diagnosisName: d.name,
          semanticState: d.semanticState as SemanticStateName,
          candidacyState: d.candidacyState ?? "",
          temporalQualification,
          clinicianConclusion: conclusion?.status,
          rationale: conclusion?.notes,
        };
      }),
  };

  // ── Differential section — grouped, NEVER resolved ─────────────────────────
  const differentialSection: DifferentialSection = {
    title: "Differential Considerations",
    groups: [...replay.differentialMap]
      .sort(cmp((g) => g.group))
      .map((g) => ({
        groupId: g.group,
        diagnoses: [...g.members].sort(cmp((m) => m.diagnosisId)).map((m) => m.diagnosisId),
        resolved: false as const,
      })),
  };

  // ── Temporal section — verbatim qualifications (skip not_applicable) ───────
  const temporalSection: TemporalSection = {
    title: "Temporal Governance",
    qualifications: replay.temporalQualifications
      .filter((t) => t.status !== "temporally_not_applicable")
      .map((t) => {
        const reason =
          t.supportingEvidence[0] ?? t.unmetRequirements[0] ?? t.notes ?? "";
        return {
          diagnosisId: t.diagnosisId,
          diagnosisName: nameOf(t.diagnosisId),
          temporalState: t.status as TemporalNarrative["temporalState"],
          reason,
        };
      })
      .sort(cmp((q) => q.diagnosisId)),
  };

  // ── Clinician decision section — authoritative, overrides verbatim ─────────
  const decisionRationale = replay.clinicianDecision?.rationale;
  const clinicianDecisionSection: ClinicianDecisionSection = {
    title: "Clinician Conclusions",
    conclusions: [...(replay.clinicianDecision?.conclusions ?? [])]
      .sort(cmp((c) => c.diagnosisId))
      .map((c) => ({
        diagnosisId: c.diagnosisId,
        diagnosisName: nameOf(c.diagnosisId),
        conclusion: c.status,
        overrideFromSystem: c.overrideFromSystem === true,
        rationale: decisionRationale, // verbatim from decision; undefined if absent
      })),
  };

  // ── Audit — hash copied exactly; generatedAt is the only runtime field ─────
  const auditSection: AuditSection = {
    title: "Audit",
    snapshotHash: snapshot.snapshotHash,
    replayHash: undefined, // not stored on replay — never invented
    generatedAt,
  };

  return {
    meta: { snapshotHash: snapshot.snapshotHash, generatedAt },
    observationsSection,
    diagnosticSummarySection,
    differentialSection,
    temporalSection,
    clinicianDecisionSection,
    auditSection,
  };
}
