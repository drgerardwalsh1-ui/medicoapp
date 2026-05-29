import { describe, it, expect } from "vitest";
import { interpretSemanticStates, type SemanticsInput } from "./clinicalSemantics";
import type { DiagnosisCandidacy, CriterionSuggestion } from "../engine/recompute";
import type { DiagnosisSummary } from "./clinicalBridge";
import type { ConstraintDecision } from "./clinicalConstraints";

function cand(diagnosisId: string, state: DiagnosisCandidacy["state"]): DiagnosisCandidacy {
  return { diagnosisId: diagnosisId as never, state, temporalCoOccurrenceSupported: true, sharedEvidence: true };
}
function summ(diagnosisId: string, tier: DiagnosisSummary["tier"], state: DiagnosisCandidacy["state"]): DiagnosisSummary {
  return { diagnosisId, name: diagnosisId, state, coverage: tier === "likely" ? 1 : tier === "contributing" ? 0.6 : 0.3, metCriteria: 1, totalCriteria: 1, sharedEvidence: true, tier };
}
const base = (over: Partial<SemanticsInput>): SemanticsInput => ({
  candidacies: [],
  suggestions: [] as CriterionSuggestion[],
  decisions: [] as ConstraintDecision[],
  summaries: [],
  diagnosisNames: {},
  ...over,
});
const stateOf = (rs: readonly { diagnosisId: string; state: string }[], id: string) =>
  rs.find((r) => r.diagnosisId === id)?.state;

describe("semantics — base state mapping", () => {
  it("threshold met → likely; contributing → possible; uncertain → subthreshold", () => {
    const rs = interpretSemanticStates(base({
      candidacies: [cand("ocd", "threshold_likely_met"), cand("ssd", "approaching_threshold"), cand("gad", "approaching_threshold")],
      summaries: [summ("ocd", "likely", "threshold_likely_met"), summ("ssd", "contributing", "approaching_threshold"), summ("gad", "uncertain", "approaching_threshold")],
      diagnosisNames: { ocd: "OCD", ssd: "SSD", gad: "GAD" },
    }));
    expect(stateOf(rs, "ocd")).toBe("likely");
    expect(stateOf(rs, "ssd")).toBe("possible");
    expect(stateOf(rs, "gad")).toBe("subthreshold");
  });

  it("constraint suppression → excluded vs rule_out by reason", () => {
    const rs = interpretSemanticStates(base({
      candidacies: [cand("mdd", "approaching_threshold"), cand("pdd", "approaching_threshold")],
      decisions: [
        { diagnosisId: "mdd", suppressed: true, reason: "Manic/hypomanic features present — rule out bipolar before unipolar depression" },
        { diagnosisId: "pdd", suppressed: true, reason: "No depressed mood present (PDD Criterion A)" },
      ],
      diagnosisNames: { mdd: "MDD", pdd: "PDD" },
    }));
    expect(stateOf(rs, "mdd")).toBe("rule_out");
    expect(stateOf(rs, "pdd")).toBe("excluded");
  });
});

describe("semantics — ambiguity preservation (differentials)", () => {
  it("two strong mood members → BOTH differential_primary (never collapsed)", () => {
    const rs = interpretSemanticStates(base({
      candidacies: [cand("mdd", "approaching_threshold"), cand("pdd", "threshold_likely_met")],
      summaries: [summ("mdd", "likely", "approaching_threshold"), summ("pdd", "likely", "threshold_likely_met")],
      diagnosisNames: { mdd: "MDD", pdd: "PDD" },
    }));
    expect(stateOf(rs, "mdd")).toBe("differential_primary");
    expect(stateOf(rs, "pdd")).toBe("differential_primary");
    expect(rs.find((r) => r.diagnosisId === "mdd")?.differentialGroup).toBe("mood_polarity");
  });

  it("two co-possible trauma members are grouped but NOT over-elevated", () => {
    const rs = interpretSemanticStates(base({
      candidacies: [cand("ptsd", "approaching_threshold"), cand("asd", "approaching_threshold")],
      summaries: [summ("ptsd", "contributing", "approaching_threshold"), summ("asd", "contributing", "approaching_threshold")],
      diagnosisNames: { ptsd: "PTSD", asd: "ASD" },
    }));
    expect(stateOf(rs, "ptsd")).toBe("possible");
    expect(stateOf(rs, "asd")).toBe("possible");
    expect(rs.find((r) => r.diagnosisId === "ptsd")?.differentialGroup).toBe("trauma_acuity");
  });
});
