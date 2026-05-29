import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  stableClinicalReportString,
  canonicalStringify,
  type ClinicalReportExportV1,
} from "./clinicalReportSerializer";
import {
  generateAuditEnvelope,
  verifyAuditEnvelope,
  type AuditEnvelopeV1,
} from "./clinicalReportAudit";
import { diffClinicalReports } from "./clinicalReportDiff";
import { diffClinicalReportSequence } from "./clinicalReportReplayDiff";

// ── Synthetic dataset — fully deterministic, no runtime values ────────────────
// Three chronological exports encoding the spec's required structural changes:
//   r1 → r2: added observation; pdd semanticState changes; temporal flips
//            unknown → supported
//   r2 → r3: clinician decision added; pdd state advances; audit.replayHash
//            appears (presence change — undefined → present)
function obs(o: Record<string, unknown>): string {
  return canonicalStringify(o);
}

const R1: ClinicalReportExportV1 = {
  version: "1.0.0",
  meta: { snapshotHash: "h1", generatedAt: "T1" },
  observations: [
    obs({ symptomId: "depressed_mood", symptomName: "depressed_mood", presence: "present" }),
  ],
  diagnoses: [
    { id: "mdd", semanticState: "subthreshold", candidacyState: "approaching_threshold" },
    { id: "pdd", semanticState: "possible", candidacyState: "approaching_threshold" },
  ],
  differentials: [{ groupId: "mood_polarity", members: ["mdd", "pdd"], resolved: false }],
  temporal: [
    {
      diagnosisId: "pdd",
      diagnosisName: "PDD",
      temporalState: "temporally_unknown",
      reason: "≥2-year chronicity not documented",
    },
  ],
  clinicianDecisions: undefined,
  audit: { snapshotHash: "h1", generatedAt: "T1" },
};

const R2: ClinicalReportExportV1 = {
  version: "1.0.0",
  meta: { snapshotHash: "h2", generatedAt: "T2" },
  observations: [
    obs({ symptomId: "depressed_mood", symptomName: "depressed_mood", presence: "present" }),
    obs({ symptomId: "anhedonia", symptomName: "anhedonia", presence: "present" }),
  ],
  diagnoses: [
    { id: "mdd", semanticState: "differential_primary", candidacyState: "approaching_threshold" },
    { id: "pdd", semanticState: "differential_primary", candidacyState: "threshold_likely_met" },
  ],
  differentials: [{ groupId: "mood_polarity", members: ["mdd", "pdd"], resolved: false }],
  temporal: [
    {
      diagnosisId: "pdd",
      diagnosisName: "PDD",
      temporalState: "temporally_supported",
      reason: "Documented depressed-mood duration ≥ 2 years",
    },
  ],
  clinicianDecisions: undefined,
  audit: { snapshotHash: "h2", generatedAt: "T2" },
};

const R3: ClinicalReportExportV1 = {
  version: "1.0.0",
  meta: { snapshotHash: "h3", generatedAt: "T3" },
  observations: [
    obs({ symptomId: "depressed_mood", symptomName: "depressed_mood", presence: "present" }),
    obs({ symptomId: "anhedonia", symptomName: "anhedonia", presence: "present" }),
  ],
  diagnoses: [
    { id: "mdd", semanticState: "subthreshold", candidacyState: "approaching_threshold" },
    { id: "pdd", semanticState: "likely", candidacyState: "threshold_likely_met", rationale: "Chronicity met" },
  ],
  differentials: [{ groupId: "mood_polarity", members: ["mdd", "pdd"], resolved: false }],
  temporal: [
    {
      diagnosisId: "pdd",
      diagnosisName: "PDD",
      temporalState: "temporally_supported",
      reason: "Documented depressed-mood duration ≥ 2 years",
    },
  ],
  clinicianDecisions: [
    { diagnosisId: "pdd", diagnosisName: "PDD", conclusion: "confirmed", overrideFromSystem: false },
  ],
  audit: { snapshotHash: "h3", generatedAt: "T3", replayHash: "r-3" }, // presence change
};

const SERIES: readonly ClinicalReportExportV1[] = [R1, R2, R3];

// Strip the only legitimate runtime field (envelope.createdAt) before golden
// comparison so the golden file stays byte-stable.
function stripEnvelopeRuntime(e: AuditEnvelopeV1) {
  return { ...e, createdAt: "T-RUNTIME" };
}

const GOLDEN_PATH = resolve(__dirname, "__fixtures__/goldenPipelineOutput.json");

type GoldenShape = {
  stableStrings: string[];
  envelopes: ReturnType<typeof stripEnvelopeRuntime>[];
  stepwiseDiffs: ReturnType<typeof diffClinicalReports>[];
  replay: ReturnType<typeof diffClinicalReportSequence>;
};

let computedGolden: GoldenShape;

beforeAll(() => {
  const stableStrings = SERIES.map(stableClinicalReportString);
  const envelopes = SERIES.map(generateAuditEnvelope).map(stripEnvelopeRuntime);
  const stepwiseDiffs = [diffClinicalReports(R1, R2), diffClinicalReports(R2, R3)];
  const replay = diffClinicalReportSequence(SERIES);
  computedGolden = { stableStrings, envelopes, stepwiseDiffs, replay };

  if (!existsSync(GOLDEN_PATH)) {
    mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
    writeFileSync(GOLDEN_PATH, JSON.stringify(computedGolden, null, 2));
  }
});

