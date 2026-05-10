import { describe, it, expect } from "vitest";
import { TimeService } from "./TimeService";

describe("DST ambiguity / non-existent times — explicit rejection", () => {
  it("rejects a non-existent time on DST spring-forward (Sydney 2026-10-04 02:30)", () => {
    // Sydney springs forward at 02:00 → 03:00 on the first Sunday of October.
    expect(() =>
      TimeService.wallClockToUtcIso({
        plainDate: "2026-10-04",
        hour: 2,
        minute: 30,
        timeZone: "Australia/Sydney",
        disambiguation: "reject",
      })
    ).toThrow();
  });

  it("rejects an ambiguous time on DST fall-back (Sydney 2026-04-05 02:30)", () => {
    // Sydney falls back at 03:00 AEDT → 02:00 AEST on the first Sunday of April.
    // 02:30 AEDT and 02:30 AEST both exist as wall-clocks — ambiguous.
    expect(() =>
      TimeService.wallClockToUtcIso({
        plainDate: "2026-04-05",
        hour: 2,
        minute: 30,
        timeZone: "Australia/Sydney",
        disambiguation: "reject",
      })
    ).toThrow();
  });

  it("accepts unambiguous times around the DST boundary", () => {
    // 04:00 Sydney is unambiguous in both spring and autumn.
    expect(
      TimeService.wallClockToUtcIso({
        plainDate: "2026-10-04",
        hour: 4,
        minute: 0,
        timeZone: "Australia/Sydney",
        disambiguation: "reject",
      })
    ).toMatch(/Z$/);
  });
});
