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

export interface AppointmentSlot {
  date?: string;
  time?: string;
  location?: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  start: string;
  end: string;
  type?: string;
}

export interface ClientBlob {
  demographics: Demographics;
  injury: Injury;
  referrer: Referrer;
  appointment: AppointmentSlot;
  appointments: Appointment[];
  assessmentChecklist: AssessmentChecklist;
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

export function defaultClientBlob(): ClientBlob {
  return {
    demographics: defaultDemographics(),
    injury: defaultInjury(),
    referrer: {},
    appointment: {},
    appointments: [],
    assessmentChecklist: defaultAssessmentChecklist(),
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

/** Merge a raw blob from the projection with fresh defaults for missing fields. */
export function mergeBlob(raw: unknown): ClientBlob {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    demographics: {
      ...defaultDemographics(),
      ...((b.demographics && typeof b.demographics === "object" ? b.demographics : {}) as Partial<Demographics>),
    },
    injury: {
      ...defaultInjury(),
      ...((b.injury && typeof b.injury === "object" ? b.injury : {}) as Partial<Injury>),
    },
    referrer: ((b.referrer && typeof b.referrer === "object" ? b.referrer : {}) as Referrer),
    appointment: ((b.appointment && typeof b.appointment === "object" ? b.appointment : {}) as AppointmentSlot),
    appointments: Array.isArray(b.appointments) ? (b.appointments as Appointment[]) : [],
    assessmentChecklist: {
      ...defaultAssessmentChecklist(),
      ...((b.assessmentChecklist && typeof b.assessmentChecklist === "object" ? b.assessmentChecklist : {}) as Partial<AssessmentChecklist>),
      attendees: {
        ...defaultAttendees(),
        ...((b.assessmentChecklist && typeof b.assessmentChecklist === "object"
          ? (b.assessmentChecklist as any).attendees
          : {}) as Partial<AssessmentAttendees>),
      },
    },
  };
}
