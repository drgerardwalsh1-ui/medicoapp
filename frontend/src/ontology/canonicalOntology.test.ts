// ── Canonical concept registry — integrity tests ──────────────────────────────
// The registry is the cross-sectional sync backbone: a typo in any mapping
// (DSM, MSE link, PIRS) must fail CI, never silently drop a projection.

import { describe, expect, it } from "vitest";
import {
  CONCEPT_REGISTRY,
  validateConceptRegistry,
} from "./canonicalOntology";

describe("canonical concept registry", () => {
  it("all mappings reference known symptom entities (zero problems)", () => {
    expect(validateConceptRegistry()).toEqual([]);
  });

  it("contains the full known-entity vocabulary", () => {
    expect(CONCEPT_REGISTRY.size).toBeGreaterThan(250);
  });

  it("concentration_difficulty projects into every surface (sync backbone)", () => {
    const c = CONCEPT_REGISTRY.get("concentration_difficulty")!;
    expect(c).toBeDefined();
    expect(c.label).toBe("Concentration / memory");
    expect(c.currentSymptomsDomainIds).toContain("cognitive");
    expect(c.mseDomainIds).toContain("cognition");
    expect(c.dsmCriteria.map((r) => r.diagnosisId)).toEqual(
      expect.arrayContaining(["mdd", "pdd", "ptsd", "asd", "gad"]),
    );
    expect(c.pirsCategories).toEqual(["Concentration", "Adaptation"]);
  });

  it("concepts without a PIRS/MSE mapping project empty arrays, not undefined", () => {
    const c = CONCEPT_REGISTRY.get("delusions")!;
    expect(c).toBeDefined();
    expect(Array.isArray(c.pirsCategories)).toBe(true);
    expect(Array.isArray(c.mseDomainIds)).toBe(true);
  });
});
