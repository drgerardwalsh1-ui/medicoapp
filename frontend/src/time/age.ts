import { Temporal } from "@js-temporal/polyfill";

// Replaces the previous `365.25 * 24 * 60 * 60 * 1000` integer maths in
// types/client.ts. Temporal handles leap years and DST-free PlainDate
// arithmetic without any approximation.

export function ageOnDate(dobISO: string, atISO: string): number {
  if (!dobISO || !atISO) return 0;
  try {
    const dob = parsePlainDateLoose(dobISO);
    const at = parsePlainDateLoose(atISO);
    if (!dob || !at) return 0;
    if (Temporal.PlainDate.compare(at, dob) < 0) return 0;
    return at.since(dob, { largestUnit: "years" }).years;
  } catch {
    return 0;
  }
}

export function ageNow(dobISO: string): number {
  if (!dobISO) return 0;
  try {
    const today = Temporal.Now.plainDateISO();
    return ageOnDate(dobISO, `${today.year}-${pad2(today.month)}-${pad2(today.day)}`);
  } catch {
    return 0;
  }
}

export function yearsSince(fromISO: string): number {
  if (!fromISO) return 0;
  try {
    const today = Temporal.Now.plainDateISO();
    return ageOnDate(fromISO, `${today.year}-${pad2(today.month)}-${pad2(today.day)}`);
  } catch {
    return 0;
  }
}

function parsePlainDateLoose(s: string): Temporal.PlainDate | null {
  // Accept "YYYY-MM-DD" and ISO datetime forms; truncate datetimes to date.
  const dateOnly = s.length >= 10 ? s.slice(0, 10) : s;
  try {
    return Temporal.PlainDate.from(dateOnly);
  } catch {
    return null;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
