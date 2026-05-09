// ── Diagnosis-agnostic symptom domain taxonomy ────────────────────────────────
// Structured by clinical domain, NOT by diagnosis.
// Each symptom links to a shared SymptomEntity ID — the same store used by DSM.
// Editing here and editing in DSM Assessment both write to the same entity.

import type { DSMSymptomDef } from "../types/dsm";

// ── Domain definition ─────────────────────────────────────────────────────────

export type SymptomDomain = {
  id: string;
  label: string;
  symptoms: DSMSymptomDef[];
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
    symptoms: [
      {
        id: "domain_alcohol",
        symptomEntityId: "alcohol_use",
        label: "Alcohol use",
        prompts: ["Frequency and quantity", "Change since injury", "Dependence indicators", "Functional impact"],
      },
      {
        id: "domain_substances",
        symptomEntityId: "substance_use_other",
        label: "Other substance use",
        prompts: ["Type of substance", "Frequency", "Change since injury", "Functional impact", "Prescribed vs illicit"],
      },
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
