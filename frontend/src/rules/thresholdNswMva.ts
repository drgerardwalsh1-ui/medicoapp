// ── NSW MVA threshold-injury determination — IMMUTABLE CLINICAL RULE PACK ─────
// Psychiatric threshold-injury classification for NSW motor accident matters
// (Motor Accident Injuries Act 2017 framework, as applied by the assessing
// clinician):
//   • A THRESHOLD psychiatric injury is an adjustment disorder or an acute
//     stress reaction/disorder.
//   • A NON-THRESHOLD psychiatric injury requires a standing DSM-5 diagnosis
//     other than those two.
//   • PIRS/WPI is generally only required for combined "Threshold Injury AND
//     WPI" referrals (Template 11) — that gating lives in the report-type
//     manifest, not here.
//
// Fail-closed doctrine: a diagnosis id this pack does not recognise is never
// silently classified — it is returned as UNRECOGNISED and must be resolved
// by the clinician (or by extending the known-diagnosis registry).

import { DSM5_DIAGNOSES } from "../data/dsm5";

export const THRESHOLD_RULE_PACK = {
  id: "threshold-nsw-mva",
  version: "1.0.0",
} as const;

// Diagnosis ids (from data/dsm5.ts) that constitute a threshold injury.
//   adj — Adjustment Disorders
//   asd — Acute Stress Disorder
export const THRESHOLD_DIAGNOSIS_IDS: ReadonlySet<string> = new Set(["adj", "asd"]);

export type DiagnosisClassification = "THRESHOLD" | "NON_THRESHOLD" | "UNRECOGNISED";

// Case-level outcome over the injury-caused diagnoses:
//   NON_THRESHOLD   — at least one non-threshold DSM-5 diagnosis is present.
//   THRESHOLD_ONLY  — diagnoses present, all of them threshold (adj/asd).
//   NO_DIAGNOSIS    — no injury-caused psychiatric diagnosis concluded.
//   INDETERMINATE   — an unrecognised diagnosis id blocks determination
//                     (fail closed; requires clinician resolution).
export type CaseThresholdOutcome =
  | "NON_THRESHOLD"
  | "THRESHOLD_ONLY"
  | "NO_DIAGNOSIS"
  | "INDETERMINATE";

const KNOWN_DSM5_IDS: ReadonlySet<string> = new Set(DSM5_DIAGNOSES.map((d) => d.id));

export function classifyDiagnosis(diagnosisId: string): DiagnosisClassification {
  if (THRESHOLD_DIAGNOSIS_IDS.has(diagnosisId)) return "THRESHOLD";
  if (KNOWN_DSM5_IDS.has(diagnosisId)) return "NON_THRESHOLD";
  return "UNRECOGNISED";
}

export type CaseThresholdDetermination = {
  outcome: CaseThresholdOutcome;
  perDiagnosis: { diagnosisId: string; classification: DiagnosisClassification }[];
};

// Determine the case-level threshold outcome from the ids of the diagnoses
// the clinician has concluded as caused by the subject (reference) injury.
// Pre-existing / non-compensable diagnoses must be excluded by the caller.
export function determineCaseThreshold(injuryCausedDiagnosisIds: readonly string[]): CaseThresholdDetermination {
  const perDiagnosis = injuryCausedDiagnosisIds.map((diagnosisId) => ({
    diagnosisId,
    classification: classifyDiagnosis(diagnosisId),
  }));

  let outcome: CaseThresholdOutcome;
  if (perDiagnosis.some((d) => d.classification === "UNRECOGNISED")) {
    outcome = "INDETERMINATE";
  } else if (perDiagnosis.some((d) => d.classification === "NON_THRESHOLD")) {
    outcome = "NON_THRESHOLD";
  } else if (perDiagnosis.length > 0) {
    outcome = "THRESHOLD_ONLY";
  } else {
    outcome = "NO_DIAGNOSIS";
  }

  return { outcome, perDiagnosis };
}
