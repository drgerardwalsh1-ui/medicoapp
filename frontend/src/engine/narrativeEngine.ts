// src/engine/narrativeEngine.ts
// Deterministic medico-legal sentence assembly engine.
// Rule-based only — no paraphrasing, no synonym substitution, no interpretation.

import type {
  PirsCategoryKey,
  PIRSTableModel,
  ReasonEntry,
  CommonSubdomainEntry,
  SocialSubdomainEntry,
  SocialFunctioningData,
  EmployabilitySubdomainEntry,
  RelationshipEntry,
  ChildrenEntry,
} from "../types/types";

// ── Subject ───────────────────────────────────────────────────────────────────

export type NarrativeSubject = {
  noun: string;       // sentence-start (capitalised): "He" | "She" | "They"
  pronoun: string;    // mid-sentence: "he" | "she" | "they"
  possessive: string; // "his" | "her" | "their"
  isPlural: boolean;  // true for "they" — drives conjugation
};

const MALE: NarrativeSubject    = { noun: "He",   pronoun: "he",   possessive: "his",   isPlural: false };
const FEMALE: NarrativeSubject  = { noun: "She",  pronoun: "she",  possessive: "her",   isPlural: false };
const NEUTRAL: NarrativeSubject = { noun: "They", pronoun: "they", possessive: "their", isPlural: true  };

export function buildSubject(gender?: string | null): NarrativeSubject {
  const g = (gender ?? "").toLowerCase();
  if (g === "male"   || g === "m") return MALE;
  if (g === "female" || g === "f") return FEMALE;
  return NEUTRAL;
}

// ── Attribution verb rotation ─────────────────────────────────────────────────
// Fixed cycle: said → reported → stated → said …
// Resets per subdomain (per sentencesForSubdomain call).

const ATTR_VERBS = ["said", "reported", "stated"] as const;

export type VerbRotator = () => string;

export function makeVerbRotator(): VerbRotator {
  let i = 0;
  return () => ATTR_VERBS[i++ % 3];
}

// ── Activity vocabulary ───────────────────────────────────────────────────────

export type ActivityVocab = {
  infinitive: string;       // "shower"         — "able to shower", "does not shower"
  gerund: string;           // "showering"       — "no difficulty with showering"
  thirdPersonS: string;     // "showers"         — "he showers daily"
  baseForm: string;         // "shower"          — "they shower daily"
  pastSimple: string;       // "showered"        — "last showered"
  pastParticiple?: string;  // "driven"          — "has not driven" (irregular only)
};

// ── Frequency conversion ──────────────────────────────────────────────────────

