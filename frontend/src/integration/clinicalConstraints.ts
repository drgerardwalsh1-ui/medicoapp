// ── Phase 5 — Constraint layer (pure, independent, pre-scoring) ────────────────
// A diagnostic FILTER that runs around the frozen engine. It does NOT modify
// recompute, scoring, thresholds, or symptom mappings. All predicates are pure
// functions of symptom PRESENCE (pre-score), and pruning is applied to the
// candidacy list before the overlay assigns display tiers.
//
// Four constraint kinds, per spec:
//   1. Hard gate predicates per diagnosis (binary eligibility)
//   2. Mutual exclusivity rules between diagnoses
//   3. Temporal / cause-based suppression rules
//   4. Post-score candidate pruning that applies 1–3
//
// This module is engine-agnostic: it takes a plain set of present symptom-entity
// ids plus a plain list of {diagnosisId} candidacies. No engine/state coupling.

export type PresentSet = ReadonlySet<string>;

export type ConstraintDecision = {
  readonly diagnosisId: string;
  readonly suppressed: boolean;
  readonly reason?: string;
};

const hasAny = (p: PresentSet, ids: readonly string[]) => ids.some((id) => p.has(id));

// ── 1. Hard gate predicates (binary eligibility) ───────────────────────────────
// A diagnosis is eligible only when its mandatory anchor symptom(s) are present.
// Diagnoses absent from this map are unconstrained (eligible = true).
const INTRUSION = [
  "intrusive_memories",
  "trauma_dreams",
  "flashbacks",
  "distress_to_cues",
  "physiological_reactivity",
];

const SSD_CRITERION_B = [
  "excessive_health_worry",
  "fear_of_serious_illness",
  "excessive_symptom_monitoring",
  "repeated_medical_checking",
  "excessive_time_devoted_to_symptoms",
  "excessive_healthcare_utilization",
  "reassurance_seeking",
];

const HARD_GATES: Record<string, { test: (p: PresentSet) => boolean; reason: string }> = {
  mdd: {
    test: (p) => hasAny(p, ["depressed_mood", "anhedonia"]),
    reason: "No core mood anchor (depressed mood or anhedonia) present",
  },
  pdd: {
    test: (p) => p.has("depressed_mood"),
    reason: "No depressed mood present (PDD Criterion A)",
  },
  gad: {
    test: (p) => p.has("excessive_worry"),
    reason: "No excessive worry present (GAD Criterion A)",
  },
  ptsd: {
    test: (p) => hasAny(p, INTRUSION),
    reason: "No intrusion symptom present (PTSD Criterion B)",
  },
  asd: {
    test: (p) =>
      hasAny(p, [...INTRUSION, "depersonalization", "derealization", "dissociative_amnesia"]),
    reason: "No intrusion/dissociative symptom present (ASD Criterion B)",
  },
  bd1: {
    test: (p) => hasAny(p, ["elevated_mood", "grandiosity"]),
    reason: "No manic elevation anchor present (Bipolar I Criterion A)",
  },
  bd2: {
    test: (p) => hasAny(p, ["elevated_mood", "grandiosity"]),
    reason: "No hypomanic elevation anchor present (Bipolar II Criterion A)",
  },
  ssd: {
    test: (p) => hasAny(p, SSD_CRITERION_B),
    reason: "No maladaptive symptom response present (SSD Criterion B)",
  },
  iad: {
    test: (p) => hasAny(p, ["fear_of_serious_illness", "excessive_health_worry"]),
    reason: "No illness preoccupation present (IAD Criterion A)",
  },
  autism: {
    test: (p) =>
      hasAny(p, [
        "social_emotional_reciprocity",
        "nonverbal_communication_deficits",
        "relationship_deficits",
      ]),
    reason: "No social-communication deficit present (Autism Criterion A)",
  },
};

export function isEligible(diagnosisId: string, present: PresentSet): boolean {
  const gate = HARD_GATES[diagnosisId];
  return gate ? gate.test(present) : true;
}

// ── 2. Mutual exclusivity / diagnostic hierarchy ───────────────────────────────
// Manic/hypomanic features present → unipolar depression is not primary.
function bipolarFeaturesPresent(p: PresentSet): boolean {
  return HARD_GATES.bd1.test(p) || HARD_GATES.bd2.test(p);
}
const UNIPOLAR_SUPPRESSED_BY_BIPOLAR = new Set(["mdd", "pdd"]);

// Residual ("other specified" / "unspecified") categories are suppressed when a
// specific diagnosis in the same family is eligible.
const RESIDUAL_FAMILIES: { specific: readonly string[]; residual: readonly string[] }[] = [
  { specific: ["ssd", "iad", "conv", "fact_s", "fact_o"], residual: ["ossrd", "ussrd"] },
  { specific: ["ptsd", "asd", "adj"], residual: ["other_trauma", "unspec_trauma"] },
  { specific: ["an", "bn", "bed"], residual: ["osfed", "unspec_feed"] },
  { specific: ["dpdr", "damn"], residual: ["osdd", "udd"] },
];

function residualSuppressed(diagnosisId: string, present: PresentSet): string | undefined {
  for (const fam of RESIDUAL_FAMILIES) {
    if (
      fam.residual.includes(diagnosisId) &&
      fam.specific.some((s) => isEligible(s, present))
    ) {
      return "Residual category — a specific diagnosis in this family is eligible";
    }
  }
  return undefined;
}

// ── 3. Temporal / cause-based suppression ──────────────────────────────────────
// Active substance withdrawal present → primary mood/anxiety diagnoses must be
// held pending exclusion of a substance-induced disorder.
function substanceContext(p: PresentSet): boolean {
  for (const id of p) if (/_withdrawal$/.test(id)) return true;
  return false;
}
const SUBSTANCE_SUPPRESSED = new Set(["mdd", "pdd", "gad", "sad", "pan", "agor"]);

// ── 4. Post-score candidate pruning (applies 1–3) ──────────────────────────────
// Pure: takes the candidacy diagnosis ids + the present-symptom set, returns a
// decision per diagnosis. Display layer drops suppressed ones.
export function applyConstraints(
  candidacies: readonly { readonly diagnosisId: string }[],
  present: PresentSet,
): readonly ConstraintDecision[] {
  const bipolar = bipolarFeaturesPresent(present);
  const substance = substanceContext(present);

  return candidacies.map(({ diagnosisId }): ConstraintDecision => {
    const gate = HARD_GATES[diagnosisId];
    if (gate && !gate.test(present)) {
      return { diagnosisId, suppressed: true, reason: gate.reason };
    }
    if (bipolar && UNIPOLAR_SUPPRESSED_BY_BIPOLAR.has(diagnosisId)) {
      return {
        diagnosisId,
        suppressed: true,
        reason: "Manic/hypomanic features present — rule out bipolar before unipolar depression",
      };
    }
    if (substance && SUBSTANCE_SUPPRESSED.has(diagnosisId)) {
      return {
        diagnosisId,
        suppressed: true,
        reason: "Active substance withdrawal — rule out substance-induced disorder",
      };
    }
    const residual = residualSuppressed(diagnosisId, present);
    if (residual) return { diagnosisId, suppressed: true, reason: residual };

    return { diagnosisId, suppressed: false };
  });
}
