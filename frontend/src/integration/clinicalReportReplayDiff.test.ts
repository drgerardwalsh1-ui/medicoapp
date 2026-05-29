import { describe, it, expect } from "vitest";
import { diffClinicalReportSequence } from "./clinicalReportReplayDiff";
import { serializeClinicalReport } from "./clinicalReportSerializer";
import { buildClinicalReport } from "./clinicalReport";
import { buildReportSnapshotV2 } from "./clinicalDecision";
import { buildClinicalReplay } from "./clinicalReplay";
import { runClinicalOverlay } from "./clinicalBridge";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";
import type { ClinicalReportExportV1 } from "./clinicalReportSerializer";

function mk(symptoms: Record<string, Partial<SymptomEntity>>): DSMAssessmentData {
  const out: Record<string, SymptomEntity> = {};
  for (const [id, s] of Object.entries(symptoms)) {
    out[id] = { id, symptomType: id, currentPresence: true, ...s };
  }
  return { symptoms: out, criterionAssessments: [], diagnosticInterpretations: [], timelineEvents: [] };
}
function exportOf(assessment: DSMAssessmentData, takenAt = "T"): ClinicalReportExportV1 {
  const overlay = runClinicalOverlay(assessment);
  const snap = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt }, []);
  const replay = buildClinicalReplay(snap);
  return serializeClinicalReport(buildClinicalReport(snap, replay));
}

const a = exportOf(mk({ depressed_mood: { onsetDate: "2026-01-10" } }), "T1");
const b = exportOf(mk({ depressed_mood: { onsetDate: "2026-01-10" }, anhedonia: {} }), "T2");
const c = exportOf(mk({ depressed_mood: { onsetDate: "2026-01-10" }, anhedonia: {}, fatigue_energy_loss: {} }), "T3");

describe("Phase 14 — forensic replay evolution", () => {
  it("single report → no steps, identical across all, no volatile paths", () => {
    const r = diffClinicalReportSequence([a]);
    expect(r.steps).toEqual([]);
    expect(r.identicalAcrossAll).toBe(true);
    expect(r.volatilePaths).toEqual([]);
    expect(r.invariantPaths.length).toBeGreaterThan(0);
  });

  it("two identical reports → identicalAcrossAll true, step diff is identical", () => {
    const r = diffClinicalReportSequence([a, a]);
    expect(r.identicalAcrossAll).toBe(true);
    expect(r.steps.length).toBe(1);
    expect(r.steps[0].structuralDiff.identical).toBe(true);
    expect(r.volatilePaths).toEqual([]);
  });

  it("two different reports → step uses snapshot hash for identity (no recomputation)", () => {
    const r = diffClinicalReportSequence([a, b]);
    expect(r.identicalAcrossAll).toBe(false);
    expect(r.steps[0].fromHash).toBe(a.audit.snapshotHash);
    expect(r.steps[0].toHash).toBe(b.audit.snapshotHash);
  });

  it("multi-step sequence — volatile paths are the union of changing paths", () => {
    const r = diffClinicalReportSequence([a, b, c]);
    expect(r.steps.length).toBe(2);
    // adding observations changes observation count + hash, so those paths must be volatile
    expect(r.volatilePaths.some((p) => p.startsWith("observations["))).toBe(true);
    expect(r.volatilePaths).toContain("meta.snapshotHash");
    expect(r.volatilePaths).toContain("audit.snapshotHash");
  });

  it("invariant paths — fields identical across ALL snapshots stay invariant", () => {
    const r = diffClinicalReportSequence([a, b, c]);
    // The version is "1.0.0" in every export and should be invariant.
    expect(r.invariantPaths).toContain("version");
    // No path appears in both lists.
    const overlap = r.invariantPaths.filter((p) => r.volatilePaths.includes(p));
    expect(overlap).toEqual([]);
  });

  it("classification uses presence — a path present in some but not all is volatile", () => {
    const withReplayHash: ClinicalReportExportV1 = { ...a, audit: { ...a.audit, replayHash: "r-1" } };
    const r = diffClinicalReportSequence([a, withReplayHash]);
    expect(r.volatilePaths).toContain("audit.replayHash");
  });

  it("path ordering is lexicographic in both groups", () => {
    const r = diffClinicalReportSequence([a, b, c]);
    expect([...r.invariantPaths]).toEqual([...r.invariantPaths].sort());
    expect([...r.volatilePaths]).toEqual([...r.volatilePaths].sort());
  });

  it("does not mutate inputs", () => {
    const beforeA = JSON.stringify(a);
    const beforeB = JSON.stringify(b);
    diffClinicalReportSequence([a, b]);
    expect(JSON.stringify(a)).toBe(beforeA);
    expect(JSON.stringify(b)).toBe(beforeB);
  });

  it("uses Phase 13 diff engine for each step (structuralDiff has the diff shape)", () => {
    const r = diffClinicalReportSequence([a, b]);
    const d = r.steps[0].structuralDiff;
    expect(d).toHaveProperty("changedSections");
    expect(d).toHaveProperty("addedFields");
    expect(d).toHaveProperty("removedFields");
    expect(d).toHaveProperty("identical");
  });

  it("deterministic — running twice on the same sequence yields the same evolution map", () => {
    expect(diffClinicalReportSequence([a, b, c])).toEqual(diffClinicalReportSequence([a, b, c]));
  });

  it("step order is chronological — fromHash[i] equals toHash[i-1]", () => {
    const r = diffClinicalReportSequence([a, b, c]);
    for (let i = 1; i < r.steps.length; i++) {
      expect(r.steps[i].fromHash).toBe(r.steps[i - 1].toHash);
    }
  });
});
