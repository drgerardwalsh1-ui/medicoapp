import type { PIRSTableModel } from "./types";
import type {
  Appointment as CanonicalAppointment,
  WorkTimelineEvent,
} from "../time";
import {
  ageNow,
  ageOnDate,
  yearsSince as yearsSinceTS,
  viewerPlainDate,
  todayPlainDate,
} from "../time";
export type { PIRSTableModel } from "./types";
export type { DSMAssessmentData } from "./dsm";
export { defaultDSMAssessmentData } from "./dsm";

export type {
  HouseholdRelationships,
  HouseholdMember,
  PartnerDetails,
  ExtendedFamily,
  SupportBlock,
  FrequencyStruct,
  FrequencyUnit,
  RelationshipStatus,
  RelationshipType,
  CohabitationStatus,
  LivingArrangement,
  HouseholdSupportType,
  ContactLevel,
  ParentsAlive,
} from "./household";

export {
  defaultHouseholdRelationships,
  RELATIONSHIP_STATUS_OPTIONS,
  COHABITATION_STATUS_OPTIONS,
  RELATIONSHIP_TYPE_GROUPS,
  LIVING_ARRANGEMENT_OPTIONS,
  HOUSEHOLD_SUPPORT_TYPE_OPTIONS,
  isPartnerType,
  isChildType,
  isParentType,
  isCarer,
  requiresFreeText,
  livesWithClaimant,
  membersWhoSupport,
} from "./household";

export type UUID = string;

// ── Identity ──────────────────────────────────────────────────────────────────

export type Identity = {
  title: string | null;
  titleOther?: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  handDominance?: string | null;
  handDominanceOther?: string | null;
};

// ── Administrative ────────────────────────────────────────────────────────────

export type Administrative = {
  employer: string | null;
  occupation: string | null;
  referrer: {
    name: string | null;
    org: string | null;
  };
};

// ── Clinical ──────────────────────────────────────────────────────────────────

export type InjuryData = {
  dateOfInjury: string | null;
  ageAtInjury: number | null;
  yearsSinceInjury: number | null;
  injuryType: string | null;
  injuryTypeOther?: string | null;
  employerAtInjury?: string | null;
  claimNumber: string | null;
  insurerName: string | null;
  insurerReference: string | null;
  insurerContactPerson: string | null;
};

export type Clinical = {
  injury: InjuryData | null;
};

// ── Appointment ───────────────────────────────────────────────────────────────
// Canonical shape lives in src/time. Re-exported here so existing consumers
// continue to import `{ Appointment }` from this module. The only stored
// time fields are `startUtc`, `endUtc`, `appointmentTimeZone` (spec Part 2).
export type Appointment = CanonicalAppointment;

// ── Assessment checklist ──────────────────────────────────────────────────────

export interface AssessmentAttendees {
  attendedAlone: boolean;
  // Relationship chip for the support person (husband/wife/partner/son/
  // daughter). Empty string when none chosen — `supportPerson` then holds
  // a free-text description of the attendee instead.
  supportPersonRelation?: string;
  supportPerson?: string;
  interpreterPresent: boolean;
  // Coverage of the interpreter across the assessment. Carried into the
  // MSE narrative; "" means not recorded.
  interpreterCoverage?: "" | "entire" | "partial";
  interpreterPartialReason?: string;
  interpreterName?: string;
  interpreterNaati?: string;
  interpreterLanguage?: string;
}

// Assessment modality — chip-selected, carried into the MSE narrative.
export type AssessmentModality = "" | "videoconference" | "in person" | "telephone";

export const ASSESSMENT_MODALITY_OPTIONS: { value: AssessmentModality; label: string }[] = [
  { value: "videoconference", label: "Videoconference" },
  { value: "in person", label: "In person" },
  { value: "telephone", label: "Telephone" },
];

// Relationship chips offered for the support person, shared by the
// Demographics and MSE attendee panels.
export const SUPPORT_PERSON_RELATIONS = [
  "husband",
  "wife",
  "partner",
  "son",
  "daughter",
] as const;

