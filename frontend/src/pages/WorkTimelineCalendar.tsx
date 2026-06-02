import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HOUR_HEIGHT,
  HOURS,
  TIME_LABEL_WIDTH,
  TOTAL_GRID_HEIGHT,
  START_HOUR,
  appointmentTopPx,
  appointmentHeightPx,
  getWeekStart,
  getWeekDates,
  addDays,
  isSameDay,
  isInstantOnDay,
  pixelsToDateTime,
  formatTime,
  formatMonthYear,
  formatDateRange,
} from "../calendar/calendarUtils";
import {
  nowMinutesSinceStartHour,
  durationMs,
  addMinutesToInstant,
  compareInstants,
  type WorkTimelineEvent,
  type WorkTimelineEventType,
} from "../time";

// Work Timeline Calendar view. Visually parallel to the main appointment
// calendar (CalendarGrid) but operates on WorkTimelineEvent records, not
// appointments. The two are intentionally NOT merged — they display
// different data and mutate different parts of the client model. Shared
// behaviour lives in calendarUtils (grid math) and `pixelsToDateTime` /
// `appointmentTopPx` / `appointmentHeightPx`, which are appointment-naive.
//
// Open events (`endedAtUtc === null`, i.e. a running or paused timer) are
// rendered as a thin pill at their start time and are NOT draggable or
// resizable — we never want a calendar interaction to silently close a
// running timer by writing an endedAtUtc into it. They become editable
// once stopped.

// Per-type colour palette. Distinct from appointment status colours so
// the two calendars are visually separable at a glance.
const TYPE_STYLE: Record<WorkTimelineEventType, { bg: string; border: string; text: string }> = {
  prereading:     { bg: "bg-sky-200",       border: "border-sky-400",      text: "text-sky-900" },
  assessment:     { bg: "bg-violet-200",    border: "border-violet-400",   text: "text-violet-900" },
  reportWriting:  { bg: "bg-emerald-200",   border: "border-emerald-400",  text: "text-emerald-900" },
  admin:          { bg: "bg-slate-200",     border: "border-slate-400",    text: "text-slate-800" },
  travel:         { bg: "bg-amber-200",     border: "border-amber-400",    text: "text-amber-900" },
  break:          { bg: "bg-lime-200",      border: "border-lime-400",     text: "text-lime-900" },
  interruption:   { bg: "bg-rose-200",      border: "border-rose-400",     text: "text-rose-900" },
  technicalDelay: { bg: "bg-orange-200",    border: "border-orange-400",   text: "text-orange-900" },
  note:           { bg: "bg-indigo-200",    border: "border-indigo-400",   text: "text-indigo-900" },
  custom:         { bg: "bg-fuchsia-200",   border: "border-fuchsia-400",  text: "text-fuchsia-900" },
};

type Interaction = {
  type: "drag" | "resize";
  event: WorkTimelineEvent;
  pointerId: number;
  offsetY: number;
  previewStart: string;
  previewEnd: string;
  previewDayIndex: number;
};

interface Props {
  timeline: WorkTimelineEvent[];
  onPatch: (id: string, patch: Partial<WorkTimelineEvent>) => void;
  scrollKeyBase?: string;
}

