import { describe, it, expect } from "vitest";
import {
  generateAuditEnvelope,
  verifyAuditEnvelope,
  AUDIT_ALGORITHM,
  AUDIT_KEY_ID,
} from "./clinicalReportAudit";
import { serializeClinicalReport } from "./clinicalReportSerializer";
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
});
const overlay = runClinicalOverlay(assessment);
const snapshot = buildReportSnapshotV2(assessment, overlay, { clientId: "c1", takenBy: "dr-a", takenAt: "T" }, [
  { diagnosisId: "pdd", status: "confirmed" },
]);
const replay = buildClinicalReplay(snapshot);
const report = buildClinicalReport(snapshot, replay);
const exported = serializeClinicalReport(report);

describe("Phase 12 — cryptographic audit envelope", () => {
  it("envelope advertises HMAC-SHA256 + keyId", () => {
    const env = generateAuditEnvelope(exported);
    expect(env.algorithm).toBe(AUDIT_ALGORITHM);
    expect(env.algorithm).toBe("HMAC-SHA256");
    expect(env.keyId).toBe(AUDIT_KEY_ID);
  });

  it("reportHash is deterministic over the export bytes", () => {
    const a = generateAuditEnvelope(exported);
    const b = generateAuditEnvelope(exported);
    expect(a.reportHash).toBe(b.reportHash);
  });

  it("envelope schema is minimal — no signature field", () => {
    const env = generateAuditEnvelope(exported);
    expect(Object.keys(env).sort()).toEqual(["algorithm", "createdAt", "keyId", "reportHash"]);
    expect((env as Record<string, unknown>).signature).toBeUndefined();
  });

  it("verify returns true for an untampered envelope", () => {
    const env = generateAuditEnvelope(exported);
    expect(verifyAuditEnvelope(exported, env)).toBe(true);
  });

  it("verify returns false when the export is mutated (clinical content)", () => {
    const env = generateAuditEnvelope(exported);
    const tampered = {
      ...exported,
      diagnoses: [{ ...exported.diagnoses[0], semanticState: "likely" }],
    };
    expect(verifyAuditEnvelope(tampered, env)).toBe(false);
  });

  it("verify returns false when audit metadata is swapped (hash mismatch)", () => {
    const env = generateAuditEnvelope(exported);
    const bad = { ...env, reportHash: "0".repeat(env.reportHash.length) };
    expect(verifyAuditEnvelope(exported, bad)).toBe(false);
  });

  it("verify rejects a different algorithm", () => {
    const env = generateAuditEnvelope(exported);
    const bad = { ...env, algorithm: "SHA1" as never };
    expect(verifyAuditEnvelope(exported, bad)).toBe(false);
  });

  it("strict schema — verify rejects envelopes carrying a legacy signature field", () => {
    const env = generateAuditEnvelope(exported);
    const legacy = { ...env, signature: env.reportHash } as never;
    expect(verifyAuditEnvelope(exported, legacy)).toBe(false);
  });

  it("strict schema — verify rejects envelopes carrying any unknown field", () => {
    const env = generateAuditEnvelope(exported);
    const extra = { ...env, extra: "x" } as never;
    expect(verifyAuditEnvelope(exported, extra)).toBe(false);
  });

  it("any reordering of clinical content that changes the canonical bytes changes the hash", () => {
    const env = generateAuditEnvelope(exported);
    const reordered = {
      ...exported,
      // Add a benign field that changes canonical bytes (would be rejected by strict consumers).
      diagnoses: [...exported.diagnoses, { id: "_extra", semanticState: "x", candidacyState: "y" }] as typeof exported.diagnoses,
    };
    expect(verifyAuditEnvelope(reordered, env)).toBe(false);
  });

  it("does not mutate the export object", () => {
    const before = JSON.stringify(exported);
    generateAuditEnvelope(exported);
    verifyAuditEnvelope(exported, generateAuditEnvelope(exported));
    expect(JSON.stringify(exported)).toBe(before);
  });
});
