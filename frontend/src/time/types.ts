// Branded IANA timezone tags. The brands are erased at runtime — they exist
// solely to prevent passing an appointment-tz where a viewer-tz is expected
// (spec Part 6: "no timezone bleeding").

declare const ViewerTzBrand: unique symbol;
declare const AppointmentTzBrand: unique symbol;

export type ViewerTimeZone = string & { readonly [ViewerTzBrand]: true };
export type AppointmentTimeZone = string & { readonly [AppointmentTzBrand]: true };

export function asViewerTimeZone(id: string): ViewerTimeZone {
  return id as ViewerTimeZone;
}
export function asAppointmentTimeZone(id: string): AppointmentTimeZone {
  return id as AppointmentTimeZone;
}

export type UUID = string;

// Canonical appointment shape — UTC + IANA only. There is no legacy
// `start`/`end` mirror. There is no schema-version marker because there is
// no second shape to distinguish from.
export type Appointment = {
  id: UUID;
  type: string;
  startUtc: string;
  endUtc: string;
  appointmentTimeZone: string;
};

export type AlertKind = "pre15" | "pre5" | "overrun";

export type AppointmentAlert = {
  kind: AlertKind;
  appointmentId: UUID;
  startUtc: string;
  endUtc: string;
  appointmentTimeZone: string;
  minutesDelta: number;
};

export type WorkSessionType =
  | "prereading"
  | "assessment"
  | "reportWriting"
  | "admin"
  | "travel"
  | "break"
  | "technicalDelay"
  | "interrupted";

// Spec Part 12. Immutable record. Totals are derived helpers — never the
// source of truth. `viewerTimeZone` is intentionally typed as ViewerTimeZone
// (branded) so an appointment-tz cannot be assigned by mistake.
export type WorkSession = {
  id: UUID;
  type: WorkSessionType;
  startedAtUtc: string;
  endedAtUtc: string | null;
  viewerTimeZone: ViewerTimeZone;
  durationMinutes: number;
  clientId?: UUID;
  appointmentId?: UUID;
  pauseReason?: string;
  endReason?: string;
};
