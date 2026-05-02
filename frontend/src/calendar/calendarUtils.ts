export type { Appointment } from "../types/client";

export type ClientStatus = "complete" | "in_progress" | "missing";

// Grid layout constants
export const HOUR_HEIGHT = 64;
export const START_HOUR = 8;
export const END_HOUR = 19;
export const SNAP_MINUTES = 15;
export const TIME_LABEL_WIDTH = 56;

export const HOURS = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, i) => START_HOUR + i
);

export const TOTAL_GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

// ── Week helpers ─────────────────────────────────────────────────────────────

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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

export function appointmentTopPx(isoStart: string): number {
  const d = new Date(isoStart);
  const mins = (d.getHours() - START_HOUR) * 60 + d.getMinutes();
  return Math.max(0, (mins / 60) * HOUR_HEIGHT);
}

export function appointmentHeightPx(isoStart: string, isoEnd: string): number {
  const durationMs = new Date(isoEnd).getTime() - new Date(isoStart).getTime();
  const durationMins = Math.max(durationMs / 60000, SNAP_MINUTES);
  return (durationMins / 60) * HOUR_HEIGHT;
}

export function pixelsToDateTime(py: number, dayDate: Date): Date {
  const rawMins = (py / HOUR_HEIGHT) * 60;
  const snapped = Math.round(rawMins / SNAP_MINUTES) * SNAP_MINUTES;
  const totalMins = START_HOUR * 60 + snapped;
  const clamped = Math.max(START_HOUR * 60, Math.min((END_HOUR - 1) * 60, totalMins));
  const result = new Date(dayDate);
  result.setHours(Math.floor(clamped / 60), clamped % 60, 0, 0);
  return result;
}

// ── Format helpers ───────────────────────────────────────────────────────────

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatMonthYear(d: Date): string {
  return d.toLocaleDateString([], { month: "long", year: "numeric" });
}

export function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString([], opts)} – ${end.getDate()}`;
  }
  return `${start.toLocaleDateString([], opts)} – ${end.toLocaleDateString([], opts)}`;
}
