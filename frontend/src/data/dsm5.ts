// ── DSM-5-TR Diagnosis Definitions ────────────────────────────────────────────
// Structural definitions only — no assessment state here.
// Assessment state lives in DSMAssessmentData (types/dsm.ts).

import type { DSMCriterionDef, DSMDiagnosisDef } from "../types/dsm";

// ── Cross-diagnosis specifiers ────────────────────────────────────────────────
// Reusable specifier strings shared by multiple definitions. Declared near the
// top so any *_DEFINITION below can reference them. New cross-diagnosis
// specifiers should follow this pattern (single source of truth, not magic
// strings sprinkled through individual defs).
export const PANIC_ATTACK_SPECIFIER = "With panic attacks";

// Insight-level specifiers shared by OCD and Body Dysmorphic Disorder.
// DSM-5 distinguishes degree of insight into the obsession / appearance
// belief; the same three-rung scale is used for both. Tic-related (OCD)
// and muscle dysmorphia (BDD) are added to those defs individually.
export const OCD_INSIGHT_SPECIFIERS = [
  "With good or fair insight",
  "With poor insight",
  "With absent insight / delusional beliefs",
] as const;

// ── Major Depressive Disorder ─────────────────────────────────────────────────

export const MDD_DEFINITION: DSMDiagnosisDef = {
  id: "mdd",
  name: "Major Depressive Disorder",
  category: "Mood Disorders",
  abbreviation: "MDD",
  severityThresholds: {
    criterionId: "A",
    mild: 5,
    moderate: 6,
    moderateSevere: 7,
    agitationSymptomEntityId: "psychomotor_disturbance",
  },
  specifiers: [
    "Anxious distress",
    "Mixed features",
    "Melancholic features",
    "Atypical features",
    "Mood-congruent psychotic features",
    "Mood-incongruent psychotic features",
    "Catatonia",
    "Peripartum onset",
    "Seasonal pattern",
    PANIC_ATTACK_SPECIFIER,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Depressive Symptoms",
      description:
        "Five or more of the following symptoms during the same 2-week period, representing a change from previous functioning.",
      type: "symptom_count",
      minRequired: 5,
      mandatoryRule:
        "At least one symptom must be depressed mood (A1) or loss of interest or pleasure (A2).",
      symptoms: [
        {
          id: "mdd_a1",
          symptomEntityId: "depressed_mood",
          label: "Depressed Mood",
          isMandatoryAnchor: true,
          prompts: [
            "Low mood",
            "Sadness",
            "Emptiness",
            "Hopelessness",
            "Tearfulness",
            "Irritability (children/adolescents)",
          ],
          captureHints: ["subjective", "observed", "duration", "frequency", "progression"],
        },
        {
          id: "mdd_a2",
          symptomEntityId: "anhedonia",
          label: "Loss of Interest / Pleasure (Anhedonia)",
          isMandatoryAnchor: true,
          prompts: [
            "Reduced enjoyment",
            "Stopped previously enjoyed activities",
            "Social withdrawal",
            "Lack of motivation",
            "Reduced pleasure",
          ],
          captureHints: ["previousActivities", "changesSinceOnset", "degreeOfImpairment"],
        },
        {
          id: "mdd_a3",
          symptomEntityId: "appetite_weight_change",
          label: "Appetite / Weight Change",
          prompts: [
            "Reduced appetite",
            "Increased appetite",
            "Significant weight loss",
            "Significant weight gain",
          ],
          captureHints: ["estimatedChange", "timePeriod", "intentional", "eatingChanges"],
        },
        {
          id: "mdd_a4",
          symptomEntityId: "sleep_disturbance",
          label: "Sleep Disturbance",
          prompts: [
            "Insomnia",
            "Hypersomnia",
            "Initial insomnia (difficulty falling asleep)",
            "Middle insomnia (difficulty staying asleep)",
            "Terminal insomnia (early morning waking)",
            "Non-restorative sleep",
          ],
          captureHints: ["baselineSleep", "onset", "progression", "currentPattern"],
        },
        {
          id: "mdd_a5",
          symptomEntityId: "psychomotor_disturbance",
          label: "Psychomotor Disturbance",
          prompts: [
            "Psychomotor agitation",
            "Psychomotor retardation",
            "Slowed movement",
            "Slowed speech",
            "Restlessness",
            "Observable slowing noted by others",
          ],
          captureHints: ["observedByOthers", "subjectiveVsObjective"],
        },
        {
          id: "mdd_a6",
          symptomEntityId: "fatigue_energy_loss",
          label: "Fatigue / Loss of Energy",
          prompts: [
            "Exhaustion",
            "Reduced stamina",
            "Reduced energy",
            "Everything feels effortful",
            "Low physical energy",
          ],
          captureHints: ["dailyImpact", "variability", "progression"],
        },
        {
          id: "mdd_a7",
          symptomEntityId: "worthlessness_guilt",
          label: "Worthlessness / Excessive Guilt",
          prompts: [
            "Feelings of worthlessness",
            "Excessive guilt",
            "Shame",
            "Self-criticism",
            "Hopeless self-evaluation",
            "Delusional guilt (consider if present)",
          ],
          captureHints: ["realismOfBeliefs", "excessiveGuilt", "delusionalQuality"],
        },
        {
          id: "mdd_a8",
          symptomEntityId: "concentration_difficulty",
          label: "Concentration / Indecisiveness",
          prompts: [
            "Concentration difficulty",
            "Memory complaints",
            "Slowed thinking",
            "Indecision",
            "Distractibility",
          ],
          captureHints: ["occupationalImpact", "conversationalEvidence", "observedImpairment"],
        },
        {
          id: "mdd_a9",
          symptomEntityId: "suicidal_ideation",
          label: "Death / Suicidal Ideation",
          prompts: [
            "Recurrent thoughts of death",
            "Passive death wishes",
            "Suicidal ideation without plan",
            "Suicidal ideation with plan",
            "History of attempts",
            "Current intent",
          ],
          captureHints: ["passiveIdeation", "activeIdeation", "plan", "attempts", "protectiveFactors", "currentRisk"],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Functional Impairment",
      description:
        "The symptoms cause clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "occupational",
          label: "Occupational impairment",
          prompts: ["Work performance decline", "Attendance issues", "Role changes", "Job loss or demotion", "Reduced work hours"],
        },
        {
          id: "social",
          label: "Social impairment",
          prompts: ["Social withdrawal", "Reduced social activities", "Avoidance of social situations", "Deterioration in friendships"],
        },
        {
          id: "daily",
          label: "Daily functioning",
          prompts: ["Difficulty managing household tasks", "Reduced routine activities", "Impaired time management"],
        },
        {
          id: "relationships",
          label: "Relationships",
          prompts: ["Partner relationship strain", "Parenting difficulties", "Family conflict", "Reduced intimacy"],
        },
        {
          id: "selfCare",
          label: "Self-care",
          prompts: ["Personal hygiene decline", "Irregular eating", "Poor medication management"],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Medical / Substance Exclusion",
      description:
        "The episode is not attributable to the physiological effects of a substance or another medical condition.",
      type: "exclusion",
      assessmentAreas: [
        {
          id: "substances",
          label: "Substance contribution",
          prompts: ["Alcohol use", "Illicit substance use", "Prescription drug misuse", "Withdrawal effects"],
        },
        {
          id: "medications",
          label: "Medication effects",
          prompts: ["Current medication list", "Recent medication changes", "Corticosteroids", "Beta-blockers", "Interferon"],
        },
        {
          id: "medical",
          label: "Medical conditions",
          prompts: ["Chronic pain", "Neurological conditions", "Cardiovascular disease", "Cancer", "Anaemia"],
        },
        {
          id: "sleep",
          label: "Sleep disorders",
          prompts: ["Obstructive sleep apnoea", "Narcolepsy", "Restless legs syndrome", "Circadian rhythm disorder"],
        },
        {
          id: "endocrine",
          label: "Endocrine / metabolic",
          prompts: ["Hypothyroidism / hyperthyroidism", "Diabetes", "Adrenal conditions", "Vitamin D deficiency", "B12 deficiency"],
        },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Psychosis Exclusion",
      description:
        "The occurrence of the major depressive episode is not better explained by schizoaffective disorder, schizophrenia, schizophreniform disorder, delusional disorder, or other schizophrenia spectrum disorders.",
      type: "differential",
      assessmentAreas: [
        {
          id: "schizophrenia",
          label: "Schizophrenia spectrum",
          prompts: ["Hallucinations", "Delusions", "Disorganised speech", "Negative symptoms", "Grossly disorganised behaviour"],
        },
        {
          id: "schizoaffective",
          label: "Schizoaffective disorder",
          prompts: ["Psychotic features concurrent with mood episode", "Psychosis persisting beyond mood episode"],
        },
        {
          id: "delusional",
          label: "Delusional disorder",
          prompts: ["Fixed false beliefs", "Non-bizarre delusions", "Functioning otherwise preserved"],
        },
        {
          id: "moodCongruentPsychosis",
          label: "Mood-congruent vs incongruent psychosis",
          prompts: ["Psychotic content consistent with depressive themes", "Mood-incongruent psychotic features"],
        },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Bipolar Exclusion",
      description:
        "There has never been a manic episode or a hypomanic episode. (Note: exclusion does not apply if any manic or hypomanic episodes were substance-induced or due to a medical condition.)",
      type: "mood_exclusion",
      assessmentAreas: [
        {
          id: "elevatedMood",
          label: "Elevated / expansive mood",
          prompts: ["Euphoria", "Expansive mood", "Inflated self-esteem", "Grandiosity"],
        },
        {
          id: "decreasedSleep",
          label: "Decreased need for sleep",
          prompts: ["Sleeping less than usual without fatigue", "Feeling rested after markedly fewer hours"],
        },
        {
          id: "increasedActivity",
          label: "Increased goal-directed activity",
          prompts: ["Racing projects", "Pressured goal pursuit", "Increased productivity", "Psychomotor agitation"],
        },
        {
          id: "impulsivity",
          label: "Impulsivity / risky behaviour",
          prompts: ["Spending sprees", "Sexual indiscretions", "Risky business ventures", "Reckless driving"],
        },
        {
          id: "pressuredSpeech",
          label: "Pressured speech / flight of ideas",
          prompts: ["Rapid speech", "Difficult to interrupt", "Flight of ideas", "Racing thoughts"],
        },
        {
          id: "historicalEpisodes",
          label: "Historical manic / hypomanic episodes",
          prompts: ["Previous documented episodes", "Substance-induced episodes (specify)", "Medical condition-induced episodes"],
        },
      ],
    },
  ],
};

// ── Persistent Depressive Disorder (Dysthymia) ───────────────────────────────

export const PDD_DEFINITION: DSMDiagnosisDef = {
  id: "pdd",
  name: "Persistent Depressive Disorder",
  category: "Mood Disorders",
  abbreviation: "PDD",
  severityThresholds: {
    criterionId: "B",
    mild: 2,
    moderate: 3,
    moderateSevere: 4,
  },
  specifiers: [
    "With anxious distress",
    "With mixed features",
    "With melancholic features",
    "With atypical features",
    "With mood-congruent psychotic features",
    "With mood-incongruent psychotic features",
    "With peripartum onset",
    "Early onset (before age 21)",
    "Late onset (age 21 or older)",
    "With pure dysthymic syndrome",
    "With persistent major depressive episode",
    "With intermittent major depressive episodes, with current episode",
    "With intermittent major depressive episodes, without current episode",
    PANIC_ATTACK_SPECIFIER,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Depressed Mood",
      description:
        "Depressed mood for most of the day, more days than not, as indicated by either subjective account or observation by others, for at least 2 years.",
      type: "symptom_count",
      minRequired: 1,
      mandatoryRule:
        "Depressed mood must be present most of the day, more days than not, for at least 2 years.",
      symptoms: [
        {
          id: "pdd_a1",
          symptomEntityId: "depressed_mood",
          label: "Depressed Mood (≥2 years)",
          isMandatoryAnchor: true,
          prompts: [
            "Low mood most of the day",
            "More days depressed than not",
            "Subjective report of sadness or emptiness",
            "Observable sad affect",
            "Present for at least 2 years",
            "Children/adolescents: may be irritable mood for ≥1 year",
          ],
          captureHints: ["duration", "frequency", "subjective", "observed", "progression"],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Accompanying Symptoms (2+)",
      description:
        "Presence, while depressed, of two or more of the following: poor appetite or overeating; insomnia or hypersomnia; low energy or fatigue; low self-esteem; poor concentration or difficulty making decisions; feelings of hopelessness.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        {
          id: "pdd_b1",
          symptomEntityId: "appetite_weight_change",
          label: "Poor Appetite or Overeating",
          prompts: [
            "Poor appetite",
            "Overeating",
            "Weight changes",
            "Irregular meal patterns",
            "Food-related changes since onset",
          ],
          captureHints: ["estimatedChange", "timePeriod", "eatingChanges"],
        },
        {
          id: "pdd_b2",
          symptomEntityId: "sleep_disturbance",
          label: "Insomnia or Hypersomnia",
          prompts: [
            "Insomnia",
            "Hypersomnia",
            "Initial insomnia",
            "Middle insomnia",
            "Terminal insomnia",
            "Non-restorative sleep",
            "Excessive daytime sleepiness",
          ],
          captureHints: ["baselineSleep", "onset", "currentPattern"],
        },
        {
          id: "pdd_b3",
          symptomEntityId: "fatigue_energy_loss",
          label: "Low Energy or Fatigue",
          prompts: [
            "Low energy",
            "Fatigue",
            "Reduced stamina",
            "Everything feels effortful",
            "Physical exhaustion",
          ],
          captureHints: ["dailyImpact", "variability", "progression"],
        },
        {
          id: "pdd_b4",
          symptomEntityId: "low_self_esteem",
          label: "Low Self-Esteem",
          prompts: [
            "Persistent low self-esteem",
            "Negative self-view",
            "Feelings of inadequacy",
            "Self-doubt",
            "Shame about self",
            "Compare unfavourably to others",
          ],
          captureHints: ["subjectiveReports", "evidenceFor", "progression"],
        },
        {
          id: "pdd_b5",
          symptomEntityId: "concentration_difficulty",
          label: "Poor Concentration / Indecisiveness",
          prompts: [
            "Concentration difficulty",
            "Memory complaints",
            "Difficulty making decisions",
            "Indecision",
            "Slowed thinking",
          ],
          captureHints: ["occupationalImpact", "conversationalEvidence"],
        },
        {
          id: "pdd_b6",
          symptomEntityId: "hopelessness",
          label: "Feelings of Hopelessness",
          prompts: [
            "Feelings of hopelessness",
            "Pessimism about the future",
            "Sense that things will not improve",
            "Futility",
            "No light at the end of the tunnel",
          ],
          captureHints: ["subjectiveReports", "evidenceFor", "duration"],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — 2-Year Course",
      description:
        "During the 2-year period, the individual has never been without the symptoms for more than 2 consecutive months.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "continuity",
          label: "Symptom continuity over 2 years",
          prompts: [
            "Continuous presence without remission",
            "Any periods of improvement (< 2 months)",
            "Fluctuating course but continuously present",
          ],
        },
        {
          id: "remissionGaps",
          label: "Gaps / remission periods",
          prompts: [
            "Any periods completely symptom free",
            "Duration of symptom-free periods",
            "Circumstances surrounding gaps",
          ],
        },
      ],
    },
    {
      id: "D",
      label: "Criterion D — MDD Relationship",
      description:
        "Criteria for a major depressive disorder may be continuously present for 2 years. If the depressive symptoms represent discrete major depressive episodes, note the relevant specifier.",
      type: "differential",
      assessmentAreas: [
        {
          id: "mddOverlap",
          label: "Overlapping MDD episodes",
          prompts: [
            "Discrete MDE within PDD course",
            "Double depression (MDD on top of PDD)",
            "Continuous MDE for 2+ years (satisfies PDD A criterion)",
          ],
        },
        {
          id: "specifierNote",
          label: "Specifier documentation",
          prompts: [
            "With persistent MDE",
            "With intermittent MDE, current episode present",
            "With intermittent MDE, current episode absent",
            "Pure dysthymia (no MDE)",
          ],
        },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Bipolar / Cyclothymia Exclusion",
      description:
        "There has never been a manic episode, hypomanic episode, or cyclothymic disorder.",
      type: "mood_exclusion",
      assessmentAreas: [
        {
          id: "maniaHistory",
          label: "Manic / hypomanic history",
          prompts: [
            "Elevated or expansive mood episodes",
            "Grandiosity or inflated self-esteem",
            "Decreased need for sleep without fatigue",
            "Pressured speech, flight of ideas",
            "Increased goal-directed activity or psychomotor agitation",
          ],
        },
        {
          id: "cyclothymia",
          label: "Cyclothymia",
          prompts: [
            "Alternating hypomanic and depressive periods for 2+ years",
            "Never free of symptoms for >2 months",
          ],
        },
      ],
    },
    {
      id: "F",
      label: "Criterion F — Psychosis Spectrum Exclusion",
      description:
        "The disturbance does not occur exclusively during the course of a psychotic disorder.",
      type: "differential",
      assessmentAreas: [
        {
          id: "schizophreniaSpectrum",
          label: "Schizophrenia spectrum and other psychotic disorders",
          prompts: [
            "Hallucinations",
            "Delusions",
            "Disorganised speech or behaviour",
            "Depressive symptoms only during active psychosis",
          ],
        },
      ],
    },
    {
      id: "G",
      label: "Criterion G — Medical / Substance Exclusion",
      description:
        "The symptoms are not attributable to the physiological effects of a substance or another medical condition.",
      type: "exclusion",
      assessmentAreas: [
        {
          id: "substances",
          label: "Substance / medication effects",
          prompts: [
            "Alcohol or substance use",
            "Medications with depressogenic effects",
            "Onset temporally linked to substance use",
          ],
        },
        {
          id: "medicalConditions",
          label: "Medical conditions",
          prompts: [
            "Hypothyroidism",
            "Chronic pain or illness",
            "Neurological conditions",
            "Endocrine / metabolic disorders",
          ],
        },
      ],
    },
    {
      id: "H",
      label: "Criterion H — Functional Impairment",
      description:
        "The symptoms cause clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "occupational",
          label: "Occupational / academic",
          prompts: [
            "Work performance decline",
            "Attendance or reliability",
            "Career limitations",
            "Inability to sustain employment",
          ],
        },
        {
          id: "social",
          label: "Social functioning",
          prompts: [
            "Social withdrawal",
            "Relationship strain",
            "Reduced social activities",
            "Isolation",
          ],
        },
        {
          id: "daily",
          label: "Daily functioning",
          prompts: [
            "Household management",
            "Self-care",
            "Routine activities",
          ],
        },
      ],
    },
  ],
};

// ── Posttraumatic Stress Disorder ─────────────────────────────────────────────

export const PTSD_DEFINITION: DSMDiagnosisDef = {
  id: "ptsd",
  name: "Posttraumatic Stress Disorder",
  category: "Trauma-Related Disorders",
  abbreviation: "PTSD",
  specifiers: [
    "With dissociative symptoms: depersonalization",
    "With dissociative symptoms: derealization",
    "With delayed expression (≥6 months after event)",
    PANIC_ATTACK_SPECIFIER,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Trauma Exposure",
      description:
        "Exposure to actual or threatened death, serious injury, or sexual violence via: direct experience, witnessing in person, learning it occurred to a close other (violent/accidental), or repeated/extreme exposure to aversive details (e.g., first responders).",
      type: "differential",
      assessmentAreas: [
        {
          id: "directExposure",
          label: "Direct exposure",
          prompts: [
            "Nature of the traumatic event",
            "Direct personal experience",
            "Physical injury or threat thereof",
            "Threatened death or serious harm",
            "Sexual violence",
          ],
        },
        {
          id: "witnessing",
          label: "Witnessing in person",
          prompts: [
            "Witnessed event as it occurred to another person",
            "In-person observation (not via media)",
            "Traumatic death or serious injury witnessed",
          ],
        },
        {
          id: "learningAbout",
          label: "Learning about close other",
          prompts: [
            "Close family member or friend affected",
            "Violent or accidental nature confirmed",
            "Sudden unexpected death",
          ],
        },
        {
          id: "repeatedExposure",
          label: "Repeated / extreme exposure (occupational)",
          prompts: [
            "First responder / emergency services",
            "Repeated exposure to graphic details",
            "Accumulated professional trauma",
            "Not via media unless work-related",
          ],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Intrusion (≥1)",
      description:
        "One or more intrusion symptoms associated with the traumatic event(s), beginning after the event(s) occurred.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        {
          id: "ptsd_b1",
          symptomEntityId: "intrusive_memories",
          label: "Recurrent involuntary distressing memories",
          prompts: [
            "Recurrent intrusive memories",
            "Involuntary and distressing",
            "Vivid sensory re-experiencing",
            "Triggered without apparent cue",
            "Children: repetitive trauma-themed play",
          ],
          captureHints: ["subjective", "frequency", "distress"],
        },
        {
          id: "ptsd_b2",
          symptomEntityId: "trauma_dreams",
          label: "Recurrent distressing dreams",
          prompts: [
            "Recurring nightmares",
            "Dream content related to trauma",
            "Waking with fear or distress",
            "Children: frightening dreams without recognisable content",
          ],
          captureHints: ["frequency", "subjective", "sleepImpact"],
        },
        {
          id: "ptsd_b3",
          symptomEntityId: "flashbacks",
          label: "Dissociative reactions (flashbacks)",
          prompts: [
            "Flashback episodes",
            "Feeling or acting as if event is recurring",
            "Hallucination-like re-experiencing",
            "Loss of awareness of present environment",
            "Children: trauma re-enactment",
          ],
          captureHints: ["frequency", "duration", "triggers"],
        },
        {
          id: "ptsd_b4",
          symptomEntityId: "distress_to_cues",
          label: "Intense distress to trauma cues",
          prompts: [
            "Internal cues (thoughts, feelings)",
            "External cues (people, places, objects)",
            "Marked psychological distress",
            "Prolonged reaction to reminders",
          ],
          captureHints: ["triggers", "distress", "duration"],
        },
        {
          id: "ptsd_b5",
          symptomEntityId: "physiological_reactivity",
          label: "Marked physiological reactions to cues",
          prompts: [
            "Racing heart",
            "Sweating or shaking",
            "Physical fear response to reminders",
            "Autonomic arousal to trauma cues",
          ],
          captureHints: ["triggers", "observed", "frequency"],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Avoidance (≥1)",
      description:
        "Persistent avoidance of stimuli associated with the traumatic event(s), beginning after the event(s) occurred.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        {
          id: "ptsd_c1",
          symptomEntityId: "cognitive_avoidance",
          label: "Avoidance of distressing thoughts / feelings",
          prompts: [
            "Efforts to avoid trauma-related thoughts",
            "Emotional suppression",
            "Pushing memories away",
            "Refusing to talk about it",
          ],
          captureHints: ["subjective", "strategies", "duration"],
        },
        {
          id: "ptsd_c2",
          symptomEntityId: "external_avoidance",
          label: "Avoidance of external reminders",
          prompts: [
            "Avoiding people or places",
            "Avoiding activities or situations",
            "Avoiding objects associated with event",
            "Route avoidance",
            "Media avoidance",
          ],
          captureHints: ["specifics", "impactOnLife", "duration"],
        },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Negative Cognitions / Mood (≥2)",
      description:
        "Negative alterations in cognitions and mood associated with the traumatic event(s), beginning or worsening after the event(s) occurred.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        {
          id: "ptsd_d1",
          symptomEntityId: "dissociative_amnesia",
          label: "Dissociative amnesia (trauma-related)",
          prompts: [
            "Inability to remember key aspect of event",
            "Gaps in memory not explained by intoxication",
            "Psychogenic amnesia",
            "Event details inaccessible",
          ],
          captureHints: ["nature", "extent", "onset"],
        },
        {
          id: "ptsd_d2",
          symptomEntityId: "negative_beliefs",
          label: "Persistent negative beliefs",
          prompts: [
            "Negative beliefs about self",
            "Negative beliefs about the world",
            "\"I am bad / broken\"",
            "\"The world is completely dangerous\"",
            "\"No one can be trusted\"",
          ],
          captureHints: ["content", "rigidity", "subjectiveReports"],
        },
        {
          id: "ptsd_d3",
          symptomEntityId: "distorted_blame",
          label: "Distorted blame of self or others",
          prompts: [
            "Persistent distorted blame",
            "Self-blame for the event",
            "Blaming others inappropriately",
            "Guilt about actions taken or not taken",
          ],
          captureHints: ["content", "accuracy", "subjectiveReports"],
        },
        {
          id: "ptsd_d4",
          symptomEntityId: "persistent_negative_emotion",
          label: "Persistent negative emotional states",
          prompts: [
            "Fear",
            "Horror",
            "Anger",
            "Guilt",
            "Shame",
            "Persistent and pervasive",
          ],
          captureHints: ["dominant emotion", "frequency", "progression"],
        },
        {
          id: "ptsd_d5",
          symptomEntityId: "anhedonia",
          label: "Markedly diminished interest / pleasure",
          isMandatoryAnchor: false,
          prompts: [
            "Significant reduction in interest",
            "Loss of pleasure in activities",
            "Withdrawal from activities",
            "Changed since trauma onset",
          ],
          captureHints: ["previousActivities", "changesSinceOnset"],
        },
        {
          id: "ptsd_d6",
          symptomEntityId: "detachment",
          label: "Feelings of detachment / estrangement",
          prompts: [
            "Feeling detached from others",
            "Estrangement from loved ones",
            "Feeling like an outsider",
            "Difficulty connecting with people",
          ],
          captureHints: ["relationships", "subjective", "duration"],
        },
        {
          id: "ptsd_d7",
          symptomEntityId: "inability_positive_emotions",
          label: "Inability to experience positive emotions",
          prompts: [
            "Emotional constriction",
            "Cannot feel happiness",
            "Cannot feel love or affection",
            "Cannot feel satisfaction",
            "Emotional numbness",
          ],
          captureHints: ["subjective", "examples", "duration"],
        },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Arousal / Reactivity (≥2)",
      description:
        "Marked alterations in arousal and reactivity associated with the traumatic event(s), beginning or worsening after the event(s) occurred.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        {
          id: "ptsd_e1",
          symptomEntityId: "irritability",
          label: "Irritable behaviour / angry outbursts",
          prompts: [
            "Irritability",
            "Angry outbursts",
            "Verbal aggression",
            "Physical aggression",
            "Little or no provocation",
          ],
          captureHints: ["frequency", "severity", "triggers"],
        },
        {
          id: "ptsd_e2",
          symptomEntityId: "reckless_behaviour",
          label: "Reckless or self-destructive behaviour",
          prompts: [
            "Reckless driving",
            "Substance misuse",
            "Self-destructive acts",
            "Risk-taking without regard for safety",
          ],
          captureHints: ["examples", "frequency", "preInjuryBaseline"],
        },
        {
          id: "ptsd_e3",
          symptomEntityId: "hypervigilance",
          label: "Hypervigilance",
          prompts: [
            "Constantly on guard",
            "Scanning for threats",
            "Cannot relax in public",
            "Sitting with back to wall",
            "Exaggerated sense of danger",
          ],
          captureHints: ["subjective", "observed", "situational"],
        },
        {
          id: "ptsd_e4",
          symptomEntityId: "exaggerated_startle",
          label: "Exaggerated startle response",
          prompts: [
            "Exaggerated startle",
            "Jumping at sounds",
            "Overreaction to unexpected stimuli",
            "Cannot habituate to expected noises",
          ],
          captureHints: ["frequency", "triggers", "distress"],
        },
        {
          id: "ptsd_e5",
          symptomEntityId: "concentration_difficulty",
          label: "Problems with concentration",
          prompts: [
            "Difficulty concentrating",
            "Mind going blank",
            "Difficulty tracking conversations",
            "Impaired focus at work",
          ],
          captureHints: ["occupationalImpact", "subjective"],
        },
        {
          id: "ptsd_e6",
          symptomEntityId: "sleep_disturbance",
          label: "Sleep disturbance",
          prompts: [
            "Difficulty falling asleep",
            "Staying asleep",
            "Hyperarousal preventing sleep",
            "Non-restorative sleep",
          ],
          captureHints: ["baselineSleep", "currentPattern"],
        },
      ],
    },
    {
      id: "F",
      label: "Criterion F — Duration (>1 month)",
      description:
        "Duration of the disturbance (Criteria B, C, D, and E) is more than 1 month.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "duration",
          label: "Duration of symptoms",
          prompts: [
            "Onset date of symptoms",
            "Continuous vs intermittent",
            "Duration confirmed > 1 month",
            "Symptoms began after event (even if delayed)",
          ],
        },
      ],
    },
    {
      id: "G",
      label: "Criterion G — Functional Impairment",
      description:
        "The disturbance causes clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "occupational",
          label: "Occupational impairment",
          prompts: ["Work performance", "Attendance", "Role changes", "Job loss"],
        },
        {
          id: "social",
          label: "Social / relational impairment",
          prompts: ["Relationships", "Social withdrawal", "Parenting", "Intimacy"],
        },
        {
          id: "daily",
          label: "Daily functioning",
          prompts: ["Household tasks", "Self-care", "Routine activities"],
        },
      ],
    },
    {
      id: "H",
      label: "Criterion H — Medical / Substance Exclusion",
      description:
        "The disturbance is not attributable to the physiological effects of a substance (e.g., medication, alcohol) or another medical condition.",
      type: "exclusion",
      assessmentAreas: [
        {
          id: "substances",
          label: "Substance / medication effects",
          prompts: [
            "Alcohol or substance use",
            "Medications with CNS effects",
            "Temporal link to substance use",
          ],
        },
        {
          id: "medical",
          label: "Medical conditions",
          prompts: [
            "Head injury / TBI",
            "Neurological conditions",
            "Endocrine conditions",
          ],
        },
      ],
    },
  ],
};

