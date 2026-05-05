// src/types/types.ts

// ── PIRS category key — stable internal identifier ────────────────────────────

export type PirsCategoryKey =
  | "selfCare"
  | "socialRecreational"
  | "travel"
  | "socialFunction"
  | "concentration"
  | "adaptation";

// ── Shared enum types for structured fields ───────────────────────────────────

export type IndependenceLevel =
  | "independent" | "independent_with_difficulty"
  | "requires_prompting" | "requires_assistance" | "dependent" | "";

export type PromptingLevel = "none" | "occasional" | "regular" | "constant" | "";
export type SupportType = "none" | "informal" | "formal" | "";
export type PreInjuryComparisonLevel = "same" | "better" | "worse" | "";
export type InitiationLevel = "self_initiated" | "prompted" | "avoidant" | "";
export type InvolvementLevel = "active" | "passive" | "withdrawn" | "";
export type AbilityContext = "alone" | "with_support" | "unable" | "";
export type DifficultyLevel = "none" | "mild" | "moderate" | "severe" | "";
export type ConsistencyLevel = "consistent" | "reduced" | "erratic" | "";
export type RelationshipQuality = "good" | "strained" | "conflict" | "no_relationship" | "";
export type DependencyLevel = "independent" | "provides_care" | "receives_care" | "";
export type LivingArrangement =
  | "alone" | "with_partner" | "with_children" | "with_parents" | "with_others" | "";
export type CareResponsibility = "full" | "shared" | "others" | "";
export type EmploymentStatus =
  | "full_time" | "part_time" | "casual" | "unemployed"
  | "not_seeking" | "retired" | "student" | "";

// ── Legacy structured fields (kept for backward compat) ───────────────────────

export type CategoryStructuredFields = {
  frequency?: string;
  independenceLevel?: string;
  supportRequirement?: string;
  recency?: string;
  preInjuryComparison?: string;
};

// ── Per-category subdomain data (stored as typed-but-opaque in ReasonEntry) ──

export type CommonSubdomainEntry = {
  // ── Negative overrides ────────────────────────────────────────────────────
  doesNotPerform?: boolean;
  noIssues?: boolean;

  // ── Primary management control (replaces independenceLevel + prompting + support) ──
  managementLevel?: string; // "independent" | "independent_difficulty" | "needs_prompting" | "needs_assistance" | "dependent"

  // ── Behaviour modifiers (multi-select) ────────────────────────────────────
  behaviourModifiers?: string[];

  // ── Hybrid frequency control ──────────────────────────────────────────────
  frequencyUnit?: string;   // "Day" | "Week" | "Fortnight" | "Month"
  frequencyCount?: string;  // "1" | "2–3" | "4–5" | "Daily" or custom

  // ── Conditional: prompting ────────────────────────────────────────────────
  promptingWhoChips?: string[];
  promptingWhoOther?: string;
  promptingFrequencyUnit?: string;
  promptingFrequencyCount?: string;

  // ── Conditional: assistance / dependent ──────────────────────────────────
  assistWhoChips?: string[];
  assistWhoOther?: string;
  supportHoursChip?: string;   // "<5" | "5–10" | "10–20" | ">20"
  supportHoursCustom?: string;

  // ── Recency (numeric + unit + sinceInjury) ────────────────────────────────
  recencyNumber?: string;        // e.g. "3"
  recencyUnit?: string;          // "days" | "weeks" | "months" | "years"
  recencySinceInjury?: boolean;  // when true: "has not [verb] since the injury"

  // Legacy recency (retained for backward compat — not rendered in new UI)
  recencyValue?: string;    // "Today" | "This week" | "This month" | "1–3 months" | ">3 months" | "Never"
  recencyOverride?: string;

  // ── Pre-injury comparison ─────────────────────────────────────────────────
  preInjuryComparison?: PreInjuryComparisonLevel;
  preInjuryComparisonNotes?: string;

  // ── Free text / evidence ─────────────────────────────────────────────────
  optionalFreeText?: string;
  evidenceSnippets?: string[];

  // ── Legacy (kept for type compat, not rendered in UI) ─────────────────────
  frequency?: string;
  independenceLevel?: IndependenceLevel;
  promptingRequired?: boolean;
  prompting?: PromptingLevel;
  promptingWho?: string;
  supportType?: SupportType;
  supportHoursPerWeek?: string;
  recency?: string;
};

