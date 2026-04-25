/* =========================================================
   CORE DOMAIN MODEL — SINGLE SOURCE OF TRUTH
   ========================================================= */

/* ========================
   CLIENT (ROOT OBJECT)
======================== */
// ─────────────────────────────────────────────────────────────────────────────
// CASE OBJECT SCHEMA  v1.1.0
//
// ARCHITECTURE NOTE
// This schema is the domain model — the normalised, source-attributed
// representation of a medico-legal case. It is NOT a view model.
//
// UI CONSUMPTION RULE (applies to the entire schema):
//   Every UI component MUST consume a mapped view model derived from this
//   schema, not the raw CaseObject directly. Attributed<T> is intentionally
//   verbose — it is designed for storage, reasoning, and conflict detection,
//   not for rendering.
//
//   Mapping layer responsibilities:
//     - Extract .value from Attributed<T> for display
//     - Collapse source arrays to badge counts or tooltips
//     - Flatten nested structures into table rows / form fields
//     - Gate on confidence thresholds
//
// FIELD NAMING CONVENTIONS (enforced throughout):
//   narrative  → structured medico-legal prose; forms part of the report output
//   notes      → freeform auxiliary text; for internal reference, not report output
//   _pipeline  → extraction / debug metadata; never surfaced in UI or domain logic
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// FOUNDATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" */
type ISODate = string;

/**
 * Date with variable precision.
 * "YYYY-MM-DD" | "YYYY-MM" | "YYYY" | "circa YYYY"
 * Never force false precision — use the lowest-resolution form the evidence supports.
 */
type ISODateOrApprox = string;

type ExtractionMethod =
  | 'ocr'         // raw OCR pipeline output
  | 'nlp'         // spaCy / scispaCy NER
  | 'rule_based'  // regex / keyword matching
  | 'validated'   // passed entity_clean + validation layer
  | 'manual';     // human-entered or manually corrected

type MedicoLegalDocumentType =
  | 'gp_notes'
  | 'specialist_report'
  | 'psychological_report'
  | 'psychiatric_report'
  | 'ime_report'
  | 'current_assessment'
  | 'imaging_report'
  | 'hospital_records'
  | 'pharmacy_records'
  | 'allied_health_notes'
  | 'employment_records'
  | 'legal_correspondence'
  | 'claimant_statement'
  | 'index_document'
  | 'other';


// ─────────────────────────────────────────────────────────────────────────────
// SOURCE ATTRIBUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single evidence reference to a specific location in a source document.
 * Attached to every Attributed<T> value.
 */
interface SourceRef {
  documentId:       string;       // FK → DocumentRecord.id
  documentType:     MedicoLegalDocumentType;
  authorId:         string | null; // FK → Clinician.id
  pageNumber:       number | null;
  characterOffset:  number | null; // precise position in extracted text
  snippet:          string;        // verbatim text — never paraphrased
  confidence:       number;        // extraction confidence for this item (0.0–1.0)
  extractionMethod: ExtractionMethod;
}

/**
 * A value with full source attribution and conflict awareness.
 *
 * UI USAGE:
 *   Do NOT render Attributed<T> directly.
 *   Map to a view model that extracts .value for display and surfaces
 *   .sources and .conflicting as secondary affordances (badges, tooltips).
 *   Use .confidence to gate display or flag uncertain values.
 *
 * DOMAIN USAGE:
 *   .value  — use for reasoning, narrative generation, and PIRS logic
 *   .sources — use for provenance, audit, and snippet display
 *   .conflicting — use for conflict detection and report flagging
 */
interface Attributed<T> {
  value:       T;
  sources:     SourceRef[];
  confidence:  number;        // aggregate confidence across all sources (0.0–1.0)
  /**
   * References to CaseConflict objects where another source yields a
   * different value for this same field.
   * DO NOT resolve silently — represent both values explicitly.
   */
  conflicting: ConflictRef[];
}

/** Lightweight pointer to a CaseConflict, used inside Attributed<T> */
interface ConflictRef {
  conflictId: string; // FK → CaseConflict.id
  summary:    string; // one-line human-readable description
}


// ─────────────────────────────────────────────────────────────────────────────
// CASE OBJECT ROOT
// ─────────────────────────────────────────────────────────────────────────────