export function formatFrequency(unit: string, count: string): string {
  if (!unit && !count) return "";
  if (count === "Daily") return "daily";
  if (count === "1" && unit === "Day") return "daily";
  const countWords: Record<string, string> = {
    "1": "once", "2–3": "two to three times", "4–5": "four to five times",
  };
  const unitWords: Record<string, string> = {
    "Day": "a day", "Week": "a week", "Fortnight": "a fortnight", "Month": "a month", "Year": "a year",
  };
  const c = countWords[count] ?? (count ? `${count} times` : "");
  const u = unitWords[unit] ?? unit.toLowerCase();
  if (!c && u) return u;
  if (c && !u) return c;
  return `${c} ${u}`.trim();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function listJoin(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function endSentence(s: string): string {
  const t = s.trimEnd();
  return t.endsWith(".") || t.endsWith("?") || t.endsWith("!") ? t : `${t}.`;
}

function getSDRaw<T>(table: PIRSTableModel, catIdx: number, key: string): T {
  const raw = (table.reasons?.[catIdx] as ReasonEntry | undefined)?.subdomainData;
  return ((raw?.[key] ?? {}) as T);
}

// ── Behaviour modifier suffix builder ─────────────────────────────────────────
// "due to" reasons are merged: "due to low motivation and anxiety"
// Other clause modifiers appended separately.

const DUE_TO_MAP: Partial<Record<string, string>> = {
  "Low motivation": "low motivation",
  "Anxiety":        "anxiety",
  "Pain":           "pain",
};

const CLAUSE_MAP: Partial<Record<string, string>> = {
  "Irregular":     "on an irregular basis",
  "Avoids people": "but avoids people",
  "No enjoyment":  "and does not derive enjoyment",
};

function buildModSuffix(modifiers: string[]): string {
  const active = modifiers.filter(m => m !== "Regular");
  const dueToReasons: string[] = [];
  const clauses: string[] = [];

  for (const m of active) {
    const dto = DUE_TO_MAP[m];
    if (dto) { dueToReasons.push(dto); continue; }
    const cl = CLAUSE_MAP[m];
    if (cl) clauses.push(cl);
  }

  const parts: string[] = [];
  if (dueToReasons.length) parts.push(`due to ${listJoin(dueToReasons)}`);
  parts.push(...clauses);

  return parts.length ? `, ${parts.join(", ")}` : "";
}

// ── Recency phrase map ────────────────────────────────────────────────────────

const RECENCY_PHRASES: Record<string, string> = {
  "Today":      "today",
  "This week":  "this week",
  "This month": "this month",
  "1–3 months": "one to three months ago",
  ">3 months":  "more than three months ago",
};

// ── Core subdomain sentence builder ──────────────────────────────────────────
//
// Fixed sentence order (per spec):
//   1. Activity + frequency + manner/independence (behaviour modifiers woven in)
//   2. Prompting (if needs_prompting)
//   3. Assistance (if needs_assistance | dependent)
//   4. Recency
//   5. Pre-injury comparison
//   6. Optional free text
//
// Attribution verbs rotate: said → reported → stated → said …
// Rotation resets per subdomain (per call to this function).
// Possessive pronoun applied to all preset WHO chips.

export function sentencesForSubdomain(
  data: CommonSubdomainEntry,
  vocab: ActivityVocab,
  subj: NarrativeSubject,
  vr: VerbRotator = makeVerbRotator()
): string[] {
  const { noun, pronoun, possessive, isPlural } = subj;
  function att(): string { return `${noun} ${vr()} that ${pronoun}`; }
  const be    = isPlural ? "are" : "is";
  const have  = isPlural ? "have" : "has";
  const doNeg = isPlural ? "do not" : "does not";
  const wasBe = isPlural ? "were" : "was";
  const vf    = isPlural ? vocab.baseForm : vocab.thirdPersonS;
  const sentences: string[] = [];
  let preInjuryHandled = false;

  // ── Case 1: Does not perform ──────────────────────────────────────────────
  if (data.doesNotPerform) {
    sentences.push(`${att()} ${doNeg} ${vocab.infinitive}.`);
    return sentences;
  }

  // ── Case 2: No issues ────────────────────────────────────────────────────
  if (data.noIssues) {
    sentences.push(`${att()} ${have} no difficulty with ${vocab.gerund}.`);
    return sentences;
  }

  if (!data.managementLevel) return sentences;

  const ml         = data.managementLevel;
  const freq       = formatFrequency(data.frequencyUnit ?? "", data.frequencyCount ?? "");
  const modSuffix  = buildModSuffix(data.behaviourModifiers ?? []);

  // ── Sentence 1: Activity + frequency + manner ────────────────────────────
  if (ml === "independent") {
    if (freq) {
      sentences.push(`${att()} ${vf} ${freq} independently${modSuffix}.`);
    } else {
      sentences.push(`${att()} ${be} able to ${vocab.infinitive} independently${modSuffix}.`);
    }
  } else if (ml === "independent_difficulty") {
    if (freq) {
      sentences.push(`${att()} ${vf} ${freq}, but with difficulty${modSuffix}.`);
    } else {
      sentences.push(`${att()} ${be} able to ${vocab.infinitive}, but with difficulty${modSuffix}.`);
    }
  } else {
    // needs_prompting | needs_assistance | dependent
    if (freq) {
      sentences.push(`${att()} ${vf} ${freq}${modSuffix}.`);
    } else if (ml === "dependent") {
      sentences.push(`${att()} ${be} fully dependent on others for ${vocab.gerund}.`);
    }
    // else: no activity sentence here — prompting/assistance sentence establishes the activity
  }

  // ── Sentence 2: Prompting ────────────────────────────────────────────────
  if (ml === "needs_prompting") {
    const whoChips = (data.promptingWhoChips ?? [])
      .map(w => `${possessive} ${w.toLowerCase()}`);
    const whoOther = data.promptingWhoOther ? [data.promptingWhoOther] : [];
    const who = [...whoChips, ...whoOther];
    const whoStr = who.length ? listJoin(who) : "a support person";
    const pf = formatFrequency(
      data.promptingFrequencyUnit ?? "",
      data.promptingFrequencyCount ?? ""
    );
    const activityEstablished = !!freq;
    if (pf && activityEstablished) {
      sentences.push(`${att()} requires prompting from ${whoStr} ${pf}.`);
    } else if (pf) {
      sentences.push(`${att()} requires prompting from ${whoStr} ${pf} to ${vocab.infinitive}.`);
    } else if (activityEstablished) {
      sentences.push(`${att()} requires prompting from ${whoStr} to do so.`);
    } else {
      sentences.push(`${att()} requires prompting from ${whoStr} to ${vocab.infinitive}.`);
    }
  }

  // ── Sentence 3: Assistance ────────────────────────────────────────────────
  if (ml === "needs_assistance" || ml === "dependent") {
    const whoChips = (data.assistWhoChips ?? [])
      .map(w => `${possessive} ${w.toLowerCase()}`);
    const whoOther = data.assistWhoOther ? [data.assistWhoOther] : [];
    const who = [...whoChips, ...whoOther];
    const whoStr = who.length ? listJoin(who) : "a carer or support person";
    const hrs = data.supportHoursCustom || data.supportHoursChip;
    const activityEstablished = !!freq || ml === "dependent";
    if (hrs && activityEstablished) {
      sentences.push(
        `${att()} receives assistance from ${whoStr} for approximately ${hrs} hours per week.`
      );
    } else if (hrs) {
      sentences.push(
        `${att()} receives assistance from ${whoStr} with ${vocab.gerund} for approximately ${hrs} hours per week.`
      );
    } else if (activityEstablished) {
      sentences.push(`${att()} receives assistance from ${whoStr}.`);
    } else {
      sentences.push(`${att()} receives assistance from ${whoStr} with ${vocab.gerund}.`);
    }
  }

  // ── Sentence 4: Recency ──────────────────────────────────────────────────
  const recencyRaw = data.recencyOverride || data.recencyValue;
  if (recencyRaw) {
    if (data.recencyValue === "Never" && !data.recencyOverride) {
      // "Never" logic: use "never [verb]", incorporate pre-injury where applicable
      const pic = data.preInjuryComparison;
      if (pic === "same" || pic === "worse") {
        sentences.push(`${att()} never ${vf}, including before the injury.`);
        preInjuryHandled = true;
      } else {
        sentences.push(`${att()} never ${vf}.`);
      }
    } else {
      const phrase = RECENCY_PHRASES[recencyRaw] ?? recencyRaw.toLowerCase();
      sentences.push(`${att()} last ${vocab.pastSimple} ${phrase}.`);
    }
  }

  // ── Sentence 5: Pre-injury comparison (skip if folded into Never) ─────────
  if (!preInjuryHandled) {
    const pic      = data.preInjuryComparison;
    const picNotes = data.preInjuryComparisonNotes;
    if (pic === "better") {
      sentences.push(`${att()} ${wasBe} able to ${vocab.infinitive} without difficulty before the injury.`);
    } else if (pic === "worse") {
      sentences.push(`${noun} ${vr()} that ${possessive} difficulty with ${vocab.gerund} pre-dated the injury.`);
    } else if (pic === "same") {
      sentences.push(`${noun} ${vr()} that ${possessive} ability to ${vocab.infinitive} was no different before the injury.`);
    }
    if (picNotes) {
      sentences.push(endSentence(`${noun} ${vr()} that ${picNotes}`));
    }
  }

  // ── Sentence 6: Optional free text ───────────────────────────────────────
  if (data.optionalFreeText) {
    sentences.push(endSentence(`${noun} ${vr()} that ${data.optionalFreeText}`));
  }

  return sentences;
}

// ── Activity vocabulary maps ──────────────────────────────────────────────────

type SubdomainVocab = { key: string; vocab: ActivityVocab };

const SELF_CARE_VOCAB: SubdomainVocab[] = [
  { key: "bathing",
    vocab: { infinitive: "bathe or shower", gerund: "bathing or showering",
             thirdPersonS: "bathes or showers", baseForm: "bathe or shower", pastSimple: "bathed or showered" } },
  { key: "grooming",
    vocab: { infinitive: "groom", gerund: "grooming and personal hygiene",
             thirdPersonS: "grooms", baseForm: "groom", pastSimple: "groomed" } },
  { key: "cooking",
    vocab: { infinitive: "cook or prepare meals", gerund: "cooking and meal preparation",
             thirdPersonS: "cooks", baseForm: "cook", pastSimple: "cooked" } },
  { key: "householdChores",
    vocab: { infinitive: "do household chores", gerund: "household chores",
             thirdPersonS: "does household chores", baseForm: "do household chores",
             pastSimple: "completed household chores" } },
  { key: "shopping",
    vocab: { infinitive: "shop", gerund: "shopping",
             thirdPersonS: "shops", baseForm: "shop", pastSimple: "shopped" } },
  { key: "other",
    vocab: { infinitive: "perform other self-care tasks", gerund: "other self-care tasks",
             thirdPersonS: "performs other self-care tasks", baseForm: "perform other self-care tasks",
             pastSimple: "performed other self-care tasks" } },
];

const SOCIAL_VOCAB: SubdomainVocab[] = [
  { key: "socialOutings",
    vocab: { infinitive: "attend social outings", gerund: "social outings",
             thirdPersonS: "attends social outings", baseForm: "attend social outings",
             pastSimple: "attended social outings" } },
  { key: "hobbies",
    vocab: { infinitive: "engage in hobbies", gerund: "hobbies and leisure activities",
             thirdPersonS: "engages in hobbies", baseForm: "engage in hobbies",
             pastSimple: "engaged in hobbies" } },
  { key: "exercise",
    vocab: { infinitive: "exercise or play sport", gerund: "exercise and sport",
             thirdPersonS: "exercises or plays sport", baseForm: "exercise or play sport",
             pastSimple: "exercised or played sport" } },
  { key: "culturalActivities",
    vocab: { infinitive: "attend cultural or religious activities",
             gerund: "cultural and religious activities",
             thirdPersonS: "attends cultural or religious activities",
             baseForm: "attend cultural or religious activities",
             pastSimple: "attended cultural or religious activities" } },
  { key: "socialParticipation",
    vocab: { infinitive: "participate socially", gerund: "social participation",
             thirdPersonS: "participates socially", baseForm: "participate socially",
             pastSimple: "participated socially" } },
];

const TRAVEL_VOCAB: SubdomainVocab[] = [
  { key: "localTravel",
    vocab: { infinitive: "travel locally", gerund: "local travel",
             thirdPersonS: "travels locally", baseForm: "travel locally",
             pastSimple: "travelled locally" } },
  { key: "longDistance",
    vocab: { infinitive: "travel long distances", gerund: "long-distance travel",
             thirdPersonS: "travels long distances", baseForm: "travel long distances",
             pastSimple: "travelled long distances" } },
  { key: "driving",
    vocab: { infinitive: "drive", gerund: "driving",
             thirdPersonS: "drives", baseForm: "drive",
             pastSimple: "drove", pastParticiple: "driven" } },
  { key: "publicTransport",
    vocab: { infinitive: "use public transport", gerund: "public transport use",
             thirdPersonS: "uses public transport", baseForm: "use public transport",
             pastSimple: "used public transport" } },
];

const CONCENTRATION_VOCAB: SubdomainVocab[] = [
  { key: "reading",
    vocab: { infinitive: "read", gerund: "reading",
             thirdPersonS: "reads", baseForm: "read", pastSimple: "read" } },
  { key: "taskCompletion",
    vocab: { infinitive: "complete tasks", gerund: "task completion",
             thirdPersonS: "completes tasks", baseForm: "complete tasks",
             pastSimple: "completed tasks" } },
  { key: "followingInstructions",
    vocab: { infinitive: "follow instructions", gerund: "following instructions",
             thirdPersonS: "follows instructions", baseForm: "follow instructions",
             pastSimple: "followed instructions" } },
  { key: "conversationFocus",
    vocab: { infinitive: "maintain conversational focus",
             gerund: "maintaining conversational focus",
             thirdPersonS: "maintains conversational focus",
             baseForm: "maintain conversational focus",
             pastSimple: "maintained conversational focus" } },
];

// ── Domain-specific value maps ─────────────────────────────────────────────────

const RELATIONSHIP_QUALITY_TEXT: Partial<Record<string, string>> = {
  strained:        "strained",
  conflict:        "conflicted",
  no_relationship: "non-existent",
};

const EMPLOYMENT_STATUS_TEXT: Partial<Record<string, string>> = {
  full_time:   "employed full-time",
  part_time:   "employed part-time",
  casual:      "casually employed",
  unemployed:  "unemployed",
  not_seeking: "not seeking employment",
  retired:     "retired",
  student:     "a student",
};

// ── TravelSD / ConcentrationSD intersection types ─────────────────────────────

type TravelSD = CommonSubdomainEntry & {
  travelMode?: string[];
  drivingStatus?: string;
  safetyIssues?: boolean;
  safetyDescription?: string;
  distanceCapacity?: string;
};

type ConcentrationSD = CommonSubdomainEntry & {
  durationCapacity?: string;
  fatigueOnset?: string;
  memoryIssues?: boolean;
  memoryIssueType?: string[];
  studyAbility?: boolean;
  studySupport?: string;
};

// ── Category-level narrative generator ────────────────────────────────────────
//
// Returns a single paragraph for the findings box.
// Deterministic: same input always produces identical output.
// Each subdomain's sentences rotate independently (said → reported → stated).

export function generateCategoryNarrative(
  table: PIRSTableModel,
  catIdx: number,
  categoryKey: PirsCategoryKey,
  subj: NarrativeSubject
): string {
  const { noun, pronoun, possessive, isPlural } = subj;
  const be    = isPlural ? "are" : "is";
  const have  = isPlural ? "have" : "has";
  const doNeg = isPlural ? "do not" : "does not";
  const wasBe = isPlural ? "were" : "was";
  const all: string[] = [];

  // ── Self-care ─────────────────────────────────────────────────────────────
  if (categoryKey === "selfCare") {
    for (const { key, vocab } of SELF_CARE_VOCAB) {
      const data = getSDRaw<CommonSubdomainEntry>(table, catIdx, key);
      all.push(...sentencesForSubdomain(data, vocab, subj));
    }
  }

  // ── Social & Recreational ─────────────────────────────────────────────────
  if (categoryKey === "socialRecreational") {
    const flags = getSDRaw<{ doesNotGoOut?: boolean; noHobbies?: boolean }>(table, catIdx, "_flags");
    const flagVr = makeVerbRotator();
    if (flags.doesNotGoOut) all.push(`${noun} ${flagVr()} that ${pronoun} ${doNeg} go out socially.`);
    if (flags.noHobbies)    all.push(`${noun} ${flagVr()} that ${pronoun} ${have} no hobbies or leisure activities.`);

    for (const { key, vocab } of SOCIAL_VOCAB) {
      const data = getSDRaw<SocialSubdomainEntry>(table, catIdx, key);
      const vr = makeVerbRotator();
      const sents = sentencesForSubdomain(data, vocab, subj, vr);
      all.push(...sents);

      if (sents.length === 0) continue;

      if (data.activityTypes?.length) {
        all.push(`${noun} ${vr()} that these activities included ${listJoin(data.activityTypes.map(s => s.toLowerCase()))}.`);
      }
      if (data.avoidanceBehaviour) {
        const reasons = data.avoidanceReasons?.length
          ? ` due to ${listJoin(data.avoidanceReasons.map(s => s.toLowerCase()))}`
          : "";
        all.push(`${noun} ${vr()} that ${pronoun} avoided ${vocab.gerund}${reasons}.`);
      }
      if (data.supportPersonRequired) {
        const detail = data.supportPersonDetails ? ` (${data.supportPersonDetails})` : "";
        all.push(`${noun} ${vr()} that ${pronoun} required a support person to ${vocab.infinitive}${detail}.`);
      }
    }
  }

  // ── Travel ────────────────────────────────────────────────────────────────
  if (categoryKey === "travel") {
    const flags = getSDRaw<{ doesNotTravel?: boolean; cannotLeaveResidence?: boolean }>(table, catIdx, "_flags");
    if (flags.cannotLeaveResidence) {
      const vr = makeVerbRotator();
      all.push(`${noun} ${vr()} that ${pronoun} ${be} unable to leave ${possessive} residence.`);
    } else if (flags.doesNotTravel) {
      const vr = makeVerbRotator();
      all.push(`${noun} ${vr()} that ${pronoun} ${doNeg} travel.`);
    } else {
      for (const { key, vocab } of TRAVEL_VOCAB) {
        const data = getSDRaw<TravelSD>(table, catIdx, key);
        const vr = makeVerbRotator();
        const sents = sentencesForSubdomain(data, vocab, subj, vr);
        all.push(...sents);

        if (sents.length === 0) continue;

        if (data.travelMode?.length) {
          all.push(`${noun} ${vr()} that ${pronoun} typically used ${listJoin(data.travelMode.map(s => s.toLowerCase()))}.`);
        }
        if (data.drivingStatus) {
          all.push(`${noun} ${vr()} that ${pronoun} ${data.drivingStatus.toLowerCase()}.`);
        }
        if (data.distanceCapacity) {
          all.push(`${noun} ${vr()} that ${pronoun} ${wasBe} unable to travel beyond ${data.distanceCapacity}.`);
        }
        if (data.safetyIssues) {
          const desc = data.safetyDescription ? `: ${data.safetyDescription}` : "";
          all.push(`${noun} ${vr()} that safety concerns were present when ${vocab.gerund}${desc}.`);
        }
      }
    }
  }

  // ── Social Functioning ────────────────────────────────────────────────────
  if (categoryKey === "socialFunction") {
    const sf = getSDRaw<SocialFunctioningData>(table, catIdx, "_sf");
    const vr = makeVerbRotator();

    const LIVING_TEXT: Partial<Record<string, string>> = {
      alone:         "lived alone",
      with_partner:  "lived with a partner",
      with_children: "lived with children",
      with_parents:  "lived with parents",
      with_others:   "lived with others",
    };
    if (sf.livingArrangement) {
      const base   = LIVING_TEXT[sf.livingArrangement] ?? sf.livingArrangement.replace(/_/g, " ");
      const detail = sf.livingArrangementDetails ? ` — ${sf.livingArrangementDetails}` : "";
      all.push(`${noun} ${vr()} that ${pronoun} ${base}${detail}.`);
    }

    if (sf.noPartner)       all.push(`${noun} ${vr()} that ${pronoun} ${doNeg} have a partner.`);
    if (sf.noChildren)      all.push(`${noun} ${vr()} that ${pronoun} ${doNeg} have children.`);
    if (sf.parentsDeceased) all.push(`${noun} ${vr()} that ${possessive} parents ${be} deceased.`);
    if (sf.noSiblings)      all.push(`${noun} ${vr()} that ${pronoun} ${doNeg} have siblings.`);
    if (sf.noCloseFriends)  all.push(`${noun} ${vr()} that ${pronoun} ${doNeg} have close friends.`);
    if (sf.domesticViolenceHistory) all.push(`${noun} ${vr()} a history of domestic violence.`);

    if (!sf.noChildren && sf.children) {
      const c = sf.children as ChildrenEntry;
      if (c.numberOfChildren) {
        const word = c.numberOfChildren === 1 ? "child" : "children";
        const ages = c.ages ? `, aged ${c.ages}` : "";
        all.push(`${noun} ${vr()} that ${pronoun} ${have} ${c.numberOfChildren} ${word}${ages}.`);
      }
      if (c.careResponsibility === "full") {
        all.push(`${noun} ${vr()} that ${pronoun} ${wasBe} the primary carer for ${possessive} children.`);
      } else if (c.careResponsibility === "shared") {
        all.push(`${noun} ${vr()} that care responsibilities were shared.`);
      } else if (c.careResponsibility === "others") {
        all.push(`${noun} ${vr()} that others were responsible for the care of ${possessive} children.`);
      }
      if (c.quality && c.quality !== "good") {
        const qt = RELATIONSHIP_QUALITY_TEXT[c.quality] ?? c.quality;
        all.push(`${noun} ${vr()} that ${possessive} relationship with ${possessive} children was ${qt}.`);
      }
    }

    const entities: Array<{
      key: "partner" | "parents" | "siblings" | "friends";
      label: string;
      skip: boolean;
    }> = [
      { key: "partner",  label: "partner",  skip: !!sf.noPartner },
      { key: "parents",  label: "parents",  skip: !!sf.parentsDeceased },
      { key: "siblings", label: "siblings", skip: !!sf.noSiblings },
      { key: "friends",  label: "friends",  skip: !!sf.noCloseFriends },
    ];
    for (const { key, label, skip } of entities) {
      if (skip) continue;
      const rel = sf[key] as RelationshipEntry | undefined;
      if (!rel) continue;
      if (rel.quality && rel.quality !== "good") {
        const qt = RELATIONSHIP_QUALITY_TEXT[rel.quality] ?? rel.quality;
        all.push(`${noun} ${vr()} that ${possessive} relationship with ${possessive} ${label} was ${qt}.`);
      }
      if (rel.contactFrequency) {
        all.push(`${noun} ${vr()} that ${pronoun} had contact with ${possessive} ${label} ${rel.contactFrequency}.`);
      }
      if (rel.dependency === "provides_care") {
        all.push(`${noun} ${vr()} that ${pronoun} provided care for ${possessive} ${label}.`);
      } else if (rel.dependency === "receives_care") {
        all.push(`${noun} ${vr()} that ${pronoun} received care from ${possessive} ${label}.`);
      }
    }
  }

  // ── Concentration ─────────────────────────────────────────────────────────
  if (categoryKey === "concentration") {
    const flags = getSDRaw<{ cannotSustain?: boolean; severeImpairment?: boolean }>(table, catIdx, "_flags");
    const flagVr = makeVerbRotator();
    if (flags.cannotSustain)    all.push(`${noun} ${flagVr()} that ${pronoun} ${wasBe} unable to sustain attention.`);
    if (flags.severeImpairment) all.push(`${noun} ${flagVr()} severe cognitive impairment.`);

    for (const { key, vocab } of CONCENTRATION_VOCAB) {
      const data = getSDRaw<ConcentrationSD>(table, catIdx, key);
      const vr = makeVerbRotator();
      const sents = sentencesForSubdomain(data, vocab, subj, vr);
      all.push(...sents);

      if (sents.length === 0) continue;

      if (data.durationCapacity) {
        all.push(`${noun} ${vr()} that ${pronoun} ${wasBe} able to maintain attention for ${data.durationCapacity}.`);
      }
      if (data.fatigueOnset) {
        all.push(`${noun} ${vr()} that fatigue onset occurred after ${data.fatigueOnset}.`);
      }
      if (data.memoryIssues) {
        const types = data.memoryIssueType?.length
          ? ` affecting ${listJoin(data.memoryIssueType.map(s => s.toLowerCase()))} memory`
          : "";
        all.push(`${noun} ${vr()} that ${pronoun} experienced memory difficulties${types}.`);
      }
      if (data.studyAbility) {
        const support = data.studySupport ? ` with ${data.studySupport}` : "";
        all.push(`${noun} ${vr()} that ${pronoun} ${be} able to engage in study or training${support}.`);
      }
    }
  }

  // ── Adaptation / Employability ────────────────────────────────────────────
  if (categoryKey === "adaptation") {
    const flags = getSDRaw<{ notWorking?: boolean; notSeekingWork?: boolean }>(table, catIdx, "_flags");
    const vr = makeVerbRotator();

    if (flags.notWorking)     all.push(`${noun} ${vr()} that ${pronoun} ${wasBe} not currently working.`);
    if (flags.notSeekingWork) all.push(`${noun} ${vr()} that ${pronoun} ${wasBe} not seeking work.`);

    const EMPLOYMENT_SUBDOMAINS: Array<{ key: string; label: string }> = [
      { key: "currentWork",  label: "currently"                },
      { key: "workCapacity", label: "in terms of work capacity" },
      { key: "volunteering", label: "in a volunteer capacity"   },
      { key: "jobSeeking",   label: "in terms of job-seeking"   },
    ];

    for (const { key, label } of EMPLOYMENT_SUBDOMAINS) {
      const d = getSDRaw<EmployabilitySubdomainEntry>(table, catIdx, key);
      const hasSomething = !!(
        d.employmentStatus || d.hoursPerWeek || d.jobTypeHistory ||
        d.workAttemptsSinceInjury || d.barrierTypes?.length || d.barriers ||
        d.inconsistentHistoryFlag || d.lastEmployment || d.preInjuryComparison
      );
      if (!hasSomething) continue;

      if (d.employmentStatus) {
        const statusText = EMPLOYMENT_STATUS_TEXT[d.employmentStatus] ?? d.employmentStatus.replace(/_/g, " ");
        all.push(`${noun} ${vr()} that ${pronoun} ${wasBe} ${statusText} ${label}.`);
      }
      if (d.hoursPerWeek) {
        all.push(`${noun} ${vr()} that ${pronoun} worked ${d.hoursPerWeek} hours per week.`);
      }
      if (d.jobTypeHistory) {
        all.push(`${noun} ${vr()} a history of employment as ${d.jobTypeHistory}.`);
      }
      if (d.workAttemptsSinceInjury) {
        all.push(endSentence(`${noun} ${vr()} that ${d.workAttemptsSinceInjury}`));
      }
      if (d.barrierTypes?.length || d.barriers) {
        const items = d.barrierTypes?.length
          ? listJoin(d.barrierTypes.map(b => b.toLowerCase()))
          : (d.barriers ?? "");
        if (items) {
          all.push(`${noun} ${vr()} barriers to employment, including ${items}.`);
        } else {
          all.push(`${noun} ${vr()} barriers to employment.`);
        }
      }
      if (d.inconsistentHistoryFlag) {
        all.push(`${noun} ${vr()} that ${possessive} work history was inconsistent.`);
      }
      if (d.lastEmployment) {
        all.push(`${noun} ${vr()} that ${pronoun} ${wasBe} last employed ${d.lastEmployment}.`);
      }
      if (d.preInjuryComparison === "better") {
        all.push(`${noun} ${vr()} that ${possessive} employment capacity was greater before the injury.`);
      } else if (d.preInjuryComparison === "worse") {
        all.push(`${noun} ${vr()} that ${possessive} employment capacity ${wasBe} already impaired before the injury.`);
      }
      if (d.preInjuryComparisonNotes) {
        all.push(endSentence(`${noun} ${vr()} that ${d.preInjuryComparisonNotes}`));
      }
    }
  }

  return all.join(" ");
}
