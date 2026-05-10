import { describe, it, expect } from "vitest";
import {
  topPxFromInstant,
  heightPxFromInstants,
  pixelsToInstantIso,
  viewerPlainDate,
  HOUR_HEIGHT,
  START_HOUR,
} from "./calendar";

describe("calendar positioning", () => {
  it("topPx places 09:00 viewer-tz at exactly 1 hour below START_HOUR", () => {
    // Sydney AEDT: 09:00 local on 2026-01-15 = 22:00 UTC on 2026-01-14.
    const expectedPx = (9 - START_HOUR) * HOUR_HEIGHT;
    expect(
      Math.round(topPxFromInstant("2026-01-14T22:00:00Z", "Australia/Sydney"))
    ).toBe(expectedPx);
  });

  it("topPx differs by 60px for the same instant viewed from Brisbane during DST", () => {
    // Sydney AEDT vs Brisbane AEST = 1 hour offset → 1 hour = HOUR_HEIGHT pixels.
    const sydneyPx = topPxFromInstant("2026-01-14T22:00:00Z", "Australia/Sydney");
    const brisbanePx = topPxFromInstant("2026-01-14T22:00:00Z", "Australia/Brisbane");
    expect(Math.round(sydneyPx - brisbanePx)).toBe(HOUR_HEIGHT);
  });

  it("topPx differs by 3 hours between Sydney AEDT and Perth AWST", () => {
    // Pick a UTC instant that lands inside the visible 08:00–19:00 window
    // for BOTH zones so neither result clamps to the floor.
    // 2026-01-15 03:00 UTC: Sydney AEDT = 14:00, Perth AWST = 11:00.
    const sydneyPx = topPxFromInstant("2026-01-15T03:00:00Z", "Australia/Sydney");
    const perthPx = topPxFromInstant("2026-01-15T03:00:00Z", "Australia/Perth");
    expect(Math.round(sydneyPx - perthPx)).toBe(HOUR_HEIGHT * 3);
  });

  it("heightPx is derived from absolute duration (viewer-tz independent)", () => {
    // No viewer-tz parameter — duration is the same in any zone.
    const px = heightPxFromInstants(
      "2026-01-14T22:00:00Z",
      "2026-01-14T23:30:00Z"
    );
    expect(px).toBe(HOUR_HEIGHT * 1.5);
  });

  it("pixelsToInstantIso round-trips with topPx", () => {
    const tz = "Australia/Sydney";
    const day = "2026-01-15";
    // 09:00 local on day → expected px = (9 - START_HOUR) * HOUR_HEIGHT.
    const px = (9 - START_HOUR) * HOUR_HEIGHT;
    const utc = pixelsToInstantIso(px, day, tz);
    expect(topPxFromInstant(utc, tz)).toBe(px);
  });

  it("pixelsToInstantIso snaps to nearest 15-minute boundary", () => {
    const tz = "Australia/Sydney";
    const day = "2026-01-15";
    // Off-grid: 09:23 (closer to 09:30 than 09:15) → should snap to 09:30.
    const px = (9 - START_HOUR) * HOUR_HEIGHT + (23 / 60) * HOUR_HEIGHT;
    const utc = pixelsToInstantIso(px, day, tz);
    // 09:30 Sydney AEDT = 22:30 UTC the day before.
    expect(utc).toBe("2026-01-14T22:30:00Z");
  });

  it("pixelsToInstantIso snaps DOWN when click is closer to the earlier boundary", () => {
    const tz = "Australia/Sydney";
    const day = "2026-01-15";
    // 09:07 is closer to 09:00 than to 09:15 → snap to 09:00.
    const px = (9 - START_HOUR) * HOUR_HEIGHT + (7 / 60) * HOUR_HEIGHT;
    const utc = pixelsToInstantIso(px, day, tz);
    // 09:00 Sydney AEDT = 22:00 UTC the day before.
    expect(utc).toBe("2026-01-14T22:00:00Z");
  });

  it("viewerPlainDate buckets late-evening UTC into next-day in NZ", () => {
    expect(
      viewerPlainDate("2026-01-14T11:30:00Z", "Pacific/Auckland")
    ).toBe("2026-01-15");
    expect(
      viewerPlainDate("2026-01-14T11:30:00Z", "Australia/Sydney")
    ).toBe("2026-01-14");
  });
});
