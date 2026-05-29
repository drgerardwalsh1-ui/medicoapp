import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  serializeClinicalReport,
  stableClinicalReportString,
  canonicalStringify,
} from "./clinicalReportSerializer";
import { buildClinicalReport } from "./clinicalReport";
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

const assessment = mk({
  depressed_mood: { onsetDate: "2026-01-10", severity: "severe", durationCount: "3", durationUnit: "years" },
  anhedonia: { onsetDate: "2026-01-12" },
  sleep_disturbance: { onsetDate: "2026-01-05" },
});
const overlay = runClinicalOverlay(assessment);
const snapshot = buildReportSnapshotV2(
  assessment,
  overlay,
  { clientId: "c1", takenBy: "dr-a", takenAt: "2026-05-22T00:00:00Z" },
  [{ diagnosisId: "pdd", status: "confirmed", notes: "chronicity met" }],
);
const replay = buildClinicalReplay(snapshot, {
  id: "d1", clientId: "c1", timestamp: "2026-05-22T01:00:00Z", clinicianId: "dr-a",
  conclusions: [{ diagnosisId: "pdd", status: "confirmed", notes: "chronicity met" }],
  rationale: "Per interview.", snapshotHash: snapshot.snapshotHash, semanticSummary: snapshot.semanticStates,
});
const report = buildClinicalReport(snapshot, replay);

describe("Phase 11 — canonical serialization", () => {
  it("versioned export — version = '1.0.0'", () => {
    expect(serializeClinicalReport(report).version).toBe("1.0.0");
  });

  it("pure — does not mutate input report", () => {
    const before = JSON.stringify(report);
    serializeClinicalReport(report);
    expect(JSON.stringify(report)).toBe(before);
  });

  it("deterministic — identical input yields identical export", () => {
    expect(serializeClinicalReport(report)).toEqual(serializeClinicalReport(report));
  });

  it("stable string — identical input yields identical bytes", () => {
    const a = stableClinicalReportString(serializeClinicalReport(report));
    const b = stableClinicalReportString(serializeClinicalReport(report));
    expect(a).toBe(b);
  });

  it("stable string — key order in input does not affect output", () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });

  it("strict cross-runtime determinism — deep key order does not affect bytes", () => {
    // Same content, opposite insertion order at every level.
    const a = { meta: { snapshotHash: "h", generatedAt: "t" }, observations: [{ a: 1, b: 2, c: { x: 1, y: 2 } }] };
    const b = { observations: [{ c: { y: 2, x: 1 }, b: 2, a: 1 }], meta: { generatedAt: "t", snapshotHash: "h" } };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("strict canonicalisation — undefined fields are omitted, never null/empty", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
    expect(canonicalStringify({ a: 1, b: undefined })).not.toMatch(/"b":/);
  });

  it("observations are passed through canonicalStringify (not raw JSON.stringify)", () => {
    const exp = serializeClinicalReport(report);
    // Each observation string must itself be canonical: parsing + re-canonicalising returns the same bytes.
    for (const s of exp.observations) {
      const parsed = JSON.parse(s);
      expect(canonicalStringify(parsed)).toBe(s);
    }
  });

  it("audit hash + meta hash copied exactly", () => {
    const exp = serializeClinicalReport(report);
    expect(exp.audit.snapshotHash).toBe(snapshot.snapshotHash);
    expect(exp.meta.snapshotHash).toBe(snapshot.snapshotHash);
  });

  it("observation order preserved verbatim (Phase 10 chronological)", () => {
    const exp = serializeClinicalReport(report);
    const ids = exp.observations.map((s) => (JSON.parse(s) as { symptomId: string }).symptomId);
    expect(ids).toEqual(report.observationsSection.observations.map((o) => o.symptomId));
  });

  it("differentials — members sorted lexicographically, resolved always false", () => {
    const exp = serializeClinicalReport(report);
    for (const g of exp.differentials) {
      expect(g.resolved).toBe(false);
      expect(g.members).toEqual([...g.members].sort());
    }
  });

  it("temporal qualifications copied verbatim (no reason inference)", () => {
    const exp = serializeClinicalReport(report);
    expect(exp.temporal).toEqual(
      report.temporalSection.qualifications.map((q) => ({
        diagnosisId: q.diagnosisId,
        diagnosisName: q.diagnosisName,
        temporalState: q.temporalState,
        reason: q.reason,
      })),
    );
  });

  it("clinician decisions — verbatim, missing rationale stays undefined", () => {
    const exp = serializeClinicalReport(report);
    const pdd = exp.clinicianDecisions?.find((c) => c.diagnosisId === "pdd")!;
    expect(pdd.conclusion).toBe("confirmed");
    expect(pdd.overrideFromSystem).toBe(false);
    expect(pdd.rationale).toBe("Per interview.");

    // When no conclusions exist, clinicianDecisions is undefined (no defaults).
    const replayNoDecision = buildClinicalReplay(
      buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, []),
    );
    const noDecisionSnap = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, []);
    const noDecisionReport = buildClinicalReport(noDecisionSnap, replayNoDecision);
    expect(serializeClinicalReport(noDecisionReport).clinicianDecisions).toBeUndefined();
  });

  it("diagnostic section — only spec-listed fields (no diagnosisName / clinicianConclusion)", () => {
    const allowed = new Set(["id", "semanticState", "candidacyState", "temporalQualification", "rationale"]);
    const exp = serializeClinicalReport(report);
    for (const d of exp.diagnoses) {
      for (const k of Object.keys(d)) expect(allowed.has(k)).toBe(true);
      // Required fields always present
      expect(d.id).toBeDefined();
      expect(d.semanticState).toBeDefined();
      expect(d.candidacyState).toBeDefined();
    }
  });

  it("changing clinical truth changes the stable string", () => {
    const other = buildClinicalReport(
      buildReportSnapshotV2(
        mk({ depressed_mood: { onsetDate: "2026-01-10" } }), // less evidence
        runClinicalOverlay(mk({ depressed_mood: { onsetDate: "2026-01-10" } })),
        { clientId: "c1", takenBy: "dr-a", takenAt: "2026-05-22T00:00:00Z" },
        [],
      ),
      buildClinicalReplay(
        buildReportSnapshotV2(
          mk({ depressed_mood: { onsetDate: "2026-01-10" } }),
          runClinicalOverlay(mk({ depressed_mood: { onsetDate: "2026-01-10" } })),
          { clientId: "c1", takenBy: "dr-a", takenAt: "2026-05-22T00:00:00Z" },
          [],
        ),
      ),
    );
    expect(stableClinicalReportString(serializeClinicalReport(report))).not.toBe(
      stableClinicalReportString(serializeClinicalReport(other)),
    );
  });

  it("strict boundary — no engine / bridge / semantics / constraints / temporal module imports", () => {
    const src = readFileSync(resolve(__dirname, "clinicalReportSerializer.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\.\/engine\//);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalBridge["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalSemantics["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalConstraints["']/);
    expect(src).not.toMatch(/from\s+["']\.\/clinicalTemporal["']/);
  });
});
