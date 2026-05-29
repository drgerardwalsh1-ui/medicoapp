import { describe, it, expect } from "vitest";
import { buildClinicalReplay, type ClinicalReplay } from "./clinicalReplay";
import { buildReportSnapshotV2 } from "./clinicalDecision";
import type { ClinicalOverlay } from "./clinicalBridge";
import type { DSMAssessmentData } from "../types/dsm";

const overlay: ClinicalOverlay = {
  candidacies: [
    { diagnosisId: "mdd" as never, state: "approaching_threshold", temporalCoOccurrenceSupported: true, sharedEvidence: true },
    { diagnosisId: "pdd" as never, state: "threshold_likely_met", temporalCoOccurrenceSupported: true, sharedEvidence: true },
    { diagnosisId: "ssd" as never, state: "approaching_threshold", temporalCoOccurrenceSupported: true, sharedEvidence: false },
  ],
  suggestions: [],
  conflicts: [],
  episodes: [],
  summaries: [
    { diagnosisId: "mdd", name: "MDD", state: "approaching_threshold", coverage: 0.8, metCriteria: 0, totalCriteria: 1, sharedEvidence: true, tier: "likely" },
    { diagnosisId: "pdd", name: "PDD", state: "threshold_likely_met", coverage: 1, metCriteria: 2, totalCriteria: 2, sharedEvidence: true, tier: "likely" },
  ],
  suppressed: [{ diagnosisId: "ssd", name: "SSD", reason: "No maladaptive symptom response present (SSD Criterion B)" }],
  states: [
    { diagnosisId: "pdd", name: "PDD", state: "differential_primary", differentialGroup: "mood_polarity", differentialBasis: "mood polarity / chronicity" },
    { diagnosisId: "mdd", name: "MDD", state: "differential_primary", differentialGroup: "mood_polarity", differentialBasis: "mood polarity / chronicity" },
    { diagnosisId: "ssd", name: "SSD", state: "excluded", reason: "No maladaptive symptom response present (SSD Criterion B)" },
  ],
  temporalQualifications: [
    { diagnosisId: "pdd", status: "temporally_unknown", requiresLongitudinalEvidence: true, unmetRequirements: ["≥2-year chronicity not documented"], supportingEvidence: [] },
  ],
  diagnosisNames: { mdd: "MDD", pdd: "PDD", ssd: "SSD" },
};

const assessment: DSMAssessmentData = {
  symptoms: {
    depressed_mood: { id: "depressed_mood", symptomType: "depressed_mood", currentPresence: true, onsetDate: "2026-01-10", severity: "severe" },
    sleep_disturbance: { id: "sleep_disturbance", symptomType: "sleep_disturbance", currentPresence: true, onsetDate: "2026-01-05" },
    excluded_obs: { id: "excluded_obs", symptomType: "excluded_obs", currentPresence: false },
  },
  criterionAssessments: [],
  diagnosticInterpretations: [],
  timelineEvents: [],
};

const snapshot = buildReportSnapshotV2(
  assessment,
  overlay,
  { clientId: "c1", takenBy: "dr-a", takenAt: "2026-05-22T00:00:00Z" },
  [
    { diagnosisId: "pdd", status: "confirmed" },
    { diagnosisId: "ssd", status: "rejected" },
  ],
);

// Strip the runtime-only createdAtReplay for deterministic comparison.
const stable = (r: ClinicalReplay) => ({ ...r, meta: { snapshotHash: r.meta.snapshotHash } });

describe("Phase 8 — clinical forensic replay", () => {
  it("1. determinism — identical snapshots → identical replay (excl. createdAtReplay)", () => {
    expect(stable(buildClinicalReplay(snapshot))).toEqual(stable(buildClinicalReplay(snapshot)));
  });

  it("2. verbatim fidelity — observations match snapshot exactly (present-only, chronological)", () => {
    const r = buildClinicalReplay(snapshot);
    expect(r.observations.map((o) => o.symptomId)).toEqual(["sleep_disturbance", "depressed_mood"]);
    expect(r.observations.find((o) => o.symptomId === "depressed_mood")?.severity).toBe("severe");
    expect(r.observations.some((o) => o.symptomId === "excluded_obs")).toBe(false);
  });

  it("3. no-backfill — absent fields stay undefined (no decision arg → no rationale)", () => {
    const r = buildClinicalReplay(snapshot);
    expect(r.clinicianDecision?.rationale).toBeUndefined();
    // observation with no severity must not gain one
    expect(r.observations.find((o) => o.symptomId === "sleep_disturbance")?.severity).toBeUndefined();
  });

  it("4. constraint fidelity — reasons match snapshot.constraintSuppressions exactly", () => {
    const r = buildClinicalReplay(snapshot);
    expect(r.constraintEvents).toEqual(
      snapshot.constraintSuppressions.map((s) => ({ diagnosisId: s.diagnosisId, name: s.name, reason: s.reason })),
    );
  });

  it("5. semantic preservation — states not recomputed or altered", () => {
    const r = buildClinicalReplay(snapshot);
    const fromSnap = [...snapshot.semanticStates].sort((a, b) => (a.diagnosisId < b.diagnosisId ? -1 : 1));
    expect(r.semanticEvolution.map((s) => s.current)).toEqual(fromSnap.map((s) => s.state));
  });

  it("6. differential non-resolution — resolved is always false", () => {
    const r = buildClinicalReplay(snapshot);
    expect(r.differentialMap.length).toBeGreaterThan(0);
    expect(r.differentialMap.every((g) => g.resolved === false)).toBe(true);
    expect(r.differentialMap.find((g) => g.group === "mood_polarity")?.members.map((m) => m.diagnosisId)).toEqual(["mdd", "pdd"]);
  });

  it("7. snapshot-hash binding — meta.snapshotHash equals snapshot hash", () => {
    const r = buildClinicalReplay(snapshot);
    expect(r.meta.snapshotHash).toBe(snapshot.snapshotHash);
    expect(r.clinicianDecision?.snapshotHash).toBe(snapshot.snapshotHash);
  });

  it("does not mutate the input snapshot", () => {
    const before = JSON.stringify(snapshot);
    buildClinicalReplay(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("includes provided decision verbatim (rationale carried)", () => {
    const r = buildClinicalReplay(snapshot, {
      id: "d1", clientId: "c1", timestamp: "2026-05-22T01:00:00Z", clinicianId: "dr-b",
      conclusions: [{ diagnosisId: "pdd", status: "confirmed" }], rationale: "documented", snapshotHash: snapshot.snapshotHash, semanticSummary: [],
    });
    expect(r.clinicianDecision?.rationale).toBe("documented");
    expect(r.clinicianDecision?.clinicianId).toBe("dr-b");
  });
});