// ── Acute Stress Disorder ─────────────────────────────────────────────────────

export const ASD_DEFINITION: DSMDiagnosisDef = {
  id: "asd",
  name: "Acute Stress Disorder",
  category: "Trauma-Related Disorders",
  abbreviation: "ASD",
  specifiers: [PANIC_ATTACK_SPECIFIER],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Trauma Exposure",
      description:
        "Exposure to actual or threatened death, serious injury, or sexual violence (direct, witnessed, indirect via close other, or repeated professional exposure).",
      type: "differential",
      assessmentAreas: [
        {
          id: "exposureType",
          label: "Nature of trauma exposure",
          prompts: [
            "Direct personal experience",
            "Witnessed in person",
            "Close other affected (violent/accidental)",
            "Repeated professional/occupational exposure",
          ],
        },
        {
          id: "eventDetails",
          label: "Event details",
          prompts: [
            "Date and nature of event",
            "Perceived threat to life or safety",
            "Emotional response at time of event",
          ],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — ≥9 Symptoms (across 5 domains)",
      description:
        "9 or more symptoms from any of: intrusion, negative mood, dissociation, avoidance, and arousal/reactivity. Duration: 3 days to 1 month after trauma.",
      type: "symptom_count",
      minRequired: 9,
      symptoms: [
        // Intrusion (1–5)
        {
          id: "asd_b1",
          symptomEntityId: "intrusive_memories",
          label: "[Intrusion] Recurrent distressing memories",
          prompts: ["Recurrent involuntary intrusive memories", "Distressing sensory re-experiencing"],
        },
        {
          id: "asd_b2",
          symptomEntityId: "trauma_dreams",
          label: "[Intrusion] Recurrent distressing dreams",
          prompts: ["Recurring nightmares related to event", "Distressing dream content"],
        },
        {
          id: "asd_b3",
          symptomEntityId: "flashbacks",
          label: "[Intrusion] Dissociative reactions (flashbacks)",
          prompts: ["Flashback episodes", "Feeling event is recurring", "Re-experiencing"],
        },
        {
          id: "asd_b4",
          symptomEntityId: "distress_to_cues",
          label: "[Intrusion] Intense distress to cues",
          prompts: ["Psychological distress to internal/external reminders"],
        },
        {
          id: "asd_b5",
          symptomEntityId: "physiological_reactivity",
          label: "[Intrusion] Physiological reactions to cues",
          prompts: ["Physical fear/arousal response to reminders"],
        },
        // Negative mood (6)
        {
          id: "asd_b6",
          symptomEntityId: "inability_positive_emotions",
          label: "[Negative mood] Inability to experience positive emotions",
          prompts: ["Persistent inability to feel happiness, love, or satisfaction"],
        },
        // Dissociation (7–8)
        {
          id: "asd_b7",
          symptomEntityId: "depersonalization",
          label: "[Dissociation] Altered sense of reality",
          prompts: ["Depersonalization", "Derealization", "Being in a daze", "Time distortion"],
        },
        {
          id: "asd_b8",
          symptomEntityId: "dissociative_amnesia",
          label: "[Dissociation] Inability to remember key aspect",
          prompts: ["Memory gap for important aspect of event", "Not explained by intoxication"],
        },
        // Avoidance (9–10)
        {
          id: "asd_b9",
          symptomEntityId: "cognitive_avoidance",
          label: "[Avoidance] Avoiding distressing memories / thoughts",
          prompts: ["Efforts to suppress trauma-related thoughts or feelings"],
        },
        {
          id: "asd_b10",
          symptomEntityId: "external_avoidance",
          label: "[Avoidance] Avoiding external reminders",
          prompts: ["Avoiding people, places, or situations associated with event"],
        },
        // Arousal (11–15)
        {
          id: "asd_b11",
          symptomEntityId: "sleep_disturbance",
          label: "[Arousal] Sleep disturbance",
          prompts: ["Insomnia", "Hyperarousal-related sleep problems"],
        },
        {
          id: "asd_b12",
          symptomEntityId: "irritability",
          label: "[Arousal] Irritable behaviour / angry outbursts",
          prompts: ["Irritability", "Angry outbursts", "Minimal provocation"],
        },
        {
          id: "asd_b13",
          symptomEntityId: "hypervigilance",
          label: "[Arousal] Hypervigilance",
          prompts: ["On guard", "Scanning for threats", "Exaggerated sense of danger"],
        },
        {
          id: "asd_b14",
          symptomEntityId: "concentration_difficulty",
          label: "[Arousal] Problems with concentration",
          prompts: ["Difficulty concentrating", "Mind going blank"],
        },
        {
          id: "asd_b15",
          symptomEntityId: "exaggerated_startle",
          label: "[Arousal] Exaggerated startle response",
          prompts: ["Jumping at sounds", "Overreaction to unexpected stimuli"],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Duration (3 days to 1 month)",
      description:
        "Duration of the disturbance is 3 days to 1 month after trauma exposure. Note: symptoms beginning immediately after exposure that persist for at least 3 days are required.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "duration",
          label: "Duration and timing",
          prompts: [
            "Symptom onset within days of event",
            "Duration ≥ 3 days confirmed",
            "Duration < 1 month (otherwise consider PTSD)",
            "Date of symptom onset",
          ],
        },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Functional Impairment",
      description:
        "The disturbance causes clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "impairment",
          label: "Functional impact",
          prompts: [
            "Work or study impairment",
            "Social withdrawal",
            "Inability to perform essential tasks",
            "Relationship strain",
          ],
        },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Medical / Substance Exclusion",
      description:
        "Not attributable to the physiological effects of a substance or another medical condition.",
      type: "exclusion",
      assessmentAreas: [
        {
          id: "substances",
          label: "Substance / medication effects",
          prompts: [
            "Substance use or intoxication",
            "Medication effects",
          ],
        },
        {
          id: "medical",
          label: "Medical / neurological conditions",
          prompts: [
            "TBI or head injury",
            "Brief psychotic episode",
          ],
        },
      ],
    },
  ],
};

// ── Adjustment Disorders ──────────────────────────────────────────────────────

export const ADJ_DEFINITION: DSMDiagnosisDef = {
  id: "adj",
  name: "Adjustment Disorders",
  category: "Trauma-Related Disorders",
  abbreviation: "AdjD",
  specifiers: [
    "With depressed mood",
    "With anxiety",
    "With mixed anxiety and depressed mood",
    "With disturbance of conduct",
    "With mixed disturbance of emotions and conduct",
    "Unspecified",
    PANIC_ATTACK_SPECIFIER,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Identifiable Stressor",
      description:
        "Emotional or behavioural symptoms in response to an identifiable stressor, occurring within 3 months of onset of the stressor.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "stressor",
          label: "Nature of stressor",
          prompts: [
            "Identifiable precipitating event",
            "Nature of stressor (occupational, relational, financial, medical, legal)",
            "Date stressor began",
            "Single episode or ongoing stressor",
            "Acute vs chronic stressor",
          ],
        },
        {
          id: "timing",
          label: "Timing (within 3 months)",
          prompts: [
            "Symptom onset within 3 months of stressor onset",
            "Temporal link clearly established",
          ],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Out-of-Proportion Distress or Impairment",
      description:
        "Either: (1) marked distress out of proportion to the stressor (considering context and cultural factors), or (2) significant impairment in social, occupational, or other areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "disproportionateDistress",
          label: "Distress out of proportion",
          prompts: [
            "Subjective distress level",
            "Comparison with expected response",
            "Cultural and contextual factors",
            "Severity relative to stressor magnitude",
          ],
        },
        {
          id: "functionalImpairment",
          label: "Functional impairment",
          prompts: [
            "Work performance decline",
            "Social functioning impaired",
            "Relationship difficulties",
            "Daily activities compromised",
          ],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Not Better Explained by Another Disorder",
      description:
        "The stress-related disturbance does not meet criteria for another mental disorder and is not merely an exacerbation of a preexisting mental disorder.",
      type: "differential",
      assessmentAreas: [
        {
          id: "otherDisorders",
          label: "Rule out other disorders",
          prompts: [
            "Does not meet full criteria for MDD, PTSD, or anxiety disorder",
            "Not exacerbation of preexisting disorder",
            "Symptoms best explained by stressor response",
          ],
        },
        {
          id: "preexisting",
          label: "Preexisting mental disorder",
          prompts: [
            "History of mental health conditions",
            "Baseline functioning prior to stressor",
            "Change from previous level of functioning",
          ],
        },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Not Normal Bereavement",
      description:
        "The symptoms do not represent normal bereavement.",
      type: "differential",
      assessmentAreas: [
        {
          id: "bereavement",
          label: "Bereavement assessment",
          prompts: [
            "Is the stressor a death of a close other?",
            "If so: symptoms out of proportion or prolonged beyond expected grief",
            "Cultural norms considered",
          ],
        },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Limited Duration",
      description:
        "Once the stressor or its consequences have ended, symptoms do not persist for more than 6 months.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "courseAndDuration",
          label: "Course and duration",
          prompts: [
            "Is the stressor ongoing or resolved?",
            "Duration of symptoms after stressor resolution",
            "Chronic vs acute specifier",
            "Prognosis if stressor persists",
          ],
        },
      ],
    },
  ],
};

// ── Other Specified Trauma- and Stressor-Related Disorder ──────────────────────

export const OTHER_TRAUMA_DEFINITION: DSMDiagnosisDef = {
  id: "other_trauma",
  name: "Other Specified Trauma- and Stressor-Related Disorder",
  category: "Trauma-Related Disorders",
  abbreviation: "OSTR",
  criteria: [
    {
      id: "A",
      label: "Presentation",
      description:
        "Symptoms characteristic of a trauma- and stressor-related disorder that cause significant distress or impairment but do not meet full criteria for any specific disorder in this category.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "presentation",
          label: "Clinical presentation",
          prompts: [
            "Describe the presenting syndrome",
            "Symptoms present and their severity",
            "Reason full criteria are not met",
            "Clinically significant distress or impairment confirmed",
          ],
        },
        {
          id: "specifiedReason",
          label: "Reason for 'Other Specified' designation",
          prompts: [
            "e.g. Adjustment-like disorder with delayed onset",
            "e.g. Prolonged grief with traumatic features",
            "e.g. Persistent complex bereavement disorder",
            "e.g. Cultural syndrome",
            "Specify reason below",
          ],
        },
      ],
    },
  ],
};

// ── Unspecified Trauma- and Stressor-Related Disorder ─────────────────────────

export const UNSPEC_TRAUMA_DEFINITION: DSMDiagnosisDef = {
  id: "unspec_trauma",
  name: "Unspecified Trauma- and Stressor-Related Disorder",
  category: "Trauma-Related Disorders",
  abbreviation: "USTR",
  criteria: [
    {
      id: "A",
      label: "Presentation",
      description:
        "Symptoms characteristic of a trauma- and stressor-related disorder that cause significant distress or impairment but do not meet full criteria for any specific disorder. Used when clinician chooses not to specify the reason criteria are not met.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "presentation",
          label: "Clinical presentation",
          prompts: [
            "Describe presenting symptoms",
            "Clinically significant distress or impairment confirmed",
            "Trauma or stressor exposure present",
            "Criteria for specific disorder not fully met",
          ],
        },
      ],
    },
  ],
};

// ── Substance-Related and Addictive Disorders ─────────────────────────────────
//
// Architecture: all 7 disorders share the same 11-symptom Criterion A
// structure. Each substance has its own entity ID prefix (aud_, cud_, etc.)
// so symptoms are tracked independently per substance.
//
// Severity thresholds: Mild 2–3 / Moderate 4–5 / Severe 6+
// (uses the `severe` threshold field — no "moderate-severe" rung for SUDs)

const SUD_REMISSION_SPECIFIERS = [
  "Early remission (3–12 months, no criteria except craving met)",
  "Sustained remission (>12 months, no criteria except craving met)",
  "In a controlled environment",
];

const SUD_SEVERITY: DSMDiagnosisDef["severityThresholds"] = {
  criterionId: "A",
  mild: 2,
  moderate: 4,
  severe: 6,
};

function sudImpairmentCriterion(id: string, label: string, description: string): DSMCriterionDef {
  return {
    id,
    label,
    description,
    type: "impairment",
    assessmentAreas: [
      {
        id: "functional",
        label: "Functional impairment",
        prompts: ["Clinically significant impairment or distress confirmed", "Impact on social functioning", "Impact on occupational functioning", "Impact on other important areas"],
      },
    ],
  };
}

