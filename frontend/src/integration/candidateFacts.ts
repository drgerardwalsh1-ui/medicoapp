// ── Candidate facts — ingestion → interview bridge (Phase 3) ──────────────────
// Maps the deterministically-extracted ClinicalEvents the backend already
// persists (clinical_events.rs, surfaced via get_client_extraction) onto
// ontology concepts, so a fact found in the brief surfaces in the interview
// as a CONFIRM-OR-CONTEST chip ("echo, don't re-ask") instead of forcing the
// clinician to retype it.
//
// Zero-hallucination doctrine (PRD Pillar 3):
//   • The mapping is deterministic (omnibox.matchConcept) and FAILS CLOSED:
//     a concept that doesn't strongly match an ontology node is never guessed
//     into a section — it lands in the verification queue as "unmapped".
//   • No candidate is auto-asserted into the interview record. Each carries
//     its verbatim source snippet + locator and waits for the clinician to
//     confirm or contest during the interview.
//   • Presence is read from the extractor's assertion_status, never inferred.

import { matchConcept } from "../engine/omnibox";

// Mirrors the persisted ClinicalEvent (clinical_events.rs / DocumentCard.ts).
export type ExtractedClinicalEvent = {
  event_id: string;
  event_type:
    | "diagnosis"
    | "symptom"
    | "medication_mention"
    | "procedure"
    | "investigation_mention"
    | "organisation"
    | "person"
    | "document_date";
  concept: string;
  raw_concept?: string;
  date?: string | null;
  date_precision?: "day" | "month" | "year" | null;
  assertion_status?:
    | "affirmed" | "queried" | "negated" | "contradicted"
    | "differential" | "symptom_only" | "historical" | null;
  source_document_id: string;
  source_section?: string | null;
  source_snippet: string;
  page?: number | null;
  participants?: Array<{ role: string; name: string }>;
};

// Canonical diagnosis name (entity_clean.rs CONDITION_SYNONYMS output) → DSM
// diagnosis id (data/dsm5.ts). Deterministic; unmatched names fail closed.
const DIAGNOSIS_NAME_TO_ID: Record<string, string> = {
  "post-traumatic stress disorder": "ptsd",
  "complex post-traumatic stress disorder": "ptsd",
  "acute stress disorder": "asd",
  "adjustment disorder": "adj",
  "adjustment disorders": "adj",
  "major depressive disorder": "mdd",
  "persistent depressive disorder": "pdd",
  "generalised anxiety disorder": "gad",
  "generalized anxiety disorder": "gad",
  "panic disorder": "pan",
  "social anxiety disorder": "sad",
  "agoraphobia": "agor",
  "specific phobia": "spho",
  "obsessive-compulsive disorder": "ocd",
  "body dysmorphic disorder": "bdd",
  "alcohol use disorder": "aud",
  "cannabis use disorder": "cud",
  "opioid use disorder": "oud",
  "borderline personality disorder": "bpd",
  "anorexia nervosa": "an",
  "bulimia nervosa": "bn",
  "binge-eating disorder": "bed",
  "bipolar i disorder": "bd1",
  "bipolar ii disorder": "bd2",
};

export type CandidatePresence = "present" | "absent" | "uncertain";

export type CandidateFact = {
  /** Stable across re-runs (= ClinicalEvent.event_id) — dedupe key. */
  candidateId: string;
  kind: "symptom" | "diagnosis" | "medication" | "other";
  /** Set when kind=symptom and the concept mapped to an ontology node. */
  symptomTypeId?: string;
  /** Set when kind=diagnosis and the name mapped to a DSM diagnosis. */
  diagnosisId?: string;
  /** Human label for display (mapped label, else the raw concept). */
  label: string;
  concept: string;
  presence: CandidatePresence;
  /** Extractor said this was historical → pre-injury epoch hint. */
  preInjuryHint: boolean;
  /** True once mapped to an ontology/DSM node; false → verification queue. */
  mapped: boolean;
  provenance: {
    documentId: string;
    section?: string;
    snippet: string;
    page?: number;
    author?: string;
    date?: string;
  };
};

