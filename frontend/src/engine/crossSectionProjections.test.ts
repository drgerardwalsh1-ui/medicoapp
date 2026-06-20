// ── Cross-sectional projection tests ──────────────────────────────────────────
// Pins the Phase 1 exit criterion: a symptom captured ONCE appears on every
// surface its concept declares — Current Symptoms, MSE, DSM evidence, PIRS —
// with the reported/observed distinction preserved and epochs derived (never
// re-entered) from the reference injury date.

import { describe, expect, it } from "vitest";
import type { Observation } from "../types/observation";
import type { ObservationId, SymptomTypeId, Frame } from "../types/ontology";
import {
  classifyEpoch,
  projectCurrentSymptoms,
  projectDSMEvidence,
  projectMSE,
  projectPIRSEvidence,
} from "./crossSectionProjections";

const REF_INJURY = "2024-03-15";

function obs(
  id: string,
  symptomTypeId: string,
  frame: Frame,
  overrides: Partial<Observation> = {},
): Observation {
  return {
    id: id as ObservationId,
    symptomTypeId: symptomTypeId as SymptomTypeId,
    frame,
    presence: "present",
    provenance: { clinicianId: "dr", at: "2026-06-13T00:00:00Z", entrySource: "chip" },
    ...overrides,
  };
}

describe("epoch classification (derived, fail-closed)", () => {
  it("classifies onset relative to the reference injury date", () => {
    expect(classifyEpoch("2023-01-10", REF_INJURY)).toBe("pre_injury");
    expect(classifyEpoch("2024-06-01", REF_INJURY)).toBe("post_injury");
  });

  it("compares partial dates at the coarser precision", () => {
    expect(classifyEpoch("2023", REF_INJURY)).toBe("pre_injury");
    expect(classifyEpoch("2025", REF_INJURY)).toBe("post_injury");
    expect(classifyEpoch("2024-02", REF_INJURY)).toBe("pre_injury");
  });

  it("ambiguity fails closed to undetermined; missing dates are undated", () => {
    expect(classifyEpoch("2024", REF_INJURY)).toBe("undetermined"); // same year, month unknown
    expect(classifyEpoch("2024-03", REF_INJURY)).toBe("undetermined");
    expect(classifyEpoch(undefined, REF_INJURY)).toBe("undated");
    expect(classifyEpoch("2024-01-01", undefined)).toBe("undated");
  });

  it("onset ON the injury date (full precision) is post-injury — 'since the accident'", () => {
    expect(classifyEpoch(REF_INJURY, REF_INJURY)).toBe("post_injury");
  });
});

describe("exit criterion — one fact, every surface", () => {
  // Single capture: client reports impaired concentration since the accident.
  const single = [
    obs("o1", "concentration_difficulty", "subjective", { onset: "2024-05" }),
  ];

  it("appears in Current Symptoms (reported frame)", () => {
    const rows = projectCurrentSymptoms(single, REF_INJURY);
    expect(rows).toHaveLength(1);
    expect(rows[0].symptomTypeId).toBe("concentration_difficulty");
    expect(rows[0].reported?.frame).toBe("subjective");
    expect(rows[0].domainIds).toContain("cognitive");
  });

  it("appears in the MSE cognition domain as the reported counterpart", () => {
    const domains = projectMSE(single, REF_INJURY);
    const cognition = domains.find((d) => d.domainId === "cognition");
    expect(cognition).toBeDefined();
    const item = cognition!.items.find(
      (i) => i.symptomTypeId === "concentration_difficulty",
    )!;
    expect(item.reported).toBeDefined();
    expect(item.observed).toBeUndefined(); // nothing observed yet — never inferred
    expect(item.discrepancy).toBe(false);
  });

  it("appears as candidate evidence on every mapped DSM criterion", () => {
    const evidence = projectDSMEvidence(single, REF_INJURY);
    const pairs = evidence.map((e) => `${e.diagnosisId}|${e.criterionId}`);
    expect(pairs).toEqual(
      expect.arrayContaining(["mdd|A", "pdd|B", "ptsd|E", "asd|B", "gad|C"]),
    );
    for (const e of evidence) {
      expect(e.facts[0].observationId).toBe("o1");
    }
  });

  it("appears in the PIRS Concentration and Adaptation worksheets, post-injury", () => {
    const pirs = projectPIRSEvidence(single, REF_INJURY);
    const concentration = pirs.find((p) => p.category === "Concentration")!;
    const adaptation = pirs.find((p) => p.category === "Adaptation")!;
    expect(concentration.postInjury.map((f) => f.observationId)).toEqual(["o1"]);
    expect(adaptation.postInjury.map((f) => f.observationId)).toEqual(["o1"]);
    expect(concentration.preInjury).toEqual([]);
  });
});