function sudExclusionCriterion(id: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Exclusion`,
    description: "Symptoms are not better explained by another medical condition or mental disorder.",
    type: "exclusion",
    assessmentAreas: [
      {
        id: "exclusion",
        label: "Exclusion assessment",
        prompts: ["Not attributable to physiological effects of another substance", "Not better explained by another mental disorder", "Differential diagnoses considered"],
      },
    ],
  };
}

// ── Alcohol Use Disorder ──────────────────────────────────────────────────────

export const AUD_DEFINITION: DSMDiagnosisDef = {
  id: "aud",
  name: "Alcohol Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "AUD",
  severityThresholds: SUD_SEVERITY,
  specifiers: SUD_REMISSION_SPECIFIERS,
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Alcohol Use",
      description: "A problematic pattern of alcohol use leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "aud_a1",  symptomEntityId: "aud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Drink more than planned","Session longer than intended"] },
        { id: "aud_a2",  symptomEntityId: "aud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Repeated failed attempts","Wanting to cut down but unable"] },
        { id: "aud_a3",  symptomEntityId: "aud_time_spent",          label: "Great deal of time spent",                     prompts: ["Time obtaining alcohol","Time recovering from drinking"] },
        { id: "aud_a4",  symptomEntityId: "aud_craving",             label: "Craving or strong urge to drink",              prompts: ["Intense urge","Preoccupation with drinking","Craving frequency"] },
        { id: "aud_a5",  symptomEntityId: "aud_role_failure",        label: "Recurrent failure to fulfill role obligations", prompts: ["Work absence","Family duties neglected","Recurring impairment at work"] },
        { id: "aud_a6",  symptomEntityId: "aud_social_problems",     label: "Continued use despite social problems",        prompts: ["Relationship conflicts caused by drinking","Persistent interpersonal problems"] },
        { id: "aud_a7",  symptomEntityId: "aud_activities_given_up", label: "Important activities given up or reduced",     prompts: ["Hobbies abandoned","Social or recreational activities avoided"] },
        { id: "aud_a8",  symptomEntityId: "aud_hazardous_use",       label: "Recurrent use in physically hazardous situations", prompts: ["Driving under influence","Operating machinery while intoxicated"] },
        { id: "aud_a9",  symptomEntityId: "aud_continued_harm",      label: "Continued use despite knowing it causes harm", prompts: ["Liver disease","Depression worsened by alcohol","Aware but continues"] },
        { id: "aud_a10", symptomEntityId: "aud_tolerance",           label: "Tolerance",                                    prompts: ["Needs more to achieve intoxication","Markedly diminished effect with same amount"] },
        { id: "aud_a11", symptomEntityId: "aud_withdrawal",          label: "Withdrawal",                                   prompts: ["Characteristic alcohol withdrawal syndrome","Using to relieve or avoid withdrawal symptoms"] },
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
  ],
};

// ── Cannabis Use Disorder ─────────────────────────────────────────────────────

export const CUD_DEFINITION: DSMDiagnosisDef = {
  id: "cud",
  name: "Cannabis Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "CUD",
  severityThresholds: SUD_SEVERITY,
  specifiers: SUD_REMISSION_SPECIFIERS,
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Cannabis Use",
      description: "A problematic pattern of cannabis use leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "cud_a1",  symptomEntityId: "cud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Sessions longer than planned","Amounts exceed intention"] },
        { id: "cud_a2",  symptomEntityId: "cud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Failed quit attempts","Tolerance breaks abandoned"] },
        { id: "cud_a3",  symptomEntityId: "cud_time_spent",          label: "Great deal of time spent",                     prompts: ["Time obtaining cannabis","Post-intoxication impairment period"] },
        { id: "cud_a4",  symptomEntityId: "cud_craving",             label: "Craving or strong urge to use cannabis",       prompts: ["Urge to use","Situational craving triggers"] },
        { id: "cud_a5",  symptomEntityId: "cud_role_failure",        label: "Recurrent failure to fulfill role obligations", prompts: ["Work or study impairment","Daily tasks neglected"] },
        { id: "cud_a6",  symptomEntityId: "cud_social_problems",     label: "Continued use despite social problems",        prompts: ["Relationship conflicts","Family concern about use"] },
        { id: "cud_a7",  symptomEntityId: "cud_activities_given_up", label: "Important activities given up or reduced",     prompts: ["Sports or hobbies stopped","Social withdrawal"] },
        { id: "cud_a8",  symptomEntityId: "cud_hazardous_use",       label: "Recurrent use in physically hazardous situations", prompts: ["Driving while impaired","Using at work"] },
        { id: "cud_a9",  symptomEntityId: "cud_continued_harm",      label: "Continued use despite knowing it causes harm", prompts: ["Mental health worsening","Motivational syndrome","Aware but continues"] },
        { id: "cud_a10", symptomEntityId: "cud_tolerance",           label: "Tolerance",                                    prompts: ["Increased amount needed for same effect","Reduced effect at same dose"] },
        { id: "cud_a11", symptomEntityId: "cud_withdrawal",          label: "Withdrawal",                                   prompts: ["Irritability on cessation","Anxiety/sleep disturbance after stopping","Cannabis withdrawal syndrome"] },
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
  ],
};

// ── Inhalant Use Disorder ─────────────────────────────────────────────────────
// Note: DSM-5 inhalant use disorder does NOT include tolerance or withdrawal criteria (9 symptoms only).

export const INUD_DEFINITION: DSMDiagnosisDef = {
  id: "inud",
  name: "Inhalant Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "InUD",
  severityThresholds: { criterionId: "A", mild: 2, moderate: 4, severe: 6 },
  specifiers: [
    "Specify inhalant type (e.g. solvent, glue, petrol, aerosol)",
    "In a controlled environment",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Inhalant Use",
      description: "A problematic pattern of use of a hydrocarbon-based inhalant substance leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "inud_a1", symptomEntityId: "inud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Sessions longer than planned"] },
        { id: "inud_a2", symptomEntityId: "inud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Failed attempts to stop","Wanting to reduce"] },
        { id: "inud_a3", symptomEntityId: "inud_time_spent",          label: "Great deal of time spent",                     prompts: ["Time obtaining inhalants","Recovery from intoxication"] },
        { id: "inud_a4", symptomEntityId: "inud_craving",             label: "Craving or strong urge to use",                prompts: ["Urge to use","Preoccupation with use"] },
        { id: "inud_a5", symptomEntityId: "inud_role_failure",        label: "Recurrent failure to fulfill role obligations", prompts: ["School / work failures","Cognitive impairment"] },
        { id: "inud_a6", symptomEntityId: "inud_social_problems",     label: "Continued use despite social problems",        prompts: ["Family concern","Peer group changes"] },
        { id: "inud_a7", symptomEntityId: "inud_activities_given_up", label: "Important activities given up or reduced",     prompts: ["Activities replaced by use"] },
        { id: "inud_a8", symptomEntityId: "inud_hazardous_use",       label: "Recurrent use in physically hazardous situations", prompts: ["Sudden sniffing death risk","Using alone","Near traffic"] },
        { id: "inud_a9", symptomEntityId: "inud_continued_harm",      label: "Continued use despite knowing it causes harm", prompts: ["Organ damage acknowledged","Neurotoxicity","Continued despite warnings"] },
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
    sudExclusionCriterion("C"),
  ],
};

// ── Opioid Use Disorder ───────────────────────────────────────────────────────

export const OUD_DEFINITION: DSMDiagnosisDef = {
  id: "oud",
  name: "Opioid Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "OUD",
  severityThresholds: SUD_SEVERITY,
  specifiers: [
    "Early remission (3–12 months, no criteria except craving met)",
    "Sustained remission (>12 months, no criteria except craving met)",
    "On maintenance therapy (buprenorphine/methadone)",
    "In a controlled environment",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Opioid Use",
      description: "A problematic pattern of opioid use leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "oud_a1",  symptomEntityId: "oud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Dose exceeds prescription","Using for longer than prescribed"] },
        { id: "oud_a2",  symptomEntityId: "oud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Failed attempts to reduce","Wanting to stop"] },
        { id: "oud_a3",  symptomEntityId: "oud_time_spent",          label: "Great deal of time spent",                     prompts: ["Doctor shopping","Time recovering from effects"] },
        { id: "oud_a4",  symptomEntityId: "oud_craving",             label: "Craving or strong urge to use opioids",        prompts: ["Strong urge","Preoccupation with next dose","Dose-time craving"] },
        { id: "oud_a5",  symptomEntityId: "oud_role_failure",        label: "Recurrent failure to fulfill role obligations", prompts: ["Work impairment","Sedation interfering with duties"] },
        { id: "oud_a6",  symptomEntityId: "oud_social_problems",     label: "Continued use despite social problems",        prompts: ["Relationship conflict","Family concern"] },
        { id: "oud_a7",  symptomEntityId: "oud_activities_given_up", label: "Important activities given up or reduced",     prompts: ["Reduced activity due to sedation","Hobbies abandoned"] },
        { id: "oud_a8",  symptomEntityId: "oud_hazardous_use",       label: "Recurrent use in physically hazardous situations", prompts: ["Driving while impaired","Using illicit opioids"] },
        { id: "oud_a9",  symptomEntityId: "oud_continued_harm",      label: "Continued use despite knowing it causes harm", prompts: ["Physical dependency acknowledged","Overdose history","Continued despite medical advice"] },
        { id: "oud_a10", symptomEntityId: "oud_tolerance",           label: "Tolerance",                                    prompts: ["Dose escalation","Reduced analgesia","Needing more for same pain relief"] },
        { id: "oud_a11", symptomEntityId: "oud_withdrawal",          label: "Withdrawal",                                   prompts: ["Physical withdrawal symptoms","Using to avoid withdrawal","Sweating/nausea/muscle pain on cessation"] },
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
  ],
};

// ── Sedative, Hypnotic, or Anxiolytic Use Disorder ────────────────────────────

export const SHAUD_DEFINITION: DSMDiagnosisDef = {
  id: "shaud",
  name: "Sedative, Hypnotic, or Anxiolytic Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "SHA-UD",
  severityThresholds: SUD_SEVERITY,
  specifiers: SUD_REMISSION_SPECIFIERS,
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Sedative/Hypnotic/Anxiolytic Use",
      description: "A problematic pattern of sedative, hypnotic, or anxiolytic use leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "shaud_a1",  symptomEntityId: "shaud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Exceeding prescribed dose","Using for longer than recommended"] },
        { id: "shaud_a2",  symptomEntityId: "shaud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Attempted reduction without success","Tapers that failed"] },
        { id: "shaud_a3",  symptomEntityId: "shaud_time_spent",          label: "Great deal of time spent",                     prompts: ["Managing prescriptions","Recovery from sedation"] },
        { id: "shaud_a4",  symptomEntityId: "shaud_craving",             label: "Craving or strong urge to use",                prompts: ["Urge to use sedative","Preoccupation with availability"] },
        { id: "shaud_a5",  symptomEntityId: "shaud_role_failure",        label: "Recurrent failure to fulfill role obligations", prompts: ["Cognitive impairment","Work performance decline"] },
        { id: "shaud_a6",  symptomEntityId: "shaud_social_problems",     label: "Continued use despite social problems",        prompts: ["Relationship difficulties","Concern from others"] },
        { id: "shaud_a7",  symptomEntityId: "shaud_activities_given_up", label: "Important activities given up or reduced",     prompts: ["Avoids driving","Social withdrawal"] },
        { id: "shaud_a8",  symptomEntityId: "shaud_hazardous_use",       label: "Recurrent use in physically hazardous situations", prompts: ["Driving while sedated","Combining with alcohol"] },
        { id: "shaud_a9",  symptomEntityId: "shaud_continued_harm",      label: "Continued use despite knowing it causes harm", prompts: ["Cognitive effects acknowledged","Falls risk","Continued despite medical advice"] },
        { id: "shaud_a10", symptomEntityId: "shaud_tolerance",           label: "Tolerance",                                    prompts: ["Dose escalation","Diminished anxiolytic effect at same dose"] },
        { id: "shaud_a11", symptomEntityId: "shaud_withdrawal",          label: "Withdrawal",                                   prompts: ["Rebound anxiety on cessation","Seizure risk","Physical withdrawal","Using to avoid withdrawal"] },
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
  ],
};

// ── Stimulant Use Disorder ────────────────────────────────────────────────────

export const STUD_DEFINITION: DSMDiagnosisDef = {
  id: "stud",
  name: "Stimulant Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "StUD",
  severityThresholds: SUD_SEVERITY,
  specifiers: [
    "Amphetamine-type substance",
    "Cocaine",
    "Other or unspecified stimulant",
    "Early remission (3–12 months, no criteria except craving met)",
    "Sustained remission (>12 months, no criteria except craving met)",
    "In a controlled environment",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Stimulant Use",
      description: "A pattern of amphetamine-type substance, cocaine, or other stimulant use leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "stud_a1",  symptomEntityId: "stud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Binge longer than planned","Taking more than intended"] },
        { id: "stud_a2",  symptomEntityId: "stud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Failed quit attempts","Cutting-down attempts"] },
        { id: "stud_a3",  symptomEntityId: "stud_time_spent",          label: "Great deal of time spent",                     prompts: ["Time obtaining stimulants","Crash / recovery period"] },
        { id: "stud_a4",  symptomEntityId: "stud_craving",             label: "Craving or strong urge to use",                prompts: ["Intense craving","Craving triggers (fatigue, stress)","Preoccupation with use"] },
        { id: "stud_a5",  symptomEntityId: "stud_role_failure",        label: "Recurrent failure to fulfill role obligations", prompts: ["Post-binge inability to function","Work or study failures"] },
        { id: "stud_a6",  symptomEntityId: "stud_social_problems",     label: "Continued use despite social problems",        prompts: ["Relationship conflicts","Paranoia or aggression affecting relationships"] },
        { id: "stud_a7",  symptomEntityId: "stud_activities_given_up", label: "Important activities given up or reduced",     prompts: ["Hobbies abandoned","Physical health activities stopped"] },
        { id: "stud_a8",  symptomEntityId: "stud_hazardous_use",       label: "Recurrent use in physically hazardous situations", prompts: ["Risky sexual behaviour","Driving while intoxicated","Workplace use"] },
        { id: "stud_a9",  symptomEntityId: "stud_continued_harm",      label: "Continued use despite knowing it causes harm", prompts: ["Cardiovascular risk","Psychosis risk","Weight loss acknowledged"] },
        { id: "stud_a10", symptomEntityId: "stud_tolerance",           label: "Tolerance",                                    prompts: ["Dose escalation","Diminished euphoric effect"] },
        { id: "stud_a11", symptomEntityId: "stud_withdrawal",          label: "Withdrawal / crash",                           prompts: ["Crash after use (fatigue, dysphoria)","Hypersomnia","Increased appetite after cessation"] },
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
  ],
};

// ── Other Substance Use Disorder ──────────────────────────────────────────────

export const OSUD_DEFINITION: DSMDiagnosisDef = {
  id: "osud",
  name: "Other Substance Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "OtherSUD",
  severityThresholds: SUD_SEVERITY,
  specifiers: [
    "Specify substance (e.g. ketamine, MDMA, nicotine, hallucinogen)",
    "Early remission (3–12 months, no criteria except craving met)",
    "Sustained remission (>12 months, no criteria except craving met)",
    "In a controlled environment",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Substance Use",
      description: "A problematic pattern of use of the specified substance leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "osud_a1",  symptomEntityId: "osud_larger_longer",       label: "Larger amounts / longer than intended",        prompts: ["Taking more than planned","Sessions longer than intended"] },
        { id: "osud_a2",  symptomEntityId: "osud_cut_down",            label: "Persistent desire / unsuccessful cut-down",    prompts: ["Failed reduction attempts","Wanting to stop"] },
        { id: "osud_a3",  symptomEntityId: "osud_time_spent",          label: "Great deal of time spent",                     prompts: ["Time obtaining substance","Recovery period"] },
        { id: "osud_a4",  symptomEntityId: "osud_craving",             label: "Craving or strong urge to use",                prompts: ["Urge to use","Craving triggers and frequency"] },
        { id: "osud_a5",  symptomEntityId: "osud_role_failure",        label: "Recurrent failure to fulfill role obligations", prompts: ["Work / study failures","Responsibilities neglected"] },
        { id: "osud_a6",  symptomEntityId: "osud_social_problems",     label: "Continued use despite social problems",        prompts: ["Relationship conflicts","Family concern about use"] },
        { id: "osud_a7",  symptomEntityId: "osud_activities_given_up", label: "Important activities given up or reduced",     prompts: ["Hobbies abandoned","Social activities stopped"] },
        { id: "osud_a8",  symptomEntityId: "osud_hazardous_use",       label: "Recurrent use in physically hazardous situations", prompts: ["Driving while intoxicated","Using in unsafe contexts"] },
        { id: "osud_a9",  symptomEntityId: "osud_continued_harm",      label: "Continued use despite knowing it causes harm", prompts: ["Harm acknowledged but continues","Medical or psychological worsening"] },
        { id: "osud_a10", symptomEntityId: "osud_tolerance",           label: "Tolerance",                                    prompts: ["Dose escalation","Reduced effect at same dose"] },
        { id: "osud_a11", symptomEntityId: "osud_withdrawal",          label: "Withdrawal",                                   prompts: ["Characteristic withdrawal syndrome","Using to avoid withdrawal"] },
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
  ],
};

// ── Eating Disorders ──────────────────────────────────────────────────────────
//
// Severity uses a 4-level clinical scale (Mild / Moderate / Severe / Extreme)
// based on BMI (AN) or episodes-per-week (BN, BED) — not symptom count.
// showManualSeverity: true disables auto-calculation; clinician selects manually.
// showBmiEntry: true (AN only) shows a BMI input in the Diagnostic Summary.

// ── Anorexia Nervosa ──────────────────────────────────────────────────────────

export const AN_DEFINITION: DSMDiagnosisDef = {
  id: "an",
  name: "Anorexia Nervosa",
  category: "Eating Disorders",
  abbreviation: "AN",
  showManualSeverity: true,
  showBmiEntry: true,
  specifiers: [
    // Subtypes
    "Restricting type",
    "Binge-eating/purging type",
    // Remission
    "Partial remission",
    "Full remission",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Energy Restriction / Low Body Weight",
      description: "Restriction of energy intake relative to requirements, leading to a significantly low body weight in context of age, sex, developmental trajectory, and physical health.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        {
          id: "an_a1",
          symptomEntityId: "food_restriction",
          label: "Restriction of energy intake",
          prompts: ["Caloric restriction", "Severely limited diet", "Food avoidance rules", "Dietary restriction pattern", "Energy intake below requirements"],
          captureHints: ["bmiEntry"],
        },
        {
          id: "an_a2",
          symptomEntityId: "low_body_weight",
          label: "Significantly low body weight",
          prompts: ["Weight below expected minimum", "BMI below threshold", "Significant weight loss", "Underweight for age and sex", "Body weight concerns"],
          captureHints: ["bmiEntry"],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Fear of Weight Gain",
      description: "Intense fear of gaining weight or of becoming fat, or persistent behaviour that interferes with weight gain, even though at a significantly low weight.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        {
          id: "an_b1",
          symptomEntityId: "fear_weight_gain",
          label: "Intense fear of gaining weight",
          prompts: ["Phobic fear of weight gain", "Distress at prospect of gaining weight", "Preoccupation with gaining weight", "Avoidance of weight gain"],
        },
        {
          id: "an_b2",
          symptomEntityId: "weight_interfering_behaviour",
          label: "Persistent behaviour interfering with weight gain",
          prompts: ["Behaviours preventing weight restoration", "Exercise to offset intake", "Food rituals maintaining low weight", "Weight-checking behaviours", "Purging despite low weight"],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Body Image Disturbance / Lack of Insight",
      description: "Disturbance in the way in which one's body weight or shape is experienced, undue influence of body weight or shape on self-evaluation, or persistent lack of recognition of the seriousness of the current low body weight.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        {
          id: "an_c1",
          symptomEntityId: "body_image_disturbance",
          label: "Body image disturbance",
          prompts: ["Distorted body perception", "Sees self as fat despite low weight", "Undue influence of weight on self-worth", "Body checking behaviours", "Body dissatisfaction"],
        },
        {
          id: "an_c2",
          symptomEntityId: "lack_insight_low_weight",
          label: "Lack of recognition of seriousness",
          prompts: ["Denial of low weight significance", "Minimises medical risk", "No concern about consequences", "Egosyntonic weight restriction"],
        },
      ],
    },
  ],
};

// ── Bulimia Nervosa ───────────────────────────────────────────────────────────

export const BN_DEFINITION: DSMDiagnosisDef = {
  id: "bn",
  name: "Bulimia Nervosa",
  category: "Eating Disorders",
  abbreviation: "BN",
  showManualSeverity: true,
  specifiers: [
    "Partial remission",
    "Full remission",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Recurrent Binge Eating",
      description: "Recurrent episodes of binge eating characterised by: (1) eating in a discrete period an amount definitely larger than most people would eat; AND (2) a sense of lack of control over eating during the episode.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        {
          id: "bn_a1",
          symptomEntityId: "binge_eating",
          label: "Eating an objectively large amount",
          prompts: ["Objectively large food intake", "Eating more than most would in same time", "Episodes of overeating", "Binge episode content"],
        },
        {
          id: "bn_a2",
          symptomEntityId: "loss_of_control_eating",
          label: "Loss of control during eating",
          prompts: ["Cannot stop eating", "Feels unable to control eating", "Eating feels out of control", "Unable to stop once started"],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Recurrent Compensatory Behaviours",
      description: "Recurrent inappropriate compensatory behaviour to prevent weight gain (e.g. self-induced vomiting; misuse of laxatives, diuretics, or other medications; fasting; excessive exercise).",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        {
          id: "bn_b1",
          symptomEntityId: "compensatory_vomiting",
          label: "Self-induced vomiting",
          prompts: ["Induced vomiting after eating", "Vomiting frequency", "Methods used", "Dental erosion", "Russell's sign"],
        },
        {
          id: "bn_b2",
          symptomEntityId: "laxative_misuse",
          label: "Laxative / diuretic misuse",
          prompts: ["Laxative use after eating", "Types and amounts", "Diuretic misuse", "Frequency"],
        },
        {
          id: "bn_b3",
          symptomEntityId: "compensatory_fasting",
          label: "Fasting",
          prompts: ["Skipping meals after bingeing", "Prolonged fasting to compensate", "Caloric restriction post-binge"],
        },
        {
          id: "bn_b4",
          symptomEntityId: "excessive_exercise",
          label: "Excessive exercise",
          prompts: ["Compulsive exercise after eating", "Exercise despite injury or illness", "Distress if unable to exercise", "Exercise to purge calories"],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Frequency / Duration",
      description: "The binge eating and inappropriate compensatory behaviours both occur, on average, at least once a week for 3 months.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "frequency",
          label: "Frequency and duration",
          prompts: ["At least once weekly", "Duration ≥ 3 months", "Approximate frequency per week", "Pattern over time"],
        },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Weight / Shape Overvaluation",
      description: "Self-evaluation is unduly influenced by body shape and weight.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        {
          id: "bn_d1",
          symptomEntityId: "weight_shape_overvaluation",
          label: "Self-evaluation dominated by weight/shape",
          prompts: ["Weight drives self-worth", "Shape central to identity", "Cannot separate value from body weight", "Weight and shape dominate thoughts"],
        },
        {
          id: "bn_d2",
          symptomEntityId: "body_image_disturbance",
          label: "Body image disturbance",
          prompts: ["Distorted perception of body", "Excessive body-checking", "Body dissatisfaction", "Preoccupation with shape"],
        },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Not Exclusively During AN",
      description: "The disturbance does not occur exclusively during episodes of anorexia nervosa.",
      type: "exclusion",
      assessmentAreas: [
        {
          id: "exclusion_an",
          label: "Exclusion — anorexia nervosa",
          prompts: ["Current weight at or above minimum normal", "Symptoms not exclusively during AN episode", "Not currently meeting AN criteria"],
        },
      ],
    },
  ],
};

// ── Binge-Eating Disorder ─────────────────────────────────────────────────────

export const BED_DEFINITION: DSMDiagnosisDef = {
  id: "bed",
  name: "Binge-Eating Disorder",
  category: "Eating Disorders",
  abbreviation: "BED",
  showManualSeverity: true,
  specifiers: [
    "Partial remission",
    "Full remission",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Recurrent Binge Eating Episodes",
      description: "Recurrent episodes of binge eating characterised by: (1) eating in a discrete period an amount larger than most people would eat; AND (2) a sense of lack of control.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        {
          id: "bed_a1",
          symptomEntityId: "binge_eating",
          label: "Eating an objectively large amount",
          prompts: ["Large discrete food intake", "Amount larger than most would eat", "Binge episode size and content"],
        },
        {
          id: "bed_a2",
          symptomEntityId: "loss_of_control_eating",
          label: "Lack of control during eating",
          prompts: ["Feels unable to stop", "Loss of control over what or how much is eaten"],
        },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Associated Features (≥ 3 of 5)",
      description: "The binge eating episodes are associated with ≥ 3 of: eating faster than normal; eating until uncomfortably full; eating when not physically hungry; eating alone due to embarrassment; feeling disgusted, depressed, or guilty afterward.",
      type: "symptom_count",
      minRequired: 3,
      symptoms: [
        {
          id: "bed_b1",
          symptomEntityId: "rapid_eating",
          label: "Eating much more rapidly than normal",
          prompts: ["Eating very quickly", "Gobbling food", "Difficulty slowing pace of eating"],
        },
        {
          id: "bed_b2",
          symptomEntityId: "eating_until_full",
          label: "Eating until uncomfortably full",
          prompts: ["Eating past fullness", "Physical discomfort after eating", "Stomach pain from overeating"],
        },
        {
          id: "bed_b3",
          symptomEntityId: "eating_when_not_hungry",
          label: "Eating when not physically hungry",
          prompts: ["Eating without physical hunger", "Emotional eating", "Eating to cope"],
        },
        {
          id: "bed_b4",
          symptomEntityId: "eating_in_secret",
          label: "Eating alone due to embarrassment",
          prompts: ["Hides eating from others", "Embarrassed about amount eaten", "Secret eating episodes"],
        },
        {
          id: "bed_b5",
          symptomEntityId: "guilt_after_eating",
          label: "Feeling disgusted, depressed, or guilty afterward",
          prompts: ["Guilt after eating", "Shame after binge", "Self-disgust", "Low mood after episodes"],
        },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Marked Distress",
      description: "Marked distress regarding binge eating.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        {
          id: "bed_c1",
          symptomEntityId: "eating_distress",
          label: "Marked distress about binge eating",
          prompts: ["Significant distress about episodes", "Preoccupation with eating pattern", "Distress is clinically significant"],
        },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Frequency / Duration",
      description: "Binge eating occurs, on average, at least once a week for 3 months.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "frequency",
          label: "Frequency and duration",
          prompts: ["At least once per week", "Duration ≥ 3 months", "Frequency pattern", "Consistency over time"],
        },
      ],
    },
    {
      id: "E",
      label: "Criterion E — No Recurrent Compensatory Behaviour",
      description: "The binge eating is not associated with recurrent use of inappropriate compensatory behaviour (as in bulimia nervosa) and does not occur exclusively during the course of bulimia nervosa or anorexia nervosa.",
      type: "exclusion",
      assessmentAreas: [
        {
          id: "exclusion_comp",
          label: "Absence of compensatory behaviour",
          prompts: ["No self-induced vomiting", "No laxative misuse", "No fasting to compensate", "No excessive exercise to compensate", "Not during BN or AN"],
        },
      ],
    },
  ],
};

// ── Other Specified Feeding or Eating Disorder (OSFED) ────────────────────────

export const OSFED_DEFINITION: DSMDiagnosisDef = {
  id: "osfed",
  name: "Other Specified Feeding or Eating Disorder",
  category: "Eating Disorders",
  abbreviation: "OSFED",
  specifiers: [
    "Atypical anorexia nervosa",
    "Bulimia nervosa (low frequency / limited duration)",
    "Binge-eating disorder (low frequency / limited duration)",
    "Purging disorder",
    "Night eating syndrome",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Clinically Significant Distress / Impairment",
      description: "Presentation causes clinically significant distress or impairment in social, occupational, or other important areas of functioning, but does not meet full criteria for a specific feeding or eating disorder.",
      type: "differential",
      assessmentAreas: [
        {
          id: "presentation",
          label: "Presentation",
          prompts: ["Describe presenting symptoms", "Which full-threshold disorder do symptoms most resemble?", "Why criteria are not fully met (frequency, duration, weight, etc.)", "Clinically significant impairment present"],
        },
        {
          id: "atypical_an",
          label: "Atypical Anorexia Nervosa",
          prompts: ["AN criteria met except weight within / above normal range", "Significant weight loss behaviour present", "Fear of weight gain present", "Body image disturbance present"],
        },
        {
          id: "purging_disorder",
          label: "Purging Disorder",
          prompts: ["Recurrent purging to control weight/shape", "Vomiting or laxative use without binge eating", "Not meeting full BN criteria"],
        },
        {
          id: "night_eating",
          label: "Night Eating Syndrome",
          prompts: ["Recurrent episodes of night eating", "Eating after awakening from sleep", "Excessive food intake after evening meal", "Awareness and recall of eating", "Distress caused"],
        },
      ],
    },
  ],
};

// ── Unspecified Feeding or Eating Disorder ────────────────────────────────────

export const UNSPEC_FEED_DEFINITION: DSMDiagnosisDef = {
  id: "unspec_feed",
  name: "Unspecified Feeding or Eating Disorder",
  category: "Eating Disorders",
  abbreviation: "UnspecFEED",
  criteria: [
    {
      id: "A",
      label: "Criterion A — Eating Disturbance",
      description: "Symptoms characteristic of a feeding or eating disorder that cause clinically significant distress or impairment but do not meet full criteria for a specific disorder, and the clinician chooses not to specify the reason criteria are not met.",
      type: "impairment",
      assessmentAreas: [
        {
          id: "presentation",
          label: "Clinical presentation",
          prompts: ["Describe eating disturbance", "Clinically significant distress or impairment confirmed", "Criteria for specific eating disorder not fully met"],
        },
        {
          id: "evidence",
          label: "Evidence and rationale",
          prompts: ["Evidence supporting eating disorder diagnosis", "Why full criteria not met", "Functional impact on daily life"],
        },
      ],
    },
  ],
};

// ── Anxiety Disorders ─────────────────────────────────────────────────────────
//
// The cross-diagnosis Panic Attack Specifier (PANIC_ATTACK_SPECIFIER) is
// declared near the top of this file. It is included in `specifiers` arrays
// on every diagnosis that accepts "with panic attacks" — both anxiety
// disorders here and pre-existing diagnoses (MDD, PDD, PTSD, ASD, ADJ).
// Panic attacks are a feature, not a disorder; Panic Disorder itself does
// NOT carry the specifier (panic attacks are intrinsic there). Documenting
// panic-attack symptom evidence happens via the shared SymptomEntity store
// (panic_* entities), editable from either Current Symptoms or the Panic
// Disorder page.

// Shared anxiety impairment + medical-exclusion + differential helpers,
// patterned on `sudImpairmentCriterion` etc.
function anxietyImpairmentCriterion(id: string, label?: string): DSMCriterionDef {
  return {
    id,
    label: label ?? `Criterion ${id} — Functional Impairment`,
    description:
      "The fear, anxiety, or avoidance causes clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
    type: "impairment",
    assessmentAreas: [
      { id: "occupational", label: "Occupational impairment", prompts: ["Reduced work performance", "Avoiding work tasks", "Time off work", "Career restriction"] },
      { id: "social",       label: "Social impairment",       prompts: ["Avoidance of social engagements", "Loss of friendships", "Restricted social activity"] },
      { id: "daily",        label: "Daily functioning",        prompts: ["Errands avoided", "Restricted activities of daily living", "Dependence on companion"] },
      { id: "distress",     label: "Distress",                 prompts: ["Subjective distress about symptoms", "Distress out of proportion to threat"] },
    ],
  };
}

function anxietyMedicalExclusion(id: string, label?: string): DSMCriterionDef {
  return {
    id,
    label: label ?? `Criterion ${id} — Substance / Medical Exclusion`,
    description:
      "The disturbance is not attributable to the physiological effects of a substance (e.g., a drug of abuse, a medication) or another medical condition (e.g., hyperthyroidism, cardiopulmonary disorder).",
    type: "exclusion",
    assessmentAreas: [
      { id: "substances",  label: "Substance contribution", prompts: ["Caffeine intake", "Stimulant use", "Cannabis", "Withdrawal states"] },
      { id: "medications", label: "Medication effects",     prompts: ["Bronchodilators", "Thyroid replacement", "Steroids", "Recent medication changes"] },
      { id: "medical",     label: "Medical conditions",     prompts: ["Hyperthyroidism", "Cardiac arrhythmia", "Pheochromocytoma", "Asthma / COPD", "Vestibular disorder"] },
    ],
  };
}

function anxietyDifferentialExclusion(id: string, description: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Differential Exclusion`,
    description,
    type: "differential",
    assessmentAreas: [
      { id: "other_anxiety", label: "Other anxiety disorders", prompts: ["Generalised Anxiety Disorder", "Social Anxiety Disorder", "Panic Disorder", "Specific Phobia", "Agoraphobia", "Separation Anxiety"] },
      { id: "trauma",        label: "Trauma-related disorders", prompts: ["PTSD", "ASD", "Adjustment Disorder"] },
      { id: "ocd",           label: "OCD / related",            prompts: ["Obsessions / compulsions", "Body dysmorphic disorder"] },
      { id: "other",         label: "Other / general",          prompts: ["Mood disorder accounting for symptoms", "Psychotic disorder"] },
    ],
  };
}

