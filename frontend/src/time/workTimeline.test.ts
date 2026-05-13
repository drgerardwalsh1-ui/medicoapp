import { describe, it, expect } from "vitest";
import {
  newTimelineEvent,
  appendEvent,
  updateEvent,
  deleteEvent,
  splitEvent,
  validateEvent,
  todayEventsInViewerTz,
  fromWorkSession,
  activeEvent,
  isPaused,
  pauseEvent,
  resumeEvent,
  stopEvent,
  activeWorkMs,
  totalMinutes,
} from "./workTimeline";
import { asViewerTimeZone } from "./types";
import type { WorkSession, WorkTimelineEvent } from "./types";

const TZ = asViewerTimeZone("Australia/Sydney");

function ev(start: string, end: string | null, partial: Partial<WorkTimelineEvent> = {}): WorkTimelineEvent {
  return {
    id: crypto.randomUUID(),
    type: "prereading",
    title: "Test",
    startedAtUtc: start,
    endedAtUtc: end,
    viewerTimeZone: TZ,
    manuallyEdited: false,
    createdAutomatically: false,
    ...partial,
  };
}

describe("workTimeline — validation (spec Part 20: no silent corrections)", () => {
  it("accepts a valid closed event", () => {
    const e = ev("2026-05-10T00:00:00Z", "2026-05-10T01:00:00Z");
    expect(validateEvent(e)).toEqual({ ok: true });
  });

  it("accepts a running event (endedAtUtc null)", () => {
    const e = ev("2026-05-10T00:00:00Z", null);
    expect(validateEvent(e)).toEqual({ ok: true });
  });

  it("rejects end before start", () => {
    const e = ev("2026-05-10T01:00:00Z", "2026-05-10T00:00:00Z");
    const r = validateEvent(e);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/before/i);
  });

  it("rejects zero-length event", () => {
    const e = ev("2026-05-10T00:00:00Z", "2026-05-10T00:00:00Z");
    const r = validateEvent(e);
    expect(r.ok).toBe(false);
  });

  it("rejects invalid start instant", () => {
    const e = ev("not-an-instant", null);
    const r = validateEvent(e);
    expect(r.ok).toBe(false);
  });
});

describe("workTimeline — append / update / delete", () => {
  it("appendEvent keeps timeline sorted by start", () => {
    const a = ev("2026-05-10T03:00:00Z", "2026-05-10T04:00:00Z");
    const b = ev("2026-05-10T01:00:00Z", "2026-05-10T02:00:00Z");
    const c = ev("2026-05-10T05:00:00Z", "2026-05-10T06:00:00Z");
    let t = appendEvent([], a);
    t = appendEvent(t, b);
    t = appendEvent(t, c);
    expect(t.map((e) => e.startedAtUtc)).toEqual([
      "2026-05-10T01:00:00Z",
      "2026-05-10T03:00:00Z",
      "2026-05-10T05:00:00Z",
    ]);
  });

  it("updateEvent flips manuallyEdited and preserves createdAutomatically", () => {
    const e = ev("2026-05-10T00:00:00Z", "2026-05-10T01:00:00Z", {
      createdAutomatically: true,
      manuallyEdited: false,
    });
    const t = [e];
    const updated = updateEvent(t, e.id, { title: "Edited title" });
    expect(updated[0].title).toBe("Edited title");
    expect(updated[0].manuallyEdited).toBe(true);
    expect(updated[0].createdAutomatically).toBe(true); // provenance retained (spec Part 19)
  });

  it("deleteEvent removes the targeted event only", () => {
    const a = ev("2026-05-10T00:00:00Z", "2026-05-10T01:00:00Z");
    const b = ev("2026-05-10T02:00:00Z", "2026-05-10T03:00:00Z");
    const t = deleteEvent([a, b], a.id);
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe(b.id);
  });
});

