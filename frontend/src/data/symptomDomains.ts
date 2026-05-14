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
  ],
  psychomotor_disturbance: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a5" },
  ],
  fatigue_energy_loss: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a6" },
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b3" },
  ],
  worthlessness_guilt: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a7" },
  ],
  concentration_difficulty: [
    { diagnosisId: "mdd", criterionId: "A", symptomDefId: "mdd_a8" },
    { diagnosisId: "pdd", criterionId: "B", symptomDefId: "pdd_b5" },
    { diagnosisId: "ptsd", criterionId: "E", symptomDefId: "ptsd_e5" },
    { diagnosisId: "asd", criterionId: "B", symptomDefId: "asd_b14" },
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
  ],
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
};

// ── Domain taxonomy ───────────────────────────────────────────────────────────
// Symptoms are structured by domain, not diagnosis.
// symptomEntityId values shared with DSM Assessment — single source of truth.

export const SYMPTOM_DOMAINS: SymptomDomain[] = [
  {
    id: "mood",
    label: "Mood",
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
        label: "Elevated / expansive mood",
        prompts: ["Euphoria", "Grandiosity", "Inflated self-esteem", "Expansive mood", "Unusually high energy"],
      },
    ],
  },
  {
    id: "anxiety",
    label: "Anxiety",
    symptoms: [
      {
        id: "domain_anxiety_general",
        symptomEntityId: "anxiety_general",
        label: "General anxiety",
        prompts: ["Persistent worry", "Apprehension", "Tension", "Nervousness", "Excessive fear"],
      },
      {
        id: "domain_panic",
        symptomEntityId: "panic_episodes",
        label: "Panic episodes",
        prompts: ["Sudden intense fear", "Heart pounding", "Shortness of breath", "Derealization", "Fear of dying or losing control"],
      },
      {
        id: "domain_phobic_avoidance",
        symptomEntityId: "phobic_avoidance",
        label: "Phobic avoidance",
        prompts: ["Avoidance of situations", "Feared objects or places", "Distress on exposure", "Disproportionate fear"],
      },
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
  {
    id: "psychotic",
    label: "Psychotic",
    symptoms: [
      {
        id: "domain_hallucinations",
        symptomEntityId: "hallucinations",
        label: "Hallucinations",
        prompts: ["Auditory hallucinations", "Visual", "Tactile", "Command hallucinations", "Frequency", "Insight"],
      },
      {
        id: "domain_delusions",
        symptomEntityId: "delusions",
        label: "Delusions",
        prompts: ["Fixed false beliefs", "Paranoia", "Grandiose", "Referential", "Persecutory", "Insight"],
      },
      {
        id: "domain_disorganised",
        symptomEntityId: "disorganised_thinking",
        label: "Disorganised thinking",
        prompts: ["Disorganised speech", "Loose associations", "Tangential thinking", "Incoherence"],
      },
    ],
  },
  {
    id: "eating",
    label: "Eating",
    symptoms: [
      {
        id: "domain_restrictive_eating",
        symptomEntityId: "restrictive_eating",
        label: "Restrictive eating",
        prompts: ["Caloric restriction", "Food avoidance", "Fear of weight gain", "Compensatory behaviours", "BMI concerns"],
      },
      {
        id: "domain_binge_purge",
        symptomEntityId: "binge_purge_behaviours",
        label: "Binge / purge behaviours",
        prompts: ["Binge eating episodes", "Purging behaviours", "Laxative use", "Excessive exercise", "Loss of control eating"],
      },
    ],
  },
];

export function getDomain(id: string): SymptomDomain | undefined {
  return SYMPTOM_DOMAINS.find((d) => d.id === id);
}

export function getDsmRefsForEntity(entityId: string): DSMCriterionRef[] {
  return SYMPTOM_DSM_MAPPING[entityId] ?? [];
}
