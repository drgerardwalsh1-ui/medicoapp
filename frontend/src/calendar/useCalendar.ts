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
} from "./calendarUtils";

export type { CalendarEvent as AppointmentWithClient };

export function useCalendar(
  clients: Client[],
  onUpdateClient: (updated: Client) => void
) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const allAppointments = useMemo<CalendarEvent[]>(
    () => {
      console.log("[calendar] clients", clients);
      return clients.flatMap((c) => mapClientToCalendarEvents(c));
    },
    [clients]
  );

  const weekAppointments = useMemo<CalendarEvent[]>(
    () =>
      allAppointments.filter((a) =>
        weekDates.some((d) => isSameDay(d, new Date(a.start)))
      ),
    [allAppointments, weekDates]
  );

  const appointmentsByDay = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    weekAppointments.forEach((a) => {
      weekDates.forEach((d, i) => {
        if (isSameDay(d, new Date(a.start))) map[i].push(a);
      });
    });
    return map;
  }, [weekAppointments, weekDates]);

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevWeek() {
    setWeekStart((w) => {
      const d = new Date(w);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }

  function nextWeek() {
    setWeekStart((w) => {
      const d = new Date(w);
      d.setDate(d.getDate() + 7);
      return d;
    });
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
      console.log("[calendar] saving client", client.id, "with", appointments.length, "appointments");
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
    type: Appointment["type"] = "assessment"
  ) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const appt: Appointment = {
      id: crypto.randomUUID(),
      start: start.toISOString(),
      end: end.toISOString(),
      type,
    };
    await persistClientAppointments(client, [...client.appointments, appt]);
  }

  const updateAppointment = useCallback(
    async (updated: CalendarEvent) => {
      const client = updated.client;
      const { client: _client, ...appt } = updated;
      const newList = client.appointments.map((a) =>
        a.id === appt.id ? appt : a
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
  };
}
