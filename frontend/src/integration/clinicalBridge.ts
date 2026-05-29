// ── Clinical engine ↔ live app bridge (read-only overlay) ──────────────────────
// The SINGLE integration point between the existing DSM/CurrentSymptoms state
// and the frozen clinical engine. It does NOT introduce a new state system:
// the engine input is DERIVED on demand from the existing `dsmAssessment`
// store, and the output is a read-only overlay. Nothing here writes back into
// app state or mutates the engine.
//
// The engine is pure TypeScript that runs in the webview, so this bridge lives
// on the frontend side of the Tauri IPC boundary (a Rust command cannot execute
// the TS engine without porting it, which the freeze forbids). This module
// lives OUTSIDE engine/ so the architecture-freeze test stays green.

import type {
  CriterionId,
  DiagnosisId,
  Ontology,
  ObservationId,
  SymptomTypeId,
} from "../types/ontology";
import type { Observation, Presence } from "../types/observation";
import type { ClinicalState } from "../engine/state";
import { emptyState, runRecompute } from "../engine/state";
import type {
  CriterionSuggestion,
  DiagnosisCandidacy,
} from "../engine/recompute";
import type { Episode } from "../engine/episodes";
import type { Conflict } from "../engine/conflicts";

import { DSM5_DIAGNOSES } from "../data/dsm5";
import { SYMPTOM_DSM_MAPPING } from "../data/symptomDomains";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";
import { applyConstraints } from "./clinicalConstraints";
import { interpretSemanticStates, type DiagnosisInterpretation } from "./clinicalSemantics";
import { evaluateTemporalGovernance, type TemporalQualification } from "./clinicalTemporal";

// Diagnoses treated as episodic for overlay purposes (drives episode/temporal
// projection only). Everything else is continuous. This is a display-side
// classification, not a change to the engine or the DSM definitions.
const EPISODIC_IDS = new Set<string>([
  "mdd",
  "ptsd",
  "asd",
  "adj",
  "aud",
  "cud",
  "inud",
  "oud",
  "shaud",
  "stud",
  "osud",
]);

// ── Ontology, derived ONCE from the existing DSM definitions ───────────────────
function buildOntology(): Ontology {
  const symptomTypeIds = Object.keys(SYMPTOM_DSM_MAPPING);

  const symptomTypes = symptomTypeIds.map((id) => ({
    id: id as SymptomTypeId,
    label: id,
    frames: ["subjective"] as const,
  }));

  // Fix A — correct criterion targeting. Only criteria that actually have a
  // symptom mapping can be reasoned over by the engine. Functional-impairment,
  // exclusion, differential and mood-exclusion criteria have no symptom
  // pathways and are clinician-assessed — feeding them made "all required
  // criteria met" impossible, so NO diagnosis could ever reach likely_met.
  const mappedCriterionKeys = new Set<string>();
  for (const entityId of symptomTypeIds) {
    for (const ref of SYMPTOM_DSM_MAPPING[entityId]) {
      mappedCriterionKeys.add(`${ref.diagnosisId}|${ref.criterionId}`);
    }
  }

  const diagnoses = DSM5_DIAGNOSES.map((d) => ({
    id: d.id as DiagnosisId,
    name: d.name,
    courseModel: (EPISODIC_IDS.has(d.id) ? "episodic" : "continuous") as
      | "episodic"
      | "continuous",
    dsmVersion: "DSM-5-TR" as const,
    criteria: d.criteria
      .filter((c) => mappedCriterionKeys.has(`${d.id}|${c.id}`))
      .map((c) => ({
        criterionId: c.id as CriterionId,
        type: c.type,
        minRequired: c.minRequired,
      })),
  }));

  const mappings = symptomTypeIds.flatMap((entityId) =>
    SYMPTOM_DSM_MAPPING[entityId].map((ref) => ({
      symptomTypeId: entityId as SymptomTypeId,
      diagnosisId: ref.diagnosisId as DiagnosisId,
      criterionId: ref.criterionId as CriterionId,
    })),
  );

  return { symptomTypes, diagnoses, mappings };
}

