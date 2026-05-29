// ── Phase 9 — Temporal & Longitudinal Governance layer (pure, additive) ────────
// Read-only qualification of diagnoses against DSM temporal requirements
// (chronicity, duration, course). It does NOT modify candidacy, scoring,
// thresholds, mappings, constraints, semantics, or replay. It NEVER excludes a
// diagnosis or alters its rank — it only reports whether the snapshot contains
// enough longitudinal evidence to satisfy temporal requirements.
//
// It reads only data that already exists: symptom presence + the temporal
// fields stored on SymptomEntity (durationCount/Unit, onsetDate, episodic,
// remissionPeriods). It fabricates nothing.

import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";

export type TemporalStatus =
  | "temporally_supported"
  | "temporally_unknown"
  | "temporally_inconsistent"
  | "temporally_not_applicable";

export type TemporalQualification = {
  readonly diagnosisId: string;
  readonly status: TemporalStatus;
  readonly requiresLongitudinalEvidence: boolean;
  readonly unmetRequirements: readonly string[];
  readonly supportingEvidence: readonly string[];
  readonly notes?: string;
};

export type TemporalGovernanceResult = {
  readonly diagnoses: readonly TemporalQualification[];
};

// Minimal structural input — avoids coupling to the bridge module.
export type TemporalOverlayInput = {
  readonly candidacies: readonly { readonly diagnosisId: string }[];
};

// ── Evidence vocabularies (presence-based; no mapping reconstruction) ──────────
const MANIC_ENTITIES = [
  "elevated_mood",
  "grandiosity",
  "decreased_sleep_need",
  "pressured_speech",
  "racing_thoughts",
  "increased_goal_directed_activity",
  "risk_behaviours",
];
const TRAUMA_ENTITIES = [
  "intrusive_memories",
  "trauma_dreams",
  "flashbacks",
  "distress_to_cues",
  "physiological_reactivity",
  "cognitive_avoidance",
  "external_avoidance",
  "hypervigilance",
  "exaggerated_startle",
];
const UNIPOLAR = new Set(["mdd", "pdd"]);
const PRIMARY_MOOD_ANXIETY = new Set(["mdd", "pdd", "gad", "sad", "pan", "agor"]);

const TWO_YEARS_DAYS = 730;
const ONE_MONTH_DAYS = 30;

function presentSet(assessment: DSMAssessmentData | undefined): Set<string> {
  const s = new Set<string>();
  if (assessment?.symptoms) {
    for (const e of Object.values(assessment.symptoms)) {
      if (e.currentPresence === true) s.add(e.id);
    }
  }
  return s;
}

function durationDays(e: SymptomEntity | undefined): number | undefined {
  if (!e || !e.durationCount) return undefined;
  const n = Number(e.durationCount);
  if (Number.isNaN(n)) return undefined;
  const u = (e.durationUnit ?? "").toLowerCase();
  const factor = u.startsWith("day")
    ? 1
    : u.startsWith("week")
      ? 7
      : u.startsWith("month")
        ? 30
        : u.startsWith("year")
          ? 365
          : undefined;
  return factor === undefined ? undefined : n * factor;
}

function maxDuration(assessment: DSMAssessmentData | undefined, ids: string[]): number | undefined {
  const symptoms = assessment?.symptoms;
  if (!symptoms) return undefined;
  let max: number | undefined;
  for (const id of ids) {
    const d = durationDays(symptoms[id]);
    if (d !== undefined && (max === undefined || d > max)) max = d;
  }
  return max;
}

const NA = (diagnosisId: string): TemporalQualification => ({
  diagnosisId,
  status: "temporally_not_applicable",
  requiresLongitudinalEvidence: false,
  unmetRequirements: [],
  supportingEvidence: [],
});

