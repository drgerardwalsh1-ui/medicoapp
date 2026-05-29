// ── Mental State Examination domain taxonomy ──────────────────────────────────
// Drives the MSE page chip panel and the narrative engine. Each domain renders
// as one continuously-scrolling group on the right-hand chip panel and one
// paragraph in the generated narrative.
//
// Default state is clinically NORMAL: with no chips selected every domain
// generates "no abnormality" prose. Selecting a chip layers an abnormal
// observation onto that domain.
//
// Some domains are LINKED — their clinical content is fed from the Current
// Symptoms / DSM symptom store rather than from local chips. Linked domains
// expose `linkedEntities` (symptom entity ids) so the MSE page can surface a
// live read-only summary plus a "jump to Current Symptoms" button.

export interface MSEChip {
  id: string;
  label: string;
}

export interface MSEDomainDef {
  id: string;
  label: string;
  // Local chip groups. Linked domains may still carry chips for observations
  // not covered by the symptom store (e.g. mood quality descriptors).
  chips: MSEChip[];
  // When set, the domain is fed live from the Current Symptoms entity store.
  linkedEntities?: string[];
  // When true, the domain is driven by the unified MoodState shared with the
  // Current Symptoms "Mood & Emotional State" domain (see data/moodState.ts) —
  // it has no local chips of its own.
  sharedMood?: boolean;
}

export const MSE_DOMAINS: MSEDomainDef[] = [
  {
    id: "appearance",
    label: "Appearance",
    chips: [
      { id: "appeared_older", label: "appeared older than stated age" },
      { id: "appeared_younger", label: "appeared younger than stated age" },
      { id: "dishevelled", label: "dishevelled" },
      { id: "hair_disarray", label: "hair in disarray" },
      { id: "poorly_groomed", label: "poorly groomed" },
      { id: "casually_dressed", label: "casually dressed" },
      { id: "neatly_dressed", label: "neatly dressed" },
      { id: "poor_hygiene", label: "poor personal hygiene" },
      { id: "guarded_appearance", label: "guarded" },
    ],
  },
  {
    id: "behaviour",
    label: "Behaviour",
    chips: [
      { id: "psychomotor_agitation", label: "psychomotor agitation" },
      { id: "psychomotor_retardation", label: "psychomotor retardation" },
      { id: "agitated", label: "agitated" },
      { id: "distressed", label: "distressed" },
      { id: "restless", label: "restless" },
      { id: "uncooperative", label: "uncooperative" },
      { id: "guarded", label: "guarded" },
      { id: "poor_eye_contact", label: "poor eye contact" },
      { id: "no_eye_contact", label: "no eye contact" },
    ],
  },
  {
    id: "speech",
    label: "Speech",
    chips: [
      { id: "not_spontaneous", label: "not spontaneous" },
      { id: "monotone", label: "monotone" },
      { id: "pressured", label: "pressured" },
      { id: "slowed", label: "slowed" },
      { id: "impoverished", label: "impoverished" },
      { id: "loud", label: "increased volume" },
      { id: "soft", label: "low volume" },
      { id: "slow_rate", label: "slow rate" },
      { id: "rapid_rate", label: "rapid rate" },
    ],
  },
  {
    id: "mood",
    label: "Mood",
    sharedMood: true,
    chips: [],
  },
  {
    id: "affect",
    label: "Affect",
    chips: [
      { id: "restricted", label: "restricted range" },
      { id: "flat", label: "flat" },
      { id: "blunted", label: "blunted" },
      { id: "labile_affect", label: "labile" },
      { id: "incongruent", label: "incongruent" },
      { id: "tearful", label: "tearful" },
      { id: "irritable_affect", label: "irritable" },
    ],
  },
  {
    id: "thoughtForm",
    label: "Thought form",
    linkedEntities: ["disorganised_thinking"],
    chips: [
      { id: "circumstantial", label: "circumstantial" },
      { id: "tangential", label: "tangential" },
      { id: "loosening", label: "loosening of associations" },
      { id: "flight_of_ideas", label: "flight of ideas" },
      { id: "thought_blocking", label: "thought blocking" },
      { id: "perseveration", label: "perseveration" },
    ],
  },
  {
    id: "thoughtContent",
    label: "Thought content",
    linkedEntities: ["worthlessness_guilt", "hopelessness", "low_self_esteem"],
    chips: [
      { id: "negative_thoughts", label: "negative thoughts" },
      { id: "preoccupations", label: "preoccupations" },
      { id: "ruminations", label: "ruminations" },
      { id: "overvalued_ideas", label: "overvalued ideas" },
      { id: "delusional_content", label: "delusions" },
      { id: "paranoid_ideation", label: "paranoid ideation" },
    ],
  },
  {
    id: "risk",
    label: "Behaviour / Risk",
    linkedEntities: ["suicidal_ideation", "self_harm", "risk_behaviours"],
    chips: [
      { id: "homicidal", label: "homicidal thoughts" },
    ],
  },
  {
    id: "perceptions",
    label: "Perceptions",
    linkedEntities: ["hallucinations"],
    chips: [
      { id: "auditory_hallucinations", label: "auditory hallucinations" },
      { id: "visual_hallucinations", label: "visual hallucinations" },
      { id: "responding_internal", label: "responding to internal stimuli" },
      { id: "illusions", label: "illusions" },
    ],
  },
  {
    id: "cognition",
    label: "Cognition",
    chips: [
      { id: "cognitive_testing_performed", label: "formal cognitive testing performed" },
      { id: "disoriented", label: "disoriented" },
      { id: "inattentive", label: "inattentive" },
      { id: "memory_impairment", label: "memory impairment" },
    ],
  },
];

export function mseDomain(id: string): MSEDomainDef | undefined {
  return MSE_DOMAINS.find((d) => d.id === id);
}
