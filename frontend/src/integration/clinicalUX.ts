// ── Phase 16 — Clinical UX translation (pure, additive, read-only) ─────────────
// Translates existing snapshot / replay outputs into clinician-facing
// decision-first view models. Performs NO clinical inference, NO scoring, NO
// new DSM logic — every field is a paraphrase or verbatim copy of data already
// present in the snapshot. The engine, constraints, semantics, temporal
// governance, and report assembly are NOT touched.
//
// Allowed imports: snapshot/replay TYPES from existing integration modules
// only. No engine, no bridge.

import type { ReportSnapshotV2 } from "./clinicalDecision";
import type { ClinicalReplay } from "./clinicalReplay";

// ── View-model types ──────────────────────────────────────────────────────────
export type HypothesisStatus =
  | "likely"
  | "probable"
  | "differential_primary"
  | "possible";

export type StrengthLabel = "strong" | "moderate" | "weak";

export type ClinicalHypothesis = {
  readonly diagnosisId: string;
  readonly diagnosisName: string;
  readonly status: HypothesisStatus;
  readonly strengthLabel: StrengthLabel;
  readonly supportingSignals: readonly string[]; // max 3
  readonly missingSignals: readonly string[]; // max 3
  readonly temporalStatus?: string;
  readonly constraintStatus?: string;
};

export type MissingEvidenceItem = {
  readonly diagnosisId: string;
  readonly label: string;
  readonly missingCriteria: readonly string[];
};

export type ContradictionItem = {
  readonly diagnosisId: string;
  readonly contradiction: string;
};

export type TemporalUXFlag = {
  readonly diagnosisId: string;
  readonly label: string;
};

export type DecisionPressureItem = {
  readonly diagnosisId: string;
  readonly confirmIf: readonly string[];
  readonly rejectIf: readonly string[];
  readonly unknowns: readonly string[];
  readonly source: "semantic + temporal + constraint only";
};

export type ClinicalDecisionViewModel = {
  readonly primaryHypotheses: readonly ClinicalHypothesis[];
  readonly missingEvidence: readonly MissingEvidenceItem[];
  readonly contradictions: readonly ContradictionItem[];
  readonly temporalFlags: readonly TemporalUXFlag[];
  readonly decisionPressure: readonly DecisionPressureItem[];
  readonly hiddenForensicsAvailable: true;
};

// ── Constants (UX-only — not engine logic) ────────────────────────────────────
const MAX_HYPOTHESES = 5;
const MAX_SIGNALS = 3;

const PRIMARY_SET: ReadonlySet<string> = new Set([
  "differential_primary",
  "likely",
  "probable",
  "possible",
]);

// Hypothesis precedence (display order only — NOT a clinical rank).
const PRECEDENCE: Record<HypothesisStatus, number> = {
  differential_primary: 0,
  likely: 1,
  probable: 2,
  possible: 3,
};

// Phase-9 status → human label (direct mapping per spec).
const TEMPORAL_LABEL: Record<string, string> = {
  temporally_supported: "Duration supports diagnosis",
  temporally_unknown: "Insufficient longitudinal evidence",
  temporally_inconsistent: "Temporal criteria not satisfied",
};

// Phase-4-summary tier → strength word (label mapping only, no recomputation).
function strengthFromTier(tier: string | undefined): StrengthLabel {
  if (tier === "likely") return "strong";
  if (tier === "contributing") return "moderate";
  return "weak";
}

