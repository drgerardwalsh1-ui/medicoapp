import { Temporal } from "@js-temporal/polyfill";
import { useEffect, useState } from "react";
import type { Appointment, AppointmentAlert } from "./types";
import { getViewerTimeZone } from "./zones";

// Pure derivation. Returns the most urgent active alert across the supplied
// appointments, or null if none are imminent. Spec Part 11.

const PRE15_MINUTES = 15;
const PRE5_MINUTES = 5;

export function computeActiveAlert(
  appointments: Appointment[],
  nowInstantIso: string
): AppointmentAlert | null {
  const now = Temporal.Instant.from(nowInstantIso);

  let best: AppointmentAlert | null = null;

  for (const appt of appointments) {
    let start: Temporal.Instant;
    let end: Temporal.Instant;
    try {
      start = Temporal.Instant.from(appt.startUtc);
      end = Temporal.Instant.from(appt.endUtc);
    } catch {
      continue;
    }

    const minutesToStart = Math.round(
      (start.epochMilliseconds - now.epochMilliseconds) / 60_000
    );
    const minutesToEnd = Math.round(
      (end.epochMilliseconds - now.epochMilliseconds) / 60_000
    );

    let alert: AppointmentAlert | null = null;

    if (minutesToEnd < 0) {
      // Ended in the past — not actionable.
      continue;
    }

    if (minutesToStart > PRE15_MINUTES) {
      // Too far away to alert.
      continue;
    }

    if (minutesToStart > PRE5_MINUTES) {
      alert = {
        kind: "pre15",
        appointmentId: appt.id,
        startUtc: appt.startUtc,
        endUtc: appt.endUtc,
        appointmentTimeZone: appt.appointmentTimeZone,
        minutesDelta: minutesToStart,
      };
    } else if (minutesToStart > 0) {
      alert = {
        kind: "pre5",
        appointmentId: appt.id,
        startUtc: appt.startUtc,
        endUtc: appt.endUtc,
        appointmentTimeZone: appt.appointmentTimeZone,
        minutesDelta: minutesToStart,
      };
    } else {
      // Already started but not yet ended — appointment is overdue/overrunning.
      alert = {
        kind: "overrun",
        appointmentId: appt.id,
        startUtc: appt.startUtc,
        endUtc: appt.endUtc,
        appointmentTimeZone: appt.appointmentTimeZone,
        minutesDelta: minutesToStart,
      };
    }

    if (!best || alertPriority(alert) > alertPriority(best)) best = alert;
  }

  return best;
}

function alertPriority(a: AppointmentAlert): number {
  // overrun > pre5 > pre15 — most urgent wins.
  if (a.kind === "overrun") return 3;
  if (a.kind === "pre5") return 2;
  return 1;
}

// React hook — 30s tick is sub-minute so the pre5/pre15/overrun crossings
// fire predictably even when the OS clock drifts a few seconds.
export function useAppointmentAlerts(appointments: Appointment[]): AppointmentAlert | null {
  const [alert, setAlert] = useState<AppointmentAlert | null>(() =>
    computeActiveAlert(appointments, Temporal.Now.instant().toString())
  );

  useEffect(() => {
    function tick() {
      setAlert(computeActiveAlert(appointments, Temporal.Now.instant().toString()));
    }
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [appointments]);

  return alert;
}

// Build a human-readable banner message. Pure formatting — separated from
// the derivation per spec Part 13.
export function alertMessage(alert: AppointmentAlert, viewerTz: string = getViewerTimeZone()): string {
  const startZ = Temporal.Instant.from(alert.startUtc).toZonedDateTimeISO(viewerTz);
  const startLocal = `${pad2(startZ.hour)}:${pad2(startZ.minute)}`;

  const showSecondary = alert.appointmentTimeZone !== viewerTz;
  const apptZ = showSecondary
    ? Temporal.Instant.from(alert.startUtc).toZonedDateTimeISO(alert.appointmentTimeZone)
    : null;
  const cityName = alert.appointmentTimeZone.split("/").pop()?.replace(/_/g, " ") ?? alert.appointmentTimeZone;
  const secondary =
    apptZ && apptZ.offsetNanoseconds !== startZ.offsetNanoseconds
      ? ` (${pad2(apptZ.hour)}:${pad2(apptZ.minute)} ${cityName})`
      : "";

  if (alert.kind === "pre15") {
    return `Next appointment begins in ${alert.minutesDelta} minutes — ${startLocal}${secondary}.`;
  }
  if (alert.kind === "pre5") {
    return `Next appointment begins in ${alert.minutesDelta} minute${alert.minutesDelta === 1 ? "" : "s"} — ${startLocal}${secondary}.`;
  }
  // overrun
  const overrunBy = -alert.minutesDelta;
  return `Appointment in progress (started at ${startLocal}${secondary}, ${overrunBy} min ago). Risk of overrun.`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
