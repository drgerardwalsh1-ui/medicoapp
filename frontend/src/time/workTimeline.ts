import { Temporal } from "@js-temporal/polyfill";
import type {
  WorkTimelineEvent,
  WorkTimelineEventType,
  WorkSession,
  ViewerTimeZone,
  UUID,
  AssessmentPauseIssue,
} from "./types";
import { asViewerTimeZone } from "./types";
import { getViewerTimeZone } from "./zones";

// Spec Part 17–20. Pure helpers around the WorkTimelineEvent collection. The
// collection IS the authoritative case chronology — never mirrored, never
// silently corrected. Every mutation goes through here so provenance flags
// (`createdAutomatically`, `manuallyEdited`) are preserved.

export function newTimelineEvent(args: {
  type: WorkTimelineEventType;
  title: string;
  startedAtUtc: string;
  endedAtUtc?: string | null;
  description?: string;
  viewerTimeZone?: ViewerTimeZone;
  linkedAppointmentId?: UUID;
  linkedWorkSessionId?: UUID;
  createdAutomatically?: boolean;
}): WorkTimelineEvent {
  return {
    id: crypto.randomUUID(),
    type: args.type,
    title: args.title,
    description: args.description,
    startedAtUtc: args.startedAtUtc,
    endedAtUtc: args.endedAtUtc ?? null,
    viewerTimeZone: args.viewerTimeZone ?? asViewerTimeZone(getViewerTimeZone()),
    linkedAppointmentId: args.linkedAppointmentId,
    linkedWorkSessionId: args.linkedWorkSessionId,
    manuallyEdited: false,
    createdAutomatically: args.createdAutomatically ?? false,
    accumulatedPausedMs: 0,
    pausedAtUtc: null,
  };
}

// Convert a stopped WorkSession into a timeline event. Provenance flags
// preserve the auto-generated origin (spec Part 19).
export function fromWorkSession(session: WorkSession, title?: string): WorkTimelineEvent {
  const map: Record<WorkSession["type"], WorkTimelineEventType> = {
    prereading: "prereading",
    assessment: "assessment",
    reportWriting: "reportWriting",
    admin: "admin",
    travel: "travel",
    break: "break",
    technicalDelay: "technicalDelay",
    interrupted: "interruption",
  };
  return {
    id: crypto.randomUUID(),
    type: map[session.type] ?? "custom",
    title: title ?? defaultTitleForType(map[session.type] ?? "custom"),
    startedAtUtc: session.startedAtUtc,
    endedAtUtc: session.endedAtUtc,
    viewerTimeZone: session.viewerTimeZone,
    linkedWorkSessionId: session.id,
    manuallyEdited: false,
    createdAutomatically: true,
  };
}

export function defaultTitleForType(type: WorkTimelineEventType): string {
  switch (type) {
    case "prereading":      return "Prereading";
    case "assessment":      return "Assessment";
    case "reportWriting":   return "Report writing";
    case "admin":           return "Admin";
    case "travel":          return "Travel";
    case "break":           return "Break";
    case "interruption":    return "Interruption";
    case "technicalDelay":  return "Technical delay";
    case "note":            return "Note";
    case "custom":          return "Activity";
  }
}

// Sorted chronologically by start instant. Stable order across reads — the
// timeline is the source of truth, so callers never have to re-sort.
function sortChronological(timeline: WorkTimelineEvent[]): WorkTimelineEvent[] {
  return [...timeline].sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc));
}

export function appendEvent(
  timeline: WorkTimelineEvent[] | undefined,
  event: WorkTimelineEvent
): WorkTimelineEvent[] {
  return sortChronological([...(timeline ?? []), event]);
}

// Patch fields on an existing event. Always sets manuallyEdited=true while
// preserving createdAutomatically (spec Part 19).
export function updateEvent(
  timeline: WorkTimelineEvent[] | undefined,
  id: UUID,
  patch: Partial<Omit<WorkTimelineEvent, "id" | "createdAutomatically">>
): WorkTimelineEvent[] {
  return sortChronological(
    (timeline ?? []).map((e) =>
      e.id === id
        ? {
            ...e,
            ...patch,
            manuallyEdited: true,
            createdAutomatically: e.createdAutomatically,
          }
        : e
    )
  );
}

