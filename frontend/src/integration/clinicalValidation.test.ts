import { describe, it, expect } from "vitest";
import { runClinicalOverlay } from "./clinicalBridge";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";

// Build a synthetic dsmAssessment where the given entity ids are present.
function presentOf(ids: string[], onset = "2026-01-01"): DSMAssessmentData {
  const symptoms: Record<string, SymptomEntity> = {};
  for (const id of ids) {
    symptoms[id] = { id, symptomType: id, currentPresence: true, onsetDate: onset };
  }
  return { symptoms, criterionAssessments: [], diagnosticInterpretations: [], timelineEvents: [] };
}

function report(label: string, ids: string[]) {
  const overlay = runClinicalOverlay(presentOf(ids));
  const fmt = (t: string) =>
    overlay.summaries
      .filter((s) => s.tier === t)
      .map(
        (s) =>
          `${s.diagnosisId}[cov=${s.coverage.toFixed(2)} ${s.metCriteria}/${s.totalCriteria}` +
          `${s.sharedEvidence ? " shared" : ""}]`,
      );
  const likely = fmt("likely");
  const contributing = fmt("contributing");
  const uncertain = overlay.summaries.filter((s) => s.tier === "uncertain").length;
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${label} (${ids.length} symptoms) ===\n` +
      `LIKELY:       ${likely.join(", ") || "—"}\n` +
      `CONTRIBUTING: ${contributing.join(", ") || "—"}\n` +
      `UNCERTAIN:    ${uncertain} suppressed`,
  );
  return overlay;
}

describe("clinical validation — observe current behaviour", () => {
  it("MDD full episode", () => {
    const o = report("MDD episode", [
      "depressed_mood", "anhedonia", "sleep_disturbance", "fatigue_energy_loss",
      "concentration_difficulty", "worthlessness_guilt", "appetite_weight_change",
    ]);
    expect(o).toBeTruthy();
  });

  it("PTSD trauma presentation", () => {
    report("PTSD", [
      "intrusive_memories", "flashbacks", "trauma_dreams", "distress_to_cues",
      "physiological_reactivity", "cognitive_avoidance", "external_avoidance",
      "negative_beliefs", "detachment", "hypervigilance", "exaggerated_startle",
      "irritability", "concentration_difficulty", "sleep_disturbance",
    ]);
  });

  it("ADHD inattentive trait", () => {
    report("ADHD", [
      "careless_mistakes", "attention_sustaining_difficulty", "listening_difficulty",
      "task_completion_difficulty", "organization_difficulty", "easily_distracted",
      "forgetfulness",
    ]);
  });

  it("GAD presentation", () => {
    report("GAD", [
      "excessive_worry", "difficulty_controlling_worry", "restlessness",
      "muscle_tension", "fatigue_energy_loss", "concentration_difficulty",
      "irritability", "sleep_disturbance",
    ]);
  });

  it("single shared somatic symptom (sleep only) — explosion probe", () => {
    report("sleep_disturbance ONLY", ["sleep_disturbance"]);
  });

  it("two somatic symptoms (sleep + concentration) — explosion probe", () => {
    report("sleep + concentration ONLY", ["sleep_disturbance", "concentration_difficulty"]);
  });
});