const ONTOLOGY: Ontology = buildOntology();

// ── Map existing SymptomEntity presence → engine tri-state ─────────────────────
// undefined currentPresence stays "unknown" (never coerced to absence).
function presenceOf(entity: SymptomEntity): Presence {
  if (entity.currentPresence === true) return "present";
  if (entity.currentPresence === false) return "absent";
  return "unknown";
}

// Build engine observations from the existing symptom store. Provenance is
// synthetic (overlay-only); these observations are never persisted.
function toObservations(data: DSMAssessmentData | undefined): Observation[] {
  if (!data?.symptoms) return [];
  return Object.values(data.symptoms).map((entity) => ({
    id: entity.id as ObservationId,
    symptomTypeId: entity.id as SymptomTypeId,
    frame: "subjective" as const,
    presence: presenceOf(entity),
    severity: entity.severity,
    frequencyCount: entity.frequencyCount,
    frequencyUnit: entity.frequencyUnit,
    durationCount: entity.durationCount,
    durationUnit: entity.durationUnit,
    onset: entity.onsetDate,
    note: entity.notes,
    provenance: {
      clinicianId: "overlay",
      at: "1970-01-01T00:00:00Z",
      entrySource: "chip" as const,
    },
  }));
}

// Display tier — derived from fractional coverage of the engine-reasoned
// criteria. "uncertain" is the noise band suppressed by default in the panel.
export type OverlayTier = "likely" | "contributing" | "uncertain";

export type DiagnosisSummary = {
  readonly diagnosisId: string;
  readonly name: string;
  readonly state: DiagnosisCandidacy["state"];
  readonly coverage: number; // 0..1 — mean fractional support across reasoned criteria
  readonly metCriteria: number;
  readonly totalCriteria: number;
  readonly sharedEvidence: boolean;
  readonly tier: OverlayTier;
};

export type SuppressedDiagnosis = {
  readonly diagnosisId: string;
  readonly name: string;
  readonly reason: string;
};

// ── Public overlay result (read-only) ──────────────────────────────────────────
export type ClinicalOverlay = {
  readonly candidacies: readonly DiagnosisCandidacy[];
  readonly suggestions: readonly CriterionSuggestion[];
  readonly conflicts: readonly Conflict[];
  readonly episodes: readonly Episode[];
  // Ranked, tiered summaries for display (sorted by coverage desc) — after the
  // Phase 5 constraint layer has pruned ineligible / excluded diagnoses.
  readonly summaries: readonly DiagnosisSummary[];
  // Diagnoses removed by the constraint layer (with reasons) — for transparency.
  readonly suppressed: readonly SuppressedDiagnosis[];
  // Phase 6 — semantic state per diagnosis (ambiguity-preserving interpretation).
  readonly states: readonly DiagnosisInterpretation[];
  // Phase 9 — additive temporal governance metadata (does NOT affect ranking).
  readonly temporalQualifications: readonly TemporalQualification[];
  // Lookup helper for the panel: diagnosis id → display name.
  readonly diagnosisNames: Readonly<Record<string, string>>;
};

