import { Temporal } from "@js-temporal/polyfill";

// Spec Part 8: duration is ALWAYS derived from end - start. It is not state.
// All durations use UTC instants so DST transitions never alter elapsed time
// (spec Part 12.6 — "running timers must calculate elapsed duration from
// UTC timestamps").

export function durationMinutes(startUtc: string, endUtc: string): number {
  const start = Temporal.Instant.from(startUtc);
  const end = Temporal.Instant.from(endUtc);
  const diff = end.epochMilliseconds - start.epochMilliseconds;
  return Math.round(diff / 60_000);
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

// Given a fixed start and a desired duration, return the new endUtc.
// Used when the user manually edits the duration dropdown — spec Part 8:
// "If user manually changes duration dropdown: update END TIME, keep START
// TIME fixed."
export function endUtcFromDuration(startUtc: string, minutes: number): string {
  const start = Temporal.Instant.from(startUtc);
  const end = start.add({ minutes });
  return end.toString();
}

// Millisecond delta between two UTC instants. Lives here (not in callers)
// so that drag/resize handlers don't need to construct ad-hoc Date objects
// for duration math (spec Part 1 — no independent time logic).
export function durationMs(startUtc: string, endUtc: string): number {
  const start = Temporal.Instant.from(startUtc);
  const end = Temporal.Instant.from(endUtc);
  return end.epochMilliseconds - start.epochMilliseconds;
}

// `instantIso > now`. Used by Home/ClientHome to decide if an appointment
// is upcoming versus past. Pure-instant comparison — viewer-tz independent.
export function isFutureInstant(utcIso: string): boolean {
  return Temporal.Instant.from(utcIso).epochMilliseconds > Temporal.Now.instant().epochMilliseconds;
}

// Compare two UTC instants. Returns -1 / 0 / 1.
export function compareInstants(a: string, b: string): number {
  const ai = Temporal.Instant.from(a).epochMilliseconds;
  const bi = Temporal.Instant.from(b).epochMilliseconds;
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

// Add minutes to a UTC instant. Used by the resize-min-end clamp.
export function addMinutesToInstant(utcIso: string, minutes: number): string {
  return Temporal.Instant.from(utcIso).add({ minutes }).toString();
}

// Standard appointment-duration choices surfaced in dropdowns.
// Mirrors the previous DURATION_MINS in ClientHome.tsx.
export const DURATION_MINUTE_OPTIONS = [15, 30, 45, 60, 75, 90, 105, 120] as const;
