// Static medication registry. Mirrors the shape of data/dsm5.ts:
// pure, exported constants — no runtime fetch, no UI. Consumers
// (autocomplete in HistoryEditor) read this directly.

import type { MedicationClass } from "../types/history";

export type MedicationRegistryEntry = {
  name: string;             // canonical display name
  aliases?: string[];       // generic/brand alternates, lowercased
  class: MedicationClass;
  commonDoses?: number[];   // milligrams unless caller overrides unit
};

// Common psychiatric medications. Curated, not exhaustive — extend in PR
// review rather than allowing free-text drift.
export const MEDICATION_REGISTRY: MedicationRegistryEntry[] = [
  // ── SSRIs ──────────────────────────────────────────────────────────────
  { name: "Sertraline", aliases: ["zoloft"], class: "ssri", commonDoses: [25, 50, 100, 150, 200] },
  { name: "Escitalopram", aliases: ["cipralex", "lexapro"], class: "ssri", commonDoses: [5, 10, 15, 20] },
  { name: "Citalopram", aliases: ["celexa", "cipramil"], class: "ssri", commonDoses: [10, 20, 40] },
  { name: "Fluoxetine", aliases: ["prozac", "lovan"], class: "ssri", commonDoses: [10, 20, 40, 60] },
  { name: "Paroxetine", aliases: ["aropax", "paxil"], class: "ssri", commonDoses: [10, 20, 30, 40] },
  { name: "Fluvoxamine", aliases: ["luvox"], class: "ssri", commonDoses: [50, 100, 150, 200] },

  // ── SNRIs ──────────────────────────────────────────────────────────────
  { name: "Venlafaxine", aliases: ["efexor", "effexor"], class: "snri", commonDoses: [37.5, 75, 150, 225] },
  { name: "Desvenlafaxine", aliases: ["pristiq"], class: "snri", commonDoses: [50, 100] },
  { name: "Duloxetine", aliases: ["cymbalta"], class: "snri", commonDoses: [30, 60, 90, 120] },

  // ── Tricyclics ─────────────────────────────────────────────────────────
  { name: "Amitriptyline", aliases: ["endep"], class: "tricyclic", commonDoses: [10, 25, 50, 75, 100, 150] },
  { name: "Nortriptyline", aliases: ["allegron"], class: "tricyclic", commonDoses: [10, 25, 50, 75, 100] },
  { name: "Clomipramine", aliases: ["anafranil"], class: "tricyclic", commonDoses: [25, 50, 75, 150] },
  { name: "Dothiepin", aliases: ["dosulepin", "prothiaden"], class: "tricyclic", commonDoses: [25, 75, 150] },

  // ── MAOIs ──────────────────────────────────────────────────────────────
  { name: "Moclobemide", aliases: ["aurorix"], class: "maoi", commonDoses: [150, 300, 450, 600] },
  { name: "Phenelzine", aliases: ["nardil"], class: "maoi", commonDoses: [15, 30, 45, 60] },

  // ── Atypical antipsychotics ────────────────────────────────────────────
  { name: "Quetiapine", aliases: ["seroquel"], class: "antipsychotic_atypical", commonDoses: [25, 50, 100, 200, 300, 400] },
  { name: "Olanzapine", aliases: ["zyprexa"], class: "antipsychotic_atypical", commonDoses: [2.5, 5, 10, 15, 20] },
  { name: "Risperidone", aliases: ["risperdal"], class: "antipsychotic_atypical", commonDoses: [0.5, 1, 2, 3, 4] },
  { name: "Aripiprazole", aliases: ["abilify"], class: "antipsychotic_atypical", commonDoses: [5, 10, 15, 20, 30] },
  { name: "Lurasidone", aliases: ["latuda"], class: "antipsychotic_atypical", commonDoses: [20, 40, 80, 120] },

  // ── Typical antipsychotics ─────────────────────────────────────────────
  { name: "Haloperidol", aliases: ["serenace"], class: "antipsychotic_typical", commonDoses: [0.5, 1, 2, 5, 10] },
  { name: "Chlorpromazine", aliases: ["largactil"], class: "antipsychotic_typical", commonDoses: [25, 50, 100, 200] },

  // ── Mood stabilisers ───────────────────────────────────────────────────
  { name: "Lithium", aliases: ["lithicarb", "quilonum"], class: "mood_stabilizer", commonDoses: [250, 450, 500] },
  { name: "Sodium Valproate", aliases: ["epilim", "valproate"], class: "mood_stabilizer", commonDoses: [200, 500, 1000] },
  { name: "Lamotrigine", aliases: ["lamictal"], class: "mood_stabilizer", commonDoses: [25, 50, 100, 200] },
  { name: "Carbamazepine", aliases: ["tegretol"], class: "mood_stabilizer", commonDoses: [100, 200, 400] },

  // ── Anxiolytics ────────────────────────────────────────────────────────
  { name: "Diazepam", aliases: ["valium"], class: "anxiolytic", commonDoses: [2, 5, 10] },
  { name: "Lorazepam", aliases: ["ativan"], class: "anxiolytic", commonDoses: [0.5, 1, 2.5] },
  { name: "Oxazepam", aliases: ["serepax"], class: "anxiolytic", commonDoses: [15, 30] },
  { name: "Clonazepam", aliases: ["rivotril"], class: "anxiolytic", commonDoses: [0.5, 2] },
  { name: "Alprazolam", aliases: ["xanax", "kalma"], class: "anxiolytic", commonDoses: [0.25, 0.5, 1, 2] },

  // ── Hypnotics ──────────────────────────────────────────────────────────
  { name: "Zopiclone", aliases: ["imovane", "imrest"], class: "hypnotic", commonDoses: [3.75, 7.5] },
  { name: "Zolpidem", aliases: ["stilnox", "ambien"], class: "hypnotic", commonDoses: [5, 10] },
  { name: "Temazepam", aliases: ["normison", "temaze"], class: "hypnotic", commonDoses: [10, 20] },
  { name: "Melatonin", aliases: ["circadin"], class: "hypnotic", commonDoses: [2, 3, 5, 10] },

  // ── Stimulants ─────────────────────────────────────────────────────────
  { name: "Methylphenidate", aliases: ["ritalin", "concerta"], class: "stimulant", commonDoses: [10, 18, 27, 36, 54] },
  { name: "Dexamfetamine", aliases: ["dexedrine"], class: "stimulant", commonDoses: [5, 10] },
  { name: "Lisdexamfetamine", aliases: ["vyvanse"], class: "stimulant", commonDoses: [30, 50, 70] },
  { name: "Atomoxetine", aliases: ["strattera"], class: "stimulant", commonDoses: [10, 18, 25, 40, 60, 80] },

  // ── Other ──────────────────────────────────────────────────────────────
  { name: "Mirtazapine", aliases: ["avanza", "remeron"], class: "other", commonDoses: [15, 30, 45] },
  { name: "Agomelatine", aliases: ["valdoxan"], class: "other", commonDoses: [25, 50] },
  { name: "Bupropion", aliases: ["zyban", "wellbutrin"], class: "other", commonDoses: [150, 300] },
  { name: "Pregabalin", aliases: ["lyrica"], class: "other", commonDoses: [25, 75, 150, 300] },
  { name: "Gabapentin", aliases: ["neurontin"], class: "other", commonDoses: [100, 300, 600, 800] },
  { name: "Buspirone", aliases: ["buspar"], class: "anxiolytic", commonDoses: [5, 10, 15] },
  { name: "Propranolol", aliases: ["inderal"], class: "other", commonDoses: [10, 40, 80] },
  { name: "Naltrexone", aliases: ["revia"], class: "other", commonDoses: [25, 50] },
];

