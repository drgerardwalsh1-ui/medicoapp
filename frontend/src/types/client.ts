import type { PIRSTableModel } from "./types";
export type { PIRSTableModel } from "./types";

// ── Core types ────────────────────────────────────────────────────────────────

export interface Demographics {
  title: string;
  titleOther?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  age: number;
  relationshipStatus?: string;
  occupation?: string;
  employer?: string;
  handDominance: string;
  handDominanceOther?: string;
}

export interface Injury {
  dateOfInjury: string;
  ageAtInjury: number;
  yearsSinceInjury: number;
  injuryType: string;
  injuryTypeOther?: string;
  claimNumber?: string;
  insurerName?: string;
  insurerReference?: string;
  insurerContactPerson?: string;
}

export interface AssessmentAttendees {
  attendedAlone: boolean;
  supportPerson?: string;
  interpreterPresent: boolean;
  interpreterName?: string;
  interpreterNaati?: string;
  interpreterLanguage?: string;
}

export interface AssessmentChecklist {
  completed: boolean;
  consentGiven: boolean | null;
  modality: string;
  modalityConfirmed: boolean;
  purposeExplained: boolean;
  technicalIssues: string;
  technicalNotes?: string;
  attendees: AssessmentAttendees;
  completedAt?: string;
}

export interface Referrer {
  name?: string;
  org?: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  start: string;
  end: string;
  type?: string;
}

// ── Report types ─────────────────────────────────────────────────────────────

export interface PreviousAssessorPIRS {
  id: string;
  date: string;
  author: string;
  authorRole: string;
  table: PIRSTableModel;
}

export interface ReportData {
  fields: Record<string, unknown>;
  pirsTables: PIRSTableModel[];
  previousAssessorPirs: PreviousAssessorPIRS[];
  history: unknown[];
  lastUpdated: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ClientBlob {
  demographics: Demographics;
  injury: Injury;
  referrer: Referrer;
  appointments: Appointment[];
  assessmentChecklist: AssessmentChecklist;
  report: ReportData;
}

// ── Default factories ────────────────────────────────────────────────────────

export function defaultDemographics(): Demographics {
  return {
    title: "",
    firstName: "",
    lastName: "",
    gender: "",
    dateOfBirth: "",
    age: 0,
    handDominance: "",
  };
}

export function defaultInjury(): Injury {
  return {
    dateOfInjury: "",
    ageAtInjury: 0,
    yearsSinceInjury: 0,
    injuryType: "",
  };
}

export function defaultAttendees(): AssessmentAttendees {
  return {
    attendedAlone: true,
    interpreterPresent: false,
  };
}

export function defaultAssessmentChecklist(): AssessmentChecklist {
  return {
    completed: false,
    consentGiven: null,
    modality: "",
    modalityConfirmed: false,
    purposeExplained: false,
    technicalIssues: "none",
    attendees: defaultAttendees(),
  };
}

export function defaultReportData(): ReportData {
  return {
    fields: {},
    pirsTables: [],
    previousAssessorPirs: [],
    history: [],
    lastUpdated: "",
  };
}

export function defaultClientBlob(): ClientBlob {
  return {
    demographics: defaultDemographics(),
    injury: defaultInjury(),
    referrer: {},
    appointments: [],
    assessmentChecklist: defaultAssessmentChecklist(),
    report: defaultReportData(),
  };
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function buildClientName(d: Demographics): string {
  const displayTitle =
    d.title === "Other" ? (d.titleOther || "") : (d.title || "");
  return (
    [displayTitle, d.firstName, d.lastName].filter(Boolean).join(" ") ||
    "Unnamed Client"
  );
}

export function isAppointmentToday(appointments: Appointment[]): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return appointments.some((a) => a.start.slice(0, 10) === today);
}

export function calcAge(dob: string): number {
  if (!dob) return 0;
  const ms = Date.now() - new Date(dob).getTime();
  return Math.max(0, Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)));
}

export function calcAgeAtDate(dob: string, atDate: string): number {
  if (!dob || !atDate) return 0;
  const ms = new Date(atDate).getTime() - new Date(dob).getTime();
  return Math.max(0, Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)));
}

export function calcYearsSince(fromDate: string): number {
  if (!fromDate) return 0;
  const ms = Date.now() - new Date(fromDate).getTime();
  return Math.max(0, Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)));
}

// All known demographics field names — used to safely pick flat demographics
// from a blob where they live at the top level alongside other sections.
const DEMOGRAPHICS_KEYS: ReadonlyArray<keyof Demographics> = [
  "title", "titleOther", "firstName", "middleName", "lastName",
  "gender", "dateOfBirth", "age", "relationshipStatus", "occupation",
  "employer", "handDominance", "handDominanceOther",
];

function pickDemographics(src: Record<string, unknown>): Partial<Demographics> {
  const out: Partial<Demographics> = {};
  for (const k of DEMOGRAPHICS_KEYS) {
    if (k in src) (out as Record<string, unknown>)[k] = src[k];
  }
  return out;
}

/**
 * Merge a raw blob from the projection with fresh defaults for missing fields.
 *
 * Storage format (new): demographics fields are flat at the top level of the
 * blob — no nested `demographics` key. Legacy blobs that still have a nested
 * `demographics` object are transparently handled via the fallback branch.
 */
export function mergeBlob(raw: unknown): ClientBlob {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawReport = (b.report && typeof b.report === "object" ? b.report : {}) as Record<string, unknown>;

  // New format: demographics fields live flat at the top level.
  // Legacy format: they were nested under a "demographics" key — fall back to
  // that if the new flat keys are absent.
  const demSrc =
    (b.demographics && typeof b.demographics === "object" && !Array.isArray(b.demographics))
      ? (b.demographics as Record<string, unknown>)
      : b;

  return {
    demographics: {
      ...defaultDemographics(),
      ...pickDemographics(demSrc),
    },
    injury: {
      ...defaultInjury(),
      ...((b.injury && typeof b.injury === "object" ? b.injury : {}) as Partial<Injury>),
    },
    referrer: ((b.referrer && typeof b.referrer === "object" ? b.referrer : {}) as Referrer),
    appointments: Array.isArray(b.appointments) ? (b.appointments as Appointment[]) : [],
    assessmentChecklist: {
      ...defaultAssessmentChecklist(),
      ...((b.assessmentChecklist && typeof b.assessmentChecklist === "object" ? b.assessmentChecklist : {}) as Partial<AssessmentChecklist>),
      attendees: {
        ...defaultAttendees(),
        ...((b.assessmentChecklist && typeof b.assessmentChecklist === "object"
          ? (b.assessmentChecklist as Record<string, unknown>).attendees
          : {}) as Partial<AssessmentAttendees>),
      },
    },
    report: {
      ...defaultReportData(),
      fields: (rawReport.fields && typeof rawReport.fields === "object" ? rawReport.fields : {}) as Record<string, unknown>,
      pirsTables: Array.isArray(rawReport.pirsTables) ? (rawReport.pirsTables as PIRSTableModel[]) : [],
      previousAssessorPirs: Array.isArray(rawReport.previousAssessorPirs)
        ? (rawReport.previousAssessorPirs as PreviousAssessorPIRS[])
        : [],
      history: Array.isArray(rawReport.history) ? rawReport.history : [],
      lastUpdated: typeof rawReport.lastUpdated === "string" ? rawReport.lastUpdated : "",
    },
  };
}
