import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prioritizeClinicalDisplay, type ClinicalPriorityView } from "./clinicalPrioritization";
import { buildReportSnapshotV2 } from "./clinicalDecision";
import { buildClinicalReplay } from "./clinicalReplay";
import { runClinicalOverlay } from "./clinicalBridge";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";

function mk(symptoms: Record<string, Partial<SymptomEntity>>): DSMAssessmentData {
  const out: Record<string, SymptomEntity> = {};
  for (const [id, s] of Object.entries(symptoms)) {
    out[id] = { id, symptomType: id, currentPresence: true, ...s };
  }
  return { symptoms: out, criterionAssessments: [], diagnosticInterpretations: [], timelineEvents: [] };
}
function pipeline(assessment: DSMAssessmentData) {
  const overlay = runClinicalOverlay(assessment);
  const snapshot = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, []);
  const replay = buildClinicalReplay(snapshot);
  return { overlay, snapshot, replay };
}
const find = (ps: readonly ClinicalPriorityView[], id: string) => ps.find((p) => p.diagnosisId === id);

describe("Phase 19 — clinical prioritization", () => {
  it("1. depressed_mood only → MDD foreground, PDD secondary, PDD retained in differential", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {} }));
    const ps = prioritizeClinicalDisplay(snapshot, replay);
    const pdd = find(ps, "pdd");
    const mdd = find(ps, "mdd");
    expect(pdd?.displayPriority).toBe("secondary");
    expect(pdd?.suppressFromPrimaryList).toBe(true);
    expect(pdd?.retainInDifferentials).toBe(true);
    expect(mdd?.displayPriority).toBe("foreground");
    // The demotion reason and the promotion reason are both surfaced.
    expect(pdd?.displayReason.some((r) => /Chronicity/.test(r))).toBe(true);
    expect(mdd?.displayReason.some((r) => /Acute framing/.test(r))).toBe(true);
  });

  it("2. PDD with explicit ≥2-year duration → PDD foreground allowed", () => {
    const { snapshot, replay } = pipeline(
      mk({ depressed_mood: { durationCount: "3", durationUnit: "years" } }),
    );
    const ps = prioritizeClinicalDisplay(snapshot, replay);
    const pdd = find(ps, "pdd");
    expect(pdd?.displayPriority).toBe("foreground");
    expect(pdd?.temporalStatus).toBe("temporally_supported");
    expect(pdd?.displayReason.some((r) => /Longitudinal support/.test(r))).toBe(true);
  });

  it("3. rule_out never foreground (bipolar features → MDD/PDD rule_out)", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {}, elevated_mood: {} }));
    const ps = prioritizeClinicalDisplay(snapshot, replay);
    const mdd = find(ps, "mdd");
    const pdd = find(ps, "pdd");
    expect(mdd?.semanticState).toBe("rule_out");
    expect(mdd?.displayPriority).not.toBe("foreground");
    expect(pdd?.semanticState).toBe("rule_out");
    expect(pdd?.displayPriority).not.toBe("foreground");
  });

  it("4. excluded → always background (PDD gate fails: no depressed_mood)", () => {
    const { snapshot, replay } = pipeline(mk({ anhedonia: {} })); // mdd anchor present, pdd gate fails
    const ps = prioritizeClinicalDisplay(snapshot, replay);
    const pdd = find(ps, "pdd");
    expect(pdd?.semanticState).toBe("excluded");
    expect(pdd?.displayPriority).toBe("background");
  });

  it("5. prioritization does not mutate the snapshot", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {} }));
    const before = JSON.stringify(snapshot);
    prioritizeClinicalDisplay(snapshot, replay);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("6. prioritization does not mutate the replay", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {} }));
    const before = JSON.stringify(replay);
    prioritizeClinicalDisplay(snapshot, replay);
    expect(JSON.stringify(replay)).toBe(before);
  });

  it("7. deterministic — same inputs yield identical output", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {}, anhedonia: {} }));
    expect(prioritizeClinicalDisplay(snapshot, replay)).toEqual(
      prioritizeClinicalDisplay(snapshot, replay),
    );
  });

  it("8. forensic drawer data (replay) unchanged after prioritization", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {} }));
    const replayCopy = JSON.parse(JSON.stringify(replay));
    prioritizeClinicalDisplay(snapshot, replay);
    expect(replay).toEqual(replayCopy);
  });

  it("9. no engine / bridge / scoring imports in clinicalPrioritization.ts", () => {
    const src = readFileSync(resolve(__dirname, "clinicalPrioritization.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\.\/engine\//);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalBridge["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalConstraints["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalTemporal["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalSemantics["']/);
  });

  it("10. differential preservation — any dx in a differential group is retained", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {} }));
    const ps = prioritizeClinicalDisplay(snapshot, replay);
    for (const s of snapshot.semanticStates) {
      if (!s.differentialGroup) continue;
      const item = find(ps, s.diagnosisId);
      expect(item?.retainInDifferentials).toBe(true);
    }
  });

  it("11. temporally_unknown chronic disorders are deprioritized from primary", () => {
    const { snapshot, replay } = pipeline(mk({ depressed_mood: {} }));
    const ps = prioritizeClinicalDisplay(snapshot, replay);
    const pdd = find(ps, "pdd");
    expect(pdd?.temporalStatus).toBe("temporally_unknown");
    expect(pdd?.displayPriority).not.toBe("foreground");
    expect(pdd?.suppressFromPrimaryList).toBe(true);
  });

  it("12. temporally_supported chronic disorders are promotable to foreground", () => {
    const { snapshot, replay } = pipeline(
      mk({ depressed_mood: { durationCount: "5", durationUnit: "years" } }),
    );
    const ps = prioritizeClinicalDisplay(snapshot, replay);
    const pdd = find(ps, "pdd");
    expect(pdd?.temporalStatus).toBe("temporally_supported");
    expect(pdd?.displayPriority).toBe("foreground");
    expect(pdd?.suppressFromPrimaryList).toBe(false);
  });
});
