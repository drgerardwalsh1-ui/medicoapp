// ── Layer 0 — FROZEN ontology ──────────────────────────────────────────────────
// Read-only at runtime. DSM criteria definitions are static and are NEVER
// rewritten. This module is the foundational vocabulary: every other module
// imports its branded ids from here. It imports nothing.

// ── Branded ids ────────────────────────────────────────────────────────────────
type Brand<T, B> = T & { readonly __brand: B };

export type SymptomTypeId  = Brand<string, "SymptomTypeId">;  // frozen
export type DiagnosisId    = Brand<string, "DiagnosisId">;    // frozen
export type CriterionId    = Brand<string, "CriterionId">;    // frozen
export type ObservationId  = Brand<string, "ObservationId">;  // clinician-written
export type EpisodeId      = Brand<string, "EpisodeId">;      // generated + correctable
export type EvidenceNodeId = Brand<string, "EvidenceNodeId">; // generated only
export type AttestationId  = Brand<string, "AttestationId">;  // clinician-written
export type ConflictId     = Brand<string, "ConflictId">;     // generated, clinician-resolved

// ── Clinical frames ──────────────────────────────────────────────────────────
// The same phenomenon in different frames is a different Observation, never a
// shared object (prevents subjective/observed mood collapse).
export type Frame = "subjective" | "observed" | "collateral" | "documentary";

// ── Course model — diagnosis-driven, never clinician-selected ──────────────────
export type CourseModel = "episodic" | "continuous";

// ── Criteria ───────────────────────────────────────────────────────────────────
export type CriterionType =
  | "symptom_count"
  | "impairment"
  | "exclusion"
  | "differential"
  | "mood_exclusion";

export type CriterionRequirement = {
  readonly criterionId: CriterionId;
  readonly type: CriterionType;
  readonly minRequired?: number;
  readonly mandatoryAnchorSymptomTypeIds?: readonly SymptomTypeId[];
  readonly requiresTemporalCoOccurrence?: boolean;
};

// ── Frozen entities ──────────────────────────────────────────────────────────
export type SymptomType = {
  readonly id: SymptomTypeId;
  readonly label: string;
  readonly frames: readonly Frame[];
};

export type Diagnosis = {
  readonly id: DiagnosisId;
  readonly name: string;
  readonly courseModel: CourseModel;
  readonly criteria: readonly CriterionRequirement[];
  readonly dsmVersion: "DSM-5-TR";
};

// SymptomType → CriterionRequirement edge. Bidirectionally validated at build
// time (every criterionId exists; every count criterion has ≥1 inbound mapping;
// no orphan mappings).
export type Mapping = {
  readonly symptomTypeId: SymptomTypeId;
  readonly diagnosisId: DiagnosisId;
  readonly criterionId: CriterionId;
};

// ── Frozen ontology bundle (the only read source for inference) ──────────────
export type Ontology = {
  readonly symptomTypes: readonly SymptomType[];
  readonly diagnoses: readonly Diagnosis[];
  readonly mappings: readonly Mapping[];
};
