// ── DSM-5-TR Assessment Types ─────────────────────────────────────────────────
// Layered architecture:
//   1. Shared symptom entities  (SymptomEntity)
//   2. DSM criteria definitions (DSMDiagnosisDef / DSMCriterionDef)
//   3. Criterion assessments    (CriterionAssessment)
//   4. Diagnostic interpretations (DiagnosticInterpretation)
//   5. Timeline events          (DSMTimelineEvent)

// ── Tri-state ─────────────────────────────────────────────────────────────────
// unknown ≠ absent — "unknown" means not yet assessed.

export type TriState = "unknown" | "met" | "not_met";

// ── Shared Symptom Entity ─────────────────────────────────────────────────────
// One entity per symptom type, shared across all diagnoses that reference it.
// Updating this entity updates evidence for every diagnosis that uses it.
// Criterion satisfaction (met/not_met) lives in CriterionAssessment, NOT here.

export type SymptomEntity = {
  id: string;               // matches DSMSymptomDef.symptomEntityId
  symptomType: string;      // human-readable type label

  // ── Current state ──────────────────────────────────────────────────────────
  currentPresence?: boolean;
  severity?: "mild" | "moderate" | "severe" | "";

  // ── Frequency / Duration ──────────────────────────────────────────────────
  frequencyCount?: string;
  frequencyUnit?: string;
  durationCount?: string;
  durationUnit?: string;

  // ── Temporal ──────────────────────────────────────────────────────────────
  onsetDate?: string;
  onsetContext?: string;
  progression?: "improving" | "stable" | "worsening" | "fluctuating" | "";
  episodic?: boolean;
  remissionPeriods?: string;

  // ── Pre-injury baseline ────────────────────────────────────────────────────
  preExisting?: boolean;
  preInjuryDescription?: string;

  // ── Evidence layer ─────────────────────────────────────────────────────────
  evidenceFor?: string;
  evidenceAgainst?: string;

  // ── Descriptor chips (selectable from symptom prompts) ────────────────────
  descriptors?: string[];

  // ── Clinical capture ───────────────────────────────────────────────────────
  subjectiveReports?: string;
  observedSigns?: string;
  notes?: string;
  clinicianInterpretation?: string;

  // ── Timeline linkage ───────────────────────────────────────────────────────
  timelineEventIds?: string[];

  // ── Symptom-specific structured data ──────────────────────────────────────
  // Used for symptom types with specialised fields (e.g. suicide risk, sleep).
  extra?: Record<string, unknown>;
};

// ── Criterion Assessment ──────────────────────────────────────────────────────
// One record per assessable row. For Criterion A symptoms, one per symptom.
// For Criteria B–E, one per criterion (+ per-area evidence in `areas`).

export type CriterionAssessment = {
  diagnosisId: string;
  criterionId: string;
  symptomDefId?: string;    // present only for symptom-type criteria
  status: TriState;

  rationale?: string;
  evidenceFor?: string;
  evidenceAgainst?: string;
  clinicianNotes?: string;

  // For non-symptom criteria: per-area evidence
  areas?: Record<string, {
    evidenceFor?: string;
    evidenceAgainst?: string;
    notes?: string;
  }>;
};

// ── Timeline Event ────────────────────────────────────────────────────────────

export type DSMTimelineEvent = {
  id: string;
  date?: string;
  type: "onset" | "worsening" | "remission" | "recurrence" | "treatment" | "assessment";
  symptomEntityIds?: string[];
  diagnosisId?: string;
  description: string;
};

// ── Diagnostic Interpretation ─────────────────────────────────────────────────
// Clinician-confirmed diagnostic conclusion. Auto-calculation informs but does
// NOT set this. Clinician must explicitly confirm.

export type DiagnosticInterpretation = {
  diagnosisId: string;
  clinicianConfirmed?: boolean;
  confirmedAt?: string;
  interpretation?: string;
  differentials?: string[];
  notes?: string;
  // Severity — auto-suggested from symptom count; clinician can override
  severity?: "mild" | "moderate" | "moderate-severe" | "severe" | "";
  severityOverridden?: boolean;
  // Specifier chips — multi-select, diagnosis-specific
  specifiers?: string[];
};

// ── Assessment Container ───────────────────────────────────────────────────────
// Stored in Client.dsmAssessment

export type DSMAssessmentData = {
  symptoms: Record<string, SymptomEntity>;          // keyed by symptomEntityId
  criterionAssessments: CriterionAssessment[];
  diagnosticInterpretations: DiagnosticInterpretation[];
  timelineEvents: DSMTimelineEvent[];
};

// ── DSM Definition Types (structural — not stored in assessment data) ──────────

export type DSMSymptomDef = {
  id: string;               // e.g. "mdd_a1" (diagnosis + criterion specific)
  symptomEntityId: string;  // e.g. "sleep_disturbance" (shared across diagnoses)
  label: string;
  prompts: string[];
  isMandatoryAnchor?: boolean;
  captureHints?: string[];  // field groups to show in workspace
};

export type DSMAssessmentAreaDef = {
  id: string;
  label: string;
  prompts: string[];
};

export type DSMCriterionDef = {
  id: string;
  label: string;
  description: string;
  type: "symptom_count" | "impairment" | "exclusion" | "differential" | "mood_exclusion";
  minRequired?: number;
  mandatoryRule?: string;
  symptoms?: DSMSymptomDef[];
  assessmentAreas?: DSMAssessmentAreaDef[];
};

export type DSMDiagnosisDef = {
  id: string;
  name: string;
  category: string;
  abbreviation: string;
  criteria: DSMCriterionDef[];
  // Specifier options available for this diagnosis
  specifiers?: string[];
  // Severity auto-calculation thresholds (based on symptom count in driving criterion)
  severityThresholds?: {
    criterionId: string;              // which criterion drives the count (e.g. "A" for MDD, "B" for PDD)
    mild: number;                     // met count >= mild → Mild
    moderate: number;
    moderateSevere: number;
    agitationSymptomEntityId?: string; // if this entity is met + count >= moderateSevere → Severe
  };
};

// ── Default factory ───────────────────────────────────────────────────────────

export function defaultDSMAssessmentData(): DSMAssessmentData {
  return {
    symptoms: {},
    criterionAssessments: [],
    diagnosticInterpretations: [],
    timelineEvents: [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getOrCreateSymptom(
  data: DSMAssessmentData,
  entityId: string,
  symptomType: string
): SymptomEntity {
  return data.symptoms[entityId] ?? { id: entityId, symptomType };
}

export function findCriterionAssessment(
  assessments: CriterionAssessment[],
  diagnosisId: string,
  criterionId: string,
  symptomDefId?: string
): CriterionAssessment | undefined {
  return assessments.find(
    (a) =>
      a.diagnosisId === diagnosisId &&
      a.criterionId === criterionId &&
      a.symptomDefId === symptomDefId
  );
}

export function upsertCriterionAssessment(
  assessments: CriterionAssessment[],
  updated: CriterionAssessment
): CriterionAssessment[] {
  const idx = assessments.findIndex(
    (a) =>
      a.diagnosisId === updated.diagnosisId &&
      a.criterionId === updated.criterionId &&
      a.symptomDefId === updated.symptomDefId
  );
  if (idx === -1) return [...assessments, updated];
  const next = [...assessments];
  next[idx] = { ...next[idx], ...updated };
  return next;
}
