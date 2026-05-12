import React, { useRef, useMemo, useCallback, useState, useEffect } from "react";
import AppointmentBlock from "./AppointmentBlock";
import {
  HOUR_HEIGHT,
  HOURS,
  TIME_LABEL_WIDTH,
  TOTAL_GRID_HEIGHT,
  START_HOUR,
  isSameDay,
  isInstantOnDay,
  pixelsToDateTime,
  appointmentTopPx,
} from "./calendarUtils";
import { nowMinutesSinceStartHour, durationMs, addMinutesToInstant, compareInstants } from "../time";
import type { AppointmentWithClient } from "./useCalendar";

interface Props {
  weekDates: Date[];
  appointmentsByDay: Record<number, AppointmentWithClient[]>;
  onNavigate: (clientId: string) => void;
  onSlotClick: (start: Date) => void;
  onUpdateAppointment: (updated: AppointmentWithClient) => Promise<void>;
}

type Interaction = {
  type: "drag" | "resize";
  appointment: AppointmentWithClient;
  pointerId: number;
  offsetY: number;       // grid-y of click minus appt top (drag only)
  previewStart: string;
  previewEnd: string;
  previewDayIndex: number;
};

export default function CalendarGrid({
  weekDates,
  appointmentsByDay,
  onNavigate,
  onSlotClick,
  onUpdateAppointment,
}: Props) {
  const columnsRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [interaction, setInteraction] = useState<Interaction | null>(null);

  // Set to true when a drag/resize commits so the subsequent synthetic `click`
  // event (which the browser fires on the original pointerdown target even
  // after pointer capture) does NOT trigger navigation.
  const didInteractRef = useRef(false);

  // Pending: pointer down on an appointment body, not yet dragging
  const pendingRef = useRef<{
    appointment: AppointmentWithClient;
    pointerId: number;
    startX: number;
    startY: number;
    offsetY: number;
  } | null>(null);

  // Current-time indicator — viewer-tz wall-clock minutes since START_HOUR.
  const currentTimeTopPx = useMemo(() => {
    const mins = nowMinutesSinceStartHour();
    return Math.max(0, Math.min((mins / 60) * HOUR_HEIGHT, TOTAL_GRID_HEIGHT));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const todayIndex = useMemo(
    () => weekDates.findIndex((d) => isSameDay(d, new Date())),
    [weekDates]
  );

  // Auto-scroll to current time on first render
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = Math.max(0, currentTimeTopPx - 80);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────────────────────

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

  // ── Appointment body pointer down → queue pending drag ────────────────────

  const handleAppointmentBodyDown = useCallback(
    (e: React.PointerEvent, appointment: AppointmentWithClient) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const gridY = getGridY(e.clientY);
      const apptTopY = appointmentTopPx(appointment.startUtc);
      pendingRef.current = {
        appointment,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offsetY: gridY - apptTopY,
      };
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Resize start (from resize handle pointer down) ────────────────────────

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, appointment: AppointmentWithClient) => {
      e.stopPropagation();
      e.preventDefault();
      columnsRef.current?.setPointerCapture(e.pointerId);
      setInteraction({
        type: "resize",
        appointment,
        pointerId: e.pointerId,
        offsetY: 0,
        previewStart: appointment.startUtc,
        previewEnd: appointment.endUtc,
        previewDayIndex: weekDates.findIndex((d) =>
          isInstantOnDay(appointment.startUtc, d)
        ),
      });
    },
    [weekDates]
  );

  // ── Pointer move: activate drag OR update active interaction ──────────────

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Activate drag from pending if threshold exceeded
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
            pending.appointment.startUtc,
            pending.appointment.endUtc
          );
          const newEnd = new Date(newStart.getTime() + duration);
          setInteraction({
            type: "drag",
            appointment: pending.appointment,
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
          interaction.appointment.startUtc,
          interaction.appointment.endUtc
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
          weekDates.find((d) => isInstantOnDay(interaction.appointment.startUtc, d)) ??
          weekDates[0];
        const gridY = getGridY(e.clientY);
        const newEnd = pixelsToDateTime(Math.max(0, gridY), apptDay);
        const minEndIso = addMinutesToInstant(interaction.appointment.startUtc, 15);
        if (compareInstants(newEnd.toISOString(), minEndIso) > 0) {
          setInteraction((prev) =>
            prev ? { ...prev, previewEnd: newEnd.toISOString() } : null
          );
        }
      }
    },
    [interaction, weekDates] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Pointer up: commit interaction ────────────────────────────────────────

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      pendingRef.current = null;
      if (!interaction) return;
      columnsRef.current?.releasePointerCapture(e.pointerId);
      // Spec Part 10: drag/resize moves the absolute UTC instant. Appointment
      // timezone is preserved; viewer wall-clock label recomputes from UTC.
      // Flag that an interaction just committed so the following synthetic click
      // (browser fires it on the original pointerdown target after capture
      // release) is suppressed in handleNavigate.
      didInteractRef.current = true;
      onUpdateAppointment({
        ...interaction.appointment,
        startUtc: interaction.previewStart,
        endUtc: interaction.previewEnd,
      });
      setInteraction(null);
    },
    [interaction, onUpdateAppointment]
  );

  // ── Navigation wrapper: suppress click-after-drag ─────────────────────────
  // After a drag or resize the browser synthesises a `click` on the element
  // that received the original `pointerdown`. We intercept that click here
  // (not in AppointmentBlock) so the component stays unaware of drag state.
  const handleNavigate = useCallback(
    (clientId: string) => {
      if (didInteractRef.current) {
        didInteractRef.current = false;
        return;
      }
      onNavigate(clientId);
    },
    [onNavigate]
  );

  const handlePointerCancel = useCallback(() => {
    pendingRef.current = null;
    setInteraction(null);
  }, []);

  // ── Empty slot click → create new appointment ─────────────────────────────

  const handleColumnClick = useCallback(
    (e: React.MouseEvent, dayIndex: number) => {
      if ((e.target as HTMLElement).closest("[data-appt]")) return;
      const col = e.currentTarget as HTMLElement;
      const rect = col.getBoundingClientRect();
      const rawY = e.clientY - rect.top;
      onSlotClick(pixelsToDateTime(Math.max(0, rawY), weekDates[dayIndex]));
    },
    [weekDates, onSlotClick]
  );

  // ── Drag state for rendering ──────────────────────────────────────────────

  const isDragging = interaction?.type === "drag";
  const draggingId = isDragging ? interaction!.appointment.id : null;
  const previewDayIndex = isDragging ? interaction!.previewDayIndex : -1;
  const previewStart = isDragging ? interaction!.previewStart : null;
  const previewEnd = isDragging ? interaction!.previewEnd : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full select-none bg-white">
      {/* Day-header row */}
      <div className="flex border-b border-slate-200 bg-white shrink-0 z-20">
        <div style={{ width: TIME_LABEL_WIDTH }} className="shrink-0" />
        {weekDates.map((d, i) => {
          const isToday = i === todayIndex;
          return (
            <div
              key={i}
              className={`flex-1 py-2 text-center border-l border-slate-200 ${
                isToday ? "bg-blue-50/60" : ""
              }`}
            >
              <div
                className={`text-xs font-medium uppercase tracking-wider ${
                  isToday ? "text-blue-500" : "text-slate-400"
                }`}
              >
                {d.toLocaleDateString([], { weekday: "short" })}
              </div>
              <div
                className={`text-lg font-semibold mx-auto mt-0.5 w-9 h-9 flex items-center justify-center rounded-full ${
                  isToday ? "bg-blue-600 text-white" : "text-slate-700"
                }`}
              >
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
        {/* Time labels */}
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
              <span className="text-xs text-slate-400 leading-none tabular-nums">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
          <div style={{ height: HOUR_HEIGHT }} />
        </div>

        {/* Day columns — capture pointer events for drag + resize */}
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
            // During drag: remove dragged appt from its original day
            const dayAppts = (appointmentsByDay[dayIndex] ?? []).filter(
              (a) => a.id !== draggingId
            );

            return (
              <div
                key={dayIndex}
                className={`flex-1 relative border-l border-slate-200 ${
                  isToday ? "bg-blue-50/20" : ""
                }`}
                style={{ height: TOTAL_GRID_HEIGHT, minWidth: 0, cursor: "crosshair" }}
                onClick={(e) => handleColumnClick(e, dayIndex)}
              >
                {/* Hour lines */}
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

                {/* Half-hour ticks */}
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

                {/* Current-time line */}
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
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 -ml-1 shrink-0" />
                    <div className="flex-1 border-t-2 border-blue-500" />
                  </div>
                )}

                {/* Appointment blocks */}
                {dayAppts.map((appt) => (
                  <div key={appt.id} data-appt="true">
                    <AppointmentBlock
                      appointment={appt}
                      onNavigate={handleNavigate}
                      onBodyPointerDown={handleAppointmentBodyDown}
                      onResizeStart={handleResizeStart}
                      endOverride={
                        interaction?.type === "resize" &&
                        interaction.appointment.id === appt.id
                          ? interaction.previewEnd
                          : undefined
                      }
                    />
                  </div>
                ))}

                {/* Drag ghost: show dragged appointment at preview position */}
                {isDragging && dayIndex === previewDayIndex && previewStart && previewEnd && (
                  <div data-appt="true" style={{ zIndex: 20, position: "absolute", inset: 0, pointerEvents: "none" }}>
                    <AppointmentBlock
                      appointment={interaction!.appointment}
                      onNavigate={() => {}}
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

