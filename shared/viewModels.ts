/* =============================================================================
   CLIENT VIEW MODEL — UI STATE PROJECTION
   =============================================================================
   This is the ONLY client shape stored in React state at runtime.

   It is a simplified projection of shared/types.ts CaseObject, designed for:
     - form binding (flat fields, not Attributed<T> wrappers)
     - React useState
     - client-list display
     - interactive PIRS editing

   CaseObject is the persistence / export / backend-sync format. It is NEVER
   stored inside ClientViewModel at runtime; it is reconstructed on demand via
   adapter functions (Step 4A onwards).

   Supporting enums (Sex, EmploymentStatus, PIRSDomain, PIRSClass) are defined
   locally here to keep this file self-contained. Step 4A introduces the
   adapter layer, which is the canonical reconciliation point between
   ClientViewModel and the domain types in shared/types.ts.
   ========================================================================== */

// ── Enums ───────────────────────────────────────────────────────────────────

export type Sex = 'male' | 'female' | 'other' | 'unknown';

export type EmploymentStatus =
  | 'employed_full_time'
  | 'employed_part_time'
  | 'employed_modified_duties'
  | 'unemployed_seeking'
  | 'unemployed_not_seeking'
  | 'unable_to_work'
  | 'retired'
  | 'student'
  | 'unknown';

export type PIRSDomain =
  | 'activities_of_daily_living'
  | 'social_recreational_activities'
  | 'travel'
  | 'social_functioning'
  | 'concentration_persistence_pace'
  | 'employability';

export type PIRSClass = 1 | 2 | 3 | 4 | 5;

export type ReportSchemaId = 'PIC' | 'MOTOR';
export type ReportOverlayId = 'HPL' | 'MEDILAW';


// ── Sub-view-models ─────────────────────────────────────────────────────────

export interface DemographicsViewModel {
  forename:    string;
  surname:     string;
  dateOfBirth: string;        // "YYYY-MM-DD" or ""
  age:         number | null;
  sex:         Sex;
  address:     string;
}

export interface InjuryContextViewModel {
  dateOfInjury:    string;    // ISO or approx or ""
  injuryMechanism: string;
  claimNumbers:    string[];
  insurer:         string;
}

export interface EmploymentViewModel {
  occupationAtInjury: string;
  employer:           string;
  currentStatus:      EmploymentStatus;
}

export interface ClinicianViewModel {
  id:           string;
  name:         string;
  role:         string;       // reconciled with ClinicalRole in Step 4A
  speciality:   string;
  organisation: string;
}

export interface AppointmentViewModel {
  id:    string;
  date:  string;              // ISO or ""
  type:  string;              // e.g. "Initial consultation"
  notes: string;
}

export interface DocumentRecordViewModel {
  id:           string;
  fileName:     string;
  documentType: string;       // reconciled with DocumentType in Step 4A
  extractedAt:  string | null;
}

export interface PIRSDomainViewModel {
  domain:     PIRSDomain;
  label:      string;         // human-readable label shown in the UI
  class:      PIRSClass | null;
  percentage: number | null;
  rationale:  string;
}

export interface PIRSTableViewModel {
  id:              string;
  name:            string;    // "Current PIRS" | "Pre-injury PIRS" | "Previous Assessor PIRS"
  assessorName:    string;
  assessmentDate:  string;
  domains:         PIRSDomainViewModel[];
  preExisting:     number;
  treatmentEffect: number;
}

export interface ReportStateViewModel {
  schema:  ReportSchemaId;
  overlay: ReportOverlayId | null;
  fields:  Record<string, string>;
}


// ── Root view model ─────────────────────────────────────────────────────────

export interface ClientViewModel {
  id:            string;
  name:          string;
  caseId:        string;
  schemaVersion: '1.1.0';

  demographics:   DemographicsViewModel;
  injuryContext:  InjuryContextViewModel;
  employment:     EmploymentViewModel;
  clinicians:     ClinicianViewModel[];
  appointments:   AppointmentViewModel[];
  pirsTables:     PIRSTableViewModel[];
  report:         ReportStateViewModel;
  documents:      DocumentRecordViewModel[];
}


// ── Factory ─────────────────────────────────────────────────────────────────

/** Construct a blank ClientViewModel with valid defaults for every field. */
export function emptyClientViewModel(): ClientViewModel {
  const id = Date.now().toString();
  return {
    id,
    name:          'New Client',
    caseId:        id,
    schemaVersion: '1.1.0',

    demographics: {
      forename:    '',
      surname:     '',
      dateOfBirth: '',
      age:         null,
      sex:         'unknown',
      address:     '',
    },

    injuryContext: {
      dateOfInjury:    '',
      injuryMechanism: '',
      claimNumbers:    [],
      insurer:         '',
    },

    employment: {
      occupationAtInjury: '',
      employer:           '',
      currentStatus:      'unknown',
    },

    clinicians:   [],
    appointments: [],
    pirsTables:   [],

    report: {
      schema:  'PIC',
      overlay: null,
      fields:  {},
    },

    documents: [],
  };
}