// ── Social Anxiety Disorder (Social Phobia) — 300.23 (F40.10) ────────────────

export const SAD_DEFINITION: DSMDiagnosisDef = {
  id: "sad",
  name: "Social Anxiety Disorder (Social Phobia)",
  category: "Anxiety Disorders",
  abbreviation: "SAD",
  specifiers: [
    "Performance only",
    PANIC_ATTACK_SPECIFIER,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Fear of Social Situations",
      description:
        "Marked fear or anxiety about one or more social situations in which the individual is exposed to possible scrutiny by others.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "sad_a1", symptomEntityId: "social_fear",        label: "Fear of social situations",        prompts: ["Conversations / meeting strangers", "Being observed (eating / drinking)", "Performance situations"] },
        { id: "sad_a2", symptomEntityId: "fear_of_scrutiny",   label: "Fear of being scrutinised",        prompts: ["Fear of being watched", "Fear of evaluation", "Performance anxiety"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Fear of Negative Evaluation",
      description:
        "The individual fears that they will act in a way, or show anxiety symptoms, that will be negatively evaluated (i.e., humiliating, embarrassing; lead to rejection or offence).",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "sad_b1", symptomEntityId: "fear_of_embarrassment", label: "Fear of negative evaluation / embarrassment", prompts: ["Fear of being judged", "Fear of acting embarrassingly", "Fear of visible anxiety being noticed"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Almost Always Provokes Anxiety",
      description: "The social situations almost always provoke fear or anxiety.",
      type: "impairment",
      assessmentAreas: [
        { id: "consistency", label: "Consistency of response", prompts: ["Fear elicited on each exposure", "Rare exceptions", "Anxiety reliably present"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Avoidance / Endured with Intense Fear",
      description: "The social situations are avoided or endured with intense fear or anxiety.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "sad_d1", symptomEntityId: "avoidance_behaviours", label: "Avoidance / endured with distress", prompts: ["Avoids social engagements", "Endures only with intense distress", "Safety behaviours / safety person"] },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Out of Proportion",
      description: "The fear or anxiety is out of proportion to the actual threat posed by the social situation and to the sociocultural context.",
      type: "impairment",
      assessmentAreas: [
        { id: "proportion", label: "Proportionality", prompts: ["Clinician assessment", "Sociocultural context considered", "Threat appraisal disproportionate"] },
      ],
    },
    {
      id: "F",
      label: "Criterion F — Duration ≥ 6 Months",
      description: "The fear, anxiety, or avoidance is persistent, typically lasting for 6 months or more.",
      type: "impairment",
      assessmentAreas: [
        { id: "duration", label: "Duration", prompts: ["Onset date", "≥ 6 months continuous", "Course / fluctuation"] },
      ],
    },
    anxietyImpairmentCriterion("G"),
    anxietyMedicalExclusion("H"),
    anxietyDifferentialExclusion(
      "I",
      "The disturbance is not better explained by the symptoms of another mental disorder, such as panic disorder, body dysmorphic disorder, or autism spectrum disorder.",
    ),
    {
      id: "J",
      label: "Criterion J — Medical Condition Rule-Out",
      description:
        "If another medical condition (e.g., Parkinson's disease, obesity, disfigurement from burns or injury) is present, the fear, anxiety, or avoidance is clearly unrelated or is excessive.",
      type: "exclusion",
      assessmentAreas: [
        { id: "medical_rule_out", label: "Medical condition consideration", prompts: ["Co-occurring condition present?", "Fear unrelated to or excessive vs. condition", "Clinical judgement"] },
      ],
    },
  ],
};

// ── Panic Disorder — 300.01 (F41.0) ───────────────────────────────────────────

export const PAN_DEFINITION: DSMDiagnosisDef = {
  id: "pan",
  name: "Panic Disorder",
  category: "Anxiety Disorders",
  abbreviation: "PAN",
  // No "With panic attacks" specifier here — panic attacks are intrinsic.
  specifiers: [],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Recurrent Unexpected Panic Attacks",
      description:
        "Recurrent unexpected panic attacks. A panic attack is an abrupt surge of intense fear or intense discomfort that reaches a peak within minutes, during which time four or more of the following symptoms occur:",
      type: "symptom_count",
      minRequired: 4,
      symptoms: [
        { id: "pan_a1",  symptomEntityId: "panic_attacks",          label: "Recurrent unexpected panic attacks (overall)", isMandatoryAnchor: true, prompts: ["Recurrent attacks", "At least some uncued / unexpected", "Frequency and pattern"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "pan_a2",  symptomEntityId: "panic_palpitations",     label: "Palpitations / pounding heart",                prompts: ["Heart pounding","Racing heart"] },
        { id: "pan_a3",  symptomEntityId: "panic_sweating",         label: "Sweating",                                      prompts: ["Sudden sweating","Cold sweats"] },
        { id: "pan_a4",  symptomEntityId: "panic_trembling",        label: "Trembling / shaking",                           prompts: ["Visible shaking","Tremor"] },
        { id: "pan_a5",  symptomEntityId: "panic_shortness_breath", label: "Shortness of breath / smothering",              prompts: ["Air hunger","Smothering"] },
        { id: "pan_a6",  symptomEntityId: "panic_choking",          label: "Choking sensation",                             prompts: ["Lump in throat","Throat tightness"] },
        { id: "pan_a7",  symptomEntityId: "panic_chest_discomfort", label: "Chest pain / discomfort",                       prompts: ["Chest tightness","Chest pressure"] },
        { id: "pan_a8",  symptomEntityId: "panic_nausea",           label: "Nausea / abdominal distress",                   prompts: ["Nausea","Abdominal cramping"] },
        { id: "pan_a9",  symptomEntityId: "panic_dizziness",        label: "Dizziness / light-headedness",                  prompts: ["Light-headed","Faint","Unsteady"] },
        { id: "pan_a10", symptomEntityId: "panic_chills_heat",      label: "Chills / heat sensations",                      prompts: ["Hot flushes","Cold chills"] },
        { id: "pan_a11", symptomEntityId: "derealization",          label: "Derealisation / depersonalisation",             prompts: ["Feelings of unreality","Detached from self"] },
        { id: "pan_a12", symptomEntityId: "fear_of_losing_control", label: "Fear of losing control / going crazy",          prompts: ["Fear of losing control","Fear of going crazy"] },
        { id: "pan_a13", symptomEntityId: "fear_of_dying",          label: "Fear of dying",                                 prompts: ["Belief that death is imminent","Fear of cardiac event"] },
        { id: "pan_a14", symptomEntityId: "panic_paresthesias",     label: "Paresthesias (numbness / tingling)",            prompts: ["Tingling","Numbness","Pins-and-needles"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Persistent Concern / Behavioural Change",
      description:
        "At least one of the attacks has been followed by 1 month (or more) of one or both of: (1) persistent concern or worry about additional panic attacks or their consequences (e.g., losing control, having a heart attack, 'going crazy'); (2) a significant maladaptive change in behaviour related to the attacks (e.g., avoidance designed to prevent panic attacks).",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "pan_b1", symptomEntityId: "anticipatory_anxiety",   label: "Persistent concern / worry about further attacks", prompts: ["Worry about next attack","Fear of consequences (heart attack / going crazy)"] },
        { id: "pan_b2", symptomEntityId: "avoidance_behaviours",   label: "Maladaptive behavioural change",                    prompts: ["Avoidance to prevent attacks","Activity restriction","Safety behaviours"] },
      ],
    },
    anxietyMedicalExclusion("C"),
    anxietyDifferentialExclusion(
      "D",
      "The disturbance is not better explained by another mental disorder (e.g., the panic attacks do not occur only in response to feared social situations, as in social anxiety disorder; in response to circumscribed phobic objects or situations, as in specific phobia; in response to obsessions, as in OCD; in response to reminders of traumatic events, as in PTSD; or in response to separation from attachment figures, as in separation anxiety disorder).",
    ),
  ],
};

// ── Agoraphobia — 300.22 (F40.00) ─────────────────────────────────────────────

export const AGOR_DEFINITION: DSMDiagnosisDef = {
  id: "agor",
  name: "Agoraphobia",
  category: "Anxiety Disorders",
  abbreviation: "AGOR",
  specifiers: [PANIC_ATTACK_SPECIFIER],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Fear in Two or More Situations",
      description:
        "Marked fear or anxiety about two (or more) of the following five situations:",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "agor_a1", symptomEntityId: "fear_of_public_transport",    label: "Using public transportation",   prompts: ["Buses, trains, planes, ferries","Cars over distance"] },
        { id: "agor_a2", symptomEntityId: "fear_of_open_spaces",         label: "Being in open spaces",           prompts: ["Parking lots","Marketplaces","Bridges"] },
        { id: "agor_a3", symptomEntityId: "fear_of_enclosed_spaces",     label: "Being in enclosed places",       prompts: ["Shops","Theatres","Lifts / elevators"] },
        { id: "agor_a4", symptomEntityId: "fear_of_crowds",              label: "Standing in line or being in a crowd", prompts: ["Queues","Crowded venues"] },
        { id: "agor_a5", symptomEntityId: "fear_of_being_alone_outside", label: "Being outside the home alone",   prompts: ["Cannot leave home alone","Requires companion"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Escape / Help Concerns",
      description:
        "The individual fears or avoids these situations because of thoughts that escape might be difficult or help might not be available in the event of developing panic-like symptoms or other incapacitating or embarrassing symptoms (e.g., fear of falling in the elderly; fear of incontinence).",
      type: "impairment",
      assessmentAreas: [
        { id: "escape_concern", label: "Escape / help concerns", prompts: ["Thoughts that escape would be difficult","Concern help unavailable","Concern about incapacitating symptoms"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Almost Always Provokes Anxiety",
      description: "The agoraphobic situations almost always provoke fear or anxiety.",
      type: "impairment",
      assessmentAreas: [
        { id: "consistency", label: "Consistency of response", prompts: ["Fear reliably elicited","Rare exceptions"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Avoided / Companion / Endured Intensely",
      description:
        "The agoraphobic situations are actively avoided, require the presence of a companion, or are endured with intense fear or anxiety.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "agor_d1", symptomEntityId: "avoidance_behaviours", label: "Avoidance / companion required / endured with distress", prompts: ["Active avoidance","Companion required","Endured with intense fear"] },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Out of Proportion",
      description:
        "The fear or anxiety is out of proportion to the actual danger posed by the agoraphobic situations and to the sociocultural context.",
      type: "impairment",
      assessmentAreas: [
        { id: "proportion", label: "Proportionality", prompts: ["Threat appraisal disproportionate","Sociocultural context considered"] },
      ],
    },
    {
      id: "F",
      label: "Criterion F — Duration ≥ 6 Months",
      description: "The fear, anxiety, or avoidance is persistent, typically lasting for 6 months or more.",
      type: "impairment",
      assessmentAreas: [
        { id: "duration", label: "Duration", prompts: ["Onset date","≥ 6 months continuous"] },
      ],
    },
    anxietyImpairmentCriterion("G"),
    {
      id: "H",
      label: "Criterion H — Medical Condition Rule-Out",
      description:
        "If another medical condition (e.g., inflammatory bowel disease, Parkinson's disease) is present, the fear, anxiety, or avoidance is clearly excessive.",
      type: "exclusion",
      assessmentAreas: [
        { id: "medical_rule_out", label: "Medical condition consideration", prompts: ["Co-occurring condition present?","Fear / avoidance clearly excessive"] },
      ],
    },
    anxietyDifferentialExclusion(
      "I",
      "The fear, anxiety, or avoidance is not better explained by the symptoms of another mental disorder — for example, the symptoms are not confined to specific phobia (situational type), do not involve only social situations (as in social anxiety disorder), and are not related exclusively to obsessions (OCD), perceived defects (BDD), trauma reminders (PTSD), or separation (separation anxiety disorder).",
    ),
  ],
};

// ── Generalized Anxiety Disorder — 300.02 (F41.1) ─────────────────────────────

export const GAD_DEFINITION: DSMDiagnosisDef = {
  id: "gad",
  name: "Generalized Anxiety Disorder",
  category: "Anxiety Disorders",
  abbreviation: "GAD",
  // Severity is rated manually for GAD (no DSM-5 symptom-count threshold).
  showManualSeverity: true,
  specifiers: [PANIC_ATTACK_SPECIFIER],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Excessive Anxiety and Worry",
      description:
        "Excessive anxiety and worry (apprehensive expectation), occurring more days than not for at least 6 months, about a number of events or activities (such as work or school performance).",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "gad_a1", symptomEntityId: "excessive_worry", label: "Excessive anxiety and worry (≥ 6 months)", isMandatoryAnchor: true, prompts: ["Worry more days than not","Multiple domains (work, finances, family, health)","≥ 6 months continuous"], captureHints: ["frequency","duration","progression"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Difficulty Controlling the Worry",
      description: "The individual finds it difficult to control the worry.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "gad_b1", symptomEntityId: "difficulty_controlling_worry", label: "Difficulty controlling the worry", prompts: ["Cannot stop or redirect worry","Distraction unsuccessful","Worry intrusive into tasks"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Associated Symptoms (≥ 3)",
      description:
        "The anxiety and worry are associated with three (or more) of the following six symptoms (with at least some symptoms having been present for more days than not for the past 6 months).",
      type: "symptom_count",
      minRequired: 3,
      symptoms: [
        { id: "gad_c1", symptomEntityId: "restlessness",             label: "Restlessness / keyed up / on edge", prompts: ["Feeling keyed up","Cannot settle"] },
        { id: "gad_c2", symptomEntityId: "fatigue_energy_loss",      label: "Being easily fatigued",              prompts: ["Tires quickly","Low stamina"] },
        { id: "gad_c3", symptomEntityId: "concentration_difficulty", label: "Difficulty concentrating / mind going blank", prompts: ["Concentration impaired","Mind going blank","Distractibility"] },
        { id: "gad_c4", symptomEntityId: "irritability",             label: "Irritability",                       prompts: ["Short fuse","Snapping at others","Easily annoyed"] },
        { id: "gad_c5", symptomEntityId: "muscle_tension",           label: "Muscle tension",                     prompts: ["Persistent tightness","Jaw clenching","Shoulder/neck tension"] },
        { id: "gad_c6", symptomEntityId: "sleep_disturbance",        label: "Sleep disturbance",                  prompts: ["Difficulty falling/staying asleep","Restless / unsatisfying sleep"] },
      ],
    },
    anxietyImpairmentCriterion("D"),
    anxietyMedicalExclusion("E"),
    anxietyDifferentialExclusion(
      "F",
      "The disturbance is not better explained by another mental disorder — for example, anxiety or worry is not about panic attacks (panic disorder), negative evaluation (social anxiety), contamination or other obsessions (OCD), separation (separation anxiety), reminders of traumatic events (PTSD), gaining weight (anorexia nervosa), physical complaints (somatic symptom disorder), perceived defects (BDD), having a serious illness (illness anxiety), or the content of delusional beliefs (schizophrenia or delusional disorder).",
    ),
  ],
};

// ── Specific Phobia — 300.29 (F40.xxx by subtype) ────────────────────────────

export const SPHO_DEFINITION: DSMDiagnosisDef = {
  id: "spho",
  name: "Specific Phobia",
  category: "Anxiety Disorders",
  abbreviation: "SPHO",
  specifiers: [
    // Subtypes — clinician selects the applicable category.
    "Animal",
    "Natural environment",
    "Blood-injection-injury",
    "Situational",
    "Other",
    PANIC_ATTACK_SPECIFIER,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Marked Fear of Specific Object / Situation",
      description:
        "Marked fear or anxiety about a specific object or situation (e.g., flying, heights, animals, receiving an injection, seeing blood). Note: In children, the fear or anxiety may be expressed by crying, tantrums, freezing, or clinging.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "spho_a1", symptomEntityId: "specific_phobia_fear", label: "Marked fear / anxiety about specific object or situation", isMandatoryAnchor: true, prompts: ["Identify object / situation","Animal / natural environment / BII / situational / other","Document phobic stimulus"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Immediate Anxiety Response",
      description: "The phobic object or situation almost always provokes immediate fear or anxiety.",
      type: "impairment",
      assessmentAreas: [
        { id: "immediacy", label: "Immediacy and reliability", prompts: ["Anxiety occurs immediately on exposure","Reliably provoked on each exposure"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Avoided / Endured with Intense Fear",
      description: "The phobic object or situation is actively avoided or endured with intense fear or anxiety.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "spho_c1", symptomEntityId: "avoidance_behaviours", label: "Avoidance / endured with distress", prompts: ["Active avoidance","Endured only with intense distress"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Out of Proportion",
      description: "The fear or anxiety is out of proportion to the actual danger posed by the specific object or situation and to the sociocultural context.",
      type: "impairment",
      assessmentAreas: [
        { id: "proportion", label: "Proportionality", prompts: ["Threat appraisal disproportionate","Sociocultural context considered"] },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Duration ≥ 6 Months",
      description: "The fear, anxiety, or avoidance is persistent, typically lasting for 6 months or more.",
      type: "impairment",
      assessmentAreas: [
        { id: "duration", label: "Duration", prompts: ["Onset date","≥ 6 months continuous"] },
      ],
    },
    anxietyImpairmentCriterion("F"),
    anxietyDifferentialExclusion(
      "G",
      "The disturbance is not better explained by the symptoms of another mental disorder, including fear, anxiety, and avoidance of situations associated with panic-like symptoms or other incapacitating symptoms (as in agoraphobia); objects or situations related to obsessions (OCD); reminders of traumatic events (PTSD); separation from home or attachment figures (separation anxiety disorder); or social situations (social anxiety disorder).",
    ),
  ],
};

// ── Obsessive-Compulsive and Related Disorders ───────────────────────────────
//
// Architecture: OCD Criterion A is modelled as a single symptom_count
// criterion holding *both* obsession entities and compulsion entities,
// minRequired = 1. DSM-5 specifies "obsessions, compulsions, or both" —
// the flat list with minRequired = 1 captures that disjunction without
// duplicating the criterion. Symptoms are grouped visually by the
// clinician via the Current Symptoms domain sections; on the DSM page
// they appear in defined order (obsessions first, then compulsions).
//
// BDD Criterion B holds the repetitive-behaviour set as a symptom_count
// criterion (mirror checking, grooming, comparison, reassurance,
// skin picking). One match suffices.
//
// Trichotillomania / Excoriation each anchor on a single behaviour entity
// at Criterion A. Their "repeated attempts to stop" requirement (B) is
// modelled as an assessmentArea rather than a separate entity — it is
// a clinical assessment about the entity, not a separate symptom.

// Shared OCD-spectrum impairment + medical-exclusion + differential helpers.
function ocdImpairmentCriterion(id: string, label?: string, description?: string): DSMCriterionDef {
  return {
    id,
    label: label ?? `Criterion ${id} — Time / Distress / Impairment`,
    description:
      description ??
      "The obsessions or compulsions are time-consuming (e.g., take more than 1 hour per day) or cause clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
    type: "impairment",
    assessmentAreas: [
      { id: "time_burden",  label: "Time burden",     prompts: ["Estimated hours per day occupied by obsessions / compulsions","Late for / missing work / school / appointments","Daily life dominated by rituals"] },
      { id: "occupational", label: "Occupational",    prompts: ["Performance decline","Avoidance of tasks that trigger obsessions","Time off work"] },
      { id: "social",       label: "Social",           prompts: ["Withdrawal from friends / family","Concealment of rituals","Relationships affected"] },
      { id: "distress",     label: "Distress",         prompts: ["Subjective distress about symptoms","Ego-dystonic experience","Shame / embarrassment"] },
    ],
  };
}

function ocdSubstanceMedicalExclusion(id: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Substance / Medical Exclusion`,
    description:
      "The disturbance is not attributable to the physiological effects of a substance (e.g., a drug of abuse, a medication) or another medical condition.",
    type: "exclusion",
    assessmentAreas: [
      { id: "substances",  label: "Substance contribution", prompts: ["Stimulant use","Cannabis","Withdrawal states"] },
      { id: "medications", label: "Medication effects",     prompts: ["Recent medication changes","Dopaminergic agents"] },
      { id: "medical",     label: "Medical conditions",     prompts: ["Neurological condition","PANDAS / PANS (paediatric)","Post-infectious presentations"] },
    ],
  };
}

function ocdDifferentialExclusion(id: string, description: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Differential Exclusion`,
    description,
    type: "differential",
    assessmentAreas: [
      { id: "anxiety",  label: "Anxiety disorders",     prompts: ["GAD worry vs OCD obsessions","Specific phobia","Social anxiety"] },
      { id: "trauma",   label: "Trauma-related",         prompts: ["PTSD intrusions vs obsessions"] },
      { id: "mood",     label: "Mood disorders",         prompts: ["Depressive ruminations","Manic urges"] },
      { id: "eating",   label: "Eating disorders",       prompts: ["Body / weight preoccupation (eating disorder vs BDD)"] },
      { id: "psychotic",label: "Psychotic disorders",    prompts: ["Delusions vs absent-insight obsessions","Hallucinations"] },
      { id: "other",    label: "Other / general",        prompts: ["Tic disorder / Tourette's","Autism spectrum features","Other body-focused repetitive behaviour"] },
    ],
  };
}

// ── Obsessive-Compulsive Disorder — 300.3 (F42) ──────────────────────────────

export const OCD_DEFINITION: DSMDiagnosisDef = {
  id: "ocd",
  name: "Obsessive-Compulsive Disorder",
  category: "Obsessive-Compulsive and Related Disorders",
  abbreviation: "OCD",
  specifiers: [
    ...OCD_INSIGHT_SPECIFIERS,
    "Tic-related",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Obsessions, Compulsions, or Both",
      description:
        "Presence of obsessions, compulsions, or both. Obsessions are recurrent and persistent thoughts, urges, or images that are experienced as intrusive and unwanted, and that the individual attempts to ignore, suppress, or neutralize. Compulsions are repetitive behaviours or mental acts that the individual feels driven to perform, aimed at reducing distress or preventing a feared outcome, that are excessive or not connected in a realistic way to what they are designed to prevent.",
      type: "symptom_count",
      minRequired: 1,
      mandatoryRule:
        "At least one obsession OR one compulsion must be present. The flat list combines both; clinical sections separate them visually.",
      symptoms: [
        // Obsessions
        { id: "ocd_a1",  symptomEntityId: "intrusive_thoughts",   label: "Intrusive thoughts",                  isMandatoryAnchor: true, prompts: ["Recurrent unwanted thoughts","Ego-dystonic content","Distressing intrusions"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "ocd_a2",  symptomEntityId: "unwanted_thoughts",    label: "Unwanted thoughts",                   prompts: ["Thoughts the person tries to push away"] },
        { id: "ocd_a3",  symptomEntityId: "repetitive_thoughts",  label: "Repetitive thoughts",                  prompts: ["Same thought looping","Rumination"] },
        { id: "ocd_a4",  symptomEntityId: "intrusive_images",     label: "Intrusive images",                     prompts: ["Vivid mental images","Recurrent visual intrusions"] },
        { id: "ocd_a5",  symptomEntityId: "intrusive_urges",      label: "Intrusive urges",                      prompts: ["Unwanted urges to act","Distressing impulses"] },
        { id: "ocd_a6",  symptomEntityId: "contamination_fears",  label: "Contamination fears",                  prompts: ["Germs / dirt","Bodily fluids","Disease transmission"] },
        { id: "ocd_a7",  symptomEntityId: "harm_fears",           label: "Harm fears",                           prompts: ["Fear of harming others","Responsibility for harm"] },
        { id: "ocd_a8",  symptomEntityId: "checking_fears",       label: "Doubt / checking obsessions",          prompts: ["Doubts about safety","Persistent uncertainty"] },
        { id: "ocd_a9",  symptomEntityId: "symmetry_concerns",    label: "Symmetry / 'just right' concerns",     prompts: ["Need for symmetry","'Not just right' feelings"] },
        { id: "ocd_a10", symptomEntityId: "taboo_thoughts",       label: "Taboo intrusive thoughts",             prompts: ["Aggressive / sexual / religious intrusions","Significant shame"] },
        { id: "ocd_a11", symptomEntityId: "thought_suppression",  label: "Attempts to suppress thoughts",        prompts: ["Pushing thoughts away","Effort to neutralise"] },
        { id: "ocd_a12", symptomEntityId: "mental_neutralizing",  label: "Mental neutralizing",                  prompts: ["Mental rituals to undo thoughts","Internal compulsions"] },
        { id: "ocd_a13", symptomEntityId: "reassurance_seeking",  label: "Reassurance-seeking (cognitive)",      prompts: ["Seeking certainty","Distress when not given"] },
        // Compulsions
        { id: "ocd_a14", symptomEntityId: "checking_behaviours",  label: "Checking behaviours",                  prompts: ["Repeatedly checking locks / stoves","Re-checking actions"], captureHints: ["frequency","duration","progression"] },
        { id: "ocd_a15", symptomEntityId: "cleaning_washing",     label: "Cleaning / washing rituals",           prompts: ["Repeated handwashing","Cleaning objects"] },
        { id: "ocd_a16", symptomEntityId: "ordering_rituals",     label: "Ordering / arranging rituals",         prompts: ["Arranging objects until 'right'","Symmetry-driven arrangement"] },
        { id: "ocd_a17", symptomEntityId: "counting_rituals",     label: "Counting rituals (overt)",             prompts: ["Counting aloud","Counting steps / items"] },
        { id: "ocd_a18", symptomEntityId: "repeating_behaviours", label: "Repeating behaviours",                 prompts: ["Repeating set number of times","Re-doing tasks"] },
        { id: "ocd_a19", symptomEntityId: "compulsive_reassurance", label: "Compulsive reassurance-seeking",     prompts: ["Behavioural reassurance-seeking","Phoning / texting to check"] },
        { id: "ocd_a20", symptomEntityId: "compulsive_praying",   label: "Compulsive praying",                   prompts: ["Ritualised prayer","Distress if interrupted"] },
        { id: "ocd_a21", symptomEntityId: "mental_counting",      label: "Mental counting",                       prompts: ["Counting silently","Internal numerical rituals"] },
        { id: "ocd_a22", symptomEntityId: "rigid_routines",       label: "Rigid routines",                        prompts: ["Strict daily routines","Distress if routine broken"] },
        { id: "ocd_a23", symptomEntityId: "ritualistic_behaviour",label: "Other ritualistic behaviour",          prompts: ["Idiosyncratic rituals","Touching / tapping rituals"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Time-Consuming or Distress / Impairment",
      description:
        "The obsessions or compulsions are time-consuming (e.g., take more than 1 hour per day) or cause clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "ocd_b1", symptomEntityId: "time_consuming_rituals", label: "Time-consuming rituals (>1 hr/day)", prompts: ["Estimated hours per day","Daily routine dominated by rituals","Activities missed because of rituals"], captureHints: ["duration","frequency"] },
      ],
    },
    ocdSubstanceMedicalExclusion("C"),
    ocdDifferentialExclusion(
      "D",
      "The disturbance is not better explained by the symptoms of another mental disorder (e.g., excessive worries, as in generalized anxiety disorder; preoccupation with appearance, as in body dysmorphic disorder; difficulty discarding or parting with possessions, as in hoarding disorder; hair pulling, as in trichotillomania; skin picking, as in excoriation disorder; stereotypies, as in stereotypic movement disorder; ritualized eating behaviour, as in eating disorders; preoccupation with substances or gambling, as in substance-related and addictive disorders; preoccupation with having an illness, as in illness anxiety disorder; sexual urges or fantasies, as in paraphilic disorders; impulses, as in disruptive, impulse-control, and conduct disorders; guilty ruminations, as in major depressive disorder; thought insertion or delusional preoccupations, as in schizophrenia spectrum and other psychotic disorders; or repetitive patterns of behaviour, as in autism spectrum disorder).",
    ),
  ],
};

// ── Body Dysmorphic Disorder — 300.7 (F45.22) ────────────────────────────────

export const BDD_DEFINITION: DSMDiagnosisDef = {
  id: "bdd",
  name: "Body Dysmorphic Disorder",
  category: "Obsessive-Compulsive and Related Disorders",
  abbreviation: "BDD",
  specifiers: [
    ...OCD_INSIGHT_SPECIFIERS,
    "With muscle dysmorphia",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Preoccupation with Perceived Defect",
      description:
        "Preoccupation with one or more perceived defects or flaws in physical appearance that are not observable or appear slight to others.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "bdd_a1", symptomEntityId: "appearance_preoccupation",    label: "Preoccupation with appearance defect", isMandatoryAnchor: true, prompts: ["Specific perceived flaw","Flaw not observable or only slight to others","Hours per day spent thinking about it"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "bdd_a2", symptomEntityId: "muscle_dysmorphia_concerns", label: "Muscle dysmorphia concerns",            prompts: ["Body insufficiently muscular / lean","Excessive focus on muscularity"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Repetitive Behaviours / Mental Acts",
      description:
        "At some point during the course of the disorder, the individual has performed repetitive behaviours (e.g., mirror checking, excessive grooming, skin picking, reassurance seeking) or mental acts (e.g., comparing their appearance with that of others) in response to the appearance concerns.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "bdd_b1", symptomEntityId: "mirror_checking",     label: "Mirror checking / avoidance",     prompts: ["Repeated mirror checking","Active mirror avoidance"] },
        { id: "bdd_b2", symptomEntityId: "excessive_grooming",  label: "Excessive grooming / camouflaging", prompts: ["Hair / makeup rituals","Camouflaging perceived defect"] },
        { id: "bdd_b3", symptomEntityId: "body_comparison",     label: "Body comparison (mental act)",     prompts: ["Comparing appearance to others","Distress after comparing"] },
        { id: "bdd_b4", symptomEntityId: "reassurance_seeking", label: "Reassurance-seeking about appearance", prompts: ["Asking others about defect","Seeking certainty"] },
        { id: "bdd_b5", symptomEntityId: "skin_picking",        label: "Skin picking (in response to appearance concerns)", prompts: ["Picking driven by appearance preoccupation","Targeted at perceived defect"] },
      ],
    },
    ocdImpairmentCriterion(
      "C",
      "Criterion C — Distress / Impairment",
      "The preoccupation causes clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
    ),
    {
      id: "D",
      label: "Criterion D — Not Better Explained by Eating Disorder",
      description:
        "The appearance preoccupation is not better explained by concerns with body fat or weight in an individual whose symptoms meet diagnostic criteria for an eating disorder.",
      type: "differential",
      assessmentAreas: [
        { id: "eating_dx_rule_out", label: "Eating disorder rule-out", prompts: ["Is the preoccupation about body fat / weight?","Eating disorder criteria considered?","Differential conclusion"] },
      ],
    },
  ],
};

// ── Trichotillomania (Hair-Pulling Disorder) — 312.39 (F63.2) ────────────────

export const TRICH_DEFINITION: DSMDiagnosisDef = {
  id: "trich",
  name: "Trichotillomania (Hair-Pulling Disorder)",
  category: "Obsessive-Compulsive and Related Disorders",
  abbreviation: "TRICH",
  specifiers: [],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Recurrent Hair Pulling with Hair Loss",
      description: "Recurrent pulling out of one's hair, resulting in hair loss.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "trich_a1", symptomEntityId: "hair_pulling", label: "Recurrent hair pulling with hair loss", isMandatoryAnchor: true, prompts: ["Sites involved (scalp / eyelashes / brows / body)","Visible hair loss / thinning","Frequency","Triggers / contexts"], captureHints: ["frequency","duration","onset","progression"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Repeated Attempts to Stop / Reduce",
      description: "Repeated attempts to decrease or stop the hair pulling.",
      type: "impairment",
      assessmentAreas: [
        { id: "stop_attempts", label: "Attempts to stop / reduce", prompts: ["Specific past attempts","Strategies tried (habit reversal, stimulus control)","Outcome of attempts"] },
      ],
    },
    ocdImpairmentCriterion(
      "C",
      "Criterion C — Distress / Impairment",
      "The hair pulling causes clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
    ),
    {
      id: "D",
      label: "Criterion D — Not Attributable to Medical Condition",
      description:
        "The hair pulling or hair loss is not attributable to another medical condition (e.g., a dermatological condition).",
      type: "exclusion",
      assessmentAreas: [
        { id: "medical_rule_out", label: "Medical / dermatological rule-out", prompts: ["Alopecia areata","Tinea capitis","Other dermatological diagnosis","Clinical examination findings"] },
      ],
    },
    ocdDifferentialExclusion(
      "E",
      "The hair pulling is not better explained by the symptoms of another mental disorder (e.g., attempts to improve a perceived defect in appearance, as in body dysmorphic disorder).",
    ),
  ],
};

// ── Excoriation (Skin-Picking) Disorder — 698.4 (L98.1) ──────────────────────

export const EXCO_DEFINITION: DSMDiagnosisDef = {
  id: "exco",
  name: "Excoriation (Skin-Picking) Disorder",
  category: "Obsessive-Compulsive and Related Disorders",
  abbreviation: "EXCO",
  specifiers: [],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Recurrent Skin Picking with Lesions",
      description: "Recurrent skin picking resulting in skin lesions.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "exco_a1", symptomEntityId: "skin_picking", label: "Recurrent skin picking with lesions", isMandatoryAnchor: true, prompts: ["Sites involved (face / arms / scalp / back)","Lesions / scarring","Frequency","Automatic vs focused picking"], captureHints: ["frequency","duration","onset","progression"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Repeated Attempts to Stop / Reduce",
      description: "Repeated attempts to decrease or stop the skin picking.",
      type: "impairment",
      assessmentAreas: [
        { id: "stop_attempts", label: "Attempts to stop / reduce", prompts: ["Specific past attempts","Strategies tried (habit reversal, barrier methods)","Outcome of attempts"] },
      ],
    },
    ocdImpairmentCriterion(
      "C",
      "Criterion C — Distress / Impairment",
      "The skin picking causes clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
    ),
    {
      id: "D",
      label: "Criterion D — Substance / Medical Exclusion",
      description:
        "The skin picking is not attributable to the physiological effects of a substance (e.g., cocaine) or another medical condition (e.g., scabies).",
      type: "exclusion",
      assessmentAreas: [
        { id: "substances",  label: "Substance contribution",     prompts: ["Stimulant use","Methamphetamine","Cocaine"] },
        { id: "medical",     label: "Medical / dermatological",   prompts: ["Scabies","Other pruritic dermatosis","Neuropathic itch"] },
      ],
    },
    ocdDifferentialExclusion(
      "E",
      "The skin picking is not better explained by the symptoms of another mental disorder (e.g., delusions or tactile hallucinations in a psychotic disorder, attempts to improve a perceived defect or flaw in appearance in body dysmorphic disorder, stereotypies in stereotypic movement disorder, or intention to harm oneself in non-suicidal self-injury).",
    ),
  ],
};

// ── Somatic Symptom and Related Disorders ────────────────────────────────────
//
// Architecture notes:
//
// * SSD Criterion A is a single anchor row (`ssd_a1`) representing "one or
//   more distressing somatic symptoms". Every concrete somatic SymptomEntity
//   (chronic_pain, gi_symptoms, fatigue_energy_loss, paralysis_symptoms,
//   etc.) maps to that one symptomDefId — many entities → one criterion
//   row. This mirrors how DSM-5 itself treats Criterion A (the symptom
//   itself doesn't matter; what matters is that distressing symptoms are
//   present). The Current Symptoms domain still exposes each entity
//   individually so the clinician can document them granularly; SSD's DSM
//   page surfaces "evidence present" if ANY of them is marked present.
//
// * SSD Criterion B has three sub-anchor rows (b1 / b2 / b3) mirroring the
//   three DSM "at least one of" options. Ancillary illness-behaviour
//   entities (excessive_symptom_monitoring, repeated_medical_checking,
//   excessive_healthcare_utilization, etc.) map to b3 as additional
//   evidence — same many-to-one pattern.
//
// * Conversion Disorder Criterion A holds 8 functional-symptom-type
//   subtypes as DSM-5 lists them; each is mapped from the corresponding
//   functional-neurological entity. Criterion B (clinical incompatibility
//   with neurological / medical conditions) is intentionally NOT a symptom
//   row — it is a clinician-assessed differential (assessmentAreas).
//
// * Factitious Self / Other are structurally identical at the criterion
//   level — both share the same four observed-presentation entities. The
//   clinician chooses which diagnosis applies based on whether the
//   falsification is in self vs another person. Entities are reused
//   (no parallel entity store) — the criterionAssessment context
//   disambiguates.
//
// * Clinical neutrality: Factitious symptom-row labels are framed as
//   clinician-observed concerns, not patient-report items. The entity
//   labels (in symptomDomains.ts) use the same tentative wording. Nothing
//   in this layer auto-implies fabrication or malingering — presence flags
//   the criterion for clinician review; the clinician must explicitly
//   confirm any diagnosis.

function ssdImpairmentPersistence(id: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Persistence (≥ 6 months)`,
    description:
      "Although any one somatic symptom may not be continuously present, the state of being symptomatic is persistent (typically more than 6 months).",
    type: "impairment",
    assessmentAreas: [
      { id: "duration",    label: "Duration of symptomatic state", prompts: ["Onset date","Continuous vs fluctuating presentation","≥ 6 months of being symptomatic"] },
      { id: "impact",      label: "Functional impact",              prompts: ["Disruption to daily life","Time off work","Restricted activities"] },
    ],
  };
}

function conversionDifferential(id: string, description: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Differential Exclusion`,
    description,
    type: "differential",
    assessmentAreas: [
      { id: "neurological", label: "Neurological / medical",    prompts: ["Recognised neurological diagnoses considered","Imaging / electrophysiology findings","Clinical incompatibility documented"] },
      { id: "other_mental", label: "Other mental disorders",     prompts: ["Factitious disorder","Malingering (not a DSM mental disorder)","Other somatic-spectrum diagnosis"] },
    ],
  };
}

// ── Somatic Symptom Disorder — 300.82 (F45.1) ────────────────────────────────

export const SSD_DEFINITION: DSMDiagnosisDef = {
  id: "ssd",
  name: "Somatic Symptom Disorder",
  category: "Somatic Symptom and Related Disorders",
  abbreviation: "SSD",
  showManualSeverity: true,
  specifiers: [
    "With predominant pain",
    "Persistent",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Distressing Somatic Symptom(s)",
      description:
        "One or more somatic symptoms that are distressing or result in significant disruption of daily life.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "ssd_a1", symptomEntityId: "chronic_pain", label: "One or more distressing somatic symptoms", isMandatoryAnchor: true, prompts: ["Identify primary symptom(s)","Distress / disruption to daily life","Multiple entities (pain, fatigue, GI, neuro, sensory) can feed evidence"], captureHints: ["frequency","duration","onset","progression"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Excessive Thoughts, Feelings or Behaviours",
      description:
        "Excessive thoughts, feelings, or behaviours related to the somatic symptoms or associated health concerns as manifested by at least one of the following:",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "ssd_b1", symptomEntityId: "fear_of_serious_illness",           label: "Disproportionate / persistent thoughts about the seriousness of symptoms", prompts: ["Catastrophic interpretation of bodily sensations","Conviction about specific feared illness"] },
        { id: "ssd_b2", symptomEntityId: "excessive_health_worry",            label: "Persistently high level of anxiety about health or symptoms",            prompts: ["Pervasive worry about being unwell","Worry disproportionate to findings"] },
        { id: "ssd_b3", symptomEntityId: "excessive_time_devoted_to_symptoms", label: "Excessive time / energy devoted to symptoms or health concerns",        prompts: ["Daily life organised around symptoms","Repeated medical checking","Excessive healthcare utilisation","Symptom monitoring rituals"], captureHints: ["duration","frequency"] },
      ],
    },
    ssdImpairmentPersistence("C"),
  ],
};

// ── Conversion Disorder (Functional Neurological Symptom Disorder) ───────────
// 300.11 (varies by subtype — F44.x)

export const CONV_DEFINITION: DSMDiagnosisDef = {
  id: "conv",
  name: "Conversion Disorder (Functional Neurological Symptom Disorder)",
  category: "Somatic Symptom and Related Disorders",
  abbreviation: "CONV",
  // Specifiers cover subtype (multi-select where mixed), course, and stressor.
  specifiers: [
    // Symptom type
    "With weakness or paralysis",
    "With abnormal movement",
    "With swallowing symptoms",
    "With speech symptoms",
    "With attacks or seizures",
    "With anaesthesia or sensory loss",
    "With special sensory symptoms (visual / olfactory / hearing)",
    "With mixed symptoms",
    // Course
    "Acute episode (< 6 months)",
    "Persistent (≥ 6 months)",
    // Stressor
    "With psychological stressor (specify)",
    "Without psychological stressor",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Altered Motor or Sensory Function",
      description:
        "One or more symptoms of altered voluntary motor or sensory function.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "conv_a1", symptomEntityId: "functional_weakness",       label: "Weakness or paralysis",                       prompts: ["Functional weakness pattern","Hoover's sign / clinical incompatibility","Distribution"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "conv_a2", symptomEntityId: "functional_sensory_loss",   label: "Anaesthesia / sensory loss",                  prompts: ["Non-anatomic distribution","Inconsistent on testing","Variable across examinations"] },
        { id: "conv_a3", symptomEntityId: "non_epileptic_seizures",    label: "Attacks or seizures (non-epileptic)",         prompts: ["Atypical seizure features","Eye closure / asynchronous movements","EEG findings if known"] },
        { id: "conv_a4", symptomEntityId: "abnormal_movements",        label: "Abnormal movements (tremor / dystonia / gait)", prompts: ["Distractibility / entrainment","Variable frequency","Gait inconsistency"] },
        { id: "conv_a5", symptomEntityId: "speech_difficulties",       label: "Speech symptoms (dysphonia / dysarthria / mutism)", prompts: ["Functional speech pattern","Variability across encounters"] },
        { id: "conv_a6", symptomEntityId: "swallowing_difficulties",   label: "Swallowing symptoms",                          prompts: ["Globus / dysphagia","Choking episodes"] },
        { id: "conv_a7", symptomEntityId: "visual_disturbances",       label: "Special sensory symptoms (visual / hearing / olfactory)", prompts: ["Visual blurring / loss episodes","Functional hearing loss","Other special sensory complaints"] },
        { id: "conv_a8", symptomEntityId: "dissociative_neuro_symptoms", label: "Mixed / dissociative neurological symptoms", prompts: ["Trance-like episodes","Functional amnesia","Combination presentation"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Clinical Incompatibility",
      description:
        "Clinical findings provide evidence of incompatibility between the symptom and recognised neurological or medical conditions.",
      type: "differential",
      assessmentAreas: [
        { id: "incompatibility", label: "Clinical incompatibility evidence", prompts: ["Positive signs (e.g., Hoover's, tremor entrainment, eye closure)","Variability on examination","Investigations inconsistent with structural disease","Clinical reasoning recorded"] },
      ],
    },
    conversionDifferential(
      "C",
      "The symptom or deficit is not better explained by another medical or mental disorder.",
    ),
    {
      id: "D",
      label: "Criterion D — Distress / Impairment / Warrants Evaluation",
      description:
        "The symptom or deficit causes clinically significant distress or impairment in social, occupational, or other important areas of functioning, or warrants medical evaluation.",
      type: "impairment",
      assessmentAreas: [
        { id: "distress",     label: "Distress",                  prompts: ["Subjective distress about symptoms"] },
        { id: "occupational", label: "Occupational impairment",   prompts: ["Time off work","Performance impact"] },
        { id: "social",       label: "Social impairment",         prompts: ["Activity restriction","Relationships affected"] },
        { id: "evaluation",   label: "Medical evaluation warranted", prompts: ["Investigations performed","Referrals required"] },
      ],
    },
  ],
};

// ── Factitious Disorder — shared helpers ─────────────────────────────────────
//
// Shared specifier set (single vs recurrent episodes) used by both
// Factitious Self and Factitious Other.

const FACT_SPECIFIERS = ["Single episode", "Recurrent episodes (two or more events of falsification of illness and/or induction of injury)"];

// ── Factitious Disorder Imposed on Self — 300.19 (F68.10) ────────────────────

export const FACT_S_DEFINITION: DSMDiagnosisDef = {
  id: "fact_s",
  name: "Factitious Disorder Imposed on Self",
  category: "Somatic Symptom and Related Disorders",
  abbreviation: "FactS",
  specifiers: FACT_SPECIFIERS,
  criteria: [
    {
      id: "A",
      label: "Criterion A — Falsification of Physical or Psychological Signs / Symptoms",
      description:
        "Falsification of physical or psychological signs or symptoms, or induction of injury or disease, associated with identified deception. Note: requires explicit clinician evidence; documentation must record the basis for this assessment.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "fact_s_a1", symptomEntityId: "observed_inconsistency",             label: "Inconsistencies observed across encounters",                       prompts: ["Symptom description varies between visits","Discrepant findings between examiners","Account inconsistent with collateral history"] },
        { id: "fact_s_a2", symptomEntityId: "observed_extra_findings",            label: "Findings unexplained by known medical history or investigations",   prompts: ["Findings not accounted for by investigations","Presentation exceeds documented pathology"] },
        { id: "fact_s_a3", symptomEntityId: "observed_self_induction_concerns",   label: "Clinical concerns regarding possible self-induced presentation",    prompts: ["Atypical / unexplained findings","Pattern suggests self-induction","Evidence requires further evaluation"] },
        { id: "fact_s_a4", symptomEntityId: "observed_fabrication_concerns",      label: "Clinical concerns regarding possible fabricated symptoms",           prompts: ["Reported symptoms not corroborated","Investigations do not support reports","Clinician judgement required"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Presents Self as Ill / Impaired / Injured",
      description:
        "The individual presents themselves to others as ill, impaired, or injured.",
      type: "impairment",
      assessmentAreas: [
        { id: "presentation", label: "Self-presentation pattern", prompts: ["Repeatedly seeks healthcare contact","Maintains role of patient","Persists in presentation across encounters"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Absence of Obvious External Reward",
      description:
        "The deceptive behaviour is evident even in the absence of obvious external rewards (e.g., monetary, legal, avoidance of duties).",
      type: "differential",
      assessmentAreas: [
        { id: "reward_assessment", label: "External-reward assessment", prompts: ["Compensation / legal context considered","Avoidance of duties considered","Motivation analysis documented"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Not Better Explained Elsewhere",
      description:
        "The behaviour is not better explained by another mental disorder, such as a delusional disorder or another psychotic disorder.",
      type: "differential",
      assessmentAreas: [
        { id: "psychotic_rule_out", label: "Psychotic disorder rule-out", prompts: ["Delusions considered","Other psychotic features considered","Clinical conclusion documented"] },
      ],
    },
  ],
};

// ── Factitious Disorder Imposed on Another (formerly Munchausen by Proxy) ────
// Diagnosis applies to the PERPETRATOR, not the victim — DSM-5-TR explicit.

export const FACT_O_DEFINITION: DSMDiagnosisDef = {
  id: "fact_o",
  name: "Factitious Disorder Imposed on Another",
  category: "Somatic Symptom and Related Disorders",
  abbreviation: "FactO",
  specifiers: FACT_SPECIFIERS,
  criteria: [
    {
      id: "A",
      label: "Criterion A — Falsification of Signs / Symptoms in Another",
      description:
        "Falsification of physical or psychological signs or symptoms, or induction of injury or disease, in another, associated with identified deception. Note: diagnosis applies to the perpetrator, NOT the victim. Documentation must record the basis for this assessment.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "fact_o_a1", symptomEntityId: "observed_inconsistency",             label: "Inconsistencies observed in caregiver's account",                  prompts: ["Caregiver's account varies across visits","Findings inconsistent between examiners","Collateral history conflicts with caregiver report"] },
        { id: "fact_o_a2", symptomEntityId: "observed_extra_findings",            label: "Victim's findings unexplained by known medical history",            prompts: ["Findings not accounted for by investigations","Presentation exceeds documented pathology"] },
        { id: "fact_o_a3", symptomEntityId: "observed_self_induction_concerns",   label: "Clinical concerns regarding caregiver-induced presentation",        prompts: ["Atypical / unexplained findings in dependent","Pattern suggests induction by caregiver","Evidence requires further safeguarding evaluation"] },
        { id: "fact_o_a4", symptomEntityId: "observed_fabrication_concerns",      label: "Clinical concerns regarding caregiver fabrication of symptoms",      prompts: ["Reported symptoms not observed by other staff","Investigations do not support caregiver reports","Clinician judgement required"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Presents Victim as Ill / Impaired / Injured",
      description:
        "The individual presents another (the victim) to others as ill, impaired, or injured.",
      type: "impairment",
      assessmentAreas: [
        { id: "presentation", label: "Presentation of victim", prompts: ["Caregiver repeatedly seeks medical care for victim","Maintains illness role on victim's behalf","Pattern across encounters / providers"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Absence of Obvious External Reward",
      description:
        "The deceptive behaviour is evident even in the absence of obvious external rewards.",
      type: "differential",
      assessmentAreas: [
        { id: "reward_assessment", label: "External-reward assessment", prompts: ["Compensation / legal context considered","Avoidance of duties considered","Other secondary gain considered","Motivation analysis documented"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Not Better Explained Elsewhere",
      description:
        "The behaviour is not better explained by another mental disorder, such as a delusional disorder or another psychotic disorder.",
      type: "differential",
      assessmentAreas: [
        { id: "psychotic_rule_out", label: "Psychotic disorder rule-out", prompts: ["Delusions about victim's health considered","Other psychotic features considered","Clinical conclusion documented"] },
      ],
    },
  ],
};

// ── Neurodevelopmental Disorders ─────────────────────────────────────────────
//
// Architecture notes:
//
// * Autism Spectrum Disorder (id `autism`, not `asd` — the latter is taken
//   by Acute Stress Disorder; collision would silently corrupt saved data).
//   Criteria A and B are both required (all three A items + at least two
//   B items per DSM-5-TR); the renderer surfaces them as discrete symptom
//   rows. Severity in ASD is reported separately for social communication
//   and restricted/repetitive behaviours — stored in the diagnostic
//   interpretation's `extra` field as { asdSeverity: { socComm, rrb } }.
//   The clinician selects severity manually (no symptom-count threshold).
//
// * ADHD (id `adhd`) Criterion A is split into two sub-criteria A1
//   (inattention, ≥ 6 of 9 for under-17s, ≥ 5 for ≥17) and A2
//   (hyperactivity/impulsivity, same thresholds). To represent this
//   bifurcation in our existing single-letter criterion model, we use
//   criterion ids "A1" and "A2" — `findCriterionAssessment` keys on the
//   id string so any value works. Presentations (Combined / Inattentive
//   / Hyperactive-impulsive) and partial-remission status are specifiers.

function ndImpairmentCriterion(id: string, label: string, description: string): DSMCriterionDef {
  return {
    id, label, description,
    type: "impairment",
    assessmentAreas: [
      { id: "social",         label: "Social",                          prompts: ["Peer / family relationships","Social functioning"] },
      { id: "academic_occ",   label: "Academic / occupational",         prompts: ["School / work performance","Productivity","Engagement"] },
      { id: "daily",          label: "Daily functioning",               prompts: ["Activities of daily living","Self-management"] },
      { id: "multi_setting",  label: "Multiple settings (ADHD: ≥ 2)",   prompts: ["Home","School / work","Social / other"] },
    ],
  };
}

// ── Autism Spectrum Disorder — 299.00 (F84.0) ────────────────────────────────

export const AUTISM_DEFINITION: DSMDiagnosisDef = {
  id: "autism",
  name: "Autism Spectrum Disorder",
  category: "Neurodevelopmental Disorders",
  abbreviation: "ASD-Autism",
  showManualSeverity: true,
  specifiers: [
    // Intellectual / language qualifiers
    "With accompanying intellectual impairment",
    "Without accompanying intellectual impairment",
    "With accompanying language impairment",
    "Without accompanying language impairment",
    // Medical / genetic / environmental associations
    "Associated with a known medical / genetic condition or environmental factor (specify)",
    // Associated mental / neurodev / behavioural disorder
    "Associated with another neurodevelopmental, mental, or behavioural disorder (specify)",
    // Catatonia
    "With catatonia",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Persistent Deficits in Social Communication and Interaction",
      description:
        "Persistent deficits in social communication and social interaction across multiple contexts, as manifested by all of the following (currently or by history).",
      type: "symptom_count",
      minRequired: 3,
      mandatoryRule:
        "All three sub-symptoms must be present (currently or by history) to satisfy Criterion A.",
      symptoms: [
        { id: "autism_a1", symptomEntityId: "social_emotional_reciprocity",     label: "Deficits in social-emotional reciprocity", isMandatoryAnchor: true, prompts: ["Reduced back-and-forth conversation","Reduced sharing of interests / emotions","Failure of typical initiation / response"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "autism_a2", symptomEntityId: "nonverbal_communication_deficits", label: "Deficits in nonverbal communicative behaviours",  isMandatoryAnchor: true, prompts: ["Reduced eye contact / atypical body language","Deficits in understanding / using gestures","Absence of facial expression"] },
        { id: "autism_a3", symptomEntityId: "relationship_deficits",            label: "Deficits in developing, maintaining, understanding relationships", isMandatoryAnchor: true, prompts: ["Difficulty adjusting behaviour to social context","Difficulty making friends","Absence of interest in peers"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Restricted, Repetitive Patterns of Behaviour, Interests, or Activities",
      description:
        "Restricted, repetitive patterns of behaviour, interests, or activities, as manifested by at least two of the following (currently or by history).",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "autism_b1", symptomEntityId: "repetitive_motor_speech",  label: "Stereotyped / repetitive motor movements, use of objects, or speech", prompts: ["Lining up objects","Echolalia","Stereotyped motor mannerisms","Idiosyncratic phrases"] },
        { id: "autism_b2", symptomEntityId: "insistence_on_sameness",   label: "Insistence on sameness, inflexible adherence to routines, ritualised behaviour", prompts: ["Distress at small changes","Difficulty with transitions","Rigid thinking patterns"] },
        { id: "autism_b3", symptomEntityId: "restricted_interests",     label: "Highly restricted, fixated interests of abnormal intensity or focus", prompts: ["Strong attachment to unusual objects","Excessively circumscribed interests"] },
        { id: "autism_b4", symptomEntityId: "sensory_atypicality",      label: "Hyper- or hyporeactivity to sensory input or unusual sensory interests", prompts: ["Apparent indifference to pain / temperature","Adverse responses to specific sounds / textures","Excessive smelling / touching","Visual fascination"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Early Developmental Onset",
      description:
        "Symptoms must be present in the early developmental period (but may not become fully manifest until social demands exceed limited capacities, or may be masked by learned strategies later in life).",
      type: "differential",
      assessmentAreas: [
        { id: "developmental_history", label: "Developmental history", prompts: ["Onset / first concerns","Childhood evidence","Collateral / developmental records","Adult presentation with retrospective evidence"] },
      ],
    },
    ndImpairmentCriterion(
      "D",
      "Criterion D — Clinically Significant Impairment",
      "Symptoms cause clinically significant impairment in social, occupational, or other important areas of current functioning.",
    ),
    {
      id: "E",
      label: "Criterion E — Not Better Explained by ID / GDD",
      description:
        "These disturbances are not better explained by intellectual disability (intellectual developmental disorder) or global developmental delay. Intellectual disability and autism spectrum disorder frequently co-occur; to make co-morbid diagnoses, social communication should be below that expected for general developmental level.",
      type: "differential",
      assessmentAreas: [
        { id: "id_gdd_consideration", label: "ID / GDD differential", prompts: ["Cognitive assessment available","Social communication relative to developmental level","Co-occurrence vs alternate explanation","Clinical conclusion documented"] },
      ],
    },
  ],
};

// ── Attention-Deficit / Hyperactivity Disorder ───────────────────────────────

export const ADHD_DEFINITION: DSMDiagnosisDef = {
  id: "adhd",
  name: "Attention-Deficit / Hyperactivity Disorder",
  category: "Neurodevelopmental Disorders",
  abbreviation: "ADHD",
  showManualSeverity: true,
  specifiers: [
    // Presentations (one applies)
    "Combined presentation (A1 and A2 met past 6 months)",
    "Predominantly inattentive presentation (A1 met, A2 not)",
    "Predominantly hyperactive / impulsive presentation (A2 met, A1 not)",
    // Course
    "In partial remission (fewer than full criteria met past 6 months, with impairment)",
  ],
  criteria: [
    {
      id: "A1",
      label: "Criterion A1 — Inattention",
      description:
        "Six (or more, five if 17+) of the following symptoms of inattention have persisted for at least 6 months to a degree inconsistent with developmental level and that negatively impacts directly on social and academic / occupational activities.",
      type: "symptom_count",
      minRequired: 6,
      symptoms: [
        { id: "adhd_a1_1", symptomEntityId: "careless_mistakes",                label: "Careless mistakes / inattention to detail",      prompts: ["Errors in schoolwork / work / tasks","Sloppy / careless work"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "adhd_a1_2", symptomEntityId: "attention_sustaining_difficulty",  label: "Difficulty sustaining attention",                prompts: ["Trouble keeping attention on tasks","Difficulty during lectures / lengthy reading"] },
        { id: "adhd_a1_3", symptomEntityId: "listening_difficulty",             label: "Does not seem to listen when spoken to directly", prompts: ["Mind elsewhere even without distraction"] },
        { id: "adhd_a1_4", symptomEntityId: "task_completion_difficulty",       label: "Does not follow through / fails to finish",      prompts: ["Starts tasks but loses focus","Schoolwork / chores not completed"] },
        { id: "adhd_a1_5", symptomEntityId: "organization_difficulty",          label: "Difficulty organising tasks and activities",     prompts: ["Disorganised work","Poor time management","Messy workspace"] },
        { id: "adhd_a1_6", symptomEntityId: "mental_effort_avoidance",          label: "Avoids tasks requiring sustained mental effort", prompts: ["Reluctance for homework / reports / paperwork"] },
        { id: "adhd_a1_7", symptomEntityId: "losing_things",                    label: "Loses things necessary for tasks / activities",  prompts: ["Keys, wallet, paperwork, glasses","Tools / materials"] },
        { id: "adhd_a1_8", symptomEntityId: "easily_distracted",                label: "Easily distracted by extraneous stimuli",        prompts: ["External distraction","Adult: unrelated thoughts"] },
        { id: "adhd_a1_9", symptomEntityId: "forgetfulness",                    label: "Forgetful in daily activities",                  prompts: ["Forgets chores / errands","Returning calls","Paying bills","Keeping appointments"] },
      ],
    },
    {
      id: "A2",
      label: "Criterion A2 — Hyperactivity and Impulsivity",
      description:
        "Six (or more, five if 17+) of the following symptoms of hyperactivity-impulsivity have persisted for at least 6 months to a degree inconsistent with developmental level and that negatively impacts directly on social and academic / occupational activities.",
      type: "symptom_count",
      minRequired: 6,
      symptoms: [
        { id: "adhd_a2_1", symptomEntityId: "fidgeting",                label: "Fidgets / squirms",                                   prompts: ["Fidgets with hands or feet","Squirms in seat","Adult subjective restlessness"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "adhd_a2_2", symptomEntityId: "leaving_seat",             label: "Leaves seat when remaining seated is expected",      prompts: ["Gets up in classroom / office / meetings"] },
        { id: "adhd_a2_3", symptomEntityId: "motor_restlessness",       label: "Runs about / climbs (or adult restlessness)",        prompts: ["Childhood: runs / climbs inappropriately","Adult: feelings of restlessness"] },
        { id: "adhd_a2_4", symptomEntityId: "quiet_play_difficulty",    label: "Unable to play / engage in leisure quietly",         prompts: ["Difficulty with quiet activities"] },
        { id: "adhd_a2_5", symptomEntityId: "driven_by_motor",          label: "'On the go' / acting as if driven by a motor",       prompts: ["Hard to keep up with","Uncomfortable being still for extended periods"] },
        { id: "adhd_a2_6", symptomEntityId: "excessive_talking",        label: "Talks excessively",                                  prompts: ["Excessive talking across contexts"] },
        { id: "adhd_a2_7", symptomEntityId: "blurting",                 label: "Blurts out answers before question completed",       prompts: ["Completes others' sentences","Cannot wait turn in conversation"] },
        { id: "adhd_a2_8", symptomEntityId: "waiting_turn_difficulty",  label: "Difficulty awaiting turn",                            prompts: ["Difficulty waiting in line / queues / activities"] },
        { id: "adhd_a2_9", symptomEntityId: "interrupting",             label: "Interrupts or intrudes on others",                    prompts: ["Interrupts conversations / games","Uses others' things without asking"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Several Symptoms Before Age 12",
      description:
        "Several inattentive or hyperactive-impulsive symptoms were present prior to age 12 years.",
      type: "differential",
      assessmentAreas: [
        { id: "age_of_onset", label: "Age of onset evidence", prompts: ["Documented childhood symptoms","School reports","Parental / collateral history","Retrospective adult assessment"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Several Symptoms in ≥ 2 Settings",
      description:
        "Several inattentive or hyperactive-impulsive symptoms are present in two or more settings (e.g., at home, school, or work; with friends or relatives; in other activities).",
      type: "differential",
      assessmentAreas: [
        { id: "multi_setting", label: "Multi-setting evidence", prompts: ["Home","School / work","Social / other","Collateral confirmation"] },
      ],
    },
    ndImpairmentCriterion(
      "D",
      "Criterion D — Clinically Significant Impairment",
      "Clear evidence that the symptoms interfere with, or reduce the quality of, social, academic, or occupational functioning.",
    ),
    {
      id: "E",
      label: "Criterion E — Not Better Explained Elsewhere",
      description:
        "The symptoms do not occur exclusively during the course of schizophrenia or another psychotic disorder, and are not better explained by another mental disorder (e.g., mood, anxiety, dissociative, personality, substance intoxication / withdrawal).",
      type: "differential",
      assessmentAreas: [
        { id: "psychotic_rule_out", label: "Psychotic disorder rule-out",   prompts: ["Symptoms occur outside of psychotic episodes"] },
        { id: "mood_anxiety",       label: "Mood / anxiety differential",   prompts: ["Inattention secondary to depression / anxiety considered"] },
        { id: "substance",          label: "Substance",                      prompts: ["Intoxication / withdrawal effects considered"] },
      ],
    },
  ],
};



// ── Schizophrenia Spectrum and Other Psychotic Disorders ─────────────────────
//
// Architecture notes:
//
// * The five Criterion A symptoms (delusions, hallucinations, disorganised
//   speech / thinking, abnormal psychomotor / catatonic behaviour, negative
//   symptoms) are shared across Schizophreniform, Schizophrenia, and
//   Schizoaffective. Each uses identical symptomEntityIds, so a single
//   edit propagates across all three diagnoses.
//
// * Severity is reported manually per symptom (the SymptomEntity.severity
//   field already supports a 4-rung scale: mild / moderate / moderate-severe
//   / severe). DSM-5 Section III dimensional 0–4 ratings collapse cleanly
//   onto that ladder.
//
// * Course specifiers (acute / partial remission / full remission /
//   continuous / multiple episodes) are shared via PSYCHOTIC_COURSE_SPECIFIERS
//   and attached to Schizophreniform / Schizophrenia / Schizoaffective.
//
// * Delusional Disorder Criterion A only covers delusions — the four other
//   psychotic-symptom types must be ABSENT (DSM-5 Criterion B for DD);
//   modelled as a separate differential criterion.

const PSYCHOTIC_COURSE_SPECIFIERS = [
  "First episode, currently in acute episode",
  "First episode, currently in partial remission",
  "First episode, currently in full remission",
  "Multiple episodes, currently in acute episode",
  "Multiple episodes, currently in partial remission",
  "Multiple episodes, currently in full remission",
  "Continuous",
  "Unspecified",
];

const PSYCHOTIC_SEVERITY_SPECIFIERS = [
  "Current severity: delusions (rate 0–4)",
  "Current severity: hallucinations (rate 0–4)",
  "Current severity: disorganised speech (rate 0–4)",
  "Current severity: abnormal psychomotor / catatonia (rate 0–4)",
  "Current severity: negative symptoms (rate 0–4)",
];

function psychoticCriterionA(prefix: string, minRequired: number): DSMCriterionDef {
  return {
    id: "A",
    label: "Criterion A — Characteristic Psychotic Symptoms",
    description:
      `Two (or more) of the following, each present for a significant portion of time during a 1-month period (or less if successfully treated). ${
        minRequired === 2
          ? "At least one must be (1) delusions, (2) hallucinations, or (3) disorganised speech."
          : ""
      }`,
    type: "symptom_count",
    minRequired,
    mandatoryRule:
      "At least one symptom must be delusions, hallucinations, or disorganised speech (DSM-5 mandatory anchor).",
    symptoms: [
      { id: `${prefix}_a1`, symptomEntityId: "delusions",              label: "Delusions",                                isMandatoryAnchor: true, prompts: ["Fixed false beliefs","Subtype (persecutory / grandiose / referential / somatic / erotomanic)","Bizarre vs non-bizarre","Insight"], captureHints: ["frequency","duration","onset","progression"] },
      { id: `${prefix}_a2`, symptomEntityId: "hallucinations",         label: "Hallucinations",                           isMandatoryAnchor: true, prompts: ["Modality (auditory / visual / tactile / olfactory / gustatory)","Command quality","Frequency / duration"], captureHints: ["frequency","duration","onset","progression"] },
      { id: `${prefix}_a3`, symptomEntityId: "disorganised_thinking",  label: "Disorganised speech / thinking",            isMandatoryAnchor: true, prompts: ["Loosening of associations","Tangentiality","Incoherence / word salad","Derailment"] },
      { id: `${prefix}_a4`, symptomEntityId: "abnormal_psychomotor",   label: "Grossly disorganised or catatonic behaviour", prompts: ["Unpredictable agitation","Childlike silliness","Catatonic features (stupor / waxy flexibility / mutism / posturing)","Difficulty performing ADLs"] },
      { id: `${prefix}_a5`, symptomEntityId: "negative_symptoms",      label: "Negative symptoms",                         prompts: ["Diminished emotional expression","Avolition","Alogia","Asociality","Anhedonia"] },
    ],
  };
}

function psychoticSubstanceMedicalExclusion(id: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Substance / Medical Exclusion`,
    description:
      "The disturbance is not attributable to the physiological effects of a substance (e.g., a drug of abuse, a medication) or another medical condition.",
    type: "exclusion",
    assessmentAreas: [
      { id: "substances",  label: "Substance contribution", prompts: ["Stimulant / cannabis / hallucinogen use","Withdrawal states","Substance-induced psychotic disorder considered"] },
      { id: "medications", label: "Medication effects",     prompts: ["Recent medication changes","Dopaminergic / steroidal agents"] },
      { id: "medical",     label: "Medical conditions",     prompts: ["Neurological condition","Endocrine / metabolic","Delirium / dementia considered","Investigations performed"] },
    ],
  };
}

// ── Delusional Disorder — 297.1 (F22) ────────────────────────────────────────

export const DEL_DEFINITION: DSMDiagnosisDef = {
  id: "del",
  name: "Delusional Disorder",
  category: "Schizophrenia Spectrum and Other Psychotic Disorders",
  abbreviation: "DelD",
  showManualSeverity: true,
  specifiers: [
    "Erotomanic type",
    "Grandiose type",
    "Jealous type",
    "Persecutory type",
    "Somatic type",
    "Mixed type",
    "Unspecified type",
    "With bizarre content",
    "First episode, currently in acute episode",
    "First episode, currently in partial remission",
    "First episode, currently in full remission",
    "Multiple episodes, currently in acute episode",
    "Multiple episodes, currently in partial remission",
    "Multiple episodes, currently in full remission",
    "Continuous",
    "Unspecified",
    "Current severity: delusions (rate 0–4)",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Delusion(s) ≥ 1 Month",
      description: "The presence of one (or more) delusions with a duration of 1 month or longer.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "del_a1", symptomEntityId: "delusions", label: "One or more delusions present ≥ 1 month", isMandatoryAnchor: true, prompts: ["Specify content (subtype)","Duration ≥ 1 month","Bizarre vs non-bizarre"], captureHints: ["frequency","duration","onset","progression"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Criterion A of Schizophrenia Never Met",
      description:
        "Criterion A for schizophrenia has never been met. Hallucinations, if present, are not prominent and are related to the delusional theme.",
      type: "differential",
      assessmentAreas: [
        { id: "sz_crit_a_history", label: "Schizophrenia Criterion A history", prompts: ["No history of meeting Criterion A","Hallucinations limited / theme-related","Disorganised speech absent","Negative symptoms absent"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Functioning Not Markedly Impaired Apart from Delusion",
      description:
        "Apart from the impact of the delusion(s) or its ramifications, functioning is not markedly impaired and behaviour is not obviously bizarre or odd.",
      type: "impairment",
      assessmentAreas: [
        { id: "functioning_preserved", label: "Preserved functioning", prompts: ["Work / social functioning outside delusional theme","Behaviour not obviously bizarre or odd"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Mood Episode Relationship",
      description:
        "If manic or major depressive episodes have occurred, these have been brief relative to the duration of the delusional periods.",
      type: "mood_exclusion",
      assessmentAreas: [
        { id: "mood_episode_history", label: "Mood episode history", prompts: ["Duration of mood episodes vs delusional periods","Mood episodes brief relative to delusions"] },
      ],
    },
    psychoticSubstanceMedicalExclusion("E"),
  ],
};

// ── Schizophreniform Disorder — 295.40 (F20.81) ──────────────────────────────

export const SZF_DEFINITION: DSMDiagnosisDef = {
  id: "szf",
  name: "Schizophreniform Disorder",
  category: "Schizophrenia Spectrum and Other Psychotic Disorders",
  abbreviation: "SzF",
  showManualSeverity: true,
  specifiers: [
    "With good prognostic features",
    "Without good prognostic features",
    "With catatonia",
    ...PSYCHOTIC_SEVERITY_SPECIFIERS,
  ],
  criteria: [
    psychoticCriterionA("szf", 2),
    {
      id: "B",
      label: "Criterion B — Duration 1–6 Months",
      description:
        "An episode of the disorder lasts at least 1 month but less than 6 months. When the diagnosis must be made without waiting for recovery, it should be qualified as 'provisional'.",
      type: "impairment",
      assessmentAreas: [
        { id: "duration", label: "Duration", prompts: ["Onset","Current duration","< 6 months","Provisional vs confirmed"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Schizoaffective / Mood-Psychotic Exclusion",
      description:
        "Schizoaffective disorder and depressive or bipolar disorder with psychotic features have been ruled out because either no concurrent mood episodes occurred, or such episodes were present for a minority of the total active and residual duration.",
      type: "mood_exclusion",
      assessmentAreas: [
        { id: "mood_episode_history", label: "Mood episode considerations", prompts: ["Concurrent mood episodes documented","Duration of mood episodes vs psychotic episodes","Schizoaffective considered and excluded"] },
      ],
    },
    psychoticSubstanceMedicalExclusion("D"),
  ],
};

// ── Schizophrenia — 295.90 (F20.9) ───────────────────────────────────────────

export const SZP_DEFINITION: DSMDiagnosisDef = {
  id: "szp",
  name: "Schizophrenia",
  category: "Schizophrenia Spectrum and Other Psychotic Disorders",
  abbreviation: "Sz",
  showManualSeverity: true,
  specifiers: [
    ...PSYCHOTIC_COURSE_SPECIFIERS,
    "With catatonia",
    ...PSYCHOTIC_SEVERITY_SPECIFIERS,
  ],
  criteria: [
    psychoticCriterionA("szp", 2),
    {
      id: "B",
      label: "Criterion B — Functional Decline",
      description:
        "For a significant portion of the time since onset, one or more major areas of functioning (work, interpersonal relations, self-care) is markedly below the level achieved prior to onset.",
      type: "impairment",
      assessmentAreas: [
        { id: "occupational",  label: "Occupational",  prompts: ["Marked decline from pre-onset level","Inability to maintain employment / study"] },
        { id: "interpersonal", label: "Interpersonal", prompts: ["Marked decline in relationships","Social withdrawal"] },
        { id: "selfcare",      label: "Self-care",     prompts: ["Hygiene","ADLs","Self-management"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Duration ≥ 6 Months",
      description:
        "Continuous signs of the disturbance persist for at least 6 months. This 6-month period must include at least 1 month of active-phase symptoms meeting Criterion A and may include prodromal or residual periods.",
      type: "impairment",
      assessmentAreas: [
        { id: "duration", label: "Duration", prompts: ["Onset date","≥ 6 months continuous signs","≥ 1 month of active-phase symptoms","Prodromal / residual phases described"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Schizoaffective / Mood-Psychotic Exclusion",
      description:
        "Schizoaffective disorder and depressive or bipolar disorder with psychotic features have been ruled out.",
      type: "mood_exclusion",
      assessmentAreas: [
        { id: "mood_episode_history", label: "Mood episode considerations", prompts: ["Concurrent mood episodes","Duration of mood episodes vs psychotic episodes"] },
      ],
    },
    psychoticSubstanceMedicalExclusion("E"),
    {
      id: "F",
      label: "Criterion F — ASD / Communication Disorder Qualifier",
      description:
        "If there is a history of autism spectrum disorder or a communication disorder of childhood onset, the additional diagnosis of schizophrenia is made only if prominent delusions or hallucinations are present for at least 1 month.",
      type: "differential",
      assessmentAreas: [
        { id: "asd_history", label: "ASD / communication disorder considerations", prompts: ["History of ASD","History of childhood communication disorder","Prominent delusions or hallucinations confirmed ≥ 1 month"] },
      ],
    },
  ],
};

// ── Schizoaffective Disorder ─────────────────────────────────────────────────

export const SZA_DEFINITION: DSMDiagnosisDef = {
  id: "sza",
  name: "Schizoaffective Disorder",
  category: "Schizophrenia Spectrum and Other Psychotic Disorders",
  abbreviation: "SzA",
  showManualSeverity: true,
  specifiers: [
    "Bipolar type",
    "Depressive type",
    "With catatonia",
    ...PSYCHOTIC_COURSE_SPECIFIERS,
    ...PSYCHOTIC_SEVERITY_SPECIFIERS,
  ],
  criteria: [
    psychoticCriterionA("sza", 2),
    {
      id: "B",
      label: "Criterion B — Psychosis ≥ 2 Weeks Without Major Mood Episode",
      description:
        "Delusions or hallucinations for 2 or more weeks in the absence of a major mood episode (depressive or manic) during the lifetime duration of the illness.",
      type: "differential",
      assessmentAreas: [
        { id: "psychosis_alone", label: "Psychosis-without-mood evidence", prompts: ["At least one 2-week period of psychosis without mood episode","Documented in timeline","Distinguishes from mood disorder with psychotic features"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Mood Episodes Present Majority of Illness",
      description:
        "Symptoms meeting criteria for a major mood episode are present for the majority of the total duration of the active and residual portions of the illness.",
      type: "differential",
      assessmentAreas: [
        { id: "mood_episode_duration", label: "Mood-episode proportion of illness", prompts: ["Cumulative time meeting mood-episode criteria","Active + residual psychotic phase duration","Mood comprises majority of total illness time"] },
      ],
    },
    psychoticSubstanceMedicalExclusion("D"),
  ],
};

// ── Bipolar and Related Disorders (expansion of Mood Disorders) ──────────────
//
// Architecture notes:
//
// * Bipolar I requires at least one lifetime manic episode. We model this
//   as the diagnostic criteria — A (mood + activity), B (associated
//   symptoms, ≥ 3 of 7, ≥ 4 if mood is only irritable), C (duration +
//   marked impairment / hospitalization / psychosis), D (substance / medical
//   exclusion), E (differential — schizoaffective / psychotic spectrum).
//   Major Depressive Episode and Hypomanic Episode definitions are
//   represented through specifiers ("Current or most recent episode:
//   manic / hypomanic / depressed / unspecified") rather than as parallel
//   criterion blocks — this matches the existing one-DSMDiagnosisDef-per-
//   diagnosis pattern. Episode-specific symptom evidence flows through the
//   shared SymptomEntity store regardless of which episode is current.
//
// * Bipolar II requires ≥ 1 lifetime hypomanic episode AND ≥ 1 lifetime
//   MDE; no lifetime manic episode. Criteria A (hypomanic mood + activity),
//   B (associated symptoms, same set as BD1 with hypomanic threshold),
//   C (MDE present in history), D (no manic episode ever), E (differential),
//   F (substance / medical exclusion), G (impairment / not severe enough
//   for hospitalization or psychosis — that would upgrade to BD1).
//
// * Cyclothymic Disorder: chronic ≥ 2-year (≥ 1-year in children/adolescents)
//   fluctuation between hypomanic-range and depressive-range symptoms,
//   neither meeting full episode criteria. Modelled as a single Criterion A
//   anchor (cyclothymic_fluctuation entity carries duration/frequency) plus
//   exclusion criteria.

// Shared Bipolar / Mood-Episode specifier set — reused across BD1, BD2,
// MDD (mostly already there), Cyclothymic (anxious distress only). Each
// diagnosis decides which subset applies.
const SHARED_MOOD_EPISODE_SPECIFIERS = [
  "With anxious distress",
  "With mixed features",
  "With rapid cycling",
  "With melancholic features",
  "With atypical features",
  "With mood-congruent psychotic features",
  "With mood-incongruent psychotic features",
  "With catatonia (293.89 / F06.1)",
  "With peripartum onset",
  "With seasonal pattern",
];

const EPISODE_STATUS_SPECIFIERS = [
  "Current or most recent episode: manic",
  "Current or most recent episode: hypomanic",
  "Current or most recent episode: depressed",
  "Current or most recent episode: unspecified",
  "In partial remission",
  "In full remission",
];

const MOOD_SEVERITY_SPECIFIERS = [
  "Mild",
  "Moderate",
  "Severe",
];

function moodMedicalExclusion(id: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Substance / Medical Exclusion`,
    description:
      "The episode is not attributable to the physiological effects of a substance (e.g., a drug of abuse, a medication, other treatment) or another medical condition. Note: a full manic episode that emerges during antidepressant treatment but persists at a fully syndromal level beyond the physiological effect of that treatment is sufficient evidence for a manic episode and therefore a Bipolar I diagnosis.",
    type: "exclusion",
    assessmentAreas: [
      { id: "substances",  label: "Substance contribution",  prompts: ["Stimulants","Cannabis / hallucinogens","Withdrawal states"] },
      { id: "medications", label: "Medication effects",      prompts: ["Antidepressant-induced switching","Corticosteroids","Levodopa / dopaminergic"] },
      { id: "medical",     label: "Medical conditions",      prompts: ["Hyperthyroidism","Neurological condition","Endocrine / metabolic"] },
    ],
  };
}

function moodDifferential(id: string, description: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Differential Exclusion`,
    description,
    type: "differential",
    assessmentAreas: [
      { id: "psychotic_spectrum", label: "Schizophrenia spectrum",  prompts: ["Schizoaffective considered","Schizophrenia","Schizophreniform","Delusional disorder"] },
      { id: "other_mood",          label: "Other mood / related",     prompts: ["MDD with psychotic features","Cyclothymic","Substance/medication-induced mood"] },
      { id: "personality",         label: "Personality",              prompts: ["Borderline personality with affective instability considered"] },
    ],
  };
}

// ── Bipolar I Disorder — 296.4x / F31.x ──────────────────────────────────────

export const BD1_DEFINITION: DSMDiagnosisDef = {
  id: "bd1",
  name: "Bipolar I Disorder",
  category: "Mood Disorders",
  abbreviation: "BD-I",
  showManualSeverity: true,
  specifiers: [
    ...EPISODE_STATUS_SPECIFIERS,
    ...MOOD_SEVERITY_SPECIFIERS,
    ...SHARED_MOOD_EPISODE_SPECIFIERS,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Manic Episode Mood / Activity",
      description:
        "A distinct period of abnormally and persistently elevated, expansive, or irritable mood and abnormally and persistently increased goal-directed activity or energy, lasting at least 1 week and present most of the day, nearly every day (or any duration if hospitalization is necessary).",
      type: "symptom_count",
      minRequired: 1,
      mandatoryRule:
        "Elevated/expansive OR persistently irritable mood AND increased goal-directed activity/energy must be present.",
      symptoms: [
        { id: "bd1_a1", symptomEntityId: "elevated_mood",                    label: "Elevated, expansive, or irritable mood (≥ 1 week)", isMandatoryAnchor: true, prompts: ["Elevated / expansive mood","OR persistent irritability","Most of the day, nearly every day","≥ 1 week (any duration if hospitalised)"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "bd1_a2", symptomEntityId: "increased_goal_directed_activity", label: "Increased goal-directed activity or energy",       isMandatoryAnchor: true, prompts: ["Markedly increased productivity / projects","Subjective surge of energy","Observable by others"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Associated Symptoms (≥ 3, or ≥ 4 if mood only irritable)",
      description:
        "During the period of mood disturbance and increased energy or activity, three (or more) of the following symptoms (four if the mood is only irritable) are present to a significant degree and represent a noticeable change from usual behaviour.",
      type: "symptom_count",
      minRequired: 3,
      symptoms: [
        { id: "bd1_b1", symptomEntityId: "grandiosity",                       label: "Inflated self-esteem / grandiosity",            prompts: ["Inflated self-esteem","Grandiose beliefs","Non-delusional vs delusional"] },
        { id: "bd1_b2", symptomEntityId: "decreased_sleep_need",              label: "Decreased need for sleep",                       prompts: ["Sleeping markedly less without fatigue","Feeling rested after minimal sleep"] },
        { id: "bd1_b3", symptomEntityId: "pressured_speech",                  label: "More talkative / pressured speech",              prompts: ["More talkative than usual","Pressure to keep talking","Difficult to interrupt"] },
        { id: "bd1_b4", symptomEntityId: "racing_thoughts",                   label: "Flight of ideas / racing thoughts",              prompts: ["Subjective racing thoughts","Flight of ideas observed"] },
        { id: "bd1_b5", symptomEntityId: "easily_distracted",                 label: "Distractibility",                                prompts: ["Attention easily drawn to unimportant external stimuli","Increased distractibility relative to baseline"] },
        { id: "bd1_b6", symptomEntityId: "increased_goal_directed_activity",  label: "Increased goal-directed activity / psychomotor agitation", prompts: ["Increased productivity","Psychomotor agitation","Excess sexual / social / work activity"] },
        { id: "bd1_b7", symptomEntityId: "risk_behaviours",                   label: "Excessive involvement in risky pleasurable activities", prompts: ["Buying sprees","Sexual indiscretions","Foolish business investments","Reckless driving"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Marked Impairment / Hospitalization / Psychosis",
      description:
        "The mood disturbance is sufficiently severe to cause marked impairment in social or occupational functioning or to necessitate hospitalization to prevent harm to self or others, or there are psychotic features.",
      type: "impairment",
      assessmentAreas: [
        { id: "impairment",      label: "Marked impairment",                 prompts: ["Social","Occupational","Marked decline from baseline"] },
        { id: "hospitalization", label: "Hospitalization",                    prompts: ["Necessitates inpatient care","Harm to self / others prevented"] },
        { id: "psychotic",       label: "Psychotic features",                 prompts: ["Mood-congruent vs mood-incongruent","Delusions","Hallucinations"] },
      ],
    },
    moodMedicalExclusion("D"),
    moodDifferential(
      "E",
      "The manic episode is not better explained by schizoaffective disorder, schizophrenia, schizophreniform disorder, delusional disorder, or other specified or unspecified schizophrenia spectrum and other psychotic disorders.",
    ),
  ],
};

// ── Bipolar II Disorder — 296.89 / F31.81 ────────────────────────────────────

export const BD2_DEFINITION: DSMDiagnosisDef = {
  id: "bd2",
  name: "Bipolar II Disorder",
  category: "Mood Disorders",
  abbreviation: "BD-II",
  showManualSeverity: true,
  specifiers: [
    // Episode status (BD-II current episode is hypomanic or depressed)
    "Current or most recent episode: hypomanic",
    "Current or most recent episode: depressed",
    "In partial remission",
    "In full remission",
    ...MOOD_SEVERITY_SPECIFIERS,
    ...SHARED_MOOD_EPISODE_SPECIFIERS,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Hypomanic Episode (≥ 4 Days)",
      description:
        "A distinct period of abnormally and persistently elevated, expansive, or irritable mood and abnormally and persistently increased activity or energy, lasting at least 4 consecutive days and present most of the day, nearly every day. Three (or more) associated symptoms (four if mood only irritable) are present and represent a noticeable change.",
      type: "symptom_count",
      minRequired: 3,
      mandatoryRule:
        "Hypomanic mood + activity must be present; the symptom count below counts associated features (criterion A symptoms 2–8).",
      symptoms: [
        { id: "bd2_a1", symptomEntityId: "elevated_mood",                    label: "Hypomanic mood (elevated / expansive / irritable) ≥ 4 days", isMandatoryAnchor: true, prompts: ["Distinct period elevated / expansive / irritable","≥ 4 consecutive days","Observable change from baseline"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "bd2_a2", symptomEntityId: "grandiosity",                       label: "Inflated self-esteem / grandiosity",            prompts: ["Inflated self-esteem","Grandiose ideas (non-delusional)"] },
        { id: "bd2_a3", symptomEntityId: "decreased_sleep_need",              label: "Decreased need for sleep",                       prompts: ["Sleeping markedly less without fatigue"] },
        { id: "bd2_a4", symptomEntityId: "pressured_speech",                  label: "More talkative / pressured speech",              prompts: ["More talkative than usual","Pressure to keep talking"] },
        { id: "bd2_a5", symptomEntityId: "easily_distracted",                 label: "Distractibility",                                prompts: ["Attention easily drawn to unimportant external stimuli"] },
        { id: "bd2_a6", symptomEntityId: "racing_thoughts",                   label: "Flight of ideas / racing thoughts",              prompts: ["Subjective racing thoughts","Flight of ideas observed"] },
        { id: "bd2_a7", symptomEntityId: "increased_goal_directed_activity",  label: "Increased goal-directed activity",               prompts: ["Increased productivity / projects","Social / sexual increase"] },
        { id: "bd2_a8", symptomEntityId: "risk_behaviours",                   label: "Excessive involvement in risky pleasurable activities", prompts: ["Spending sprees","Sexual indiscretions","Foolish investments"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Major Depressive Episode (Lifetime)",
      description:
        "At least one lifetime major depressive episode meeting MDD Criterion A (≥ 5 symptoms during 2-week period including depressed mood or anhedonia). Track via the MDD page or MDE specifier here.",
      type: "differential",
      assessmentAreas: [
        { id: "mde_history", label: "MDE history evidence", prompts: ["Documented MDE in timeline","≥ 5 symptoms / ≥ 2 weeks","Depressed mood or anhedonia present"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Never a Manic Episode",
      description:
        "There has never been a manic episode. If a manic episode ever occurred, the diagnosis is Bipolar I.",
      type: "differential",
      assessmentAreas: [
        { id: "no_manic_history", label: "No manic episode in history", prompts: ["No lifetime manic episode meeting BD1 criteria","Substance-/medication-induced fully syndromal mania considered"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Hypomania / Depression Not Better Explained by Psychotic Spectrum",
      description:
        "The occurrence of the hypomanic episode(s) and major depressive episode(s) is not better explained by schizoaffective disorder, schizophrenia, schizophreniform disorder, delusional disorder, or other specified or unspecified schizophrenia spectrum and other psychotic disorders.",
      type: "differential",
      assessmentAreas: [
        { id: "psychotic_rule_out", label: "Psychotic spectrum rule-out", prompts: ["Schizoaffective considered","Other psychotic disorder considered"] },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Distress / Impairment",
      description:
        "The symptoms of depression or the unpredictability caused by frequent alternation between periods of depression and hypomania causes clinically significant distress or impairment in social, occupational, or other important areas of functioning. (Note: the hypomanic episode itself, by definition, is NOT severe enough to require hospitalization or have psychotic features — those would upgrade to BD1.)",
      type: "impairment",
      assessmentAreas: [
        { id: "impairment", label: "Impairment from depression / unpredictability", prompts: ["Social impact","Occupational impact","Daily functioning impact"] },
      ],
    },
    moodMedicalExclusion("F"),
  ],
};

// ── Cyclothymic Disorder — 301.13 / F34.0 ────────────────────────────────────

export const CYC_DEFINITION: DSMDiagnosisDef = {
  id: "cyc",
  name: "Cyclothymic Disorder",
  category: "Mood Disorders",
  abbreviation: "Cyc",
  showManualSeverity: true,
  specifiers: [
    "With anxious distress",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Chronic Subthreshold Mood Fluctuation (≥ 2 Years)",
      description:
        "For at least 2 years (at least 1 year in children and adolescents) there have been numerous periods with hypomanic symptoms that do not meet criteria for a hypomanic episode and numerous periods with depressive symptoms that do not meet criteria for a major depressive episode.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "cyc_a1", symptomEntityId: "cyclothymic_fluctuation", label: "Chronic hypomanic + depressive subthreshold fluctuation", isMandatoryAnchor: true, prompts: ["Numerous hypomanic-range periods (below threshold)","Numerous depressive-range periods (below threshold)","≥ 2 years (≥ 1 year child/adolescent)"], captureHints: ["frequency","duration","onset","progression"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Symptom Present ≥ Half the Time, No Symptom-Free Period > 2 Months",
      description:
        "During the above 2-year period (1 year in children and adolescents), the hypomanic and depressive symptoms have been present for at least half the time and the individual has not been without the symptoms for more than 2 months at a time.",
      type: "impairment",
      assessmentAreas: [
        { id: "presence_ratio", label: "Symptom presence ratio", prompts: ["Symptoms ≥ half the time","Symptom-free intervals < 2 months"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Full Episode Criteria Never Met",
      description:
        "Criteria for a major depressive, manic, or hypomanic episode have never been met.",
      type: "differential",
      assessmentAreas: [
        { id: "no_full_episodes", label: "Full episode history rule-out", prompts: ["No lifetime MDE meeting full criteria","No lifetime manic episode","No lifetime hypomanic episode meeting full criteria"] },
      ],
    },
    moodDifferential(
      "D",
      "The symptoms in Criterion A are not better explained by schizoaffective disorder, schizophrenia, schizophreniform disorder, delusional disorder, or other specified or unspecified schizophrenia spectrum and other psychotic disorders.",
    ),
    moodMedicalExclusion("E"),
    {
      id: "F",
      label: "Criterion F — Distress / Impairment",
      description:
        "The symptoms cause clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        { id: "impairment", label: "Impairment", prompts: ["Social","Occupational","Daily functioning"] },
      ],
    },
  ],
};

// ── Dissociative Disorders ───────────────────────────────────────────────────
//
// Self-contained category with four diagnoses. Dissociative Amnesia carries
// the fugue subtype as a specifier (and a dedicated entity for the wandering /
// travel phenomenon). DPDR shares depersonalization / derealization entities
// with Panic / ASD — single entity, multiple diagnostic contexts. OSDD lists
// four DSM-5 subtype examples as separate symptom rows on Criterion A so the
// clinician can mark whichever applies. UDD is the residual / fallback.

function dissociativeImpairmentCriterion(id: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Distress / Impairment`,
    description:
      "The symptoms cause clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
    type: "impairment",
    assessmentAreas: [
      { id: "occupational", label: "Occupational impairment", prompts: ["Performance decline","Avoidance of tasks"] },
      { id: "social",       label: "Social impairment",        prompts: ["Withdrawal","Relationships affected"] },
      { id: "daily",        label: "Daily functioning",        prompts: ["Self-management","ADLs"] },
      { id: "distress",     label: "Distress",                  prompts: ["Subjective distress about symptoms"] },
    ],
  };
}

function dissociativeMedicalExclusion(id: string, scope: "amnesia" | "dpdr"): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Substance / Medical Exclusion`,
    description:
      scope === "amnesia"
        ? "The disturbance is not attributable to the physiological effects of a substance (e.g., alcohol blackouts, drugs) or a neurological / other medical condition (e.g., partial complex seizures, transient global amnesia, sequelae of head injury, other neurological condition)."
        : "The disturbance is not attributable to the physiological effects of a substance (e.g., drug of abuse, medication) or another medical condition (e.g., seizures).",
    type: "exclusion",
    assessmentAreas: [
      { id: "substances",  label: "Substance contribution", prompts: ["Alcohol blackouts","Cannabis / hallucinogens","Sedative effects"] },
      { id: "medications", label: "Medication effects",     prompts: ["Recent medication changes","Anaesthetics"] },
      { id: "neurological", label: "Neurological / medical", prompts: ["Partial complex seizures","Transient global amnesia","Head injury sequelae","Migraine / other neurological"] },
    ],
  };
}

function dissociativeDifferentialExclusion(id: string, description: string): DSMCriterionDef {
  return {
    id,
    label: `Criterion ${id} — Differential Exclusion`,
    description,
    type: "differential",
    assessmentAreas: [
      { id: "trauma_related", label: "Trauma-related disorders", prompts: ["PTSD","ASD","Adjustment disorder"] },
      { id: "did",            label: "Dissociative identity disorder", prompts: ["Distinct identity states","Recurrent gaps in autobiographical memory"] },
      { id: "psychotic",      label: "Psychotic disorders",      prompts: ["Hallucinations","Delusions"] },
      { id: "neurocognitive", label: "Neurocognitive disorders", prompts: ["Major / mild NCD considered"] },
    ],
  };
}

// ── Dissociative Amnesia — 300.12 (F44.0) / with fugue: 300.13 (F44.1) ───────

export const DAMN_DEFINITION: DSMDiagnosisDef = {
  id: "damn",
  name: "Dissociative Amnesia",
  category: "Dissociative Disorders",
  abbreviation: "DAmn",
  showManualSeverity: true,
  specifiers: [
    "Without dissociative fugue (300.12 / F44.0)",
    "With dissociative fugue (300.13 / F44.1) — purposeful travel or bewildered wandering associated with amnesia for identity or for other important autobiographical information",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Inability to Recall Important Autobiographical Information",
      description:
        "An inability to recall important autobiographical information, usually of a traumatic or stressful nature, that is inconsistent with ordinary forgetting. Note: Dissociative amnesia most often consists of localized or selective amnesia for a specific event or events; or generalized amnesia for identity and life history.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "damn_a1", symptomEntityId: "dissociative_amnesia", label: "Inability to recall autobiographical information (localised / selective / generalised)", isMandatoryAnchor: true, prompts: ["Localised — specific event(s)","Selective — parts of an event","Generalised — identity / life history","Inconsistent with ordinary forgetting"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "damn_a2", symptomEntityId: "fugue_state",          label: "Dissociative fugue (specifier — purposeful travel + identity loss)", prompts: ["Purposeful travel or bewildered wandering","Confusion / loss of identity","Adoption of new identity (in some)","Use 300.13 / F44.1 if present"] },
      ],
    },
    dissociativeImpairmentCriterion("B"),
    dissociativeMedicalExclusion("C", "amnesia"),
    dissociativeDifferentialExclusion(
      "D",
      "The disturbance is not better explained by dissociative identity disorder, posttraumatic stress disorder, acute stress disorder, somatic symptom disorder, or major or mild neurocognitive disorder.",
    ),
  ],
};

// ── Depersonalization / Derealization Disorder — 300.6 (F48.1) ───────────────

export const DPDR_DEFINITION: DSMDiagnosisDef = {
  id: "dpdr",
  name: "Depersonalization / Derealization Disorder",
  category: "Dissociative Disorders",
  abbreviation: "DPDR",
  showManualSeverity: true,
  specifiers: [],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Persistent / Recurrent Depersonalization or Derealization",
      description:
        "The presence of persistent or recurrent experiences of depersonalization, derealization, or both.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "dpdr_a1", symptomEntityId: "depersonalization", label: "Depersonalisation — detachment from self", prompts: ["Detached observer of own thoughts / feelings / sensations / body / actions","Perceptual alterations","Distorted sense of time","Unreal / absent / lacking emotions"], captureHints: ["frequency","duration","onset","progression"] },
        { id: "dpdr_a2", symptomEntityId: "derealization",     label: "Derealisation — detachment from surroundings", prompts: ["Surroundings unreal / dreamlike / foggy / lifeless / visually distorted","Sense that others / objects are unreal or detached"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Intact Reality Testing",
      description:
        "During the depersonalization or derealization experiences, reality testing remains intact.",
      type: "differential",
      assessmentAreas: [
        { id: "reality_testing", label: "Reality testing", prompts: ["Patient recognises experience as subjective / not literally true","Distinguishes 'as if' from psychotic conviction"] },
      ],
    },
    dissociativeImpairmentCriterion("C"),
    dissociativeMedicalExclusion("D", "dpdr"),
    dissociativeDifferentialExclusion(
      "E",
      "The disturbance is not better explained by another mental disorder, such as schizophrenia, panic disorder, major depressive disorder, acute stress disorder, posttraumatic stress disorder, or another dissociative disorder.",
    ),
  ],
};

// ── Other Specified Dissociative Disorder — 300.15 (F44.89) ──────────────────

export const OSDD_DEFINITION: DSMDiagnosisDef = {
  id: "osdd",
  name: "Other Specified Dissociative Disorder",
  category: "Dissociative Disorders",
  abbreviation: "OSDD",
  criteria: [
    {
      id: "A",
      label: "Criterion A — Dissociative Presentation (Specify Subtype)",
      description:
        "Symptoms characteristic of a dissociative disorder that cause clinically significant distress or impairment but do not meet full criteria for any specific dissociative disorder. The clinician selects the subtype that most closely matches the presentation.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "osdd_a1", symptomEntityId: "chronic_mixed_dissociation",     label: "Chronic / recurrent mixed dissociative symptoms (no full DID features)", prompts: ["Recurrent mixed amnesia + DPR + identity alteration","Discrete identity states absent or not clearly demarcated"] },
        { id: "osdd_a2", symptomEntityId: "coercive_identity_disturbance",  label: "Identity disturbance due to prolonged / intense coercive persuasion",     prompts: ["Brainwashing / cult / political indoctrination","Captivity / torture context","Identity alteration tied to coercion"] },
        { id: "osdd_a3", symptomEntityId: "acute_dissociative_reaction",     label: "Acute dissociative reactions to stressful events (< 1 month)",            prompts: ["Constriction of consciousness","Depersonalisation / derealisation / motor symptoms","Tied to identifiable stressor","< 1 month duration"] },
        { id: "osdd_a4", symptomEntityId: "dissociative_trance",             label: "Dissociative trance (cultural context considered)",                        prompts: ["Acute narrowing of awareness","Marked unresponsiveness to environment","Not part of accepted cultural / religious practice"] },
      ],
    },
    dissociativeImpairmentCriterion("B"),
  ],
};

// ── Unspecified Dissociative Disorder — 300.15 (F44.9) ───────────────────────

export const UDD_DEFINITION: DSMDiagnosisDef = {
  id: "udd",
  name: "Unspecified Dissociative Disorder",
  category: "Dissociative Disorders",
  abbreviation: "UDD",
  criteria: [
    {
      id: "A",
      label: "Criterion A — Clinical Presentation",
      description:
        "Symptoms characteristic of a dissociative disorder that cause clinically significant distress or impairment but do not meet full criteria for any specific dissociative disorder. Used when the clinician chooses NOT to specify the reason criteria are not met, including presentations for which there is insufficient information (e.g., in emergency settings).",
      type: "impairment",
      assessmentAreas: [
        { id: "presentation", label: "Clinical presentation", prompts: ["Describe presenting symptoms","Clinically significant distress or impairment confirmed","Insufficient information / emergency context (specify)"] },
      ],
    },
  ],
};

// ── Illness Anxiety Disorder — 300.7 (F45.21) ────────────────────────────────
// Belongs to the existing "Somatic Symptom and Related Disorders" category.

export const IAD_DEFINITION: DSMDiagnosisDef = {
  id: "iad",
  name: "Illness Anxiety Disorder",
  category: "Somatic Symptom and Related Disorders",
  abbreviation: "IAD",
  showManualSeverity: true,
  specifiers: [
    "Care-seeking type",
    "Care-avoidant type",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Preoccupation with Having or Acquiring a Serious Illness",
      description:
        "Preoccupation with having or acquiring a serious illness.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "iad_a1", symptomEntityId: "fear_of_serious_illness", label: "Preoccupation with having / acquiring a serious illness", isMandatoryAnchor: true, prompts: ["Specific feared diagnosis","Catastrophic interpretation of bodily sensations"], captureHints: ["frequency","duration","onset","progression"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Somatic Symptoms Absent or Only Mild in Intensity",
      description:
        "Somatic symptoms are not present or, if present, are only mild in intensity. If another medical condition is present or there is a high risk for developing a medical condition (e.g., strong family history is present), the preoccupation is clearly excessive or disproportionate.",
      type: "differential",
      assessmentAreas: [
        { id: "somatic_intensity", label: "Somatic symptom intensity", prompts: ["No / minimal somatic symptoms","Symptoms only mild","Preoccupation disproportionate to objective findings"] },
        { id: "medical_context",   label: "Medical context",            prompts: ["Existing medical condition? Preoccupation excessive vs condition","Family history of feared illness considered"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — High Level of Anxiety About Health",
      description:
        "There is a high level of anxiety about health, and the individual is easily alarmed about personal health status.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "iad_c1", symptomEntityId: "excessive_health_worry", label: "High level of anxiety / easily alarmed about health", prompts: ["Easily alarmed by bodily sensations","Persistent health worry"], captureHints: ["frequency","duration","progression"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Excessive Health-Related Behaviours OR Maladaptive Avoidance",
      description:
        "The individual performs excessive health-related behaviours (e.g., repeatedly checks their body for signs of illness) or exhibits maladaptive avoidance (e.g., avoids doctor appointments and hospitals).",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "iad_d1", symptomEntityId: "excessive_symptom_monitoring", label: "Excessive body / symptom checking (care-seeking pattern)", prompts: ["Self-examination","Repeated medical checks","Continuous health monitoring"] },
        { id: "iad_d2", symptomEntityId: "repeated_medical_checking",   label: "Repeated medical reassurance-seeking",                      prompts: ["Multiple specialists","Repeated investigations","Doctor-shopping pattern"] },
        { id: "iad_d3", symptomEntityId: "avoidance_behaviours",        label: "Maladaptive avoidance of medical care (care-avoidant)",      prompts: ["Avoids doctor appointments","Avoids hospitals / clinics","Avoids news about feared illness"] },
      ],
    },
    {
      id: "E",
      label: "Criterion E — Duration ≥ 6 Months",
      description:
        "Illness preoccupation has been present for at least 6 months, but the specific illness that is feared may change over that period of time.",
      type: "impairment",
      assessmentAreas: [
        { id: "duration", label: "Duration", prompts: ["Onset","≥ 6 months continuous illness preoccupation","Specific feared illness may have changed"] },
      ],
    },
    {
      id: "F",
      label: "Criterion F — Differential Exclusion",
      description:
        "The illness-related preoccupation is not better explained by another mental disorder, such as somatic symptom disorder, panic disorder, generalized anxiety disorder, body dysmorphic disorder, obsessive-compulsive disorder, or delusional disorder, somatic type.",
      type: "differential",
      assessmentAreas: [
        { id: "ssd_rule_out",   label: "SSD differential",       prompts: ["Are somatic symptoms more than mild? → consider SSD instead"] },
        { id: "panic_rule_out", label: "Panic / GAD",            prompts: ["Panic attacks","Generalised worry"] },
        { id: "ocd_bdd",        label: "OCD / BDD",              prompts: ["Obsessions / appearance preoccupations considered"] },
        { id: "delusional",     label: "Delusional somatic type", prompts: ["Fixed false belief about illness? → consider Delusional disorder somatic type"] },
      ],
    },
  ],
};

// ── Other Specified Somatic Symptom and Related Disorder — 300.89 (F45.8) ────

export const OSSRD_DEFINITION: DSMDiagnosisDef = {
  id: "ossrd",
  name: "Other Specified Somatic Symptom and Related Disorder",
  category: "Somatic Symptom and Related Disorders",
  abbreviation: "OSSRD",
  criteria: [
    {
      id: "A",
      label: "Criterion A — Somatic-Spectrum Presentation (Specify Subtype)",
      description:
        "Symptoms characteristic of a somatic symptom and related disorder that cause clinically significant distress or impairment but do not meet full criteria for any specific disorder in this category. The clinician selects the subtype that most closely matches the presentation.",
      type: "symptom_count",
      minRequired: 1,
      symptoms: [
        { id: "ossrd_a1", symptomEntityId: "preoccupation_with_symptoms", label: "Brief somatic symptom disorder (< 6 months)",         prompts: ["SSD-like presentation but duration < 6 months"] },
        { id: "ossrd_a2", symptomEntityId: "fear_of_serious_illness",     label: "Brief illness anxiety disorder (< 6 months)",          prompts: ["IAD-like presentation but duration < 6 months"] },
        { id: "ossrd_a3", symptomEntityId: "excessive_health_worry",      label: "Illness anxiety disorder without excessive health-related behaviours", prompts: ["IAD criteria A–C/E/F met, Criterion D (behaviours) not met"] },
        { id: "ossrd_a4", symptomEntityId: "preoccupation_with_symptoms", label: "Pseudocyesis",                                          prompts: ["False belief of being pregnant","Objective signs / symptoms of pregnancy"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Distress / Impairment",
      description:
        "The symptoms cause clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        { id: "impairment", label: "Impairment", prompts: ["Social","Occupational","Daily functioning"] },
      ],
    },
  ],
};

// ── Unspecified Somatic Symptom and Related Disorder — 300.82 (F45.9) ────────

export const USSRD_DEFINITION: DSMDiagnosisDef = {
  id: "ussrd",
  name: "Unspecified Somatic Symptom and Related Disorder",
  category: "Somatic Symptom and Related Disorders",
  abbreviation: "USSRD",
  criteria: [
    {
      id: "A",
      label: "Criterion A — Clinical Presentation",
      description:
        "Symptoms characteristic of a somatic symptom and related disorder that cause clinically significant distress or impairment but do not meet full criteria for any specific disorder. Used when the clinician chooses NOT to specify the reason criteria are not met, including presentations for which there is insufficient information (e.g., in emergency settings).",
      type: "impairment",
      assessmentAreas: [
        { id: "presentation", label: "Clinical presentation", prompts: ["Describe presenting symptoms","Clinically significant distress or impairment confirmed","Insufficient information / emergency context (specify)"] },
      ],
    },
  ],
};

// ── Other Hallucinogen Use Disorder — 304.50 (F16.xx) ────────────────────────
// Belongs to the existing "Substance-Related and Addictive Disorders" category.
// Reuses SUD_REMISSION_SPECIFIERS and SUD_SEVERITY (mild 2-3 / moderate 4-5 /
// severe 6+). Per DSM-5-TR, hallucinogen use disorder has 10 criteria — same
// 11-item SUD template MINUS withdrawal (no characteristic withdrawal
// syndrome for hallucinogens).

export const HUD_DEFINITION: DSMDiagnosisDef = {
  id: "hud",
  name: "Other Hallucinogen Use Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "HUD",
  severityThresholds: SUD_SEVERITY,
  specifiers: [
    "Specify substance (e.g. LSD, psilocybin, mescaline, MDMA, ketamine)",
    ...SUD_REMISSION_SPECIFIERS,
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Problematic Hallucinogen Use (≥ 2 in 12 months)",
      description:
        "A problematic pattern of hallucinogen use leading to clinically significant impairment or distress, as manifested by at least 2 of the following, occurring within a 12-month period.",
      type: "symptom_count",
      minRequired: 2,
      symptoms: [
        { id: "hud_a1",  symptomEntityId: "hud_larger_longer",       label: "Larger amounts / longer than intended",         prompts: ["Sessions exceed intention","Doses larger than planned"] },
        { id: "hud_a2",  symptomEntityId: "hud_cut_down",            label: "Persistent desire / unsuccessful cut-down",     prompts: ["Failed quit attempts","Wanting to stop"] },
        { id: "hud_a3",  symptomEntityId: "hud_time_spent",          label: "Great deal of time spent",                       prompts: ["Time obtaining / using / recovering"] },
        { id: "hud_a4",  symptomEntityId: "hud_craving",             label: "Craving",                                        prompts: ["Strong urge to use","Triggers / contexts"] },
        { id: "hud_a5",  symptomEntityId: "hud_role_failure",        label: "Recurrent role-obligation failure",              prompts: ["Work / study / home duties affected"] },
        { id: "hud_a6",  symptomEntityId: "hud_social_problems",     label: "Continued use despite social problems",          prompts: ["Relationship conflicts","Family concern"] },
        { id: "hud_a7",  symptomEntityId: "hud_activities_given_up", label: "Important activities given up or reduced",       prompts: ["Hobbies / social activities stopped"] },
        { id: "hud_a8",  symptomEntityId: "hud_hazardous_use",       label: "Recurrent hazardous use",                         prompts: ["Driving while impaired","Using in unsafe contexts"] },
        { id: "hud_a9",  symptomEntityId: "hud_continued_harm",      label: "Continued use despite known harm",               prompts: ["Persistent / recurrent psychological harm acknowledged"] },
        { id: "hud_a10", symptomEntityId: "hud_tolerance",           label: "Tolerance",                                      prompts: ["Markedly diminished effect with same amount","Dose escalation"] },
        // NOTE: NO withdrawal criterion — DSM-5-TR explicitly excludes
        // withdrawal from hallucinogen use disorder. ICD coding for
        // intoxication / hallucinogen-induced disorders is kept separate.
      ],
    },
    sudImpairmentCriterion("B", "Criterion B — Impairment / Distress", "Clinically significant impairment or distress."),
  ],
};

// ── Gambling Disorder — 312.31 (F63.0) ───────────────────────────────────────
// Belongs to the existing "Substance-Related and Addictive Disorders" category
// (DSM-5-TR places gambling there as the only non-substance addictive disorder).

export const GAMB_DEFINITION: DSMDiagnosisDef = {
  id: "gamb",
  name: "Gambling Disorder",
  category: "Substance-Related and Addictive Disorders",
  abbreviation: "Gamb",
  // Gambling severity thresholds are DIFFERENT from substance use disorders:
  // mild 4–5 / moderate 6–7 / severe 8–9.
  severityThresholds: {
    criterionId: "A",
    mild: 4,
    moderate: 6,
    severe: 8,
  },
  specifiers: [
    // Course
    "Episodic",
    "Persistent",
    // Remission
    "In early remission (3–12 months, no criteria met)",
    "In sustained remission (≥ 12 months, no criteria met)",
  ],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Persistent / Recurrent Problematic Gambling Behaviour (≥ 4 in 12 months)",
      description:
        "Persistent and recurrent problematic gambling behaviour leading to clinically significant impairment or distress, as indicated by the individual exhibiting four (or more) of the following in a 12-month period.",
      type: "symptom_count",
      minRequired: 4,
      symptoms: [
        { id: "gamb_a1", symptomEntityId: "gamb_increasing_amounts",       label: "Needs to gamble with increasing amounts to achieve desired excitement", prompts: ["Stake escalation","Loss of low-stake satisfaction"] },
        { id: "gamb_a2", symptomEntityId: "gamb_restless_irritable",        label: "Restless or irritable when attempting to cut down or stop gambling",    prompts: ["Withdrawal-like restlessness","Irritability","Difficulty stopping"] },
        { id: "gamb_a3", symptomEntityId: "gamb_failed_cut_down",           label: "Repeated unsuccessful efforts to control / cut back / stop gambling",   prompts: ["Failed quit attempts","Recurrent rule-breaking"] },
        { id: "gamb_a4", symptomEntityId: "gamb_preoccupation",             label: "Preoccupation with gambling",                                            prompts: ["Reliving past gambling","Planning next venture","Thinking about ways to get money"] },
        { id: "gamb_a5", symptomEntityId: "gamb_gambling_when_distressed",  label: "Often gambles when feeling distressed",                                  prompts: ["Helpless / guilty / anxious / depressed","Gambling used as coping"] },
        { id: "gamb_a6", symptomEntityId: "gamb_chasing_losses",             label: "After losing money, returns another day to chase losses",               prompts: ["'Getting even' pattern","Re-entering after losses"] },
        { id: "gamb_a7", symptomEntityId: "gamb_lies_to_conceal",            label: "Lies to conceal the extent of gambling involvement",                    prompts: ["Lying to family / therapist","Concealment of losses"] },
        { id: "gamb_a8", symptomEntityId: "gamb_jeopardised_relationships",  label: "Jeopardised or lost significant relationship / job / opportunity",      prompts: ["Relationship loss","Job loss","Career / educational consequences"] },
        { id: "gamb_a9", symptomEntityId: "gamb_bailout",                    label: "Relies on others to provide money to relieve desperate financial situations", prompts: ["Repeated bail-outs","Financial distress driven by gambling"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Not Better Explained by a Manic Episode",
      description:
        "The gambling behaviour is not better explained by a manic episode.",
      type: "mood_exclusion",
      assessmentAreas: [
        { id: "manic_rule_out", label: "Manic episode rule-out", prompts: ["Is gambling restricted to a documented manic episode?","Gambling persists outside of mania","Clinical conclusion documented"] },
      ],
    },
  ],
};

// ── Personality Disorders ────────────────────────────────────────────────────
//
// New top-level category. DSM-5-TR distributes personality disorders across
// Clusters A / B / C; this registry currently houses only Borderline
// Personality Disorder (Cluster B). Additional personality disorders can be
// added later under the same category without restructuring.

export const BPD_DEFINITION: DSMDiagnosisDef = {
  id: "bpd",
  name: "Borderline Personality Disorder",
  category: "Personality Disorders",
  abbreviation: "BPD",
  showManualSeverity: true,
  specifiers: [],
  criteria: [
    {
      id: "A",
      label: "Criterion A — Pervasive Pattern of Instability (≥ 5 of 9)",
      description:
        "A pervasive pattern of instability of interpersonal relationships, self-image, and affects, and marked impulsivity, beginning by early adulthood and present in a variety of contexts, as indicated by five (or more) of the following:",
      type: "symptom_count",
      minRequired: 5,
      symptoms: [
        { id: "bpd_a1", symptomEntityId: "bpd_abandonment_fears",       label: "Frantic efforts to avoid real or imagined abandonment",                       prompts: ["Frantic response to separations","Does NOT include suicidal / self-mutilating behaviour (Criterion 5)"] },
        { id: "bpd_a2", symptomEntityId: "bpd_unstable_relationships",  label: "Pattern of unstable, intense relationships (idealisation / devaluation)",     prompts: ["Idealisation alternating with devaluation","Splitting","Marked relational instability"] },
        { id: "bpd_a3", symptomEntityId: "bpd_identity_disturbance",    label: "Identity disturbance — markedly / persistently unstable self-image",          prompts: ["Goals / values / aspirations / sexuality shift","Self-view changes with context"] },
        { id: "bpd_a4", symptomEntityId: "bpd_impulsivity",              label: "Impulsivity in ≥ 2 potentially self-damaging areas",                          prompts: ["Spending","Sex","Substance use","Reckless driving","Binge eating","Excludes Criterion 5 behaviours"] },
        { id: "bpd_a5", symptomEntityId: "bpd_self_harm_suicidality",    label: "Recurrent suicidal behaviour, gestures, threats, or self-mutilation",        prompts: ["Self-harm history / current","Suicide attempts","Threats / gestures","Methods and lethality"] },
        { id: "bpd_a6", symptomEntityId: "bpd_affective_instability",    label: "Affective instability due to marked reactivity of mood",                      prompts: ["Episodic dysphoria / irritability / anxiety","Lasting hours to a few days"] },
        { id: "bpd_a7", symptomEntityId: "bpd_emptiness",                label: "Chronic feelings of emptiness",                                               prompts: ["Persistent inner void","Subjective emptiness"] },
        { id: "bpd_a8", symptomEntityId: "bpd_intense_anger",            label: "Inappropriate, intense anger or difficulty controlling anger",                prompts: ["Frequent temper","Constant anger","Recurrent physical fights"] },
        { id: "bpd_a9", symptomEntityId: "bpd_transient_paranoia",       label: "Transient stress-related paranoid ideation or severe dissociative symptoms", prompts: ["Stress-related paranoia","Severe dissociative episodes under stress"] },
      ],
    },
    {
      id: "B",
      label: "Criterion B — Onset by Early Adulthood; Present Across Contexts",
      description:
        "The pattern is inflexible and pervasive across a broad range of personal and social situations, is stable and of long duration, and its onset can be traced back at least to adolescence or early adulthood.",
      type: "differential",
      assessmentAreas: [
        { id: "onset",       label: "Onset evidence",          prompts: ["Onset by adolescence / early adulthood","Long-standing pattern (not episodic)","Stable across years"] },
        { id: "contexts",    label: "Cross-context evidence",   prompts: ["Personal / family","Social / friendships","Occupational / academic"] },
      ],
    },
    {
      id: "C",
      label: "Criterion C — Not Better Explained by Another Mental Disorder",
      description:
        "The enduring pattern is not better explained as a manifestation or consequence of another mental disorder (e.g., a primary mood disorder with affective instability, PTSD, substance-induced presentation).",
      type: "differential",
      assessmentAreas: [
        { id: "mood_rule_out",      label: "Mood disorder differential",     prompts: ["Bipolar II / Cyclothymic considered","Persistent depressive disorder considered","Episodes vs trait pattern"] },
        { id: "trauma_rule_out",    label: "PTSD / complex trauma",           prompts: ["Trauma history considered","CPTSD presentation considered"] },
        { id: "substance_rule_out", label: "Substance / medication",          prompts: ["Substance-induced affective instability","Medication effects"] },
      ],
    },
    {
      id: "D",
      label: "Criterion D — Functional Impairment",
      description:
        "The pattern leads to clinically significant distress or impairment in social, occupational, or other important areas of functioning.",
      type: "impairment",
      assessmentAreas: [
        { id: "social",       label: "Social impairment",        prompts: ["Relationship instability","Friend network impact","Family conflict"] },
        { id: "occupational", label: "Occupational",             prompts: ["Job stability","Performance","Career disruption"] },
        { id: "daily",        label: "Daily functioning",        prompts: ["Self-management","ADLs","Emotional regulation in daily contexts"] },
      ],
    },
  ],
};

// ── Diagnosis registry ────────────────────────────────────────────────────────
// Declared after every *_DEFINITION so the array elements are all initialised
// (a const referenced before its declaration is a temporal-dead-zone error).

export const DSM5_DIAGNOSES: DSMDiagnosisDef[] = [
  MDD_DEFINITION,
  PDD_DEFINITION,
  PTSD_DEFINITION,
  ASD_DEFINITION,
  ADJ_DEFINITION,
  OTHER_TRAUMA_DEFINITION,
  UNSPEC_TRAUMA_DEFINITION,
  AUD_DEFINITION,
  CUD_DEFINITION,
  INUD_DEFINITION,
  OUD_DEFINITION,
  SHAUD_DEFINITION,
  STUD_DEFINITION,
  OSUD_DEFINITION,
  AN_DEFINITION,
  BN_DEFINITION,
  BED_DEFINITION,
  OSFED_DEFINITION,
  UNSPEC_FEED_DEFINITION,
  SAD_DEFINITION,
  PAN_DEFINITION,
  AGOR_DEFINITION,
  GAD_DEFINITION,
  SPHO_DEFINITION,
  OCD_DEFINITION,
  BDD_DEFINITION,
  TRICH_DEFINITION,
  EXCO_DEFINITION,
  SSD_DEFINITION,
  CONV_DEFINITION,
  FACT_S_DEFINITION,
  FACT_O_DEFINITION,
  AUTISM_DEFINITION,
  ADHD_DEFINITION,
  DEL_DEFINITION,
  SZF_DEFINITION,
  SZP_DEFINITION,
  SZA_DEFINITION,
  BD1_DEFINITION,
  BD2_DEFINITION,
  CYC_DEFINITION,
  DAMN_DEFINITION,
  DPDR_DEFINITION,
  OSDD_DEFINITION,
  UDD_DEFINITION,
  IAD_DEFINITION,
  OSSRD_DEFINITION,
  USSRD_DEFINITION,
  HUD_DEFINITION,
  GAMB_DEFINITION,
  BPD_DEFINITION,
];

export const DSM5_CATEGORIES: { name: string; diagnosisIds: string[] }[] = [
  { name: "Neurodevelopmental Disorders", diagnosisIds: ["autism", "adhd"] },
  { name: "Schizophrenia Spectrum and Other Psychotic Disorders", diagnosisIds: ["del", "szf", "szp", "sza"] },
  { name: "Mood Disorders", diagnosisIds: ["mdd", "pdd", "bd1", "bd2", "cyc"] },
  { name: "Anxiety Disorders", diagnosisIds: ["sad", "pan", "agor", "gad", "spho"] },
  { name: "Obsessive-Compulsive and Related Disorders", diagnosisIds: ["ocd", "bdd", "trich", "exco"] },
  { name: "Trauma-Related Disorders", diagnosisIds: ["ptsd", "asd", "adj", "other_trauma", "unspec_trauma"] },
  { name: "Dissociative Disorders", diagnosisIds: ["damn", "dpdr", "osdd", "udd"] },
  { name: "Somatic Symptom and Related Disorders", diagnosisIds: ["ssd", "conv", "fact_s", "fact_o", "iad", "ossrd", "ussrd"] },
  { name: "Substance-Related and Addictive Disorders", diagnosisIds: ["aud", "cud", "inud", "oud", "shaud", "stud", "hud", "osud", "gamb"] },
  { name: "Eating Disorders", diagnosisIds: ["an", "bn", "bed", "osfed", "unspec_feed"] },
  { name: "Personality Disorders", diagnosisIds: ["bpd"] },
];

export function getDiagnosisDef(id: string): DSMDiagnosisDef | undefined {
  return DSM5_DIAGNOSES.find((d) => d.id === id);
}
