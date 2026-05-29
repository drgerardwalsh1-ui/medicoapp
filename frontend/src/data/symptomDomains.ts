// ── Diagnosis-agnostic symptom domain taxonomy ────────────────────────────────
// Structured by clinical domain, NOT by diagnosis.
// Each symptom links to a shared SymptomEntity ID — the same store used by DSM.
// Editing here and editing in DSM Assessment both write to the same entity.

import type { DSMSymptomDef } from "../types/dsm";

// ── Domain definition ─────────────────────────────────────────────────────────

// Optional sub-section grouping within a domain. Used for Substance Use
// to display Alcohol / Cannabis / Opioid / … as separate headed groups
// within the single "Substance Use" domain.
export type SymptomDomainSection = {
  id: string;
  label: string;
  // If true, an inline text input lets the clinician rename this section.
  // The custom name is stored in SymptomEntity.customLabel for the lead
  // entity (first symptomEntityId in the section).
  editableLabel?: boolean;
  symptomEntityIds: string[]; // must be a subset of domain.symptoms[*].symptomEntityId
};

export type SymptomDomain = {
  id: string;
  label: string;
  symptoms: DSMSymptomDef[];
  sections?: SymptomDomainSection[]; // optional sub-group headers
};

// ── DSM criterion mapping ─────────────────────────────────────────────────────
// Which DSM criteria map to each symptom entity ID.
// Used to show "evidence present" indicator on the DSM Assessment page.
// NEVER auto-marks criteria as "met" — clinician must confirm.

export type DSMCriterionRef = {
  diagnosisId: string;
  criterionId: string;
  symptomDefId: string;
};