export function evaluateTemporalGovernance(
  assessment: DSMAssessmentData | undefined,
  overlay: TemporalOverlayInput,
  _snapshot?: unknown,
): TemporalGovernanceResult {
  const present = presentSet(assessment);
  const manic = MANIC_ENTITIES.some((id) => present.has(id));
  const substance = [...present].some((id) => /_withdrawal$/.test(id));
  const traumaDuration = maxDuration(assessment, TRAUMA_ENTITIES);
  const symptoms = assessment?.symptoms;

  function qualify(diagnosisId: string): TemporalQualification {
    // ── Rule 3 — bipolar vs unipolar (highest precedence for unipolar) ────────
    if (UNIPOLAR.has(diagnosisId) && manic) {
      return {
        diagnosisId,
        status: "temporally_inconsistent",
        requiresLongitudinalEvidence: diagnosisId === "pdd",
        unmetRequirements: ["Manic/hypomanic features present — unipolar course not attributable"],
        supportingEvidence: [],
        notes: "Remains visible and clinician-overridable; bipolar course must be excluded.",
      };
    }

    // ── Rule 4 — substance-induced aetiological uncertainty ───────────────────
    if (PRIMARY_MOOD_ANXIETY.has(diagnosisId) && substance) {
      return {
        diagnosisId,
        status: "temporally_unknown",
        requiresLongitudinalEvidence: diagnosisId === "pdd",
        unmetRequirements: ["Symptoms occur in a substance context — primary aetiology unconfirmed"],
        supportingEvidence: [],
        notes: "Etiological uncertainty — not excluded.",
      };
    }

    // ── Rule 1 — Persistent Depressive Disorder (chronicity) ──────────────────
    if (diagnosisId === "pdd") {
      const chronicity = durationDays(symptoms?.["depressed_mood"]);
      if (chronicity === undefined) {
        return {
          diagnosisId,
          status: "temporally_unknown",
          requiresLongitudinalEvidence: true,
          unmetRequirements: ["≥2-year chronicity not documented", "Persistence not established"],
          supportingEvidence: [],
        };
      }
      if (chronicity >= TWO_YEARS_DAYS) {
        return {
          diagnosisId,
          status: "temporally_supported",
          requiresLongitudinalEvidence: true,
          unmetRequirements: [],
          supportingEvidence: ["Documented depressed-mood duration ≥ 2 years"],
        };
      }
      return {
        diagnosisId,
        status: "temporally_inconsistent",
        requiresLongitudinalEvidence: true,
        unmetRequirements: ["Documented duration < 2 years"],
        supportingEvidence: [],
      };
    }

    // ── Rule 2 — PTSD vs Acute Stress Disorder (duration) ─────────────────────
    if (diagnosisId === "ptsd") {
      if (traumaDuration === undefined) {
        return { diagnosisId, status: "temporally_unknown", requiresLongitudinalEvidence: true, unmetRequirements: ["Symptom duration since trauma not documented"], supportingEvidence: [] };
      }
      if (traumaDuration < ONE_MONTH_DAYS) {
        return { diagnosisId, status: "temporally_inconsistent", requiresLongitudinalEvidence: true, unmetRequirements: ["Duration < 1 month (favours Acute Stress Disorder)"], supportingEvidence: [] };
      }
      return { diagnosisId, status: "temporally_supported", requiresLongitudinalEvidence: true, unmetRequirements: [], supportingEvidence: ["Symptom duration ≥ 1 month"] };
    }
    if (diagnosisId === "asd") {
      if (traumaDuration === undefined) {
        return { diagnosisId, status: "temporally_unknown", requiresLongitudinalEvidence: true, unmetRequirements: ["Symptom duration since trauma not documented"], supportingEvidence: [] };
      }
      if (traumaDuration >= ONE_MONTH_DAYS) {
        return { diagnosisId, status: "temporally_inconsistent", requiresLongitudinalEvidence: true, unmetRequirements: ["Duration ≥ 1 month (favours PTSD)"], supportingEvidence: [] };
      }
      return { diagnosisId, status: "temporally_supported", requiresLongitudinalEvidence: true, unmetRequirements: [], supportingEvidence: ["Symptom duration < 1 month"] };
    }

    return NA(diagnosisId);
  }

  const diagnoses = overlay.candidacies
    .map((c) => qualify(c.diagnosisId))
    .sort((a, b) => (a.diagnosisId < b.diagnosisId ? -1 : a.diagnosisId > b.diagnosisId ? 1 : 0));

  return { diagnoses };
}
