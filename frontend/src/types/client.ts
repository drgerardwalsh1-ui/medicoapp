import type { PIRSTableModel } from "./types";
export type { PIRSTableModel } from "./types";

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
  relationshipStatus: string | null;
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
  claimNumber: string | null;
  insurerName: string | null;
  insurerReference: string | null;
  insurerContactPerson: string | null;
};

export type Clinical = {
  injury: InjuryData | null;
};

// ── Appointment ───────────────────────────────────────────────────────────────

export type Appointment = {
  id: UUID;
  start: string;
  end: string;
  type: string;
};

// ── Assessment checklist ──────────────────────────────────────────────────────

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
    relationshipStatus: null,
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
    created_at: now,
    updated_at: now,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function buildClientName(
  identity: Pick<Identity, "title" | "titleOther" | "firstName" | "lastName"> | null | undefined
): string {
  if (!identity) return "Unnamed Client";
  const displayTitle =
    identity.title === "Other" ? (identity.titleOther ?? "") : (identity.title ?? "");
  return (
    [displayTitle, identity.firstName, identity.lastName].filter(Boolean).join(" ") ||
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
      relationshipStatus: (admin.relationshipStatus as string | null) ?? null,
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
        claimNumber: (injRaw.claimNumber as string | null) ?? null,
        insurerName: (injRaw.insurerName as string | null) ?? null,
        insurerReference: (injRaw.insurerReference as string | null) ?? null,
        insurerContactPerson: (injRaw.insurerContactPerson as string | null) ?? null,
      } : null,
    },
    appointments: Array.isArray(b.appointments) ? (b.appointments as Appointment[]) : [],
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