interface CaseObject {
  schemaVersion: '1.1.0';
  caseId:        string;
  generatedAt:   string; // ISO datetime

  pipeline: {
    ocrMethod:        string; // e.g. "tesseract-5.3 + pdf-extract"
    nlpModel:         string; // e.g. "en_core_sci_md"
    cleanerVersion:   string;
    validatorVersion: string;
  };

  patient:           PatientProfile;
  clinicians:        Clinician[];
  diagnoses:         Diagnosis[];
  symptoms:          Symptom[];
  medications:       Medication[];
  procedures:        Procedure[];
  timeline:          TimelineEvent[];
  conflicts:         CaseConflict[];
  documentMap:       DocumentRecord[];
  pirsAssessments:   PIRSAssessment[];
  currentAssessment: CurrentAssessment | null;
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. PATIENT PROFILE
// ─────────────────────────────────────────────────────────────────────────────

type EmploymentStatus =
  | 'employed_full_time'
  | 'employed_part_time'
  | 'employed_modified_duties'
  | 'unemployed_seeking'
  | 'unemployed_not_seeking'
  | 'unable_to_work'
  | 'retired'
  | 'student'
  | 'unknown';

interface PatientProfile {
  id:          string;
  name:        Attributed<string>;
  dateOfBirth: Attributed<ISODate>;
  age:         Attributed<number>;   // age at date of first extracted document
  sex:         Attributed<'male' | 'female' | 'other' | 'unknown'>;
  address:     Attributed<string> | null;

  // ── Claim / legal context ────────────────────────────────────────────────
  claimNumbers:        Attributed<string[]>;
  insurer:             Attributed<string> | null;
  legalRepresentation: Attributed<string> | null;

  // ── Injury context ───────────────────────────────────────────────────────
  dateOfInjury:    Attributed<ISODateOrApprox> | null;
  /** Canonical mechanism: "motor vehicle accident", "workplace fall", etc. */
  injuryMechanism: Attributed<string> | null;
  indexEventId:    string | null; // FK → TimelineEvent.id

  // ── Employment ───────────────────────────────────────────────────────────
  occupationAtInjury:      Attributed<string> | null;
  employer:                Attributed<string> | null;
  currentEmploymentStatus: Attributed<EmploymentStatus>;

  // ── Pre-injury baseline ───────────────────────────────────────────────────
  /**
   * Narrative: structured description of pre-injury functioning used to
   * establish the counterfactual baseline for medico-legal reasoning.
   * Forms part of the case narrative — not freeform.
   */
  preInjuryFunctioningNarrative: Attributed<string> | null;
  preExistingConditions:         Attributed<string[]>;
  /**
   * Narrative: relevant medical and social history prior to the index event.
   * Used in report generation — distinct from preInjuryFunctioningNarrative
   * which focuses on functional capacity.
   */
  relevantHistoryNarrative: Attributed<string> | null;
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. CLINICIANS
// ─────────────────────────────────────────────────────────────────────────────

type ClinicalRole =
  | 'treating_gp'
  | 'treating_psychiatrist'
  | 'treating_psychologist'
  | 'treating_specialist'    // orthopaedic, neurologist, etc.
  | 'treating_allied_health' // physio, OT, etc.
  | 'ime_psychiatrist'
  | 'ime_psychologist'
  | 'ime_physician'
  | 'ime_orthopaedic'
  | 'ime_neurologist'
  | 'current_assessor'       // author of CurrentAssessment
  | 'radiologist'
  | 'pharmacist'
  | 'other';

interface Clinician {
  id:           string;
  name:         Attributed<string>;
  role:         ClinicalRole;
  speciality:   Attributed<string> | null;
  credentials:  Attributed<string> | null; // e.g. "MBBS, FRANZCP"
  organisation: Attributed<string> | null;
  documentIds:  string[];                  // FK[] → DocumentRecord.id
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. DIAGNOSES
// ─────────────────────────────────────────────────────────────────────────────

type DiagnosisStatus =
  | 'confirmed'
  | 'provisional'
  | 'rule_out'
  | 'ruled_out'
  | 'contested'
  | 'historical_resolved'
  | 'pre_existing'
  | 'pre_existing_aggravated';

type DiagnosisPriority = 'primary' | 'secondary' | 'comorbidity';

type CausationOpinionType =
  | 'caused_by_index_event'
  | 'materially_contributed_to'
  | 'aggravated_by_index_event'
  | 'unrelated'
  | 'unknown';

interface CausationOpinion {
  clinicianId: string; // FK → Clinician.id
  opinion:     CausationOpinionType;
  /** Verbatim or close-paraphrase rationale from the source document */
  rationale:   string;
  sources:     SourceRef[];
  confidence:  number;
}

/**
 * A clinician who names, classifies, or characterises this diagnosis differently
 * from the majority/consensus position. Preserved in full — never discarded.
 */
interface DiagnosisDissentingOpinion {
  clinicianId:     string;
  theirTerm:       string;
  theirStatus:     DiagnosisStatus;
  theirCausation:  CausationOpinionType;
  /** Verbatim or close-paraphrase rationale */
  rationale:       string;
  sources:         SourceRef[];
  conflictId:      string | null; // FK → CaseConflict.id
}

interface Diagnosis {
  id:       string;
  term:     Attributed<string>;        // canonical term post entity_clean + validation
  icd10Code: Attributed<string> | null;
  status:   Attributed<DiagnosisStatus>;
  priority: DiagnosisPriority;

