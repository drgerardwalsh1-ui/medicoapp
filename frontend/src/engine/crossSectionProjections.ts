// ── Cross-sectional projections — one fact, every surface ────────────────────
// Pure, deterministic functions projecting the observation log onto the four
// clinical surfaces: Current Symptoms, MSE, DSM criterion evidence, and PIRS
// category worksheets. A symptom captured ONCE appears on every surface its
// concept declares (ontology/canonicalOntology.ts) — nothing is re-entered.
//
// Doctrine (matches engine/state.ts and types/ontology.ts):
//   • Reported ≠ observed: frames are never merged. The MSE projection pairs
//     them side-by-side and flags discrepancies; it never collapses them.
//   • Projections are recomputed, never stored as truth.
//   • Epochs are derived from the reference injury date — pre/post is
//     computed, never re-entered. Ambiguity fails closed to "undetermined".

import type { Observation } from "../types/observation";
import type { Frame } from "../types/ontology";
import {
  CONCEPT_REGISTRY,
  type ConceptProjection,
} from "../ontology/canonicalOntology";
import type { DSMCriterionRef } from "../data/symptomDomains";
import type { PIRSCategoryName } from "../data/pirsMapping";
import { PIRS_CATEGORY_NAMES } from "../data/pirsMapping";

// ── Epoch classification ──────────────────────────────────────────────────────
// Onset and reference dates are ISO strings, possibly partial ("2023",
// "2023-05", "2023-05-14"). Comparison happens at the precision of the less
// precise value; a tie at that precision is genuinely ambiguous and fails
// closed to "undetermined" for clarification during interview.
export type EpochClass = "pre_injury" | "post_injury" | "undetermined" | "undated";

export function classifyEpoch(
  onset: string | undefined,
  referenceInjuryDate: string | undefined,
): EpochClass {
  if (!onset || !referenceInjuryDate) return "undated";
  const precision = Math.min(onset.length, referenceInjuryDate.length);
  const a = onset.slice(0, precision);
  const b = referenceInjuryDate.slice(0, precision);
  if (a < b) return "pre_injury";
  if (a > b) return "post_injury";
  // Equal at the comparable precision. Full-date equality means onset ON the
  // injury date — clinically post-injury ("since the accident"). Equality at
  // partial precision (onset "2024-03" vs injury 2024-03-15) is genuinely
  // ambiguous and fails closed for verification at interview.
  if (onset.length >= 10 && referenceInjuryDate.length >= 10) return "post_injury";
  return "undetermined";
}

// ── Shared fact reference ─────────────────────────────────────────────────────
export type FactRef = {
  readonly observationId: string;
  readonly symptomTypeId: string;
  readonly label: string;
  readonly frame: Frame;
  readonly presence: Observation["presence"];
  readonly severity?: Observation["severity"];
  readonly epoch: EpochClass;
};

function conceptOf(symptomTypeId: string): ConceptProjection | undefined {
  return CONCEPT_REGISTRY.get(symptomTypeId);
}

function toRef(o: Observation, referenceInjuryDate?: string): FactRef {
  const id = o.symptomTypeId as string;
  return {
    observationId: o.id as string,
    symptomTypeId: id,
    label: conceptOf(id)?.label ?? id.replace(/_/g, " "),
    frame: o.frame,
    presence: o.presence,
    severity: o.severity,
    epoch: classifyEpoch(o.onset, referenceInjuryDate),
  };
}

function active(observations: readonly Observation[]): Observation[] {
  return observations.filter((o) => !o.tombstoned);
}

// Latest observation per (concept, frame) — observation order is the
// append-only log order, so the last entry is the most recent.
function latestPerConceptFrame(
  observations: readonly Observation[],
): Map<string, Observation> {
  const latest = new Map<string, Observation>();
  for (const o of observations) latest.set(`${o.symptomTypeId}|${o.frame}`, o);
  return latest;
}

// ── 1. Current Symptoms ───────────────────────────────────────────────────────
// Reported (subjective) facts grouped per concept, with any collateral or
// documentary facts for the same concept carried alongside for context.
export type CurrentSymptomRow = {
  readonly symptomTypeId: string;
  readonly label: string;
  readonly domainIds: readonly string[];
  readonly reported?: FactRef;
  readonly collateral: readonly FactRef[];
};

export function projectCurrentSymptoms(
  observations: readonly Observation[],
  referenceInjuryDate?: string,
): CurrentSymptomRow[] {
  const act = active(observations);
  const latest = latestPerConceptFrame(act);
  const conceptIds = [...new Set(act.map((o) => o.symptomTypeId as string))].sort();

  const rows: CurrentSymptomRow[] = [];
  for (const id of conceptIds) {
    const reported = latest.get(`${id}|subjective`);
    const collateral = act.filter(
      (o) =>
        (o.symptomTypeId as string) === id &&
        (o.frame === "collateral" || o.frame === "documentary"),
    );
    if (!reported && collateral.length === 0) continue;
    rows.push({
      symptomTypeId: id,
      label: conceptOf(id)?.label ?? id.replace(/_/g, " "),
      domainIds: conceptOf(id)?.currentSymptomsDomainIds ?? [],
      reported: reported ? toRef(reported, referenceInjuryDate) : undefined,
      collateral: collateral.map((o) => toRef(o, referenceInjuryDate)),
    });
  }
  return rows;
}

