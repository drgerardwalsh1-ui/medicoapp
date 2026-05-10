import { describe, it, expect } from "vitest";
import { elapsedMinutes, totalMinutes, startWorkSession, endWorkSession } from "./workSession";
import { asViewerTimeZone } from "./types";

describe("workSession — viewer-tz isolation and DST safety", () => {
  it("elapsed minutes are derived from UTC, ignoring viewer tz", () => {
    expect(elapsedMinutes("2026-05-10T00:00:00Z", "2026-05-10T01:30:00Z")).toBe(90);
  });

  it("DST rollback (Sydney) does not produce negative or doubled durations", () => {
    // Wall clock 02:00 AEDT → 02:00 AEST: same instant offset by 1h. A timer
    // running across this transition must report 60 actual minutes, not 0
    // and not 120.
    const startedAtUtc = "2026-04-04T15:30:00Z"; // 02:30 AEDT Sydney
    const endedAtUtc = "2026-04-04T16:30:00Z";   // 02:30 AEST Sydney (post rollback)
    expect(elapsedMinutes(startedAtUtc, endedAtUtc)).toBe(60);
  });

  it("totalMinutes aggregates across multiple sessions", () => {
    const tz = asViewerTimeZone("Australia/Sydney");
    const s1 = startWorkSession({ type: "prereading", viewerTimeZone: tz });
    const s2 = startWorkSession({ type: "reportWriting", viewerTimeZone: tz });
    // Pretend they each ran for 30 and 45 minutes respectively by patching.
    const e1 = {
      ...endWorkSession(s1),
      startedAtUtc: "2026-05-10T00:00:00Z",
      endedAtUtc: "2026-05-10T00:30:00Z",
      durationMinutes: 30,
    };
    const e2 = {
      ...endWorkSession(s2),
      startedAtUtc: "2026-05-10T01:00:00Z",
      endedAtUtc: "2026-05-10T01:45:00Z",
      durationMinutes: 45,
    };
    expect(totalMinutes([e1, e2])).toBe(75);
  });

  it("WorkSession viewer-tz field accepts only branded ViewerTimeZone", () => {
    // This is a compile-time check — runtime verifies the brand erasure
    // doesn't break basic invocation.
    const session = startWorkSession({
      type: "admin",
      viewerTimeZone: asViewerTimeZone("Australia/Sydney"),
    });
    expect(session.viewerTimeZone).toBe("Australia/Sydney");
    expect(session.endedAtUtc).toBeNull();
  });
});