  // ── Temporal ─────────────────────────────────────────────────────────────
  onsetDate:      Attributed<ISODateOrApprox> | null;
  resolutionDate: Attributed<ISODateOrApprox> | null;

  // ── Causation ────────────────────────────────────────────────────────────
  /**
   * One entry per clinician who offered a causation opinion.
   * When assessors disagree, all opinions are listed here AND a
   * CaseConflict of type 'causation_disagreement' is created.
   */
  causationOpinions:   CausationOpinion[];
  dissentingOpinions:  DiagnosisDissentingOpinion[];

  // ── Related entities ─────────────────────────────────────────────────────
  symptomIds:   string[]; // FK[] → Symptom.id
  timelineIds:  string[]; // FK[] → TimelineEvent.id

  /**
   * notes: freeform auxiliary text — internal reference only, not report output.
   * Use causationOpinions[].rationale for structured clinical content.
   */
  notes: string | null;
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. SYMPTOMS / FUNCTIONAL DESCRIPTORS
// ─────────────────────────────────────────────────────────────────────────────

type PIRSDomain =
  | 'activities_of_daily_living'
  | 'social_recreational_activities'
  | 'travel'
  | 'social_functioning'
  | 'concentration_persistence_pace'
  | 'employability';

type SymptomCategory =
  | 'psychological'   // mood, trauma, anxiety
  | 'cognitive'       // concentration, memory, processing speed
  | 'somatic'         // pain, fatigue, physical symptoms
  | 'functional'      // limitations in specific activities
  | 'behavioural'     // avoidance, hypervigilance, withdrawal
  | 'sleep'           // insomnia, nightmares, hypersomnia
  | 'interpersonal';  // relational impact

type SeverityLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'extreme';

type ConsistencyRating =
  | 'consistent_across_sources'
  | 'partially_consistent'
  | 'inconsistent'
  | 'single_source_only'
  | 'unverified';

interface Symptom {
  id:          string;
  description: Attributed<string>;
  category:    SymptomCategory;
  /** Which PIRS domain this symptom most directly informs */
  pirsDomain:  PIRSDomain | null;

  severity:   Attributed<SeverityLevel> | null;
  frequency:  Attributed<string> | null; // "daily", "3–4 times per week"
  duration:   Attributed<string> | null; // "since October 2021"

  // ── Temporal ─────────────────────────────────────────────────────────────
  onset:   Attributed<ISODateOrApprox> | null;
  ongoing: Attributed<boolean>;

  /**
   * functionalImpactNarrative: structured description of how this symptom
   * limits functioning. Used directly in PIRS domain reasoning and narrative
   * generation — not freeform. Renamed from `functionalImpact` for clarity.
   */
  functionalImpactNarrative: Attributed<string> | null;

