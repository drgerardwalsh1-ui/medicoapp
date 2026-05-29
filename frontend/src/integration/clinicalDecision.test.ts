import { describe, it, expect } from "vitest";
import {
  createClinicalDecision,
  buildReportSnapshotV2,
  computeSnapshotHash,
  verifyReportSnapshotV2,
} from "./clinicalDecision";
import type { ClinicalOverlay } from "./clinicalBridge";
import type { DSMAssessmentData } from "../types/dsm";

const overlay: ClinicalOverlay = {
  candidacies: [{ diagnosisId: "mdd" as never, state: "threshold_likely_met", temporalCoOccurrenceSupported: true, sharedEvidence: false }],
  suggestions: [],
  conflicts: [],
  episodes: [],
  summaries: [{ diagnosisId: "mdd", name: "MDD", state: "threshold_likely_met", coverage: 1, metCriteria: 1, totalCriteria: 1, sharedEvidence: false, tier: "likely" }],
  suppressed: [{ diagnosisId: "pdd", name: "PDD", reason: "No depressed mood present (PDD Criterion A)" }],
  states: [
    { diagnosisId: "mdd", name: "MDD", state: "likely" },
    { diagnosisId: "ptsd", name: "PTSD", state: "rule_out", reason: "rule out" },
  ],
  temporalQualifications: [],
  diagnosisNames: { mdd: "MDD", pdd: "PDD", ptsd: "PTSD" },
};

const assessment: DSMAssessmentData = {
  symptoms: {
    depressed_mood: { id: "depressed_mood", symptomType: "depressed_mood", currentPresence: true },
    sleep_disturbance: { id: "sleep_disturbance", symptomType: "sleep_disturbance", currentPresence: false },
  },
  criterionAssessments: [],
  diagnosticInterpretations: [],
  timelineEvents: [],
};

const input = {
  clientId: "c1",
  clinicianId: "dr-a",
  timestamp: "2026-05-22T00:00:00Z",
  id: "dec-1",
  conclusions: [
    { diagnosisId: "mdd", status: "confirmed" as const },
    { diagnosisId: "ptsd", status: "confirmed" as const }, // confirming a rule_out → override
    { diagnosisId: "gad", status: "deferred" as const },
  ],
  rationale: "Clinical judgement.",
};

describe("Phase 7 — clinical decision boundary", () => {
  it("records clinician conclusions verbatim (system never auto-confirms)", () => {
    const { decision } = createClinicalDecision(assessment, overlay, input);
    expect(decision.conclusions.map((c) => c.status)).toEqual(["confirmed", "confirmed", "deferred"]);
    expect(decision.clinicianId).toBe("dr-a");
  });

  it("flags overrideFromSystem when clinician diverges from system state", () => {
    const { decision } = createClinicalDecision(assessment, overlay, input);
    const mdd = decision.conclusions.find((c) => c.diagnosisId === "mdd")!;
    const ptsd = decision.conclusions.find((c) => c.diagnosisId === "ptsd")!;
    expect(mdd.overrideFromSystem).toBe(false); // confirmed a "likely" → agrees
    expect(ptsd.overrideFromSystem).toBe(true); // confirmed a "rule_out" → override
  });

  it("captures verbatim observations (present only)", () => {
    const { snapshot } = createClinicalDecision(assessment, overlay, input);
    expect(snapshot.observations.map((o) => o.id)).toEqual(["depressed_mood"]);
  });

  it("snapshot hash is deterministic and verifiable", () => {
    const a = createClinicalDecision(assessment, overlay, input).snapshot;
    const b = createClinicalDecision(assessment, overlay, input).snapshot;
    expect(a.snapshotHash).toBe(b.snapshotHash);
    expect(verifyReportSnapshotV2(a)).toBe(true);
  });

  it("hash changes when clinician conclusions change", () => {
    const base = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, []);
    const withConc = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, [{ diagnosisId: "mdd", status: "confirmed" }]);
    expect(base.snapshotHash).not.toBe(withConc.snapshotHash);
  });

  it("preserves differential ambiguity in the snapshot (no resolution)", () => {
    const { snapshot } = createClinicalDecision(assessment, overlay, input);
    // PTSD remains rule_out in semanticStates regardless of clinician action.
    expect(snapshot.semanticStates.find((s) => s.diagnosisId === "ptsd")?.state).toBe("rule_out");
  });

  it("does not mutate inputs (pure)", () => {
    const snap = JSON.stringify(overlay);
    createClinicalDecision(assessment, overlay, input);
    expect(JSON.stringify(overlay)).toBe(snap);
  });

  it("computeSnapshotHash is stable for equal canonical data regardless of key order", () => {
    expect(computeSnapshotHash({ a: 1, b: 2 })).toBe(computeSnapshotHash({ b: 2, a: 1 }));
  });

  // ── Phase 7 hardening — snapshot hash includes Phase 5/6 payload ─────────────
  it("hash includes semantic states (Phase 6)", () => {
    const base = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "x", takenAt: "T" });
    const altered = buildReportSnapshotV2(
      assessment,
      { ...overlay, states: [{ diagnosisId: "mdd", name: "MDD", state: "probable" }] },
      { clientId: "c1", takenBy: "x", takenAt: "T" },
    );
    expect(base.snapshotHash).not.toBe(altered.snapshotHash);
  });

  it("hash includes differentialGroup assignments", () => {
    const a = buildReportSnapshotV2(
      assessment,
      { ...overlay, states: [{ diagnosisId: "mdd", name: "MDD", state: "likely" }] },
      { clientId: "c1", takenBy: "x", takenAt: "T" },
    );
    const b = buildReportSnapshotV2(
      assessment,
      { ...overlay, states: [{ diagnosisId: "mdd", name: "MDD", state: "likely", differentialGroup: "mood_polarity" }] },
      { clientId: "c1", takenBy: "x", takenAt: "T" },
    );
    expect(a.snapshotHash).not.toBe(b.snapshotHash);
  });

  it("hash includes constraint suppression reasons (Phase 5)", () => {
    const a = buildReportSnapshotV2(
      assessment,
      { ...overlay, suppressed: [{ diagnosisId: "pdd", name: "PDD", reason: "reason A" }] },
      { clientId: "c1", takenBy: "x", takenAt: "T" },
    );
    const b = buildReportSnapshotV2(
      assessment,
      { ...overlay, suppressed: [{ diagnosisId: "pdd", name: "PDD", reason: "reason B" }] },
      { clientId: "c1", takenBy: "x", takenAt: "T" },
    );
    expect(a.snapshotHash).not.toBe(b.snapshotHash);
  });
});