export interface AssessmentChecklist {
  completed: boolean;
  consentGiven: boolean | null;
  modality: AssessmentModality;
  modalityConfirmed: boolean;
  purposeExplained: boolean;
  technicalIssues: string;
  technicalNotes?: string;
  attendees: AssessmentAttendees;
  completedAt?: string;
}

// ── Mental State Examination ──────────────────────────────────────────────────
// Structured data underneath, generated prose layered on top. Each domain
// stores the selected chip ids plus free-text observations. Domains default
// to a clinically normal state — an empty `chips` array means "no abnormality".

export interface MSEDomainState {
  chips: string[];
  notes: string;
}

export interface MSEData {
  // Keyed by MSE domain id (see data/mseDomains.ts).
  domains: Record<string, MSEDomainState>;
  // Cognition / assessment-quality structured selections.
  historyQuality?: "" | "good" | "reasonable" | "poor";
  durationCoping?: "" | "well" | "fairly well" | "poorly";
  concentrationDifficulty?: "" | "none" | "mild" | "moderate" | "severe";
  // Manual narrative override. When `narrativeEdited` is true the generated
  // prose is NOT recomputed — the clinician's edited text in `narrative`
  // is authoritative.
  narrative?: string;
  narrativeEdited?: boolean;
}

export function defaultMSEData(): MSEData {
  return {
    domains: {},
    historyQuality: "",
    durationCoping: "",
    concentrationDifficulty: "",
    narrativeEdited: false,
  };
}

// ── Report ────────────────────────────────────────────────────────────────────

export interface PreviousAssessorPIRS {
  id: string;
  date: string;
  author: string;
  authorRole: string;
  table: PIRSTableModel;
}

export interface Report {
  fields: Record<string, unknown>;
  pirsTables: PIRSTableModel[];
  previousAssessorPirs: PreviousAssessorPIRS[];
  history: unknown[];
  lastUpdated: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

export type Client = {
  id: UUID;
  identity: Identity;
  administrative: Administrative;
  clinical: Clinical;
  appointments: Appointment[];
  report: Report;
  assessmentChecklist: AssessmentChecklist;
  // Structured household and relationship data — single source of truth.
  // All PIRS and report relationship references must derive from this field.
  householdRelationships?: import("./household").HouseholdRelationships;
  relationships?: import("../components/RelationshipManager").Relationship[];
  // DSM-5-TR diagnostic assessment engine data.
  // Symptoms are shared entities; criterion satisfaction is diagnosis-specific.
  dsmAssessment?: import("./dsm").DSMAssessmentData;
  // Authoritative chronology of work performed on this case (spec Part 17).
  // Single source of truth for timers, manual entries, and printable output.
  workTimeline?: WorkTimelineEvent[];
  // Structured clinical history (pre-existing + subsequent events,
  // denials, family / developmental / education / work-history /
  // medical / treatment). Persisted via the omnibus updateClientDemographics
  // event (see buildSaveBlob in main.tsx) — no separate event stream.
  psychiatricHistory?: import("./history").PsychiatricHistory;
  // Mental State Examination — structured chip data + generated narrative.
  mse?: MSEData;
  created_at: string;
  updated_at: string;
};

// ── Default factories ─────────────────────────────────────────────────────────

export function defaultIdentity(): Identity {
  return {
    title: null,
    firstName: "",
    middleName: null,
    lastName: "",
    dateOfBirth: null,
    gender: null,
    handDominance: null,
  };
}

export function defaultAdministrative(): Administrative {
  return {
    employer: null,
    occupation: null,
    referrer: { name: null, org: null },
  };
}

export function defaultInjury(): InjuryData {
  return {
    dateOfInjury: null,
    ageAtInjury: null,
    yearsSinceInjury: null,
    injuryType: null,
    claimNumber: null,
    insurerName: null,
    insurerReference: null,
    insurerContactPerson: null,
  };
}

export function defaultClinical(): Clinical {
  return { injury: null };
}

export function defaultAttendees(): AssessmentAttendees {
  return { attendedAlone: true, interpreterPresent: false };
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

export function defaultReport(): Report {
  return {
    fields: {},
    pirsTables: [],
    previousAssessorPirs: [],
    history: [],
    lastUpdated: "",
  };
}

export function defaultClient(): Client {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    identity: defaultIdentity(),
    administrative: defaultAdministrative(),
    clinical: defaultClinical(),
    appointments: [],
    report: defaultReport(),
    assessmentChecklist: defaultAssessmentChecklist(),
    workTimeline: [],
    created_at: now,
    updated_at: now,
  };
}

// householdRelationships deliberately absent from defaultClient() —
// it is optional and starts undefined (no household data entered yet).

// ── Utilities ─────────────────────────────────────────────────────────────────

function toTitleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatFullName(
  identity: Pick<Identity, "title" | "titleOther" | "firstName" | "lastName"> | null | undefined
): string {
  if (!identity) return "";
  const displayTitle =
    identity.title === "Other" ? (identity.titleOther ?? "") : (identity.title ?? "");
  return [displayTitle, identity.firstName, identity.lastName]
    .map(toTitleCase)
    .filter(Boolean)
    .join(" ");
}

export function isAppointmentToday(appointments: Appointment[]): boolean {
  const today = todayPlainDate();
  return appointments.some((a) => viewerPlainDate(a.startUtc) === today);
}

export function calcAge(dob: string): number {
  return ageNow(dob);
}

export function calcAgeAtDate(dob: string, atDate: string): number {
  return ageOnDate(dob, atDate);
}

export function calcYearsSince(fromDate: string): number {
  return yearsSinceTS(fromDate);
}

// Defensive parse-time validator — blob fields originate as opaque JSON,
// so we still enforce the canonical appointment shape here. Anything else
// is silently dropped (test-data only; spec Part 2 forbids floating times).
function isValidAppointment(a: unknown): a is Appointment {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    typeof o.startUtc === "string" &&
    typeof o.endUtc === "string" &&
    typeof o.appointmentTimeZone === "string"
  );
}