  /**
   * Consistency of this symptom across all sources.
   * Inconsistent symptoms are represented here — not suppressed.
   * A CaseConflict of type 'symptom_inconsistency' is created when inconsistent.
   */
  consistency: ConsistencyRating;

  diagnosisId: string | null; // FK → Diagnosis.id
  sources:     SourceRef[];
}


// ─────────────────────────────────────────────────────────────────────────────
// 5. MEDICATIONS
// ─────────────────────────────────────────────────────────────────────────────

type MedicationStatus = 'active' | 'ceased' | 'on_hold' | 'unknown';

interface Medication {
  id:        string;
  drugName:  Attributed<string>;       // canonical generic name post synonym expansion
  brandName: Attributed<string> | null;
  dose:      Attributed<string> | null; // "75 mg"
  frequency: Attributed<string> | null; // "twice daily"
  route:     Attributed<string> | null; // "oral", "IM"
  indication: Attributed<string> | null;

  prescriberId: string | null; // FK → Clinician.id

  // ── Temporal ─────────────────────────────────────────────────────────────
  startDate: Attributed<ISODateOrApprox> | null;
  endDate:   Attributed<ISODateOrApprox> | null;
  ongoing:   Attributed<boolean>;
  status:    MedicationStatus;

  diagnosisId: string | null; // FK → Diagnosis.id
  sources:     SourceRef[];
}


// ─────────────────────────────────────────────────────────────────────────────
// 6. PROCEDURES / TREATMENTS
// ─────────────────────────────────────────────────────────────────────────────

type ProcedureType =
  | 'surgical'
  | 'injection'
  | 'physiotherapy'
  | 'psychological_therapy'
  | 'psychiatric_treatment'
  | 'occupational_therapy'
  | 'rehabilitation_program'
  | 'diagnostic_imaging'
  | 'diagnostic_neuropsychological'
  | 'diagnostic_functional_capacity'
  | 'independent_medical_examination'
  | 'mediation_or_legal'
  | 'other';

interface Procedure {
  id:            string;
  name:          Attributed<string>;
  procedureType: ProcedureType;

  providerId: string | null; // FK → Clinician.id
  facility:   Attributed<string> | null;

  // ── Temporal ─────────────────────────────────────────────────────────────
  date:          Attributed<ISODateOrApprox> | null;
  endDate:       Attributed<ISODateOrApprox> | null;
  ongoing:       Attributed<boolean>;
  frequency:     Attributed<string> | null;  // "weekly", "fortnightly"
  totalSessions: Attributed<number> | null;

  /**
   * outcomeNarrative: structured clinical outcome description.
   * Used in treatment history narrative generation — not freeform.
   * Renamed from `outcome` to align naming convention.
   */
  outcomeNarrative: Attributed<string> | null;

  diagnosisId: string | null; // FK → Diagnosis.id
  sources:     SourceRef[];
}


// ─────────────────────────────────────────────────────────────────────────────
// 7. TIMELINE
// ─────────────────────────────────────────────────────────────────────────────

type TimelineEventType =
  | 'index_event'
  | 'consultation'
  | 'diagnosis_made'
  | 'procedure'
  | 'medication_initiated'
  | 'medication_ceased'
  | 'medication_changed'
  | 'functional_change'   // reported improvement or deterioration
  | 'legal_event'
  | 'assessment'
  | 'imaging'
  | 'return_to_work'
  | 'work_cessation'
  | 'other';

type LinkedEntityType =
  | 'diagnosis'
  | 'medication'
  | 'procedure'
  | 'symptom'
  | 'clinician'
  | 'pirs_assessment';

interface LinkedEntity {
  entityType: LinkedEntityType;
  entityId:   string;
}

interface TimelineEvent {
  id:          string;
  date:        ISODateOrApprox;
  dateApprox:  boolean;
  eventType:   TimelineEventType;
  title:       string; // short human-readable label for display
  description: string; // full description drawn from source text, not inferred

