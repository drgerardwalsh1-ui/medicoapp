import { describe, it, expect } from "vitest";
import { formatTime24, formatAppointmentTime, formatDateISO } from "./format";

describe("format — 24-hour rendering", () => {
  it("renders Sydney AEST instant in viewer-tz Australia/Sydney", () => {
    // 2026-07-15 14:30 Australia/Sydney (winter — AEST UTC+10) = 04:30 UTC.
    expect(formatTime24("2026-07-15T04:30:00Z", "Australia/Sydney")).toBe("14:30");
  });

  it("renders Brisbane (no DST) and Sydney (AEDT) differently in summer", () => {
    // 2026-01-15 22:00 UTC: Sydney AEDT = 09:00, Brisbane AEST = 08:00.
    expect(formatTime24("2026-01-15T22:00:00Z", "Australia/Sydney")).toBe("09:00");
    expect(formatTime24("2026-01-15T22:00:00Z", "Australia/Brisbane")).toBe("08:00");
  });

  it("renders Perth/Sydney 3-hour offset in summer", () => {
    // 2026-01-15 22:00 UTC: Sydney AEDT = 09:00, Perth AWST = 06:00.
    expect(formatTime24("2026-01-15T22:00:00Z", "Australia/Sydney")).toBe("09:00");
    expect(formatTime24("2026-01-15T22:00:00Z", "Australia/Perth")).toBe("06:00");
  });

  it("renders NZ correctly (Pacific/Auckland, NZDT in summer)", () => {
    // 2026-01-15 22:00 UTC: NZ NZDT (UTC+13) = 11:00 next day.
    expect(formatTime24("2026-01-15T22:00:00Z", "Pacific/Auckland")).toBe("11:00");
  });

  it("renders Europe/London instant during BST", () => {
    // 2026-07-15 14:30 UTC: BST (UTC+1) = 15:30.
    expect(formatTime24("2026-07-15T14:30:00Z", "Europe/London")).toBe("15:30");
  });

  it("formatAppointmentTime hides secondary when offsets match", () => {
    const r = formatAppointmentTime(
      "2026-07-15T04:30:00Z",
      "Australia/Sydney",
      "Australia/Sydney"
    );
    expect(r.primary).toBe("14:30");
    expect(r.secondary).toBeNull();
  });

  it("formatAppointmentTime shows secondary when appointment-tz differs", () => {
    // Brisbane appointment at 09:00 (UTC 23:00 day before), viewer in Sydney AEDT.
    // 2026-01-15 09:00 Australia/Brisbane (AEST UTC+10) = 23:00 UTC on 14th.
    const r = formatAppointmentTime(
      "2026-01-14T23:00:00Z",
      "Australia/Brisbane",
      "Australia/Sydney"
    );
    expect(r.primary).toBe("10:00"); // Sydney AEDT shows 10:00
    expect(r.secondary).toBe("09:00 Brisbane");
  });

  it("formatDateISO returns ISO calendar date in viewer tz", () => {
    // Late-evening UTC may be next-day in NZ.
    expect(formatDateISO("2026-01-14T11:30:00Z", "Pacific/Auckland")).toBe("2026-01-15");
    expect(formatDateISO("2026-01-14T11:30:00Z", "Australia/Sydney")).toBe("2026-01-14");
  });
});