// ── 2. MSE ────────────────────────────────────────────────────────────────────
// For each MSE domain linked to symptom entities: the observed-frame fact is
// primary; the reported counterpart is paired (rendered greyed in the UI);
// a presence disagreement between the two frames is flagged as a discrepancy
// (feeding the report's inconsistency reasoning) — never auto-resolved.
export type MSELinkedItem = {
  readonly symptomTypeId: string;
  readonly label: string;
  readonly reported?: FactRef;
  readonly observed?: FactRef;
  readonly discrepancy: boolean;
};

export type MSEDomainProjection = {
  readonly domainId: string;
  readonly items: readonly MSELinkedItem[];
};

export function projectMSE(
  observations: readonly Observation[],
  referenceInjuryDate?: string,
): MSEDomainProjection[] {
  const latest = latestPerConceptFrame(active(observations));

  const byDomain = new Map<string, MSELinkedItem[]>();
  for (const [id, concept] of CONCEPT_REGISTRY) {
    if (concept.mseDomainIds.length === 0) continue;
    const reported = latest.get(`${id}|subjective`);
    const observed = latest.get(`${id}|observed`);
    if (!reported && !observed) continue;

    const discrepancy =
      !!reported &&
      !!observed &&
      reported.presence !== "unknown" &&
      observed.presence !== "unknown" &&
      reported.presence !== observed.presence;

    const item: MSELinkedItem = {
      symptomTypeId: id,
      label: concept.label,
      reported: reported ? toRef(reported, referenceInjuryDate) : undefined,
      observed: observed ? toRef(observed, referenceInjuryDate) : undefined,
      discrepancy,
    };
    for (const domainId of concept.mseDomainIds) {
      const list = byDomain.get(domainId) ?? [];
      list.push(item);
      byDomain.set(domainId, list);
    }
  }

  return [...byDomain.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domainId, items]) => ({ domainId, items }));
}

// ── 3. DSM criterion evidence ─────────────────────────────────────────────────
// Candidate evidence per (diagnosis, criterion). Complementary to
// engine/recompute.ts (which produces suggestions/candidacies); this surfaces
// the underlying fact references for the DSM workspace evidence panels.
// NEVER marks a criterion met — that remains a clinician attestation.
export type DSMCriterionEvidence = {
  readonly diagnosisId: string;
  readonly criterionId: string;
  readonly facts: readonly (FactRef & { readonly symptomDefId: string })[];
};

export function projectDSMEvidence(
  observations: readonly Observation[],
  referenceInjuryDate?: string,
): DSMCriterionEvidence[] {
  const byCriterion = new Map<
    string,
    { ref: DSMCriterionRef; facts: (FactRef & { symptomDefId: string })[] }
  >();

  for (const o of active(observations)) {
    const concept = conceptOf(o.symptomTypeId as string);
    if (!concept) continue;
    for (const ref of concept.dsmCriteria) {
      const key = `${ref.diagnosisId}|${ref.criterionId}`;
      const entry = byCriterion.get(key) ?? { ref, facts: [] };
      entry.facts.push({ ...toRef(o, referenceInjuryDate), symptomDefId: ref.symptomDefId });
      byCriterion.set(key, entry);
    }
  }

  return [...byCriterion.values()]
    .map(({ ref, facts }) => ({
      diagnosisId: ref.diagnosisId,
      criterionId: ref.criterionId,
      facts,
    }))
    .sort(
      (a, b) =>
        a.diagnosisId.localeCompare(b.diagnosisId) ||
        a.criterionId.localeCompare(b.criterionId),
    );
}

// ── 4. PIRS category worksheets ───────────────────────────────────────────────
// Evidence per PIRS category, split into pre/post epochs relative to the
// reference injury date. Surfaces evidence only — the class rating is always
// the clinician's, and the WPI arithmetic lives in rules/pirsNswRules.ts.
export type PIRSCategoryEvidence = {
  readonly category: PIRSCategoryName;
  readonly preInjury: readonly FactRef[];
  readonly postInjury: readonly FactRef[];
  readonly unclassified: readonly FactRef[]; // undated or undetermined → verify at interview
};

export function projectPIRSEvidence(
  observations: readonly Observation[],
  referenceInjuryDate?: string,
): PIRSCategoryEvidence[] {
  const buckets = new Map<
    PIRSCategoryName,
    { preInjury: FactRef[]; postInjury: FactRef[]; unclassified: FactRef[] }
  >();
  for (const c of PIRS_CATEGORY_NAMES)
    buckets.set(c, { preInjury: [], postInjury: [], unclassified: [] });

  for (const o of active(observations)) {
    const concept = conceptOf(o.symptomTypeId as string);
    if (!concept || concept.pirsCategories.length === 0) continue;
    const ref = toRef(o, referenceInjuryDate);
    for (const category of concept.pirsCategories) {
      const bucket = buckets.get(category)!;
      if (ref.epoch === "pre_injury") bucket.preInjury.push(ref);
      else if (ref.epoch === "post_injury") bucket.postInjury.push(ref);
      else bucket.unclassified.push(ref);
    }
  }

  return PIRS_CATEGORY_NAMES.map((category) => ({
    category,
    ...buckets.get(category)!,
  }));
}