export const SYMPTOM_DSM_MAPPING: Record<string, DSMCriterionRef[]> = {
  // ── Mood disorders ────────────────────────────────────────────────────────
  depressed_mood: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a1" },
    { diagnosisId: "pdd", criterionId: "A", symptomDefId: "pdd_a1" },
  ],
  anhedonia: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a2" },
    { diagnosisId: "ptsd", criterionId: "D", symptomDefId: "ptsd_d5" },
  ],
  appetite_weight_change: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a3" },
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b1" },
  ],
  sleep_disturbance: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a4" },
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b2" },
    { diagnosisId: "ptsd", criterionId: "E", symptomDefId: "ptsd_e6" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b11" },
    { diagnosisId: "gad", criterionId: "C", symptomDefId: "gad_c6" },
  ],
  psychomotor_disturbance: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a5" },
  ],
  fatigue_energy_loss: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a6" },
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b3" },
    { diagnosisId: "gad", criterionId: "C", symptomDefId: "gad_c2" },
    { diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" },
  ],
  worthlessness_guilt: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a7" },
  ],
  concentration_difficulty: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a8" },
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b5" },
    { diagnosisId: "ptsd", criterionId: "E", symptomDefId: "ptsd_e5" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b14" },
    { diagnosisId: "gad", criterionId: "C", symptomDefId: "gad_c3" },
  ],
  suicidal_ideation: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a9" },
  ],
  low_self_esteem: [
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b4" },
  ],
  hopelessness: [
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b6" },
  ],
  // ── PTSD Criterion B — Intrusion ─────────────────────────────────────────
  intrusive_memories: [
    { diagnosisId: "ptsd", criterionId: "B", symptomDefId: "ptsd_b1" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b1" },
  ],
  trauma_dreams: [
    { diagnosisId: "ptsd", criterionId: "B", symptomDefId: "ptsd_b2" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b2" },
  ],
  flashbacks: [
    { diagnosisId: "ptsd", criterionId: "B", symptomDefId: "ptsd_b3" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b3" },
  ],
  distress_to_cues: [
    { diagnosisId: "ptsd", criterionId: "B", symptomDefId: "ptsd_b4" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b4" },
  ],
  physiological_reactivity: [
    { diagnosisId: "ptsd", criterionId: "B", symptomDefId: "ptsd_b5" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b5" },
  ],
  // ── PTSD Criterion C — Avoidance ─────────────────────────────────────────
  cognitive_avoidance: [
    { diagnosisId: "ptsd", criterionId: "C", symptomDefId: "ptsd_c1" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b9" },
  ],
  external_avoidance: [
    { diagnosisId: "ptsd", criterionId: "C", symptomDefId: "ptsd_c2" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b10" },
  ],
  // ── PTSD Criterion D — Negative cognitions / mood ────────────────────────
  dissociative_amnesia: [
    { diagnosisId: "ptsd", criterionId: "D", symptomDefId: "ptsd_d1" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b8" },
    { diagnosisId: "damn", criterionId: "A", symptomDefId: "damn_a1" },
  ],
  negative_beliefs: [
    { diagnosisId: "ptsd", criterionId: "D", symptomDefId: "ptsd_d2" },
  ],
  distorted_blame: [
    { diagnosisId: "ptsd", criterionId: "D", symptomDefId: "ptsd_d3" },
  ],
  persistent_negative_emotion: [
    { diagnosisId: "ptsd", criterionId: "D", symptomDefId: "ptsd_d4" },
  ],
  detachment: [
    { diagnosisId: "ptsd", criterionId: "D", symptomDefId: "ptsd_d6" },
  ],
  inability_positive_emotions: [
    { diagnosisId: "ptsd", criterionId: "D", symptomDefId: "ptsd_d7" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b6" },
  ],
  // ── PTSD Criterion E — Arousal / reactivity ──────────────────────────────
  irritability: [
    { diagnosisId: "ptsd", criterionId: "E", symptomDefId: "ptsd_e1" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b12" },
    { diagnosisId: "gad", criterionId: "C", symptomDefId: "gad_c4" },
  ],
  reckless_behaviour: [
    { diagnosisId: "ptsd", criterionId: "E", symptomDefId: "ptsd_e2" },
  ],
  hypervigilance: [
    { diagnosisId: "ptsd", criterionId: "E", symptomDefId: "ptsd_e3" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b13" },
  ],
  exaggerated_startle: [
    { diagnosisId: "ptsd", criterionId: "E", symptomDefId: "ptsd_e4" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b15" },
  ],
  // ── ASD-specific dissociative symptoms ──────────────────────────────────
  depersonalization: [
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b7" },
    { diagnosisId: "dpdr", criterionId: "A", symptomDefId: "dpdr_a1" },
  ],
  // ── Eating Disorders ─────────────────────────────────────────────────────
  food_restriction: [
    { diagnosisId: "an", criterionId: "A", symptomDefId: "an_a1" },
  ],
  low_body_weight: [
    { diagnosisId: "an", criterionId: "A", symptomDefId: "an_a2" },
  ],
  fear_weight_gain: [
    { diagnosisId: "an", criterionId: "B", symptomDefId: "an_b1" },
  ],
  weight_interfering_behaviour: [
    { diagnosisId: "an", criterionId: "B", symptomDefId: "an_b2" },
  ],
  body_image_disturbance: [
    { diagnosisId: "an",  criterionId: "C", symptomDefId: "an_c1" },
    { diagnosisId: "bn",  criterionId: "D", symptomDefId: "bn_d2" },
  ],
  lack_insight_low_weight: [
    { diagnosisId: "an", criterionId: "C", symptomDefId: "an_c2" },
  ],
  binge_eating: [
    { diagnosisId: "bn",  criterionId: "A", symptomDefId: "bn_a1" },
    { diagnosisId: "bed", criterionId: "A", symptomDefId: "bed_a1" },
  ],
  loss_of_control_eating: [
    { diagnosisId: "bn",  criterionId: "A", symptomDefId: "bn_a2" },
    { diagnosisId: "bed", criterionId: "A", symptomDefId: "bed_a2" },
  ],
  compensatory_vomiting: [
    { diagnosisId: "bn", criterionId: "B", symptomDefId: "bn_b1" },
  ],
  laxative_misuse: [
    { diagnosisId: "bn", criterionId: "B", symptomDefId: "bn_b2" },
  ],
  compensatory_fasting: [
    { diagnosisId: "bn", criterionId: "B", symptomDefId: "bn_b3" },
  ],
  excessive_exercise: [
    { diagnosisId: "bn", criterionId: "B", symptomDefId: "bn_b4" },
  ],
  weight_shape_overvaluation: [
    { diagnosisId: "bn", criterionId: "D", symptomDefId: "bn_d1" },
  ],
  rapid_eating: [
    { diagnosisId: "bed", criterionId: "B", symptomDefId: "bed_b1" },
  ],
  eating_until_full: [
    { diagnosisId: "bed", criterionId: "B", symptomDefId: "bed_b2" },
  ],
  eating_when_not_hungry: [
    { diagnosisId: "bed", criterionId: "B", symptomDefId: "bed_b3" },
  ],
  eating_in_secret: [
    { diagnosisId: "bed", criterionId: "B", symptomDefId: "bed_b4" },
  ],
  guilt_after_eating: [
    { diagnosisId: "bed", criterionId: "B", symptomDefId: "bed_b5" },
  ],
  eating_distress: [
    { diagnosisId: "bed", criterionId: "C", symptomDefId: "bed_c1" },
  ],
  // night_eating and purging_without_binge map to OSFED (differential criterion — clinician-assessed)
  night_eating: [],
  purging_without_binge: [],
  // ── Alcohol Use Disorder — Criterion A ──────────────────────────────────
  aud_larger_longer:       [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a1" }],
  aud_cut_down:            [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a2" }],
  aud_time_spent:          [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a3" }],
  aud_craving:             [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a4" }],
  aud_role_failure:        [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a5" }],
  aud_social_problems:     [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a6" }],
  aud_activities_given_up: [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a7" }],
  aud_hazardous_use:       [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a8" }],
  aud_continued_harm:      [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a9" }],
  aud_tolerance:           [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a10" }],
  aud_withdrawal:          [{ diagnosisId: "aud", criterionId: "A", symptomDefId: "aud_a11" }],
  // ── Cannabis Use Disorder — Criterion A ─────────────────────────────────
  cud_larger_longer:       [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a1" }],
  cud_cut_down:            [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a2" }],
  cud_time_spent:          [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a3" }],
  cud_craving:             [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a4" }],
  cud_role_failure:        [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a5" }],
  cud_social_problems:     [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a6" }],
  cud_activities_given_up: [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a7" }],
  cud_hazardous_use:       [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a8" }],
  cud_continued_harm:      [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a9" }],
  cud_tolerance:           [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a10" }],
  cud_withdrawal:          [{ diagnosisId: "cud", criterionId: "A", symptomDefId: "cud_a11" }],
  // ── Opioid Use Disorder — Criterion A ───────────────────────────────────
  oud_larger_longer:       [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a1" }],
  oud_cut_down:            [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a2" }],
  oud_time_spent:          [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a3" }],
  oud_craving:             [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a4" }],
  oud_role_failure:        [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a5" }],
  oud_social_problems:     [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a6" }],
  oud_activities_given_up: [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a7" }],
  oud_hazardous_use:       [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a8" }],
  oud_continued_harm:      [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a9" }],
  oud_tolerance:           [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a10" }],
  oud_withdrawal:          [{ diagnosisId: "oud", criterionId: "A", symptomDefId: "oud_a11" }],
  // ── Sedative/Hypnotic/Anxiolytic Use Disorder — Criterion A ─────────────
  shaud_larger_longer:       [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a1" }],
  shaud_cut_down:            [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a2" }],
  shaud_time_spent:          [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a3" }],
  shaud_craving:             [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a4" }],
  shaud_role_failure:        [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a5" }],
  shaud_social_problems:     [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a6" }],
  shaud_activities_given_up: [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a7" }],
  shaud_hazardous_use:       [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a8" }],
  shaud_continued_harm:      [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a9" }],
  shaud_tolerance:           [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a10" }],
  shaud_withdrawal:          [{ diagnosisId: "shaud", criterionId: "A", symptomDefId: "shaud_a11" }],
  // ── Stimulant Use Disorder — Criterion A ────────────────────────────────
  stud_larger_longer:       [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a1" }],
  stud_cut_down:            [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a2" }],
  stud_time_spent:          [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a3" }],
  stud_craving:             [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a4" }],
  stud_role_failure:        [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a5" }],
  stud_social_problems:     [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a6" }],
  stud_activities_given_up: [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a7" }],
  stud_hazardous_use:       [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a8" }],
  stud_continued_harm:      [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a9" }],
  stud_tolerance:           [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a10" }],
  stud_withdrawal:          [{ diagnosisId: "stud", criterionId: "A", symptomDefId: "stud_a11" }],
  // ── Inhalant Use Disorder — Criterion A (no tolerance / withdrawal) ──────
  inud_larger_longer:       [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a1" }],
  inud_cut_down:            [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a2" }],
  inud_time_spent:          [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a3" }],
  inud_craving:             [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a4" }],
  inud_role_failure:        [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a5" }],
  inud_social_problems:     [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a6" }],
  inud_activities_given_up: [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a7" }],
  inud_hazardous_use:       [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a8" }],
  inud_continued_harm:      [{ diagnosisId: "inud", criterionId: "A", symptomDefId: "inud_a9" }],
  // ── Other Substance Use Disorder — Criterion A ──────────────────────────
  osud_larger_longer:       [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a1" }],
  osud_cut_down:            [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a2" }],
  osud_time_spent:          [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a3" }],
  osud_craving:             [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a4" }],
  osud_role_failure:        [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a5" }],
  osud_social_problems:     [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a6" }],
  osud_activities_given_up: [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a7" }],
  osud_hazardous_use:       [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a8" }],
  osud_continued_harm:      [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a9" }],
  osud_tolerance:           [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a10" }],
  osud_withdrawal:          [{ diagnosisId: "osud", criterionId: "A", symptomDefId: "osud_a11" }],
  // ── Anxiety Disorders ────────────────────────────────────────────────────
  // Bidirectional: entities here are referenced by SAD / Panic / Agoraphobia
  // / GAD / Specific Phobia symptomEntityIds in dsm5.ts. Marking presence
  // surfaces "evidence present" on the DSM page; never auto-marks "met".
  excessive_worry: [
    { diagnosisId: "gad", criterionId: "A", symptomDefId: "gad_a1" },
  ],
  difficulty_controlling_worry: [
    { diagnosisId: "gad", criterionId: "B", symptomDefId: "gad_b1" },
  ],
  anticipatory_anxiety: [
    { diagnosisId: "pan", criterionId: "B", symptomDefId: "pan_b1" },
  ],
  restlessness: [
    { diagnosisId: "gad", criterionId: "C", symptomDefId: "gad_c1" },
  ],
  muscle_tension: [
    { diagnosisId: "gad", criterionId: "C", symptomDefId: "gad_c5" },
  ],
  social_fear: [
    { diagnosisId: "sad", criterionId: "A", symptomDefId: "sad_a1" },
  ],
  fear_of_embarrassment: [
    { diagnosisId: "sad", criterionId: "B", symptomDefId: "sad_b1" },
  ],
  fear_of_scrutiny: [
    { diagnosisId: "sad", criterionId: "A", symptomDefId: "sad_a2" },
  ],
  avoidance_behaviours: [
    { diagnosisId: "sad",  criterionId: "D", symptomDefId: "sad_d1" },
    { diagnosisId: "agor", criterionId: "D", symptomDefId: "agor_d1" },
    { diagnosisId: "spho", criterionId: "C", symptomDefId: "spho_c1" },
    { diagnosisId: "iad",  criterionId: "D", symptomDefId: "iad_d3" },
  ],
  fear_of_crowds: [
    { diagnosisId: "agor", criterionId: "A", symptomDefId: "agor_a4" },
  ],
  fear_of_enclosed_spaces: [
    { diagnosisId: "agor", criterionId: "A", symptomDefId: "agor_a3" },
  ],
  fear_of_open_spaces: [
    { diagnosisId: "agor", criterionId: "A", symptomDefId: "agor_a2" },
  ],
  fear_of_public_transport: [
    { diagnosisId: "agor", criterionId: "A", symptomDefId: "agor_a1" },
  ],
  fear_of_being_alone_outside: [
    { diagnosisId: "agor", criterionId: "A", symptomDefId: "agor_a5" },
  ],
  specific_phobia_fear: [
    { diagnosisId: "spho", criterionId: "A", symptomDefId: "spho_a1" },
  ],
  panic_attacks: [
    { diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a1" },
  ],
  physiological_anxiety: [],
  fear_of_dying: [
    { diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a13" },
  ],
  fear_of_losing_control: [
    { diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a12" },
  ],
  derealization: [
    { diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a11" },
    { diagnosisId: "dpdr", criterionId: "A", symptomDefId: "dpdr_a2" },
  ],
  // Panic Attack autonomic symptom set (Panic Disorder Criterion A items).
  // The same entities also serve the cross-diagnosis Panic Attack Specifier.
  panic_palpitations:     [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a2" }],
  panic_sweating:         [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a3" }],
  panic_trembling:        [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a4" }],
  panic_shortness_breath: [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a5" }],
  panic_choking:          [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a6" }],
  panic_chest_discomfort: [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a7" }],
  panic_nausea:           [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a8" }],
  panic_dizziness:        [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a9" }],
  panic_chills_heat:      [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a10" }],
  panic_paresthesias:     [{ diagnosisId: "pan", criterionId: "A", symptomDefId: "pan_a14" }],
  // ── OCD-spectrum / body-focused ──────────────────────────────────────────
  // Surfaces "evidence present" on the DSM page; never auto-marks "met".
  //
  // OCD Criterion A holds both obsessions and compulsions in one symptom
  // list because DSM-5 states "obsessions, compulsions, or both" — a single
  // symptom_count criterion with minRequired=1 captures that logic.
  // BDD Criterion B aggregates repetitive behaviours / mental acts.
  // Trichotillomania / Excoriation have a single anchor entity each on
  // Criterion A; their B criteria use assessmentAreas (attempts to stop).
  intrusive_thoughts:    [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a1" }],
  unwanted_thoughts:     [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a2" }],
  repetitive_thoughts:   [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a3" }],
  intrusive_images:      [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a4" }],
  intrusive_urges:       [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a5" }],
  contamination_fears:   [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a6" }],
  harm_fears:            [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a7" }],
  checking_fears:        [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a8" }],
  symmetry_concerns:     [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a9" }],
  taboo_thoughts:        [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a10" }],
  thought_suppression:   [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a11" }],
  mental_neutralizing:   [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a12" }],
  reassurance_seeking: [
    { diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a13" },
    { diagnosisId: "bdd", criterionId: "B", symptomDefId: "bdd_b4" },
    { diagnosisId: "ssd", criterionId: "B", symptomDefId: "ssd_b3" },
  ],
  checking_behaviours:   [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a14" }],
  cleaning_washing:      [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a15" }],
  ordering_rituals:      [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a16" }],
  counting_rituals:      [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a17" }],
  repeating_behaviours:  [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a18" }],
  compulsive_reassurance:[{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a19" }],
  compulsive_praying:    [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a20" }],
  mental_counting:       [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a21" }],
  rigid_routines:        [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a22" }],
  ritualistic_behaviour: [{ diagnosisId: "ocd", criterionId: "A", symptomDefId: "ocd_a23" }],
  time_consuming_rituals:[{ diagnosisId: "ocd", criterionId: "B", symptomDefId: "ocd_b1" }],
  // BDD ----------------------------------------------------------------------
  appearance_preoccupation: [{ diagnosisId: "bdd", criterionId: "A", symptomDefId: "bdd_a1" }],
  mirror_checking:          [{ diagnosisId: "bdd", criterionId: "B", symptomDefId: "bdd_b1" }],
  excessive_grooming:       [{ diagnosisId: "bdd", criterionId: "B", symptomDefId: "bdd_b2" }],
  body_comparison:          [{ diagnosisId: "bdd", criterionId: "B", symptomDefId: "bdd_b3" }],
  muscle_dysmorphia_concerns: [{ diagnosisId: "bdd", criterionId: "A", symptomDefId: "bdd_a2" }],
  // skin_picking maps to BOTH BDD (Criterion B) and Excoriation (Crit A) —
  // entity is shared; clinician/criterion mapping disambiguates.
  hair_pulling: [
    { diagnosisId: "trich", criterionId: "A", symptomDefId: "trich_a1" },
  ],
  skin_picking: [
    { diagnosisId: "exco", criterionId: "A", symptomDefId: "exco_a1" },
    { diagnosisId: "bdd",  criterionId: "B", symptomDefId: "bdd_b5"   },
  ],
  // Associated features — no direct DSM criterion mapping; surfaced for
  // clinician context only.
  ritual_anxiety_relief:  [],
  ritual_loss_of_control: [],
  ocd_shame:              [],
  // ── Somatic Symptom and Related Disorders ───────────────────────────────
  // SSD Criterion A is a generic "one or more distressing somatic symptoms"
  // — every physical-symptom entity maps to ssd_a1 (the single anchor row).
  // Multiple entities → one symptomDefId is the established pattern
  // (mirrors how sleep_disturbance maps to multiple criteria the other way).
  // SSD Criterion B has three anchor rows (b1 / b2 / b3); ancillary
  // health-anxiety / illness-behaviour entities map to b3 as evidence.
  //
  // Conversion Disorder Criterion A holds the functional neurological
  // entities (paralysis / weakness / sensory loss / abnormal movements /
  // non-epileptic seizures / speech / swallowing / dissociative).
  //
  // Factitious Self and Other share the four observed-presentation
  // entities — clinician judgement determines self vs other context.
  chronic_pain:              [{ diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" }],
  diffuse_pain:              [{ diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" }],
  somatic_dizziness:         [{ diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" }],
  gi_symptoms:               [{ diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" }],
  neuro_symptoms:            [{ diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" }],
  sensory_symptoms:          [{ diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" }],
  somatic_numbness:          [{ diagnosisId: "ssd", criterionId: "A", symptomDefId: "ssd_a1" }],
  somatic_tremor: [
    { diagnosisId: "ssd",  criterionId: "A", symptomDefId: "ssd_a1"  },
    { diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a4" },
  ],
  speech_difficulties: [
    { diagnosisId: "ssd",  criterionId: "A", symptomDefId: "ssd_a1"  },
    { diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a5" },
  ],
  swallowing_difficulties: [
    { diagnosisId: "ssd",  criterionId: "A", symptomDefId: "ssd_a1"  },
    { diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a6" },
  ],
  visual_disturbances: [
    { diagnosisId: "ssd",  criterionId: "A", symptomDefId: "ssd_a1"  },
    { diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a7" },
  ],
  hearing_disturbances: [
    { diagnosisId: "ssd",  criterionId: "A", symptomDefId: "ssd_a1"  },
    { diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a7" },
  ],
  gait_problems: [
    { diagnosisId: "ssd",  criterionId: "A", symptomDefId: "ssd_a1"  },
    { diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a4" },
  ],
  paralysis_symptoms: [
    { diagnosisId: "ssd",  criterionId: "A", symptomDefId: "ssd_a1"  },
    { diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a1" },
  ],
  // SSD Criterion B anchor rows + evidence-feeding entities
  fear_of_serious_illness: [
    { diagnosisId: "ssd",   criterionId: "B", symptomDefId: "ssd_b1"   },
    { diagnosisId: "iad",   criterionId: "A", symptomDefId: "iad_a1"   },
    { diagnosisId: "ossrd", criterionId: "A", symptomDefId: "ossrd_a2" },
  ],
  excessive_health_worry: [
    { diagnosisId: "ssd",   criterionId: "B", symptomDefId: "ssd_b2"   },
    { diagnosisId: "iad",   criterionId: "C", symptomDefId: "iad_c1"   },
    { diagnosisId: "ossrd", criterionId: "A", symptomDefId: "ossrd_a3" },
  ],
  excessive_time_devoted_to_symptoms:  [{ diagnosisId: "ssd", criterionId: "B", symptomDefId: "ssd_b3" }],
  excessive_symptom_monitoring: [
    { diagnosisId: "ssd", criterionId: "B", symptomDefId: "ssd_b3" },
    { diagnosisId: "iad", criterionId: "D", symptomDefId: "iad_d1" },
  ],
  repeated_medical_checking: [
    { diagnosisId: "ssd", criterionId: "B", symptomDefId: "ssd_b3" },
    { diagnosisId: "iad", criterionId: "D", symptomDefId: "iad_d2" },
  ],
  excessive_healthcare_utilization:    [{ diagnosisId: "ssd", criterionId: "B", symptomDefId: "ssd_b3" }],
  preoccupation_with_symptoms: [
    { diagnosisId: "ssd",   criterionId: "B", symptomDefId: "ssd_b3"   },
    { diagnosisId: "ossrd", criterionId: "A", symptomDefId: "ossrd_a1" },
  ],
  // ── Conversion Disorder Criterion A — functional neuro entities ─────────
  non_epileptic_seizures:        [{ diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a3" }],
  functional_weakness:           [{ diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a1" }],
  functional_sensory_loss:       [{ diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a2" }],
  abnormal_movements:            [{ diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a4" }],
  dissociative_neuro_symptoms:   [{ diagnosisId: "conv", criterionId: "A", symptomDefId: "conv_a8" }],
  // ── Factitious Disorder (Self / Other) — observed presentation entities ─
  observed_inconsistency: [
    { diagnosisId: "fact_s", criterionId: "A", symptomDefId: "fact_s_a1" },
    { diagnosisId: "fact_o", criterionId: "A", symptomDefId: "fact_o_a1" },
  ],
  observed_extra_findings: [
    { diagnosisId: "fact_s", criterionId: "A", symptomDefId: "fact_s_a2" },
    { diagnosisId: "fact_o", criterionId: "A", symptomDefId: "fact_o_a2" },
  ],
  observed_self_induction_concerns: [
    { diagnosisId: "fact_s", criterionId: "A", symptomDefId: "fact_s_a3" },
    { diagnosisId: "fact_o", criterionId: "A", symptomDefId: "fact_o_a3" },
  ],
  observed_fabrication_concerns: [
    { diagnosisId: "fact_s", criterionId: "A", symptomDefId: "fact_s_a4" },
    { diagnosisId: "fact_o", criterionId: "A", symptomDefId: "fact_o_a4" },
  ],
  // Associated emotional entities — context only, no direct criterion match.
  somatic_distress:      [],
  somatic_frustration:   [],
  somatic_hopelessness:  [],
  // ── Neurodevelopmental — Autism Spectrum (id `autism`) ───────────────────
  // NOTE: diagnosis id `asd` is taken by Acute Stress Disorder; Autism
  // Spectrum Disorder uses `autism` to avoid collision while preserving
  // historical save data.
  social_emotional_reciprocity:     [{ diagnosisId: "autism", criterionId: "A", symptomDefId: "autism_a1" }],
  nonverbal_communication_deficits: [{ diagnosisId: "autism", criterionId: "A", symptomDefId: "autism_a2" }],
  relationship_deficits:            [{ diagnosisId: "autism", criterionId: "A", symptomDefId: "autism_a3" }],
  repetitive_motor_speech:          [{ diagnosisId: "autism", criterionId: "B", symptomDefId: "autism_b1" }],
  insistence_on_sameness:           [{ diagnosisId: "autism", criterionId: "B", symptomDefId: "autism_b2" }],
  restricted_interests:             [{ diagnosisId: "autism", criterionId: "B", symptomDefId: "autism_b3" }],
  sensory_atypicality:              [{ diagnosisId: "autism", criterionId: "B", symptomDefId: "autism_b4" }],
  // ── Neurodevelopmental — ADHD ────────────────────────────────────────────
  careless_mistakes:                 [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_1" }],
  attention_sustaining_difficulty:   [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_2" }],
  listening_difficulty:              [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_3" }],
  task_completion_difficulty:        [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_4" }],
  organization_difficulty:           [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_5" }],
  mental_effort_avoidance:           [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_6" }],
  losing_things:                     [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_7" }],
  easily_distracted: [
    { diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_8" },
    { diagnosisId: "bd1",  criterionId: "B",  symptomDefId: "bd1_b5"   },
    { diagnosisId: "bd2",  criterionId: "A",  symptomDefId: "bd2_a5"   },
  ],
  forgetfulness:                     [{ diagnosisId: "adhd", criterionId: "A1", symptomDefId: "adhd_a1_9" }],
  fidgeting:                         [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_1" }],
  leaving_seat:                      [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_2" }],
  motor_restlessness:                [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_3" }],
  quiet_play_difficulty:             [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_4" }],
  driven_by_motor:                   [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_5" }],
  excessive_talking:                 [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_6" }],
  blurting:                          [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_7" }],
  waiting_turn_difficulty:           [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_8" }],
  interrupting:                      [{ diagnosisId: "adhd", criterionId: "A2", symptomDefId: "adhd_a2_9" }],
  // ── Psychotic Disorders — shared symptom set ────────────────────────────
  // delusions / hallucinations / disorganised_thinking are pre-existing
  // entities; we expand their mapping to cover Delusional / Schizophreniform
  // / Schizophrenia / Schizoaffective Criterion A. Catatonia, abnormal
  // psychomotor behaviour, and negative symptoms are new entities.
  delusions: [
    { diagnosisId: "del", criterionId: "A", symptomDefId: "del_a1" },
    { diagnosisId: "szf", criterionId: "A", symptomDefId: "szf_a1" },
    { diagnosisId: "szp", criterionId: "A", symptomDefId: "szp_a1" },
    { diagnosisId: "sza", criterionId: "A", symptomDefId: "sza_a1" },
  ],
  hallucinations: [
    { diagnosisId: "szf", criterionId: "A", symptomDefId: "szf_a2" },
    { diagnosisId: "szp", criterionId: "A", symptomDefId: "szp_a2" },
    { diagnosisId: "sza", criterionId: "A", symptomDefId: "sza_a2" },
  ],
  disorganised_thinking: [
    { diagnosisId: "szf", criterionId: "A", symptomDefId: "szf_a3" },
    { diagnosisId: "szp", criterionId: "A", symptomDefId: "szp_a3" },
    { diagnosisId: "sza", criterionId: "A", symptomDefId: "sza_a3" },
  ],
  abnormal_psychomotor: [
    { diagnosisId: "szf", criterionId: "A", symptomDefId: "szf_a4" },
    { diagnosisId: "szp", criterionId: "A", symptomDefId: "szp_a4" },
    { diagnosisId: "sza", criterionId: "A", symptomDefId: "sza_a4" },
  ],
  catatonia: [
    { diagnosisId: "szf", criterionId: "A", symptomDefId: "szf_a4" },
    { diagnosisId: "szp", criterionId: "A", symptomDefId: "szp_a4" },
    { diagnosisId: "sza", criterionId: "A", symptomDefId: "sza_a4" },
  ],
  negative_symptoms: [
    { diagnosisId: "szf", criterionId: "A", symptomDefId: "szf_a5" },
    { diagnosisId: "szp", criterionId: "A", symptomDefId: "szp_a5" },
    { diagnosisId: "sza", criterionId: "A", symptomDefId: "sza_a5" },
  ],
  // ── Mood Disorders — Bipolar I / II / Cyclothymic ────────────────────────
  // Single elevated_mood entity feeds both BD1 manic-episode Criterion A and
  // BD2 hypomanic-episode Criterion A — qualitative threshold is captured
  // in severity and duration on the entity itself, not by entity duplication.
  elevated_mood: [
    { diagnosisId: "bd1", criterionId: "A", symptomDefId: "bd1_a1" },
    { diagnosisId: "bd2", criterionId: "A", symptomDefId: "bd2_a1" },
  ],
  grandiosity: [
    { diagnosisId: "bd1", criterionId: "B", symptomDefId: "bd1_b1" },
    { diagnosisId: "bd2", criterionId: "A", symptomDefId: "bd2_a2" },
  ],
  decreased_sleep_need: [
    { diagnosisId: "bd1", criterionId: "B", symptomDefId: "bd1_b2" },
    { diagnosisId: "bd2", criterionId: "A", symptomDefId: "bd2_a3" },
  ],
  pressured_speech: [
    { diagnosisId: "bd1", criterionId: "B", symptomDefId: "bd1_b3" },
    { diagnosisId: "bd2", criterionId: "A", symptomDefId: "bd2_a4" },
  ],
  racing_thoughts: [
    { diagnosisId: "bd1", criterionId: "B", symptomDefId: "bd1_b4" },
    { diagnosisId: "bd2", criterionId: "A", symptomDefId: "bd2_a6" },
  ],
  increased_goal_directed_activity: [
    { diagnosisId: "bd1", criterionId: "B", symptomDefId: "bd1_b6" },
    { diagnosisId: "bd2", criterionId: "A", symptomDefId: "bd2_a7" },
  ],
  // risk_behaviours feeds both BD1 B7 (excessive involvement in pleasurable
  // activities with high potential for painful consequences) and BD2 A8.
  risk_behaviours: [
    { diagnosisId: "bd1", criterionId: "B", symptomDefId: "bd1_b7" },
    { diagnosisId: "bd2", criterionId: "A", symptomDefId: "bd2_a8" },
  ],
  cyclothymic_fluctuation: [
    { diagnosisId: "cyc", criterionId: "A", symptomDefId: "cyc_a1" },
  ],
  // ── Dissociative Disorders ───────────────────────────────────────────────
  // dissociative_amnesia / depersonalization / derealization already
  // contributed to PTSD / ASD / Panic mappings; we extend those entries to
  // also feed the new Dissociative Amnesia and DPDR diagnoses. New entities:
  // fugue, OSDD subtypes.
  fugue_state: [
    { diagnosisId: "damn", criterionId: "A", symptomDefId: "damn_a2" },
  ],
  chronic_mixed_dissociation:    [{ diagnosisId: "osdd", criterionId: "A", symptomDefId: "osdd_a1" }],
  coercive_identity_disturbance: [{ diagnosisId: "osdd", criterionId: "A", symptomDefId: "osdd_a2" }],
  acute_dissociative_reaction:   [{ diagnosisId: "osdd", criterionId: "A", symptomDefId: "osdd_a3" }],
  dissociative_trance:           [{ diagnosisId: "osdd", criterionId: "A", symptomDefId: "osdd_a4" }],
  // ── Hallucinogen Use Disorder — Criterion A ─────────────────────────────
  hud_larger_longer:       [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a1" }],
  hud_cut_down:            [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a2" }],
  hud_time_spent:          [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a3" }],
  hud_craving:             [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a4" }],
  hud_role_failure:        [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a5" }],
  hud_social_problems:     [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a6" }],
  hud_activities_given_up: [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a7" }],
  hud_hazardous_use:       [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a8" }],
  hud_continued_harm:      [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a9" }],
  hud_tolerance:           [{ diagnosisId: "hud", criterionId: "A", symptomDefId: "hud_a10" }],
  // ── Gambling Disorder — Criterion A ────────────────────────────────────
  gamb_increasing_amounts:      [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a1" }],
  gamb_restless_irritable:       [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a2" }],
  gamb_failed_cut_down:          [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a3" }],
  gamb_preoccupation:            [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a4" }],
  gamb_gambling_when_distressed: [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a5" }],
  gamb_chasing_losses:           [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a6" }],
  gamb_lies_to_conceal:          [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a7" }],
  gamb_jeopardised_relationships:[{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a8" }],
  gamb_bailout:                  [{ diagnosisId: "gamb", criterionId: "A", symptomDefId: "gamb_a9" }],
  // ── Borderline Personality Disorder — 9 criteria ───────────────────────
  bpd_abandonment_fears:      [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a1" }],
  bpd_unstable_relationships: [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a2" }],
  bpd_identity_disturbance:   [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a3" }],
  bpd_impulsivity:            [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a4" }],
  bpd_self_harm_suicidality:  [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a5" }],
  bpd_affective_instability:  [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a6" }],
  bpd_emptiness:              [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a7" }],
  bpd_intense_anger:          [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a8" }],
  bpd_transient_paranoia:     [{ diagnosisId: "bpd", criterionId: "A", symptomDefId: "bpd_a9" }],
};

// ── Domain taxonomy ───────────────────────────────────────────────────────────
// Symptoms are structured by domain, not diagnosis.
// symptomEntityId values shared with DSM Assessment — single source of truth.

export const SYMPTOM_DOMAINS: SymptomDomain[] = [
  {
    id: "mood",
    label: "Mood & Emotional State",
    symptoms: [
      {
        id: "domain_depressed_mood",
        symptomEntityId: "depressed_mood",
        label: "Depressed mood",
        prompts: ["Low mood", "Sadness", "Emptiness", "Hopelessness", "Tearfulness", "Irritability"],
      },
      {
        id: "domain_anhedonia",
        symptomEntityId: "anhedonia",
        label: "Loss of interest / pleasure",
        prompts: ["Reduced enjoyment", "Stopped activities", "Social withdrawal", "Lack of motivation"],
      },
      {
        id: "domain_worthlessness",
        symptomEntityId: "worthlessness_guilt",
        label: "Guilt / worthlessness",
        prompts: ["Feelings of worthlessness", "Excessive guilt", "Shame", "Self-criticism", "Hopeless self-view"],
      },
      {
        id: "domain_hopelessness",
        symptomEntityId: "hopelessness",
        label: "Hopelessness",
        prompts: ["Pessimism about the future", "Nothing will improve", "Sense of futility", "No way forward"],
      },
      {
        id: "domain_low_self_esteem",
        symptomEntityId: "low_self_esteem",
        label: "Low self-esteem",
        prompts: ["Persistent low self-esteem", "Negative self-view", "Feelings of inadequacy", "Shame about self"],
      },
      {
        id: "domain_elevated_mood",
        symptomEntityId: "elevated_mood",
        label: "Elevated / expansive / irritable mood",
        prompts: ["Euphoria", "Expansive mood", "Persistent irritability (manic context)", "Unusually high energy / drive"],
        captureHints: ["frequency","duration","onset","progression"],
      },
      // ── Mania / hypomania associated symptoms (Bipolar I / II / Cyclothymic) ──
      // Distinct from depression-coded entities (psychomotor_disturbance,
      // sleep_disturbance, easily_distracted): mania-specific phenomenology is
      // qualitatively different and clinicians document it separately.
      {
        id: "domain_grandiosity",
        symptomEntityId: "grandiosity",
        label: "Inflated self-esteem / grandiosity",
        prompts: ["Inflated self-esteem","Grandiose beliefs about ability / status","Non-delusional vs delusional grandiosity"],
      },
      {
        id: "domain_decreased_sleep_need",
        symptomEntityId: "decreased_sleep_need",
        label: "Decreased need for sleep",
        prompts: ["Sleeping markedly less without fatigue","Feeling rested after minimal sleep","Distinct from insomnia (no distress about sleep loss)"],
      },
      {
        id: "domain_pressured_speech",
        symptomEntityId: "pressured_speech",
        label: "Pressured speech / talkativeness",
        prompts: ["More talkative than usual","Pressure to keep talking","Difficult to interrupt"],
      },
      {
        id: "domain_racing_thoughts",
        symptomEntityId: "racing_thoughts",
        label: "Flight of ideas / racing thoughts",
        prompts: ["Subjective racing thoughts","Flight of ideas observed","Tangential / loosely connected jumps"],
      },
      {
        id: "domain_increased_goal_activity",
        symptomEntityId: "increased_goal_directed_activity",
        label: "Increased goal-directed activity / psychomotor agitation",
        prompts: ["Increased productivity / projects","Psychomotor agitation","Excess sexual / social / work activity"],
      },
      {
        id: "domain_cyclothymic_fluctuation",
        symptomEntityId: "cyclothymic_fluctuation",
        label: "Chronic subthreshold mood fluctuation",
        prompts: ["Recurring hypomanic-range symptoms (below threshold)","Recurring depressive-range symptoms (below threshold)","Continuous fluctuation ≥ 2 years (≥ 1 year child/adolescent)","Symptom-free periods < 2 months"],
        captureHints: ["frequency","duration","onset","progression"],
      },
    ],
  },
  {
    id: "anxiety",
    label: "Anxiety",
    // ── Sub-group sections for clinician orientation ───────────────────────
    // Cognitive worry / social-evaluative / situational fears /
    // physiological-cognitive panic. All entities are tri-state, evidence-
    // aware, severity-aware, timeline-aware. None of these auto-map a
    // diagnosis — they map "evidence present" to relevant DSM criteria.
    sections: [
      {
        id: "section_anxiety_cognitive",
        label: "Cognitive / generalised anxiety",
        symptomEntityIds: [
          "excessive_worry",
          "difficulty_controlling_worry",
          "anticipatory_anxiety",
          "restlessness",
          "muscle_tension",
          "irritability",
          "concentration_difficulty",
          "fatigue_energy_loss",
          "sleep_disturbance",
        ],
      },
      {
        id: "section_anxiety_social",
        label: "Social / evaluative fears",
        symptomEntityIds: [
          "social_fear",
          "fear_of_embarrassment",
          "fear_of_scrutiny",
        ],
      },
      {
        id: "section_anxiety_situational",
        label: "Situational fears / agoraphobia",
        symptomEntityIds: [
          "fear_of_crowds",
          "fear_of_enclosed_spaces",
          "fear_of_open_spaces",
          "fear_of_public_transport",
          "fear_of_being_alone_outside",
          "specific_phobia_fear",
          "avoidance_behaviours",
        ],
      },
      {
        id: "section_anxiety_panic",
        label: "Panic / autonomic",
        symptomEntityIds: [
          "panic_attacks",
          "physiological_anxiety",
          "fear_of_dying",
          "fear_of_losing_control",
          "derealization",
          "depersonalization",
          "hypervigilance",
        ],
      },
    ],
    symptoms: [
      // ── Cognitive / generalised anxiety ──────────────────────────────────
      {
        id: "domain_excessive_worry",
        symptomEntityId: "excessive_worry",
        label: "Excessive worry",
        prompts: [
          "Worry occurring more days than not",
          "Worry across multiple domains (work, finances, family, health)",
          "Worry feels difficult to switch off",
          "Worry has lasted ≥ 6 months",
        ],
        captureHints: ["frequency", "duration", "progression"],
      },
      {
        id: "domain_difficulty_controlling_worry",
        symptomEntityId: "difficulty_controlling_worry",
        label: "Difficulty controlling worry",
        prompts: [
          "Cannot stop or redirect worry",
          "Attempts to distract are unsuccessful",
          "Worry intrudes on tasks",
        ],
      },
      {
        id: "domain_anticipatory_anxiety",
        symptomEntityId: "anticipatory_anxiety",
        label: "Anticipatory anxiety",
        prompts: [
          "Anxiety in advance of feared situations",
          "Worry about future attacks or events",
          "Avoidance based on anticipated distress",
        ],
      },
      {
        id: "domain_restlessness",
        symptomEntityId: "restlessness",
        label: "Restlessness / keyed up",
        prompts: ["Feeling keyed up or on edge", "Inability to settle", "Restlessness observed"],
      },
      {
        id: "domain_muscle_tension",
        symptomEntityId: "muscle_tension",
        label: "Muscle tension",
        prompts: ["Persistent muscle tightness", "Jaw clenching", "Shoulder/neck tension", "Headaches from tension"],
      },
      // ── Social / evaluative fears ────────────────────────────────────────
      {
        id: "domain_social_fear",
        symptomEntityId: "social_fear",
        label: "Fear of social situations",
        prompts: [
          "Marked fear in social interactions",
          "Conversations / meeting strangers",
          "Performing in front of others",
          "Eating / drinking in public",
        ],
      },
      {
        id: "domain_fear_of_embarrassment",
        symptomEntityId: "fear_of_embarrassment",
        label: "Fear of embarrassment / negative evaluation",
        prompts: [
          "Fear of being judged",
          "Fear of acting in an embarrassing way",
          "Fear of showing anxiety signs visibly",
        ],
      },
      {
        id: "domain_fear_of_scrutiny",
        symptomEntityId: "fear_of_scrutiny",
        label: "Fear of scrutiny by others",
        prompts: ["Fear of being watched", "Fear of being evaluated", "Performance-focused anxiety"],
      },
      // ── Situational fears / agoraphobia cluster ──────────────────────────
      {
        id: "domain_fear_of_crowds",
        symptomEntityId: "fear_of_crowds",
        label: "Fear of crowds / queues",
        prompts: ["Standing in line", "Being in a crowd", "Crowded shops or events"],
      },
      {
        id: "domain_fear_enclosed_spaces",
        symptomEntityId: "fear_of_enclosed_spaces",
        label: "Fear of enclosed spaces",
        prompts: ["Lifts / elevators", "Tunnels", "Small rooms", "Cars in traffic"],
      },
      {
        id: "domain_fear_open_spaces",
        symptomEntityId: "fear_of_open_spaces",
        label: "Fear of open spaces",
        prompts: ["Parking lots", "Marketplaces", "Bridges", "Open public areas"],
      },
      {
        id: "domain_fear_public_transport",
        symptomEntityId: "fear_of_public_transport",
        label: "Fear of public transport",
        prompts: ["Buses", "Trains", "Planes", "Ferries", "Cars over distance"],
      },
      {
        id: "domain_fear_being_alone_outside",
        symptomEntityId: "fear_of_being_alone_outside",
        label: "Fear of being outside the home alone",
        prompts: ["Requires companion to leave home", "Severe restriction of solo travel"],
      },
      {
        id: "domain_specific_phobia_fear",
        symptomEntityId: "specific_phobia_fear",
        label: "Specific phobia (object / situation)",
        prompts: [
          "Animal (e.g. spiders, dogs)",
          "Natural environment (heights, water, storms)",
          "Blood-injection-injury",
          "Situational (flying, lifts, driving)",
          "Other (vomiting, choking, costumed characters)",
        ],
      },
      {
        id: "domain_avoidance_behaviours",
        symptomEntityId: "avoidance_behaviours",
        label: "Avoidance behaviours",
        prompts: [
          "Avoidance of feared situations",
          "Endured only with intense distress",
          "Need for safety person or object",
          "Functional restriction from avoidance",
        ],
      },
      // ── Panic / autonomic cluster ────────────────────────────────────────
      {
        id: "domain_panic_attacks",
        symptomEntityId: "panic_attacks",
        label: "Panic attacks",
        prompts: [
          "Abrupt surge of intense fear / discomfort",
          "Peaks within minutes",
          "Recurrent unexpected attacks",
          "Cued vs uncued",
          "Frequency / typical duration",
        ],
        captureHints: ["frequency", "duration", "onset", "progression"],
      },
      {
        id: "domain_physiological_anxiety",
        symptomEntityId: "physiological_anxiety",
        label: "Physiological anxiety (between attacks)",
        prompts: ["Persistent autonomic arousal", "Background tachycardia / sweating", "Chronic muscle tension"],
      },
      {
        id: "domain_fear_of_dying",
        symptomEntityId: "fear_of_dying",
        label: "Fear of dying",
        prompts: ["Conviction of imminent death during attacks", "Fear of cardiac event"],
      },
      {
        id: "domain_fear_of_losing_control",
        symptomEntityId: "fear_of_losing_control",
        label: "Fear of losing control / going crazy",
        prompts: ["Fear of losing control", "Fear of going crazy", "Fear of acting out"],
      },
      {
        id: "domain_derealization",
        symptomEntityId: "derealization",
        label: "Derealisation",
        prompts: ["Feelings of unreality", "Surroundings feel dreamlike or distant", "Detachment from environment"],
      },
    ],
  },
  // ── Panic-attack autonomic symptoms (Panic Disorder Criterion A items) ──
  // Kept as its own domain so the clinician can document an individual
  // panic episode's symptom profile. Each entity is independent and
  // reusable — the same entity also informs the Panic Attack Specifier
  // attachable to any other diagnosis.
  {
    id: "panic_symptoms",
    label: "Panic Attack Symptoms",
    symptoms: [
      { id: "domain_panic_palpitations",      symptomEntityId: "panic_palpitations",      label: "Palpitations / pounding heart",        prompts: ["Heart pounding","Racing heart","Accelerated heart rate"] },
      { id: "domain_panic_sweating",          symptomEntityId: "panic_sweating",          label: "Sweating",                              prompts: ["Sudden sweating","Cold sweats","Clammy skin during attack"] },
      { id: "domain_panic_trembling",         symptomEntityId: "panic_trembling",         label: "Trembling / shaking",                   prompts: ["Visible shaking","Trembling hands","Body tremor during attack"] },
      { id: "domain_panic_shortness_breath",  symptomEntityId: "panic_shortness_breath",  label: "Shortness of breath / smothering",     prompts: ["Cannot catch breath","Smothering sensation","Air hunger"] },
      { id: "domain_panic_choking",           symptomEntityId: "panic_choking",           label: "Choking sensation",                     prompts: ["Lump in throat","Sensation of choking","Throat tightness"] },
      { id: "domain_panic_chest_discomfort",  symptomEntityId: "panic_chest_discomfort",  label: "Chest pain / discomfort",               prompts: ["Chest tightness","Chest pain","Pressure in chest"] },
      { id: "domain_panic_nausea",            symptomEntityId: "panic_nausea",            label: "Nausea / abdominal distress",           prompts: ["Nausea","Stomach churning","Abdominal cramping during attack"] },
      { id: "domain_panic_dizziness",         symptomEntityId: "panic_dizziness",         label: "Dizziness / light-headedness",          prompts: ["Light-headed","Dizzy","Faint","Unsteadiness"] },
      { id: "domain_panic_chills_heat",       symptomEntityId: "panic_chills_heat",       label: "Chills / heat sensations",              prompts: ["Hot flushes","Cold chills","Sudden temperature change"] },
      { id: "domain_panic_paresthesias",      symptomEntityId: "panic_paresthesias",      label: "Paresthesias (numbness / tingling)",   prompts: ["Tingling in hands or face","Numbness","Pins-and-needles during attack"] },
    ],
  },
  {
    id: "trauma",
    label: "Trauma",
    symptoms: [
      // ── Intrusion symptoms (PTSD B / ASD B1-B5) ──────────────────────────
      {
        id: "domain_intrusive_memories",
        symptomEntityId: "intrusive_memories",
        label: "Intrusive memories",
        prompts: ["Unwanted memories of the event", "Recurrent distressing recollections", "Intrusive images", "Triggered by reminders", "Distress on recall"],
      },
      {
        id: "domain_trauma_dreams",
        symptomEntityId: "trauma_dreams",
        label: "Trauma-related nightmares",
        prompts: ["Recurring distressing dreams", "Nightmares about the event", "Content related to trauma", "Waking with fear or distress"],
      },
      {
        id: "domain_flashbacks",
        symptomEntityId: "flashbacks",
        label: "Flashbacks / dissociative re-experiencing",
        prompts: ["Feeling as if the event is happening again", "Dissociative flashback episodes", "Acting or feeling as if reliving the event", "Duration and frequency"],
      },
      {
        id: "domain_distress_to_cues",
        symptomEntityId: "distress_to_cues",
        label: "Psychological distress to cues",
        prompts: ["Intense distress at reminders", "Internal cues trigger distress", "External cues trigger distress", "Anniversaries or sensory triggers"],
      },
      {
        id: "domain_physiological_reactivity",
        symptomEntityId: "physiological_reactivity",
        label: "Physiological reactivity to cues",
        prompts: ["Sweating", "Heart pounding", "Physical tension at reminders", "Bodily reaction to trauma-related cues"],
      },
      // ── Avoidance (PTSD C / ASD B9-B10) ──────────────────────────────────
      {
        id: "domain_cognitive_avoidance",
        symptomEntityId: "cognitive_avoidance",
        label: "Avoidance of trauma-related thoughts",
        prompts: ["Avoiding thoughts about the event", "Suppressing memories", "Avoiding feelings related to trauma", "Effort to not think about it"],
      },
      {
        id: "domain_external_avoidance",
        symptomEntityId: "external_avoidance",
        label: "Avoidance of external reminders",
        prompts: ["Avoiding people, places, activities", "Avoiding conversations about the event", "Avoiding objects or situations", "Restricting behaviour to avoid triggers"],
      },
      // ── Negative cognitions / mood (PTSD D) ───────────────────────────────
      {
        id: "domain_negative_beliefs",
        symptomEntityId: "negative_beliefs",
        label: "Negative beliefs about self or world",
        prompts: ["Persistent negative beliefs", "\"I am bad\"", "\"The world is completely dangerous\"", "Distorted cognitions about self or others"],
      },
      {
        id: "domain_distorted_blame",
        symptomEntityId: "distorted_blame",
        label: "Distorted blame (self or others)",
        prompts: ["Blaming self for the event", "Blaming others in a distorted way", "Guilt or shame about what happened", "Excessive responsibility"],
      },
      {
        id: "domain_persistent_negative_emotion",
        symptomEntityId: "persistent_negative_emotion",
        label: "Persistent negative emotional states",
        prompts: ["Persistent fear", "Horror", "Anger", "Guilt", "Shame", "Persistent negative affect since event"],
      },
      {
        id: "domain_detachment",
        symptomEntityId: "detachment",
        label: "Feelings of detachment / estrangement",
        prompts: ["Feeling detached from others", "Estranged from people", "Alienation", "Loss of closeness in relationships"],
      },
      {
        id: "domain_inability_positive_emotions",
        symptomEntityId: "inability_positive_emotions",
        label: "Inability to experience positive emotions",
        prompts: ["Unable to feel happiness", "Cannot feel love", "Unable to experience satisfaction", "Emotional constriction", "Numbing of positive affect"],
      },
      {
        id: "domain_dissociative_amnesia",
        symptomEntityId: "dissociative_amnesia",
        label: "Dissociative amnesia for the event",
        prompts: ["Inability to remember key aspects", "Gaps in memory", "Amnesia for parts of the traumatic event", "Not due to head injury or substances"],
      },
      // ── Arousal / reactivity (PTSD E) ─────────────────────────────────────
      {
        id: "domain_irritability",
        symptomEntityId: "irritability",
        label: "Irritability / angry outbursts",
        prompts: ["Irritable behaviour", "Angry outbursts", "Verbal or physical aggression", "Typically with little provocation"],
      },
      {
        id: "domain_reckless_behaviour",
        symptomEntityId: "reckless_behaviour",
        label: "Reckless or self-destructive behaviour",
        prompts: ["Reckless driving", "Risky sexual behaviour", "Excessive alcohol or drugs since trauma", "Self-destructive acts"],
      },
      {
        id: "domain_hypervigilance",
        symptomEntityId: "hypervigilance",
        label: "Hypervigilance",
        prompts: ["On guard", "Scanning for threats", "Exaggerated vigilance", "Cannot relax", "Constantly watching surroundings"],
      },
      {
        id: "domain_exaggerated_startle",
        symptomEntityId: "exaggerated_startle",
        label: "Exaggerated startle response",
        prompts: ["Exaggerated startle", "Easily startled by unexpected sounds or movement", "Jumpy", "Physical startle reaction"],
      },
      // ── Dissociative symptoms (ASD-specific / PTSD specifier) ─────────────
      {
        id: "domain_depersonalization",
        symptomEntityId: "depersonalization",
        label: "Depersonalisation",
        prompts: ["Feeling detached from one's own mental processes", "Feeling like an outside observer", "Feeling unreal", "Out-of-body experiences"],
      },
    ],
  },
  {
    id: "neurovegetative",
    label: "Sleep / Neurovegetative",
    symptoms: [
      {
        id: "domain_sleep",
        symptomEntityId: "sleep_disturbance",
        label: "Sleep disturbance",
        prompts: ["Insomnia", "Hypersomnia", "Difficulty falling asleep", "Staying asleep", "Early waking", "Non-restorative sleep"],
      },
      {
        id: "domain_appetite",
        symptomEntityId: "appetite_weight_change",
        label: "Appetite / weight change",
        prompts: ["Reduced appetite", "Increased appetite", "Weight loss", "Weight gain", "Irregular eating"],
      },
      {
        id: "domain_fatigue",
        symptomEntityId: "fatigue_energy_loss",
        label: "Fatigue / energy loss",
        prompts: ["Exhaustion", "Reduced energy", "Everything effortful", "Low stamina", "Physical fatigue"],
      },
      {
        id: "domain_psychomotor",
        symptomEntityId: "psychomotor_disturbance",
        label: "Psychomotor disturbance",
        prompts: ["Psychomotor agitation", "Psychomotor retardation", "Slowed movement", "Slowed speech", "Restlessness"],
      },
    ],
  },
  {
    id: "cognitive",
    label: "Cognitive",
    symptoms: [
      {
        id: "domain_concentration",
        symptomEntityId: "concentration_difficulty",
        label: "Concentration / memory",
        prompts: ["Difficulty concentrating", "Memory complaints", "Slowed thinking", "Indecision", "Distractibility"],
      },
    ],
  },
  {
    id: "behavioural_risk",
    label: "Behavioural / Risk",
    symptoms: [
      {
        id: "domain_suicidal",
        symptomEntityId: "suicidal_ideation",
        label: "Suicidal ideation / thoughts of death",
        prompts: ["Passive death wishes", "Suicidal ideation", "Plan or intent", "History of attempts", "Current risk"],
        captureHints: ["passiveIdeation", "activeIdeation", "plan", "attempts", "protectiveFactors", "currentRisk"],
      },
      {
        id: "domain_self_harm",
        symptomEntityId: "self_harm",
        label: "Self-harm",
        prompts: ["Non-suicidal self-injury", "Cutting", "Burning", "Frequency and method", "Function of behaviour"],
      },
      {
        id: "domain_risk_behaviours",
        symptomEntityId: "risk_behaviours",
        label: "Risk / impulsive behaviours",
        prompts: ["Reckless behaviour", "Impulsivity", "Dangerous driving", "Spending", "Sexual impulsivity"],
      },
    ],
  },
  {
    id: "substance",
    label: "Substance Use",
    // ── Sub-group sections ─────────────────────────────────────────────────────
    sections: [
      {
        id: "section_alcohol",
        label: "Alcohol",
        symptomEntityIds: [
          "aud_larger_longer","aud_cut_down","aud_time_spent","aud_craving",
          "aud_role_failure","aud_social_problems","aud_activities_given_up",
          "aud_hazardous_use","aud_continued_harm","aud_tolerance","aud_withdrawal",
        ],
      },
      {
        id: "section_cannabis",
        label: "Cannabis",
        symptomEntityIds: [
          "cud_larger_longer","cud_cut_down","cud_time_spent","cud_craving",
          "cud_role_failure","cud_social_problems","cud_activities_given_up",
          "cud_hazardous_use","cud_continued_harm","cud_tolerance","cud_withdrawal",
        ],
      },
      {
        id: "section_opioids",
        label: "Opioids",
        symptomEntityIds: [
          "oud_larger_longer","oud_cut_down","oud_time_spent","oud_craving",
          "oud_role_failure","oud_social_problems","oud_activities_given_up",
          "oud_hazardous_use","oud_continued_harm","oud_tolerance","oud_withdrawal",
        ],
      },
      {
        id: "section_sedatives",
        label: "Sedatives / Hypnotics / Anxiolytics",
        symptomEntityIds: [
          "shaud_larger_longer","shaud_cut_down","shaud_time_spent","shaud_craving",
          "shaud_role_failure","shaud_social_problems","shaud_activities_given_up",
          "shaud_hazardous_use","shaud_continued_harm","shaud_tolerance","shaud_withdrawal",
        ],
      },
      {
        id: "section_stimulants",
        label: "Stimulants",
        symptomEntityIds: [
          "stud_larger_longer","stud_cut_down","stud_time_spent","stud_craving",
          "stud_role_failure","stud_social_problems","stud_activities_given_up",
          "stud_hazardous_use","stud_continued_harm","stud_tolerance","stud_withdrawal",
        ],
      },
      {
        id: "section_inhalants",
        label: "Inhalants",
        symptomEntityIds: [
          "inud_larger_longer","inud_cut_down","inud_time_spent","inud_craving",
          "inud_role_failure","inud_social_problems","inud_activities_given_up",
          "inud_hazardous_use","inud_continued_harm",
        ],
      },
      {
        id: "section_other",
        label: "Other Substance Use",
        editableLabel: true,  // clinician can rename (e.g. "Ketamine Use")
        symptomEntityIds: [
          "osud_larger_longer","osud_cut_down","osud_time_spent","osud_craving",
          "osud_role_failure","osud_social_problems","osud_activities_given_up",
          "osud_hazardous_use","osud_continued_harm","osud_tolerance","osud_withdrawal",
        ],
      },
    ],
    symptoms: [
      // ── Alcohol ──────────────────────────────────────────────────────────────
      { id: "aud_s1",  symptomEntityId: "aud_larger_longer",       label: "Larger amounts / longer than intended",       prompts: ["Taking more than planned","Lasting longer than intended","Episodes of excess"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s2",  symptomEntityId: "aud_cut_down",            label: "Persistent desire / unsuccessful cut-down",   prompts: ["Repeated failed attempts to cut down","Wanting to stop but can't","Rules around use that keep breaking"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s3",  symptomEntityId: "aud_time_spent",          label: "Excessive time obtaining / using / recovering",prompts: ["Time spent sourcing","Time recovering (hangover)","Day structured around use"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s4",  symptomEntityId: "aud_craving",             label: "Craving",                                     prompts: ["Intense urge to use","Craving frequency","Craving triggers","Ability to resist"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s5",  symptomEntityId: "aud_role_failure",        label: "Role obligation failure",                     prompts: ["Work / study failures","Parenting / home duties neglected","Recurrent absence"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s6",  symptomEntityId: "aud_social_problems",     label: "Continued use despite social problems",       prompts: ["Relationship conflicts about use","Domestic disputes","Social isolation due to use"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s7",  symptomEntityId: "aud_activities_given_up", label: "Important activities given up",               prompts: ["Hobbies stopped","Social activities abandoned","Work opportunities avoided"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s8",  symptomEntityId: "aud_hazardous_use",       label: "Recurrent hazardous use",                     prompts: ["Driving under influence","Operating machinery","Using in risky situations"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s9",  symptomEntityId: "aud_continued_harm",      label: "Continued use despite known harm",            prompts: ["Physical harm (liver, etc.)","Psychological worsening","Aware of harm but continues"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s10", symptomEntityId: "aud_tolerance",           label: "Tolerance",                                   prompts: ["Needs more to achieve same effect","Diminished effect with same amount","Dose escalation over time"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "aud_s11", symptomEntityId: "aud_withdrawal",          label: "Withdrawal",                                  prompts: ["Withdrawal symptoms on cessation","Using to relieve or avoid withdrawal","Characteristic withdrawal syndrome"], captureHints: ["substanceQuantity","changeOverTime"] },
      // ── Cannabis ─────────────────────────────────────────────────────────────
      { id: "cud_s1",  symptomEntityId: "cud_larger_longer",       label: "Larger amounts / longer than intended",       prompts: ["Sessions longer than planned","Using more per session than intended"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s2",  symptomEntityId: "cud_cut_down",            label: "Persistent desire / unsuccessful cut-down",   prompts: ["Failed quit attempts","Tolerance breaks attempted and abandoned"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s3",  symptomEntityId: "cud_time_spent",          label: "Excessive time obtaining / using / recovering",prompts: ["Time obtaining cannabis","Duration of intoxication","Post-use impairment period"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s4",  symptomEntityId: "cud_craving",             label: "Craving",                                     prompts: ["Urge to use","Frequency of cravings","Situational triggers"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s5",  symptomEntityId: "cud_role_failure",        label: "Role obligation failure",                     prompts: ["Work or study impairment","Daily tasks neglected"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s6",  symptomEntityId: "cud_social_problems",     label: "Continued use despite social problems",       prompts: ["Relationship conflicts","Family concerns about use"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s7",  symptomEntityId: "cud_activities_given_up", label: "Important activities given up",               prompts: ["Stopped sports or hobbies","Social withdrawal"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s8",  symptomEntityId: "cud_hazardous_use",       label: "Recurrent hazardous use",                     prompts: ["Driving while impaired","Using at work"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s9",  symptomEntityId: "cud_continued_harm",      label: "Continued use despite known harm",            prompts: ["Mental health worsening","Motivational impairment","Aware of harm but continues"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s10", symptomEntityId: "cud_tolerance",           label: "Tolerance",                                   prompts: ["Increased amount needed","Reduced effect at same dose"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "cud_s11", symptomEntityId: "cud_withdrawal",          label: "Withdrawal",                                  prompts: ["Irritability on cessation","Sleep disturbance on cessation","Anxiety on cessation","Cannabis withdrawal syndrome"], captureHints: ["substanceQuantity","changeOverTime"] },
      // ── Opioids ──────────────────────────────────────────────────────────────
      { id: "oud_s1",  symptomEntityId: "oud_larger_longer",       label: "Larger amounts / longer than intended",       prompts: ["Dose exceeds prescription","Using for longer than prescribed"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s2",  symptomEntityId: "oud_cut_down",            label: "Persistent desire / unsuccessful cut-down",   prompts: ["Failed attempts to reduce","Wanting to stop"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s3",  symptomEntityId: "oud_time_spent",          label: "Excessive time obtaining / using / recovering",prompts: ["Doctor shopping","Time recovering from effects"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s4",  symptomEntityId: "oud_craving",             label: "Craving",                                     prompts: ["Strong urge to use opioids","Craving at dose time","Preoccupation with next dose"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s5",  symptomEntityId: "oud_role_failure",        label: "Role obligation failure",                     prompts: ["Work impairment","Sedation interfering with duties"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s6",  symptomEntityId: "oud_social_problems",     label: "Continued use despite social problems",       prompts: ["Relationship conflict over use","Family concern"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s7",  symptomEntityId: "oud_activities_given_up", label: "Important activities given up",               prompts: ["Reduced activity due to sedation","Hobbies abandoned"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s8",  symptomEntityId: "oud_hazardous_use",       label: "Recurrent hazardous use",                     prompts: ["Driving while impaired","Using illicit opioids"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s9",  symptomEntityId: "oud_continued_harm",      label: "Continued use despite known harm",            prompts: ["Physical dependency acknowledged","Overdose history","Continued despite medical advice"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s10", symptomEntityId: "oud_tolerance",           label: "Tolerance",                                   prompts: ["Dose escalation","Reduced analgesia at same dose","Needing more for same pain relief"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "oud_s11", symptomEntityId: "oud_withdrawal",          label: "Withdrawal",                                  prompts: ["Physical withdrawal symptoms","Using to avoid withdrawal","Sweating / nausea / muscle pain on cessation"], captureHints: ["substanceQuantity","changeOverTime"] },
      // ── Sedatives / Hypnotics / Anxiolytics ──────────────────────────────────
      { id: "shaud_s1",  symptomEntityId: "shaud_larger_longer",       label: "Larger amounts / longer than intended",       prompts: ["Exceeding prescribed dose","Using for longer than recommended"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s2",  symptomEntityId: "shaud_cut_down",            label: "Persistent desire / unsuccessful cut-down",   prompts: ["Attempted reduction without success","Tapers that failed"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s3",  symptomEntityId: "shaud_time_spent",          label: "Excessive time obtaining / using / recovering",prompts: ["Time managing prescriptions","Recovery from sedation"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s4",  symptomEntityId: "shaud_craving",             label: "Craving",                                     prompts: ["Urge to use sedative","Preoccupation with availability","Anxiety without sedative"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s5",  symptomEntityId: "shaud_role_failure",        label: "Role obligation failure",                     prompts: ["Cognitive impairment from sedation","Work performance decline"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s6",  symptomEntityId: "shaud_social_problems",     label: "Continued use despite social problems",       prompts: ["Relationship difficulties","Concern from others"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s7",  symptomEntityId: "shaud_activities_given_up", label: "Important activities given up",               prompts: ["Reduced activity due to sedation","Avoids driving","Social withdrawal"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s8",  symptomEntityId: "shaud_hazardous_use",       label: "Recurrent hazardous use",                     prompts: ["Driving while sedated","Combining with alcohol"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s9",  symptomEntityId: "shaud_continued_harm",      label: "Continued use despite known harm",            prompts: ["Cognitive effects acknowledged","Falls risk","Continued despite medical advice"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s10", symptomEntityId: "shaud_tolerance",           label: "Tolerance",                                   prompts: ["Dose escalation for same effect","Diminished anxiolytic effect"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "shaud_s11", symptomEntityId: "shaud_withdrawal",          label: "Withdrawal",                                  prompts: ["Rebound anxiety on cessation","Seizure risk","Physical withdrawal symptoms","Using to avoid withdrawal"], captureHints: ["substanceQuantity","changeOverTime"] },
      // ── Stimulants ───────────────────────────────────────────────────────────
      { id: "stud_s1",  symptomEntityId: "stud_larger_longer",       label: "Larger amounts / longer than intended",       prompts: ["Binge longer than planned","Taking more than intended"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s2",  symptomEntityId: "stud_cut_down",            label: "Persistent desire / unsuccessful cut-down",   prompts: ["Failed quit attempts","Cutting down attempts"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s3",  symptomEntityId: "stud_time_spent",          label: "Excessive time obtaining / using / recovering",prompts: ["Time obtaining stimulants","Crash / recovery period"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s4",  symptomEntityId: "stud_craving",             label: "Craving",                                     prompts: ["Intense craving","Preoccupation with use","Craving triggers (fatigue, stress)"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s5",  symptomEntityId: "stud_role_failure",        label: "Role obligation failure",                     prompts: ["Post-binge inability to function","Work or study failures"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s6",  symptomEntityId: "stud_social_problems",     label: "Continued use despite social problems",       prompts: ["Relationship conflicts","Paranoia or aggression affecting relationships"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s7",  symptomEntityId: "stud_activities_given_up", label: "Important activities given up",               prompts: ["Hobbies abandoned","Physical health activities stopped"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s8",  symptomEntityId: "stud_hazardous_use",       label: "Recurrent hazardous use",                     prompts: ["Risky sexual behaviour","Driving while intoxicated","Workplace use"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s9",  symptomEntityId: "stud_continued_harm",      label: "Continued use despite known harm",            prompts: ["Cardiovascular risk acknowledged","Psychosis risk","Weight loss"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s10", symptomEntityId: "stud_tolerance",           label: "Tolerance",                                   prompts: ["Dose escalation","Diminished euphoric effect"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "stud_s11", symptomEntityId: "stud_withdrawal",          label: "Withdrawal / crash",                          prompts: ["Crash after use (fatigue, dysphoria)","Hypersomnia","Increased appetite after cessation"], captureHints: ["substanceQuantity","changeOverTime"] },
      // ── Inhalants ────────────────────────────────────────────────────────────
      { id: "inud_s1",  symptomEntityId: "inud_larger_longer",       label: "Larger amounts / longer than intended",       prompts: ["Sessions longer than planned","Amounts exceeding intention"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s2",  symptomEntityId: "inud_cut_down",            label: "Persistent desire / unsuccessful cut-down",   prompts: ["Failed attempts to stop","Wanting to reduce"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s3",  symptomEntityId: "inud_time_spent",          label: "Excessive time obtaining / using / recovering",prompts: ["Time obtaining inhalants","Recovery from intoxication"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s4",  symptomEntityId: "inud_craving",             label: "Craving",                                     prompts: ["Urge to use","Preoccupation with use"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s5",  symptomEntityId: "inud_role_failure",        label: "Role obligation failure",                     prompts: ["School / work failures","Neurocognitive impairment"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s6",  symptomEntityId: "inud_social_problems",     label: "Continued use despite social problems",       prompts: ["Family concern","Peer group changes"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s7",  symptomEntityId: "inud_activities_given_up", label: "Important activities given up",               prompts: ["Activities replaced by use","Social withdrawal"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s8",  symptomEntityId: "inud_hazardous_use",       label: "Recurrent hazardous use",                     prompts: ["Sudden sniffing death risk","Using alone","Using near traffic"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "inud_s9",  symptomEntityId: "inud_continued_harm",      label: "Continued use despite known harm",            prompts: ["Organ damage acknowledged","Neurotoxicity","Continued despite warnings"], captureHints: ["substanceQuantity","changeOverTime"] },
      // ── Other Substance Use ───────────────────────────────────────────────────
      // editableLabel on first entry allows clinician to rename this section
      { id: "osud_s1",  symptomEntityId: "osud_larger_longer",       label: "Larger amounts / longer than intended",       prompts: ["Taking more than planned","Sessions longer than intended"], captureHints: ["substanceQuantity","changeOverTime"], editableLabel: true },
      { id: "osud_s2",  symptomEntityId: "osud_cut_down",            label: "Persistent desire / unsuccessful cut-down",   prompts: ["Failed reduction attempts","Wanting to stop"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s3",  symptomEntityId: "osud_time_spent",          label: "Excessive time obtaining / using / recovering",prompts: ["Time obtaining substance","Recovery period"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s4",  symptomEntityId: "osud_craving",             label: "Craving",                                     prompts: ["Urge to use","Craving triggers and frequency"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s5",  symptomEntityId: "osud_role_failure",        label: "Role obligation failure",                     prompts: ["Work / study failures","Responsibilities neglected"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s6",  symptomEntityId: "osud_social_problems",     label: "Continued use despite social problems",       prompts: ["Relationship conflicts","Family concern about use"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s7",  symptomEntityId: "osud_activities_given_up", label: "Important activities given up",               prompts: ["Hobbies abandoned","Social activities stopped"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s8",  symptomEntityId: "osud_hazardous_use",       label: "Recurrent hazardous use",                     prompts: ["Driving while intoxicated","Using in unsafe contexts"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s9",  symptomEntityId: "osud_continued_harm",      label: "Continued use despite known harm",            prompts: ["Harm acknowledged but continues","Medical or psychological worsening"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s10", symptomEntityId: "osud_tolerance",           label: "Tolerance",                                   prompts: ["Dose escalation over time","Reduced effect at same dose"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "osud_s11", symptomEntityId: "osud_withdrawal",          label: "Withdrawal",                                  prompts: ["Characteristic withdrawal syndrome","Using to avoid withdrawal"], captureHints: ["substanceQuantity","changeOverTime"] },
    ],
  },
  // Original lightweight "psychotic" domain removed — replaced by the
  // expanded version below which adds catatonia / negative-symptoms /
  // abnormal-psychomotor entities and sub-section grouping for the new
  // Psychotic Disorders DSM category. Entity ids (hallucinations / delusions
  // / disorganised_thinking) are preserved so existing assessment data
  // continues to deserialise correctly.
  {
    id: "eating",
    label: "Eating Disorders",
    symptoms: [
      // ── Restrictive / AN-spectrum ──────────────────────────────────────────
      {
        id: "ed_food_restriction",
        symptomEntityId: "food_restriction",
        label: "Food restriction / reduced intake",
        prompts: [
          "Caloric restriction", "Food group avoidance", "Meal skipping",
          "Severe dietary rules", "Energy intake below requirements",
          "Restrictive eating", "Reduced portion sizes",
        ],
      },
      {
        id: "ed_low_body_weight",
        symptomEntityId: "low_body_weight",
        label: "Low body weight",
        prompts: [
          "Significantly below expected weight", "BMI concerns",
          "Weight below healthy range for age/sex", "Underweight",
          "Recent weight loss", "Difficulty maintaining weight",
        ],
        captureHints: ["bmiEntry"],
      },
      {
        id: "ed_fear_weight_gain",
        symptomEntityId: "fear_weight_gain",
        label: "Fear of weight gain",
        prompts: [
          "Intense fear of gaining weight", "Phobic avoidance of weight gain",
          "Distress at prospect of weight gain", "Preoccupation with gaining weight",
          "Weight gain perceived as catastrophic",
        ],
      },
      {
        id: "ed_body_image",
        symptomEntityId: "body_image_disturbance",
        label: "Body image disturbance",
        prompts: [
          "Distorted perception of body size/shape", "Sees self as fat despite low weight",
          "Excessive body checking", "Body dissatisfaction",
          "Self-worth tied to body shape", "Avoidance of mirrors",
        ],
      },
      {
        id: "ed_lack_insight",
        symptomEntityId: "lack_insight_low_weight",
        label: "Lack of insight into low weight seriousness",
        prompts: [
          "Does not recognise danger of low weight", "Minimises medical risk",
          "Egosyntonic symptoms", "No concern about consequences",
          "Resistance to weight restoration",
        ],
      },
      {
        id: "ed_weight_shape_overevaluation",
        symptomEntityId: "weight_shape_overvaluation",
        label: "Weight / shape overvaluation",
        prompts: [
          "Self-worth dominated by weight and shape", "Cannot separate identity from body",
          "Weight central to self-evaluation", "Persistent preoccupation with weight/shape",
        ],
      },
      {
        id: "ed_weight_interfering_behaviour",
        symptomEntityId: "weight_interfering_behaviour",
        label: "Behaviours interfering with weight gain",
        prompts: [
          "Compensatory behaviours despite low weight", "Exercise to prevent weight gain",
          "Food rituals maintaining low weight", "Purging despite being underweight",
        ],
      },
      // ── Binge eating ──────────────────────────────────────────────────────
      {
        id: "ed_binge_eating",
        symptomEntityId: "binge_eating",
        label: "Binge eating episodes",
        prompts: [
          "Recurrent binge eating", "Eating objectively large amounts",
          "Eating much more than most would", "Binge episode frequency",
          "Duration of binge episodes", "Triggers for bingeing",
        ],
      },
      {
        id: "ed_loss_of_control",
        symptomEntityId: "loss_of_control_eating",
        label: "Loss of control while eating",
        prompts: [
          "Cannot stop eating once started", "Loss of control over what/how much eaten",
          "Eating feels out of control", "Sense of helplessness during episodes",
        ],
      },
      {
        id: "ed_rapid_eating",
        symptomEntityId: "rapid_eating",
        label: "Rapid eating",
        prompts: [
          "Eating much faster than normal", "Gobbling food", "Unable to slow pace",
          "Eating speed during binge vs. normal meals",
        ],
      },
      {
        id: "ed_eating_until_full",
        symptomEntityId: "eating_until_full",
        label: "Eating until uncomfortably full",
        prompts: [
          "Eating past comfortable fullness", "Physical discomfort after eating",
          "Stomach pain / bloating from overeating",
        ],
      },
      {
        id: "ed_not_hungry",
        symptomEntityId: "eating_when_not_hungry",
        label: "Eating when not physically hungry",
        prompts: [
          "Eating without physical hunger signals", "Emotional eating",
          "Eating to cope with stress or emotion", "Bingeing when not hungry",
        ],
      },
      {
        id: "ed_secret_eating",
        symptomEntityId: "eating_in_secret",
        label: "Eating alone / eating in secret",
        prompts: [
          "Hiding eating from others", "Embarrassed about amount eaten",
          "Eating alone due to shame", "Secret food stashes",
        ],
      },
      {
        id: "ed_guilt",
        symptomEntityId: "guilt_after_eating",
        label: "Guilt / shame / disgust after eating",
        prompts: [
          "Guilt following episodes", "Self-disgust after bingeing",
          "Shame about eating behaviour", "Low mood after eating",
          "Emotional aftermath of episodes",
        ],
      },
      {
        id: "ed_eating_distress",
        symptomEntityId: "eating_distress",
        label: "Marked distress about eating",
        prompts: [
          "Significant distress about eating pattern", "Preoccupation with eating disorder",
          "Distress is clinically significant", "Eating worries occupy much time",
        ],
      },
      // ── Compensatory behaviours ────────────────────────────────────────────
      {
        id: "ed_vomiting",
        symptomEntityId: "compensatory_vomiting",
        label: "Self-induced vomiting",
        prompts: [
          "Induced vomiting after eating", "Vomiting frequency", "Methods used",
          "Dental erosion / Russell's sign", "Change in vomiting frequency",
        ],
      },
      {
        id: "ed_laxatives",
        symptomEntityId: "laxative_misuse",
        label: "Laxative / diuretic misuse",
        prompts: [
          "Laxative use to control weight", "Diuretic misuse",
          "Type and amount", "Frequency of use",
        ],
      },
      {
        id: "ed_fasting",
        symptomEntityId: "compensatory_fasting",
        label: "Fasting (compensatory)",
        prompts: [
          "Skipping meals to compensate for eating", "Prolonged fasting periods",
          "Caloric restriction after eating episodes",
        ],
      },
      {
        id: "ed_exercise",
        symptomEntityId: "excessive_exercise",
        label: "Excessive / compulsive exercise",
        prompts: [
          "Compulsive exercise to burn calories", "Distress if unable to exercise",
          "Exercising despite injury or illness", "Exercise driven by guilt about eating",
          "Duration and frequency of exercise sessions",
        ],
      },
      // ── OSFED-specific ────────────────────────────────────────────────────
      {
        id: "ed_night_eating",
        symptomEntityId: "night_eating",
        label: "Night eating",
        prompts: [
          "Eating after awakening at night", "Excessive food intake after evening meal",
          "Awareness of night eating", "Distress about night eating pattern",
          "Night eating syndrome criteria",
        ],
      },
      {
        id: "ed_purging_no_binge",
        symptomEntityId: "purging_without_binge",
        label: "Purging without binge eating",
        prompts: [
          "Purging (vomiting or laxatives) without preceding binge",
          "Purging disorder", "Frequency of purging", "Absence of binge eating",
        ],
      },
    ],
  },
  // ── OCD-spectrum / body-focused ─────────────────────────────────────────────
  // Diagnosis-agnostic. Entities here feed OCD, BDD, Trichotillomania, and
  // Excoriation criteria via SYMPTOM_DSM_MAPPING — never auto-mark "met".
  // Sub-sections group related entities for clinician orientation:
  //   1. Obsessions / intrusive phenomena
  //   2. Compulsions / rituals
  //   3. Appearance / body-related preoccupations
  //   4. Body-focused repetitive behaviours (BFRBs)
  //   5. Associated features (insight, time-burden, ritual relief, etc.)
  {
    id: "ocd",
    label: "OCD & Related",
    sections: [
      {
        id: "section_ocd_obsessions",
        label: "Obsessions / intrusive phenomena",
        symptomEntityIds: [
          "intrusive_thoughts",
          "unwanted_thoughts",
          "repetitive_thoughts",
          "intrusive_images",
          "intrusive_urges",
          "contamination_fears",
          "harm_fears",
          "checking_fears",
          "symmetry_concerns",
          "taboo_thoughts",
          "thought_suppression",
          "mental_neutralizing",
          "reassurance_seeking",
        ],
      },
      {
        id: "section_ocd_compulsions",
        label: "Compulsions / rituals",
        symptomEntityIds: [
          "checking_behaviours",
          "cleaning_washing",
          "ordering_rituals",
          "counting_rituals",
          "repeating_behaviours",
          "compulsive_reassurance",
          "compulsive_praying",
          "mental_counting",
          "rigid_routines",
          "ritualistic_behaviour",
        ],
      },
      {
        id: "section_ocd_appearance",
        label: "Appearance / body-related",
        symptomEntityIds: [
          "appearance_preoccupation",
          "mirror_checking",
          "excessive_grooming",
          "body_comparison",
          "muscle_dysmorphia_concerns",
        ],
      },
      {
        id: "section_ocd_bfrb",
        label: "Body-focused repetitive behaviours",
        symptomEntityIds: [
          "hair_pulling",
          "skin_picking",
        ],
      },
      {
        id: "section_ocd_associated",
        label: "Associated features",
        symptomEntityIds: [
          "ritual_anxiety_relief",
          "time_consuming_rituals",
          "ritual_loss_of_control",
          "ocd_shame",
        ],
      },
    ],
    symptoms: [
      // ── Obsessions / intrusive phenomena ─────────────────────────────────
      { id: "ocd_obs_intrusive",      symptomEntityId: "intrusive_thoughts",  label: "Intrusive thoughts",                 prompts: ["Recurrent unwanted thoughts","Ego-dystonic content","Distressing intrusions","Frequency / duration"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "ocd_obs_unwanted",       symptomEntityId: "unwanted_thoughts",   label: "Unwanted thoughts",                   prompts: ["Thoughts the person tries to push away","Distress at having such thoughts"] },
      { id: "ocd_obs_repetitive",     symptomEntityId: "repetitive_thoughts", label: "Repetitive thoughts",                 prompts: ["Same thought looping","Replaying / rumination","Persistence"] },
      { id: "ocd_obs_images",         symptomEntityId: "intrusive_images",    label: "Intrusive images",                   prompts: ["Vivid mental images","Disturbing pictures","Recurrent visual intrusions"] },
      { id: "ocd_obs_urges",          symptomEntityId: "intrusive_urges",     label: "Intrusive urges",                     prompts: ["Unwanted urges to act","Distressing impulses","Effort to resist"] },
      { id: "ocd_obs_contamination",  symptomEntityId: "contamination_fears", label: "Contamination fears",                prompts: ["Germs / dirt","Bodily fluids","Chemicals","Disease transmission"] },
      { id: "ocd_obs_harm",           symptomEntityId: "harm_fears",          label: "Harm fears (self / others)",         prompts: ["Fear of harming others","Fear of accidents","Responsibility for harm"] },
      { id: "ocd_obs_checking",       symptomEntityId: "checking_fears",      label: "Doubt / checking obsessions",        prompts: ["Doubts about safety (locks, stove)","Doubts about completed actions","Persistent uncertainty"] },
      { id: "ocd_obs_symmetry",       symptomEntityId: "symmetry_concerns",   label: "Symmetry / 'just right' concerns",   prompts: ["Need for symmetry","'Not just right' feelings","Order / exactness"] },
      { id: "ocd_obs_taboo",          symptomEntityId: "taboo_thoughts",      label: "Taboo intrusive thoughts",           prompts: ["Aggressive / sexual / religious intrusions","Ego-dystonic content","Significant shame"] },
      { id: "ocd_obs_suppression",    symptomEntityId: "thought_suppression", label: "Attempts to suppress thoughts",       prompts: ["Pushing thoughts away","Distraction strategies","Effort to neutralise"] },
      { id: "ocd_obs_neutralizing",   symptomEntityId: "mental_neutralizing", label: "Mental neutralizing",                 prompts: ["Mental rituals to undo thoughts","Mental words / images used to neutralise","Internal compulsions"] },
      { id: "ocd_obs_reassurance",    symptomEntityId: "reassurance_seeking", label: "Reassurance-seeking (cognitive)",     prompts: ["Repeatedly asking others for reassurance","Seeking certainty","Distress when not given"] },
      // ── Compulsions / rituals ────────────────────────────────────────────
      { id: "ocd_comp_checking",      symptomEntityId: "checking_behaviours", label: "Checking behaviours",                prompts: ["Repeatedly checking locks / stoves / appliances","Re-checking actions","Checking body / sensations"], captureHints: ["frequency","duration","progression"] },
      { id: "ocd_comp_cleaning",      symptomEntityId: "cleaning_washing",    label: "Cleaning / washing rituals",         prompts: ["Repeated handwashing","Showering rituals","Cleaning objects / surfaces","Disinfecting"] },
      { id: "ocd_comp_ordering",      symptomEntityId: "ordering_rituals",    label: "Ordering / arranging",                prompts: ["Arranging objects until 'right'","Symmetry-driven arrangement","Distress if disturbed"] },
      { id: "ocd_comp_counting",      symptomEntityId: "counting_rituals",    label: "Counting rituals (overt)",            prompts: ["Counting aloud or visibly","Counting steps / items","Number of repetitions"] },
      { id: "ocd_comp_repeating",     symptomEntityId: "repeating_behaviours",label: "Repeating behaviours",                prompts: ["Repeating an action a set number of times","Re-doing tasks","Repeating until 'just right'"] },
      { id: "ocd_comp_reassurance",   symptomEntityId: "compulsive_reassurance", label: "Compulsive reassurance-seeking",   prompts: ["Behavioural reassurance-seeking","Phoning / texting to check","Pattern of dependence on reassurance"] },
      { id: "ocd_comp_praying",       symptomEntityId: "compulsive_praying",  label: "Compulsive praying",                 prompts: ["Ritualised praying","Specific phrases must be said","Distress if interrupted"] },
      { id: "ocd_comp_mental_count",  symptomEntityId: "mental_counting",     label: "Mental counting",                     prompts: ["Counting silently","Internal numerical rituals"] },
      { id: "ocd_comp_routines",      symptomEntityId: "rigid_routines",      label: "Rigid routines",                     prompts: ["Strict daily routines","Distress if routine broken","Inflexible sequences"] },
      { id: "ocd_comp_ritual",        symptomEntityId: "ritualistic_behaviour", label: "Other ritualistic behaviour",       prompts: ["Idiosyncratic rituals","Magical-thinking-driven acts","Touching / tapping rituals"] },
      // ── Appearance / body-related ────────────────────────────────────────
      { id: "ocd_app_preoccupation",  symptomEntityId: "appearance_preoccupation", label: "Preoccupation with appearance defect", prompts: ["Specific perceived flaw","Hours per day spent thinking about it","Flaw not observable or slight to others"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "ocd_app_mirror",         symptomEntityId: "mirror_checking",     label: "Mirror checking / avoidance",         prompts: ["Repeated mirror checking","OR active mirror avoidance","Time spent at mirrors"] },
      { id: "ocd_app_grooming",       symptomEntityId: "excessive_grooming",  label: "Excessive grooming / camouflaging",   prompts: ["Hair / makeup / clothing rituals","Skin grooming","Camouflaging perceived defect"] },
      { id: "ocd_app_comparison",     symptomEntityId: "body_comparison",     label: "Body comparison",                     prompts: ["Comparing appearance to others","Photos / social-media comparisons","Distress after comparing"] },
      { id: "ocd_app_muscle",         symptomEntityId: "muscle_dysmorphia_concerns", label: "Muscle dysmorphia concerns",   prompts: ["Body insufficiently muscular / lean","Excessive exercise / weights focus","Dietary regimens for muscularity"] },
      // ── Body-focused repetitive behaviours ───────────────────────────────
      { id: "ocd_bfrb_hair",          symptomEntityId: "hair_pulling",        label: "Hair pulling",                        prompts: ["Sites involved (scalp / eyelashes / brows / body)","Hair loss visible","Attempts to stop","Triggers / contexts"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "ocd_bfrb_skin",          symptomEntityId: "skin_picking",        label: "Skin picking",                        prompts: ["Sites involved (face / arms / scalp / back)","Lesions / scarring","Attempts to stop","Triggers / automatic vs focused"], captureHints: ["frequency","duration","onset","progression"] },
      // ── Associated features ──────────────────────────────────────────────
      { id: "ocd_assoc_relief",       symptomEntityId: "ritual_anxiety_relief", label: "Anxiety relief after ritual",       prompts: ["Distress reduced after compulsion","Ritual reinforced by relief","Negative-reinforcement pattern"] },
      { id: "ocd_assoc_time",         symptomEntityId: "time_consuming_rituals", label: "Time-consuming rituals (>1h/day)", prompts: ["Estimated hours per day","Interference with routine","Late for work / school / appointments"], captureHints: ["duration","frequency"] },
      { id: "ocd_assoc_loss_control", symptomEntityId: "ritual_loss_of_control", label: "Loss of control over rituals",      prompts: ["Unable to resist","Ego-dystonic but cannot stop","Failed reduction attempts"] },
      { id: "ocd_assoc_shame",        symptomEntityId: "ocd_shame",            label: "Shame about symptoms",                prompts: ["Embarrassment about thoughts / rituals","Concealment from others","Delay in seeking help due to shame"] },
    ],
  },
  // ── Somatic / functional / health-anxiety ───────────────────────────────────
  // Diagnosis-agnostic. Entities here feed Somatic Symptom Disorder,
  // Conversion (Functional Neurological Symptom) Disorder, and Factitious
  // Disorder (self / other) criteria via SYMPTOM_DSM_MAPPING.
  //
  // Clinical neutrality: factitious-related entities live in their own
  // section labelled "Clinician-Observed Presentation Features" with
  // tentative, evidence-framed labels. Marking these requires explicit
  // clinician judgement — they are not framed as patient-report items.
  // Nothing here auto-implies malingering or fabrication; presence simply
  // surfaces "evidence present" on the relevant DSM criterion.
  {
    id: "somatic",
    label: "Somatic & Functional",
    sections: [
      {
        id: "section_somatic_physical",
        label: "Somatic symptoms",
        symptomEntityIds: [
          "chronic_pain",
          "diffuse_pain",
          "fatigue_energy_loss",
          "somatic_dizziness",
          "gi_symptoms",
          "neuro_symptoms",
          "sensory_symptoms",
          "somatic_numbness",
          "somatic_tremor",
          "speech_difficulties",
          "swallowing_difficulties",
          "visual_disturbances",
          "hearing_disturbances",
          "gait_problems",
          "paralysis_symptoms",
        ],
      },
      {
        id: "section_somatic_health_anxiety",
        label: "Health anxiety / illness behaviours",
        symptomEntityIds: [
          "excessive_health_worry",
          "fear_of_serious_illness",
          "excessive_symptom_monitoring",
          "repeated_medical_checking",
          "reassurance_seeking",
          "excessive_healthcare_utilization",
          "preoccupation_with_symptoms",
          "excessive_time_devoted_to_symptoms",
        ],
      },
      {
        id: "section_somatic_functional_neuro",
        label: "Functional neurological symptoms",
        symptomEntityIds: [
          "non_epileptic_seizures",
          "functional_weakness",
          "functional_sensory_loss",
          "abnormal_movements",
          "dissociative_neuro_symptoms",
        ],
      },
      {
        id: "section_somatic_observed",
        label: "Clinician-observed presentation features",
        symptomEntityIds: [
          "observed_inconsistency",
          "observed_extra_findings",
          "observed_self_induction_concerns",
          "observed_fabrication_concerns",
        ],
      },
      {
        id: "section_somatic_associated",
        label: "Associated emotional features",
        symptomEntityIds: [
          "somatic_distress",
          "somatic_frustration",
          "somatic_hopelessness",
        ],
      },
    ],
    symptoms: [
      // ── Somatic symptoms ────────────────────────────────────────────────
      { id: "som_chronic_pain",      symptomEntityId: "chronic_pain",         label: "Chronic pain",                     prompts: ["Persistent pain ≥ 3 months","Site(s) and character","Pain intensity (0–10)","Impact on function"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "som_diffuse_pain",      symptomEntityId: "diffuse_pain",         label: "Diffuse / multi-site pain",        prompts: ["Pain in multiple body regions","Migratory pain","No clear focal source"], captureHints: ["frequency","duration","onset","progression"] },
      // fatigue_energy_loss is reused from the mood / neurovegetative domain —
      // a single SymptomEntity instance shared across SSD A and depressive
      // disorders. The Current Symptoms domain section above lists the same
      // entity so the clinician edits it in one place.
      { id: "som_somatic_dizziness", symptomEntityId: "somatic_dizziness",    label: "Dizziness",                         prompts: ["Light-headedness","Vertigo","Unsteadiness","Frequency / triggers"] },
      { id: "som_gi",                symptomEntityId: "gi_symptoms",          label: "Gastrointestinal symptoms",         prompts: ["Nausea","Abdominal pain","Bowel changes","Bloating / cramping"] },
      { id: "som_neuro",             symptomEntityId: "neuro_symptoms",       label: "Neurological symptoms (general)",   prompts: ["Headache","Paraesthesias","Coordination concerns","Cognitive complaints"] },
      { id: "som_sensory",           symptomEntityId: "sensory_symptoms",     label: "Sensory symptoms (general)",        prompts: ["Tingling","Burning","Hypersensitivity","Altered sensation"] },
      { id: "som_numbness",          symptomEntityId: "somatic_numbness",     label: "Numbness",                          prompts: ["Distribution","Onset","Persistent vs episodic","Triggers"] },
      { id: "som_tremor",            symptomEntityId: "somatic_tremor",       label: "Tremor",                            prompts: ["Resting / postural / kinetic","Body site","Frequency","Provoking factors"] },
      { id: "som_speech",            symptomEntityId: "speech_difficulties",  label: "Speech difficulties",                prompts: ["Dysarthria","Stuttering","Aphonia","Stuttering / mutism episodes"] },
      { id: "som_swallow",           symptomEntityId: "swallowing_difficulties", label: "Swallowing difficulties",       prompts: ["Dysphagia","Globus sensation","Choking episodes","Frequency"] },
      { id: "som_vision",            symptomEntityId: "visual_disturbances",   label: "Visual disturbances",               prompts: ["Blurred vision","Tunnel vision","Visual loss episodes","Diplopia"] },
      { id: "som_hearing",           symptomEntityId: "hearing_disturbances",  label: "Hearing disturbances",              prompts: ["Hearing loss episodes","Tinnitus","Auditory hypersensitivity"] },
      { id: "som_gait",              symptomEntityId: "gait_problems",        label: "Gait problems",                     prompts: ["Unsteadiness","Falls","Frozen / dragging gait","Functional vs structural"] },
      { id: "som_paralysis",         symptomEntityId: "paralysis_symptoms",   label: "Paralysis-type symptoms",            prompts: ["Limb weakness","Episodes of paralysis","Distribution","Recovery pattern"] },
      // ── Health anxiety / illness behaviours ─────────────────────────────
      { id: "som_health_worry",      symptomEntityId: "excessive_health_worry", label: "Excessive worry about health",   prompts: ["Persistent worry about being unwell","Worry disproportionate to objective findings","Duration"], captureHints: ["frequency","duration","progression"] },
      { id: "som_fear_illness",      symptomEntityId: "fear_of_serious_illness", label: "Fear of serious illness",       prompts: ["Conviction about specific feared illness","Catastrophic interpretation of bodily sensations"] },
      { id: "som_monitoring",        symptomEntityId: "excessive_symptom_monitoring", label: "Excessive symptom monitoring", prompts: ["Frequent self-examination","Pulse / BP / temperature checking","Logging symptoms in detail"] },
      { id: "som_med_check",         symptomEntityId: "repeated_medical_checking", label: "Repeated medical checking",     prompts: ["Multiple GP visits for same concern","Repeated investigations","Doctor-shopping pattern"] },
      // reassurance_seeking entity is reused — first introduced for OCD.
      { id: "som_healthcare_util",   symptomEntityId: "excessive_healthcare_utilization", label: "Excessive healthcare utilization", prompts: ["High visit frequency","Specialist after specialist","Emergency presentations"] },
      { id: "som_preoccupation",     symptomEntityId: "preoccupation_with_symptoms", label: "Preoccupation with symptoms", prompts: ["Symptoms dominate thinking","Difficulty redirecting attention from symptoms"] },
      { id: "som_time_devoted",      symptomEntityId: "excessive_time_devoted_to_symptoms", label: "Excessive time/energy devoted to symptoms", prompts: ["Daily life organised around symptoms","Hours per day spent on symptom-related activity"], captureHints: ["duration","frequency"] },
      // ── Functional neurological symptoms ────────────────────────────────
      { id: "som_pnes",              symptomEntityId: "non_epileptic_seizures", label: "Non-epileptic seizures",          prompts: ["Episodes resembling seizures","Atypical features (eye closure, asynchronous movements)","EEG findings if known","Frequency"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "som_fnd_weakness",      symptomEntityId: "functional_weakness",   label: "Functional weakness",               prompts: ["Hoover's sign / clinical incompatibility","Inconsistent on examination","Distribution"] },
      { id: "som_fnd_sensory",       symptomEntityId: "functional_sensory_loss", label: "Functional sensory loss",         prompts: ["Non-anatomic distribution","Inconsistent on testing","Variable across examinations"] },
      { id: "som_fnd_movement",      symptomEntityId: "abnormal_movements",    label: "Abnormal movements",                 prompts: ["Tremor with variable frequency","Dystonia / myoclonus","Distractibility / entrainment"] },
      { id: "som_fnd_dissociative",  symptomEntityId: "dissociative_neuro_symptoms", label: "Dissociative neurological symptoms", prompts: ["Trance-like episodes","Functional amnesia","Mixed presentation"] },
      // ── Clinician-observed presentation features ────────────────────────
      // Labels are deliberately tentative and evidence-framed. Marking these
      // requires explicit clinician judgement — they are NOT patient-report
      // items and the UI should make that distinction visible.
      { id: "som_obs_inconsistency", symptomEntityId: "observed_inconsistency",  label: "Inconsistencies observed across encounters", prompts: ["Symptom description varies between visits","Discrepant findings between examiners","Account inconsistent with collateral history"] },
      { id: "som_obs_extra",         symptomEntityId: "observed_extra_findings", label: "Findings unexplained by known medical history", prompts: ["Findings not accounted for by investigations","Presentation exceeds documented pathology","Unusual progression"] },
      { id: "som_obs_self_induced",  symptomEntityId: "observed_self_induction_concerns", label: "Concerns regarding possible self-induced presentation", prompts: ["Atypical / unexplained findings","Pattern suggests self-induction","Evidence requires further evaluation"] },
      { id: "som_obs_fabrication",   symptomEntityId: "observed_fabrication_concerns", label: "Concerns regarding possible fabricated symptoms", prompts: ["Reported symptoms not corroborated","Investigations do not support reports","Clinician judgement required"] },
      // ── Associated emotional features ───────────────────────────────────
      { id: "som_distress",          symptomEntityId: "somatic_distress",      label: "Distress about somatic symptoms",   prompts: ["Subjective distress about bodily symptoms","Worry / preoccupation"] },
      { id: "som_frustration",       symptomEntityId: "somatic_frustration",   label: "Frustration about health / treatment", prompts: ["Frustration with healthcare encounters","Sense of not being believed","Repeated unhelpful encounters"] },
      { id: "som_hopelessness",      symptomEntityId: "somatic_hopelessness",  label: "Hopelessness about health",         prompts: ["Belief health will not improve","No effective treatment found","Loss of hope about recovery"] },
    ],
  },
  // ── Neurodevelopmental ──────────────────────────────────────────────────────
  // Diagnosis-agnostic domain feeding Autism Spectrum Disorder (`autism`)
  // and ADHD (`adhd`). Note: the diagnosis id `asd` is already in use for
  // Acute Stress Disorder — Autism Spectrum Disorder uses `autism` to avoid
  // collision. The shared SymptomEntity layer means the same entities (e.g.
  // attention_sustaining_difficulty) could later be mapped to other DSM
  // criteria without entity duplication.
  {
    id: "neurodevelopmental",
    label: "Neurodevelopmental",
    sections: [
      {
        id: "section_autism_social",
        label: "Social communication / interaction",
        symptomEntityIds: [
          "social_emotional_reciprocity",
          "nonverbal_communication_deficits",
          "relationship_deficits",
        ],
      },
      {
        id: "section_autism_rrb",
        label: "Restricted / repetitive behaviours",
        symptomEntityIds: [
          "repetitive_motor_speech",
          "insistence_on_sameness",
          "restricted_interests",
          "sensory_atypicality",
        ],
      },
      {
        id: "section_adhd_inattention",
        label: "Inattention",
        symptomEntityIds: [
          "careless_mistakes",
          "attention_sustaining_difficulty",
          "listening_difficulty",
          "task_completion_difficulty",
          "organization_difficulty",
          "mental_effort_avoidance",
          "losing_things",
          "easily_distracted",
          "forgetfulness",
        ],
      },
      {
        id: "section_adhd_hyperactivity",
        label: "Hyperactivity / Impulsivity",
        symptomEntityIds: [
          "fidgeting",
          "leaving_seat",
          "motor_restlessness",
          "quiet_play_difficulty",
          "driven_by_motor",
          "excessive_talking",
          "blurting",
          "waiting_turn_difficulty",
          "interrupting",
        ],
      },
    ],
    symptoms: [
      // ── Autism Spectrum (Criterion A — social communication) ─────────────
      { id: "nd_aut_a1", symptomEntityId: "social_emotional_reciprocity",      label: "Social-emotional reciprocity deficits",       prompts: ["Reduced back-and-forth conversation","Reduced sharing of interests / emotions","Difficulty initiating or responding to social interaction"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "nd_aut_a2", symptomEntityId: "nonverbal_communication_deficits",  label: "Nonverbal communication deficits",            prompts: ["Reduced eye contact","Atypical body language","Reduced use / understanding of gestures","Reduced facial expression"] },
      { id: "nd_aut_a3", symptomEntityId: "relationship_deficits",             label: "Deficits in developing / maintaining relationships", prompts: ["Difficulty adjusting behaviour to social context","Difficulty making friends","Absence of interest in peers"] },
      // ── Autism Spectrum (Criterion B — restricted / repetitive) ──────────
      { id: "nd_aut_b1", symptomEntityId: "repetitive_motor_speech",           label: "Stereotyped / repetitive movements or speech",  prompts: ["Lining up objects","Echolalia","Stereotyped motor mannerisms","Idiosyncratic phrases"] },
      { id: "nd_aut_b2", symptomEntityId: "insistence_on_sameness",            label: "Insistence on sameness / rigid routines",      prompts: ["Inflexible adherence to routine","Ritualised verbal / nonverbal behaviour","Distress at small changes","Difficulty with transitions"] },
      { id: "nd_aut_b3", symptomEntityId: "restricted_interests",              label: "Restricted, fixated interests",                prompts: ["Highly restricted interests","Abnormal in intensity or focus","Strong attachment to unusual objects"] },
      { id: "nd_aut_b4", symptomEntityId: "sensory_atypicality",               label: "Sensory hyper- / hypo-reactivity",             prompts: ["Hyper-reactivity to specific sounds / textures","Hypo-reactivity to pain / temperature","Unusual sensory interests (smelling / visual fascination)"] },
      // ── ADHD (Criterion A — Inattention) ─────────────────────────────────
      { id: "nd_adhd_in1", symptomEntityId: "careless_mistakes",                label: "Careless mistakes",                           prompts: ["Inattention to detail","Errors in schoolwork / work / tasks","Sloppy / careless work"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "nd_adhd_in2", symptomEntityId: "attention_sustaining_difficulty",  label: "Difficulty sustaining attention",             prompts: ["Trouble keeping attention on tasks","Difficulty during lectures / conversations / lengthy reading"] },
      { id: "nd_adhd_in3", symptomEntityId: "listening_difficulty",             label: "Does not seem to listen when spoken to",      prompts: ["Mind elsewhere even with no distraction","Appears not to listen during direct conversation"] },
      { id: "nd_adhd_in4", symptomEntityId: "task_completion_difficulty",       label: "Fails to finish tasks",                       prompts: ["Starts tasks but loses focus","Sidetracked easily","Schoolwork / chores not completed"] },
      { id: "nd_adhd_in5", symptomEntityId: "organization_difficulty",          label: "Difficulty organising tasks / activities",    prompts: ["Disorganised work","Poor time management","Misses deadlines","Messy workspace"] },
      { id: "nd_adhd_in6", symptomEntityId: "mental_effort_avoidance",          label: "Avoids tasks requiring sustained mental effort", prompts: ["Reluctance to engage in homework / reports","Avoidance of complex tasks"] },
      { id: "nd_adhd_in7", symptomEntityId: "losing_things",                    label: "Loses things",                                prompts: ["Loses keys, wallet, paperwork, glasses","Loses items needed for tasks / activities"] },
      { id: "nd_adhd_in8", symptomEntityId: "easily_distracted",                label: "Easily distracted by extraneous stimuli",    prompts: ["Distracted by unrelated thoughts / external stimuli","Includes adult-pattern internal distractibility"] },
      { id: "nd_adhd_in9", symptomEntityId: "forgetfulness",                    label: "Forgetful in daily activities",               prompts: ["Forgets chores / errands","Returning calls","Paying bills","Keeping appointments"] },
      // ── ADHD (Criterion A — Hyperactivity / Impulsivity) ─────────────────
      { id: "nd_adhd_hy1", symptomEntityId: "fidgeting",                        label: "Fidgets / squirms",                           prompts: ["Fidgets with hands or feet","Squirms in seat","Adult subjective restlessness"] },
      { id: "nd_adhd_hy2", symptomEntityId: "leaving_seat",                     label: "Leaves seat when remaining seated expected",  prompts: ["Gets up in classroom / office / meetings"] },
      { id: "nd_adhd_hy3", symptomEntityId: "motor_restlessness",               label: "Runs / climbs (or adult restlessness)",       prompts: ["Childhood: runs about / climbs inappropriately","Adult: feelings of restlessness"] },
      { id: "nd_adhd_hy4", symptomEntityId: "quiet_play_difficulty",            label: "Difficulty engaging quietly",                 prompts: ["Unable to play / engage in leisure activities quietly"] },
      { id: "nd_adhd_hy5", symptomEntityId: "driven_by_motor",                  label: "On the go / driven by a motor",               prompts: ["Hard to keep up with","Uncomfortable being still for extended periods"] },
      { id: "nd_adhd_hy6", symptomEntityId: "excessive_talking",                label: "Talks excessively",                            prompts: ["Excessive talking across contexts"] },
      { id: "nd_adhd_hy7", symptomEntityId: "blurting",                         label: "Blurts out answers / completes sentences",    prompts: ["Blurts out answers before question completed","Completes others' sentences"] },
      { id: "nd_adhd_hy8", symptomEntityId: "waiting_turn_difficulty",          label: "Difficulty waiting turn",                     prompts: ["Difficulty waiting in line / for turn in queues / activities"] },
      { id: "nd_adhd_hy9", symptomEntityId: "interrupting",                     label: "Interrupts / intrudes on others",             prompts: ["Interrupts conversations / games","Uses others' things without asking","Intrudes into / takes over what others are doing"] },
    ],
  },
  // ── Psychotic ─────────────────────────────────────────────────────────────
  // Shared symptom store across Delusional Disorder, Schizophreniform,
  // Schizophrenia, and Schizoaffective. SymptomEntity.severity carries the
  // structured psychosis-severity score for each item (DSM-5 Section III
  // 0–4 dimensional ratings collapse cleanly onto the existing
  // SymptomSeverity ladder — none/mild/moderate/severe).
  //
  // Pre-existing entities `hallucinations`, `delusions`, and
  // `disorganised_thinking` are reused from the original "psychotic" domain
  // (which we replace here with this expanded version). To preserve any
  // existing assessment data using `disorganised_thinking`, the entity id
  // is unchanged.
  {
    id: "psychotic",
    label: "Psychotic",
    sections: [
      {
        id: "section_psychotic_positive",
        label: "Positive symptoms",
        symptomEntityIds: ["delusions", "hallucinations", "disorganised_thinking"],
      },
      {
        id: "section_psychotic_behaviour",
        label: "Behaviour / motor",
        symptomEntityIds: ["abnormal_psychomotor", "catatonia"],
      },
      {
        id: "section_psychotic_negative",
        label: "Negative symptoms",
        symptomEntityIds: ["negative_symptoms"],
      },
    ],
    symptoms: [
      { id: "psy_delusions",        symptomEntityId: "delusions",              label: "Delusions",                          prompts: ["Fixed false beliefs","Subtype (persecutory / grandiose / referential / somatic / erotomanic / jealous / nihilistic)","Bizarre vs non-bizarre","Insight"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "psy_hallucinations",   symptomEntityId: "hallucinations",         label: "Hallucinations",                     prompts: ["Modality (auditory / visual / tactile / olfactory / gustatory)","Command quality","Frequency / duration","Insight"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "psy_disorganised",     symptomEntityId: "disorganised_thinking",  label: "Disorganised speech / thinking",     prompts: ["Loosening of associations","Tangentiality","Incoherence / word salad","Derailment"] },
      { id: "psy_psychomotor",      symptomEntityId: "abnormal_psychomotor",   label: "Grossly disorganised / abnormal psychomotor behaviour", prompts: ["Unpredictable agitation","Childlike silliness","Inability to perform goal-directed behaviour","Behaviour observable by others"] },
      { id: "psy_catatonia",        symptomEntityId: "catatonia",              label: "Catatonic features",                 prompts: ["Stupor / decreased reactivity","Catalepsy / waxy flexibility","Mutism","Posturing / stereotypy / echolalia / echopraxia"] },
      { id: "psy_negative",         symptomEntityId: "negative_symptoms",      label: "Negative symptoms",                  prompts: ["Diminished emotional expression","Avolition","Alogia","Asociality","Anhedonia"] },
    ],
  },
  // ── Dissociative ────────────────────────────────────────────────────────────
  // Self-contained domain feeding Dissociative Amnesia, DPDR, OSDD, and UDD.
  // Pre-existing entities `dissociative_amnesia`, `depersonalization`,
  // `derealization` are reused unchanged; new entities cover fugue, OSDD
  // subtypes, and identity disturbance.
  {
    id: "dissociative",
    label: "Dissociative",
    sections: [
      {
        id: "section_dissociative_amnesia",
        label: "Amnesia / fugue",
        symptomEntityIds: ["dissociative_amnesia", "fugue_state"],
      },
      {
        id: "section_dpdr",
        label: "Depersonalisation / derealisation",
        symptomEntityIds: ["depersonalization", "derealization"],
      },
      {
        id: "section_osdd",
        label: "Other dissociative phenomena",
        symptomEntityIds: [
          "chronic_mixed_dissociation",
          "coercive_identity_disturbance",
          "acute_dissociative_reaction",
          "dissociative_trance",
        ],
      },
    ],
    symptoms: [
      // dissociative_amnesia / depersonalization / derealization already
      // exist in the Trauma / Anxiety domains. We expose them here too so
      // the clinician can document them in the dissociative context.
      { id: "dis_amnesia",          symptomEntityId: "dissociative_amnesia",       label: "Dissociative amnesia",                    prompts: ["Localised (event-specific)","Selective (parts of event)","Generalised (identity / life history)","Not due to ordinary forgetting / head injury / substances"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "dis_fugue",            symptomEntityId: "fugue_state",                label: "Dissociative fugue",                       prompts: ["Apparently purposeful travel / wandering","Confusion / loss of identity","Adoption of new identity","Duration / extent"] },
      { id: "dis_dpr",              symptomEntityId: "depersonalization",          label: "Depersonalisation",                        prompts: ["Feelings of detachment from one's own mental processes","Observer of self","Numbing / emotional unreality","Insight preserved"] },
      { id: "dis_dr",               symptomEntityId: "derealization",              label: "Derealisation",                            prompts: ["Surroundings feel unreal / dreamlike / distant","Visual / auditory distortion in the experience","Insight preserved"] },
      { id: "dis_chronic_mixed",    symptomEntityId: "chronic_mixed_dissociation", label: "Chronic / recurrent mixed dissociation (OSDD-1)", prompts: ["Recurrent dissociative episodes","Mixed amnesia + DPR + identity alteration","No discrete identity states / no fugue"] },
      { id: "dis_coercive",         symptomEntityId: "coercive_identity_disturbance", label: "Identity disturbance after coercive persuasion (OSDD-2)", prompts: ["Captivity / cult / torture context","Brainwashing / political indoctrination","Identity alteration tied to coercion"] },
      { id: "dis_acute",            symptomEntityId: "acute_dissociative_reaction",label: "Acute dissociative reaction to stressful event (OSDD-3)", prompts: ["< 1 month duration","Constriction of consciousness","Depersonalisation / derealisation / motor symptoms / amnesia / stupor","Tied to identifiable stressor"] },
      { id: "dis_trance",           symptomEntityId: "dissociative_trance",        label: "Dissociative trance (OSDD-4)",             prompts: ["Acute narrowing of awareness","Marked unresponsiveness to environment","Not part of accepted cultural / religious practice"] },
    ],
  },
  // ── Addictive (non-substance) ──────────────────────────────────────────────
  // Houses Gambling Disorder symptom entities. Substance Use entities already
  // live in the existing `substance` domain; gambling is structurally
  // analogous but pharmacologically distinct, so it gets its own domain.
  {
    id: "addictive_behavioural",
    label: "Behavioural Addiction",
    sections: [
      {
        id: "section_gambling",
        label: "Gambling",
        symptomEntityIds: [
          "gamb_increasing_amounts","gamb_restless_irritable","gamb_failed_cut_down",
          "gamb_preoccupation","gamb_gambling_when_distressed","gamb_chasing_losses",
          "gamb_lies_to_conceal","gamb_jeopardised_relationships","gamb_bailout",
        ],
      },
    ],
    symptoms: [
      { id: "gam_s1",  symptomEntityId: "gamb_increasing_amounts",       label: "Needs to gamble with increasing amounts",         prompts: ["Stake escalation to achieve desired excitement","Loss of low-stake satisfaction"], captureHints: ["frequency","duration","progression"] },
      { id: "gam_s2",  symptomEntityId: "gamb_restless_irritable",        label: "Restless or irritable when trying to cut down",   prompts: ["Withdrawal-like restlessness","Irritability","Difficulty stopping"] },
      { id: "gam_s3",  symptomEntityId: "gamb_failed_cut_down",           label: "Repeated unsuccessful efforts to cut down",       prompts: ["Failed quit attempts","Recurrent rule-breaking"] },
      { id: "gam_s4",  symptomEntityId: "gamb_preoccupation",             label: "Preoccupation with gambling",                     prompts: ["Reliving past experiences","Planning next venture","Thinking about ways to obtain money"] },
      { id: "gam_s5",  symptomEntityId: "gamb_gambling_when_distressed",  label: "Often gambles when feeling distressed",           prompts: ["Helpless / guilty / anxious / depressed","Used as coping strategy"] },
      { id: "gam_s6",  symptomEntityId: "gamb_chasing_losses",             label: "After losing money, returns to chase losses",    prompts: ["'Getting even' pattern","Re-entering after losses"] },
      { id: "gam_s7",  symptomEntityId: "gamb_lies_to_conceal",            label: "Lies to conceal the extent of involvement",     prompts: ["Lying to family / therapist / partner","Concealment of losses"] },
      { id: "gam_s8",  symptomEntityId: "gamb_jeopardised_relationships",  label: "Jeopardised significant relationship / job / opportunity", prompts: ["Relationship loss","Job loss","Educational / career consequences"] },
      { id: "gam_s9",  symptomEntityId: "gamb_bailout",                    label: "Relies on others to provide money to relieve desperate financial situations", prompts: ["Repeated bail-outs by family / friends","Financial distress driven by gambling"] },
    ],
  },
  // ── Hallucinogen Use Disorder symptom domain (sub-section of Substance) ────
  // Substance domain is closed; we add hallucinogen entities here so they
  // surface in Current Symptoms alongside the existing AUD / CUD / OUD /
  // SHAUD / STUD / INUD / OSUD sections. Naming follows the established
  // {drug}_{symptom} convention.
  {
    id: "substance_hallucinogen",
    label: "Substance Use — Hallucinogens",
    sections: [
      {
        id: "section_hallucinogen",
        label: "Hallucinogens (specify substance)",
        editableLabel: true,
        symptomEntityIds: [
          "hud_larger_longer","hud_cut_down","hud_time_spent","hud_craving",
          "hud_role_failure","hud_social_problems","hud_activities_given_up",
          "hud_hazardous_use","hud_continued_harm","hud_tolerance",
        ],
      },
    ],
    symptoms: [
      { id: "hud_s1",  symptomEntityId: "hud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Sessions exceed intention","Doses larger than planned"], captureHints: ["substanceQuantity","changeOverTime"], editableLabel: true },
      { id: "hud_s2",  symptomEntityId: "hud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Failed quit attempts","Wanting to stop"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s3",  symptomEntityId: "hud_time_spent",          label: "Great deal of time spent",                     prompts: ["Time obtaining / using / recovering"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s4",  symptomEntityId: "hud_craving",             label: "Craving",                                      prompts: ["Strong urge to use","Triggers"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s5",  symptomEntityId: "hud_role_failure",        label: "Role obligation failure",                      prompts: ["Work / study / home duties affected"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s6",  symptomEntityId: "hud_social_problems",     label: "Continued use despite social problems",        prompts: ["Relationship conflict / family concern"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s7",  symptomEntityId: "hud_activities_given_up", label: "Important activities given up",                prompts: ["Hobbies / social activities stopped"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s8",  symptomEntityId: "hud_hazardous_use",       label: "Recurrent hazardous use",                       prompts: ["Driving while impaired","Using in unsafe contexts"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s9",  symptomEntityId: "hud_continued_harm",      label: "Continued use despite known harm",              prompts: ["Persistent / recurrent psychological harm acknowledged"], captureHints: ["substanceQuantity","changeOverTime"] },
      { id: "hud_s10", symptomEntityId: "hud_tolerance",           label: "Tolerance",                                    prompts: ["Markedly diminished effect with same amount","Dose escalation"], captureHints: ["substanceQuantity","changeOverTime"] },
      // No withdrawal — DSM-5-TR explicitly excludes withdrawal from
      // hallucinogen use disorder criteria.
    ],
  },
  // ── Personality (BPD) ──────────────────────────────────────────────────────
  // Lives in its own diagnosis-agnostic domain so personality features can be
  // documented separately from acute episodic symptoms. Symptoms here map to
  // BPD's 9-criteria list — entity reuse with other diagnoses where the
  // construct overlaps (suicidal_ideation, irritability, hopelessness).
  {
    id: "personality",
    label: "Personality",
    sections: [
      {
        id: "section_bpd",
        label: "Borderline features",
        symptomEntityIds: [
          "bpd_abandonment_fears","bpd_unstable_relationships","bpd_identity_disturbance",
          "bpd_impulsivity","bpd_self_harm_suicidality","bpd_affective_instability",
          "bpd_emptiness","bpd_intense_anger","bpd_transient_paranoia",
        ],
      },
    ],
    symptoms: [
      { id: "bpd_s1", symptomEntityId: "bpd_abandonment_fears",       label: "Frantic efforts to avoid abandonment",            prompts: ["Real or imagined abandonment","Frantic response to separations","Does not include suicidal/self-mutilating behaviour from Criterion 5"], captureHints: ["frequency","duration","onset","progression"] },
      { id: "bpd_s2", symptomEntityId: "bpd_unstable_relationships",  label: "Unstable, intense interpersonal relationships",   prompts: ["Pattern of idealisation alternating with devaluation","Splitting","Marked relational instability"] },
      { id: "bpd_s3", symptomEntityId: "bpd_identity_disturbance",    label: "Identity disturbance",                            prompts: ["Markedly / persistently unstable self-image","Sense of self changes with context","Goals / values / sexuality / friendships shift"] },
      { id: "bpd_s4", symptomEntityId: "bpd_impulsivity",              label: "Impulsivity in ≥ 2 areas potentially self-damaging", prompts: ["Spending","Sex","Substance use","Reckless driving","Binge eating","Does not include suicidal/self-mutilating from Criterion 5"] },
      { id: "bpd_s5", symptomEntityId: "bpd_self_harm_suicidality",    label: "Recurrent suicidal behaviour, gestures, threats, or self-mutilation", prompts: ["History / current self-harm","Suicide attempts","Threats / gestures","Methods / lethality"] },
      { id: "bpd_s6", symptomEntityId: "bpd_affective_instability",    label: "Affective instability due to reactivity of mood", prompts: ["Marked mood reactivity","Intense episodic dysphoria / irritability / anxiety lasting hours to a few days"] },
      { id: "bpd_s7", symptomEntityId: "bpd_emptiness",                label: "Chronic feelings of emptiness",                   prompts: ["Persistent sense of emptiness","Inner void"] },
      { id: "bpd_s8", symptomEntityId: "bpd_intense_anger",            label: "Inappropriate, intense anger / difficulty controlling anger", prompts: ["Frequent displays of temper","Constant anger","Recurrent physical fights"] },
      { id: "bpd_s9", symptomEntityId: "bpd_transient_paranoia",       label: "Transient, stress-related paranoid ideation or severe dissociative symptoms", prompts: ["Transient paranoia under stress","Severe dissociative episodes (stress-related)"] },
    ],
  },
];

export function getDomain(id: string): SymptomDomain | undefined {
  return SYMPTOM_DOMAINS.find((d) => d.id === id);
}

export function getDsmRefsForEntity(entityId: string): DSMCriterionRef[] {
  return SYMPTOM_DSM_MAPPING[entityId] ?? [];
}