  linkedEntities: LinkedEntity[];
  clinicianId:    string | null; // FK → Clinician.id
  sources:        SourceRef[];
  confidence:     number;
}


// ─────────────────────────────────────────────────────────────────────────────
// 8. CONFLICTS / DISCREPANCIES
// First-class objects — not flags, not annotations.
// ─────────────────────────────────────────────────────────────────────────────

type ConflictType =
  | 'diagnosis_disagreement'
  | 'causation_disagreement'
  | 'severity_disagreement'
  | 'pirs_disagreement'
  | 'timeline_inconsistency'
  | 'symptom_inconsistency'
  | 'history_inconsistency'
  | 'medication_inconsistency'
  | 'functional_inconsistency'
  | 'credibility_concern';

type ConflictSeverity =
  | 'minor'       // wording or administrative difference — no material impact
  | 'moderate'    // meaningful difference — warrants noting in report
  | 'significant' // material impact on impairment or causation opinion
  | 'fundamental'; // irreconcilable — directly affects claim outcome

type ConflictSourceRole =
  | 'treating_clinician'
  | 'ime_assessor'
  | 'current_assessor'
  | 'patient_reported'
  | 'objective_record'; // imaging, pharmacy records, etc.

interface ConflictPosition {
  clinicianId: string | null; // null if patient-reported or objective record
  sourceRole:  ConflictSourceRole;
  claim:       string; // clear assertion of what this position holds
  rationale:   string; // supporting rationale, verbatim or close-paraphrase
  sources:     SourceRef[];
}

type ConflictResolutionStatus =
  | 'unresolved'
  | 'partially_resolved'
  | 'resolved_by_assessor'
  | 'resolved_by_evidence';

interface ConflictResolution {
  status:     ConflictResolutionStatus;
  rationale:  string;
  resolvedBy: string | null; // FK → Clinician.id, or null if resolved by evidence
  resolvedAt: ISODate | null;
}

interface CaseConflict {
  id:           string;
  conflictType: ConflictType;
  severity:     ConflictSeverity;
  title:        string;       // short label
  description:  string;       // full description of the disagreement

  /**
   * One position per party — minimum two.
   * Order is not significant.
   */
  positions: ConflictPosition[];

  /**
   * Null until the current assessor addresses this conflict.
   * Populated via CurrentAssessment.conflictsAddressed.
   */
  resolution: ConflictResolution | null;

  relatedEntityIds: string[]; // FK[] to any entity type
}


// ─────────────────────────────────────────────────────────────────────────────
// 9. DOCUMENT MAP
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentQuality {
  ocrConfidence:       number;  // average across document (0.0–1.0)
  textLayerAvailable:  boolean;
  ocrUsed:             boolean;
  characterCount:      number;
  extractionMethod:    ExtractionMethod;
  warnings:            string[]; // e.g. "low OCR confidence on pages 4–6"
}

interface DocumentEntitySummary {
  diagnosisCount:  number;
  medicationCount: number;
  procedureCount:  number;
  dateCount:       number;
  hasPIRS:         boolean;
  hasConflicts:    boolean;
}

interface DocumentRecord {
  id:           string;
  fileName:     string;
  documentType: MedicoLegalDocumentType;
  authorId:     string | null;         // FK → Clinician.id
  date:         ISODateOrApprox | null; // date authored
  dateReceived: ISODate | null;

