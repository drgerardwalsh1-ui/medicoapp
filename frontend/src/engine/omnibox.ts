// ── Omnibox micro-grammar — fast fact capture during live interview ───────────
// Parses terse clinician shorthand into a structured Observation proposal:
//
//   "conc poor 3/12"                  → concentration_difficulty · 3 months
//   "sleep init 2hr nightly since mva"→ sleep_disturbance · nightly · post-injury
//   "no si"                           → suicidal_ideation · ABSENT
//   "panic 2x week severe"            → panic_attacks · 2x/week · severe
//
// Pure and deterministic: free text in, ranked proposals out. Nothing here
// asserts a fact — the clinician confirms the proposal (Enter) and the page
// appends the Observation. Unrecognised input proposes nothing (fail closed),
// never a guessed concept.
//
// Clinical duration shorthand: n/7 = days, n/52 = weeks, n/12 = months.

import { CONCEPT_REGISTRY } from "../ontology/canonicalOntology";
import { SYMPTOM_DOMAINS } from "../data/symptomDomains";
import type { Presence, SymptomSeverity } from "../types/observation";

export type OmniboxProposal = {
  readonly symptomTypeId: string;
  readonly label: string;
  readonly presence: Presence;
  readonly severity?: SymptomSeverity;
  readonly frequencyCount?: string;
  readonly frequencyUnit?: string;
  readonly durationCount?: string;
  readonly durationUnit?: string;
  /** ISO (possibly partial) onset, when stated. "since mva/accident/injury"
   *  resolves to the reference injury date when one is supplied. */
  readonly onset?: string;
  /** Qualifier words that matched no grammar fragment or concept word —
   *  carried as the observation note (e.g. "poor", "initial insomnia"). */
  readonly note?: string;
  /** Lower-ranked concept matches the clinician can Tab through. */
  readonly alternatives: readonly { symptomTypeId: string; label: string }[];
  /** Grammar tokens consumed (for chip rendering). */
  readonly recognised: readonly string[];
};

// ── Search index ──────────────────────────────────────────────────────────────
export type ConceptIndexEntry = {
  readonly symptomTypeId: string;
  readonly label: string;
  readonly haystack: readonly string[]; // lowercase words from label + prompts + id
  readonly idWords: readonly string[]; // words of the entity id — strongest signal
};

let cachedIndex: ConceptIndexEntry[] | null = null;

export function buildConceptIndex(): ConceptIndexEntry[] {
  if (cachedIndex) return cachedIndex;
  const promptWords = new Map<string, Set<string>>();
  for (const domain of SYMPTOM_DOMAINS) {
    for (const s of domain.symptoms) {
      const set = promptWords.get(s.symptomEntityId) ?? new Set<string>();
      for (const p of [s.label, ...s.prompts, domain.label]) {
        for (const w of p.toLowerCase().split(/[^a-z]+/)) if (w) set.add(w);
      }
      promptWords.set(s.symptomEntityId, set);
    }
  }
  cachedIndex = [...CONCEPT_REGISTRY.values()].map((c) => {
    const words = promptWords.get(c.symptomTypeId) ?? new Set<string>();
    for (const w of c.label.toLowerCase().split(/[^a-z]+/)) if (w) words.add(w);
    const idWords = c.symptomTypeId.split("_").filter(Boolean);
    for (const w of idWords) words.add(w);
    return {
      symptomTypeId: c.symptomTypeId,
      label: c.label,
      haystack: [...words],
      idWords,
    };
  });
  return cachedIndex;
}

// Common clinical abbreviations the index wouldn't otherwise hit.
const ABBREVIATIONS: Record<string, string> = {
  si: "suicidal_ideation",
  conc: "concentration_difficulty",
  anhed: "anhedonia",
  dep: "depressed_mood",
  irrit: "irritability",
  hypervig: "hypervigilance",
  nightmares: "trauma_dreams",
};

// ── Grammar fragments ─────────────────────────────────────────────────────────
const SEVERITY_WORDS: Record<string, SymptomSeverity> = {
  mild: "mild",
  moderate: "moderate",
  mod: "moderate",
  severe: "severe",
};

