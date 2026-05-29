import { Temporal } from "@js-temporal/polyfill";
import { getViewerTimeZone } from "./zones";

// Spec Part 13: formatting must NEVER contain duration or overlap math.
// Every export here is presentational only.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function zoned(instantIso: string, tz: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(instantIso).toZonedDateTimeISO(tz);
}

// "HH:mm" in the given zone (24-hour, locale-independent — spec Part 9.7).
export function formatTime24(instantIso: string, tz: string = getViewerTimeZone()): string {
  const z = zoned(instantIso, tz);
  return `${pad2(z.hour)}:${pad2(z.minute)}`;
}

// "YYYY-MM-DD" in the given zone.
export function formatDateISO(instantIso: string, tz: string = getViewerTimeZone()): string {
  const z = zoned(instantIso, tz);
  return `${z.year}-${pad2(z.month)}-${pad2(z.day)}`;
}

// "Mon" / "Tue" — used by the calendar day-header row.
const SHORT_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function formatShortWeekday(plainDateISO: string): string {
  const d = Temporal.PlainDate.from(plainDateISO);
  return SHORT_WEEKDAYS[d.dayOfWeek - 1];
}

// "January 2026" — used in the calendar header.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export function formatMonthYear(plainDateISO: string): string {
  const d = Temporal.PlainDate.from(plainDateISO);
  return `${MONTHS[d.month - 1]} ${d.year}`;
}

// "Mar 4 – 10" or "Mar 28 – Apr 3", driven by viewer-tz wall-clock dates.
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
export function formatDateRange(startISO: string, endISO: string): string {
  const s = Temporal.PlainDate.from(startISO);
  const e = Temporal.PlainDate.from(endISO);
  if (s.month === e.month && s.year === e.year) {
    return `${SHORT_MONTHS[s.month - 1]} ${s.day} – ${e.day}`;
  }
  return `${SHORT_MONTHS[s.month - 1]} ${s.day} – ${SHORT_MONTHS[e.month - 1]} ${e.day}`;
}

// "10/05/2026, 14:30" — generic timestamp formatter for audit/history rows.
// Renders in viewer-tz, 24-hour, day-month-year (en-AU style without locale dep).
export function formatTimestamp(instantIso: string, tz: string = getViewerTimeZone()): string {
  let z: Temporal.ZonedDateTime;
  try {
    z = zoned(instantIso, tz);
  } catch {
    return instantIso;
  }
  return `${pad2(z.day)}/${pad2(z.month)}/${z.year}, ${pad2(z.hour)}:${pad2(z.minute)}`;
}

// "13:00 (11:00 Sydney)" — appointment-time shown in viewer-tz with a
// secondary appointment-tz tag, but only when offsets actually differ at
// that instant (spec Part 9.5/9.6).
export function formatAppointmentTime(
  startUtc: string,
  appointmentTimeZone: string,
  viewerTz: string = getViewerTimeZone()
): { primary: string; secondary: string | null } {
  const primary = formatTime24(startUtc, viewerTz);
  if (appointmentTimeZone === viewerTz) return { primary, secondary: null };

  const apptInstant = Temporal.Instant.from(startUtc);
  const apptZ = apptInstant.toZonedDateTimeISO(appointmentTimeZone);
  const viewerZ = apptInstant.toZonedDateTimeISO(viewerTz);
  if (apptZ.offsetNanoseconds === viewerZ.offsetNanoseconds) {
    return { primary, secondary: null };
  }
  const apptLocal = `${pad2(apptZ.hour)}:${pad2(apptZ.minute)}`;
  const cityName = apptZShortLabel(appointmentTimeZone);
  return { primary, secondary: `${apptLocal} ${cityName}` };
}

function apptZShortLabel(tz: string): string {
  // e.g. "Australia/Brisbane" -> "Brisbane". Handles "America/New_York" etc.
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}

// ── PartialDate formatter ─────────────────────────────────────────────────
// Display-only formatter for the history subsystem. Never used in time math.
// Mirrors the project's existing month names so reports stay stylistically
// consistent with the calendar header / appointment formatter above.

const PARTIAL_MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatPartialDate(
  d: { year?: number; month?: number; day?: number; approximate?: boolean } | null | undefined
): string {
  if (!d || (d.year == null && d.month == null && d.day == null)) return "";
  const approxPrefix = d.approximate ? "circa " : "";
  if (d.year != null && d.month != null && d.day != null) {
    const m = PARTIAL_MONTHS_LONG[d.month - 1] ?? String(d.month);
    return `${approxPrefix}${d.day} ${m} ${d.year}`;
  }
  if (d.year != null && d.month != null) {
    const m = PARTIAL_MONTHS_LONG[d.month - 1] ?? String(d.month);
    return `${approxPrefix}${m} ${d.year}`;
  }
  if (d.year != null) return `${approxPrefix}${d.year}`;
  if (d.month != null) {
    const m = PARTIAL_MONTHS_LONG[d.month - 1] ?? String(d.month);
    return approxPrefix + m;
  }
  return "";
}