// ── Phase 11/12 — serialize + envelope + verify per snapshot ──────────────────
describe("Phase 15 — end-to-end pipeline (Phase 11 → 12)", () => {
  it("each snapshot serializes to a stable string and verifies under its envelope", () => {
    for (const r of SERIES) {
      const env = generateAuditEnvelope(r);
      expect(verifyAuditEnvelope(r, env)).toBe(true);
      // Repeated serialization is byte-identical.
      expect(stableClinicalReportString(r)).toBe(stableClinicalReportString(r));
    }
  });

  it("pipeline is pure — no input mutation across all phases", () => {
    const before = JSON.stringify(SERIES);
    SERIES.forEach((r) => {
      const env = generateAuditEnvelope(r);
      verifyAuditEnvelope(r, env);
      stableClinicalReportString(r);
    });
    diffClinicalReports(R1, R2);
    diffClinicalReportSequence(SERIES);
    expect(JSON.stringify(SERIES)).toBe(before);
  });
});

// ── Phase 13 — stepwise diff validation ───────────────────────────────────────
describe("Phase 15 — stepwise structural diff (Phase 13)", () => {
  it("adjacent diffs are deterministic and lexicographically ordered", () => {
    for (let i = 0; i + 1 < SERIES.length; i++) {
      const a = diffClinicalReports(SERIES[i], SERIES[i + 1]);
      const b = diffClinicalReports(SERIES[i], SERIES[i + 1]);
      expect(a).toEqual(b);
      expect(a.changedSections.map((c) => c.path)).toEqual(
        [...a.changedSections.map((c) => c.path)].sort(),
      );
      expect(a.addedFields.map((f) => f.path)).toEqual(
        [...a.addedFields.map((f) => f.path)].sort(),
      );
    }
  });

  it("R2→R3 surfaces the added clinicianDecisions and audit.replayHash", () => {
    const d = diffClinicalReports(R2, R3);
    expect(d.identical).toBe(false);
    expect(d.addedFields.some((f) => f.path.startsWith("clinicianDecisions"))).toBe(true);
    expect(d.addedFields.some((f) => f.path === "audit.replayHash")).toBe(true);
  });
});

// ── Phase 14 — replay evolution validation ────────────────────────────────────
describe("Phase 15 — replay evolution (Phase 14)", () => {
  it("invariantPaths and volatilePaths reflect the synthetic changes", () => {
    const r = diffClinicalReportSequence(SERIES);
    expect(r.identicalAcrossAll).toBe(false);
    // version is constant across the series
    expect(r.invariantPaths).toContain("version");
    // hash + temporal + observations all change → volatile
    expect(r.volatilePaths).toContain("meta.snapshotHash");
    expect(r.volatilePaths).toContain("audit.snapshotHash");
    expect(r.volatilePaths.some((p) => p.startsWith("temporal["))).toBe(true);
    expect(r.volatilePaths.some((p) => p.startsWith("observations["))).toBe(true);
    // presence-change → volatile
    expect(r.volatilePaths).toContain("audit.replayHash");
    // no overlap
    const overlap = r.invariantPaths.filter((p) => r.volatilePaths.includes(p));
    expect(overlap).toEqual([]);
  });

  it("step hashes chain chronologically using audit.snapshotHash", () => {
    const r = diffClinicalReportSequence(SERIES);
    expect(r.steps.map((s) => `${s.fromHash}→${s.toHash}`)).toEqual(["h1→h2", "h2→h3"]);
  });
});

// ── Golden regression lock ────────────────────────────────────────────────────
describe("Phase 15 — golden pipeline output", () => {
  it("matches the committed golden snapshot byte-for-byte", () => {
    expect(existsSync(GOLDEN_PATH)).toBe(true);
    const expected = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    expect(computedGolden).toEqual(expected);
  });
});

// ── Negative / determinism guarantees ─────────────────────────────────────────
describe("Phase 15 — negative & determinism", () => {
  it("modified reportHash → verification fails", () => {
    const env = generateAuditEnvelope(R1);
    const tampered = { ...env, reportHash: "0".repeat(env.reportHash.length) };
    expect(verifyAuditEnvelope(R1, tampered)).toBe(false);
  });

  it("reordered object keys (semantically equivalent) → identical hash", () => {
    const env1 = generateAuditEnvelope(R1);
    const reordered: ClinicalReportExportV1 = {
      audit: { generatedAt: R1.audit.generatedAt, snapshotHash: R1.audit.snapshotHash },
      observations: R1.observations,
      meta: { generatedAt: R1.meta.generatedAt, snapshotHash: R1.meta.snapshotHash },
      temporal: R1.temporal,
      differentials: R1.differentials,
      diagnoses: R1.diagnoses,
      version: R1.version,
      clinicianDecisions: R1.clinicianDecisions,
    };
    const env2 = generateAuditEnvelope(reordered);
    expect(env1.reportHash).toBe(env2.reportHash);
  });

  it("swapped observation order → different hash", () => {
    const env2 = generateAuditEnvelope(R2);
    const swapped: ClinicalReportExportV1 = { ...R2, observations: [...R2.observations].reverse() };
    const envSwapped = generateAuditEnvelope(swapped);
    expect(env2.reportHash).not.toBe(envSwapped.reportHash);
  });

  it("undefined-vs-null is detected by Phase 13 (present null ≠ absent)", () => {
    const withNullReplayHash: ClinicalReportExportV1 = {
      ...R1,
      audit: { ...R1.audit, replayHash: null as unknown as string },
    };
    const d = diffClinicalReports(R1, withNullReplayHash);
    const added = d.addedFields.find((f) => f.path === "audit.replayHash");
    expect(added).toBeDefined();
    expect(added?.value).toBeNull();
  });

  it("entire pipeline is deterministic across repeated full runs", () => {
    const run = () => ({
      stableStrings: SERIES.map(stableClinicalReportString),
      hashes: SERIES.map((r) => generateAuditEnvelope(r).reportHash),
      replay: diffClinicalReportSequence(SERIES),
    });
    expect(run()).toEqual(run());
  });
});