export default function WorkTimelineCalendar({ timeline, onPatch }: Props) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const columnsRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  // Time-windowed suppression: a synthetic click follows pointer capture
  // release. We don't currently have a click-to-open handler on blocks,
  // but column-click could otherwise mistakenly fire if we add one later;
  // mirroring the appointment-calendar pattern keeps the behaviour
  // consistent if click handlers are added.
  const didInteractAtMsRef = useRef<number>(0);

  // Pending: pointer down on a block body, not yet dragging
  const pendingRef = useRef<{
    event: WorkTimelineEvent;
    pointerId: number;
    startX: number;
    startY: number;
    offsetY: number;
  } | null>(null);

  // Bucket closed events by viewer-tz day for the current week.
  const eventsByDay = useMemo(() => {
    const byDay: Record<number, WorkTimelineEvent[]> = {};
    for (let i = 0; i < weekDates.length; i++) byDay[i] = [];
    for (const e of timeline) {
      // Only events with both ends (closed) are placed on the grid;
      // running/paused events get a non-draggable badge instead.
      if (e.endedAtUtc === null) continue;
      const idx = weekDates.findIndex((d) => isInstantOnDay(e.startedAtUtc, d));
      if (idx >= 0) byDay[idx].push(e);
    }
    return byDay;
  }, [timeline, weekDates]);

  // Open events for the current week (rendered as start-time pills).
  const openEventsByDay = useMemo(() => {
    const byDay: Record<number, WorkTimelineEvent[]> = {};
    for (let i = 0; i < weekDates.length; i++) byDay[i] = [];
    for (const e of timeline) {
      if (e.endedAtUtc !== null) continue;
      const idx = weekDates.findIndex((d) => isInstantOnDay(e.startedAtUtc, d));
      if (idx >= 0) byDay[idx].push(e);
    }
    return byDay;
  }, [timeline, weekDates]);

  const currentTimeTopPx = useMemo(() => {
    const mins = nowMinutesSinceStartHour();
    return Math.max(0, Math.min((mins / 60) * HOUR_HEIGHT, TOTAL_GRID_HEIGHT));
  }, []);

  const todayIndex = useMemo(
    () => weekDates.findIndex((d) => isSameDay(d, new Date())),
    [weekDates]
  );

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = Math.max(0, currentTimeTopPx - 80);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getGridY(clientY: number): number {
    if (!columnsRef.current) return 0;
    return clientY - columnsRef.current.getBoundingClientRect().top;
  }

  function getDayIndex(clientX: number): number {
    if (!columnsRef.current) return 0;
    const rect = columnsRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const colWidth = rect.width / weekDates.length;
    return Math.max(0, Math.min(weekDates.length - 1, Math.floor(x / colWidth)));
  }

  const handleBlockPointerDown = useCallback(
    (e: React.PointerEvent, event: WorkTimelineEvent) => {
      if (e.button !== 0) return;
      if (event.endedAtUtc === null) return; // open events not draggable
      e.stopPropagation();
      const gridY = getGridY(e.clientY);
      const top = appointmentTopPx(event.startedAtUtc);
      pendingRef.current = {
        event,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offsetY: gridY - top,
      };
    },
    []
  );

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, event: WorkTimelineEvent) => {
      if (event.endedAtUtc === null) return; // open events not resizable
      e.stopPropagation();
      e.preventDefault();
      columnsRef.current?.setPointerCapture(e.pointerId);
      setInteraction({
        type: "resize",
        event,
        pointerId: e.pointerId,
        offsetY: 0,
        previewStart: event.startedAtUtc,
        previewEnd: event.endedAtUtc,
        previewDayIndex: weekDates.findIndex((d) =>
          isInstantOnDay(event.startedAtUtc, d)
        ),
      });
    },
    [weekDates]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && !interaction) {
        const dx = Math.abs(e.clientX - pending.startX);
        const dy = Math.abs(e.clientY - pending.startY);
        if (dx > 4 || dy > 4) {
          columnsRef.current?.setPointerCapture(pending.pointerId);
          const dayIdx = getDayIndex(e.clientX);
          const gridY = getGridY(e.clientY);
          const rawY = gridY - pending.offsetY;
          const newStart = pixelsToDateTime(Math.max(0, rawY), weekDates[dayIdx]);
          const duration = durationMs(
            pending.event.startedAtUtc,
            pending.event.endedAtUtc!
          );
          const newEnd = new Date(newStart.getTime() + duration);
          setInteraction({
            type: "drag",
            event: pending.event,
            pointerId: pending.pointerId,
            offsetY: pending.offsetY,
            previewStart: newStart.toISOString(),
            previewEnd: newEnd.toISOString(),
            previewDayIndex: dayIdx,
          });
          pendingRef.current = null;
        }
        return;
      }

      if (!interaction) return;

      if (interaction.type === "drag") {
        const dayIdx = getDayIndex(e.clientX);
        const gridY = getGridY(e.clientY);
        const rawY = gridY - interaction.offsetY;
        const newStart = pixelsToDateTime(Math.max(0, rawY), weekDates[dayIdx]);
        const duration = durationMs(
          interaction.event.startedAtUtc,
          interaction.event.endedAtUtc!
        );
        const newEnd = new Date(newStart.getTime() + duration);
        setInteraction((prev) =>
          prev
            ? {
                ...prev,
                previewStart: newStart.toISOString(),
                previewEnd: newEnd.toISOString(),
                previewDayIndex: dayIdx,
              }
            : null
        );
      }

      if (interaction.type === "resize") {
        const apptDay =
          weekDates.find((d) => isInstantOnDay(interaction.event.startedAtUtc, d)) ??
          weekDates[0];
        const gridY = getGridY(e.clientY);
        const newEnd = pixelsToDateTime(Math.max(0, gridY), apptDay);
        // Minimum duration 1 minute (existing event validation rejects
        // zero-length spans; pick something tiny but non-zero so the user
        // can shrink right up to the limit without snapping back).
        const minEndIso = addMinutesToInstant(interaction.event.startedAtUtc, 1);
        if (compareInstants(newEnd.toISOString(), minEndIso) > 0) {
          setInteraction((prev) =>
            prev ? { ...prev, previewEnd: newEnd.toISOString() } : null
          );
        }
      }
    },
    [interaction, weekDates]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      pendingRef.current = null;
      if (!interaction) return;
      columnsRef.current?.releasePointerCapture(e.pointerId);
      didInteractAtMsRef.current = Date.now();
      // Patch — validateEvent on the timeline side prevents impossible
      // states. The helper marks the event manuallyEdited (provenance).
      onPatch(interaction.event.id, {
        startedAtUtc: interaction.previewStart,
        endedAtUtc: interaction.previewEnd,
      });
      setInteraction(null);
    },
    [interaction, onPatch]
  );

  const handlePointerCancel = useCallback(() => {
    pendingRef.current = null;
    setInteraction(null);
  }, []);

  const isDragging = interaction?.type === "drag";
  const draggingId = isDragging ? interaction!.event.id : null;
  const previewDayIndex = isDragging ? interaction!.previewDayIndex : -1;
  const previewStart = isDragging ? interaction!.previewStart : null;
  const previewEnd = isDragging ? interaction!.previewEnd : null;

  function prevWeek() { setWeekStart(addDays(weekStart, -7)); }
  function nextWeek() { setWeekStart(addDays(weekStart, 7)); }
  function goToToday() { setWeekStart(getWeekStart(new Date())); }

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const isCurrentWeek = useMemo(
    () => weekDates.some((d) => isSameDay(d, new Date())),
    [weekDates]
  );

  return (
    <div className="flex flex-col h-[70vh] bg-white border border-slate-200 rounded">
      {/* Header bar — week nav */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-200 shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevWeek}
            className="p-1 rounded text-slate-500 hover:bg-slate-100"
            title="Previous week"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={nextWeek}
            className="p-1 rounded text-slate-500 hover:bg-slate-100"
            title="Next week"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-slate-900">
            {formatDateRange(weekStart, weekEnd)}
          </span>
          <span className="text-[11px] text-slate-400">
            {formatMonthYear(weekStart)}
          </span>
        </div>
        {!isCurrentWeek && (
          <button
            type="button"
            onClick={goToToday}
            className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Today
          </button>
        )}
        <span className="ml-auto text-[10px] text-slate-400">
          Drag a block to move · drag bottom edge to resize · open events not editable
        </span>
      </div>

      {/* Day-header row */}
      <div className="flex border-b border-slate-200 bg-white shrink-0">
        <div style={{ width: TIME_LABEL_WIDTH }} className="shrink-0" />
        {weekDates.map((d, i) => {
          const isToday = i === todayIndex;
          return (
            <div
              key={i}
              className={`flex-1 py-1.5 text-center border-l border-slate-200 ${isToday ? "bg-blue-50/60" : ""}`}
            >
              <div className={`text-[10px] font-medium uppercase tracking-wider ${isToday ? "text-blue-500" : "text-slate-400"}`}>
                {d.toLocaleDateString([], { weekday: "short" })}
              </div>
              <div className={`text-base font-semibold mx-auto mt-0.5 w-7 h-7 flex items-center justify-center rounded-full ${isToday ? "bg-blue-600 text-white" : "text-slate-700"}`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable body */}
      <div
        ref={scrollContainerRef}
        className="flex flex-1 overflow-y-auto"
        style={{ minHeight: 0 }}
      >
        <div
          className="shrink-0 relative bg-white"
          style={{ width: TIME_LABEL_WIDTH, height: TOTAL_GRID_HEIGHT }}
        >
          {HOURS.map((h) => (
            <div
              key={h}
              style={{
                position: "absolute",
                top: (h - START_HOUR) * HOUR_HEIGHT - 8,
                right: 6,
              }}
            >
              <span className="text-[10px] text-slate-400 leading-none tabular-nums">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
          <div style={{ height: HOUR_HEIGHT }} />
        </div>

        <div
          ref={columnsRef}
          className="flex flex-1"
          style={{
            height: TOTAL_GRID_HEIGHT,
            position: "relative",
            minWidth: 0,
            touchAction: interaction ? "none" : "auto",
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          {weekDates.map((_d, dayIndex) => {
            const isToday = dayIndex === todayIndex;
            const dayEvents = (eventsByDay[dayIndex] ?? []).filter(
              (e) => e.id !== draggingId
            );
            const dayOpen = openEventsByDay[dayIndex] ?? [];

            return (
              <div
                key={dayIndex}
                className={`flex-1 relative border-l border-slate-200 ${isToday ? "bg-blue-50/20" : ""}`}
                style={{ height: TOTAL_GRID_HEIGHT, minWidth: 0 }}
              >
                {HOURS.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      top: (h - START_HOUR) * HOUR_HEIGHT,
                      left: 0,
                      right: 0,
                    }}
                    className="border-t border-slate-100 pointer-events-none"
                  />
                ))}
                {HOURS.map((h) => (
                  <div
                    key={`${h}h`}
                    style={{
                      position: "absolute",
                      top: (h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2,
                      left: 0,
                      right: 0,
                    }}
                    className="border-t border-slate-50 pointer-events-none"
                  />
                ))}

                {isToday && (
                  <div
                    style={{
                      position: "absolute",
                      top: currentTimeTopPx,
                      left: -1,
                      right: 0,
                      zIndex: 15,
                    }}
                    className="flex items-center pointer-events-none"
                  >
                    <div className="w-2 h-2 rounded-full bg-blue-500 -ml-1 shrink-0" />
                    <div className="flex-1 border-t-2 border-blue-500" />
                  </div>
                )}

                {/* Closed timeline events — draggable & resizable */}
                {dayEvents.map((event) => (
                  <TimelineBlock
                    key={event.id}
                    event={event}
                    endOverride={
                      interaction?.type === "resize" &&
                      interaction.event.id === event.id
                        ? interaction.previewEnd
                        : undefined
                    }
                    onBodyPointerDown={handleBlockPointerDown}
                    onResizeStart={handleResizeStart}
                  />
                ))}

                {/* Open events — non-interactive pill at start time */}
                {dayOpen.map((e) => (
                  <OpenEventPill key={e.id} event={e} />
                ))}

                {/* Drag ghost */}
                {isDragging && dayIndex === previewDayIndex && previewStart && previewEnd && (
                  <div style={{ zIndex: 20, position: "absolute", inset: 0, pointerEvents: "none" }}>
                    <TimelineBlock
                      event={interaction!.event}
                      onBodyPointerDown={() => {}}
                      onResizeStart={() => {}}
                      startOverride={previewStart}
                      endOverride={previewEnd}
                      isGhost
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Block ─────────────────────────────────────────────────────────────
function TimelineBlock({
  event,
  startOverride,
  endOverride,
  onBodyPointerDown,
  onResizeStart,
  isGhost,
}: {
  event: WorkTimelineEvent;
  startOverride?: string;
  endOverride?: string;
  onBodyPointerDown: (e: React.PointerEvent, event: WorkTimelineEvent) => void;
  onResizeStart: (e: React.PointerEvent, event: WorkTimelineEvent) => void;
  isGhost?: boolean;
}) {
  const effectiveStart = startOverride ?? event.startedAtUtc;
  const effectiveEnd = endOverride ?? event.endedAtUtc!;
  const top = appointmentTopPx(effectiveStart);
  const height = appointmentHeightPx(effectiveStart, effectiveEnd);
  const style = TYPE_STYLE[event.type] ?? TYPE_STYLE.custom;
  const isShort = height < 38;

  return (
    <div
      data-testid={`timeline-cal-block-${event.id}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        onBodyPointerDown(e, event);
      }}
      style={{
        position: "absolute",
        top: `${top}px`,
        height: `${height}px`,
        left: "2px",
        right: "2px",
        zIndex: 10,
        cursor: isGhost ? "grabbing" : "grab",
        opacity: isGhost ? 0.85 : 1,
      }}
      className={[
        "rounded border overflow-hidden select-none",
        style.bg,
        style.border,
        style.text,
        "hover:brightness-95 active:brightness-90 transition-[filter,height,opacity] duration-75",
      ].join(" ")}
      title={`${event.title}\n${formatTime(effectiveStart)} – ${formatTime(effectiveEnd)}`}
    >
      <div className="px-1.5 pt-0.5 pb-3 h-full overflow-hidden pointer-events-none">
        {isShort ? (
          <span className="text-[11px] font-medium truncate block leading-tight">
            {event.title}
          </span>
        ) : (
          <>
            <div className="text-[11px] font-semibold truncate leading-snug">
              {event.title}
            </div>
            <div className="text-[10px] opacity-80 leading-tight">
              {formatTime(effectiveStart)}–{formatTime(effectiveEnd)}
            </div>
          </>
        )}
      </div>

      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onResizeStart(e, event);
        }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 8,
          cursor: "ns-resize",
          borderRadius: "0 0 3px 3px",
        }}
        className="bg-black/20 hover:bg-black/35 transition-colors"
      />
    </div>
  );
}

// Open events are never reshaped from the calendar — they don't yet have
// an end instant, and the timer owns their close. Show a thin pill at
// their start time so the user can see the timer is running today.
function OpenEventPill({ event }: { event: WorkTimelineEvent }) {
  const top = appointmentTopPx(event.startedAtUtc);
  const style = TYPE_STYLE[event.type] ?? TYPE_STYLE.custom;
  const isPaused = !!event.pausedAtUtc;
  return (
    <div
      title={`${event.title} — ${isPaused ? "paused" : "running"} (not editable from calendar)`}
      style={{
        position: "absolute",
        top: `${top}px`,
        left: "2px",
        right: "2px",
        height: 18,
        zIndex: 9,
      }}
      className={[
        "rounded-sm border text-[10px] px-1 leading-[16px] truncate",
        style.bg,
        style.border,
        style.text,
        isPaused ? "opacity-70" : "ring-2 ring-emerald-300",
      ].join(" ")}
    >
      {event.title} · {isPaused ? "paused" : "running"}
    </div>
  );
}
