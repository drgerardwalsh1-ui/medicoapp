// ── PIRS (NSW) rule-pack golden tests ─────────────────────────────────────────
// Pins EVERY cell of the aggregate→%WPI conversion matrix to the
// clinician-verified values. The EXPECTED matrix below is an independent
// transcription — if pirsNswRules.ts and this file ever disagree, the build
// fails and a human must decide which transcription is wrong. Values are
// immutable clinical rule data: changes require clinician sign-off and a
// rule-pack version bump.

import { describe, expect, it } from "vitest";
import {
  CATEGORY_COUNT,
  MIN_AGGREGATE,
  NOT_ASSESSABLE,
  PIRS_RULE_PACK,
  TREATMENT_EFFECT_TEXT,
  WPI_CONVERSION,
  wpiFromMedianAndAggregate,
} from "./pirsNswRules";
import { calculatePIRS } from "../engine/pirsEngine";

// Independent golden transcription (clinician-verified 2026-06-13).
// -1 = not assessable for that median class.
const EXPECTED: Record<number, number[]> = {
  1: [0, 0, 1, 1, 2, 2, 2, 3, 3],
  2: [-1, -1, -1, 4, 5, 5, 6, 7, 7, 8, 9, 9, 10, 10],
  3: [-1, -1, -1, -1, -1, -1, -1, 11, 13, 15, 17, 19, 22, 24, 26, 28, 30],
  4: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 31, 34, 37, 41, 44, 47, 50, 54, 57, 60],
  5: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 66, 65, 70, 74, 78, 83, 87, 91, 96, 100],
};

describe("PIRS NSW rule pack — conversion matrix (golden, cell-by-cell)", () => {
  it("matches the clinician-verified matrix exactly", () => {
    expect(Object.keys(WPI_CONVERSION).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const median of [1, 2, 3, 4, 5]) {
      expect(WPI_CONVERSION[median], `median class ${median} row`).toEqual(EXPECTED[median]);
    }
  });

  it("wpiFromMedianAndAggregate returns every defined cell verbatim", () => {
    for (const median of [1, 2, 3, 4, 5]) {
      const row = EXPECTED[median];
      for (let i = 0; i < row.length; i++) {
        const aggregate = MIN_AGGREGATE + i;
        const expected = row[i] === NOT_ASSESSABLE ? 0 : row[i];
        expect(
          wpiFromMedianAndAggregate(median, aggregate),
          `median ${median}, aggregate ${aggregate}`,
        ).toBe(expected);
      }
    }
  });

  it("median class 5, aggregate 21 → 66% (clinician-verified; NOT a typo)", () => {
    expect(wpiFromMedianAndAggregate(5, 21)).toBe(66);
  });

  it("returns 0 outside the defined table", () => {
    expect(wpiFromMedianAndAggregate(1, 15)).toBe(0); // beyond class-1 row
    expect(wpiFromMedianAndAggregate(1, 5)).toBe(0); // below MIN_AGGREGATE
    expect(wpiFromMedianAndAggregate(6, 12)).toBe(0); // no such median class
    expect(wpiFromMedianAndAggregate(2, 6)).toBe(0); // NOT_ASSESSABLE cell
  });

  it("rule-pack metadata is pinned", () => {
    expect(PIRS_RULE_PACK).toEqual({
      id: "pirs-nsw",
      version: "1.0.0",
      verifiedBy: "clinician",
      verifiedDate: "2026-06-13",
    });
    expect(CATEGORY_COUNT).toBe(6);
    expect(TREATMENT_EFFECT_TEXT).toEqual({
      0: "minimal or no",
      1: "mild",
      2: "moderate",
      3: "good",
    });
  });
});

describe("calculatePIRS — end-to-end against the rule pack", () => {
  const base = { id: "t", name: "PIRS", reasons: [] };

  it("computes the documented worked example (median 2)", () => {
    // classes 2,2,2,2,2,2 → total 12, median 2 → initial WPI 6%.
    // 10% pre-existing of 6% = 0.6 → rounds to 1%. Treatment +2%. Final 7%.
    const r = calculatePIRS({ ...base, classes: [2, 2, 2, 2, 2, 2], preExisting: 10, treatmentEffect: 2 });
    expect(r.total).toBe(12);
    expect(r.median).toBe(2);
    expect(r.initWPI).toBe(6);
    expect(r.preAdj).toBe(1);
    expect(r.treat).toBe(2);
    expect(r.final).toBe(7);
  });

  it("median between classes rounds 0.5 up (1,1,2,3,5,5 → median 3)", () => {
    // sorted 3rd/4th = 2,3 → 2.5 → median 3; total 17 → class-3 row, 19%.
    const r = calculatePIRS({ ...base, classes: [1, 1, 2, 3, 5, 5], preExisting: 0, treatmentEffect: 0 });
    expect(r.median).toBe(3);
    expect(r.initWPI).toBe(19);
    expect(r.final).toBe(19);
  });

  it("clamps classes to 1–5 and treatment to 0–3", () => {
    const r = calculatePIRS({ ...base, classes: [0, 7, 2, 2, 2, 2], preExisting: 0, treatmentEffect: 9 });
    expect(r.classes).toEqual([1, 5, 2, 2, 2, 2]);
    expect(r.treat).toBe(3);
  });

  it("class-5 ceiling: 5,5,5,5,5,5 → aggregate 30 → 100%", () => {
    const r = calculatePIRS({ ...base, classes: [5, 5, 5, 5, 5, 5], preExisting: 0, treatmentEffect: 0 });
    expect(r.median).toBe(5);
    expect(r.initWPI).toBe(100);
  });

  it("pre-existing deduction uses standard rounding (0.5 up) of percentage-of-initial", () => {
    // classes 3,3,3,3,3,3 → total 18, median 3 → 22%. 25% of 22 = 5.5 → 6.
    const r = calculatePIRS({ ...base, classes: [3, 3, 3, 3, 3, 3], preExisting: 25, treatmentEffect: 0 });
    expect(r.initWPI).toBe(22);
    expect(r.preAdj).toBe(6);
    expect(r.final).toBe(16);
  });
});