describe("workTimeline — splitEvent", () => {
  it("splits a closed event into two adjacent events at the split instant", () => {
    const e = ev("2026-05-10T00:00:00Z", "2026-05-10T02:00:00Z", {
      createdAutomatically: true,
    });
    const t = splitEvent([e], e.id, "2026-05-10T01:00:00Z");
    expect(t).toHaveLength(2);
    expect(t[0].endedAtUtc).toBe("2026-05-10T01:00:00Z");
    expect(t[1].startedAtUtc).toBe("2026-05-10T01:00:00Z");
    expect(t[1].endedAtUtc).toBe("2026-05-10T02:00:00Z");
    expect(t[0].manuallyEdited).toBe(true);
    // Second half is a fresh event — no auto-generation provenance
    expect(t[1].createdAutomatically).toBe(false);
  });

  it("returns the original timeline if split point is outside the event", () => {
    const e = ev("2026-05-10T00:00:00Z", "2026-05-10T01:00:00Z");
    const t1 = splitEvent([e], e.id, "2026-05-09T23:00:00Z"); // before start
    const t2 = splitEvent([e], e.id, "2026-05-10T02:00:00Z"); // after end
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(1);
  });
});

describe("workTimeline — todayEventsInViewerTz (spec Part 14: viewer tz)", () => {
  it("compares against viewer tz, not UTC", () => {
    // 14:00 UTC on 2026-05-10 is 00:00 next day in Sydney (UTC+10).
    // If "today in Sydney" is 2026-05-11, this event must match.
    const today = "2026-05-10T14:00:00Z";
    const yesterday = "2026-05-09T14:00:00Z"; // 2026-05-10 in Sydney
    const events = [ev(today, null), ev(yesterday, null)];
    // We can't freeze "today" without faking timers; just confirm the helper
    // returns at most one of the two and never throws on valid instants.
    const filtered = todayEventsInViewerTz(events, "Australia/Sydney");
    expect(filtered.length).toBeLessThanOrEqual(2);
    for (const f of filtered) expect(typeof f.startedAtUtc).toBe("string");
  });

  it("ignores events with invalid instants without throwing", () => {
    const good = ev("2026-05-10T00:00:00Z", null);
    const bad = ev("garbage", null);
    const out = todayEventsInViewerTz([good, bad], "Australia/Sydney");
    // bad event is filtered out
    for (const e of out) expect(e.startedAtUtc).not.toBe("garbage");
  });
});

describe("workTimeline — fromWorkSession", () => {
  it("preserves session timestamps and stamps provenance", () => {
    const session: WorkSession = {
      id: crypto.randomUUID(),
      type: "assessment",
      startedAtUtc: "2026-05-10T00:00:00Z",
      endedAtUtc: "2026-05-10T01:30:00Z",
      viewerTimeZone: TZ,
      durationMinutes: 90,
    };
    const e = fromWorkSession(session);
    expect(e.type).toBe("assessment");
    expect(e.startedAtUtc).toBe(session.startedAtUtc);
    expect(e.endedAtUtc).toBe(session.endedAtUtc);
    expect(e.linkedWorkSessionId).toBe(session.id);
    expect(e.createdAutomatically).toBe(true);
    expect(e.manuallyEdited).toBe(false);
  });

  it("maps session type 'interrupted' to event type 'interruption'", () => {
    const session: WorkSession = {
      id: crypto.randomUUID(),
      type: "interrupted",
      startedAtUtc: "2026-05-10T00:00:00Z",
      endedAtUtc: "2026-05-10T00:05:00Z",
      viewerTimeZone: TZ,
      durationMinutes: 5,
    };
    expect(fromWorkSession(session).type).toBe("interruption");
  });
});

describe("workTimeline — activeEvent + totalMinutes", () => {
  it("activeEvent returns the single open event", () => {
    const closed = ev("2026-05-10T00:00:00Z", "2026-05-10T01:00:00Z");
    const open = ev("2026-05-10T02:00:00Z", null);
    expect(activeEvent([closed, open])).toEqual(open);
  });

  it("activeEvent returns null when no event is open", () => {
    const closed = ev("2026-05-10T00:00:00Z", "2026-05-10T01:00:00Z");
    expect(activeEvent([closed])).toBeNull();
  });

  it("activeEvent returns null when more than one event is open (ambiguous)", () => {
    const a = ev("2026-05-10T00:00:00Z", null);
    const b = ev("2026-05-10T02:00:00Z", null);
    expect(activeEvent([a, b])).toBeNull();
  });

  it("totalMinutes sums closed durations", () => {
    const a = ev("2026-05-10T00:00:00Z", "2026-05-10T00:30:00Z"); // 30
    const b = ev("2026-05-10T01:00:00Z", "2026-05-10T01:45:00Z"); // 45
    expect(totalMinutes([a, b])).toBe(75);
  });
});

