import { useEffect, useState } from "react";
import type { WorkSession, WorkSessionType } from "./types";
import { startWorkSession, endWorkSession, elapsedMinutes } from "./workSession";
import { getViewerTimeZone } from "./zones";
import { Temporal } from "@js-temporal/polyfill";

// Spec Part 6 / Part 12. Global timer bar — visible component above the
// page content. Tracks a single active work session at a time.
//
// Crucially: timer time is the *viewer*'s wall-clock-derived UTC instant,
// independent of any appointment timezone. There is no read-path to
// `appointmentTimeZone` from this component (spec Part 6 — no timezone
// bleeding).

const SESSION_TYPES: { id: WorkSessionType; label: string }[] = [
  { id: "prereading", label: "Pre-reading" },
  { id: "assessment", label: "Assessment" },
  { id: "reportWriting", label: "Report writing" },
  { id: "admin", label: "Admin" },
  { id: "travel", label: "Travel" },
  { id: "break", label: "Break" },
  { id: "technicalDelay", label: "Technical delay" },
  { id: "interrupted", label: "Interrupted" },
];

type TimerStatus =
  | { kind: "idle" }
  | { kind: "running"; session: WorkSession; resumedAtUtc: string; baseSeconds: number }
  | { kind: "paused"; session: WorkSession; baseSeconds: number };

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export default function TimerBar() {
  const [type, setType] = useState<WorkSessionType>("prereading");
  const [status, setStatus] = useState<TimerStatus>({ kind: "idle" });
  const [completed, setCompleted] = useState<WorkSession[]>([]);
  const [tick, setTick] = useState(0);

  // Drive a 1-second tick only while running so the displayed time updates.
  useEffect(() => {
    if (status.kind !== "running") return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [status.kind]);

  function elapsedSeconds(): number {
    if (status.kind === "idle") return 0;
    if (status.kind === "paused") return status.baseSeconds;
    const startMs = Temporal.Instant.from(status.resumedAtUtc).epochMilliseconds;
    const nowMs = Temporal.Now.instant().epochMilliseconds;
    return status.baseSeconds + Math.max(0, Math.floor((nowMs - startMs) / 1000));
  }

  function handleStart() {
    if (status.kind === "running") return;
    if (status.kind === "paused") {
      // Resume existing session.
      setStatus({
        kind: "running",
        session: status.session,
        resumedAtUtc: Temporal.Now.instant().toString(),
        baseSeconds: status.baseSeconds,
      });
      return;
    }
    const session = startWorkSession({ type });
    setStatus({
      kind: "running",
      session,
      resumedAtUtc: session.startedAtUtc,
      baseSeconds: 0,
    });
  }

  function handlePause() {
    if (status.kind !== "running") return;
    setStatus({
      kind: "paused",
      session: status.session,
      baseSeconds: elapsedSeconds(),
    });
  }

  function handleStop() {
    if (status.kind === "idle") return;
    const totalSecs = elapsedSeconds();
    const ended = endWorkSession(status.session);
    // Override the durationMinutes with our pause-aware total seconds so
    // accumulated paused time is preserved. Spec Part 12.4: totals are
    // derived from the immutable record, not stored as state — we keep
    // startedAtUtc/endedAtUtc as the source of truth and recompute when
    // needed; durationMinutes here is a convenience cache only.
    const finalSession: WorkSession = {
      ...ended,
      durationMinutes: Math.round(totalSecs / 60),
    };
    setCompleted((prev) => [finalSession, ...prev]);
    setStatus({ kind: "idle" });
  }

  // Suppress unused-variable noise about `tick` — its state mutation is what
  // forces the re-render every second; the value itself isn't read.
  void tick;

  const elapsedSec = elapsedSeconds();
  const completedSec = completed.reduce(
    (s, c) => s + elapsedMinutes(c.startedAtUtc, c.endedAtUtc) * 60,
    0
  );
  const viewerTz = getViewerTimeZone();
  const isRunning = status.kind === "running";
  const isPaused = status.kind === "paused";
  const isIdle = status.kind === "idle";
  const activeLabel =
    !isIdle
      ? SESSION_TYPES.find((t) => t.id === status.session.type)?.label ?? status.session.type
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
        value={isIdle ? type : status.session.type}
        onChange={(e) => setType(e.target.value as WorkSessionType)}
        disabled={!isIdle}
        data-testid="timer-session-select"
      >
        {SESSION_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Live elapsed display. */}
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
            : isPaused
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-200 text-slate-500")
        }
      >
        {isRunning ? "Running" : isPaused ? "Paused" : "Idle"}
      </span>

      {activeLabel && <span className="text-slate-500">{activeLabel}</span>}

      {/* Controls. */}
      <div className="flex items-center gap-1.5 ml-auto">
        {!isRunning && (
          <button
            type="button"
            onClick={handleStart}
            data-testid="timer-start"
            className="px-2 py-1 rounded text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-xs font-medium"
          >
            {isPaused ? "Resume" : "Start"}
          </button>
        )}
        {isRunning && (
          <button
            type="button"
            onClick={handlePause}
            data-testid="timer-pause"
            className="px-2 py-1 rounded text-amber-900 bg-amber-200 hover:bg-amber-300 text-xs font-medium"
          >
            Pause
          </button>
        )}
        {!isIdle && (
          <button
            type="button"
            onClick={handleStop}
            data-testid="timer-stop"
            className="px-2 py-1 rounded text-white bg-rose-600 hover:bg-rose-700 text-xs font-medium"
          >
            Stop
          </button>
        )}
      </div>

      {/* Day total. Derived, not stored — spec Part 12.4. */}
      <span className="text-slate-400 text-[11px] tabular-nums">
        Today: {formatHms(completedSec + elapsedSec)} ({viewerTz})
      </span>
    </div>
  );
}