// ── Blob parsing ──────────────────────────────────────────────────────────────

export function parseClientBlob(id: string, raw: unknown): Client {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ident = (b.identity && typeof b.identity === "object" ? b.identity : {}) as Record<string, unknown>;
  const admin = (b.administrative && typeof b.administrative === "object" ? b.administrative : {}) as Record<string, unknown>;
  const ref = (admin.referrer && typeof admin.referrer === "object" ? admin.referrer : {}) as Record<string, unknown>;
  const clin = (b.clinical && typeof b.clinical === "object" ? b.clinical : {}) as Record<string, unknown>;
  const injRaw = clin.injury && typeof clin.injury === "object" ? (clin.injury as Record<string, unknown>) : null;
  const rawReport = (b.report && typeof b.report === "object" ? b.report : {}) as Record<string, unknown>;
  const chkRaw = (b.assessmentChecklist && typeof b.assessmentChecklist === "object" ? b.assessmentChecklist : {}) as Record<string, unknown>;
  const attRaw = (chkRaw.attendees && typeof chkRaw.attendees === "object" ? chkRaw.attendees : {}) as Record<string, unknown>;

  return {
    id,
    identity: {
      title: (ident.title as string | null) ?? null,
      titleOther: (ident.titleOther as string | null) ?? null,
      firstName: (ident.firstName as string) ?? "",
      middleName: (ident.middleName as string | null) ?? null,
      lastName: (ident.lastName as string) ?? "",
      dateOfBirth: (ident.dateOfBirth as string | null) ?? null,
      gender: (ident.gender as string | null) ?? null,
      handDominance: (ident.handDominance as string | null) ?? null,
      handDominanceOther: (ident.handDominanceOther as string | null) ?? null,
    },
    administrative: {
      employer: (admin.employer as string | null) ?? null,
      occupation: (admin.occupation as string | null) ?? null,
      referrer: {
        name: (ref.name as string | null) ?? null,
        org: (ref.org as string | null) ?? null,
      },
    },
    clinical: {
      injury: injRaw ? {
        dateOfInjury: (injRaw.dateOfInjury as string | null) ?? null,
        ageAtInjury: (injRaw.ageAtInjury as number | null) ?? null,
        yearsSinceInjury: (injRaw.yearsSinceInjury as number | null) ?? null,
        injuryType: (injRaw.injuryType as string | null) ?? null,
        injuryTypeOther: (injRaw.injuryTypeOther as string | null) ?? null,
        employerAtInjury: (injRaw.employerAtInjury as string | null) ?? null,
        claimNumber: (injRaw.claimNumber as string | null) ?? null,
        insurerName: (injRaw.insurerName as string | null) ?? null,
        insurerReference: (injRaw.insurerReference as string | null) ?? null,
        insurerContactPerson: (injRaw.insurerContactPerson as string | null) ?? null,
      } : null,
    },
    appointments: Array.isArray(b.appointments)
      ? (b.appointments as Appointment[]).filter(isValidAppointment)
      : [],
    relationships: Array.isArray(b.relationships)
      ? (b.relationships as import("../components/RelationshipManager").Relationship[])
      : [],
    // householdRelationships: pass through as-is — structured JSON, validated by TypeScript
    householdRelationships: (b.householdRelationships && typeof b.householdRelationships === "object")
      ? (b.householdRelationships as import("./household").HouseholdRelationships)
      : undefined,
    dsmAssessment: (b.dsmAssessment && typeof b.dsmAssessment === "object")
      ? (b.dsmAssessment as import("./dsm").DSMAssessmentData)
      : undefined,
    workTimeline: Array.isArray(b.workTimeline)
      ? (b.workTimeline as WorkTimelineEvent[]).filter(
          (e) =>
            e &&
            typeof e === "object" &&
            typeof (e as Record<string, unknown>).id === "string" &&
            typeof (e as Record<string, unknown>).type === "string" &&
            typeof (e as Record<string, unknown>).startedAtUtc === "string"
        )
      : [],
    psychiatricHistory: (b.psychiatricHistory && typeof b.psychiatricHistory === "object")
      ? (b.psychiatricHistory as import("./history").PsychiatricHistory)
      : undefined,
    mse: (b.mse && typeof b.mse === "object")
      ? {
          ...defaultMSEData(),
          ...(b.mse as Partial<MSEData>),
          domains:
            (b.mse as Record<string, unknown>).domains &&
            typeof (b.mse as Record<string, unknown>).domains === "object"
              ? ((b.mse as MSEData).domains as Record<string, MSEDomainState>)
              : {},
        }
      : undefined,
    report: {
      fields: (rawReport.fields && typeof rawReport.fields === "object" ? rawReport.fields : {}) as Record<string, unknown>,
      pirsTables: Array.isArray(rawReport.pirsTables) ? (rawReport.pirsTables as PIRSTableModel[]) : [],
      previousAssessorPirs: Array.isArray(rawReport.previousAssessorPirs) ? (rawReport.previousAssessorPirs as PreviousAssessorPIRS[]) : [],
      history: Array.isArray(rawReport.history) ? rawReport.history : [],
      lastUpdated: typeof rawReport.lastUpdated === "string" ? rawReport.lastUpdated : "",
    },
    assessmentChecklist: {
      ...defaultAssessmentChecklist(),
      ...(chkRaw as Partial<AssessmentChecklist>),
      attendees: {
        ...defaultAttendees(),
        ...(attRaw as Partial<AssessmentAttendees>),
      },
    },
    created_at: typeof b.created_at === "string" ? b.created_at : new Date().toISOString(),
    updated_at: typeof b.updated_at === "string" ? b.updated_at : new Date().toISOString(),
  };
}

// ── Calendar adapter ──────────────────────────────────────────────────────────

export type CalendarEvent = Appointment & { client: Client };

export function mapClientToCalendarEvents(client: Client): CalendarEvent[] {
  return client.appointments.map((a) => ({ ...a, client }));
}
