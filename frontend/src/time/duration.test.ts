import { describe, it, expect } from "vitest";
import { durationMinutes, durationLabel, endUtcFromDuration } from "./duration";

describe("duration", () => {
  it("derives minutes from UTC instants", () => {
    expect(durationMinutes("2026-05-10T00:00:00Z", "2026-05-10T01:30:00Z")).toBe(90);
  });

  it("is invariant under DST — Sydney AEDT→AEST fall-back (April 2026)", () => {
    // 2026-04-05 03:00 AEDT (UTC+11) is the same instant as 02:00 AEST (UTC+10).
    // A 60-minute appointment crossing the rollback must remain 60 minutes.
    const startUtc = "2026-04-04T15:30:00Z"; // 02:30 AEDT
    const endUtc = "2026-04-04T16:30:00Z";   // 02:30 AEST (after rollback)
    expect(durationMinutes(startUtc, endUtc)).toBe(60);
  });

  it("is invariant across timezone-travel between viewer locations", () => {
    // Same UTC pair, regardless of where the viewer is: duration is 75.
    expect(durationMinutes("2026-05-10T03:00:00Z", "2026-05-10T04:15:00Z")).toBe(75);
  });

  it("labels minutes correctly", () => {
    expect(durationLabel(15)).toBe("15 min");
    expect(durationLabel(60)).toBe("1 hr");
    expect(durationLabel(90)).toBe("1 hr 30 min");
  });

  it("manual duration change updates END only", () => {
    const startUtc = "2026-05-10T00:00:00Z";
    const newEnd = endUtcFromDuration(startUtc, 45);
    expect(durationMinutes(startUtc, newEnd)).toBe(45);
    // start is unchanged by definition — endUtcFromDuration takes startUtc.
  });
});
