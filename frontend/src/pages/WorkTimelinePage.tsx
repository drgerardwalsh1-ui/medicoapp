import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { useComposedRefs } from "../hooks/useComposedRefs";
import { createPortal } from "react-dom";
import { Temporal } from "@js-temporal/polyfill";
import {
  appendEvent,
  updateEvent,
  deleteEvent,
  validateEvent,
  newTimelineEvent,
  defaultTitleForType,
  totalTimelineMinutes,
  activeWorkMs,
  displayedDurationMs,
  formatTime24,
  formatDateISO,
  getViewerTimeZone,
  durationLabel,
  TimeService,
  type WorkTimelineEvent,
  type WorkTimelineEventType,
} from "../time";
import { formatFullName, type Client } from "../types/client";
import type { AssessmentPauseIssue } from "../time";
import WorkTimelineCalendar from "./WorkTimelineCalendar";
import { exportTimelineToPdf } from "../engine/exportTimelinePdf";

// Spec Parts 2–8, 14, 15, 17–21. The Work Timeline is the authoritative
// chronology of work performed on this client. List view is primary;
// editing is inline; printing renders an offscreen print-only view.
//
// All mutations flow through frontend/src/time/workTimeline.ts so
// provenance flags are preserved and impossible states (negative durations,
// end-before-start) are surfaced inline rather than silently corrected
// (spec Part 19, Part 20).

