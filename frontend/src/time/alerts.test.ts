import { describe, it, expect } from "vitest";
import { computeActiveAlert } from "./alerts";
import type { Appointment } from "./types";

function appt(startUtc: string, endUtc: string, id = "1"): Appointment {
  return {
    id,
    type: "assessment",
    startUtc,
    endUtc,
    appointmentTimeZone: "Australia/Sydney",
  };
}

describe("alerts", () => {
  const now = "2026-05-10T00:00:00Z";

  it("no alert when next appointment is 16 minutes away", () => {
    const a = appt("2026-05-10T00:16:00Z", "2026-05-10T01:16:00Z");
    expect(computeActiveAlert([a], now)).toBeNull();
  });

  it("pre15 alert when start is 15 minutes away", () => {
    const a = appt("2026-05-10T00:15:00Z", "2026-05-10T01:15:00Z");
    const r = computeActiveAlert([a], now);
    expect(r?.kind).toBe("pre15");
    expect(r?.minutesDelta).toBe(15);
  });

  it("pre15 alert when start is 14 minutes away", () => {
    const a = appt("2026-05-10T00:14:00Z", "2026-05-10T01:14:00Z");
    const r = computeActiveAlert([a], now);
    expect(r?.kind).toBe("pre15");
    expect(r?.minutesDelta).toBe(14);
  });

  it("pre5 alert when start is 5 minutes away", () => {
    const a = appt("2026-05-10T00:05:00Z", "2026-05-10T01:05:00Z");
    const r = computeActiveAlert([a], now);
    expect(r?.kind).toBe("pre5");
    expect(r?.minutesDelta).toBe(5);
  });

  it("pre5 alert when start is 4 minutes away", () => {
    const a = appt("2026-05-10T00:04:00Z", "2026-05-10T01:04:00Z");
    const r = computeActiveAlert([a], now);
    expect(r?.kind).toBe("pre5");
  });

  it("overrun when appointment is in progress", () => {
    const a = appt("2026-05-09T23:59:00Z", "2026-05-10T01:00:00Z");
    const r = computeActiveAlert([a], now);
    expect(r?.kind).toBe("overrun");
    expect(r?.minutesDelta).toBe(-1);
  });

  it("ignores appointments that have already ended", () => {
    const a = appt("2026-05-09T22:00:00Z", "2026-05-09T23:00:00Z");
    expect(computeActiveAlert([a], now)).toBeNull();
  });

  it("picks the most urgent alert across multiple appointments", () => {
    const overdue = appt("2026-05-09T23:59:00Z", "2026-05-10T01:00:00Z", "overdue");
    const upcoming = appt("2026-05-10T00:14:00Z", "2026-05-10T01:14:00Z", "upcoming");
    const r = computeActiveAlert([upcoming, overdue], now);
    expect(r?.appointmentId).toBe("overdue");
    expect(r?.kind).toBe("overrun");
  });
});
