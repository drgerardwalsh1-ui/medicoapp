import { describe, it, expect } from "vitest";
import { evaluateTemporalGovernance } from "./clinicalTemporal";
import { runClinicalOverlay } from "./clinicalBridge";
import { buildReportSnapshotV2 } from "./clinicalDecision";
import { buildClinicalReplay } from "./clinicalReplay";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";

function mk(symptoms: Record<string, Partial<SymptomEntity>>): DSMAssessmentData {
  const out: Record<string, SymptomEntity> = {};
  for (const [id, s] of Object.entries(symptoms)) {
    out[id] = { id, symptomType: id, currentPresence: true, ...s };
  }
  return { symptoms: out, criterionAssessments: [], diagnosticInterpretations: [], timelineEvents: [] };
}
const cand = (...ids: string[]) => ({ candidacies: ids.map((diagnosisId) => ({ diagnosisId })) });
const statusOf = (r: { diagnoses: readonly { diagnosisId: string; status: string }[] }, id: string) =>
  r.diagnoses.find((d) => d.diagnosisId === id)?.status;

describe("Phase 9 — temporal governance rules", () => {
  it("1. PDD without duration evidence → temporally_unknown", () => {
    const r = evaluateTemporalGovernance(mk({ depressed_mood: {} }), cand("pdd"));
    expect(statusOf(r, "pdd")).toBe("temporally_unknown");
  });

  it("2. PDD with explicit ≥2-year chronicity → temporally_supported", () => {
    const r = evaluateTemporalGovernance(mk({ depressed_mood: { durationCount: "3", durationUnit: "years" } }), cand("pdd"));
    expect(statusOf(r, "pdd")).toBe("temporally_supported");
  });

  it("3. PTSD with duration < 1 month → temporally_inconsistent", () => {
    const r = evaluateTemporalGovernance(mk({ flashbacks: { durationCount: "2", durationUnit: "weeks" } }), cand("ptsd"));
    expect(statusOf(r, "ptsd")).toBe("temporally_inconsistent");
  });

  it("4. ASD with duration ≥ 1 month → temporally_inconsistent", () => {
    const r = evaluateTemporalGovernance(mk({ flashbacks: { durationCount: "2", durationUnit: "months" } }), cand("asd"));
    expect(statusOf(r, "asd")).toBe("temporally_inconsistent");
  });

  it("5. Bipolar evidence present → MDD/PDD not temporally_supported", () => {
    const r = evaluateTemporalGovernance(
      mk({ depressed_mood: { durationCount: "3", durationUnit: "years" }, elevated_mood: {} }),
      cand("mdd", "pdd"),
    );
    expect(statusOf(r, "mdd")).toBe("temporally_inconsistent");
    expect(statusOf(r, "pdd")).toBe("temporally_inconsistent");
    expect(statusOf(r, "pdd")).not.toBe("temporally_supported");
  });

  it("6. Substance-only mood symptoms → primary disorders temporally_unknown", () => {
    const r = evaluateTemporalGovernance(
      mk({ depressed_mood: {}, excessive_worry: {}, stud_withdrawal: {} }),
      cand("mdd", "pdd", "gad"),
    );
    expect(statusOf(r, "mdd")).toBe("temporally_unknown");
    expect(statusOf(r, "pdd")).toBe("temporally_unknown");
    expect(statusOf(r, "gad")).toBe("temporally_unknown");
  });
});

describe("Phase 9 — additivity (no effect on candidacy / semantics)", () => {
  const baseSyms = { depressed_mood: {}, anhedonia: {}, sleep_disturbance: {}, fatigue_energy_loss: {} };
  const withoutDuration = mk(baseSyms);
  const withDuration = mk({ ...baseSyms, depressed_mood: { durationCount: "3", durationUnit: "years" } });

  it("7. temporal evidence does not alter candidacy/summaries", () => {
    const a = runClinicalOverlay(withoutDuration);
    const b = runClinicalOverlay(withDuration);
    expect(b.summaries).toEqual(a.summaries);
    expect(b.candidacies).toEqual(a.candidacies);
    // ... but the temporal qualification DID change:
    const ta = a.temporalQualifications.find((t) => t.diagnosisId === "pdd")?.status;
    const tb = b.temporalQualifications.find((t) => t.diagnosisId === "pdd")?.status;
    expect(ta).not.toBe(tb);
  });

  it("8. temporal evidence does not alter semantic states", () => {
    expect(runClinicalOverlay(withDuration).states).toEqual(runClinicalOverlay(withoutDuration).states);
  });
});

describe("Phase 9 — snapshot + replay", () => {
  const assessment = mk({ depressed_mood: {}, anhedonia: {}, sleep_disturbance: {}, fatigue_energy_loss: {} });
  const overlay = runClinicalOverlay(assessment);
  const meta = { clientId: "c1", takenBy: "dr-a", takenAt: "2026-05-22T00:00:00Z" };

  it("9. replay preserves temporal qualifications verbatim", () => {
    const snap = buildReportSnapshotV2(assessment, overlay, meta);
    const replay = buildClinicalReplay(snap);
    expect(replay.temporalQualifications).toEqual(snap.temporalQualifications);
  });

  it("10. snapshot hash changes when a temporal qualification changes", () => {
    const a = buildReportSnapshotV2(assessment, overlay, meta);
    const b = buildReportSnapshotV2(
      assessment,
      {
        ...overlay,
        temporalQualifications: [
          { diagnosisId: "pdd", status: "temporally_supported", requiresLongitudinalEvidence: true, unmetRequirements: [], supportingEvidence: ["x"] },
        ],
      },
      meta,
    );
    expect(a.snapshotHash).not.toBe(b.snapshotHash);
  });
});
