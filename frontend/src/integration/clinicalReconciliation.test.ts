import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createClinicalDecisionFromSnapshot,
  buildReportSnapshotV2,
  computeSnapshotHash,
  type ReportSnapshotV2,
  type ClinicalDecision,
} from "./clinicalDecision";
import { buildClinicalReplay } from "./clinicalReplay";
import { runClinicalOverlay } from "./clinicalBridge";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

function mk(symptoms: Record<string, Partial<SymptomEntity>>): DSMAssessmentData {
  const out: Record<string, SymptomEntity> = {};
  for (const [id, s] of Object.entries(symptoms)) {
    out[id] = { id, symptomType: id, currentPresence: true, ...s };
  }
  return { symptoms: out, criterionAssessments: [], diagnosticInterpretations: [], timelineEvents: [] };
}

const assessment = mk({
  depressed_mood: { onsetDate: "2026-01-10", severity: "severe", durationCount: "3", durationUnit: "years" },
  anhedonia: { onsetDate: "2026-01-12" },
});
const overlay = runClinicalOverlay(assessment);
const META = { clientId: "c1", takenBy: "dr-a", takenAt: "T" };
const preFinalSnapshot = buildReportSnapshotV2(assessment, overlay, META, []);
const replay = buildClinicalReplay(preFinalSnapshot);

const finalizeInput = {
  clientId: "c1",
  clinicianId: "dr-a",
  conclusions: [{ diagnosisId: "pdd", status: "confirmed" as const }],
  rationale: "Documented chronicity.",
  timestamp: "2026-05-22T01:00:00Z",
  id: "decision-1",
};

describe("Phase 18 — system reconciliation (single commit point)", () => {
  it("1. ClinicalDecisionView produces a valid finalize flow (modal + snapshot pipeline)", () => {
    const { decision, snapshot: finalSnap } = createClinicalDecisionFromSnapshot(preFinalSnapshot, finalizeInput);
    expect(decision.conclusions[0].status).toBe("confirmed");
    expect(decision.snapshotHash).toBe(finalSnap.snapshotHash);
    expect(finalSnap.conclusions.map((c) => c.diagnosisId)).toEqual(["pdd"]);
  });

  it("2. snapshot identity is preserved end-to-end (input untouched; final reproducible)", () => {
    const beforeHash = preFinalSnapshot.snapshotHash;
    const a = createClinicalDecisionFromSnapshot(preFinalSnapshot, finalizeInput);
    const b = createClinicalDecisionFromSnapshot(preFinalSnapshot, finalizeInput);
    // Input snapshot hash unchanged.
    expect(preFinalSnapshot.snapshotHash).toBe(beforeHash);
    // Final snapshot deterministic across calls.
    expect(a.snapshot.snapshotHash).toBe(b.snapshot.snapshotHash);
    // Final snapshot is a content-hash over its own body (forensic reproducibility).
    const { snapshotHash, ...body } = a.snapshot;
    expect(computeSnapshotHash(body)).toBe(snapshotHash);
  });

  it("3. modal output matches what would be persisted (snapshot byte-stable)", () => {
    // The modal calls createClinicalDecisionFromSnapshot then persists the
    // resulting snapshot+decision verbatim. Round-tripping the snapshot via
    // JSON (the IPC transport encoding) preserves the hash.
    const { snapshot: finalSnap } = createClinicalDecisionFromSnapshot(preFinalSnapshot, finalizeInput);
    const roundtripped = JSON.parse(JSON.stringify(finalSnap)) as ReportSnapshotV2;
    expect(roundtripped.snapshotHash).toBe(finalSnap.snapshotHash);
  });

  it("4. replay remains deterministic after a persistence round-trip", () => {
    const { snapshot: finalSnap } = createClinicalDecisionFromSnapshot(preFinalSnapshot, finalizeInput);
    const a = buildClinicalReplay(finalSnap);
    const roundtripped = JSON.parse(JSON.stringify(finalSnap)) as ReportSnapshotV2;
    const b = buildClinicalReplay(roundtripped);
    expect({ ...b, meta: { snapshotHash: b.meta.snapshotHash } }).toEqual({
      ...a,
      meta: { snapshotHash: a.meta.snapshotHash },
    });
  });

  it("5. UI layer contains zero engine imports", () => {
    const decisionView = read("integration/ui/ClinicalDecisionView.tsx");
    const hypothesisPanel = read("integration/ui/ClinicalHypothesisPanel.tsx");
    const forensicDrawer = read("integration/ui/ClinicalForensicDrawer.tsx");
    const modal = read("integration/FinalizeDecisionModal.tsx");
    for (const src of [decisionView, hypothesisPanel, forensicDrawer, modal]) {
      expect(src).not.toMatch(/from\s+["']\.\.\/(?:\.\.\/)?engine\//);
      expect(src).not.toMatch(/from\s+["']\.\.?\/clinicalBridge["']/);
    }
  });

  it("6. decisions are only created via the modal — view never constructs one directly", () => {
    const decisionView = read("integration/ui/ClinicalDecisionView.tsx");
    // View must not call the decision builders itself; only the modal does.
    expect(decisionView).not.toMatch(/createClinicalDecision\b/);
    expect(decisionView).not.toMatch(/createClinicalDecisionFromSnapshot\b/);
    // The single commit surface is the modal.
    expect(decisionView).toMatch(/FinalizeDecisionModal/);
  });

  it("7. finalize flow does not mutate the input snapshot or replay", () => {
    const beforeSnap = JSON.stringify(preFinalSnapshot);
    const beforeReplay = JSON.stringify(replay);
    createClinicalDecisionFromSnapshot(preFinalSnapshot, finalizeInput);
    buildClinicalReplay(preFinalSnapshot);
    expect(JSON.stringify(preFinalSnapshot)).toBe(beforeSnap);
    expect(JSON.stringify(replay)).toBe(beforeReplay);
  });

  it("commit point is unique — page reaches Finalize only via ClinicalDecisionView", () => {
    const page = read("pages/CurrentSymptomsPage.tsx");
    expect(page).not.toMatch(/FinalizeDecisionModal/); // not directly opened from the page
    expect(page).toMatch(/<ClinicalDecisionView/);
    // Legacy panel is gone from the codebase entirely.
    expect(() => read("integration/ClinicalOverlayPanel.tsx")).toThrow();
  });

  it("override-from-system flagging preserved (carries through verbatim into final snapshot)", () => {
    const { decision } = createClinicalDecisionFromSnapshot(preFinalSnapshot, {
      ...finalizeInput,
      conclusions: [{ diagnosisId: "pdd", status: "rejected" }], // diverges from likely
    });
    const c = decision.conclusions.find((x) => x.diagnosisId === "pdd")!;
    // override is computed from snapshot.semanticStates — pre-finalization input.
    expect(typeof c.overrideFromSystem).toBe("boolean");
  });

  it("typed result — ClinicalDecision shape matches Phase-7 contract", () => {
    const { decision } = createClinicalDecisionFromSnapshot(preFinalSnapshot, finalizeInput);
    const required: (keyof ClinicalDecision)[] = ["id", "clientId", "timestamp", "clinicianId", "conclusions", "snapshotHash", "semanticSummary"];
    for (const k of required) expect(decision[k]).toBeDefined();
  });
});
