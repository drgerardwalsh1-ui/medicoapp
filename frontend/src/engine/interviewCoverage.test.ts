// ── Interview coverage tests ───────────────────────────────────────────────────
// Pins the "template is the interview" semantics: coverage derives from the
// canonical observation log (a fact captured anywhere ticks the right probe),
// "not asked" is a visible state, and built-in templates reference only real
// domains and gate PIRS by matter type.

import { describe, expect, it } from "vitest";
import type { Observation } from "../types/observation";
import type { ObservationId, SymptomTypeId, Frame } from "../types/ontology";
import { BUILTIN_TEMPLATES } from "../data/interviewTemplates";
import {
  computeCoverage,
  domainProbes,
  uncoveredItems,
} from "./interviewCoverage";
import { SYMPTOM_DOMAINS } from "../data/symptomDomains";

const MVA = BUILTIN_TEMPLATES.find((t) => t.id === "builtin-mva-threshold-wpi")!;

function obs(
  id: string,
  symptomTypeId: string,
  presence: Observation["presence"],
  overrides: Partial<Observation> = {},
): Observation {
  return {
    id: id as ObservationId,
    symptomTypeId: symptomTypeId as SymptomTypeId,
    frame: "subjective" as Frame,
    presence,
    provenance: { clinicianId: "dr", at: "2026-06-13T00:00:00Z", entrySource: "chip" },
    ...overrides,
  };
}

describe("built-in templates", () => {
  it("every symptomDomain section references a real domain with probes", () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const s of t.sections) {
        if (s.kind !== "symptomDomain") continue;
        expect(
          SYMPTOM_DOMAINS.some((d) => d.id === s.domainId),
          `${t.id} → ${s.id} references unknown domain "${s.domainId}"`,
        ).toBe(true);
        expect(domainProbes(s).length, `${t.id} → ${s.id} has no probes`).toBeGreaterThan(0);
      }
    }
  });

  it("built-ins carry no MSE or PIRS sections (clinician feedback 2026-06-13)", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(
        t.sections.some((s) => s.kind === "mse" || s.kind === "pirs"),
        `${t.id} must not include MSE/PIRS sections`,
      ).toBe(false);
    }
  });

  it("MVA template opens symptom coverage with Mood, Anxiety, PTSD (the clinician's routine)", () => {
    const domains = MVA.sections.filter((s) => s.kind === "symptomDomain").map((s) => s.domainId);
    expect(domains.slice(0, 3)).toEqual(["mood", "anxiety", "trauma"]);
  });
});

describe("coverage computation", () => {
  it("a fact captured anywhere ticks the right probe; denial counts as covered", () => {
    const coverage = computeCoverage(
      MVA,
      [obs("o1", "depressed_mood", "present"), obs("o2", "suicidal_ideation", "absent")],
      new Set(),
    );
    const mood = coverage.find((c) => c.section.id === "sx-mood")!;
    expect(mood.probes.find((p) => p.symptomTypeId === "depressed_mood")!.state).toBe("present");
    expect(mood.touched).toBeGreaterThanOrEqual(1);
    const risk = coverage.find((c) => c.section.id === "sx-risk")!;
    expect(risk.probes.find((p) => p.symptomTypeId === "suicidal_ideation")!.state).toBe("absent");
  });

  it("untouched probes are not_asked and appear in the audit", () => {
    const coverage = computeCoverage(MVA, [], new Set());
    const mood = coverage.find((c) => c.section.id === "sx-mood")!;
    expect(mood.probes.every((p) => p.state === "not_asked")).toBe(true);
    const audit = uncoveredItems(coverage);
    expect(audit.some((i) => i.startsWith("Mood:"))).toBe(true);
    expect(audit).toContain("Past psychiatric history");
  });

  it("tombstoned and edited observations follow append-only semantics", () => {
    const coverage = computeCoverage(
      MVA,
      [
        obs("o1", "depressed_mood", "present"),
        obs("o1", "depressed_mood", "present", { tombstoned: true }), // removed
        obs("o2", "anhedonia", "present"),
        obs("o2", "anhedonia", "absent"), // edited to denied
      ],
      new Set(),
    );
    const mood = coverage.find((c) => c.section.id === "sx-mood")!;
    expect(mood.probes.find((p) => p.symptomTypeId === "depressed_mood")!.state).toBe("not_asked");
    expect(mood.probes.find((p) => p.symptomTypeId === "anhedonia")!.state).toBe("absent");
  });

  it("narrative/MSE/PIRS sections are covered by manual tick", () => {
    const before = computeCoverage(MVA, [], new Set());
    expect(before.find((c) => c.section.id === "circumstances")!.complete).toBe(false);
    const after = computeCoverage(MVA, [], new Set(["circumstances"]));
    expect(after.find((c) => c.section.id === "circumstances")!.complete).toBe(true);
  });

  it("observed-frame facts never tick subjective probes (reported ≠ observed)", () => {
    const coverage = computeCoverage(
      MVA,
      [obs("o1", "depressed_mood", "present", { frame: "observed" as Frame })],
      new Set(),
    );
    const mood = coverage.find((c) => c.section.id === "sx-mood")!;
    expect(mood.probes.find((p) => p.symptomTypeId === "depressed_mood")!.state).toBe("not_asked");
  });
});
