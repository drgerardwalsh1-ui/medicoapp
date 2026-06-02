import { useEffect, useState } from "react";
import type {
  WorkTimelineEvent,
  WorkTimelineEventType,
  AssessmentPauseIssue,
  AssessmentPauseIssueCategory,
} from "./types";
import { getViewerTimeZone } from "./zones";
import {
  todayEventsInViewerTz,
  totalMinutes as totalTimelineMinutes,
  displayedDurationMs,
  isPaused,
} from "./workTimeline";

// Spec Parts 1–6 (timer model). Global timer bar — view + dispatcher only.
// Pause is now real event-state (event.pausedAtUtc + accumulatedPausedMs),
// not a UI-local boolean. Elapsed is computed via `activeWorkMs(event)`,
// which excludes paused intervals — pause never inflates work duration.
//
// Crucially: timer time is the *viewer*'s wall-clock-derived UTC instant,
// independent of any appointment timezone. There is no read-path to
// `appointmentTimeZone` from this component (spec Part 14 — no timezone
// bleeding). TimerBar also has no read-path to appointment data — the
// suggested default timer type is computed in main.tsx and passed in via
// `suggestedType` / `suggestionKey`.

const SESSION_TYPES: { id: WorkTimelineEventType; label: string }[] = [
  { id: "prereading",     label: "Pre-reading" },
  { id: "assessment",     label: "Assessment" },
  { id: "reportWriting",  label: "Report writing" },
  { id: "admin",          label: "Admin" },
  { id: "travel",         label: "Travel" },
  { id: "break",          label: "Break" },
  { id: "interruption",   label: "Interruption" },
  { id: "technicalDelay", label: "Technical delay" },
  { id: "note",           label: "Note" },
  { id: "custom",         label: "Custom" },
];

// Assessment-pause issue chip groups. Pause reasons live INSIDE the
// Assessment event as AssessmentPauseIssue records — they are NOT
// separate timer-type events.
const ISSUE_GROUPS: { category: AssessmentPauseIssueCategory; label: string; reasons: string[] }[] = [
  {
    category: "technicalIssues",
    label: "Technical issues",
    reasons: [
      "Internet outage",
      "Audio failure",
      "Video failure",
      "Platform crash",
      "Power outage",
      "Device malfunction",
      "Connectivity instability",
      "Poor reception",
      "Network congestion",
      "Technical troubleshooting",
    ],
  },
  {
    category: "privacyConcerns",
    label: "Privacy concerns",
    reasons: [
      "Confidentiality breach",
      "Unexpected visitor",
      "Recording concerns",
      "Security concerns",
    ],
  },
  {
    category: "clinicalConcerns",
    label: "Clinical concerns",
    reasons: [
      "Risk assessment",
      "Distress escalation",
      "Crisis intervention",
      "Medical emergency",
      "Safety concerns",
      "Welfare check",
      "Emergency services contact",
    ],
  },
  {
    category: "communicationIssues",
    label: "Communication issues",
    reasons: [
      "Language barriers",
      "Interpreter issues",
      "Communication difficulties",
    ],
  },
  {
    category: "environmentalInterruptions",
    label: "Environmental interruptions",
    reasons: [
      "Background noise",
      "Environmental distraction",
      "Unexpected interruption",
      "Carer interruption",
    ],
  },
  {
    category: "administrativeRequirements",
    label: "Administrative requirements",
    reasons: [
      "Identity verification",
      "Consent clarification",
      "Medication verification",
      "Documentation review",
      "Legal requirements",
      "Mandatory reporting",
      "Child safeguarding",
    ],
  },
  {
    category: "participantFactors",
    label: "Participant factors",
    reasons: [
      "Participant unavailable",
      "Location change",
      "Scheduling conflict",
      "Time limit reached",
    ],
  },
  {
    category: "breaks",
    label: "Breaks",
    reasons: ["Comfort break", "Fatigue break"],
  },
  {
    category: "clinicalConsultation",
    label: "Clinical consultation",
    reasons: [
      "Consultation with colleague",
      "Supervisor",
      "Specialist",
      "Treating team",
    ],
  },
  {
    category: "sessionRescheduling",
    label: "Session rescheduling",
    reasons: [
      "Need to continue at a later time due to unforeseen circumstances or insufficient time remaining",
    ],
  },
];

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export type AssessmentPauseIssuePatch = Partial<
  Omit<AssessmentPauseIssue, "id" | "startedAtUtc" | "endedAtUtc">