function presenceFromStatus(status: ExtractedClinicalEvent["assertion_status"]): {
  presence: CandidatePresence;
  preInjuryHint: boolean;
} {
  switch (status) {
    case "negated":
      return { presence: "absent", preInjuryHint: false };
    case "historical":
      // A pre-injury / past mention — present, but flagged to the pre-injury
      // epoch so it is never silently counted as a current symptom.
      return { presence: "present", preInjuryHint: true };
    case "queried":
    case "differential":
    case "contradicted":
      return { presence: "uncertain", preInjuryHint: false };
    case "affirmed":
    case "symptom_only":
    default:
      return { presence: "present", preInjuryHint: false };
  }
}

function authorOf(ev: ExtractedClinicalEvent): string | undefined {
  const clinician = ev.participants?.find(
    (p) => p.role !== "patient" && p.role !== "claimant",
  );
  return clinician?.name ?? undefined;
}

/**
 * Build candidate facts from one document's (or a case's) extracted clinical
 * events. Only symptom and diagnosis events become interview candidates;
 * medications/procedures/investigations are carried as "other" for the
 * documents-reviewed surfaces, not the symptom sections. Deduped by
 * candidateId (stable event ids).
 */
export function buildCandidateFacts(
  events: readonly ExtractedClinicalEvent[],
): CandidateFact[] {
  const byId = new Map<string, CandidateFact>();

  for (const ev of events) {
    const { presence, preInjuryHint } = presenceFromStatus(ev.assertion_status);
    const provenance = {
      documentId: ev.source_document_id,
      section: ev.source_section ?? undefined,
      snippet: ev.source_snippet,
      page: ev.page ?? undefined,
      author: authorOf(ev),
      date: ev.date ?? undefined,
    };

    let candidate: CandidateFact;
    if (ev.event_type === "symptom") {
      const m = matchConcept(ev.concept);
      candidate = {
        candidateId: ev.event_id,
        kind: "symptom",
        symptomTypeId: m?.symptomTypeId,
        label: m?.label ?? ev.concept,
        concept: ev.concept,
        presence,
        preInjuryHint,
        mapped: m !== null,
        provenance,
      };
    } else if (ev.event_type === "diagnosis") {
      const id = DIAGNOSIS_NAME_TO_ID[ev.concept.toLowerCase().trim()];
      candidate = {
        candidateId: ev.event_id,
        kind: "diagnosis",
        diagnosisId: id,
        label: ev.concept,
        concept: ev.concept,
        presence,
        preInjuryHint,
        mapped: id !== undefined,
        provenance,
      };
    } else if (ev.event_type === "medication_mention") {
      candidate = {
        candidateId: ev.event_id,
        kind: "medication",
        label: ev.concept,
        concept: ev.concept,
        presence,
        preInjuryHint,
        mapped: false, // medications never auto-place into symptom sections
        provenance,
      };
    } else {
      continue; // organisations / people / dates / procedures: not interview candidates
    }

    // Dedupe: keep first; later identical-id events are re-runs.
    if (!byId.has(candidate.candidateId)) byId.set(candidate.candidateId, candidate);
  }

  return [...byId.values()];
}

/** Candidates that mapped to a symptom concept, indexed by symptomTypeId. */
export function candidatesBySymptom(
  candidates: readonly CandidateFact[],
): Map<string, CandidateFact[]> {
  const out = new Map<string, CandidateFact[]>();
  for (const c of candidates) {
    if (c.kind !== "symptom" || !c.symptomTypeId) continue;
    const list = out.get(c.symptomTypeId) ?? [];
    list.push(c);
    out.set(c.symptomTypeId, list);
  }
  return out;
}

/** Candidates needing manual triage: unmapped symptoms + all diagnoses. */
export function verificationQueue(
  candidates: readonly CandidateFact[],
): CandidateFact[] {
  return candidates.filter(
    (c) =>
      (c.kind === "symptom" && !c.mapped) ||
      c.kind === "diagnosis" ||
      c.kind === "medication",
  );
}
