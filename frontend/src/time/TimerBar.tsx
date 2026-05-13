import { useEffect, useState } from "react";
import type { WorkTimelineEvent, WorkTimelineEventType } from "./types";
import { getViewerTimeZone } from "./zones";
import {
  todayEventsInViewerTz,
  totalMinutes as totalTimelineMinutes,
  activeWorkMs,
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
// bleeding).

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

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

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
  onStart?: (type: WorkTimelineEventType) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
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
  onStart,
  onPause,
  onResume,
  onStop,
  disabled = false,
}: TimerBarProps) {
  const [pickerType, setPickerType] = useState<WorkTimelineEventType>("prereading");
  const [, setTick] = useState(0);

  const paused = isPaused(activeEvent);
  const isRunning = activeEvent !== null && !paused;
  const isIdle = activeEvent === null;

  // 1-second tick only while running so the displayed time updates.
  // Paused events don't tick — `activeWorkMs` is constant during pause
  // because in-flight pause time is subtracted out.
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  const elapsedSec = activeEvent
    ? Math.floor(activeWorkMs(activeEvent) / 1000)
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

  return (
    <div
      role="region"
      aria-label="Work session timer"
      data-testid="timer-bar"
      className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-slate-50 text-xs text-slate-700 shrink-0 flex-wrap"
    >
      <span className="font-semibold text-slate-900">Timer</span>

      {/* Work-session type selector — disabled while a session is active. */}
      <select
        className="input text-xs py-1"
        style={{ maxWidth: 180 }}
        value={isIdle ? pickerType : activeEvent.type}
        onChange={(e) => setPickerType(e.target.value as WorkTimelineEventType)}
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
  );
}
