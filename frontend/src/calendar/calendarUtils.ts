// Thin wrapper layer. All time/date logic lives in src/time (TimeService).
// Spec Part 1 / Part 15: this file preserves its original public surface so
// the existing calendar components are not rewritten — only their math is
// re-routed through the centralized service.

export type { Appointment } from "../types/client";
import {
  HOUR_HEIGHT as TS_HOUR_HEIGHT,
  START_HOUR as TS_START_HOUR,
  END_HOUR as TS_END_HOUR,
  SNAP_MINUTES as TS_SNAP_MINUTES,
  topPxFromInstant,
  heightPxFromInstants,
  pixelsToInstantIso,
  isInstantOnViewerDay,
  viewerPlainDate,
  viewerWeekStartDate,
  weekDates as tsWeekDates,
  addDaysToPlainDate,
  todayPlainDate,
  formatTime24,
  formatMonthYear as tsFormatMonthYear,
  formatDateRange as tsFormatDateRange,
  formatShortWeekday,
  getViewerTimeZone,
} from "../time";

export type ClientStatus = "complete" | "in_progress" | "missing";

// Grid layout constants — re-exported from TimeService.
export const HOUR_HEIGHT = TS_HOUR_HEIGHT;
export const START_HOUR = TS_START_HOUR;
export const END_HOUR = TS_END_HOUR;
export const SNAP_MINUTES = TS_SNAP_MINUTES;
export const TIME_LABEL_WIDTH = 56;

export const HOURS = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, i) => START_HOUR + i
);

export const TOTAL_GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

// ── Week helpers ─────────────────────────────────────────────────────────────
// Existing callers pass JS Date objects representing midnight wall-clock in
// viewer-tz. Internally we delegate to TimeService for the actual maths.

function plainDateFromJsDate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function jsDateFromPlainDate(plainDate: string): Date {
  const [y, m, d] = plainDate.split("-").map(Number);
  const out = new Date();
  out.setFullYear(y, m - 1, d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function getWeekStart(date: Date): Date {
  const today = plainDateFromJsDate(date);
  // Reuse TimeService week-start logic by routing through an instant.
  // We construct a dummy instant for "midnight viewer-tz on `today`" only to
  // pass to viewerWeekStartDate — equivalent to picking the Monday of the
  // ISO week containing `today` in viewer-tz.
  const tz = getViewerTimeZone();
  const inst = wallClockMidnightInstant(today);
  return jsDateFromPlainDate(viewerWeekStartDate(inst, tz));
}

export function getWeekDates(weekStart: Date): Date[] {
  return tsWeekDates(plainDateFromJsDate(weekStart)).map(jsDateFromPlainDate);
}

export function addDays(date: Date, days: number): Date {
  return jsDateFromPlainDate(addDaysToPlainDate(plainDateFromJsDate(date), days));
}

export function isSameDay(a: Date, b: Date): boolean {
  return plainDateFromJsDate(a) === plainDateFromJsDate(b);
}

// Helper used by getWeekStart above. Approximates midnight-in-viewer-tz as
// the JS Date midnight in the system zone — only ever used to derive which
// ISO week `plainDate` belongs to, so any sub-day offset is irrelevant.
function wallClockMidnightInstant(plainDate: string): string {
  return jsDateFromPlainDate(plainDate).toISOString();
}

// ── Status derivation ────────────────────────────────────────────────────────

export function getClientStatus(client: any): ClientStatus {
  const docs: any[] = client?.documents ?? [];
  const report: Record<string, unknown> = client?.report ?? {};
  if (docs.length === 0) return "missing";
  if (Object.keys(report).length > 0) return "complete";
  return "in_progress";
}

export type StatusStyle = { bg: string; border: string; text: string };

export function statusStyle(status: ClientStatus): StatusStyle {
  switch (status) {
    case "complete":
      return { bg: "bg-emerald-500", border: "border-emerald-600", text: "text-white" };
    case "in_progress":
      return { bg: "bg-amber-400", border: "border-amber-500", text: "text-amber-900" };
    case "missing":
      return { bg: "bg-rose-500", border: "border-rose-600", text: "text-white" };
  }
}

// ── Grid position math ───────────────────────────────────────────────────────
// Spec Part 9: vertical placement uses viewer-tz; absolute UTC drives the
// underlying instant. Existing callers pass `appt.startUtc` / `appt.endUtc`.

export function appointmentTopPx(startUtc: string): number {
  return topPxFromInstant(startUtc);
}

export function appointmentHeightPx(startUtc: string, endUtc: string): number {
  return heightPxFromInstants(startUtc, endUtc);
}

// Returns the corresponding instant as a JS Date — same signature as the
// pre-refactor function so the calendar drag/resize handlers remain
// untouched. Internally routed through TimeService so the math is now
// viewer-tz aware (spec Part 9.1) and DST-safe.
export function pixelsToDateTime(py: number, dayDate: Date): Date {
  return new Date(pixelsToInstantIso(py, plainDateFromJsDate(dayDate)));
}

// ISO-instant variant used by handlers that already speak in instants.
export function pixelsToInstantAtDay(py: number, dayDate: Date): string {
  return pixelsToInstantIso(py, plainDateFromJsDate(dayDate));
}

// True iff `startUtc` falls on `day` in viewer-tz.
export function isInstantOnDay(startUtc: string, day: Date): boolean {
  return isInstantOnViewerDay(startUtc, plainDateFromJsDate(day));
}

// Bucket lookup helper for useCalendar.
export function plainDateOfInstant(startUtc: string): string {
  return viewerPlainDate(startUtc);
}

// ── Format helpers ───────────────────────────────────────────────────────────

export function formatTime(startUtc: string): string {
  return formatTime24(startUtc);
}

export function formatMonthYear(d: Date): string {
  return tsFormatMonthYear(plainDateFromJsDate(d));
}

export function formatDateRange(start: Date, end: Date): string {
  return tsFormatDateRange(plainDateFromJsDate(start), plainDateFromJsDate(end));
}

export function formatWeekday(d: Date): string {
  return formatShortWeekday(plainDateFromJsDate(d));
}

export function todayPlainDateISO(): string {
  return todayPlainDate();
}