const NEGATION_WORDS = new Set(["no", "nil", "denies", "denied", "without"]);

const DURATION_UNITS: Record<string, string> = {
  "7": "days",
  "52": "weeks",
  "12": "months",
};

// Score one concept against the typed terms. Matched terms accumulate
// weight (entity-id word > abbreviation > indexed word > prefix); terms
// matching nowhere are returned so the caller can decide whether they are
// tolerable qualifiers ("poor", "init") or grounds to fail closed.
function matchScore(
  terms: string[],
  entry: ConceptIndexEntry,
): { score: number; strong: boolean; unmatched: string[] } {
  let score = 0;
  let strong = false;
  const unmatched: string[] = [];
  for (const t of terms) {
    if (entry.symptomTypeId === ABBREVIATIONS[t]) {
      score += 4; // explicit abbreviation hit
      strong = true;
      continue;
    }
    // Entity-id word — the strongest signal. Tolerant of morphological
    // variants ("sleeping" → id word "sleep") so extracted full-text forms
    // anchor as firmly as exact shorthand.
    if (
      entry.idWords.some(
        (w) => w === t || (w.length >= 4 && t.startsWith(w)) || (t.length >= 4 && w.startsWith(t)),
      )
    ) {
      score += 3;
      strong = true;
      continue;
    }
    const exact = entry.haystack.includes(t);
    // Bidirectional prefix: typed term is a prefix of an indexed word
    // ("conc" → "concentration") OR an indexed word is a prefix of the term
    // ("sleeping" → "sleep"; covers plurals/-ing forms in extracted text).
    const prefix =
      !exact &&
      t.length >= 3 &&
      entry.haystack.some(
        (w) => w.startsWith(t) || (w.length >= 4 && t.startsWith(w)),
      );
    if (exact) {
      score += 2;
      strong = true;
    } else if (prefix) {
      score += 1;
    } else {
      unmatched.push(t);
    }
  }
  return { score, strong, unmatched };
}

// Stop-words that should never, on their own, anchor a concept match. Kept
// to genuinely generic words — clinically-loaded terms ("mood", "sleep",
// "pain") stay so they can carry the match.
const PHRASE_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "with", "to", "for", "in", "on",
  "disorder", "syndrome", "symptoms", "symptom", "history", "chronic",
  "patient", "reports", "reported", "complains", "complaining", "feeling",
  "feels", "difficulty", "difficulties", "problems", "ongoing", "some",
]);

/**
 * Deterministically map a free clinical phrase (e.g. an extracted concept
 * "difficulty sleeping", "low mood") to a single ontology concept. Reuses
 * the omnibox concept index + scoring. Fails closed: returns null when no
 * concept STRONGLY matches (so a physical-condition phrase like "rheumatoid
 * arthritis" maps to nothing rather than a guessed psychiatric probe).
 */
export function matchConcept(
  phrase: string,
): { symptomTypeId: string; label: string; score: number } | null {
  const terms = phrase
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2 && !PHRASE_STOPWORDS.has(w));
  if (terms.length === 0) return null;

  const ranked = buildConceptIndex()
    .map((e) => ({ e, ...matchScore(terms, e) }))
    .filter((r) => r.strong)
    // Higher score first; then prefer the more central concept (fewer id
    // words → a "sleep disturbance" beats a "decreased need for sleep"); then
    // fewer leftover words; then alphabetical for determinism.
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.e.idWords.length - b.e.idWords.length ||
        a.unmatched.length - b.unmatched.length ||
        a.e.label.localeCompare(b.e.label),
    );

  if (ranked.length === 0) return null;
  const top = ranked[0];
  return { symptomTypeId: top.e.symptomTypeId, label: top.e.label, score: top.score };
}

/**
 * Parse one omnibox line. `referenceInjuryDate` (ISO, possibly partial)
 * resolves "since mva / accident / injury" onsets. Returns null when no
 * concept matches every remaining term — never guesses.
 */
