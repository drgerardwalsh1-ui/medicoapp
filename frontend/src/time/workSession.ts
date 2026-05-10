import { Temporal } from "@js-temporal/polyfill";
import type { WorkSession, WorkSessionType, ViewerTimeZone, UUID } from "./types";
import { asViewerTimeZone } from "./types";
import { getViewerTimeZone } from "./zones";

// Spec Part 12. Pure helpers around the WorkSession data model. No UI yet
// (per "DO NOT implement full UI yet"). Sessions are immutable: every
// mutation produces a new record. Persistence is left to a future event
// handler — these helpers operate on plain in-memory records.
//
// Spec Part 6: work-session timestamps live in the *viewer* timezone, NEVER
// the appointment timezone. The branded ViewerTimeZone type enforces this
// at compile time.

export function startWorkSession(args: {
  type: WorkSessionType;
  clientId?: UUID;
  appointmentId?: UUID;
  viewerTimeZone?: ViewerTimeZone;
  pauseReason?: string;
}): WorkSession {
  const startedAtUtc = Temporal.Now.instant().toString();
  return {
    id: crypto.randomUUID(),
    type: args.type,
    startedAtUtc,
    endedAtUtc: null,
    viewerTimeZone: args.viewerTimeZone ?? asViewerTimeZone(getViewerTimeZone()),
    durationMinutes: 0,
    clientId: args.clientId,
    appointmentId: args.appointmentId,
    pauseReason: args.pauseReason,
  };
}

export function endWorkSession(
  session: WorkSession,
  args: { endReason?: string } = {}
): WorkSession {
  if (session.endedAtUtc !== null) return session;
  const endedAtUtc = Temporal.Now.instant().toString();
  return {
    ...session,
    endedAtUtc,
    endReason: args.endReason,
    durationMinutes: elapsedMinutes(session.startedAtUtc, endedAtUtc),
  };
}

// Spec Part 12.6/12.7: elapsed duration always derived from UTC instants —
// invariant under DST jumps, viewer-relocation, and clock shifts.
export function elapsedMinutes(startedAtUtc: string, endedAtUtc: string | null): number {
  const start = Temporal.Instant.from(startedAtUtc);
  const end =
    endedAtUtc === null ? Temporal.Now.instant() : Temporal.Instant.from(endedAtUtc);
  const ms = end.epochMilliseconds - start.epochMilliseconds;
  return Math.max(0, Math.round(ms / 60_000));
}

// Aggregate total minutes across an arbitrary collection of sessions —
// derived, never stored (spec Part 12.4).
export function totalMinutes(sessions: WorkSession[]): number {
  return sessions.reduce(
    (sum, s) => sum + elapsedMinutes(s.startedAtUtc, s.endedAtUtc),
    0
  );
}