export function deleteEvent(
  timeline: WorkTimelineEvent[] | undefined,
  id: UUID
): WorkTimelineEvent[] {
  return (timeline ?? []).filter((e) => e.id !== id);
}

// Split an event into two adjacent events at `atUtc`. Both halves inherit
// the original's type/title and become manuallyEdited; provenance is
// retained on the first half only — the second half is a fresh event.
export function splitEvent(
  timeline: WorkTimelineEvent[] | undefined,
  id: UUID,
  atUtc: string
): WorkTimelineEvent[] {
  const t = timeline ?? [];
  const e = t.find((x) => x.id === id);
  if (!e) return t;
  const start = Temporal.Instant.from(e.startedAtUtc).epochMilliseconds;
  const split = Temporal.Instant.from(atUtc).epochMilliseconds;
  const end = e.endedAtUtc === null ? Number.POSITIVE_INFINITY : Temporal.Instant.from(e.endedAtUtc).epochMilliseconds;
  if (split <= start || split >= end) return t; // no-op for invalid splits

  const first: WorkTimelineEvent = {
    ...e,
    endedAtUtc: atUtc,
    manuallyEdited: true,
  };
  const second: WorkTimelineEvent = {
    ...e,
    id: crypto.randomUUID(),
    startedAtUtc: atUtc,
    manuallyEdited: true,
    createdAutomatically: false,
    linkedWorkSessionId: undefined,
  };
  return sortChronological([...t.filter((x) => x.id !== id), first, second]);
}

// Spec Part 20: reject impossible states. Never silently auto-correct.
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateEvent(event: WorkTimelineEvent): ValidationResult {
  if (!event.startedAtUtc) return { ok: false, reason: "Start time required" };
  let startMs: number;
  try {
    startMs = Temporal.Instant.from(event.startedAtUtc).epochMilliseconds;
  } catch {
    return { ok: false, reason: "Invalid start instant" };
  }
  if (event.endedAtUtc !== null) {
    let endMs: number;
    try {
      endMs = Temporal.Instant.from(event.endedAtUtc).epochMilliseconds;
    } catch {
      return { ok: false, reason: "Invalid end instant" };
    }
    if (endMs < startMs) return { ok: false, reason: "End is before start" };
    if (endMs === startMs) return { ok: false, reason: "Zero-length event" };
  }
  return { ok: true };
}

// Filter to events whose start instant falls on the viewer's *today* in the
// viewer tz. Uses Temporal zoned date comparison so DST and non-UTC viewers
// are handled correctly (cf. frontend/src/time/calendar.ts).
export function todayEventsInViewerTz(
  timeline: WorkTimelineEvent[] | undefined,
  viewerTz: string
): WorkTimelineEvent[] {
  const today = Temporal.Now.plainDateISO(viewerTz);
  return (timeline ?? []).filter((e) => {
    try {
      const z = Temporal.Instant.from(e.startedAtUtc).toZonedDateTimeISO(viewerTz);
      return z.toPlainDate().equals(today);
    } catch {
      return false;
    }
  });
}

// Active *work* duration in ms — excludes paused intervals. This is the
// single source of truth for billing-relevant durations. Used by:
//   - TimerBar (live display)
//   - WorkTimelinePage (per-row + total)
//   - print/export rendering
// Never compute `now - startedAt` directly anywhere in the app.
export function activeWorkMs(event: WorkTimelineEvent, nowMs?: number): number {
  let startMs: number;
  try {
    startMs = Temporal.Instant.from(event.startedAtUtc).epochMilliseconds;
  } catch {
    return 0;
  }
  const endMs =
    event.endedAtUtc !== null
      ? safeInstantMs(event.endedAtUtc, nowMs)
      : (nowMs ?? Temporal.Now.instant().epochMilliseconds);

  // Total accumulated paused duration = completed pause spans plus the
  // currently in-flight pause (if any). Excluded from work duration.
  const accumulated = Math.max(0, event.accumulatedPausedMs ?? 0);
  let inFlightPaused = 0;
  if (event.pausedAtUtc) {
    const pausedFromMs = safeInstantMs(event.pausedAtUtc, nowMs);
    const referenceMs =
      event.endedAtUtc !== null
        ? safeInstantMs(event.endedAtUtc, nowMs)
        : (nowMs ?? Temporal.Now.instant().epochMilliseconds);
    inFlightPaused = Math.max(0, referenceMs - pausedFromMs);
  }
  const work = endMs - startMs - accumulated - inFlightPaused;
  return Math.max(0, work);
}

