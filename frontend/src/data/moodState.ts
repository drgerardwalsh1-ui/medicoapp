// ── Unified mood / emotional state vocabulary ─────────────────────────────────
// Single shared descriptor set used by BOTH the Current Symptoms
// "Mood & Emotional State" domain and the MSE Mood domain. The selected
// descriptors live on DSMAssessmentData.moodState — one source of truth, so a
// change in either screen is instantly reflected in the other.
//
// The set deliberately spans DSM depressive-symptom language and the broader
// affective vocabulary an MSE requires, so a single structure supports both.

export interface MoodDescriptor {
  id: string;
  label: string;
}

export const MOOD_DESCRIPTORS: MoodDescriptor[] = [
  { id: "euthymic", label: "euthymic" },
  { id: "low", label: "low" },
  { id: "depressed", label: "depressed" },
  { id: "anxious", label: "anxious" },
  { id: "irritable", label: "irritable" },
  { id: "elevated", label: "elevated" },
  { id: "labile", label: "labile" },
  { id: "dysphoric", label: "dysphoric" },
  { id: "angry", label: "angry" },
  { id: "emotionally_blunted", label: "emotionally blunted" },
  { id: "tearful", label: "tearful" },
  { id: "empty", label: "empty" },
  { id: "hopeless", label: "hopeless" },
  { id: "expansive", label: "expansive" },
];

export function moodLabel(id: string): string {
  return MOOD_DESCRIPTORS.find((d) => d.id === id)?.label ?? id;
}

// Descriptor labels in canonical (definition) order.
export function moodLabels(ids: string[]): string[] {
  const sel = new Set(ids);
  return MOOD_DESCRIPTORS.filter((d) => sel.has(d.id)).map((d) => d.label);
}
