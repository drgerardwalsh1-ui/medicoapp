// ── Symptom → PIRS category evidence mapping ──────────────────────────────────
// Declares which symptom entities surface as candidate EVIDENCE on each PIRS
// category worksheet. This is app convenience data — clinician-extendable —
// unlike the PIRS class definitions and WPI conversion tables
// (rules/pirsNswRules.ts), which are immutable clinical rule data.
//
// Surfacing here NEVER selects or suggests a PIRS class: the clinician rates
// each category; this mapping only gathers the relevant captured symptoms so
// nothing has to be re-entered on the PIRS page.
//
// Category names match CATEGORY_NAMES in components/PIRSTable.tsx:
//   Self            — self-care & personal hygiene
//   Recreational    — social & recreational activities
//   Travel          — travel
//   Social Function — social functioning / relationships
//   Concentration   — concentration, persistence & pace
//   Adaptation      — employability / adaptation

export const PIRS_CATEGORY_NAMES = [
  "Self",
  "Recreational",
  "Travel",
  "Social Function",
  "Concentration",
  "Adaptation",
] as const;

export type PIRSCategoryName = (typeof PIRS_CATEGORY_NAMES)[number];

export const SYMPTOM_PIRS_MAPPING: Record<string, PIRSCategoryName[]> = {
  // ── Concentration, persistence & pace ─────────────────────────────────────
  concentration_difficulty: ["Concentration", "Adaptation"],
  forgetfulness: ["Concentration"],
  easily_distracted: ["Concentration"],
  attention_sustaining_difficulty: ["Concentration"],
  task_completion_difficulty: ["Concentration", "Adaptation"],
  organization_difficulty: ["Concentration", "Adaptation"],
  racing_thoughts: ["Concentration"],

  // ── Self-care & personal hygiene ──────────────────────────────────────────
  fatigue_energy_loss: ["Self", "Recreational"],
  psychomotor_disturbance: ["Self"],
  depressed_mood: ["Self", "Adaptation"],
  hopelessness: ["Self"],

  // ── Travel ────────────────────────────────────────────────────────────────
  fear_of_public_transport: ["Travel"],
  fear_of_open_spaces: ["Travel"],
  fear_of_crowds: ["Travel", "Social Function"],
  fear_of_being_alone_outside: ["Travel"],
  fear_of_enclosed_spaces: ["Travel"],
  panic_attacks: ["Travel", "Adaptation"],
  avoidance_behaviours: ["Travel", "Recreational"],
  external_avoidance: ["Travel", "Recreational"],
  hypervigilance: ["Travel", "Adaptation"],

  // ── Social functioning ────────────────────────────────────────────────────
  detachment: ["Social Function", "Recreational"],
  relationship_deficits: ["Social Function"],
  irritability: ["Social Function", "Adaptation"],
  social_fear: ["Social Function", "Recreational"],
  fear_of_scrutiny: ["Social Function"],
  fear_of_embarrassment: ["Social Function"],
  persistent_negative_emotion: ["Social Function"],
  inability_positive_emotions: ["Social Function", "Recreational"],

  // ── Social & recreational activities ──────────────────────────────────────
  anhedonia: ["Recreational", "Adaptation"],

  // ── Employability / adaptation ────────────────────────────────────────────
  sleep_disturbance: ["Adaptation"],
  exaggerated_startle: ["Adaptation"],
};
