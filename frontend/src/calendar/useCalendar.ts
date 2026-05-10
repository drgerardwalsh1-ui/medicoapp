import { useState, useMemo, useCallback } from "react";
import { TauriAPI, isTauri } from "../api/tauriApi";
import {
  type Appointment,
  type CalendarEvent,
  type Client,
  mapClientToCalendarEvents,
} from "../types/client";
import {
  getWeekStart,
  getWeekDates,
  isSameDay,
  addDays,
  plainDateOfInstant,
} from "./calendarUtils";
import {
  endUtcFromDuration,
  getViewerTimeZone,
  TimeService,
} from "../time";

export type { CalendarEvent as AppointmentWithClient };

export function useCalendar(
  clients: Client[],
  onUpdateClient: (updated: Client) => void
) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const allAppointments = useMemo<CalendarEvent[]>(
    () => clients.flatMap((c) => mapClientToCalendarEvents(c)),
    [clients]
  );

  // Bucket appointments into day columns using viewer-tz wall-clock dates,
  // not raw UTC slicing (spec Part 9.1).
  const appointmentsByDay = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    const dayKeys = weekDates.map((d) =>
      [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-")
    );
    for (let i = 0; i < 7; i++) map[i] = [];
    allAppointments.forEach((a) => {
      const apptDay = plainDateOfInstant(a.startUtc);
      const idx = dayKeys.indexOf(apptDay);
      if (idx >= 0) map[idx].push(a);
    });
    return map;
  }, [allAppointments, weekDates]);

  const weekAppointments = useMemo<CalendarEvent[]>(
    () => Object.values(appointmentsByDay).flat(),
    [appointmentsByDay]
  );

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevWeek() {
    setWeekStart((w) => addDays(w, -7));
  }

  function nextWeek() {
    setWeekStart((w) => addDays(w, 7));
  }

  function goToToday() {
    setWeekStart(getWeekStart(new Date()));
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  async function persistClientAppointments(
    client: Client,
    appointments: Appointment[]
  ) {
    const updated: Client = { ...client, appointments };
    onUpdateClient(updated);

    if (isTauri) {
      const blob = {
        identity: client.identity,
        administrative: client.administrative,
        clinical: client.clinical,
        appointments,
        assessmentChecklist: client.assessmentChecklist,
        report: client.report,
      };
      try {
        await TauriAPI.updateClientDemographics(client.id, blob);
      } catch (err) {
        console.warn("[calendar] persist failed:", err);
      }
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async function createAppointment(
    clientId: string,
    start: Date,
    end: Date,
    type: Appointment["type"] = "assessment",
    appointmentTimeZone: string = getViewerTimeZone()
  ) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const appt: Appointment = {
      id: crypto.randomUUID(),
      type,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      appointmentTimeZone,
    };
    await persistClientAppointments(client, [...client.appointments, appt]);
  }

  // Spec Part 10: drag/resize moves the absolute UTC instant. Appointment
  // timezone metadata is preserved; wall-clock labels recompute from the
  // new UTC value.
  const updateAppointment = useCallback(
    async (updated: CalendarEvent) => {
      const client = updated.client;
      const { client: _client, ...next } = updated;
      const newList = client.appointments.map((a) =>
        a.id === next.id ? next : a
      );
      await persistClientAppointments(client, newList);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients]
  );

  async function deleteAppointment(event: CalendarEvent) {
    const client = event.client;
    const newList = client.appointments.filter((a) => a.id !== event.id);
    await persistClientAppointments(client, newList);
  }

  // Convenience for callers that change duration without touching start —
  // delegates to TimeService so duration logic stays centralized.
  function withNewDuration(appt: Appointment, minutes: number): Appointment {
    const endUtc = endUtcFromDuration(appt.startUtc, minutes);
    return { ...appt, endUtc };
  }

  return {
    weekStart,
    weekDates,
    weekAppointments,
    appointmentsByDay,
    prevWeek,
    nextWeek,
    goToToday,
    createAppointment,
    updateAppointment,
    deleteAppointment,
    withNewDuration,
    isSameDay,
    timeService: TimeService,
  };
}