// ── Lookup helpers ─────────────────────────────────────────────────────────

const MEDICATION_LOOKUP: Map<string, MedicationRegistryEntry> = (() => {
  const m = new Map<string, MedicationRegistryEntry>();
  for (const entry of MEDICATION_REGISTRY) {
    m.set(entry.name.toLowerCase(), entry);
    for (const a of entry.aliases ?? []) m.set(a.toLowerCase(), entry);
  }
  return m;
})();

/** Resolve a free-text medication name (canonical or alias) to its registry entry. */
export function findMedication(query: string): MedicationRegistryEntry | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return MEDICATION_LOOKUP.get(q);
}

/** Substring match across canonical names + aliases. Capped to `limit`. */
export function searchMedications(query: string, limit = 8): MedicationRegistryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: MedicationRegistryEntry[] = [];
  const seen = new Set<MedicationRegistryEntry>();
  for (const entry of MEDICATION_REGISTRY) {
    if (seen.has(entry)) continue;
    const hay = [entry.name, ...(entry.aliases ?? [])].join("|").toLowerCase();
    if (hay.includes(q)) { out.push(entry); seen.add(entry); }
    if (out.length >= limit) break;
  }
  return out;
}

/** Auto-classify on entry (used when the user types a known name). */
export function classifyMedication(name: string): MedicationClass | undefined {
  return findMedication(name)?.class;
}

// ── Classification labels (UI display) ────────────────────────────────────
export const MEDICATION_CLASS_LABELS: Record<MedicationClass, string> = {
  ssri: "SSRI",
  snri: "SNRI",
  tricyclic: "Tricyclic",
  maoi: "MAOI",
  antipsychotic_typical: "Typical antipsychotic",
  antipsychotic_atypical: "Atypical antipsychotic",
  mood_stabilizer: "Mood stabiliser",
  anxiolytic: "Anxiolytic",
  hypnotic: "Hypnotic",
  stimulant: "Stimulant",
  other: "Other",
};

// ── Treatment modality chips (psychological / programs) ───────────────────
export const TREATMENT_MODALITIES = [
  "Cognitive Behavioural Therapy (CBT)",
  "Dialectical Behaviour Therapy (DBT)",
  "Acceptance and Commitment Therapy (ACT)",
  "Eye Movement Desensitisation and Reprocessing (EMDR)",
  "Psychodynamic psychotherapy",
  "Interpersonal psychotherapy",
  "Supportive counselling",
  "Schema therapy",
  "Trauma-focused CBT",
  "Group therapy",
  "Family therapy",
] as const;

// ── Common side-effect chips ──────────────────────────────────────────────
export const SIDE_EFFECT_CHIPS = [
  "Nausea",
  "Headache",
  "Insomnia",
  "Sedation",
  "Weight gain",
  "Weight loss",
  "Sexual dysfunction",
  "Tremor",
  "Akathisia",
  "Dry mouth",
  "Dizziness",
  "Constipation",
  "Increased anxiety",
] as const;
