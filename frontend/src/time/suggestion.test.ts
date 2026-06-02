import { describe, it, expect } from "vitest";
import {
  deriveSuggestedTimerType,
  findCurrentOrSoonAppointment,
  findRecentCompletedAppointment,
  isReportWritingTab,
} from "./suggestion";
import type { Appointment } from "./types";

function appt(id: string, startUtc: string, endUtc: string): Appointment {
  return { id, type: "assessment", startUtc, endUtc, appointmentTimeZone: "UTC" };
}

const NOW = Date.parse("2026-05-10T10:00:00Z");

describe("suggestion — findCurrentOrSoonAppointment", () => {
  it("returns null when no client / no appointments", () => {
    expect(findCurrentOrSoonAppointment(undefined, NOW)).toBeNull();
    expect(findCurrentOrSoonAppointment([], NOW)).toBeNull();
  });

  it("returns an appointment happening now", () => {
    const a = appt("a", "2026-05-10T09:30:00Z", "2026-05-10T10:30:00Z");
    expect(findCurrentOrSoonAppointment([a], NOW)?.id).toBe("a");
  });

  it("returns an appointment starting within the 30-min window", () => {
    const a = appt("a", "2026-05-10T10:25:00Z", "2026-05-10T11:00:00Z");
    expect(findCurrentOrSoonAppointment([a], NOW)?.id).toBe("a");
  });

  it("ignores an appointment more than 30 minutes away", () => {
    const a = appt("a", "2026-05-10T10:31:00Z", "2026-05-10T11:00:00Z");
    expect(findCurrentOrSoonAppointment([a], NOW)).toBeNull();
  });

  it("ignores a finished appointment", () => {
    const a = appt("a", "2026-05-10T08:00:00Z", "2026-05-10T09:00:00Z");
    expect(findCurrentOrSoonAppointment([a], NOW)).toBeNull();
  });

  it("picks the earliest qualifying appointment when multiple qualify", () => {
    const a = appt("a", "2026-05-10T10:20:00Z", "2026-05-10T11:00:00Z");
    const b = appt("b", "2026-05-10T10:10:00Z", "2026-05-10T10:40:00Z");
    expect(findCurrentOrSoonAppointment([a, b], NOW)?.id).toBe("b");
  });
});

describe("suggestion — isReportWritingTab", () => {
  it("recognises schema report sections", () => {
    expect(isReportWritingTab("history")).toBe(true);
    expect(isReportWritingTab("pirs")).toBe(true);
    expect(isReportWritingTab("opinion")).toBe(true);
  });

  it("returns false for no-signal tabs", () => {
    for (const t of ["demographics", "dsm", "mse", "symptoms", "backgroundHistory", "timeline"]) {
      expect(isReportWritingTab(t)).toBe(false);
    }
    expect(isReportWritingTab(null)).toBe(false);
    expect(isReportWritingTab(undefined)).toBe(false);
  });
});

