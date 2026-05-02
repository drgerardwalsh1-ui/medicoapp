import { useState, useMemo } from "react";
import CalendarGrid from "./CalendarGrid";
import { buildClientName, type Client, type Appointment } from "../types/client";
import { useCalendar } from "./useCalendar";
import {
  formatMonthYear,
  formatDateRange,
} from "./calendarUtils";

interface CalendarViewProps {
  clients: Client[];
  onNavigate: (clientId: string) => void;
  onUpdateClient: (updated: Client) => void;
}

// ── New-appointment modal ────────────────────────────────────────────────────

interface NewApptModalProps {
  clients: any[];
  initialStart: Date;
  onSave: (
    clientId: string,
    start: Date,
    end: Date,
    type: Appointment["type"]
  ) => void;
  onCancel: () => void;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const DURATION_OPTIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "1.5 hours", minutes: 90 },
  { label: "2 hours", minutes: 120 },
];

function NewApptModal({ clients, initialStart, onSave, onCancel }: NewApptModalProps) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [startStr, setStartStr] = useState(toLocalInputValue(initialStart));
  const [durationMins, setDurationMins] = useState(60);
  const [type, setType] = useState<Appointment["type"]>("assessment");

  function handleSave() {
    if (!clientId) return;
    const start = new Date(startStr);
    const end = new Date(start.getTime() + durationMins * 60_000);
    onSave(clientId, start, end, type);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">New Appointment</h3>

        {/* Client */}
        <div>
          <label className="label">Client</label>
          <select
            className="input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            {clients.length === 0 && (
              <option value="" disabled>
                No clients — create one first
              </option>
            )}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {buildClientName(c.identity) || c.id}
              </option>
            ))}
          </select>
        </div>

        {/* Start time */}
        <div>
          <label className="label">Start</label>
          <input
            type="datetime-local"
            className="input"
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
          />
        </div>

        {/* Duration */}
        <div>
          <label className="label">Duration</label>
          <div className="flex gap-2 flex-wrap">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.minutes}
                type="button"
                onClick={() => setDurationMins(opt.minutes)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                  durationMins === opt.minutes
                    ? "bg-violet-600 text-white border-violet-600"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Type */}
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as Appointment["type"])}
          >
            <option value="assessment">Assessment</option>
            <option value="review">Review</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            className="btn-primary flex-1"
            onClick={handleSave}
            disabled={!clientId}
          >
            Save
          </button>
          <button type="button" className="btn-secondary flex-1" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main CalendarView ────────────────────────────────────────────────────────

export default function CalendarView({
  clients,
  onNavigate,
  onUpdateClient,
}: CalendarViewProps) {
  const {
    weekStart,
    weekDates,
    appointmentsByDay,
    prevWeek,
    nextWeek,
    goToToday,
    createAppointment,
    updateAppointment,
  } = useCalendar(clients, onUpdateClient);

  const [newApptModal, setNewApptModal] = useState<{ start: Date } | null>(null);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  const isCurrentWeek = useMemo(() => {
    const today = new Date();
    return weekDates.some((d) => {
      return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
      );
    });
  }, [weekDates]);

  const totalWeekAppointments = useMemo(() => {
    return Object.values(appointmentsByDay).reduce((s, arr) => s + arr.length, 0);
  }, [appointmentsByDay]);

  function handleSlotClick(start: Date) {
    setNewApptModal({ start });
  }

  async function handleCreateAppt(
    clientId: string,
    start: Date,
    end: Date,
    type: Appointment["type"]
  ) {
    await createAppointment(clientId, start, end, type);
    setNewApptModal(null);
  }

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 shrink-0 flex-wrap">
        {/* Week navigation */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevWeek}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
            title="Previous week"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={nextWeek}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
            title="Next week"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Week label */}
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">
            {formatDateRange(weekStart, weekEnd)}
          </span>
          <span className="text-xs text-slate-400">
            {formatMonthYear(weekStart)}
          </span>
        </div>

        {/* Today button */}
        {!isCurrentWeek && (
          <button
            type="button"
            onClick={goToToday}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition font-medium"
          >
            Today
          </button>
        )}

        {/* Appointment count */}
        {totalWeekAppointments > 0 && (
          <span className="text-xs text-slate-400 tabular-nums">
            {totalWeekAppointments} appt{totalWeekAppointments !== 1 ? "s" : ""} this week
          </span>
        )}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            Complete
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400" />
            In progress
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500" />
            Docs missing
          </span>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const start = new Date(now);
              start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
              setNewApptModal({ start });
            }}
            className="flex items-center gap-1 text-violet-600 hover:text-violet-700 font-medium transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        </div>
      </div>

      {/* ── Calendar grid ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <CalendarGrid
          weekDates={weekDates}
          appointmentsByDay={appointmentsByDay}
          onNavigate={onNavigate}
          onSlotClick={handleSlotClick}
          onUpdateAppointment={updateAppointment}
        />
      </div>

      {/* Empty-state hint when no appointments exist */}
      {totalWeekAppointments === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-slate-400 space-y-1">
            <div className="text-2xl">📅</div>
            <p className="text-sm font-medium">No appointments this week</p>
            <p className="text-xs">Click any time slot to schedule one</p>
          </div>
        </div>
      )}

      {/* ── New-appointment modal ─────────────────────────────────────────── */}
      {newApptModal && (
        <NewApptModal
          clients={clients}
          initialStart={newApptModal.start}
          onSave={handleCreateAppt}
          onCancel={() => setNewApptModal(null)}
        />
      )}
    </div>
  );
}