>;

export type TimerBarProps = {
  activeEvent: WorkTimelineEvent | null;
  todayTimeline?: WorkTimelineEvent[];           // for "Today" total — client-scoped
  /**
   * Display name of the client that owns the currently-active timer.
   * Always rendered when a timer is running so the user can never
   * guess which client a running session belongs to — even after
   * navigating to a different client (spec: visible ownership).
   */
  ownerLabel?: string;
  /**
   * Suggested default timer type derived in main.tsx from active client
   * + appointment context + active tab. Used as the idle picker value
   * unless the user has manually changed it (see `suggestionKey`).
   */
  suggestedType?: WorkTimelineEventType;
  /**
   * Stable key that changes only when the suggestion's meaningful
   * inputs change (client id, appointment-now-state). When the key
   * changes and the timer is idle, the picker resets to `suggestedType`
   * and the user-touched flag clears. Tab changes deliberately do NOT
   * contribute to the key so the picker doesn't keep flipping under the
   * user once they've made a manual choice.
   */
  suggestionKey?: string;
  onStart?: (type: WorkTimelineEventType) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  /**
   * Called when the user edits the open assessment pause issue (chip
   * selection, note typing). Wiring lives in main.tsx so the same
   * owner-gate as other timer mutations applies.
   */
  onAssessmentPauseIssueChange?: (patch: AssessmentPauseIssuePatch) => void;
  /**
   * True when the timer cannot start (no active client, or active
   * client is an unsaved draft). The Start button surfaces the reason
   * via title attribute when this is true.
   */
  disabled?: boolean;
};