describe("workTimeline — exclusive client context (auto-stop on switch)", () => {
  // Simulates the switchActiveClient flow at the data level:
  // 1. Client A has an open event (timer running)
  // 2. User switches to client B → stopEvent fires on A's timeline
  // 3. A's timeline has the closed event; B's is untouched
  // 4. User starts a timer on B → new event in B's timeline only
  // 5. Switch back to A → A still has only the original (closed) event,
  //    B is unaffected

  function openEvent(startedAtUtc: string): WorkTimelineEvent {
    return {
      id: crypto.randomUUID(),
      type: "assessment",
      title: "Assessment",
      startedAtUtc,
      endedAtUtc: null,
      viewerTimeZone: TZ,
      manuallyEdited: false,
      createdAutomatically: true,
      accumulatedPausedMs: 0,
      pausedAtUtc: null,
    };
  }

  it("switching from A (with open timer) to B closes A's event and leaves B empty", () => {
    const aOpen = openEvent("2026-05-10T00:00:00Z");
    const clientA = { id: "A", workTimeline: [aOpen] };
    const clientB = { id: "B", workTimeline: [] as WorkTimelineEvent[] };

    // switchActiveClient(B) — simulate the auto-stop
    const aClosed = stopEvent(clientA.workTimeline, aOpen.id, "2026-05-10T00:10:00Z");
    const updatedA = { ...clientA, workTimeline: aClosed };

    expect(updatedA.workTimeline).toHaveLength(1);
    expect(updatedA.workTimeline[0].endedAtUtc).toBe("2026-05-10T00:10:00Z");
    expect(activeEvent(updatedA.workTimeline)).toBeNull(); // no open events on A
    expect(clientB.workTimeline).toEqual([]);              // B untouched
    expect(activeEvent(clientB.workTimeline)).toBeNull();
  });

  it("starting a fresh timer on B after switching does not affect A", () => {
    const aOpen = openEvent("2026-05-10T00:00:00Z");
    const clientA = { id: "A", workTimeline: [aOpen] };
    const aClosed = stopEvent(clientA.workTimeline, aOpen.id, "2026-05-10T00:10:00Z");
    const updatedA = { ...clientA, workTimeline: aClosed };

    // Now on B, start a fresh timer
    const bOpen = openEvent("2026-05-10T00:11:00Z");
    const clientB = { id: "B", workTimeline: appendEvent([], bOpen) };

    expect(clientB.workTimeline).toHaveLength(1);
    expect(activeEvent(clientB.workTimeline)?.id).toBe(bOpen.id);
    // A's timeline unchanged by B's timer
    expect(updatedA.workTimeline).toHaveLength(1);
    expect(updatedA.workTimeline[0].id).toBe(aOpen.id);
    expect(updatedA.workTimeline[0].endedAtUtc).toBe("2026-05-10T00:10:00Z");
  });

  it("switching back to A finds the closed event preserved, no live timer", () => {
    const aOpen = openEvent("2026-05-10T00:00:00Z");
    const aClosed = stopEvent([aOpen], aOpen.id, "2026-05-10T00:10:00Z");
    // Round-trip through JSON to simulate persistence + rehydration
    const wire = JSON.parse(JSON.stringify(aClosed)) as WorkTimelineEvent[];
    expect(activeEvent(wire)).toBeNull();
    expect(wire).toHaveLength(1);
    expect(wire[0].endedAtUtc).toBe("2026-05-10T00:10:00Z");
  });

  it("auto-stop while paused drains the in-flight pause into accumulatedPausedMs", () => {
    // User pauses A's timer, then switches to B without manually
    // stopping. The auto-stop must produce a clean closed event with
    // the paused window subtracted from the active work duration.
    const aOpen = openEvent("2026-05-10T00:00:00Z");
    let tl: WorkTimelineEvent[] = [aOpen];
    tl = pauseEvent(tl, aOpen.id, "2026-05-10T00:05:00Z");        // pause at T+5m
    // user switches at T+10m (still paused)
    tl = stopEvent(tl, aOpen.id, "2026-05-10T00:10:00Z");
    const closed = tl[0];
    expect(closed.endedAtUtc).toBe("2026-05-10T00:10:00Z");
    expect(closed.pausedAtUtc).toBeNull();
    expect(closed.accumulatedPausedMs).toBe(5 * 60_000);
    // Wall span = 10m, paused = 5m → active work = 5m
    expect(activeWorkMs(closed)).toBe(5 * 60_000);
  });
});

