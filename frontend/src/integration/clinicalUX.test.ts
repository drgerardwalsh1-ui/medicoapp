import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClinicalDecisionViewModel, getForensicReplayData } from "./clinicalUX";
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

// Rich fixture so multiple primary hypotheses + temporal flags + suppressions exist.
const assessment = mk({
  depressed_mood: { onsetDate: "2026-01-10", severity: "severe", durationCount: "3", durationUnit: "years" },
  anhedonia: { onsetDate: "2026-01-12" },
  sleep_disturbance: { onsetDate: "2026-01-05" },
  fatigue_energy_loss: { onsetDate: "2026-01-07" },
  concentration_difficulty: { onsetDate: "2026-01-09" },
});
const overlay = runClinicalOverlay(assessment);
const snapshot = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, []);
const replay = buildClinicalReplay(snapshot);

describe("Phase 16 — clinical UX translation", () => {
  it("1. hypothesis list never exceeds 5 items", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    expect(vm.primaryHypotheses.length).toBeLessThanOrEqual(5);
  });

  it("2. each hypothesis has at most 3 supporting signals", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    for (const h of vm.primaryHypotheses) expect(h.supportingSignals.length).toBeLessThanOrEqual(3);
  });

  it("3. each hypothesis has at most 3 missing signals", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    for (const h of vm.primaryHypotheses) expect(h.missingSignals.length).toBeLessThanOrEqual(3);
  });

  it("4. decision pressure generated for every hypothesis", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    expect(vm.decisionPressure.length).toBe(vm.primaryHypotheses.length);
    expect(vm.decisionPressure.every((p) => p.source === "semantic + temporal + constraint only")).toBe(true);
  });

  it("5. temporal flags map verbatim from Phase 9 (status label only)", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    const expectedIds = snapshot.temporalQualifications
      .filter((t) => t.status !== "temporally_not_applicable")
      .map((t) => t.diagnosisId)
      .sort();
    expect(vm.temporalFlags.map((f) => f.diagnosisId).sort()).toEqual(expectedIds);
    for (const f of vm.temporalFlags) {
      expect(["Duration supports diagnosis", "Insufficient longitudinal evidence", "Temporal criteria not satisfied"]).toContain(f.label);
    }
  });

  it("6. constraint statuses are NOT recomputed — verbatim from snapshot.constraintSuppressions", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    const expectedReasons = new Set(snapshot.constraintSuppressions.map((s) => s.reason));
    const contradictionReasons = new Set(vm.contradictions.map((c) => c.contradiction));
    for (const r of expectedReasons) expect(contradictionReasons.has(r)).toBe(true);
  });

  it("7. no engine / bridge / constraints / semantics / temporal MODULE imports in clinicalUX.ts", () => {
    const src = readFileSync(resolve(__dirname, "clinicalUX.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\.\/engine\//);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalBridge["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalConstraints["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalSemantics["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalTemporal["']/);
  });

  it("8. deterministic — identical snapshot/replay yields identical UX model", () => {
    const a = buildClinicalDecisionViewModel(snapshot, replay);
    const b = buildClinicalDecisionViewModel(snapshot, replay);
    expect(a).toEqual(b);
  });

  it("9. forensic drawer data equals replay output exactly (identity passthrough)", () => {
    expect(getForensicReplayData(replay)).toEqual(replay);
    // Same object reference (no copy / no mutation).
    expect(getForensicReplayData(replay)).toBe(replay);
  });

  it("10. does not mutate input snapshot or replay", () => {
    const beforeSnap = JSON.stringify(snapshot);
    const beforeReplay = JSON.stringify(replay);
    buildClinicalDecisionViewModel(snapshot, replay);
    expect(JSON.stringify(snapshot)).toBe(beforeSnap);
    expect(JSON.stringify(replay)).toBe(beforeReplay);
  });

  it("11. missing evidence reflects only existing snapshot signals (temporal unmet + suppression reasons)", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    const allowed = new Set<string>();
    for (const t of snapshot.temporalQualifications) for (const r of t.unmetRequirements) allowed.add(r);
    for (const s of snapshot.constraintSuppressions) allowed.add(s.reason);
    for (const m of vm.missingEvidence) for (const c of m.missingCriteria) expect(allowed.has(c)).toBe(true);
  });

  it("12. contradictions reflect only existing constraint or semantic rule_out reasons", () => {
    const vm = buildClinicalDecisionViewModel(snapshot, replay);
    const allowed = new Set<string>();
    for (const s of snapshot.constraintSuppressions) allowed.add(s.reason);
    for (const s of snapshot.semanticStates) if (s.state === "rule_out" && s.reason) allowed.add(s.reason);
    for (const c of vm.contradictions) expect(allowed.has(c.contradiction)).toBe(true);
  });

  it("hiddenForensicsAvailable is true (engine truth preserved, hidden not removed)", () => {
    expect(buildClinicalDecisionViewModel(snapshot, replay).hiddenForensicsAvailable).toBe(true);
  });
});