export default function TimerBar({
  activeEvent,
  todayTimeline,
  ownerLabel,
  suggestedType,
  suggestionKey,
  onStart,
  onPause,
  onResume,
  onStop,
  onAssessmentPauseIssueChange,
  disabled = false,
}: TimerBarProps) {
  const [pickerType, setPickerType] = useState<WorkTimelineEventType>(
    suggestedType ?? "prereading"
  );
  // Tracks whether the user manually changed the dropdown since the last
  // meaningful suggestion change. When false, a new suggestion (new
  // suggestionKey) overrides the picker; when true, only a key change
  // resets the picker — same-key suggestion drift never overrides.
  const [userTouchedPicker, setUserTouchedPicker] = useState(false);
  const [lastAppliedKey, setLastAppliedKey] = useState<string | undefined>(suggestionKey);
  const [, setTick] = useState(0);

  // Apply the suggested type whenever the suggestionKey changes (and the
  // timer is idle). This is the only place we override the user's choice.
  useEffect(() => {
    if (!suggestionKey) return;
    if (suggestionKey === lastAppliedKey) return;
    // Only override the picker when the timer is idle. If a session is
    // running we don't touch the picker — the dropdown is showing the
    // running event's type anyway.
    if (activeEvent === null && suggestedType) {
      setPickerType(suggestedType);
      setUserTouchedPicker(false);
    }
    setLastAppliedKey(suggestionKey);
  }, [suggestionKey, suggestedType, activeEvent, lastAppliedKey]);

  const paused = isPaused(activeEvent);
  const isRunning = activeEvent !== null && !paused;
  const isIdle = activeEvent === null;

  // 1-second tick when the displayed duration is actually advancing.
  // For non-assessment events: only while running (pause excludes time).
  // For assessment events: also while paused, because pause time counts
  // as part of the wall-clock session duration.
  const shouldTick =
    isRunning ||
    (paused && activeEvent !== null && activeEvent.type === "assessment");
  useEffect(() => {
    if (!shouldTick) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [shouldTick]);

  // Displayed elapsed uses `displayedDurationMs`, which routes Assessment
  // events to wall-clock (pauses count as part of the session) and all
  // other types to active work (pauses excluded).
  const elapsedSec = activeEvent
    ? Math.floor(displayedDurationMs(activeEvent) / 1000)
    : 0;

  const viewerTz = getViewerTimeZone();
  // "Today" derives from completed-today events plus the live active event
  // (whose contribution is already pause-aware via activeWorkMs).
  const todayInViewerTz = todayEventsInViewerTz(todayTimeline ?? [], viewerTz);
  const todayMin = totalTimelineMinutes(todayInViewerTz);

  const activeLabel =
    !isIdle
      ? SESSION_TYPES.find((t) => t.id === activeEvent.type)?.label ?? activeEvent.type
      : null;

  // Identify the open assessment pause issue (if any) — drives the
  // pause/issue panel below.
  const openIssue =
    activeEvent && activeEvent.type === "assessment" && paused
      ? (activeEvent.assessmentPauseIssues ?? []).find((i) => i.endedAtUtc === null) ?? null
      : null;
  const showIssuePanel = !!openIssue;

  return (
    <div
      role="region"
      aria-label="Work session timer"
      data-testid="timer-bar"
      className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 shrink-0"
    >
      <div className="flex items-center gap-3 px-4 py-2 text-xs text-slate-700 flex-wrap">
        <span className="font-semibold text-slate-900">Timer</span>

        {/* Work-session type selector — disabled while a session is active. */}
        <select
          className="input text-xs py-1"
          style={{ maxWidth: 180 }}
          value={isIdle ? pickerType : activeEvent.type}
          onChange={(e) => {
            setPickerType(e.target.value as WorkTimelineEventType);
            setUserTouchedPicker(true);
          }}
          disabled={!isIdle || disabled}
          data-testid="timer-session-select"
        >
          {SESSION_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        {/* Live elapsed display — billing-relevant work time only. */}
        <span
          className="tabular-nums font-mono text-sm text-slate-900"
          data-testid="timer-elapsed"
        >
          {formatHms(elapsedSec)}
        </span>

        {/* Status pill. */}
        <span
          className={
            "px-1.5 py-0.5 rounded text-[10px] font-medium " +
            (isRunning
              ? "bg-emerald-100 text-emerald-700"
              : paused
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-200 text-slate-500")
          }
        >
          {isRunning ? "Running" : paused ? "Paused" : "Idle"}
        </span>

        {activeLabel && <span className="text-slate-500">{activeLabel}</span>}

        {/* Suggested-type hint while idle, so the user can see why a
            particular default was chosen. Only shown when the picker
            currently matches the suggestion (otherwise the user has
            picked something else and the hint would be confusing). */}
        {isIdle && suggestedType && pickerType === suggestedType && !userTouchedPicker && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200"
            title="Suggested based on active client and appointment context"
          >
            suggested
          </span>
        )}

        {/* Visible ownership — always rendered when a timer is active.
            The contract is: the user must always know which client a
            running timer belongs to, especially after navigating away. */}
        {!isIdle && ownerLabel && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200"
            data-testid="timer-owner-label"
            title="Timer is bound to this client; switching pages does not transfer it"
          >
            for {ownerLabel}
          </span>
        )}

        {/* Controls. */}
        <div className="flex items-center gap-1.5 ml-auto">
          {isIdle && (
            <button
              type="button"
              onClick={() => onStart?.(pickerType)}
              data-testid="timer-start"
              className="px-2 py-1 rounded text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
              disabled={disabled}
              title={
                disabled
                  ? "Select a saved client first — timers must belong to a persisted client"
                  : undefined
              }
            >
              Start
            </button>
          )}
          {isRunning && (
            <button
              type="button"
              onClick={() => onPause?.()}
              data-testid="timer-pause"
              className="px-2 py-1 rounded text-amber-900 bg-amber-200 hover:bg-amber-300 text-xs font-medium"
            >
              Pause
            </button>
          )}
          {paused && (
            <button
              type="button"
              onClick={() => onResume?.()}
              data-testid="timer-resume"
              className="px-2 py-1 rounded text-white bg-emerald-600 hover:bg-emerald-700 text-xs font-medium"
            >
              Resume
            </button>
          )}
          {!isIdle && (
            <button
              type="button"
              onClick={() => onStop?.()}
              data-testid="timer-stop"
              className="px-2 py-1 rounded text-white bg-rose-600 hover:bg-rose-700 text-xs font-medium"
            >
              Stop
            </button>
          )}
        </div>

        {/* Day total. Derived from client.workTimeline filtered to viewer-tz today. */}
        <span className="text-slate-400 text-[11px] tabular-nums">
          Today: {formatHms(todayMin * 60)} ({viewerTz})
        </span>
      </div>

      {showIssuePanel && openIssue && (
        <AssessmentPausePanel
          issue={openIssue}
          onChange={(patch) => onAssessmentPauseIssueChange?.(patch)}
        />
      )}
    </div>
  );
}

// ── Assessment pause / issue panel ────────────────────────────────────
// Only rendered when the active timer is an Assessment AND the timer is
// paused. Layered UI:
//   1. Category chips ("Issue type") — multi-select.
//   2. Reason chips for the selected categories only — multi-select.
//   3. Free-text note.
//
// Issue capture lives INSIDE the Assessment event (no separate timer
// events). Chip/note edits patch the open issue immediately so data is
// not lost if the user navigates away.
//
// Reads tolerate both shapes:
//   - new arrays:   issue.categories, issue.reasons
//   - legacy singles: issue.category, issue.reason  (folded into arrays)

function readCategories(issue: AssessmentPauseIssue): AssessmentPauseIssueCategory[] {
  if (issue.categories && issue.categories.length > 0) return issue.categories;
  return issue.category ? [issue.category] : [];
}

function readReasons(issue: AssessmentPauseIssue): string[] {
  if (issue.reasons && issue.reasons.length > 0) return issue.reasons;
  return issue.reason ? [issue.reason] : [];
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function AssessmentPausePanel({
  issue,
  onChange,
}: {
  issue: AssessmentPauseIssue;
  onChange: (patch: AssessmentPauseIssuePatch) => void;
}) {
  const selectedCategories = readCategories(issue);
  const selectedReasons = readReasons(issue);
  const expandedGroups = ISSUE_GROUPS.filter((g) =>
    selectedCategories.includes(g.category)
  );

  return (
    <div
      data-testid="assessment-pause-panel"
      className="px-4 py-2 border-t border-amber-200 bg-amber-50 text-xs text-slate-700"
    >
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-semibold text-amber-900">Pause reason</span>
        <span className="text-[11px] text-amber-700">
          Assessment issue recorded. The Assessment timer continues to reflect the full session duration.
        </span>
      </div>

      {/* Section 1: category chips (always visible) */}
      <div className="mb-2">
        <p className="text-[11px] font-medium text-slate-600 mb-1">Issue type</p>
        <div className="flex flex-wrap gap-1.5">
          {ISSUE_GROUPS.map((group) => {
            const selected = selectedCategories.includes(group.category);
            return (
              <button
                key={group.category}
                type="button"
                onClick={() =>
                  onChange({
                    categories: toggle(selectedCategories, group.category),
                  })
                }
                className={
                  "px-2 py-0.5 rounded-full border text-[11px] transition " +
                  (selected
                    ? "bg-amber-600 text-white border-amber-700"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-amber-100 hover:border-amber-300")
                }
              >
                {group.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 2: reason chips — only for currently selected categories */}
      {expandedGroups.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] font-medium text-slate-600 mb-1">Reasons</p>
          <div className="space-y-1.5">
            {expandedGroups.map((group) => (
              <div key={group.category} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 min-w-[140px]">
                  {group.label}
                </span>
                {group.reasons.map((reason) => {
                  const selected = selectedReasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      type="button"
                      onClick={() =>
                        onChange({ reasons: toggle(selectedReasons, reason) })
                      }
                      className={
                        "px-2 py-0.5 rounded-full border text-[11px] transition " +
                        (selected
                          ? "bg-amber-600 text-white border-amber-700"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-amber-100 hover:border-amber-300")
                      }
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3: free-text note */}
      <div>
        <label className="block text-[11px] font-medium text-slate-600 mb-1">
          Notes
        </label>
        <textarea
          className="input text-xs py-1 w-full"
          rows={2}
          value={issue.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Optional context for this pause…"
        />
      </div>
    </div>
  );
}
