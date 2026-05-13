import { describe, it, expect } from "vitest";
import { buildTimelinePageModel, slugifyForFilename } from "./timelineFormatter";
import { asViewerTimeZone } from "../time";
import { defaultClient } from "../types/client";
import type { Client } from "../types/client";
import type { WorkTimelineEvent } from "../time";

const TZ = "Australia/Sydney";

function ev(opts: Partial<WorkTimelineEvent>): WorkTimelineEvent {
  return {
    id: crypto.randomUUID(),
    type: "assessment",
    title: "Test",
    startedAtUtc: "2026-05-10T00:00:00Z",
    endedAtUtc: "2026-05-10T00:30:00Z",
    viewerTimeZone: asViewerTimeZone(TZ),
    manuallyEdited: false,
    createdAutomatically: false,
    accumulatedPausedMs: 0,
    pausedAtUtc: null,
    ...opts,
  };
}

function clientWith(timeline: WorkTimelineEvent[], identity: Partial<Client["identity"]> = {}): Client {
  const c = defaultClient();
  return {
    ...c,
    identity: { ...c.identity, firstName: "Jack", lastName: "Crane", ...identity },
    workTimeline: timeline,
  };
}

describe("timelineFormatter — buildTimelinePageModel", () => {
  it("renders an empty timeline cleanly", () => {
    const model = buildTimelinePageModel(clientWith([]), TZ);
    expect(model.days).toEqual([]);
    expect(model.totalEvents).toBe(0);
    expect(model.totalMinutes).toBe(0);
    expect(model.clientName).toBe("Jack Crane");
    expect(model.viewerTimeZone).toBe(TZ);
  });

  it("groups events by viewer-tz date and sorts both groups and rows", () => {
    const e1 = ev({ startedAtUtc: "2026-05-09T22:00:00Z", endedAtUtc: "2026-05-09T22:30:00Z" }); // 08:00 Sydney 10
    const e2 = ev({ startedAtUtc: "2026-05-09T23:00:00Z", endedAtUtc: "2026-05-09T23:30:00Z" }); // 09:00 Sydney 10
    const e3 = ev({ startedAtUtc: "2026-05-10T22:00:00Z", endedAtUtc: "2026-05-10T22:30:00Z" }); // next day
    const model = buildTimelinePageModel(clientWith([e3, e1, e2]), TZ);
    expect(model.days.map((d) => d.dateKey)).toEqual([
      // Sorted ascending by date
      model.days[0].dateKey,
      model.days[1].dateKey,
    ]);
    expect(model.days).toHaveLength(2);
    expect(model.days[0].rows).toHaveLength(2);
    expect(model.days[1].rows).toHaveLength(1);
    // Within day, rows sorted by startUtc.
    expect(model.days[0].rows[0].startUtc).toBe(e1.startedAtUtc);
    expect(model.days[0].rows[1].startUtc).toBe(e2.startedAtUtc);
  });

  it("subtracts paused time from row + total durations (pause-aware)", () => {
    // Wall span 30m, paused 10m → active work 20m.
    const e = ev({
      startedAtUtc: "2026-05-10T00:00:00Z",
      endedAtUtc:   "2026-05-10T00:30:00Z",
      accumulatedPausedMs: 10 * 60_000,
    });
    const model = buildTimelinePageModel(clientWith([e]), TZ);
    expect(model.days).toHaveLength(1);
    expect(model.days[0].totalMinutes).toBe(20);
    expect(model.days[0].rows[0].durationLabel).toMatch(/20\s*min/);
    expect(model.totalMinutes).toBe(20);
  });

  it("marks paused and running events explicitly", () => {
    const running = ev({ endedAtUtc: null, startedAtUtc: "2026-05-10T00:00:00Z" });
    const paused = ev({
      endedAtUtc: null,
      pausedAtUtc: "2026-05-10T00:05:00Z",
      startedAtUtc: "2026-05-10T01:00:00Z",
    });
    const model = buildTimelinePageModel(clientWith([running, paused]), TZ);
    const rows = model.days[0].rows;
    expect(rows.find((r) => r.startUtc === running.startedAtUtc)?.running).toBe(true);
    expect(rows.find((r) => r.startUtc === running.startedAtUtc)?.paused).toBe(false);
    expect(rows.find((r) => r.startUtc === paused.startedAtUtc)?.running).toBe(true);
    expect(rows.find((r) => r.startUtc === paused.startedAtUtc)?.paused).toBe(true);
  });

  it("emits provenance label correctly for auto/manual + edited combinations", () => {
    const auto = ev({ createdAutomatically: true, manuallyEdited: false });
    const autoEdited = ev({ createdAutomatically: true, manuallyEdited: true, startedAtUtc: "2026-05-10T01:00:00Z", endedAtUtc: "2026-05-10T01:30:00Z" });
    const manual = ev({ createdAutomatically: false, manuallyEdited: false, startedAtUtc: "2026-05-10T02:00:00Z", endedAtUtc: "2026-05-10T02:30:00Z" });
    const model = buildTimelinePageModel(clientWith([auto, autoEdited, manual]), TZ);
    const provs = model.days[0].rows.map((r) => r.provenance);
    expect(provs).toContain("auto");
    expect(provs).toContain("auto, edited");
    expect(provs).toContain("manual");
  });

  it("includes referrer org when present", () => {
    const c = clientWith([]);
    c.administrative.referrer.org = "Medilaw";
    const model = buildTimelinePageModel(c, TZ);
    expect(model.referrerOrg).toBe("Medilaw");
  });

  it("derives clientName from identity (defensive when blank)", () => {
    const c = defaultClient();
    const model = buildTimelinePageModel(c, TZ);
    // defaultClient has empty firstName/lastName → fallback to "(unnamed)"
    expect(model.clientName).toBe("(unnamed)");
  });
});

describe("timelineFormatter — slugifyForFilename", () => {
  it("produces filename-safe slugs", () => {
    expect(slugifyForFilename("Jack Crane")).toBe("jack-crane");
    expect(slugifyForFilename("Dr. María José")).toBe("dr-mar-a-jos");
    expect(slugifyForFilename("")).toBe("client");
    expect(slugifyForFilename("////")).toBe("client");
    expect(slugifyForFilename("multiple   spaces")).toBe("multiple-spaces");
  });
});
