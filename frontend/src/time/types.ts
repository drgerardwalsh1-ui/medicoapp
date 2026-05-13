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

// Spec Part 3 / Part 17. The authoritative chronology of work performed on
// a client/case. There is exactly ONE such collection per client; timers,
// manual entries, printable output, and future exports all derive from it.
//
// `viewerTimeZone` is intentionally branded so an appointment-tz cannot leak
// into a timeline event (spec Part 14 — no timezone bleeding).
export type WorkTimelineEventType =
  | "prereading"
  | "assessment"
  | "reportWriting"
  | "admin"
  | "travel"
  | "break"
  | "interruption"
  | "technicalDelay"
  | "note"
  | "custom";

export type WorkTimelineEvent = {
  id: UUID;
  type: WorkTimelineEventType;
  title: string;
  description?: string;
  startedAtUtc: string;
  endedAtUtc: string | null;          // null while a timer is running
  viewerTimeZone: ViewerTimeZone;
  linkedAppointmentId?: UUID;
  linkedWorkSessionId?: UUID;
  manuallyEdited: boolean;
  createdAutomatically: boolean;
  // ── Pause accounting (spec: pause MUST NOT inflate work duration) ─────
  // Total ms accumulated across completed pause intervals during this
  // event's lifetime. Excluded from active work duration.
  accumulatedPausedMs?: number;
  // The instant a currently in-flight pause began. Null/absent when the
  // event is running. On resume, (now - pausedAtUtc) is folded into
  // accumulatedPausedMs and pausedAtUtc is cleared. Survives reloads, so
  // a paused timer remains paused after app restart.
  pausedAtUtc?: string | null;
};
