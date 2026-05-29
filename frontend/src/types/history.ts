// Structured psychiatric / medical / treatment / developmental history.
// Single cohesive integration — every history domain shares the same
// HistoryEvent core model. Persistence rides on the existing
// updateClientDemographics event (omnibus blob, see buildSaveBlob).

export type UUID = string;

// ── Partial date (display + history only) ────────────────────────────────
// Never used for calculations. Authoritative time math still uses
// Temporal.Instant / canonical UTC (see /time).
export type PartialDate = {
  year?: number;
  month?: number;          // 1..12
  day?: number;            // 1..31
  approximate?: boolean;   // renders as "circa YYYY"
};

// ── Frequency (structured, reuses FrequencyInput conventions) ────────────
// Existing FrequencyInput uses { unit, count } string pairs. FrequencyValue
// is the typed counterpart used by treatment entries. NarrativeEngine
// already exposes formatFrequency(unit, count) — we reuse it via a thin
// adapter rather than duplicating the conversion table.
export type FrequencyValue = {
  every?: number;
  unit: "day" | "week" | "month" | "year";
  timesPerUnit?: number;
  freeText?: string;
};

// ── Core HistoryEvent (unified across categories) ────────────────────────
export type HistoryCategory =
  | "psychiatric"
  | "psychological"
  | "medical"
  | "family"
  | "relationship"
  | "trauma"
  | "work"
  | "other";

export type HistoryTiming =
  | "pre_existing"
  | "subsequent"
  | "current";

export type HistorySourceType =
  | "claimant"
  | "records"
  | "gp"
  | "psychiatrist"
  | "psychologist"
  | "hospital"
  | "other";

export type HistorySignificance = "none" | "minor" | "moderate" | "significant";

export type HistoryEvent = {
  id: UUID;
  title?: string;
  date?: PartialDate;

  category: HistoryCategory;
  timing: HistoryTiming;

  sourceType: HistorySourceType;
  sourceText?: string;

  claimantClarification?: string;
  effectOnFunctioning?: string;
  assessorComment?: string;
  significance?: HistorySignificance;
  acceptedByClaimant?: boolean;
};

// ── Denials block ────────────────────────────────────────────────────────
export type PsychiatricDenials = {
  deniedPreExistingPsychHistory: boolean;
  deniedMentalHealthAdmissions: boolean;
  deniedSelfHarmHistory: boolean;
  deniedViolenceHistory: boolean;
};

// ── Family ───────────────────────────────────────────────────────────────
export type FamilyHistory = {
  knownPsychiatricFamilyHistory: "none" | "unknown" | "present";
  details?: string;
};

// ── Developmental ────────────────────────────────────────────────────────
export type DevelopmentalHistory = {
  birthPlace?: string;
  movedDuringChildhood?: string;
  siblingPosition?: number;
  totalSiblings?: number;
  childhoodDescription?: string;
  childhoodTrauma?: boolean;
  childhoodTraumaDetails?: string;
  narrativeNotes?: string;
};

// ── Education ────────────────────────────────────────────────────────────
export type TertiaryStudy = {
  id: UUID;
  course?: string;
  institution?: string;
  completed?: boolean;
  notes?: string;
};

export type EducationHistory = {
  highestYearCompleted?: string;
  leftSchoolEarly?: boolean;
  schoolName?: string;
  tertiaryStudies?: TertiaryStudy[];
  additionalNarrative?: string;
};

// ── Work ─────────────────────────────────────────────────────────────────
// Lives alongside the canonical WorkTimeline (which tracks assessor work
// done on the case). WorkHistoryEntry describes the claimant's employment
// history — distinct chronology, no overlap.
export type WorkHistoryEntry = {
  id: UUID;
  employer?: string;
  role?: string;
  startDate?: PartialDate;
  endDate?: PartialDate;
  current?: boolean;
  reasonForLeaving?: string;
  notes?: string;
};

// ── General medical ──────────────────────────────────────────────────────
export type MedicalCondition = {
  id: UUID;
  condition: string;
  severity?: "mild" | "moderate" | "severe";
  active?: boolean;
  notes?: string;
};

// ── Treatment ────────────────────────────────────────────────────────────
export type TreatmentCategory =
  | "medication"
  | "psychological"
  | "psychiatric"
  | "gp"
  | "hospital"
  | "group_program"
  | "neuromodulation"
  | "other";

export type PerceivedBenefit =
  | "none"
  | "minimal"
  | "partial"
  | "moderate"
  | "significant";

export type MedicationClass =
  | "ssri"
  | "snri"
  | "tricyclic"
  | "maoi"
  | "antipsychotic_typical"
  | "antipsychotic_atypical"
  | "mood_stabilizer"
  | "anxiolytic"
  | "hypnotic"
  | "stimulant"
  | "other";

export type DoseUnit = "mcg" | "mg" | "g";

export type TreatmentEntry = {
  id: UUID;
  category: TreatmentCategory;
  subtype?: string;
  name: string;
  providerName?: string;
  indication?: string;

  commenced?: PartialDate;
  ceased?: PartialDate;
  current: boolean;
  durationText?: string;

  frequency?: FrequencyValue;

  perceivedBenefit?: PerceivedBenefit;
  ceasedReason?: string;
  notes?: string;

  // ── Medication-only fields (typed extension, NOT a separate entity) ──
  drugClass?: MedicationClass;
  dose?: { value?: number; unit?: DoseUnit };
  sideEffects?: string;
};

export type FutureTreatmentPlan = {
  recommended?: string[];
  notes?: string;
};

export type TreatmentHistory = {
  treatments: TreatmentEntry[];
  futureTreatment?: FutureTreatmentPlan;
  treatmentNarrativeAdditions?: string[];
};

// ── Root ─────────────────────────────────────────────────────────────────
export type PsychiatricHistory = {
  preExistingEvents: HistoryEvent[];
  subsequentEvents: HistoryEvent[];

  psychiatricDenials: PsychiatricDenials;
  familyHistory: FamilyHistory;
  developmentalHistory: DevelopmentalHistory;
  educationHistory: EducationHistory;

  workHistory: WorkHistoryEntry[];
  generalMedicalHistory: MedicalCondition[];

  treatmentHistory: TreatmentHistory;

  narrativeAdditions?: string[];
};

// ── Defaults ─────────────────────────────────────────────────────────────
export function defaultPsychiatricDenials(): PsychiatricDenials {
  return {
    deniedPreExistingPsychHistory: false,
    deniedMentalHealthAdmissions: false,
    deniedSelfHarmHistory: false,
    deniedViolenceHistory: false,
  };
}

export function defaultPsychiatricHistory(): PsychiatricHistory {
  return {
    preExistingEvents: [],
    subsequentEvents: [],
    psychiatricDenials: defaultPsychiatricDenials(),
    familyHistory: { knownPsychiatricFamilyHistory: "unknown" },
    developmentalHistory: {},
    educationHistory: {},
    workHistory: [],
    generalMedicalHistory: [],
    treatmentHistory: { treatments: [] },
    narrativeAdditions: [],
  };
}

// ── PartialDate utilities ────────────────────────────────────────────────
export function isEmptyPartialDate(d: PartialDate | undefined | null): boolean {
  return !d || (d.year == null && d.month == null && d.day == null);
}

// Year-first sort key for chronological ordering. Missing components sort
// last within their resolution bucket. Never used for time math.
export function partialDateSortKey(d: PartialDate | undefined): number {
  if (!d || d.year == null) return Number.POSITIVE_INFINITY;
  const y = d.year * 10000;
  const m = (d.month ?? 13) * 100;
  const day = d.day ?? 32;
  return y + m + day;
}