  quality:       DocumentQuality;
  entitySummary: DocumentEntitySummary;
  metadata:      Record<string, string>; // additional key–value from headers / filename
}


// ─────────────────────────────────────────────────────────────────────────────
// 10. PIRS ASSESSMENTS
//
// Modelled semantically — NOT as a table.
// Handles: inconsistent formats, swapped columns, narrative-only extraction,
// partial data, and varying domain label conventions.
//
// FIELD SEPARATION:
//   Domain fields (for reasoning, report generation, conflict detection):
//     assessorId, documentId, assessmentDate, diagnosisRated,
//     domainRatings, overallImpairment, partial, sources
//
//   Pipeline/debug fields (for audit and extraction QA only):
//     Grouped under _pipeline — see below.
//     These must NOT be consumed by UI components or domain logic.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Class 1 = no impairment (0%)
 * Class 2 = mild (1–10%)
 * Class 3 = moderate (11–30%)
 * Class 4 = severe (31–60%)
 * Class 5 = extreme (61–100%)
 */
type PIRSClass = 1 | 2 | 3 | 4 | 5;

type PIRSDerivationMethod =
  | 'stated_directly'
  | 'calculated_mean'
  | 'calculated_weighted'
  | 'unknown';

/** How the source document presented PIRS data — extraction metadata only */
type PIRSTableFormat =
  | 'structured_table'
  | 'transposed_table'    // rows and columns swapped vs. standard layout
  | 'column_swapped'      // class / percentage columns in unexpected order
  | 'narrative'           // no table — ratings embedded in prose
  | 'mixed'
  | 'unknown';

/** Extraction method used for this specific domain rating — extraction metadata only */
type DomainExtractionMethod =
  | 'table_parsed'
  | 'narrative_extracted'
  | 'inferred'
  | 'manual';

// ── Domain rating — domain model ─────────────────────────────────────────────

interface PIRSDomainRating {
  // ── Domain model fields ─────────────────────────────────────────────────
  domain:      PIRSDomain;
  /**
   * Verbatim label from source document — preserved because assessors use
   * varying terminology. Compare with canonical `domain` for alignment.
   */
  domainLabel: string;
  /**
   * Null when class could not be determined from the source.
   * Do NOT default to 1 — represent the uncertainty explicitly.
   */
  class:       PIRSClass | null;
  /**
   * Explicit percentage if stated; null if only the class was given.
   * Do not calculate or infer this from the class range.
   */
  percentage:  number | null;
  /**
   * rationale: the assessor's own structured reasoning for this domain rating.
   * Verbatim or close-paraphrase from the source — never inferred.
   * Forms part of the PIRS report section — not freeform.
   */
  rationale:   string;

  // ── Extraction metadata — do not use in domain logic or UI ──────────────
  /**
   * Verbatim text from which this rating was extracted.
   * For audit and extraction QA only.
   */
  rawText:          string;
  extractionMethod: DomainExtractionMethod;
  /** Confidence that the extraction correctly captured the assessor's intent */
  confidence:       number;
}

// ── PIRS Assessment ───────────────────────────────────────────────────────────

interface PIRSAssessment {
  // ── Domain model ─────────────────────────────────────────────────────────
  id:          string;
  assessorId:  string;                            // FK → Clinician.id
  documentId:  string;                            // FK → DocumentRecord.id
  assessmentDate: Attributed<ISODateOrApprox>;

  /** The diagnosis being rated — may differ between assessors */
  diagnosisRated: Attributed<string>;

  /**
   * Domain ratings. Partial arrays are valid — absent domains must not be
   * defaulted. Missing domains signal an incomplete assessment.
   */
  domainRatings: PIRSDomainRating[];

  /**
   * Null if the assessor did not state or calculate an overall impairment.
   * Do not calculate this on behalf of the assessor unless flagged as such.
   */
  overallImpairment: {
    percentage:       number;
    derivationMethod: PIRSDerivationMethod;
    /** Verbatim statement from the source */
    rawText:          string;
    confidence:       number;
  } | null;

  /**
   * True if one or more PIRS domains are absent from this assessment.
   * Domain model field — relevant to conflict detection and report flagging.
   */
  partial: boolean;

  sources: SourceRef[];

  /**
   * notes: freeform auxiliary text about this assessment.
   * For internal reference only — not report output.
   * See domainRatings[].rationale for structured clinical content.
   */
  notes: string;

