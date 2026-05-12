import { useEffect, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { ViewerTimeZone } from "./types";
import { asViewerTimeZone } from "./types";

// Module-level viewer-timezone state. The hook below subscribes; calendar
// utility functions read via `getViewerTimeZone()` so positioning never has
// to thread the tz through props.

let currentViewerTz: ViewerTimeZone = asViewerTimeZone(detectInitialViewerTz());
let testOverride: ViewerTimeZone | null = null;
const subscribers = new Set<(tz: ViewerTimeZone) => void>();

function detectInitialViewerTz(): string {
  try {
    return Temporal.Now.timeZoneId();
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }
}

export function getViewerTimeZone(): ViewerTimeZone {
  return testOverride ?? currentViewerTz;
}

// Test/dev hook. Calling with `null` clears the override and reverts to the
// system-detected value.
export function setViewerTimeZoneOverride(tz: string | null): void {
  testOverride = tz === null ? null : asViewerTimeZone(tz);
  notify();
}

function notify(): void {
  const tz = getViewerTimeZone();
  subscribers.forEach((s) => s(tz));
}

function refreshFromSystem(): void {
  const next = detectInitialViewerTz();
  if (next !== currentViewerTz) {
    currentViewerTz = asViewerTimeZone(next);
    if (testOverride === null) notify();
  }
}

// Subscribe to viewer-tz changes. Mount once near the root (AppLayout).
export function useViewerTimeZone(): ViewerTimeZone {
  const [tz, setTz] = useState<ViewerTimeZone>(getViewerTimeZone);

  useEffect(() => {
    subscribers.add(setTz);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") refreshFromSystem();
    }
    function onFocus() {
      refreshFromSystem();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshFromSystem();
    }, 60_000);

    return () => {
      subscribers.delete(setTz);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, []);

  return tz;
}

// IANA tz options surfaced in the appointment-tz dropdown. Ordered by
// likelihood for an Australian medico-legal practice; the trailing list
// covers New Zealand and the most common overseas-witness destinations.
// The dropdown also accepts free-text entry of any other valid IANA id.
export type TimeZoneOption = {
  id: string;
  label: string;
  group: "Australia" | "New Zealand" | "International";
};

export const TIMEZONE_OPTIONS: TimeZoneOption[] = [
  { id: "Australia/Sydney", label: "Sydney (NSW/ACT)", group: "Australia" },
  { id: "Australia/Melbourne", label: "Melbourne (VIC)", group: "Australia" },
  { id: "Australia/Brisbane", label: "Brisbane (QLD)", group: "Australia" },
  { id: "Australia/Adelaide", label: "Adelaide (SA)", group: "Australia" },
  { id: "Australia/Perth", label: "Perth (WA)", group: "Australia" },
  { id: "Australia/Hobart", label: "Hobart (TAS)", group: "Australia" },
  { id: "Australia/Darwin", label: "Darwin (NT)", group: "Australia" },
  { id: "Pacific/Auckland", label: "Auckland (NZ)", group: "New Zealand" },
  { id: "Europe/London", label: "London (UK)", group: "International" },
  { id: "America/New_York", label: "New York (US East)", group: "International" },
  { id: "America/Los_Angeles", label: "Los Angeles (US West)", group: "International" },
  { id: "Asia/Singapore", label: "Singapore", group: "International" },
  { id: "Asia/Tokyo", label: "Tokyo", group: "International" },
  { id: "UTC", label: "UTC", group: "International" },
];

// Validate an arbitrary string is an IANA id Temporal recognises.
export function isValidTimeZone(id: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(id);
    return true;
  } catch {
    return false;
  }
}

// DST abbreviation for a timezone at the current instant (or a given UTC ISO).
// Returns e.g. "AEDT", "AEST", "UTC+8", "GMT+5:30".
export function tzAbbreviation(tz: string, instantIso?: string): string {
  const date = instantIso ? new Date(instantIso) : new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

// Offset of `tz` relative to viewer-tz at a given instant, in minutes.
// Positive => `tz` is ahead of viewer.
export function offsetMinutesAt(
  instantIso: string,
  tz: string,
  viewerTz: string
): number {
  const instant = Temporal.Instant.from(instantIso);
  const a = instant.toZonedDateTimeISO(tz);
  const b = instant.toZonedDateTimeISO(viewerTz);
  return Math.round((a.offsetNanoseconds - b.offsetNanoseconds) / 60e9);
}
