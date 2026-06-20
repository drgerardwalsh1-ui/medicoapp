// ── Built-in interview templates ───────────────────────────────────────────────
// One per matter-type family, mirroring the clinician's Word template library
// (MasterTemplate.docx stripped by matter type). Built-ins are read-only;
// the clinician clones and adjusts them (engine/templateStore.ts), exactly as
// they maintain their Word templates today.
//
// Section order is interview order: symptom coverage opens with Mood and
// Anxiety, and adds PTSD for accident matters (the clinician's stated
// routine), then the remaining clinical territory, history, MSE, and PIRS
// when the matter type requires it.

import type { InterviewSection, InterviewTemplate } from "../types/interviewTemplate";

const CIRCUMSTANCES: InterviewSection = {
  id: "circumstances",
  kind: "narrative",
  title: "Circumstances of injury",
  prompt: "Mechanism · immediate reaction · initial symptoms · first treatment",
};
const TREATMENT: InterviewSection = {
  id: "treatment",
  kind: "narrative",
  title: "Treatment since injury",
  prompt: "GP / psychologist / psychiatrist · medications tried · response",
};
const MOOD: InterviewSection = {
  id: "sx-mood",
  kind: "symptomDomain",
  title: "Mood",
  domainId: "mood",
};
const ANXIETY: InterviewSection = {
  id: "sx-anxiety",
  kind: "symptomDomain",
  title: "Anxiety",
  domainId: "anxiety",
};
const PTSD: InterviewSection = {
  id: "sx-trauma",
  kind: "symptomDomain",
  title: "PTSD / trauma",
  domainId: "trauma",
};
const SLEEP: InterviewSection = {
  id: "sx-neuroveg",
  kind: "symptomDomain",
  title: "Sleep / neurovegetative",
  domainId: "neurovegetative",
};
const COGNITIVE: InterviewSection = {
  id: "sx-cognitive",
  kind: "symptomDomain",
  title: "Cognition",
  domainId: "cognitive",
};
const RISK: InterviewSection = {
  id: "sx-risk",
  kind: "symptomDomain",
  title: "Risk",
  domainId: "behavioural_risk",
};
const SUBSTANCE: InterviewSection = {
  id: "sx-substance",
  kind: "symptomDomain",
  title: "Substance use",
  domainId: "substance",
  // Default screen = alcohol (the domain repeats the same 11 criteria per
  // substance — rendering all of them is an unusable chip wall). Clone the
  // template and widen probeIds when a particular matter needs cannabis /
  // opioid / stimulant coverage.
  probeIds: [
    "aud_larger_longer", "aud_cut_down", "aud_time_spent", "aud_craving",
    "aud_role_failure", "aud_social_problems", "aud_activities_given_up",
    "aud_hazardous_use", "aud_continued_harm", "aud_tolerance", "aud_withdrawal",
  ],
};
const PAST_PSYCH: InterviewSection = {
  id: "past-psych",
  kind: "narrative",
  title: "Past psychiatric history",
  prompt: "Pre-injury diagnoses · treatment · hospitalisations · baseline function",
};
const PERSONAL: InterviewSection = {
  id: "personal",
  kind: "narrative",
  title: "Personal & background history",
  prompt: "Family · developmental · education · relationships · forensic",
};
const WORK: InterviewSection = {
  id: "work",
  kind: "narrative",
  title: "Occupational history",
  prompt: "Work history · duties at injury · capacity since · return-to-work attempts",
};
const TYPICAL_DAY: InterviewSection = {
  id: "typical-day",
  kind: "narrative",
  title: "Typical day / function",
  prompt: "Self-care · household · social & recreational · travel — feeds PIRS",
};
// NOTE (clinician feedback 2026-06-13): no MSE or PIRS sections in the Live
// Assessment — the clinician knows to do these and they add nothing to the
// interview script. Live Ax captures flow through to the MSE / DSM / Current
// Symptoms pages via integration/liveAxBridge.ts instead. The "mse"/"pirs"
// section kinds remain supported for any saved custom template that has them.

export const BUILTIN_TEMPLATES: readonly InterviewTemplate[] = [
  {
    id: "builtin-mva-threshold-wpi",
    name: "MVA — threshold & WPI",
    builtin: true,
    sections: [
      CIRCUMSTANCES, TREATMENT,
      MOOD, ANXIETY, PTSD, SLEEP, COGNITIVE, RISK, SUBSTANCE,
      PAST_PSYCH, PERSONAL, TYPICAL_DAY,
    ],
  },
  {
    id: "builtin-mva-threshold",
    name: "MVA — threshold only",
    builtin: true,
    sections: [
      CIRCUMSTANCES, TREATMENT,
      MOOD, ANXIETY, PTSD, SLEEP, COGNITIVE, RISK, SUBSTANCE,
      PAST_PSYCH, PERSONAL, TYPICAL_DAY,
    ],
  },
  {
    id: "builtin-wc",
    name: "Workers compensation",
    builtin: true,
    sections: [
      CIRCUMSTANCES, TREATMENT,
      MOOD, ANXIETY, PTSD, SLEEP, COGNITIVE, RISK, SUBSTANCE,
      PAST_PSYCH, PERSONAL, WORK, TYPICAL_DAY,
    ],
  },
  {
    id: "builtin-general",
    name: "General psychiatric IME",
    builtin: true,
    sections: [
      CIRCUMSTANCES, TREATMENT,
      MOOD, ANXIETY, PTSD, SLEEP, COGNITIVE, RISK, SUBSTANCE,
      PAST_PSYCH, PERSONAL, WORK, TYPICAL_DAY,
    ],
  },
];
