import { describe, it, expect } from "vitest";
import { isEligible, applyConstraints } from "./clinicalConstraints";

const set = (...ids: string[]) => new Set(ids);
const suppressed = (cands: string[], present: Set<string>) =>
  applyConstraints(cands.map((diagnosisId) => ({ diagnosisId })), present)
    .filter((d) => d.suppressed)
    .map((d) => d.diagnosisId)
    .sort();

describe("constraint layer — hard gates (binary eligibility)", () => {
  it("MDD requires depressed mood OR anhedonia", () => {
    expect(isEligible("mdd", set("depressed_mood"))).toBe(true);
    expect(isEligible("mdd", set("anhedonia"))).toBe(true);
    expect(isEligible("mdd", set("sleep_disturbance", "fatigue_energy_loss"))).toBe(false);
  });

  it("PDD requires depressed mood", () => {
    expect(isEligible("pdd", set("depressed_mood"))).toBe(true);
    expect(isEligible("pdd", set("sleep_disturbance", "fatigue_energy_loss"))).toBe(false);
  });

  it("PTSD requires an intrusion symptom (avoidance alone is ineligible)", () => {
    expect(isEligible("ptsd", set("flashbacks"))).toBe(true);
    expect(isEligible("ptsd", set("cognitive_avoidance", "external_avoidance"))).toBe(false);
  });

  it("SSD requires a Criterion B response (fatigue/pain alone ineligible)", () => {
    expect(isEligible("ssd", set("fatigue_energy_loss", "chronic_pain"))).toBe(false);
    expect(isEligible("ssd", set("chronic_pain", "excessive_health_worry"))).toBe(true);
  });

  it("unconstrained diagnoses default to eligible", () => {
    expect(isEligible("ocd", set("intrusive_thoughts"))).toBe(true);
  });
});

describe("constraint layer — mutual exclusivity & cause-based suppression", () => {
  it("manic features suppress unipolar depression", () => {
    const s = suppressed(["mdd", "pdd", "bd2"], set("depressed_mood", "elevated_mood"));
    expect(s).toContain("mdd");
    expect(s).toContain("pdd");
    expect(s).not.toContain("bd2");
  });

  it("residual category suppressed when a specific in family is eligible", () => {
    const s = suppressed(["ssd", "ossrd"], set("chronic_pain", "excessive_health_worry"));
    expect(s).toContain("ossrd");
    expect(s).not.toContain("ssd");
  });

  it("active withdrawal suppresses primary mood/anxiety", () => {
    const s = suppressed(["mdd", "gad", "stud"], set("depressed_mood", "excessive_worry", "stud_withdrawal"));
    expect(s).toContain("mdd");
    expect(s).toContain("gad");
    expect(s).not.toContain("stud");
  });

  it("is a pure function — no mutation of inputs", () => {
    const cands = [{ diagnosisId: "mdd" }];
    const present = set("sleep_disturbance");
    const snapshot = JSON.stringify(cands);
    applyConstraints(cands, present);
    expect(JSON.stringify(cands)).toBe(snapshot);
  });
});
