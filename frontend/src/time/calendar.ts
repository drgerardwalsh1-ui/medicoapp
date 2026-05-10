import { Temporal } from "@js-temporal/polyfill";
import { getViewerTimeZone } from "./zones";

// Calendar geometry constants — kept here so the calendar module can read
// them through TimeService. Mirrors frontend/src/calendar/calendarUtils.ts
// constants of the same name.
export const HOUR_HEIGHT = 64;
export const START_HOUR = 8;
export const END_HOUR = 19;
export const SNAP_MINUTES = 15;

// Spec Part 9.1: vertical placement uses viewer timezone ONLY.
// Spec Part 10: drag/resize moves the absolute UTC instant.

export function topPxFromInstant(instantIso: string, viewerTz: string = getViewerTimeZone()): number {
  const z = Temporal.Instant.from(instantIso).toZonedDateTimeISO(viewerTz);
  const mins = (z.hour - START_HOUR) * 60 + z.minute;
  return Math.max(0, (mins / 60) * HOUR_HEIGHT);
}

export function heightPxFromInstants(startUtc: string, endUtc: string): number {
  // Height is derived from the absolute duration so it is invariant under
  // viewer-tz changes — a 90-minute appointment is always 90 minutes tall.
  // (No viewer-tz parameter; the duration is the same in any zone.)
  const start = Temporal.Instant.from(startUtc);
  const end = Temporal.Instant.from(endUtc);
  const durationMs = end.epochMilliseconds - start.epochMilliseconds;
  const durationMins = Math.max(durationMs / 60_000, SNAP_MINUTES);
  return (durationMins / 60) * HOUR_HEIGHT;
}

// Convert a (column day, pixel-y) interaction point into the corresponding
// UTC instant under the viewer's wall clock. Snaps to SNAP_MINUTES.
//
// `dayPlainDate` is the calendar column's date in viewer-tz (e.g. "2026-05-10").
// Returned ISO is canonical UTC ending in "Z".
export function pixelsToInstantIso(
  py: number,
  dayPlainDate: string,
  viewerTz: string = getViewerTimeZone()
): string {
  const rawMins = (py / HOUR_HEIGHT) * 60;
  const snapped = Math.round(rawMins / SNAP_MINUTES) * SNAP_MINUTES;
  const totalMins = START_HOUR * 60 + snapped;
  const clampedMins = Math.max(START_HOUR * 60, Math.min((END_HOUR - 1) * 60, totalMins));
  const date = Temporal.PlainDate.from(dayPlainDate);
  const wall = date.toPlainDateTime({
    hour: Math.floor(clampedMins / 60),
    minute: clampedMins % 60,
    second: 0,
  });
  // 'compatible' lenience matches the existing calendar UX — picking a slot
  // during DST spring-forward must still produce some valid instant rather
  // than throwing. Explicit UI-level rejection only happens on form submit.
  return wall.toZonedDateTime(viewerTz, { disambiguation: "compatible" }).toInstant().toString();
}

// True iff `instantIso` falls on `dayPlainDate` in the viewer's tz.
export function isInstantOnViewerDay(
  instantIso: string,
  dayPlainDate: string,
  viewerTz: string = getViewerTimeZone()
): boolean {
  const z = Temporal.Instant.from(instantIso).toZonedDateTimeISO(viewerTz);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}` === dayPlainDate;
}

// Viewer-tz wall-clock plain-date for an instant. Used by the calendar to
// bucket appointments into day columns.
export function viewerPlainDate(
  instantIso: string,
  viewerTz: string = getViewerTimeZone()
): string {
  const z = Temporal.Instant.from(instantIso).toZonedDateTimeISO(viewerTz);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}

// Week-start (Monday) plain-date in viewer-tz for an instant. Mirrors
// the existing getWeekStart() that the calendar header uses.
export function viewerWeekStartDate(
  instantIso: string,
  viewerTz: string = getViewerTimeZone()
): string {
  const z = Temporal.Instant.from(instantIso).toZonedDateTimeISO(viewerTz);
  // Temporal's dayOfWeek is 1=Mon..7=Sun, exactly matching ISO weekday rules.
  const monday = z.toPlainDate().subtract({ days: z.dayOfWeek - 1 });
  return `${monday.year}-${String(monday.month).padStart(2, "0")}-${String(monday.day).padStart(2, "0")}`;
}

// Generate a 7-day list of viewer-tz plain-dates starting at `weekStart`.
export function weekDates(weekStartPlainDate: string): string[] {
  const start = Temporal.PlainDate.from(weekStartPlainDate);
  return Array.from({ length: 7 }, (_, i) => {
    const d = start.add({ days: i });
    return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  });
}

// Add or subtract whole days from a plain-date — used by the prev/next-week
// navigation in CalendarView/useCalendar.
export function addDaysToPlainDate(plainDateISO: string, days: number): string {
  const d = Temporal.PlainDate.from(plainDateISO);
  const next = d.add({ days });
  return `${next.year}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;
}

export function todayPlainDate(viewerTz: string = getViewerTimeZone()): string {
  const z = Temporal.Now.zonedDateTimeISO(viewerTz);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}

export function nowMinutesSinceStartHour(viewerTz: string = getViewerTimeZone()): number {
  const z = Temporal.Now.zonedDateTimeISO(viewerTz);
  return (z.hour - START_HOUR) * 60 + z.minute;
}