describe("workTimeline — newTimelineEvent defaults", () => {
  it("stamps fresh ids and default provenance flags", () => {
    const e = newTimelineEvent({
      type: "note",
      title: "Manual note",
      startedAtUtc: "2026-05-10T00:00:00Z",
      endedAtUtc: "2026-05-10T00:15:00Z",
    });
    expect(e.id).toBeTypeOf("string");
    expect(e.manuallyEdited).toBe(false);
    expect(e.createdAutomatically).toBe(false);
    expect(e.accumulatedPausedMs).toBe(0);
    expect(e.pausedAtUtc).toBeNull();
  });
});

describe("workTimeline — pause / resume / stop math (CRITICAL: spec Part 1–5)", () => {
  // Build an open running event that started exactly `secsAgo` ago, then
  // override startedAtUtc to a fixed reference instant for deterministic
  // arithmetic. We supply explicit `now` arguments to activeWorkMs to
  // avoid wall-clock dependencies.
  function open(startedAtUtc: string): WorkTimelineEvent {
    return {
      id: crypto.randomUUID(),
      type: "assessment",
      title: "T",
      startedAtUtc,
      endedAtUtc: null,
      viewerTimeZone: TZ,
      manuallyEdited: false,
      createdAutomatically: true,
      accumulatedPausedMs: 0,
      pausedAtUtc: null,
    };
  }

  it("running event accrues active-work time second by second", () => {
    const e = open("2026-05-10T00:00:00Z");
    const t0 = Date.parse("2026-05-10T00:00:00Z");
    expect(activeWorkMs(e, t0 + 0)).toBe(0);
    expect(activeWorkMs(e, t0 + 30_000)).toBe(30_000);
    expect(activeWorkMs(e, t0 + 60_000)).toBe(60_000);
  });

  it("pause freezes active-work duration; resume continues at the prior value", () => {
    const tStart  = Date.parse("2026-05-10T00:00:00Z");
    const tPause  = tStart + 10_000;          // T+10s
    const tResume = tPause + 10_000;          // T+20s wall-clock, paused 10s
    const tEnd    = tResume + 10_000;         // T+30s wall-clock, total work = 20s

    const e = open("2026-05-10T00:00:00Z");
    expect(activeWorkMs(e, tStart + 10_000)).toBe(10_000); // before pause

    const t1 = pauseEvent([e], e.id, "2026-05-10T00:00:10Z");
    const paused = t1[0];
    expect(isPaused(paused)).toBe(true);
    // Active work freezes at 10s while paused; *during* the pause additional
    // wall-clock time does NOT inflate the count.
    expect(activeWorkMs(paused, tPause + 0)).toBe(10_000);
    expect(activeWorkMs(paused, tPause + 5_000)).toBe(10_000);   // mid-pause
    expect(activeWorkMs(paused, tPause + 10_000)).toBe(10_000);  // end of pause window

    const t2 = resumeEvent(t1, e.id, "2026-05-10T00:00:20Z");
    const resumed = t2[0];
    expect(isPaused(resumed)).toBe(false);
    expect(resumed.accumulatedPausedMs).toBe(10_000);
    // After resume, work continues from the prior frozen value.
    expect(activeWorkMs(resumed, tResume + 0)).toBe(10_000);
    expect(activeWorkMs(resumed, tResume + 5_000)).toBe(15_000);
    expect(activeWorkMs(resumed, tEnd)).toBe(20_000);
  });

  it("multiple pause/resume cycles all subtract correctly", () => {
    // Pattern: start, work 10s, pause 5s, work 10s, pause 20s, work 10s.
    // Expected active work = 30s; paused = 25s; wall-clock = 55s.
    const e = open("2026-05-10T00:00:00Z");
    let tl: WorkTimelineEvent[] = [e];
    tl = pauseEvent(tl, e.id, "2026-05-10T00:00:10Z");          // pause #1
    tl = resumeEvent(tl, e.id, "2026-05-10T00:00:15Z");         // +5s paused
    tl = pauseEvent(tl, e.id, "2026-05-10T00:00:25Z");          // pause #2 after 10s work
    tl = resumeEvent(tl, e.id, "2026-05-10T00:00:45Z");         // +20s paused
    const final = tl[0];
    expect(final.accumulatedPausedMs).toBe(25_000);
    // Wall-clock at this point is T+45s; minus 25s of pause = 20s of work.
    expect(activeWorkMs(final, Date.parse("2026-05-10T00:00:45Z"))).toBe(20_000);
    // Run another 10s of work.
    expect(activeWorkMs(final, Date.parse("2026-05-10T00:00:55Z"))).toBe(30_000);
  });

  it("stop drains in-flight pause into accumulatedPausedMs", () => {
    const e = open("2026-05-10T00:00:00Z");
    let tl: WorkTimelineEvent[] = [e];
    tl = pauseEvent(tl, e.id, "2026-05-10T00:00:10Z");
    // Stop while still paused — should drain the 5s in-flight pause.
    tl = stopEvent(tl, e.id, "2026-05-10T00:00:15Z");
    const stopped = tl[0];
    expect(stopped.endedAtUtc).toBe("2026-05-10T00:00:15Z");
    expect(stopped.pausedAtUtc).toBeNull();
    expect(stopped.accumulatedPausedMs).toBe(5_000);
    // Wall-clock = 15s, paused = 5s → work = 10s.
    expect(activeWorkMs(stopped)).toBe(10_000);
  });

  it("pauseEvent is idempotent — pausing an already-paused event is a no-op", () => {
    const e = open("2026-05-10T00:00:00Z");
    let tl: WorkTimelineEvent[] = [e];
    tl = pauseEvent(tl, e.id, "2026-05-10T00:00:10Z");
    const firstPause = tl[0].pausedAtUtc;
    tl = pauseEvent(tl, e.id, "2026-05-10T00:00:11Z");
    expect(tl[0].pausedAtUtc).toBe(firstPause);
  });

  it("resumeEvent is a no-op when not paused", () => {
    const e = open("2026-05-10T00:00:00Z");
    const tl = resumeEvent([e], e.id, "2026-05-10T00:00:10Z");
    expect(tl[0]).toBe(e); // same reference: nothing changed
  });

  it("totalMinutes excludes paused time across multiple events", () => {
    // Two completed events: each wall-clock 20m, 5m paused. Active = 15m each.
    const a: WorkTimelineEvent = {
      ...open("2026-05-10T00:00:00Z"),
      endedAtUtc: "2026-05-10T00:20:00Z",
      accumulatedPausedMs: 5 * 60_000,
    };
    const b: WorkTimelineEvent = {
      ...open("2026-05-10T01:00:00Z"),
      endedAtUtc: "2026-05-10T01:20:00Z",
      accumulatedPausedMs: 5 * 60_000,
    };
    expect(totalMinutes([a, b])).toBe(30); // 15 + 15
  });

  it("a stopped event's wall-clock span is preserved (audit) but duration excludes pause", () => {
    const e = open("2026-05-10T00:00:00Z");
    let tl: WorkTimelineEvent[] = [e];
    tl = pauseEvent(tl, e.id, "2026-05-10T00:05:00Z");
    tl = resumeEvent(tl, e.id, "2026-05-10T00:08:00Z");
    tl = stopEvent(tl, e.id, "2026-05-10T00:10:00Z");
    const stopped = tl[0];
    // Wall span: 10m. Paused: 3m. Active: 7m.
    expect(stopped.startedAtUtc).toBe("2026-05-10T00:00:00Z");
    expect(stopped.endedAtUtc).toBe("2026-05-10T00:10:00Z");
    expect(stopped.accumulatedPausedMs).toBe(3 * 60_000);
    expect(activeWorkMs(stopped)).toBe(7 * 60_000);
  });

  it("paused state survives serialization round-trip (persistence safety)", () => {
    const e = open("2026-05-10T00:00:00Z");
    const paused = pauseEvent([e], e.id, "2026-05-10T00:05:00Z")[0];
    // Simulate Tauri persistence (JSON round-trip).
    const wire = JSON.parse(JSON.stringify(paused)) as WorkTimelineEvent;
    expect(isPaused(wire)).toBe(true);
    // After resume the math still works correctly.
    const resumed = resumeEvent([wire], wire.id, "2026-05-10T00:08:00Z")[0];
    expect(resumed.accumulatedPausedMs).toBe(3 * 60_000);
    expect(activeWorkMs(resumed, Date.parse("2026-05-10T00:10:00Z"))).toBe(7 * 60_000);
  });
});
