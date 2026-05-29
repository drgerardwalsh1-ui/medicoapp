import { describe, it, expect } from "vitest";
import { diffClinicalReports } from "./clinicalReportDiff";
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

function exportOf(assessment: DSMAssessmentData, conclusions: { diagnosisId: string; status: "confirmed" | "rejected" | "deferred" }[] = []) {
  const overlay = runClinicalOverlay(assessment);
  const snap = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, conclusions);
  const replay = buildClinicalReplay(snap);
  return serializeClinicalReport(buildClinicalReport(snap, replay));
}

const base = exportOf(mk({ depressed_mood: { onsetDate: "2026-01-10" }, anhedonia: {} }));

describe("Phase 13 — forensic structural diff", () => {
  it("identical reports → identical=true and all groups empty", () => {
    const d = diffClinicalReports(base, base);
    expect(d.identical).toBe(true);
    expect(d.changedSections).toEqual([]);
    expect(d.addedFields).toEqual([]);
    expect(d.removedFields).toEqual([]);
  });

  it("changed leaf value is reported as changedSections (with section + before/after)", () => {
    const target: ClinicalReportExportV1 = { ...base, meta: { ...base.meta, snapshotHash: "DIFFERENT" } };
    const d = diffClinicalReports(base, target);
    expect(d.identical).toBe(false);
    const change = d.changedSections.find((c) => c.path === "meta.snapshotHash");
    expect(change).toBeDefined();
    expect(change?.section).toBe("meta");
    expect(change?.before).toBe(base.meta.snapshotHash);
    expect(change?.after).toBe("DIFFERENT");
  });

  it("array index-by-index — observations longer in target → addedFields", () => {
    const extra = { ...base, observations: [...base.observations, '{"symptomId":"new"}'] };
    const d = diffClinicalReports(base, extra);
    const added = d.addedFields.find((f) => f.path === `observations[${base.observations.length}]`);
    expect(added).toBeDefined();
  });

  it("array index-by-index — observations shorter in target → removedFields", () => {
    const shorter = { ...base, observations: base.observations.slice(0, base.observations.length - 1) };
    const d = diffClinicalReports(base, shorter);
    const removed = d.removedFields.find((f) => f.path === `observations[${base.observations.length - 1}]`);
    expect(removed).toBeDefined();
  });

  it("new field in object → addedFields; removed field → removedFields", () => {
    const target = { ...base, audit: { ...base.audit, replayHash: "r-1" } };
    const d = diffClinicalReports(base, target);
    expect(d.addedFields.some((f) => f.path === "audit.replayHash")).toBe(true);
    const back = diffClinicalReports(target, base);
    expect(back.removedFields.some((f) => f.path === "audit.replayHash")).toBe(true);
  });

  it("differential members compared as ordered arrays — sort applied by Phase 11, diff by index", () => {
    if (base.differentials.length === 0) return; // no differentials in this fixture
    const target = { ...base, differentials: base.differentials.map((g) => ({ ...g, members: [...g.members].reverse() })) };
    const d = diffClinicalReports(base, target);
    // Phase 11 already sorts members lexicographically, so reversing then re-sorting would match.
    // Here we feed the diff directly — index-by-index reversal IS visible as changes.
    expect(d.identical).toBe(false);
  });

  it("undefined ≠ null — null leaf vs missing leaf is treated as add/remove, not change", () => {
    const target = { ...base, audit: { ...base.audit, replayHash: null as unknown as string } };
    const d = diffClinicalReports(base, target);
    // base lacks replayHash (undefined → absent); target has null (present) → addedFields with null value
    const added = d.addedFields.find((f) => f.path === "audit.replayHash");
    expect(added).toBeDefined();
    expect(added?.value).toBeNull();
  });

  it("deterministic output ordering — paths sorted lexicographically within each group", () => {
    const target = {
      ...base,
      meta: { ...base.meta, snapshotHash: "X", generatedAt: "Y" },
      audit: { ...base.audit, snapshotHash: "X", generatedAt: "Y" },
    };
    const d = diffClinicalReports(base, target);
    expect(d.changedSections.map((c) => c.path)).toEqual([...d.changedSections.map((c) => c.path)].sort());
    expect(d.addedFields.map((f) => f.path)).toEqual([...d.addedFields.map((f) => f.path)].sort());
    expect(d.removedFields.map((f) => f.path)).toEqual([...d.removedFields.map((f) => f.path)].sort());
  });

  it("does not mutate inputs (pure)", () => {
    const a = JSON.stringify(base);
    const target = exportOf(mk({ depressed_mood: { onsetDate: "2026-02-02" } }));
    const b = JSON.stringify(target);
    diffClinicalReports(base, target);
    expect(JSON.stringify(base)).toBe(a);
    expect(JSON.stringify(target)).toBe(b);
  });

  it("two structurally equal exports built independently are identical", () => {
    const a = exportOf(mk({ depressed_mood: {}, anhedonia: {} }));
    const b = exportOf(mk({ depressed_mood: {}, anhedonia: {} }));
    // Strip the only legitimately runtime fields before comparing (generatedAt).
    const strip = (e: ClinicalReportExportV1) => ({
      ...e,
      meta: { ...e.meta, generatedAt: "T" },
      audit: { ...e.audit, generatedAt: "T" },
    });
    expect(diffClinicalReports(strip(a), strip(b)).identical).toBe(true);
  });
});