// Wall-clock span from startedAt to endedAt-or-now. Unlike `activeWorkMs`,
// this INCLUDES paused intervals — Assessment pauses are part of the
// session and should count toward the displayed duration. Non-assessment
// timers still default to `activeWorkMs` (pause excluded).
export function wallClockMs(event: WorkTimelineEvent, nowMs?: number): number {
  let startMs: number;
  try {
    startMs = Temporal.Instant.from(event.startedAtUtc).epochMilliseconds;
  } catch {
    return 0;
  }
  const endMs =
    event.endedAtUtc !== null
      ? safeInstantMs(event.endedAtUtc, nowMs)
      : (nowMs ?? Temporal.Now.instant().epochMilliseconds);
  return Math.max(0, endMs - startMs);
}

// Per-event-type display duration. Assessment uses wall-clock (pauses
// count); everything else uses active work (pauses excluded). This is
// the single point used by TimerBar elapsed, WorkTimelinePage row
// labels, and the today/total aggregates — keeping it centralised
// prevents per-call-site drift.
export function displayedDurationMs(event: WorkTimelineEvent, nowMs?: number): number {
  if (event.type === "assessment") return wallClockMs(event, nowMs);
  return activeWorkMs(event, nowMs);
}

function safeInstantMs(iso: string, fallbackMs?: number): number {
  try {
    return Temporal.Instant.from(iso).epochMilliseconds;
  } catch {
    return fallbackMs ?? Temporal.Now.instant().epochMilliseconds;
  }
}

// Begin an in-flight pause on the active running event (the one with
// endedAtUtc === null). No-op if the timeline has no active event or the
// active event is already paused. Pause is event-state, not UI state.
// For Assessment events, also opens a new AssessmentPauseIssue with
// endedAtUtc=null so the UI can attach a reason/note while paused.
export function pauseEvent(
  timeline: WorkTimelineEvent[] | undefined,
  id: UUID,
  atUtc?: string
): WorkTimelineEvent[] {
  const t = timeline ?? [];
  const e = t.find((x) => x.id === id);
  if (!e || e.endedAtUtc !== null || e.pausedAtUtc) return t;
  const now = atUtc ?? Temporal.Now.instant().toString();
  return sortChronological(
    t.map((x) => {
      if (x.id !== id) return x;
      const next: WorkTimelineEvent = { ...x, pausedAtUtc: now };
      if (x.type === "assessment") {
        const openIssue: AssessmentPauseIssue = {
          id: crypto.randomUUID(),
          startedAtUtc: now,
          endedAtUtc: null,
        };
        next.assessmentPauseIssues = [
          ...(x.assessmentPauseIssues ?? []),
          openIssue,
        ];
      }
      return next;
    })
  );
}

// Patch the open (endedAtUtc === null) AssessmentPauseIssue on an event.
// Does NOT set manuallyEdited — issue capture is automatic, not a manual
// edit of the timeline event itself.
export function updateOpenAssessmentPauseIssue(
  timeline: WorkTimelineEvent[] | undefined,
  eventId: UUID,
  patch: Partial<Omit<AssessmentPauseIssue, "id" | "startedAtUtc" | "endedAtUtc">>
): WorkTimelineEvent[] {
  const t = timeline ?? [];
  return sortChronological(
    t.map((x) => {
      if (x.id !== eventId) return x;
      const issues = x.assessmentPauseIssues ?? [];
      const openIdx = issues.findIndex((i) => i.endedAtUtc === null);
      if (openIdx < 0) return x;
      const nextIssues = issues.map((i, idx) =>
        idx === openIdx ? { ...i, ...patch } : i
      );
      return { ...x, assessmentPauseIssues: nextIssues };
    })
  );
}

