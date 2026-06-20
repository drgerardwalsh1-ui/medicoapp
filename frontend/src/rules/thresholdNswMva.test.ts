// ── NSW MVA threshold-injury rule-pack tests ──────────────────────────────────
// Pins the clinician-stated rule: adjustment disorder (adj) and acute stress
// disorder (asd) are THRESHOLD injuries; any other DSM-5 diagnosis is
// NON-THRESHOLD; unknown ids fail closed as UNRECOGNISED/INDETERMINATE.

import { describe, expect, it } from "vitest";
import { DSM5_DIAGNOSES } from "../data/dsm5";
import {
  THRESHOLD_DIAGNOSIS_IDS,
  THRESHOLD_RULE_PACK,
  classifyDiagnosis,
  determineCaseThreshold,
} from "./thresholdNswMva";

describe("threshold rule pack — diagnosis classification", () => {
  it("threshold set is exactly { adj, asd } and both exist in the DSM-5 registry", () => {
    expect([...THRESHOLD_DIAGNOSIS_IDS].sort()).toEqual(["adj", "asd"]);
    for (const id of THRESHOLD_DIAGNOSIS_IDS) {
      expect(
        DSM5_DIAGNOSES.some((d) => d.id === id),
        `threshold id "${id}" must exist in data/dsm5.ts`,
      ).toBe(true);
    }
  });

  it("adjustment disorder and acute stress disorder classify as THRESHOLD", () => {
    expect(classifyDiagnosis("adj")).toBe("THRESHOLD");
    expect(classifyDiagnosis("asd")).toBe("THRESHOLD");
  });

  it("every other registered DSM-5 diagnosis classifies as NON_THRESHOLD", () => {
    for (const d of DSM5_DIAGNOSES) {
      if (THRESHOLD_DIAGNOSIS_IDS.has(d.id)) continue;
      expect(classifyDiagnosis(d.id), `${d.id} (${d.name})`).toBe("NON_THRESHOLD");
    }
  });

  it("unknown ids fail closed as UNRECOGNISED", () => {
    expect(classifyDiagnosis("not_a_diagnosis")).toBe("UNRECOGNISED");
    expect(classifyDiagnosis("")).toBe("UNRECOGNISED");
  });
});

describe("threshold rule pack — case-level determination", () => {
  it("no diagnoses → NO_DIAGNOSIS", () => {
    expect(determineCaseThreshold([]).outcome).toBe("NO_DIAGNOSIS");
  });

  it("only threshold diagnoses → THRESHOLD_ONLY", () => {
    expect(determineCaseThreshold(["adj"]).outcome).toBe("THRESHOLD_ONLY");
    expect(determineCaseThreshold(["asd", "adj"]).outcome).toBe("THRESHOLD_ONLY");
  });

  it("any non-threshold DSM-5 diagnosis → NON_THRESHOLD, even alongside adj/asd", () => {
    expect(determineCaseThreshold(["ptsd"]).outcome).toBe("NON_THRESHOLD");
    expect(determineCaseThreshold(["adj", "mdd"]).outcome).toBe("NON_THRESHOLD");
  });

  it("an unrecognised id blocks determination → INDETERMINATE (fail closed)", () => {
    const r = determineCaseThreshold(["adj", "mystery_dx"]);
    expect(r.outcome).toBe("INDETERMINATE");
    expect(r.perDiagnosis).toEqual([
      { diagnosisId: "adj", classification: "THRESHOLD" },
      { diagnosisId: "mystery_dx", classification: "UNRECOGNISED" },
    ]);
  });

  it("rule-pack metadata is pinned", () => {
    expect(THRESHOLD_RULE_PACK).toEqual({ id: "threshold-nsw-mva", version: "1.0.0" });
  });
});
