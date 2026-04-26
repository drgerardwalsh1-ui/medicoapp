import React, { useRef, useMemo, useCallback, useState, useEffect } from "react";
import AppointmentBlock from "./AppointmentBlock";
import {
  HOUR_HEIGHT,
  START_HOUR,
  HOURS,
  TIME_LABEL_WIDTH,
  TOTAL_GRID_HEIGHT,
  isSameDay,
  pixelsToDateTime,
} from "./calendarUtils";
import type { AppointmentWithClient } from "./useCalendar";
import type { Appointment } from "./calendarUtils";

interface Props {
  weekDates: Date[];
  appointmentsByDay: Record<number, AppointmentWithClient[]>;
  onNavigate: (clientId: string) => void;
  onSlotClick: (start: Date) => void;
  onUpdateAppointment: (updated: Appointment) => Promise<void>;
}

export default function CalendarGrid({
  weekDates,
  appointmentsByDay,
  onNavigate,
  onSlotClick,
  onUpdateAppointment,
}: Props) {
  // The flex row of all 7 day columns — receives pointer capture for resize
  const columnsRef = useRef<HTMLDivElement>(null);

  // Drag: ref (not state) so drag start/end never triggers re-render
  const dragRef = useRef<{
    appointment: AppointmentWithClient;
    offsetY: number;
  } | null>(null);

  // Resize: state so the appointment block re-renders with live preview
  const [resizeState, setResizeState] = useState<{
    appointment: AppointmentWithClient;
    previewEnd: string;
    pointerId: number;
  } | null>(null);

  // Current-time indicator
  const now = new Date();
  const currentTimeTopPx = useMemo(() => {
    const mins = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
    return Math.max(0, Math.min((mins / 60) * HOUR_HEIGHT, TOTAL_GRID_HEIGHT));
  }, []); // Only computed once per mount; good enough for a session

  const todayIndex = useMemo(
    () => weekDates.findIndex((d) => isSameDay(d, new Date())),
    [weekDates]
  );

  // Auto-scroll to current time on first render
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollContainerRef.current) {
      const target = Math.max(0, currentTimeTopPx - 80);
      scrollContainerRef.current.scrollTop = target;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag ────────────────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent, appointment: AppointmentWithClient) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dragRef.current = { appointment, offsetY: e.clientY - rect.top };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", appointment.id);
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, dayIndex: number) => {
      e.preventDefault();
      const drag = dragRef.current;
      if (!drag) return;

      const col = e.currentTarget as HTMLElement;
      const rect = col.getBoundingClientRect();
      const rawY = e.clientY - rect.top - drag.offsetY;

      const newStart = pixelsToDateTime(Math.max(0, rawY), weekDates[dayIndex]);
      const duration =
        new Date(drag.appointment.end).getTime() -
        new Date(drag.appointment.start).getTime();
      const newEnd = new Date(newStart.getTime() + duration);

      onUpdateAppointment({
        ...drag.appointment,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
      });
      dragRef.current = null;
    },
    [weekDates, onUpdateAppointment]
  );

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Resize ──────────────────────────────────────────────────────────────────
  // Pointer capture on columnsRef routes all pointer events here even when
  // the cursor leaves the element during a fast resize gesture.

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, appointment: AppointmentWithClient) => {
      e.stopPropagation();
      e.preventDefault();
      columnsRef.current?.setPointerCapture(e.pointerId);
      setResizeState({
        appointment,
        previewEnd: appointment.end,
        pointerId: e.pointerId,
      });
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeState || !columnsRef.current) return;

      const apptStart = new Date(resizeState.appointment.start);
      const dayIndex = weekDates.findIndex((d) => isSameDay(d, apptStart));
      if (dayIndex < 0) return;

      // getBoundingClientRect().top already accounts for scroll offset
      const gridTop = columnsRef.current.getBoundingClientRect().top;
      const rawY = e.clientY - gridTop;

      const newEnd = pixelsToDateTime(Math.max(0, rawY), weekDates[dayIndex]);
      const minEnd = new Date(apptStart.getTime() + 15 * 60_000);
      if (newEnd > minEnd) {
        setResizeState((prev) =>
          prev ? { ...prev, previewEnd: newEnd.toISOString() } : null
        );
      }
    },
    [resizeState, weekDates]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeState) return;
      columnsRef.current?.releasePointerCapture(e.pointerId);
      onUpdateAppointment({
        ...resizeState.appointment,
        end: resizeState.previewEnd,
      });
      setResizeState(null);
    },
    [resizeState, onUpdateAppointment]
  );

  // ── Empty-slot click ────────────────────────────────────────────────────────

  const handleColumnClick = useCallback(
    (e: React.MouseEvent, dayIndex: number) => {
      // Ignore clicks that landed on an appointment block
      if ((e.target as HTMLElement).closest("[data-appt]")) return;
      const col = e.currentTarget as HTMLElement;
      const rect = col.getBoundingClientRect();
      const rawY = e.clientY - rect.top;
      onSlotClick(pixelsToDateTime(Math.max(0, rawY), weekDates[dayIndex]));
    },
    [weekDates, onSlotClick]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full select-none bg-white">
      {/* Day-header row — sticky */}
      <div className="flex border-b border-slate-200 bg-white shrink-0 z-20">
        {/* Spacer aligned with time-label column */}
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
          {/* Bottom cap so last label isn't cut off */}
          <div style={{ height: HOUR_HEIGHT }} />
        </div>

        {/* Day columns */}
        <div
          ref={columnsRef}
          className="flex flex-1"
          style={{ height: TOTAL_GRID_HEIGHT, position: "relative", minWidth: 0 }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {weekDates.map((_d, dayIndex) => {
            const isToday = dayIndex === todayIndex;
            const dayAppts = appointmentsByDay[dayIndex] ?? [];

            return (
              <div
                key={dayIndex}
                className={`flex-1 relative border-l border-slate-200 ${
                  isToday ? "bg-blue-50/20" : ""
                }`}
                style={{
                  height: TOTAL_GRID_HEIGHT,
                  minWidth: 0,
                  cursor: "crosshair",
                }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, dayIndex)}
                onDragEnd={handleDragEnd}
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

                {/* Current-time line (today only) */}
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
                      onNavigate={onNavigate}
                      onDragStart={handleDragStart}
                      onResizeStart={handleResizeStart}
                      endOverride={
                        resizeState?.appointment.id === appt.id
                          ? resizeState.previewEnd
                          : undefined
                      }
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
