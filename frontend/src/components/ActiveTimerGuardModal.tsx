import { useEffect, useState } from "react";
import {
  activeWorkMs,
  type WorkTimelineEvent,
} from "../time";
import { formatFullName, type Client } from "../types/client";

// Confirmation modal that intercepts any navigation away from a client
// while a timer is running on it. Three explicit choices:
//
//   1. "End timer and continue"  — stop + persist, then run the pending
//                                  navigation. This is the only path
//                                  that actually finalises the event.
//   2. "Return to current client" — abort navigation, restore the timer's
//                                   owner as the active client view.
//   3. "Cancel"                  — abort navigation, leave everything as
//                                  it is (user might be mid-form somewhere).
//
// Per spec: no silent timer destruction; no automatic transfer between
// clients; no timers surviving navigation invisibly. If the user opts
// to continue, the WorkTimeline event MUST already be persisted before
// the new context becomes active — main.tsx handles that side effect.

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function typeLabel(t: WorkTimelineEvent["type"]): string {
  switch (t) {
    case "prereading":     return "Pre-reading";
    case "assessment":     return "Assessment";
    case "reportWriting":  return "Report writing";
    case "admin":          return "Admin";
    case "travel":         return "Travel";
    case "break":          return "Break";
    case "interruption":   return "Interruption";
    case "technicalDelay": return "Technical delay";
    case "note":           return "Note";
    case "custom":         return "Activity";
  }
}

export type ActiveTimerGuardModalProps = {
  open: boolean;
  ownerClient: Client | null;
  activeEvent: WorkTimelineEvent | null;
  onEndAndContinue: () => void;
  onReturnToCurrent: () => void;
  onCancel: () => void;
};

export default function ActiveTimerGuardModal({
  open,
  ownerClient,
  activeEvent,
  onEndAndContinue,
  onReturnToCurrent,
  onCancel,
}: ActiveTimerGuardModalProps) {
  // Live elapsed display. The modal can stay open while the user thinks
  // about the choice; the displayed work-time should keep ticking so
  // it reflects the real cost of staying open.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open || !activeEvent || activeEvent.pausedAtUtc) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open, activeEvent]);

  // Escape closes via Cancel — same semantics as clicking outside.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !activeEvent) return null;

  const clientLabel = ownerClient
    ? formatFullName(ownerClient.identity) || "(unnamed client)"
    : "(unknown client)";
  const elapsedSec = Math.floor(activeWorkMs(activeEvent) / 1000);
  const elapsedHms = formatHms(elapsedSec);
  const isPaused = !!activeEvent.pausedAtUtc;

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      // Backdrop click → cancel (least destructive; user might've
      // clicked accidentally).
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      data-testid="active-timer-guard-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="active-timer-guard-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col"
      >
        <div className="px-6 py-5 border-b border-slate-100">
          <h2
            id="active-timer-guard-title"
            className="text-base font-semibold text-slate-900"
          >
            An active session is currently running
          </h2>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-slate-600">
            A timer is still recording for:
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1">
            <p className="text-sm font-semibold text-slate-900">{clientLabel}</p>
            <p className="text-xs text-slate-500">{typeLabel(activeEvent.type)}</p>
            <p
              className="text-lg font-mono tabular-nums text-slate-900"
              data-testid="active-timer-guard-elapsed"
            >
              {elapsedHms}
              {isPaused && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-700 align-middle">
                  paused
                </span>
              )}
            </p>
          </div>
          <p className="text-sm text-slate-600">What would you like to do?</p>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex flex-col gap-2">
          <button
            type="button"
            onClick={onEndAndContinue}
            className="w-full text-sm px-4 py-2 rounded-md bg-rose-600 text-white hover:bg-rose-500 font-medium"
            data-testid="active-timer-guard-end"
          >
            End timer and continue
          </button>
          <button
            type="button"
            onClick={onReturnToCurrent}
            className="w-full text-sm px-4 py-2 rounded-md bg-violet-600 text-white hover:bg-violet-500 font-medium"
            data-testid="active-timer-guard-return"
          >
            Return to current client
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full text-sm px-4 py-2 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
            data-testid="active-timer-guard-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