describe("suggestion — deriveSuggestedTimerType (precedence)", () => {
  it("falls back to prereading when there is no client", () => {
    const s = deriveSuggestedTimerType(null, "demographics", NOW);
    expect(s.type).toBe("prereading");
    expect(s.key).toBe("no-client");
    expect(s.appointmentId).toBeNull();
  });

  it("suggests assessment when an appointment is now or soon", () => {
    const a = appt("a1", "2026-05-10T10:00:00Z", "2026-05-10T11:00:00Z");
    const client = { id: "c1", appointments: [a] };
    const s = deriveSuggestedTimerType(client, "demographics", NOW);
    expect(s.type).toBe("assessment");
    expect(s.appointmentId).toBe("a1");
    expect(s.key).toBe("client:c1:appointment:a1:before-or-during");
  });

  it("appointment wins over report-writing tab", () => {
    const a = appt("a1", "2026-05-10T10:00:00Z", "2026-05-10T11:00:00Z");
    const client = { id: "c1", appointments: [a] };
    const s = deriveSuggestedTimerType(client, "opinion", NOW);
    expect(s.type).toBe("assessment");
  });

  it("suggests reportWriting on report tabs when no imminent appointment", () => {
    const client = { id: "c1", appointments: [] as Appointment[] };
    const s = deriveSuggestedTimerType(client, "pirs", NOW);
    expect(s.type).toBe("reportWriting");
    expect(s.key).toBe("client:c1:appointment:none");
  });

  it("falls back to prereading on neutral tabs with no imminent appointment", () => {
    const client = { id: "c1", appointments: [] as Appointment[] };
    const s = deriveSuggestedTimerType(client, "dsm", NOW);
    expect(s.type).toBe("prereading");
    expect(s.key).toBe("client:c1:appointment:none");
  });

  it("suggestionKey does not depend on the tab", () => {
    const client = { id: "c1", appointments: [] as Appointment[] };
    const a = deriveSuggestedTimerType(client, "demographics", NOW);
    const b = deriveSuggestedTimerType(client, "pirs", NOW);
    // Different suggested types, same key — tab changes should not
    // override the picker once the user has manually changed it.
    expect(a.type).toBe("prereading");
    expect(b.type).toBe("reportWriting");
    expect(a.key).toBe(b.key);
  });

  it("after appointment ends, suggests reportWriting with an 'after' key", () => {
    // Appointment ended 30 minutes ago — well inside the 12h window.
    const a = appt("a1", "2026-05-10T08:00:00Z", "2026-05-10T09:30:00Z");
    const client = { id: "c1", appointments: [a] };
    const s = deriveSuggestedTimerType(client, "demographics", NOW);
    expect(s.type).toBe("reportWriting");
    expect(s.appointmentId).toBe("a1");
    expect(s.key).toBe("client:c1:appointment:a1:after");
  });

  it("appointment key transitions from before-or-during to after", () => {
    const a = appt("a1", "2026-05-10T09:30:00Z", "2026-05-10T10:30:00Z");
    const client = { id: "c1", appointments: [a] };
    // Mid-appointment.
    const during = deriveSuggestedTimerType(client, "demographics", NOW);
    expect(during.type).toBe("assessment");
    expect(during.key).toContain(":before-or-during");
    // 30 min after end.
    const afterMs = Date.parse("2026-05-10T11:00:00Z");
    const after = deriveSuggestedTimerType(client, "demographics", afterMs);
    expect(after.type).toBe("reportWriting");
    expect(after.key).toContain(":after");
    // The before-or-during / after distinction must drive a key change so
    // TimerBar's userTouchedPicker reset fires exactly once at the boundary.
    expect(during.key).not.toBe(after.key);
  });
});

describe("suggestion — findRecentCompletedAppointment", () => {
  it("returns null when there are no appointments", () => {
    expect(findRecentCompletedAppointment(undefined, NOW)).toBeNull();
    expect(findRecentCompletedAppointment([], NOW)).toBeNull();
  });

  it("returns an appointment that ended within the 12h window", () => {
    const a = appt("a", "2026-05-10T05:00:00Z", "2026-05-10T06:00:00Z");
    expect(findRecentCompletedAppointment([a], NOW)?.id).toBe("a");
  });

  it("ignores appointments that ended more than 12h ago", () => {
    // Ended 13 hours before NOW (10:00 UTC).
    const a = appt("a", "2026-05-09T20:00:00Z", "2026-05-09T21:00:00Z");
    expect(findRecentCompletedAppointment([a], NOW)).toBeNull();
  });

  it("ignores appointments that have not ended yet", () => {
    const a = appt("a", "2026-05-10T09:30:00Z", "2026-05-10T10:30:00Z"); // ends in future
    expect(findRecentCompletedAppointment([a], NOW)).toBeNull();
  });

  it("picks the most recently-ended appointment when several qualify", () => {
    const a = appt("a", "2026-05-10T05:00:00Z", "2026-05-10T06:00:00Z");
    const b = appt("b", "2026-05-10T07:00:00Z", "2026-05-10T09:30:00Z");
    expect(findRecentCompletedAppointment([a, b], NOW)?.id).toBe("b");
  });
});
