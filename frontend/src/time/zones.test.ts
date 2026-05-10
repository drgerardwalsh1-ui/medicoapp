import { describe, it, expect } from "vitest";
import { isValidTimeZone, offsetMinutesAt, TIMEZONE_OPTIONS } from "./zones";

describe("zones", () => {
  it("validates known IANA ids", () => {
    expect(isValidTimeZone("Australia/Sydney")).toBe(true);
    expect(isValidTimeZone("Pacific/Auckland")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects bogus ids", () => {
    expect(isValidTimeZone("Australia/Springfield")).toBe(false);
    expect(isValidTimeZone("not-a-zone")).toBe(false);
  });

  it("offsetMinutesAt reports relative offset between two zones during DST", () => {
    // Sydney AEDT (UTC+11) vs Brisbane AEST (UTC+10) on 2026-01-15: +60min.
    expect(
      offsetMinutesAt(
        "2026-01-15T00:00:00Z",
        "Australia/Sydney",
        "Australia/Brisbane"
      )
    ).toBe(60);
  });

  it("offsetMinutesAt is zero outside DST when zones share base offset", () => {
    // 2026-07-15 — Sydney winter AEST (UTC+10) = Brisbane (UTC+10).
    expect(
      offsetMinutesAt(
        "2026-07-15T00:00:00Z",
        "Australia/Sydney",
        "Australia/Brisbane"
      )
    ).toBe(0);
  });

  it("TIMEZONE_OPTIONS contains the spec-required jurisdictions", () => {
    const ids = TIMEZONE_OPTIONS.map((o) => o.id);
    expect(ids).toContain("Australia/Sydney");
    expect(ids).toContain("Australia/Brisbane");
    expect(ids).toContain("Australia/Perth");
    expect(ids).toContain("Pacific/Auckland");
    expect(ids).toContain("Europe/London");
  });
});
