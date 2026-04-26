import { useState, useMemo, useCallback } from "react";
import { TauriAPI, isTauri } from "../api/tauriApi";
import {
  type Appointment,
  getWeekStart,
  getWeekDates,
  isSameDay,
  generateId,
} from "./calendarUtils";

export type AppointmentWithClient = Appointment & { client: any };

export function useCalendar(
  clients: any[],
  onUpdateClient: (updated: any) => void
) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  // Flatten all appointments across all clients, tagged with their client object
  const allAppointments = useMemo<AppointmentWithClient[]>(
    () =>
      clients.flatMap((c) =>
        ((c.appointments as Appointment[]) ?? []).map((a) => ({
          ...a,
          client: c,
        }))
      ),
    [clients]
  );

  const weekAppointments = useMemo<AppointmentWithClient[]>(
    () =>
      allAppointments.filter((a) =>
        weekDates.some((d) => isSameDay(d, new Date(a.start)))
      ),
    [allAppointments, weekDates]
  );

  // Keyed by day index (0 = Mon … 6 = Sun) for O(1) column render
  const appointmentsByDay = useMemo(() => {
    const map: Record<number, AppointmentWithClient[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    weekAppointments.forEach((a) => {
      weekDates.forEach((d, i) => {
        if (isSameDay(d, new Date(a.start))) map[i].push(a);
      });
    });
    return map;
  }, [weekAppointments, weekDates]);

  // ── Navigation ─────────────────────────────────────────────────────────────

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

  // ── Persistence ────────────────────────────────────────────────────────────

  async function persistClientAppointments(
    clientId: string,
    appointments: Appointment[],
    client: any
  ) {
    const updated = { ...client, appointments };
    onUpdateClient(updated);

    if (isTauri) {
      const blob = {
        demographics: client.demographics,
        referrer: client.referrer,
        appointment: client.appointment,
        appointments,
      };
      try {
        await TauriAPI.updateClientDemographics(clientId, blob);
      } catch (err) {
        console.warn("[calendar] persist failed:", err);
      }
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async function createAppointment(
    clientId: string,
    start: Date,
    end: Date,
    type: Appointment["type"] = "assessment"
  ) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const appt: Appointment = {
      id: generateId(),
      clientId,
      start: start.toISOString(),
      end: end.toISOString(),
      type,
    };
    await persistClientAppointments(
      clientId,
      [...(client.appointments ?? []), appt],
      client
    );
  }

  const updateAppointment = useCallback(
    async (updated: Appointment) => {
      const client = clients.find((c) => c.id === updated.clientId);
      if (!client) return;
      const newList = ((client.appointments ?? []) as Appointment[]).map((a) =>
        a.id === updated.id ? updated : a
      );
      await persistClientAppointments(updated.clientId, newList, client);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients]
  );

  async function deleteAppointment(id: string, clientId: string) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const newList = ((client.appointments ?? []) as Appointment[]).filter(
      (a) => a.id !== id
    );
    await persistClientAppointments(clientId, newList, client);
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