export type SocialSubdomainEntry = CommonSubdomainEntry & {
  initiation?: InitiationLevel;
  involvementLevel?: InvolvementLevel;
  supportPersonRequired?: boolean;
  supportPersonDetails?: string;
  activityTypes?: string[];
  participationFrequency?: string;
  avoidanceBehaviour?: boolean;
  avoidanceReasons?: string[];
  motivationLevel?: string;
  socialEngagementType?: string;
};

export type TravelSubdomainEntry = {
  doesNotTravel?: boolean;
  cannotLeaveResidence?: boolean;
  independenceLevel?: IndependenceLevel;
  supportType?: SupportType;
  supportHoursPerWeek?: string;
  distanceCapacity?: string;
  abilityContext?: AbilityContext;
  recency?: string;
  preInjuryComparison?: PreInjuryComparisonLevel;
  preInjuryComparisonNotes?: string;
  travelMode?: string[];
  frequencyOfTravel?: string;
  drivingStatus?: string;
  safetyIssues?: boolean;
  safetyDescription?: string;
  evidenceSnippets?: string[];
};

export type RelationshipEntry = {
  status?: string;
  quality?: RelationshipQuality;
  contactFrequency?: string;
  dependency?: DependencyLevel;
  evidenceSnippets?: string[];
};

export type ChildrenEntry = RelationshipEntry & {
  numberOfChildren?: number;
  ages?: string;
  careResponsibility?: CareResponsibility;
};

export type SocialFunctioningData = {
  noPartner?: boolean;
  noChildren?: boolean;
  parentsDeceased?: boolean;
  noSiblings?: boolean;
  noCloseFriends?: boolean;
  livingArrangement?: LivingArrangement;
  livingArrangementDetails?: string;
  domesticViolenceHistory?: boolean;
  partner?: RelationshipEntry;
  children?: ChildrenEntry;
  parents?: RelationshipEntry;
  siblings?: RelationshipEntry;
  friends?: RelationshipEntry;
};

export type ConcentrationSubdomainEntry = {
  cannotSustainAttention?: boolean;
  severeImpairment?: boolean;
  durationCapacity?: string;
  fatigueOnset?: string;
  difficultyLevel?: DifficultyLevel;
  supportRequired?: string;
  recency?: string;
  preInjuryComparison?: PreInjuryComparisonLevel;
  preInjuryComparisonNotes?: string;
  studyAbility?: boolean;
  studySupport?: string;
  memoryIssues?: boolean;
  memoryIssueType?: string[];
  evidenceSnippets?: string[];
};

export type EmployabilitySubdomainEntry = {
  notWorking?: boolean;
  notSeekingWork?: boolean;
  employmentStatus?: EmploymentStatus;
  hoursPerWeek?: string;
  consistency?: ConsistencyLevel;
  barriers?: string;
  lastEmployment?: string;
  preInjuryComparison?: PreInjuryComparisonLevel;
  preInjuryComparisonNotes?: string;
  jobTypeHistory?: string;
  workAttemptsSinceInjury?: string;
  inconsistentHistoryFlag?: boolean;
  barrierTypes?: string[];
  evidenceSnippets?: string[];
};

// ── ReasonEntry — extended with subdomain data ────────────────────────────────

export type ReasonEntry = {
  rationale?: string;
  findings?: string;
  findingsManuallyEdited?: boolean;
  structured?: CategoryStructuredFields;
  evidenceSnippets?: string[];
  subdomainData?: Record<string, unknown>;
};

export type PIRSResult = {
  classes: number[];
  total: number;
  median: number;
  initWPI: number;
  preAdj: number;
  preText: string;
  treat: number;
  treatText: string;
  final: number;
};

export type PIRSTableModel = {
  id: string;
  name: string;
  classes: number[];
  reasons?: ReasonEntry[];
  preExisting: number;      // 0–100
  treatmentEffect: number;  // 0–3
  assessorError?: string;

  // Previous Assessor comparison fields
  assessorClasses?: number[]; // 6 entries, 1–5
  assessorTotal?: number;
  assessorMedian?: number;
  assessorInitWPI?: number;
  assessorPreAdj?: number;
  assessorTreat?: number;
  assessorFinal?: number;
};
