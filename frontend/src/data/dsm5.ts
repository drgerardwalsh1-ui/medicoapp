// ── DSM-5-TR Diagnosis Definitions ────────────────────────────────────────────
// Structural definitions only — no assessment state here.
// Assessment state lives in DSMAssessmentData (types/dsm.ts).

import type { DSMDiagnosisDef } from "../types/dsm";

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

// ── Diagnosis registry ────────────────────────────────────────────────────────

export const DSM5_DIAGNOSES: DSMDiagnosisDef[] = [
  MDD_DEFINITION,
  PDD_DEFINITION,
  PTSD_DEFINITION,
  ASD_DEFINITION,
  ADJ_DEFINITION,
  OTHER_TRAUMA_DEFINITION,
  UNSPEC_TRAUMA_DEFINITION,
];

export const DSM5_CATEGORIES: { name: string; diagnosisIds: string[] }[] = [
  { name: "Mood Disorders", diagnosisIds: ["mdd", "pdd"] },
  { name: "Trauma-Related Disorders", diagnosisIds: ["ptsd", "asd", "adj", "other_trauma", "unspec_trauma"] },
];

export function getDiagnosisDef(id: string): DSMDiagnosisDef | undefined {
  return DSM5_DIAGNOSES.find((d) => d.id === id);
}
