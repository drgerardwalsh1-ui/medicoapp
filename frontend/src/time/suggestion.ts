import { Temporal } from "@js-temporal/polyfill";
import type { Appointment } from "./types";
import type { WorkTimelineEventType } from "./types";

// Smart default for the TimerBar dropdown. The TimerBar itself stays a
// dumb view+dispatcher (it has no read-path to appointment data); main.tsx
// computes a `suggestedType` + stable `suggestionKey` and passes them in.
//
// Precedence (spec):
//   1. Appointment now/soon → "assessment".
//   2. Active tab is a report-writing section → "reportWriting".
//   3. Fall back to "prereading".

// Tabs that are explicitly report-writing. We list each id rather than
// pattern-match — schema section ids leak in here as plain strings.
const REPORT_TAB_IDS = new Set<string>([
  "history",        // schema: History of Injury (narrative)
  "pirs",           // schema: PIRS Assessment
  "opinion",        // schema: Opinion (diagnosis + causation)
]);

export function isReportWritingTab(activeClientTab: string | null | undefined): boolean {
  if (!activeClientTab) return false;
  return REPORT_TAB_IDS.has(activeClientTab);
}

type Instant = { appt: Appointment; startMs: number; endMs: number };

function instantize(list: Appointment[]): Instant[] {
  return list
    .map((a) => {
      try {
        return {
          appt: a,
          startMs: Temporal.Instant.from(a.startUtc).epochMilliseconds,
          endMs: Temporal.Instant.from(a.endUtc).epochMilliseconds,
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is Instant => x !== null);
}

// Return the most relevant appointment that is happening now or starts
// within `windowMinutes`. "Happening now" means startUtc <= now <= endUtc;
// "starting soon" means startUtc <= now + window AND endUtc >= now (so a
// finished appointment doesn't qualify). If multiple qualify, pick the
// earliest by start time.
export function findCurrentOrSoonAppointment(
  appointments: Appointment[] | undefined,
  nowMs: number,
  windowMinutes: number = 30,
): Appointment | null {
  const list = appointments ?? [];
  if (list.length === 0) return null;
  const windowMs = windowMinutes * 60_000;
  const qualifying = instantize(list)
    .filter(({ startMs, endMs }) => startMs <= nowMs + windowMs && endMs >= nowMs)
    .sort((a, b) => a.startMs - b.startMs);
  return qualifying.length > 0 ? qualifying[0].appt : null;
}

// Return the most recently ended appointment within `windowMinutes`
// before `nowMs`. Used to drive the post-assessment suggestion: once an
// appointment has ended (so it no longer qualifies for "now/soon"), we
// pivot the picker default to "reportWriting" for a reasonable window.
// Default window: 12 hours (a sane post-session report-writing window
// even if the user keeps the app open for a while).
export function findRecentCompletedAppointment(
  appointments: Appointment[] | undefined,
  nowMs: number,
  windowMinutes: number = 12 * 60,
): Appointment | null {
  const list = appointments ?? [];
  if (list.length === 0) return null;
  const windowMs = windowMinutes * 60_000;
  const qualifying = instantize(list)
    // Must have already ended (endMs < nowMs) AND ended within the window.
    .filter(({ endMs }) => endMs < nowMs && nowMs - endMs <= windowMs)
    // Most recently ended first.
    .sort((a, b) => b.endMs - a.endMs);
  return qualifying.length > 0 ? qualifying[0].appt : null;
}

// Compute the suggested default timer type + a stable key that callers
// use to detect "the suggestion actually changed in a meaningful way"
// (as opposed to e.g. a tab change that shouldn't override the picker
// once the user has touched it).
//
// The key is intentionally narrow: client id + currently-relevant
// appointment id. Tab changes do NOT contribute to the key — they only
// influence `type` when the appointment context is empty.
export type TimerSuggestion = {
  type: WorkTimelineEventType;
  key: string;
  // The appointment that drove the assessment suggestion, if any.
  // Used by handleTimerStart to attach linkedAppointmentId.
  appointmentId: string | null;
};

export function deriveSuggestedTimerType(
  client: { id?: string; appointments?: Appointment[] } | null,
  activeClientTab: string | null | undefined,
  nowMs: number,
  windowMinutes: number = 30,
): TimerSuggestion {
  if (!client?.id) {
    return { type: "prereading", key: "no-client", appointmentId: null };
  }
  // Appointment in-progress / starting soon → assessment.
  const upcoming = findCurrentOrSoonAppointment(client.appointments, nowMs, windowMinutes);
  if (upcoming) {
    return {
      type: "assessment",
      // Phase is encoded in the key so the picker updates exactly once
      // when the appointment transitions from before/during to after.
      key: `client:${client.id}:appointment:${upcoming.id}:before-or-during`,
      appointmentId: upcoming.id,
    };
  }
  // Recently-completed appointment → report writing (post-assessment).
  // This wins over the tab-based fallback so the picker is right even
  // if the user is still sitting on a non-report tab right after the
  // session ends.
  const recent = findRecentCompletedAppointment(client.appointments, nowMs);
  if (recent) {
    return {
      type: "reportWriting",
      key: `client:${client.id}:appointment:${recent.id}:after`,
      appointmentId: recent.id,
    };
  }
  // No appointment context — fall back to tab heuristic, then prereading.
  const apptKey = `client:${client.id}:appointment:none`;
  if (isReportWritingTab(activeClientTab)) {
    return { type: "reportWriting", key: apptKey, appointmentId: null };
  }
  return { type: "prereading", key: apptKey, appointmentId: null };
}