describe("reported ≠ observed", () => {
  it("MSE pairs the frames and flags a presence discrepancy", () => {
    const observations = [
      obs("o1", "concentration_difficulty", "subjective"), // client reports impairment
      obs("o2", "concentration_difficulty", "observed", { presence: "absent" }), // intact on testing
    ];
    const cognition = projectMSE(observations).find((d) => d.domainId === "cognition")!;
    const item = cognition.items.find(
      (i) => i.symptomTypeId === "concentration_difficulty",
    )!;
    expect(item.reported?.presence).toBe("present");
    expect(item.observed?.presence).toBe("absent");
    expect(item.discrepancy).toBe(true);
  });

  it("unknown presence never counts as a discrepancy", () => {
    const observations = [
      obs("o1", "concentration_difficulty", "subjective"),
      obs("o2", "concentration_difficulty", "observed", { presence: "unknown" }),
    ];
    const cognition = projectMSE(observations).find((d) => d.domainId === "cognition")!;
    expect(cognition.items[0].discrepancy).toBe(false);
  });

  it("observed-frame facts do not enter the Current Symptoms reported column", () => {
    const rows = projectCurrentSymptoms([
      obs("o2", "concentration_difficulty", "observed"),
    ]);
    expect(rows).toEqual([]); // observed-only concept: no reported row fabricated
  });
});

describe("pre/post epoch split in PIRS evidence", () => {
  it("splits pre-existing and post-injury facts; undated needs verification", () => {
    const observations = [
      obs("pre", "depressed_mood", "subjective", { onset: "2019-08" }),
      obs("post", "depressed_mood", "subjective", { onset: "2024-09" }),
      obs("nodate", "anhedonia", "subjective"),
    ];
    const pirs = projectPIRSEvidence(observations, REF_INJURY);
    const self = pirs.find((p) => p.category === "Self")!;
    expect(self.preInjury.map((f) => f.observationId)).toEqual(["pre"]);
    expect(self.postInjury.map((f) => f.observationId)).toEqual(["post"]);
    const rec = pirs.find((p) => p.category === "Recreational")!;
    expect(rec.unclassified.map((f) => f.observationId)).toEqual(["nodate"]);
  });
});

describe("hygiene", () => {
  it("tombstoned observations are excluded everywhere", () => {
    const observations = [
      obs("o1", "concentration_difficulty", "subjective", { tombstoned: true }),
    ];
    expect(projectCurrentSymptoms(observations)).toEqual([]);
    expect(projectDSMEvidence(observations)).toEqual([]);
    expect(
      projectPIRSEvidence(observations).every(
        (p) => p.preInjury.length + p.postInjury.length + p.unclassified.length === 0,
      ),
    ).toBe(true);
  });

  it("latest entry per (concept, frame) wins — append-only edit semantics", () => {
    const observations = [
      obs("o1", "concentration_difficulty", "subjective", { severity: "mild" }),
      obs("o1", "concentration_difficulty", "subjective", { severity: "severe" }),
    ];
    const rows = projectCurrentSymptoms(observations);
    expect(rows[0].reported?.severity).toBe("severe");
  });
});