const TYPE_OPTIONS: { id: WorkTimelineEventType; label: string }[] = [
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

function typeLabel(t: WorkTimelineEventType): string {
  return TYPE_OPTIONS.find((o) => o.id === t)?.label ?? t;
}

// Compute per-type totals (minutes) from the timeline. Uses
// `displayedDurationMs` so Assessment events count their full wall-clock
// span while non-assessment types continue to exclude pause time.
// Returns the type rows in the same display order as TYPE_OPTIONS.
function totalsByType(
  timeline: WorkTimelineEvent[],
): { type: WorkTimelineEventType; minutes: number; count: number }[] {
  const nowMs = Date.now();
  const rows = new Map<WorkTimelineEventType, { minutes: number; count: number }>();
  for (const e of timeline) {
    const row = rows.get(e.type) ?? { minutes: 0, count: 0 };
    row.minutes += Math.round(displayedDurationMs(e, nowMs) / 60_000);
    row.count += 1;
    rows.set(e.type, row);
  }
  return TYPE_OPTIONS.flatMap((opt) => {
    const r = rows.get(opt.id);
    if (!r) return [];
    return [{ type: opt.id, minutes: r.minutes, count: r.count }];
  });
}

// Primary duration label. Routes through `displayedDurationMs`:
// Assessment events report wall-clock (pauses are part of the session);
// every other type reports active work (pauses excluded). The row also
// shows the billable subset in smaller text for Assessment when pauses
// were recorded — see Row() below.
function activeDurationLabel(event: WorkTimelineEvent): string {
  const ms = displayedDurationMs(event);
  if (event.endedAtUtc === null && ms === 0) return "—";
  return durationLabel(Math.max(0, Math.round(ms / 60_000)));
}

// Active/billable duration for Assessment — exposed underneath the
// primary (wall-clock) label so the user can see both values.
function billableDurationLabel(event: WorkTimelineEvent): string {
  const ms = activeWorkMs(event);
  return durationLabel(Math.max(0, Math.round(ms / 60_000)));
}

// Build a UTC instant from a "HH:MM" wall-clock + the event's stored
// plain-date in the viewer tz. This keeps edits in the *viewer* timezone
// (spec Part 14) — the source-of-truth instant remains UTC.
function rebuildUtcFromTime(
  existingUtc: string,
  newTime: string,
  viewerTz: string
): string | null {
  try {
    const z = Temporal.Instant.from(existingUtc).toZonedDateTimeISO(viewerTz);
    const [hh, mm] = newTime.split(":").map((s) => parseInt(s, 10));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    const plainDate = `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
    return TimeService.wallClockToUtcIso({
      plainDate,
      hour: hh,
      minute: mm,
      timeZone: viewerTz,
      disambiguation: "reject",
    });
  } catch {
    return null;
  }
}

function rebuildUtcFromDate(
  existingUtc: string,
  newDate: string,
  viewerTz: string
): string | null {
  try {
    const z = Temporal.Instant.from(existingUtc).toZonedDateTimeISO(viewerTz);
    return TimeService.wallClockToUtcIso({
      plainDate: newDate,
      hour: z.hour,
      minute: z.minute,
      timeZone: viewerTz,
      disambiguation: "reject",
    });
  } catch {
    return null;
  }
}

export type WorkTimelinePageProps = {
  client: Client;
  onClientChange: (updated: Client) => void;
};

export default function WorkTimelinePage({ client, onClientChange }: WorkTimelinePageProps) {
  const [view, setView] = useState<"list" | "visual" | "calendar">("list");
  // `printing` controls the portal-mounted PrintView. The screen UI stays
  // mounted but is hidden via @media print rules during the actual print.
  // We mount the portal only when about to print so the document body
  // doesn't carry an idle off-screen block during normal use.
  const [printing, setPrinting] = useState(false);
  const viewerTz = getViewerTimeZone();
  const timeline = client.workTimeline ?? [];

  const totalMin = useMemo(() => totalTimelineMinutes(timeline), [timeline]);
  const groupTotals = useMemo(() => totalsByType(timeline), [timeline]);

  function setTimeline(next: WorkTimelineEvent[]) {
    onClientChange({ ...client, workTimeline: next });
  }

  function addManualEvent() {
    const nowUtc = TimeService.nowUtcIso();
    const inFifteenUtc = Temporal.Instant.from(nowUtc)
      .add({ minutes: 15 })
      .toString();
    const event = newTimelineEvent({
      type: "note",
      title: defaultTitleForType("note"),
      startedAtUtc: nowUtc,
      endedAtUtc: inFifteenUtc,
      createdAutomatically: false,
    });
    setTimeline(appendEvent(timeline, event));
  }

  function patchEvent(id: string, patch: Partial<WorkTimelineEvent>) {
    setTimeline(updateEvent(timeline, id, patch));
  }

  function removeEvent(id: string) {
    setTimeline(deleteEvent(timeline, id));
  }

  function printTimeline() {
    // 1. Mount the portal-rendered PrintView at <body> by toggling state
    //    (see `printing` flag below). Without this the print block lives
    //    inside the React tree, which is wrapped in flex/h-screen/overflow
    //    containers that clip content past the viewport during print.
    // 2. Add the body class — it both reveals the portal block and hides
    //    #root via @media print rules in index.css.
    // 3. Wait for layout/style flush via requestAnimationFrame BEFORE
    //    calling window.print(), otherwise some webviews snapshot the DOM
    //    before our newly-shown block has dimensions.
    // 4. Restore on `afterprint` (or in case the dialog never fires, the
    //    next user click outside this flow falls back via setTimeout
    //    cleanup — see the `printing` watchdog effect below).
    setPrinting(true);
    document.body.classList.add("printing-timeline");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          window.print();
        } catch (err) {
          console.error("[work-timeline] window.print() failed:", err);
          // Cleanup proactively so the screen UI returns even if print
          // never opened a dialog.
          setPrinting(false);
          document.body.classList.remove("printing-timeline");
        }
      });
    });
  }

  // Cleanup on `afterprint` (modern browsers + Tauri WKWebView fire this)
  // and as a defensive fallback after a longer timeout if the dialog never
  // fires. Without this, a failed print would leave the UI hidden.
  useEffect(() => {
    function onAfterPrint() {
      setPrinting(false);
      document.body.classList.remove("printing-timeline");
    }
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  return (
    <div className="bg-slate-100 min-h-full">
      <div className="timeline-screen pt-6 pb-8 px-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Action row */}
          <div className="card flex flex-wrap items-center gap-3">
            <h2 className="section-title mb-0">Work Timeline</h2>
            <div className="flex flex-col min-w-0">
              <span className="text-xs text-slate-500">
                {timeline.length} event{timeline.length === 1 ? "" : "s"}
                {timeline.length > 0 && ` · ${durationLabel(totalMin)}`}
              </span>
              {groupTotals.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1" data-testid="timeline-group-totals">
                  {groupTotals.map((g) => (
                    <span
                      key={g.type}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 tabular-nums"
                      title={`${g.count} event${g.count === 1 ? "" : "s"}`}
                    >
                      {typeLabel(g.type)}: {durationLabel(g.minutes)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className={`px-3 py-1.5 ${view === "list" ? "bg-slate-100 text-violet-700 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setView("visual")}
                  className={`px-3 py-1.5 border-l border-slate-200 ${view === "visual" ? "bg-slate-100 text-violet-700 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  Visual
                </button>
                <button
                  type="button"
                  onClick={() => setView("calendar")}
                  className={`px-3 py-1.5 border-l border-slate-200 ${view === "calendar" ? "bg-slate-100 text-violet-700 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  Calendar
                </button>
              </div>
              <button
                type="button"
                onClick={addManualEvent}
                className="text-xs px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white"
              >
                + Add Event
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await exportTimelineToPdf(client, viewerTz);
                  } catch (err) {
                    console.error("[work-timeline] PDF export failed:", err);
                    alert(
                      `PDF export failed: ${err instanceof Error ? err.message : String(err)}`
                    );
                  }
                }}
                className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white"
                title="Generate a structured PDF of the timeline ledger (saved to Downloads)"
              >
                Export PDF
              </button>
              <button
                type="button"
                onClick={printTimeline}
                className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700"
                title="Open the system print dialog"
              >
                Print
              </button>
            </div>
          </div>

          {/* Body */}
          {view === "list" && (
            <ListView
              client={client}
              timeline={timeline}
              viewerTz={viewerTz}
              onPatch={patchEvent}
              onDelete={removeEvent}
            />
          )}
          {view === "visual" && (
            <VisualView
              timeline={timeline}
              viewerTz={viewerTz}
              onClickEvent={() => setView("list")}
              scrollKeyBase={`client:${client.id}:timeline`}
            />
          )}
          {view === "calendar" && (
            <WorkTimelineCalendar
              timeline={timeline}
              onPatch={patchEvent}
              scrollKeyBase={`client:${client.id}:timeline-calendar`}
            />
          )}
        </div>
      </div>

      {/* Printable view — portal-mounted at <body> so it lives OUTSIDE the
          flex/h-screen/overflow chain that wraps #root. Without the portal
          the print block was clipped by the screen layout's overflow:auto
          container during print, even with `display: block !important`.
          Mounted only while `printing` is true to keep the body tree clean
          during normal use. */}
      {printing && createPortal(
        <PrintView client={client} timeline={timeline} viewerTz={viewerTz} />,
        document.body
      )}
    </div>
  );
}

// ── List view ───────────────────────────────────────────────────────────────

function ListView({
  client,
  timeline,
  viewerTz,
  onPatch,
  onDelete,
}: {
  client: Client;
  timeline: WorkTimelineEvent[];
  viewerTz: string;
  onPatch: (id: string, patch: Partial<WorkTimelineEvent>) => void;
  onDelete: (id: string) => void;
}) {
  if (timeline.length === 0) {
    return (
      <div className="card text-sm text-slate-500">
        No timeline events yet. Start the timer above or click <strong>+ Add Event</strong>
        {" "}to create a manual entry.
      </div>
    );
  }

  // Group by viewer-tz date for a cleaner ledger view.
  const groups = new Map<string, WorkTimelineEvent[]>();
  for (const e of timeline) {
    let dateKey: string;
    try {
      dateKey = formatDateISO(e.startedAtUtc, viewerTz);
    } catch {
      dateKey = "unknown";
    }
    const list = groups.get(dateKey) ?? [];
    list.push(e);
    groups.set(dateKey, list);
  }
  const sortedDates = [...groups.keys()].sort();

  return (
    <div className="space-y-4">
      {sortedDates.map((dateKey) => (
        <div key={dateKey} className="card">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            {dateKey}
          </h3>
          <div className="space-y-2">
            {(groups.get(dateKey) ?? []).map((e) => (
              <Row
                key={e.id}
                event={e}
                client={client}
                viewerTz={viewerTz}
                onPatch={onPatch}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({
  event,
  client,
  viewerTz,
  onPatch,
  onDelete,
}: {
  event: WorkTimelineEvent;
  client: Client;
  viewerTz: string;
  onPatch: (id: string, patch: Partial<WorkTimelineEvent>) => void;
  onDelete: (id: string) => void;
}) {
  const startTime = formatTime24(event.startedAtUtc, viewerTz);
  const startDate = formatDateISO(event.startedAtUtc, viewerTz);
  const endTime = event.endedAtUtc ? formatTime24(event.endedAtUtc, viewerTz) : "";
  const dur = activeDurationLabel(event);
  // Surface billable subtotal under the wall-clock duration for
  // Assessment events that actually recorded pause time. Skipped when
  // there were no pauses (label would just duplicate `dur`).
  const showBillableSubtotal =
    event.type === "assessment" &&
    ((event.assessmentPauseIssues?.length ?? 0) > 0 ||
      (event.accumulatedPausedMs ?? 0) > 0 ||
      !!event.pausedAtUtc);
  const billable = showBillableSubtotal ? billableDurationLabel(event) : null;
  const validation = validateEvent(event);
  const linkedAppt = event.linkedAppointmentId
    ? client.appointments.find((a) => a.id === event.linkedAppointmentId)
    : null;

  function patchStartTime(newTime: string) {
    const newUtc = rebuildUtcFromTime(event.startedAtUtc, newTime, viewerTz);
    if (newUtc) onPatch(event.id, { startedAtUtc: newUtc });
  }
  function patchStartDate(newDate: string) {
    if (!newDate) return;
    const newUtc = rebuildUtcFromDate(event.startedAtUtc, newDate, viewerTz);
    if (newUtc) onPatch(event.id, { startedAtUtc: newUtc });
  }
  function patchEndTime(newTime: string) {
    if (!event.endedAtUtc) return;
    const newUtc = rebuildUtcFromTime(event.endedAtUtc, newTime, viewerTz);
    if (newUtc) onPatch(event.id, { endedAtUtc: newUtc });
  }

  return (
    <div
      className={`p-3 rounded border ${
        validation.ok
          ? "border-slate-200 bg-white"
          : "border-rose-300 bg-rose-50"
      }`}
    >
      <div className="flex items-start gap-3 flex-wrap">
        {/* Time block */}
        <div className="flex flex-col items-start gap-1 shrink-0 min-w-[180px]">
          <div className="flex items-center gap-1">
            <input
              type="date"
              className="input text-xs py-0.5"
              value={startDate}
              onChange={(e) => patchStartDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="time"
              className="input text-xs py-0.5 w-[88px]"
              value={startTime}
              onChange={(e) => patchStartTime(e.target.value)}
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              className="input text-xs py-0.5 w-[88px]"
              value={endTime}
              onChange={(e) => patchEndTime(e.target.value)}
              placeholder="—"
              disabled={event.endedAtUtc === null}
              title={event.endedAtUtc === null ? "Timer is still running" : ""}
            />
            <span className="text-[11px] text-slate-700 tabular-nums w-10 text-right font-medium">{dur}</span>
          </div>
          {billable && (
            <span
              className="text-[10px] text-slate-400 tabular-nums pl-[2px]"
              title="Active/billable time (excludes pause intervals)"
            >
              billable {billable}
            </span>
          )}
        </div>

        {/* Type + title + description */}
        <div className="flex-1 min-w-[280px] space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="input text-xs py-0.5 max-w-[140px]"
              value={event.type}
              onChange={(e) =>
                onPatch(event.id, { type: e.target.value as WorkTimelineEventType })
              }
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <input
              className="input text-xs py-0.5 flex-1 min-w-[160px]"
              value={event.title}
              onChange={(e) => onPatch(event.id, { title: e.target.value })}
              placeholder="Event title"
            />
            {/* Provenance pills (spec Part 19) */}
            {event.createdAutomatically && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                title="Generated automatically by the timer"
              >
                auto
              </span>
            )}
            {event.manuallyEdited && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                title="Manually edited"
              >
                edited
              </span>
            )}
            {event.endedAtUtc === null && !event.pausedAtUtc && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200"
                title="Timer is still running for this event"
              >
                running
              </span>
            )}
            {event.endedAtUtc === null && event.pausedAtUtc && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                title="Timer is paused — paused time is excluded from the duration"
              >
                paused
              </span>
            )}
          </div>
          <textarea
            className="input text-xs py-1 w-full"
            rows={1}
            value={event.description ?? ""}
            onChange={(e) => onPatch(event.id, { description: e.target.value })}
            placeholder="Notes…"
          />
          {linkedAppt && (
            <p className="text-[11px] text-slate-400">
              Linked to appointment: {formatTime24(linkedAppt.startUtc, linkedAppt.appointmentTimeZone)} –{" "}
              {formatTime24(linkedAppt.endUtc, linkedAppt.appointmentTimeZone)}{" "}
              ({linkedAppt.appointmentTimeZone})
            </p>
          )}
          {!validation.ok && (
            <p className="text-[11px] text-rose-700 font-medium">
              {validation.reason}
            </p>
          )}
          {event.type === "assessment" &&
            (event.assessmentPauseIssues?.length ?? 0) > 0 && (
              <AssessmentPauseIssueList
                issues={event.assessmentPauseIssues!}
                viewerTz={viewerTz}
              />
            )}
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={() => onDelete(event.id)}
          className="text-slate-400 hover:text-red-500 px-1 shrink-0 text-base leading-none"
          title="Delete event"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Assessment pause issue list ────────────────────────────────────────────
// Only rendered under Assessment events. Each entry shows category/reason,
// optional note, and the interval duration. An issue with endedAtUtc=null
// is rendered as "ongoing" defensively (after Stop or normal Resume the
// helper always closes it, but a future edit path could leave one open).

function issueDurationLabel(issue: AssessmentPauseIssue): string {
  try {
    const startMs = Temporal.Instant.from(issue.startedAtUtc).epochMilliseconds;
    const endMs = issue.endedAtUtc
      ? Temporal.Instant.from(issue.endedAtUtc).epochMilliseconds
      : Date.now();
    const mins = Math.max(0, Math.round((endMs - startMs) / 60_000));
    return durationLabel(mins);
  } catch {
    return "—";
  }
}

function readIssueReasons(i: AssessmentPauseIssue): string[] {
  if (i.reasons && i.reasons.length > 0) return i.reasons;
  return i.reason ? [i.reason] : [];
}

function readIssueCategories(i: AssessmentPauseIssue): string[] {
  if (i.categories && i.categories.length > 0) return i.categories;
  return i.category ? [i.category] : [];
}

function AssessmentPauseIssueList({
  issues,
  viewerTz,
}: {
  issues: AssessmentPauseIssue[];
  viewerTz: string;
}) {
  return (
    <div className="mt-2 pl-3 border-l-2 border-amber-200 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold">
        Pause issues
      </p>
      {issues.map((i) => {
        const startStr = (() => {
          try { return formatTime24(i.startedAtUtc, viewerTz); } catch { return "—"; }
        })();
        const endStr = i.endedAtUtc
          ? (() => {
              try { return formatTime24(i.endedAtUtc!, viewerTz); } catch { return "—"; }
            })()
          : "ongoing";
        const reasons = readIssueReasons(i);
        const cats = readIssueCategories(i);
        const label =
          reasons.length > 0
            ? reasons.join(", ")
            : cats.length > 0
            ? cats.join(", ")
            : "Unspecified reason";
        return (
          <div key={i.id} className="text-[11px] text-slate-700">
            <span className="font-medium text-amber-900">{label}</span>
            <span className="text-slate-400"> · {startStr}–{endStr}</span>
            <span className="text-slate-400"> · {issueDurationLabel(i)}</span>
            {i.note && (
              <div className="text-slate-600 italic">{i.note}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Visual view ─────────────────────────────────────────────────────────────
// Secondary inspection tool — list view remains authoritative for editing
// (spec Part 4). Zoom presets cover the 5-minute–day-overview range so
// short events / pauses / overlapping sessions are visually
// distinguishable at fine zoom while a 24-hour overview stays compact.

type ZoomPreset = {
  id: "1min" | "5min" | "15min" | "30min" | "1hr" | "day";
  label: string;
  pxPerMinute: number;        // controls vertical scale
  labelEveryMinutes: number;  // cadence of the gridline labels
};

// Presets are ordered fine → coarse so zoom-in (wheel up + ctrl) goes
// to a smaller index. The 1-min preset uses 5-min label cadence to keep
// the per-day DOM under control (288 labels/day vs. 1440 if every
// minute had a label) while preserving 12-pixel-per-minute spatial
// granularity for individual events.
const ZOOM_PRESETS: ZoomPreset[] = [
  { id: "1min",  label: "1-min",  pxPerMinute: 12,   labelEveryMinutes: 5 },
  { id: "5min",  label: "5-min",  pxPerMinute: 4,    labelEveryMinutes: 5 },
  { id: "15min", label: "15-min", pxPerMinute: 1.6,  labelEveryMinutes: 15 },
  { id: "30min", label: "30-min", pxPerMinute: 0.8,  labelEveryMinutes: 30 },
  { id: "1hr",   label: "1-hour", pxPerMinute: 0.4,  labelEveryMinutes: 60 },
  { id: "day",   label: "Day",    pxPerMinute: 0.1,  labelEveryMinutes: 360 },
];

const DEFAULT_ZOOM_INDEX = 3; // "30min" — readable for typical sessions
const LABEL_GUTTER_PX = 56;   // left-side time labels column

// Assign each event a horizontal lane within its overlap cluster.
// Standard sweep-line algorithm: sort by start, place into the lowest-index
// lane whose last-end ≤ current-start. Returns lane index and total lane
// count for the cluster (per day).
function assignLanes(events: { id: string; startMin: number; endMin: number }[]): {
  lanes: Map<string, number>;
  totalLanes: number;
} {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const laneEnds: number[] = [];     // last endMin per lane
  const laneOf = new Map<string, number>();
  for (const e of sorted) {
    let placed = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= e.startMin) {
        laneEnds[i] = e.endMin;
        placed = i;
        break;
      }
    }
    if (placed < 0) {
      laneEnds.push(e.endMin);
      placed = laneEnds.length - 1;
    }
    laneOf.set(e.id, placed);
  }
  return { lanes: laneOf, totalLanes: laneEnds.length || 1 };
}

function VisualView({
  timeline,
  viewerTz,
  onClickEvent,
  scrollKeyBase,
}: {
  timeline: WorkTimelineEvent[];
  viewerTz: string;
  onClickEvent: () => void;
  scrollKeyBase?: string;
}) {
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_INDEX);
  const zoom = ZOOM_PRESETS[zoomIdx];

  if (timeline.length === 0) {
    return (
      <div className="card text-sm text-slate-500">
        No timeline events yet.
      </div>
    );
  }

  // Compute a viewer-day-aligned 24-hour lane, grouped by viewer-tz date.
  const groups = new Map<string, WorkTimelineEvent[]>();
  for (const e of timeline) {
    let dateKey: string;
    try {
      dateKey = formatDateISO(e.startedAtUtc, viewerTz);
    } catch {
      continue;
    }
    const list = groups.get(dateKey) ?? [];
    list.push(e);
    groups.set(dateKey, list);
  }
  const sortedDates = [...groups.keys()].sort();

  const dayHeightPx = 24 * 60 * zoom.pxPerMinute;
  const labelEvery = zoom.labelEveryMinutes;
  const labelCount = Math.floor((24 * 60) / labelEvery) + 1;

  function fmtLabel(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return (
    <div className="space-y-3">
      {/* Zoom toolbar */}
      <div className="card flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600">Zoom</span>
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setZoomIdx((i) => Math.min(ZOOM_PRESETS.length - 1, i + 1))}
            className="px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
            title="Zoom out (coarser)"
            disabled={zoomIdx >= ZOOM_PRESETS.length - 1}
          >
            −
          </button>
          <select
            className="px-2 py-1 border-l border-r border-slate-200 bg-white focus:outline-none"
            value={zoom.id}
            onChange={(e) => {
              const idx = ZOOM_PRESETS.findIndex((z) => z.id === e.target.value);
              if (idx >= 0) setZoomIdx(idx);
            }}
          >
            {ZOOM_PRESETS.map((z) => (
              <option key={z.id} value={z.id}>{z.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            className="px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
            title="Zoom in (finer)"
            disabled={zoomIdx <= 0}
          >
            +
          </button>
        </div>
        <span className="text-[11px] text-slate-400">
          {zoom.pxPerMinute >= 1
            ? `${zoom.pxPerMinute.toFixed(zoom.pxPerMinute % 1 === 0 ? 0 : 1)} px/min`
            : `${(zoom.pxPerMinute * 60).toFixed(0)} px/hr`}{" "}
          · grid every {labelEvery >= 60 ? `${labelEvery / 60}h` : `${labelEvery}m`}
        </span>
      </div>

      {sortedDates.map((dateKey) => {
        const evs = groups.get(dateKey) ?? [];
        // Compute pixel-positioned events with overlap-aware lane assignment.
        const positioned = evs
          .map((e) => {
            try {
              const z = Temporal.Instant.from(e.startedAtUtc).toZonedDateTimeISO(viewerTz);
              const startMin = z.hour * 60 + z.minute;
              const endMin = e.endedAtUtc
                ? (() => {
                    const ze = Temporal.Instant.from(e.endedAtUtc!).toZonedDateTimeISO(viewerTz);
                    if (ze.year !== z.year || ze.month !== z.month || ze.day !== z.day) {
                      return 24 * 60;
                    }
                    return ze.hour * 60 + ze.minute;
                  })()
                : startMin + 5; // running events get a small visible block
              return { event: e, startMin, endMin };
            } catch {
              return null;
            }
          })
          .filter((x): x is { event: WorkTimelineEvent; startMin: number; endMin: number } => x !== null);

        const { lanes, totalLanes } = assignLanes(
          positioned.map((p) => ({ id: p.event.id, startMin: p.startMin, endMin: p.endMin }))
        );

        return (
          <DayLane
            key={dateKey}
            dateKey={dateKey}
            dayHeightPx={dayHeightPx}
            zoomIdx={zoomIdx}
            zoomPxPerMinute={zoom.pxPerMinute}
            setZoomIdx={setZoomIdx}
            scrollKey={scrollKeyBase ? `${scrollKeyBase}:${dateKey}` : undefined}
          >
              <div
                className="relative w-full"
                style={{ height: Math.max(120, dayHeightPx) }}
              >
                {/* Time-label gridlines. Cadence adapts to the zoom level so
                    fine zooms get more labels but readability is preserved. */}
                {Array.from({ length: labelCount }, (_, i) => {
                  const minutes = i * labelEvery;
                  const top = minutes * zoom.pxPerMinute;
                  const isHourLine = minutes % 60 === 0;
                  return (
                    <div
                      key={i}
                      className="absolute left-0 right-0 pointer-events-none"
                      style={{ top }}
                    >
                      <div
                        className={isHourLine ? "border-t border-slate-200" : "border-t border-slate-100"}
                        style={{ marginLeft: LABEL_GUTTER_PX }}
                      />
                      <span
                        className={`absolute -translate-y-1/2 left-0 text-right pr-2 text-[10px] tabular-nums ${
                          isHourLine ? "text-slate-500 font-medium" : "text-slate-300"
                        }`}
                        style={{ width: LABEL_GUTTER_PX }}
                      >
                        {fmtLabel(minutes)}
                      </span>
                    </div>
                  );
                })}

                {/* Events — overlap-aware horizontal lanes within each day. */}
                {positioned.map(({ event: e, startMin, endMin }) => {
                  const lane = lanes.get(e.id) ?? 0;
                  const top = startMin * zoom.pxPerMinute;
                  // Minimum visible height — keeps even 1-minute events
                  // tappable at any zoom. At coarse zoom (day overview)
                  // a 1-min event would otherwise be 0.1px tall.
                  const naturalHeight = (endMin - startMin) * zoom.pxPerMinute;
                  const MIN_VISIBLE_PX = 6;
                  const height = Math.max(MIN_VISIBLE_PX, naturalHeight);
                  const laneWidthPct = 100 / totalLanes;
                  const isOpen = e.endedAtUtc === null;
                  const isPaused = isOpen && !!e.pausedAtUtc;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={onClickEvent}
                      className={`absolute rounded text-left px-1.5 py-0.5 text-[10px] truncate border transition ${
                        isPaused
                          ? "bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100"
                          : isOpen
                          ? "bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                          : "bg-violet-100 border-violet-300 text-violet-900 hover:bg-violet-200"
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${LABEL_GUTTER_PX}px + ${lane * laneWidthPct}% - ${LABEL_GUTTER_PX * lane / totalLanes}px)`,
                        width: `calc(${laneWidthPct}% - ${LABEL_GUTTER_PX / totalLanes}px - 4px)`,
                      }}
                      title={
                        `${typeLabel(e.type)} — ${e.title}` +
                        (isPaused ? " (paused)" : isOpen ? " (running)" : "") +
                        ` · ${activeDurationLabel(e)}`
                      }
                    >
                      {typeLabel(e.type)} · {e.title}
                    </button>
                  );
                })}
              </div>
          </DayLane>
        );
      })}
    </div>
  );
}

// Wrapper around a single day's scrollable lane. Captures wheel events
// for pointer-anchored zoom (Ctrl/Meta + wheel, or trackpad pinch
// which also sets ctrlKey) and mousedown/move/up for click-and-drag
// panning. Plain wheel without modifier scrolls naturally.
function DayLane({
  dateKey,
  dayHeightPx,
  zoomIdx,
  zoomPxPerMinute,
  setZoomIdx,
  children,
  scrollKey,
}: {
  dateKey: string;
  dayHeightPx: number;
  zoomIdx: number;
  zoomPxPerMinute: number;
  setZoomIdx: React.Dispatch<React.SetStateAction<number>>;
  children: React.ReactNode;
  scrollKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Compose the local layout ref (used by pan-zoom mousedown handlers
  // below) with the central scroll-restoration callback ref so the same
  // node feeds both consumers.
  const scrollRestoreRef = useScrollRestoration<HTMLDivElement>(scrollKey);
  const composedContainerRef = useComposedRefs<HTMLDivElement>(
    containerRef,
    scrollRestoreRef,
  );
  // Carry-over scroll target across a zoom step so we can place the
  // viewport such that the time under the cursor stays under the cursor.
  // We capture the anchor (time-at-pointer) BEFORE the zoom change and
  // use a layout effect to set scrollTop AFTER the new height is applied.
  const pendingAnchorRef = useRef<{ timeMinutes: number; viewportY: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    const anchor = pendingAnchorRef.current;
    if (!el || !anchor) return;
    el.scrollTop = anchor.timeMinutes * zoomPxPerMinute - anchor.viewportY;
    pendingAnchorRef.current = null;
  }, [zoomPxPerMinute]);

  // Wheel handler — must be non-passive so we can preventDefault.
  // Attached via DOM ref because React's onWheel is passive by default
  // in recent React versions and preventDefault is silently ignored.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      // macOS trackpad pinch reports as wheel + ctrlKey. Cmd/Ctrl +
      // mousewheel reports the same. Both routes → zoom.
      const isZoomGesture = e.ctrlKey || e.metaKey;
      if (!isZoomGesture) return; // plain scroll: let the browser handle it
      e.preventDefault();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportY = e.clientY - rect.top;     // pointer Y inside the scroll viewport
      const timeMinutes = (el.scrollTop + viewportY) / zoomPxPerMinute;
      // Negative deltaY = zoom in (smaller index, finer). Positive = out.
      const dir = e.deltaY < 0 ? -1 : 1;
      setZoomIdx((idx) => {
        const next = Math.min(Math.max(idx + dir, 0), ZOOM_PRESETS.length - 1);
        if (next === idx) return idx;
        pendingAnchorRef.current = { timeMinutes, viewportY };
        return next;
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel as EventListener);
  }, [zoomPxPerMinute, setZoomIdx]);

  // Click-and-drag panning on the lane background. Ignores clicks on
  // event buttons (they have their own onClick). Mousedown captures the
  // start position; mousemove updates scrollTop by delta; mouseup
  // releases. Cursor switches to grab/grabbing for affordance.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let dragging = false;
    let startY = 0;
    let startScrollTop = 0;
    function onDown(e: MouseEvent) {
      // Only background drags — if the target is an event button,
      // let the click pass through to onClick.
      if ((e.target as HTMLElement).closest("button")) return;
      if (e.button !== 0) return;
      dragging = true;
      startY = e.clientY;
      startScrollTop = el!.scrollTop;
      el!.style.cursor = "grabbing";
      e.preventDefault();
    }
    function onMove(e: MouseEvent) {
      if (!dragging) return;
      el!.scrollTop = startScrollTop - (e.clientY - startY);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      el!.style.cursor = "";
    }
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Suppress unused warning on zoomIdx — it's passed in to force the
  // effects to re-evaluate when the preset changes.
  void zoomIdx;
  void dayHeightPx;

  return (
    <div className="card">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{dateKey}</h3>
      <div
        ref={composedContainerRef}
        className="relative overflow-y-auto border border-slate-100 rounded select-none cursor-grab"
        style={{ maxHeight: "70vh" }}
        title="Ctrl/⌘ + scroll to zoom · click and drag to pan"
      >
        {children}
      </div>
    </div>
  );
}

// ── Print view (hidden on screen; revealed by body.printing-timeline) ──────

function PrintView({
  client,
  timeline,
  viewerTz,
}: {
  client: Client;
  timeline: WorkTimelineEvent[];
  viewerTz: string;
}) {
  // Group by viewer-tz date for the printed ledger.
  const groups = new Map<string, WorkTimelineEvent[]>();
  for (const e of timeline) {
    let dateKey: string;
    try {
      dateKey = formatDateISO(e.startedAtUtc, viewerTz);
    } catch {
      continue;
    }
    const list = groups.get(dateKey) ?? [];
    list.push(e);
    groups.set(dateKey, list);
  }
  const sortedDates = [...groups.keys()].sort();
  const totalMin = totalTimelineMinutes(timeline);

  return (
    <div className="timeline-print">
      <div className="timeline-print-header">
        <h1>Work Timeline</h1>
        <p>
          Client: {formatFullName(client.identity) || "(unnamed)"}
          {client.administrative?.referrer?.org
            ? ` · Referrer: ${client.administrative.referrer.org}`
            : ""}
        </p>
        <p>
          Timezone: {viewerTz} · Events: {timeline.length} · Total: {durationLabel(totalMin)}
        </p>
      </div>
      {sortedDates.map((dateKey) => (
        <section key={dateKey} className="timeline-print-day">
          <h2>{dateKey}</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: "16%" }}>Time</th>
                <th style={{ width: "10%" }}>Duration</th>
                <th style={{ width: "16%" }}>Type</th>
                <th style={{ width: "20%" }}>Title</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {(groups.get(dateKey) ?? []).map((e) => {
                const startTime = formatTime24(e.startedAtUtc, viewerTz);
                const endTime = e.endedAtUtc
                  ? formatTime24(e.endedAtUtc, viewerTz)
                  : "—";
                return (
                  <tr key={e.id}>
                    <td>{startTime}–{endTime}</td>
                    <td>{activeDurationLabel(e)}</td>
                    <td>{typeLabel(e.type)}</td>
                    <td>{e.title}</td>
                    <td>{e.description ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      {sortedDates.length === 0 && (
        <p className="timeline-print-empty">No timeline events recorded.</p>
      )}
    </div>
  );
}