// Fractional coverage of the criteria the engine actually reasons over
// (symptom_count / impairment with mappings). Smooth "how close to threshold"
// signal: 1/5 symptoms → 0.2 (noise), 3/5 → 0.6, 5/5 → 1.0.
function coverageFor(
  diagnosisId: string,
  suggestions: readonly CriterionSuggestion[],
): { coverage: number; met: number; total: number } {
  const dx = ONTOLOGY.diagnoses.find((d) => d.id === diagnosisId);
  if (!dx) return { coverage: 0, met: 0, total: 0 };
  const reqCrit = dx.criteria.filter(
    (c) => c.type === "symptom_count" || c.type === "impairment",
  );
  if (reqCrit.length === 0) return { coverage: 0, met: 0, total: 0 };

  let sum = 0;
  let met = 0;
  for (const c of reqCrit) {
    const sug = suggestions.find(
      (s) => s.diagnosisId === diagnosisId && s.criterionId === c.criterionId,
    );
    const supporting = sug?.supporting.length ?? 0;
    const min = c.minRequired ?? 1;
    sum += Math.min(supporting / min, 1);
    if (sug?.state === "suggested_met") met += 1;
  }
  return { coverage: sum / reqCrit.length, met, total: reqCrit.length };
}

function tierOf(state: DiagnosisCandidacy["state"], coverage: number): OverlayTier {
  if (state === "threshold_likely_met" || coverage >= 1) return "likely";
  if (coverage >= 0.5) return "contributing";
  return "uncertain";
}

// THE bridge. Derives engine input from existing app state, runs the frozen
// engine, returns a read-only overlay. Pure + synchronous (sub-100ms baseline).
export function runClinicalOverlay(
  data: DSMAssessmentData | undefined,
): ClinicalOverlay {
  const state: ClinicalState = { ...emptyState(), observationLog: toObservations(data) };
  const out = runRecompute(state, ONTOLOGY);

  const diagnosisNames: Record<string, string> = {};
  for (const d of DSM5_DIAGNOSES) diagnosisNames[d.id] = d.name;

  // ── Phase 5 constraint layer ────────────────────────────────────────────────
  // Pure, pre-score eligibility/exclusion predicates over present symptoms.
  // Applied to the candidacy list before display tiers are assigned.
  const present = new Set<string>();
  if (data?.symptoms) {
    for (const e of Object.values(data.symptoms)) {
      if (e.currentPresence === true) present.add(e.id);
    }
  }
  const decisions = applyConstraints(out.candidacies, present);
  const suppressedById = new Map<string, string>();
  for (const d of decisions) if (d.suppressed && d.reason) suppressedById.set(d.diagnosisId, d.reason);

  const visibleCandidacies = out.candidacies.filter(
    (c) => c.state !== "below_threshold" && !suppressedById.has(c.diagnosisId),
  );

  const suppressed: SuppressedDiagnosis[] = out.candidacies
    .filter((c) => c.state !== "below_threshold" && suppressedById.has(c.diagnosisId))
    .map((c) => ({
      diagnosisId: c.diagnosisId,
      name: diagnosisNames[c.diagnosisId] ?? c.diagnosisId,
      reason: suppressedById.get(c.diagnosisId)!,
    }));

  const summaries: DiagnosisSummary[] = visibleCandidacies
    .map((c) => {
      const { coverage, met, total } = coverageFor(c.diagnosisId, out.suggestions);
      return {
        diagnosisId: c.diagnosisId,
        name: diagnosisNames[c.diagnosisId] ?? c.diagnosisId,
        state: c.state,
        coverage,
        metCriteria: met,
        totalCriteria: total,
        sharedEvidence: c.sharedEvidence,
        tier: tierOf(c.state, coverage),
      };
    })
    .sort((a, b) => b.coverage - a.coverage);

  const states = interpretSemanticStates({
    candidacies: out.candidacies,
    suggestions: out.suggestions,
    decisions,
    summaries,
    diagnosisNames,
  });

  // Phase 9 — additive temporal governance (read-only; does not touch the above).
  const temporalQualifications = evaluateTemporalGovernance(data, {
    candidacies: out.candidacies.map((c) => ({ diagnosisId: c.diagnosisId })),
  }).diagnoses;

  return {
    candidacies: out.candidacies,
    suggestions: out.suggestions,
    conflicts: out.conflicts,
    episodes: out.episodes,
    summaries,
    suppressed,
    states,
    temporalQualifications,
    diagnosisNames,
  };
}
