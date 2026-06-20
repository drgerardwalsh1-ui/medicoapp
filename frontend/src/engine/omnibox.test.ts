// ── Omnibox micro-grammar tests ────────────────────────────────────────────────
// Pins the capture grammar: clinical shorthand → structured proposal, fail
// closed on unrecognised concepts (never guess a symptom the clinician
// didn't type).

import { describe, expect, it } from "vitest";
import { parseOmniboxInput } from "./omnibox";

const REF = "2024-03-15";

describe("omnibox — concept matching", () => {
  it('"conc poor 3/12" → concentration_difficulty, 3 months', () => {
    const p = parseOmniboxInput("conc poor 3/12", REF)!;
    expect(p.symptomTypeId).toBe("concentration_difficulty");
    expect(p.durationCount).toBe("3");
    expect(p.durationUnit).toBe("months");
    expect(p.presence).toBe("present");
  });

  it("clinical abbreviations resolve (si → suicidal_ideation)", () => {
    expect(parseOmniboxInput("si", REF)!.symptomTypeId).toBe("suicidal_ideation");
  });

  it("unrecognised concepts propose nothing (fail closed)", () => {
    expect(parseOmniboxInput("zzqx florble", REF)).toBeNull();
    expect(parseOmniboxInput("", REF)).toBeNull();
    expect(parseOmniboxInput("severe 3/12", REF)).toBeNull(); // grammar only, no concept
  });

  it("offers ranked alternatives for ambiguous terms", () => {
    const p = parseOmniboxInput("fear", REF)!;
    expect(p.alternatives.length).toBeGreaterThan(0);
    expect(p.alternatives.every((a) => a.symptomTypeId !== p.symptomTypeId)).toBe(true);
  });
});

describe("omnibox — grammar fragments", () => {
  it("negation marks absence: 'no si' / 'denies anhedonia'", () => {
    expect(parseOmniboxInput("no si", REF)!.presence).toBe("absent");
    expect(parseOmniboxInput("denies anhed", REF)!.presence).toBe("absent");
  });

  it("severity words: 'panic severe', 'sleep mod'", () => {
    expect(parseOmniboxInput("panic attacks severe", REF)!.severity).toBe("severe");
    expect(parseOmniboxInput("sleep disturbance mod", REF)!.severity).toBe("moderate");
  });

  it("duration shorthand n/7 n/52 n/12 and word forms", () => {
    const w = parseOmniboxInput("flashbacks 2/52", REF)!;
    expect([w.durationCount, w.durationUnit]).toEqual(["2", "weeks"]);
    const m = parseOmniboxInput("flashbacks 6 months", REF)!;
    expect([m.durationCount, m.durationUnit]).toEqual(["6", "months"]);
    const c = parseOmniboxInput("flashbacks 2w", REF)!;
    expect([c.durationCount, c.durationUnit]).toEqual(["2", "weeks"]);
  });

  it("frequency: '2x week', 'nightly'", () => {
    const f = parseOmniboxInput("panic attacks 2x week", REF)!;
    expect([f.frequencyCount, f.frequencyUnit]).toEqual(["2", "week"]);
    const n = parseOmniboxInput("nightmares nightly", REF)!;
    expect([n.frequencyCount, n.frequencyUnit]).toEqual(["7", "week"]);
    expect(n.symptomTypeId).toBe("trauma_dreams");
  });

  it("onset: 'since 2023' and 'since mva' → reference injury date", () => {
    expect(parseOmniboxInput("dep since 2023", REF)!.onset).toBe("2023");
    expect(parseOmniboxInput("dep since mva", REF)!.onset).toBe(REF);
    expect(parseOmniboxInput("dep since mva")!.onset).toBeUndefined(); // no ref date — stays unset
  });

  it("full compound line parses every fragment", () => {
    const p = parseOmniboxInput("no sleep disturbance severe 3/12 since mva", REF)!;
    expect(p.symptomTypeId).toBe("sleep_disturbance");
    expect(p.presence).toBe("absent");
    expect(p.severity).toBe("severe");
    expect([p.durationCount, p.durationUnit]).toEqual(["3", "months"]);
    expect(p.onset).toBe(REF);
  });
});