  // ── Pipeline / debug metadata ─────────────────────────────────────────────
  /**
   * Extraction and pipeline metadata.
   *
   * UI RULE: These fields must NOT be rendered or consumed by UI components.
   * They are preserved for:
   *   - Extraction pipeline debugging
   *   - Manual review and correction workflows
   *   - Audit trails
   *   - Quality assurance on scanned / OCR-heavy documents
   */
  _pipeline: {
    /** How the source document presented its PIRS data */
    tableFormat:     PIRSTableFormat;
    /** True if column ordering issues were detected during extraction */
    columnSwapped:   boolean;
    /** Verbatim text block that was parsed to produce this assessment */
    rawExtract:      string;
    /** Freeform extraction notes — anomalies, warnings, manual corrections */
    extractionNotes: string;
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 11. CURRENT ASSESSMENT
//
// The medico-legal assessor's own structured evaluation.
// Completely separated from extracted historical evidence.
// This is authoritative input — not inferred from documents.
//
// INTERNAL STRUCTURE:
//   interview            → logistics and reliability of the assessment session
//   claimantHistory      → the claimant's subjective account (as reported)
//   presentationNarrative → assessor's observed presentation (objective)
//   mentalStateExam      → structured clinical findings (objective/structured)
//   diagnoses            → assessor's diagnostic opinions
//   functionalImpact     → assessor's PIRS-aligned functional evaluation
//   pirsAssessmentId     → link to PIRSAssessment if conducted
//   causationNarrative   → structured causation opinion
//   conflictsAddressed   → which CaseConflicts the assessor has resolved
//   recommendations      → clinical recommendations
//   executiveSummary     → top-level narrative for report cover section
// ─────────────────────────────────────────────────────────────────────────────

interface InterviewDetails {
  date:                ISODate;
  duration:            string | null;  // "90 minutes"
  location:            string | null;
  presentOthers:       string | null;  // "wife attended", "legal representative present"
  interpreterUsed:     boolean;
  interpreterLanguage: string | null;
  /**
   * The assessor's overall rating of history reliability.
   * Used in credibility and consistency analysis.
   */
  historyReliability:  'good' | 'fair' | 'poor' | null;
}

/**
 * The claimant's own account, as recorded by the assessor during interview.
 *
 * All fields represent the claimant's subjective report — not the assessor's
 * observations or opinions. Clearly separated from:
 *   presentationNarrative → assessor's observations (what the assessor saw)
 *   mentalStateExam       → structured clinical findings
 *
 * These fields are critical for medico-legal reporting:
 *   - They form the basis of the "History as Reported" section
 *   - They are compared against treating records to assess consistency
 *   - Inconsistencies surface as CaseConflict entries (history_inconsistency)
 *   - They directly inform PIRS domain reasoning via functionalImpact
 *
 * UI USAGE:
 *   Map each field to a labelled text block in the History section.
 *   Surface consistencyWithRecord as a status indicator.
 */
interface ClaimantHistory {
  /**
   * Claimant's account of how the accident or injury occurred and the
   * immediate physical and psychological aftermath.
   * Used in the "Mechanism of Injury" and "Index Event" report sections.
   */
  accidentDescription: string | null;

  /**
   * Claimant's account of how symptoms developed in the weeks and months
   * following the injury — onset, progression, and any periods of change.
   * Used in the "Symptom Development" and timeline report sections.
   */
  symptomDevelopment: string | null;

  /**
   * Claimant's account of all treatments received: who, what, when, compliance,
   * and perceived benefit or lack thereof.
   * Used in the "Treatment History" report section.
   * Cross-referenced against Procedure and Medication records for consistency.
   */
  treatmentHistory: string | null;

  /**
   * Claimant's account of how the injury affected employment — at onset,
   * over time, and currently. Includes any return-to-work attempts.
   * Used in the "Employability" PIRS domain reasoning.
   */
  workImpact: string | null;

  /**
   * Claimant's account of their current daily functioning across all domains.
   * Used as the primary input for PIRS domain reasoning before the assessor
   * applies clinical judgment.
   */
  currentFunctioning: string | null;

  /**
   * The assessor's rating of how consistent the claimant's account is with
   * the clinical record extracted from source documents.
   * Drives CaseConflict creation when 'inconsistent'.
   */
  consistencyWithRecord:
    | 'consistent'
    | 'partially_consistent'
    | 'inconsistent'
    | 'not_assessed';

  /**
   * notes: freeform auxiliary note on specific inconsistencies observed
   * between the claimant's account and the clinical record.
   * For internal reference and conflict flagging — not report narrative.
   */
  inconsistencyNotes: string | null;
}

interface MentalStateExam {
  appearance:      string | null;
  behaviour:       string | null;
  speech:          string | null;
  mood:            string | null;   // patient's subjectively reported mood
  affect:          string | null;   // assessor's observed affect
  thoughtForm:     string | null;
  thoughtContent:  string | null;
  perceptions:     string | null;   // hallucinations, illusions, re-experiencing
  cognition:       string | null;   // orientation, higher-order function
  memory:          string | null;
  concentration:   string | null;
  insight:         string | null;
  judgement:       string | null;
  /**
   * notes: freeform auxiliary MSE observations not captured above.
   * For internal reference only — not report narrative.
   */
  additionalNotes: string | null;
}

/**
 * The current assessor's opinion on a specific diagnosis.
 * Authoritative output — distinct from extracted Diagnosis objects.
 */
interface DiagnosisOpinion {
  term:      string;
  icd10Code: string | null;
  status:    DiagnosisStatus;
  priority:  DiagnosisPriority;
  causation: CausationOpinionType;
  /**
   * causationRationale: structured clinical reasoning for the assessor's
   * causation opinion. Forms part of the causation section of the report.
   */
  causationRationale:  string | null;
  alignmentWithRecord: 'agrees' | 'partially_agrees' | 'disagrees';
}

/**
 * The assessor's structured evaluation of one PIRS domain.
 * Feeds directly into PIRSAssessment when the current assessor conducts PIRS.
 *
 * UI USAGE:
 *   Render as a domain card with severity label, description, and examples list.
 *   Do not attempt to calculate overall impairment from severity alone —
 *   use PIRSAssessment.overallImpairment.
 */
interface FunctionalImpactDomain {
  domain:      PIRSDomain;
  /**
   * description: the assessor's structured narrative for this PIRS domain.
   * Forms part of the report's functional impact section — not freeform.
   */
  description: string;
  /** Specific examples provided by claimant or observed by assessor */
  examples:    string[];
  severity:    SeverityLevel | null;
}

interface CurrentAssessment {
  assessorId:     string;  // FK → Clinician.id (role must be 'current_assessor')
  documentId:     string;  // FK → DocumentRecord.id
  assessmentDate: ISODate;

  // ── Session logistics ─────────────────────────────────────────────────────
  interview: InterviewDetails;

  // ── Claimant's subjective account (as reported in interview) ─────────────
  /**
   * The claimant's own account of the accident, symptom development,
   * treatment, work impact, and current functioning.
   * This is what the claimant told the assessor — not the assessor's findings.
   * Must remain clearly separated from presentationNarrative and mentalStateExam.
   */
  claimantHistory: ClaimantHistory;

  // ── Assessor's observations (objective) ───────────────────────────────────
  /**
   * presentationNarrative: structured description of the claimant's presentation
   * as observed by the assessor during the interview.
   * Distinct from claimantHistory (claimant's own account) and mentalStateExam
   * (structured clinical instrument). Forms part of the report's presentation
   * section.
   */
  presentationNarrative: string | null;

  // ── Mental state examination (structured clinical findings) ───────────────
  mentalStateExam: MentalStateExam | null;

  // ── Diagnostic opinions ───────────────────────────────────────────────────
  diagnoses: DiagnosisOpinion[];

  // ── Functional impact / PIRS evaluation ───────────────────────────────────
  /**
   * The assessor's domain-by-domain evaluation of functional impact.
   * Aligned to PIRS domains. Used as input when generating PIRSAssessment.
   */
  functionalImpact: FunctionalImpactDomain[];

  /**
   * FK → PIRSAssessment.id — the assessor's own PIRS assessment if conducted.
   * Also present in CaseObject.pirsAssessments for unified access.
   * Null if the assessor did not conduct a formal PIRS rating.
   */
  pirsAssessmentId: string | null;

  // ── Causation ────────────────────────────────────────────────────────────
  /**
   * causationNarrative: the assessor's structured causation opinion.
   * Forms part of the report's causation section — not freeform.
   * See DiagnosisOpinion.causationRationale for per-diagnosis reasoning.
   */
  causationNarrative: string | null;

  // ── Conflict resolution ───────────────────────────────────────────────────
  /**
   * FK[] → CaseConflict.id — conflicts the assessor explicitly addressed.
   * The ConflictResolution on each conflict is updated separately.
   */
  conflictsAddressed: string[];

  // ── Recommendations ───────────────────────────────────────────────────────
  recommendations: string[];

  // ── Report output fields ──────────────────────────────────────────────────
  /**
   * executiveSummary: high-level narrative suitable for the report cover section.
   * Structured medico-legal prose — not freeform.
   * Covers diagnosis, causation, functional impact, and overall impairment.
   */
  executiveSummary: string | null;
}