import { describe, it } from "vitest";
import { runClinicalOverlay } from "./clinicalBridge";
import { SYMPTOM_DSM_MAPPING } from "../data/symptomDomains";
import type { DSMAssessmentData, SymptomEntity } from "../types/dsm";

function present(ids: string[]): DSMAssessmentData {
  const symptoms: Record<string, SymptomEntity> = {};
  for (const id of ids) symptoms[id] = { id, symptomType: id, currentPresence: true, onsetDate: "2026-01-01" };
  return { symptoms, criterionAssessments: [], diagnosticInterpretations: [], timelineEvents: [] };
}

function run(n: number, label: string, ids: string[]) {
  const unmapped = ids.filter((id) => !(id in SYMPTOM_DSM_MAPPING));
  const o = runClinicalOverlay(present(ids));
  const states = o.states
    .filter((s) => s.state !== "excluded" && s.state !== "unlikely")
    .map((s) => `${s.diagnosisId}=${s.state}${s.differentialGroup ? `(${s.differentialGroup})` : ""}`);
  // eslint-disable-next-line no-console
  console.log(
    `\n#### CASE ${n} — ${label}\n` +
      `STATES: ${states.join(", ") || "—"}\n` +
      `UNMAPPED_INPUTS: ${unmapped.join(", ") || "none"}`,
  );
}

describe("12-case DSM overlap stress suite (observe only)", () => {
  it("runs all cases", () => {
    run(1, "Sleep Noise Trap", ["sleep_disturbance", "fatigue_energy_loss", "irritability", "concentration_difficulty"]);
    run(2, "Pure PTSD", ["flashbacks", "distress_to_cues", "cognitive_avoidance", "external_avoidance", "hypervigilance", "exaggerated_startle"]);
    run(3, "Depression no trauma", ["depressed_mood", "anhedonia", "fatigue_energy_loss", "sleep_disturbance"]);
    run(4, "ADHD vs Depression", ["concentration_difficulty", "mental_effort_avoidance", "low_motivation", "sleep_disturbance"]);
    run(5, "ADHD + Anxiety", ["concentration_difficulty", "restlessness", "excessive_worry", "sleep_disturbance", "irritability"]);
    run(6, "Autism vs ADHD", ["social_emotional_reciprocity", "nonverbal_communication_deficits", "relationship_deficits", "sensory_atypicality", "insistence_on_sameness", "attention_sustaining_difficulty"]);
    run(7, "Bipolar II vs MDD", ["depressed_mood", "anhedonia", "fatigue_energy_loss", "sleep_disturbance", "concentration_difficulty", "elevated_mood", "decreased_sleep_need", "risk_behaviours"]);
    run(8, "Substance-induced mood mimic", ["depressed_mood", "sleep_disturbance", "excessive_worry", "concentration_difficulty", "stud_withdrawal"]);
    run(9, "Somatic symptom overload", ["fatigue_energy_loss", "chronic_pain", "sleep_disturbance", "excessive_health_worry", "concentration_difficulty"]);
    run(10, "Mild stress reaction", ["sleep_disturbance", "irritability", "fatigue_energy_loss"]);
    run(11, "Complex comorbidity", ["concentration_difficulty", "depressed_mood", "cognitive_avoidance", "external_avoidance", "excessive_worry", "sleep_disturbance"]);
    run(12, "High noise low signal", ["sleep_disturbance", "fatigue_energy_loss", "irritability", "concentration_difficulty", "excessive_worry", "depressed_mood"]);
  });
});