export function parseOmniboxInput(
  input: string,
  referenceInjuryDate?: string,
): OmniboxProposal | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);

  let presence: Presence = "present";
  let severity: SymptomSeverity | undefined;
  let frequencyCount: string | undefined;
  let frequencyUnit: string | undefined;
  let durationCount: string | undefined;
  let durationUnit: string | undefined;
  let onset: string | undefined;
  const recognised: string[] = [];
  const conceptTerms: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (NEGATION_WORDS.has(tok)) {
      presence = "absent";
      recognised.push(tok);
      continue;
    }
    if (SEVERITY_WORDS[tok]) {
      severity = SEVERITY_WORDS[tok];
      recognised.push(tok);
      continue;
    }
    // Duration shorthand n/7, n/52, n/12.
    const shorthand = tok.match(/^(\d+)\/(7|52|12)$/);
    if (shorthand) {
      durationCount = shorthand[1];
      durationUnit = DURATION_UNITS[shorthand[2]];
      recognised.push(tok);
      continue;
    }
    // "3 months" / "2 weeks" / "5 days" / "2 years" (also 3m / 2w / 2yr).
    const unitWord = tokens[i + 1]?.match(/^(day|week|month|year)s?$/);
    if (/^\d+$/.test(tok) && unitWord) {
      durationCount = tok;
      durationUnit = `${unitWord[1]}s`;
      recognised.push(tok, tokens[i + 1]);
      i += 1;
      continue;
    }
    const compact = tok.match(/^(\d+)(d|w|m|yr?)$/);
    if (compact) {
      durationCount = compact[1];
      durationUnit = { d: "days", w: "weeks", m: "months", y: "years", yr: "years" }[
        compact[2]
      ]!;
      recognised.push(tok);
      continue;
    }
    // Frequency: "2x week", "3x/day", "nightly", "daily".
    const freq = tok.match(/^(\d+)x(?:\/(day|week|month))?$/);
    if (freq) {
      frequencyCount = freq[1];
      const unitNext = tokens[i + 1]?.match(/^(day|week|month)s?$/);
      if (freq[2]) frequencyUnit = freq[2];
      else if (unitNext) {
        frequencyUnit = unitNext[1];
        recognised.push(tokens[i + 1]);
        i += 1;
      } else frequencyUnit = "week";
      recognised.push(tok);
      continue;
    }
    if (tok === "nightly" || tok === "daily") {
      frequencyCount = "7";
      frequencyUnit = "week";
      recognised.push(tok);
      continue;
    }
    // Onset: "since 2023", "since mva/accident/injury".
    if (tok === "since" && tokens[i + 1]) {
      const next = tokens[i + 1];
      if (/^\d{4}(-\d{2})?(-\d{2})?$/.test(next)) {
        onset = next;
        recognised.push(tok, next);
        i += 1;
        continue;
      }
      if (["mva", "accident", "injury"].includes(next)) {
        if (referenceInjuryDate) onset = referenceInjuryDate;
        recognised.push(tok, next);
        i += 1;
        continue;
      }
    }
    conceptTerms.push(tok);
  }

  if (conceptTerms.length === 0) return null;

  // A proposal needs at least one STRONG term (id word, abbreviation, or
  // exact indexed word). Unmatched leftovers are tolerated as qualifier
  // note text ("poor", "init") — but a line with no strong anchor fails
  // closed: the omnibox never guesses a concept the clinician didn't type.
  const ranked = buildConceptIndex()
    .map((e) => ({ e, ...matchScore(conceptTerms, e) }))
    .filter((r) => r.strong)
    .sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label));

  if (ranked.length === 0) return null; // fail closed — never guess

  const top = ranked[0].e;
  const note = ranked[0].unmatched.join(" ") || undefined;
  return {
    symptomTypeId: top.symptomTypeId,
    label: top.label,
    note,
    presence,
    severity,
    frequencyCount,
    frequencyUnit,
    durationCount,
    durationUnit,
    onset,
    alternatives: ranked
      .slice(1, 6)
      .map((r) => ({ symptomTypeId: r.e.symptomTypeId, label: r.e.label })),
    recognised,
  };
}
