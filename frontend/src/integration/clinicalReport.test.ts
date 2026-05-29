import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildClinicalReport, type ClinicalReport } from "./clinicalReport";
import { buildReportSnapshotV2 } from "./clinicalDecision";
import { buildClinicalReplay } from "./clinicalReplay";
import { runClinicalOverlay } from "./clinicalBridge";
import { evaluateTemporalGovernance } from "./clinicalTemporal";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";
import type { ClinicalOverlay } from "./clinicalBridge";

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
  sleep_disturbance: { onsetDate: "2026-01-05" },
});
const overlay: ClinicalOverlay = runClinicalOverlay(assessment);
const snapshot = buildReportSnapshotV2(
  assessment,
  overlay,
  { clientId: "c1", takenBy: "dr-a", takenAt: "2026-05-22T00:00:00Z" },
  [{ diagnosisId: "pdd", status: "confirmed", notes: "Met chronicity criterion." }],
);
const replay = buildClinicalReplay(snapshot, {
  id: "d1", clientId: "c1", timestamp: "2026-05-22T01:00:00Z", clinicianId: "dr-a",
  conclusions: [{ diagnosisId: "pdd", status: "confirmed", notes: "Met chronicity criterion." }],
  rationale: "Chronicity confirmed by patient interview.",
  snapshotHash: snapshot.snapshotHash, semanticSummary: snapshot.semanticStates,
});

// Strip runtime-only generatedAt for deterministic comparison.
const stable = (r: ClinicalReport) => ({
  ...r,
  meta: { snapshotHash: r.meta.snapshotHash },
  auditSection: { ...r.auditSection, generatedAt: "" },
});

describe("Phase 10 — clinical report assembly", () => {
  it("1. deterministic output from same snapshot + replay", () => {
    expect(stable(buildClinicalReport(snapshot, replay))).toEqual(
      stable(buildClinicalReport(snapshot, replay)),
    );
  });

  it("2. does not mutate the snapshot", () => {
    const before = JSON.stringify(snapshot);
    buildClinicalReport(snapshot, replay);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("3. does not mutate the replay", () => {
    const before = JSON.stringify(replay);
    buildClinicalReport(snapshot, replay);
    expect(JSON.stringify(replay)).toBe(before);
  });

  it("4. differential ambiguity preserved (resolved is always false)", () => {
    const r = buildClinicalReport(snapshot, replay);
    expect(r.differentialSection.groups.every((g) => g.resolved === false)).toBe(true);
    expect(r.differentialSection.groups.length).toEqual(replay.differentialMap.length);
  });

  it("5. temporal qualifications preserved verbatim (status copied)", () => {
    const r = buildClinicalReport(snapshot, replay);
    const replayStates = new Map(replay.temporalQualifications.map((t) => [t.diagnosisId, t.status]));
    for (const q of r.temporalSection.qualifications) {
      expect(q.temporalState).toBe(replayStates.get(q.diagnosisId));
    }
  });

  it("6. clinician override + rationale preserved verbatim", () => {
    const r = buildClinicalReport(snapshot, replay);
    const pdd = r.clinicianDecisionSection.conclusions.find((c) => c.diagnosisId === "pdd")!;
    expect(pdd.conclusion).toBe("confirmed");
    expect(pdd.overrideFromSystem).toBe(false);
    expect(pdd.rationale).toBe("Chronicity confirmed by patient interview.");
  });

  it("7. missing optional fields remain undefined (no invention)", () => {
    // No decision passed → rationale undefined; observations without severity stay undefined.
    const r = buildClinicalReport(snapshot, buildClinicalReplay(snapshot));
    expect(r.clinicianDecisionSection.conclusions[0]?.rationale).toBeUndefined();
    const sleep = r.observationsSection.observations.find((o) => o.symptomId === "sleep_disturbance");
    expect(sleep?.severity).toBeUndefined();
  });

  it("8. report ordering is stable (sorted by diagnosisId / groupId)", () => {
    const r = buildClinicalReport(snapshot, replay);
    const dxIds = r.diagnosticSummarySection.diagnoses.map((d) => d.diagnosisId);
    expect(dxIds).toEqual([...dxIds].sort());
    const groupIds = r.differentialSection.groups.map((g) => g.groupId);
    expect(groupIds).toEqual([...groupIds].sort());
  });

  it("9. audit hash copied exactly from snapshot", () => {
    const r = buildClinicalReport(snapshot, replay);
    expect(r.auditSection.snapshotHash).toBe(snapshot.snapshotHash);
    expect(r.meta.snapshotHash).toBe(snapshot.snapshotHash);
  });

  it("10. no engine imports in clinicalReport.ts", () => {
    const src = readFileSync(resolve(__dirname, "clinicalReport.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\.\/engine\//);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalBridge["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalSemantics["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalConstraints["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalTemporal["']/);
  });
});

describe("Phase 10 — additive guarantees", () => {
  it("11. existing snapshot hash unchanged after building a report", () => {
    const before = snapshot.snapshotHash;
    buildClinicalReport(snapshot, replay);
    expect(snapshot.snapshotHash).toBe(before);
  });

  it("12. existing replay structure unchanged", () => {
    const before = JSON.stringify(replay);
    buildClinicalReport(snapshot, replay);
    expect(JSON.stringify(replay)).toBe(before);
  });

  it("13. existing semantics unchanged (rebuilding the overlay yields identical states)", () => {
    const o2 = runClinicalOverlay(assessment);
    expect(o2.states).toEqual(overlay.states);
  });

  it("14. existing temporal governance unchanged (recomputed identically)", () => {
    const again = evaluateTemporalGovernance(assessment, {
      candidacies: overlay.candidacies.map((c) => ({ diagnosisId: c.diagnosisId })),
    });
    expect(snapshot.temporalQualifications.map((t) => `${t.diagnosisId}:${t.status}`).sort()).toEqual(
      again.diagnoses.map((t) => `${t.diagnosisId}:${t.status}`).sort(),
    );
  });
});