// End an in-flight pause: fold (now - pausedAtUtc) into accumulatedPausedMs
// and clear pausedAtUtc. No-op if no in-flight pause.
export function resumeEvent(
  timeline: WorkTimelineEvent[] | undefined,
  id: UUID,
  atUtc?: string
): WorkTimelineEvent[] {
  const t = timeline ?? [];
  const e = t.find((x) => x.id === id);
  if (!e || !e.pausedAtUtc) return t;
  const nowIso = atUtc ?? Temporal.Now.instant().toString();
  const pausedFromMs = safeInstantMs(e.pausedAtUtc);
  const nowMs = safeInstantMs(nowIso);
  const delta = Math.max(0, nowMs - pausedFromMs);
  return sortChronological(
    t.map((x) => {
      if (x.id !== id) return x;
      const next: WorkTimelineEvent = {
        ...x,
        pausedAtUtc: null,
        accumulatedPausedMs: Math.max(0, x.accumulatedPausedMs ?? 0) + delta,
      };
      // Close any open assessment pause issue (assessment-only path).
      if (x.type === "assessment" && x.assessmentPauseIssues?.some((i) => i.endedAtUtc === null)) {
        next.assessmentPauseIssues = x.assessmentPauseIssues.map((i) =>
          i.endedAtUtc === null ? { ...i, endedAtUtc: nowIso } : i
        );
      }
      return next;
    })
  );
}

// Stop an active event: drains any in-flight pause into accumulatedPausedMs
// and sets endedAtUtc. The wall-clock span is preserved [startedAt, endedAt]
// — `activeWorkMs` reports the billable subset.
export function stopEvent(
  timeline: WorkTimelineEvent[] | undefined,
  id: UUID,
  atUtc?: string
): WorkTimelineEvent[] {
  const t = timeline ?? [];
  const e = t.find((x) => x.id === id);
  if (!e || e.endedAtUtc !== null) return t;
  const nowIso = atUtc ?? Temporal.Now.instant().toString();
  const nowMs = safeInstantMs(nowIso);
  let accumulated = Math.max(0, e.accumulatedPausedMs ?? 0);
  if (e.pausedAtUtc) {
    const pausedFromMs = safeInstantMs(e.pausedAtUtc);
    accumulated += Math.max(0, nowMs - pausedFromMs);
  }
  return sortChronological(
    t.map((x) => {
      if (x.id !== id) return x;
      const next: WorkTimelineEvent = {
        ...x,
        endedAtUtc: nowIso,
        pausedAtUtc: null,
        accumulatedPausedMs: accumulated,
      };
      if (x.type === "assessment" && x.assessmentPauseIssues?.some((i) => i.endedAtUtc === null)) {
        next.assessmentPauseIssues = x.assessmentPauseIssues.map((i) =>
          i.endedAtUtc === null ? { ...i, endedAtUtc: nowIso } : i
        );
      }
      return next;
    })
  );
}

// Aggregate total displayed-duration minutes across the supplied events.
// Routes through `displayedDurationMs` so Assessment events count their
// full wall-clock span (pause included) while other types continue to
// exclude pause time. Uses live "now" for any event still running.
export function totalMinutes(events: WorkTimelineEvent[]): number {
  const nowMs = Temporal.Now.instant().epochMilliseconds;
  return events.reduce(
    (sum, e) => sum + Math.round(displayedDurationMs(e, nowMs) / 60_000),
    0
  );
}

// True iff exactly one event is currently running (endedAtUtc === null).
// Returns that event for the caller's convenience, or null otherwise.
// "Running" includes paused — a paused event is still open, just not
// accumulating work time.
export function activeEvent(
  timeline: WorkTimelineEvent[] | undefined
): WorkTimelineEvent | null {
  const open = (timeline ?? []).filter((e) => e.endedAtUtc === null);
  return open.length === 1 ? open[0] : null;
}

// True iff the event is currently in an in-flight pause.
export function isPaused(event: WorkTimelineEvent | null | undefined): boolean {
  return !!event && event.endedAtUtc === null && !!event.pausedAtUtc;
}