// ── Builder ────────────────────────────────────────────────────────────────────
export function buildClinicalDecisionViewModel(
  snapshot: ReportSnapshotV2,
  _replay?: ClinicalReplay, // reserved for future use; forensics drawn via getForensicReplayData
): ClinicalDecisionViewModel {
  const summaryById = new Map(snapshot.summaries.map((s) => [s.diagnosisId, s]));
  const temporalById = new Map(snapshot.temporalQualifications.map((t) => [t.diagnosisId, t]));
  const suppressionById = new Map(snapshot.constraintSuppressions.map((s) => [s.diagnosisId, s]));

  // ── Primary hypotheses (≤5) ────────────────────────────────────────────────
  const primaryHypotheses: ClinicalHypothesis[] = snapshot.semanticStates
    .filter((s) => PRIMARY_SET.has(s.state))
    .sort((a, b) => {
      const p = PRECEDENCE[a.state as HypothesisStatus] - PRECEDENCE[b.state as HypothesisStatus];
      if (p !== 0) return p;
      return a.diagnosisId < b.diagnosisId ? -1 : a.diagnosisId > b.diagnosisId ? 1 : 0;
    })
    .slice(0, MAX_HYPOTHESES)
    .map((s) => {
      const summary = summaryById.get(s.diagnosisId);
      const temporal = temporalById.get(s.diagnosisId);
      const suppression = suppressionById.get(s.diagnosisId);

      // Supporting signals — verbatim from temporal evidence + a paraphrase of
      // the semantic state. Truncated to MAX_SIGNALS for cognitive load.
      const supporting: string[] = [];
      if (temporal?.supportingEvidence?.length) supporting.push(...temporal.supportingEvidence);
      if (summary?.tier === "likely") supporting.push("Engine flags this as a likely contributor");
      if (s.differentialGroup) supporting.push(`Differential cluster: ${s.differentialGroup}`);

      // Missing signals — verbatim from temporal.unmetRequirements; suppression
      // reason if present.
      const missing: string[] = [];
      if (temporal?.unmetRequirements?.length) missing.push(...temporal.unmetRequirements);
      if (suppression?.reason) missing.push(suppression.reason);

      return {
        diagnosisId: s.diagnosisId,
        diagnosisName: s.name,
        status: s.state as HypothesisStatus,
        strengthLabel: strengthFromTier(summary?.tier),
        supportingSignals: supporting.slice(0, MAX_SIGNALS),
        missingSignals: missing.slice(0, MAX_SIGNALS),
        temporalStatus:
          temporal && temporal.status !== "temporally_not_applicable" ? temporal.status : undefined,
        constraintStatus: suppression?.reason,
      };
    });

  // ── Missing evidence (per surfaced diagnosis with gaps) ────────────────────
  const missingEvidence: MissingEvidenceItem[] = snapshot.semanticStates
    .filter((s) => PRIMARY_SET.has(s.state))
    .map((s) => {
      const temporal = temporalById.get(s.diagnosisId);
      const suppression = suppressionById.get(s.diagnosisId);
      const missingCriteria: string[] = [];
      if (temporal?.unmetRequirements?.length) missingCriteria.push(...temporal.unmetRequirements);
      if (suppression?.reason) missingCriteria.push(suppression.reason);
      return missingCriteria.length === 0
        ? null
        : { diagnosisId: s.diagnosisId, label: s.name, missingCriteria };
    })
    .filter((x): x is MissingEvidenceItem => x !== null);

  // ── Contradictions (verbatim from constraints + rule_out semantic reasons) ─
  const contradictions: ContradictionItem[] = [
    ...snapshot.constraintSuppressions.map((s) => ({
      diagnosisId: s.diagnosisId,
      contradiction: s.reason,
    })),
    ...snapshot.semanticStates
      .filter((s) => s.state === "rule_out" && s.reason)
      .map((s) => ({ diagnosisId: s.diagnosisId, contradiction: s.reason! })),
  ];

  // ── Temporal flags (direct label mapping; not_applicable omitted) ──────────
  const temporalFlags: TemporalUXFlag[] = snapshot.temporalQualifications
    .filter((t) => t.status !== "temporally_not_applicable")
    .map((t) => ({
      diagnosisId: t.diagnosisId,
      label: TEMPORAL_LABEL[t.status] ?? t.status,
    }));

  // ── Decision pressure (one per primary hypothesis) ─────────────────────────
  const decisionPressure: DecisionPressureItem[] = primaryHypotheses.map((h) => {
    const temporal = temporalById.get(h.diagnosisId);
    const suppression = suppressionById.get(h.diagnosisId);
    return {
      diagnosisId: h.diagnosisId,
      confirmIf: temporal?.supportingEvidence ?? [],
      rejectIf: suppression?.reason ? [suppression.reason] : [],
      unknowns: temporal?.unmetRequirements ?? [],
      source: "semantic + temporal + constraint only" as const,
    };
  });

  return {
    primaryHypotheses,
    missingEvidence,
    contradictions,
    temporalFlags,
    decisionPressure,
    hiddenForensicsAvailable: true,
  };
}

// Forensic drawer data — pure identity passthrough of the replay (no mutation).
export function getForensicReplayData(replay: ClinicalReplay): ClinicalReplay {
  return replay;
}
