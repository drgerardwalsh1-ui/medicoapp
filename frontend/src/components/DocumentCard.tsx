/**
 * DocumentCard — single ingested-document panel.
 *
 * Display only — this card is the review surface for OCR / NLP output.
 * Nothing here writes into client history; persistence is deferred until
 * extraction quality is validated against the FakeClient fixtures.
 *
 * Surfaces:
 *   - header (filename + method badge + char count)
 *   - extracted-text toggle: raw vs cleaned, with removed-line audit
 *   - spaCy NER entities (PERSON / ORG / DATE)
 *   - scispaCy biomedical entities (conditions / medications / procedures / …)
 *   - condition mentions grouped by assertion status
 *   - structured analysis JSON (collapsible)
 */

import { useEffect, useMemo, useState } from "react";
import { CollapsibleSection } from "./DocumentsSection";

export type NerEntities = {
  PERSON?: string[];
  ORG?: string[];
  DATE?: string[];
  error?: string;
};

export type SciEntities = {
  conditions?: string[];
  medications?: string[];
  procedures?: string[];
  other?: string[];
  all?: string[];
  error?: string;
};

export type RemovedLine = { line: string; reason: string };

export type ConditionMention = {
  term: string;
  status:
    | "affirmed"
    | "queried"
    | "negated"
    | "contradicted"
    | "differential"
    | "symptom_only"
    | "historical";
  snippet?: string;
};

export type StructuredDate = {
  raw: string;
  value: string;
  precision: "day" | "month" | "year";
};

export type ExtractedPerson = {
  name: string;
  role:
    | "author" | "doctor" | "gp" | "psychiatrist" | "psychologist"
    | "specialist" | "consultant" | "treating_doctor"
    | "patient" | "client" | "claimant" | "unknown";
  source_snippet?: string;
  confidence?: number;
};

export type DocumentParties = {
  doctor?: string;
  patient?: string;
  organisation?: string;
};

/**
 * Unified canonical-graph event (event_unification.rs). Produced after
 * `ClinicalEvent`s via post-processing aggregation. Reversible via
 * `source_event_ids`. Dev-only "Unified Events" panel renders these.
 */
export type UnifiedClinicalEvent = {
  canonical_id: string;
  event_type: ClinicalEvent["event_type"];
  concept: string;
  primary_date?: string | null;
  date_range?: [string, string] | null;
  date_precision?: ClinicalEvent["date_precision"];
  assertion: NonNullable<ClinicalEvent["assertion_status"]>;
  source_event_ids: string[];
  source_sections: string[];
  source_snippets: string[];
  participants: Array<{ role: string; name: string }>;
  related_event_ids: string[];
  confidence: number;
  frequency: number;
  conflict: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Canonical Clinical Event Layer item.
 *
 * Additive — produced alongside the existing extraction outputs. The
 * Event Inspector (a developer-toggle block) renders these for
 * validation; nothing in the main canonical view depends on them yet.
 */
export type ClinicalEvent = {
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
  date?: string | null;
  date_precision?: "day" | "month" | "year" | null;
  assertion_status?:
    | "affirmed" | "queried" | "negated" | "contradicted"
    | "differential" | "symptom_only" | "historical"
    | null;
  source_document_id: string;
  source_section?: string | null;
  source_snippet: string;
  page?: number | null;
  participants: Array<{ role: string; name: string }>;
  metadata?: Record<string, unknown>;
};

export type ProcessedDocument = {
  raw_text?: string;
  clean_text?: string;
  removed_lines?: RemovedLine[];
  warnings?: string[];
  document_type?: string;
  entities?: {
    conditions?: string[];
    symptoms?: string[];
    medications?: string[];
    procedures?: string[];
    organisations?: string[];
  };
  condition_mentions?: ConditionMention[];
  /** Legacy string list — kept for back-compat. Prefer `dates_struct`. */
  dates?: string[] | StructuredDate[];
  dates_struct?: StructuredDate[];
  /**
   * Deterministically extracted people (Author lines, role-labelled
   * clinicians, patient identifiers). Distinct from spaCy NER PERSON,
   * which is advisory-only and shown under "Debug raw NLP output".
   */
  people?: ExtractedPerson[];
  parties?: DocumentParties;
  /**
   * Canonical Clinical Event Layer (additive). Renders in the Event
   * Inspector only — never replaces existing fields.
   */
  clinical_events?: ClinicalEvent[];
  unified_clinical_events?: UnifiedClinicalEvent[];
  /**
   * Resolved attribution per clinical event (participant / organisation /
   * patient), populated when the canonical view is reconstructed from
   * persisted projection data (`canonicalFromExtraction`). Surfaced in the
   * "Structured analysis (JSON)" panel so attribution results survive
   * navigation. Absent on the fresh ingestion-response canonical.
   */
  attributions?: unknown[];
  /**
   * Index-document confidence (Priority 0 fix). 0.0 = clearly clinical;
   * 0.95 = explicit list phrase found; 0.55 = heuristic match.
   */
  index_confidence?: number;
};

export type IngestedDoc = {
  fileName: string;
  /**
   * INVARIANT (frontend identity contract):
   * `path` may represent a filesystem path (in-session uploads) OR the
   * projection `document_id` (rehydrated docs) depending on lifecycle
   * state. It is OVERLOADED and is display/filesystem only — it must
   * NEVER be used for backend operations. Only `documentId` is stable for
   * backend operations (delete, etc.). Kept here for display + dedup +
   * React keys.
   */
  path: string;
  /**
   * Authoritative projection document id (`documents.id`). Present only
   * for PERSISTED documents:
   *   - rehydrated  → from `DocumentSummary.id`
   *   - in-session  → from `canonical.document_id` after upload completes
   * `undefined` while an upload is in progress or for error docs (those
   * were never persisted, so they have no backend row to delete).
   * This is the ONLY field used to key document deletion.
   */
  documentId?: string;
  method: string;
  charCount: number;
  ocrAvailable: boolean;
  text?: string;
  ner?: NerEntities;
  sci?: SciEntities;
  /**
   * Output of `process_document` — canonical store including raw_text,
   * clean_text, removed_lines, grouped entities, condition_mentions, and
   * structured dates with precision.
   */
  canonical?: ProcessedDocument | unknown;
  structured?: unknown;
  error?: string;
};

/**
 * Map a projection-sourced document list (`Client.documents`, originating
 * from `getClientView().documents` / `DocumentSummary[]`) into the
 * `IngestedDoc[]` shape the UI renders. Single canonical mapper so every
 * rehydration site (lazy init + `client.id` effect + `hydrateFromView`)
 * agrees on the field mapping.
 *
 * Tolerant of BOTH shapes:
 *   - projection `DocumentSummary` (snake_case: file_name / char_count)
 *   - in-session `IngestedDoc`     (camelCase: fileName / charCount)
 * so an already-rich in-session doc round-trips losslessly while a
 * metadata-only projection row maps to a header-only card (its
 * extraction sub-views stay empty until the document is re-opened —
 * those payloads are not part of the projection view).
 */
export function toIngestedDocs(
  documents: ReadonlyArray<Record<string, unknown>> | null | undefined,
): IngestedDoc[] {
  return (documents ?? []).map((d): IngestedDoc => ({
    fileName:
      (d.fileName as string) ?? (d.file_name as string) ?? "(unnamed)",
    path: (d.path as string) ?? (d.id as string) ?? "",
    // Authoritative id for deletion: a rehydrated DocumentSummary exposes
    // `id` (= projection document id); an already-rich in-session doc may
    // carry an explicit `documentId`.
    documentId: (d.documentId as string) ?? (d.id as string) ?? undefined,
    method: (d.method as string) ?? "text",
    charCount:
      typeof d.charCount === "number"
        ? d.charCount
        : typeof d.char_count === "number"
          ? d.char_count
          : 0,
    ocrAvailable: (d.ocrAvailable as boolean) ?? false,
    text: d.text as string | undefined,
    ner: d.ner as IngestedDoc["ner"],
    sci: d.sci as IngestedDoc["sci"],
    structured: d.structured,
    canonical: d.canonical,
    error: d.error as string | undefined,
  }));
}

/**
 * One persisted document's extraction bundle, as returned by
 * `getClientExtraction` (mirrors `projection::DocumentExtraction`).
 */
export type DocumentExtractionInput = {
  document_id: string;
  file_name?: string | null;
  raw_text?: string | null;
  clean_text?: string | null;
  clinical_events?: unknown[];
  attributions?: unknown[];
};

/**
 * Reconstruct a `ProcessedDocument` (the `doc.canonical` shape the card
 * renders) from PERSISTED projection data — the verbatim
 * `clinical_events` plus the document's stored `raw_text` / `clean_text`.
 *
 * This is reconstruction, NOT reprocessing: it re-shapes already-stored
 * `ClinicalEvent` records into the summary views the card expects (no
 * OCR, no NLP, no rule pipeline re-run). Every summary list is derived
 * deterministically from the event_type + concept + assertion_status +
 * snippet + participants already on each event.
 *
 * Intentionally NOT reconstructed (see goal-4 decisions):
 *   - NER / scispaCy raw output (transient, spaCy-derived, advisory)
 *   - unified_clinical_events (dev-only rollup; would duplicate Rust
 *     `unify_events` logic — the underlying events survive regardless)
 */
export function canonicalFromExtraction(
  ext: DocumentExtractionInput,
): ProcessedDocument {
  const events = (ext.clinical_events ?? []) as ClinicalEvent[];

  const uniq = (xs: string[]): string[] => Array.from(new Set(xs.filter(Boolean)));
  const conceptsOf = (...types: ClinicalEvent["event_type"][]): string[] =>
    uniq(events.filter((e) => types.includes(e.event_type)).map((e) => e.concept));

  const conditionMentions: ConditionMention[] = events
    .filter((e) => e.event_type === "diagnosis")
    .map((e) => ({
      term: e.concept,
      status: (e.assertion_status ?? "affirmed") as ConditionMention["status"],
      snippet: e.source_snippet,
    }));

  const datesStruct: StructuredDate[] = events
    .filter((e) => e.event_type === "document_date")
    .map((e) => ({
      raw: e.source_snippet || e.concept,
      value: e.date ?? e.concept,
      precision: (e.date_precision ?? "day") as StructuredDate["precision"],
    }));

  const people: ExtractedPerson[] = events
    .filter((e) => e.event_type === "person")
    .map((e) => ({
      name: e.concept,
      role: (e.participants?.[0]?.role ?? "unknown") as ExtractedPerson["role"],
      source_snippet: e.source_snippet,
    }));

  const DOCTOR_ROLES = new Set([
    "author", "doctor", "gp", "psychiatrist", "psychologist",
    "specialist", "consultant", "treating_doctor",
  ]);
  const PATIENT_ROLES = new Set(["patient", "client", "claimant"]);
  const organisations = conceptsOf("organisation");
  const parties: DocumentParties = {
    doctor: people.find((p) => DOCTOR_ROLES.has(p.role))?.name,
    patient: people.find((p) => PATIENT_ROLES.has(p.role))?.name,
    organisation: organisations[0],
  };

  return {
    raw_text: ext.raw_text ?? undefined,
    clean_text: ext.clean_text ?? undefined,
    entities: {
      conditions: conceptsOf("diagnosis"),
      symptoms: conceptsOf("symptom"),
      medications: conceptsOf("medication_mention"),
      procedures: conceptsOf("procedure", "investigation_mention"),
      organisations,
    },
    condition_mentions: conditionMentions,
    dates_struct: datesStruct,
    people,
    parties,
    clinical_events: events,
    // Attribution rows preserved on the canonical blob so they survive
    // navigation (surfaced in the Structured analysis JSON panel).
    attributions: ext.attributions ?? [],
  };
}

const METHOD_META: Record<string, { label: string; cls: string }> = {
  text:        { label: "Text layer", cls: "bg-emerald-100 text-emerald-800" },
  ocr:         { label: "OCR",        cls: "bg-orange-100 text-orange-800" },
  text_sparse: { label: "Sparse text", cls: "bg-amber-100 text-amber-800" },
  empty:       { label: "No content", cls: "bg-rose-100 text-rose-800" },
  error:       { label: "Error",      cls: "bg-red-100 text-red-800" },
};

function Chips({ values, cls }: { values: string[]; cls: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v, i) => (
        <span
          key={i}
          className={`text-xs px-2 py-0.5 rounded border ${cls}`}
        >
          {v}
        </span>
      ))}
    </div>
  );
}

function NerBlock({ ner }: { ner?: NerEntities }) {
  if (!ner) return null;
  if (ner.error) {
    return (
      <div className="px-4 py-2 text-xs text-red-700">
        ⚠ NER error: {ner.error}
      </div>
    );
  }
  const groups: Array<[string, string[] | undefined, string]> = [
    ["People",        ner.PERSON, "bg-emerald-50 text-emerald-800 border-emerald-200"],
    ["Organisations", ner.ORG,    "bg-violet-50 text-violet-800 border-violet-200"],
    ["Dates",         ner.DATE,   "bg-sky-50 text-sky-800 border-sky-200"],
  ];
  const any = groups.some(([, v]) => v && v.length);
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Raw spaCy NER candidates
        <span className="ml-2 normal-case text-[10px] text-slate-400 font-normal">
          post-filtered, but still treat as advisory
        </span>
      </div>
      {!any && (
        <div className="text-[11px] text-slate-400 italic">
          No entities detected.
        </div>
      )}
      {groups.map(([label, values, cls]) =>
        values && values.length ? (
          <div key={label} className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-600">
              {label} <span className="text-slate-400">({values.length})</span>
            </div>
            <Chips values={values} cls={cls} />
          </div>
        ) : null
      )}
    </div>
  );
}

function SciBlock({ sci }: { sci?: SciEntities }) {
  if (!sci) return null;
  if (sci.error) {
    return (
      <div className="px-4 py-2 text-xs text-red-700">
        ⚠ scispaCy error: {sci.error}
      </div>
    );
  }
  const groups: Array<[string, string[] | undefined, string]> = [
    ["Conditions",  sci.conditions,  "bg-rose-50 text-rose-800 border-rose-200"],
    ["Medications", sci.medications, "bg-orange-50 text-orange-800 border-orange-200"],
    ["Procedures",  sci.procedures,  "bg-blue-50 text-blue-800 border-blue-200"],
    ["Other",       sci.other,       "bg-slate-50 text-slate-700 border-slate-200"],
  ];
  const any = groups.some(([, v]) => v && v.length);
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Raw scispaCy candidates
        <span className="ml-2 normal-case text-[10px] text-slate-400 font-normal">
          unfiltered model output; canonical view above
        </span>
      </div>
      {!any && (
        <div className="text-[11px] text-slate-400 italic">
          No biomedical entities detected.
        </div>
      )}
      {groups.map(([label, values, cls]) =>
        values && values.length ? (
          <div key={label} className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-600">
              {label} <span className="text-slate-400">({values.length})</span>
            </div>
            <Chips values={values} cls={cls} />
          </div>
        ) : null
      )}
    </div>
  );
}

// ── Assertion-status pills ──────────────────────────────────────────────

const STATUS_STYLE: Record<ConditionMention["status"], string> = {
  affirmed:     "bg-emerald-50 text-emerald-800 border-emerald-200",
  queried:      "bg-amber-50 text-amber-800 border-amber-200",
  negated:      "bg-slate-100 text-slate-600 border-slate-200 line-through",
  contradicted: "bg-rose-50 text-rose-800 border-rose-200",
  differential: "bg-sky-50 text-sky-800 border-sky-200",
  symptom_only: "bg-violet-50 text-violet-800 border-violet-200",
  historical:   "bg-yellow-50 text-yellow-800 border-yellow-200",
};

function MentionsBlock({ mentions }: { mentions?: ConditionMention[] }) {
  if (!mentions || mentions.length === 0) return null;
  const buckets = new Map<ConditionMention["status"], ConditionMention[]>();
  for (const m of mentions) {
    const list = buckets.get(m.status) ?? [];
    list.push(m);
    buckets.set(m.status, list);
  }
  const order: ConditionMention["status"][] = [
    "affirmed", "queried", "differential", "contradicted",
    "negated", "historical", "symptom_only",
  ];
  return (
    <div className="border-t px-4 py-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Condition mentions
      </div>
      {order.map((status) => {
        const items = buckets.get(status);
        if (!items || items.length === 0) return null;
        return (
          <div key={status} className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-600 capitalize">
              {status.replace("_", " ")}{" "}
              <span className="text-slate-400">({items.length})</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {items.map((m, i) => (
                <span
                  key={i}
                  title={m.snippet ?? ""}
                  className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLE[status]}`}
                >
                  {m.term}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Event Inspector (developer-only) ──────────────────────────────────
// The Event Inspector is a validation surface for the Canonical
// Clinical Event Layer. It is gated by a localStorage flag
// (`medico.devMode === "1"`) so it doesn't appear in normal use.

function readDevMode(): boolean {
  try {
    return localStorage.getItem("medico.devMode") === "1";
  } catch {
    return false;
  }
}

const EVENT_TYPE_STYLE: Record<ClinicalEvent["event_type"], string> = {
  diagnosis:             "bg-rose-50 text-rose-800 border-rose-200",
  symptom:               "bg-violet-50 text-violet-800 border-violet-200",
  medication_mention:    "bg-orange-50 text-orange-800 border-orange-200",
  procedure:             "bg-blue-50 text-blue-800 border-blue-200",
  investigation_mention: "bg-indigo-50 text-indigo-800 border-indigo-200",
  organisation:          "bg-violet-50 text-violet-800 border-violet-200",
  person:                "bg-emerald-50 text-emerald-800 border-emerald-200",
  document_date:         "bg-sky-50 text-sky-800 border-sky-200",
};

function EventInspector({ events, docId }: { events?: ClinicalEvent[]; docId: string }) {
  const [show, setShow] = useState<boolean>(() => readDevMode());
  useEffect(() => {
    // Pick up changes to the toggle (other cards may flip it).
    const onStorage = () => setShow(readDevMode());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  if (!show) return null;
  if (!events || events.length === 0) {
    return (
      <CollapsibleSection
        docId={docId}
        sectionId="event-inspector"
        title="Event Inspector"
        kind="debug"
        className="border-t"
        summary={
          <>
            Event Inspector
            <span className="ml-2 text-[10px] text-slate-400">
              (canonical clinical event layer — additive)
            </span>
          </>
        }
      >
        <div className="px-4 py-2 text-[11px] text-slate-400 italic">
          No clinical events produced for this document.
        </div>
      </CollapsibleSection>
    );
  }
  return (
    <CollapsibleSection
      docId={docId}
      sectionId="event-inspector"
      title="Event Inspector"
      kind="debug"
      className="border-t"
      summary={
        <>
          Event Inspector
          <span className="ml-2 text-[10px] text-slate-400">
            ({events.length} event{events.length === 1 ? "" : "s"})
          </span>
        </>
      }
    >
      <div className="px-4 py-2 max-h-96 overflow-auto">
        <table className="text-[11px] w-full">
          <thead className="text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="text-left pr-3 py-1">Type</th>
              <th className="text-left pr-3 py-1">Concept</th>
              <th className="text-left pr-3 py-1">Status</th>
              <th className="text-left pr-3 py-1">Date</th>
              <th className="text-left pr-3 py-1">Section</th>
              <th className="text-left py-1">Snippet</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {events.map((e) => (
              <tr key={e.event_id} className="border-t border-slate-100 align-top">
                <td className="pr-3 py-1">
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] ${EVENT_TYPE_STYLE[e.event_type]}`}
                  >
                    {e.event_type.replace("_", " ")}
                  </span>
                </td>
                <td className="pr-3 py-1 font-medium">{e.concept}</td>
                <td className="pr-3 py-1 text-slate-500">
                  {e.assertion_status ?? "—"}
                </td>
                <td className="pr-3 py-1 tabular-nums text-slate-500">
                  {e.date
                    ? `${e.date}${e.date_precision ? ` (${e.date_precision})` : ""}`
                    : "—"}
                </td>
                <td className="pr-3 py-1 text-slate-500">{e.source_section ?? "—"}</td>
                <td className="py-1 text-slate-500 truncate max-w-[28ch]" title={e.source_snippet}>
                  {e.source_snippet || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function UnifiedEventsPanel({ events, docId }: { events?: UnifiedClinicalEvent[]; docId: string }) {
  const [show, setShow] = useState<boolean>(() => readDevMode());
  useEffect(() => {
    const onStorage = () => setShow(readDevMode());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  if (!show) return null;
  if (!events || events.length === 0) {
    return (
      <CollapsibleSection
        docId={docId}
        sectionId="unified-events"
        title="Unified Events (debug)"
        kind="debug"
        className="border-t"
        summary={
          <>
            Unified Events (debug)
            <span className="ml-2 text-[10px] text-slate-400">
              (post-processing aggregation — empty)
            </span>
          </>
        }
      >
        <div className="px-4 py-2 text-[11px] text-slate-400 italic">
          No unified events produced for this document.
        </div>
      </CollapsibleSection>
    );
  }
  // Group by event_type for readability.
  const groups = new Map<UnifiedClinicalEvent["event_type"], UnifiedClinicalEvent[]>();
  for (const u of events) {
    const list = groups.get(u.event_type) ?? [];
    list.push(u);
    groups.set(u.event_type, list);
  }
  const order: UnifiedClinicalEvent["event_type"][] = [
    "diagnosis", "symptom", "medication_mention",
    "procedure", "investigation_mention", "person",
    "organisation", "document_date",
  ];
  return (
    <CollapsibleSection
      docId={docId}
      sectionId="unified-events"
      title="Unified Events (debug)"
      kind="debug"
      className="border-t"
      summary={
        <>
          Unified Events (debug)
          <span className="ml-2 text-[10px] text-slate-400">
            ({events.length} canonical entr{events.length === 1 ? "y" : "ies"})
          </span>
        </>
      }
    >
      <div className="px-4 py-2 space-y-3 max-h-[28rem] overflow-auto">
        {order.flatMap((t) => {
          const items = groups.get(t);
          if (!items || items.length === 0) return [];
          return [
            <div key={t}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                {t.replace("_", " ")}{" "}
                <span className="text-slate-400">({items.length})</span>
              </div>
              <table className="text-[11px] w-full">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left pr-3 py-1">Concept</th>
                    <th className="text-left pr-3 py-1">Assertion</th>
                    <th className="text-left pr-3 py-1">Freq</th>
                    <th className="text-left pr-3 py-1">Dates</th>
                    <th className="text-left pr-3 py-1">Sections</th>
                    <th className="text-left py-1">Conflict</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {items.map((u) => (
                    <tr
                      key={u.canonical_id}
                      className="border-t border-slate-100 align-top"
                      title={`Sources: ${u.source_event_ids.join(", ")}\nRelated: ${u.related_event_ids.join(", ")}`}
                    >
                      <td className="pr-3 py-1 font-medium">{u.concept}</td>
                      <td className="pr-3 py-1 text-slate-500">{u.assertion}</td>
                      <td className="pr-3 py-1 tabular-nums">{u.frequency}</td>
                      <td className="pr-3 py-1 tabular-nums text-slate-500">
                        {u.primary_date
                          ? u.date_range && u.date_range[0] !== u.date_range[1]
                            ? `${u.primary_date} (${u.date_range[0]} – ${u.date_range[1]})`
                            : `${u.primary_date}${u.date_precision ? ` (${u.date_precision})` : ""}`
                          : "—"}
                      </td>
                      <td className="pr-3 py-1 text-slate-500">
                        {u.source_sections.length === 0
                          ? "—"
                          : u.source_sections.join(", ")}
                      </td>
                      <td className="py-1">
                        {u.conflict ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200">
                            conflict
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          ];
        })}
      </div>
    </CollapsibleSection>
  );
}

function PeopleBlock({
  people,
  parties,
}: {
  people?: ExtractedPerson[];
  parties?: DocumentParties;
}) {
  const hasPeople = !!people && people.length > 0;
  const hasParties =
    !!parties &&
    !!(parties.doctor || parties.patient || parties.organisation);
  if (!hasPeople && !hasParties) return null;
  return (
    <div className="border-t px-4 py-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        People &amp; parties
      </div>
      {hasParties && (
        <div className="text-[11px] text-slate-600 space-y-0.5">
          {parties?.doctor && (
            <div>
              <span className="font-semibold text-slate-700">Doctor:</span>{" "}
              {parties.doctor}
            </div>
          )}
          {parties?.patient && (
            <div>
              <span className="font-semibold text-slate-700">Patient:</span>{" "}
              {parties.patient}
            </div>
          )}
          {parties?.organisation && (
            <div>
              <span className="font-semibold text-slate-700">Organisation:</span>{" "}
              {parties.organisation}
            </div>
          )}
        </div>
      )}
      {hasPeople && (
        <div className="flex flex-wrap gap-1.5">
          {people!.map((p, i) => (
            <span
              key={i}
              title={p.source_snippet ?? ""}
              className="text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200"
            >
              {p.name}
              <span className="ml-1 text-[10px] text-slate-500">
                ({p.role.replace("_", " ")})
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SymptomsBlock({ symptoms }: { symptoms?: string[] }) {
  if (!symptoms || symptoms.length === 0) return null;
  return (
    <div className="border-t px-4 py-3 space-y-1">
      <div className="text-[11px] font-semibold text-slate-600">
        Symptoms / complaints <span className="text-slate-400">({symptoms.length})</span>
      </div>
      <Chips values={symptoms} cls="bg-violet-50 text-violet-800 border-violet-200" />
    </div>
  );
}

function DatesBlock({ dates }: { dates?: StructuredDate[] }) {
  if (!dates || dates.length === 0) return null;
  return (
    <div className="border-t px-4 py-3 space-y-1">
      <div className="text-[11px] font-semibold text-slate-600">
        Dates <span className="text-slate-400">({dates.length})</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {dates.map((d, i) => (
          <span
            key={i}
            title={`raw: ${d.raw}`}
            className="text-xs px-2 py-0.5 rounded border bg-sky-50 text-sky-800 border-sky-200"
          >
            {d.value}
            <span className="ml-1 text-[10px] text-slate-400">({d.precision})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TextToggle({
  rawText,
  cleanText,
  removedLines,
  warnings,
  docId,
}: {
  rawText?: string;
  cleanText?: string;
  removedLines?: RemovedLine[];
  warnings?: string[];
  docId: string;
}) {
  const [mode, setMode] = useState<"clean" | "raw">("clean");
  const hasBoth = !!(rawText && cleanText) && rawText !== cleanText;
  const shown = mode === "clean" ? cleanText ?? rawText ?? "" : rawText ?? cleanText ?? "";
  return (
    <div className="border-t">
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-xs">
        <span className="font-semibold text-slate-700">Extracted text</span>
        {hasBoth && (
          <div className="inline-flex rounded border border-slate-200 overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => setMode("clean")}
              className={`px-2 py-0.5 ${mode === "clean" ? "bg-slate-200 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Cleaned (used for NLP)
            </button>
            <button
              type="button"
              onClick={() => setMode("raw")}
              className={`px-2 py-0.5 border-l border-slate-200 ${mode === "raw" ? "bg-slate-200 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Raw
            </button>
          </div>
        )}
        {removedLines && removedLines.length > 0 && (
          <span
            className="ml-auto text-[11px] text-amber-700"
            title="Lines removed during cleaning — expand the audit below to inspect"
          >
            {removedLines.length} line{removedLines.length === 1 ? "" : "s"} removed
          </span>
        )}
      </div>
      {warnings && warnings.length > 0 && (
        <div className="px-4 py-1 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      <div className="px-4 py-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-relaxed font-serif text-slate-800">
        {shown}
      </div>
      {removedLines && removedLines.length > 0 && (
        <CollapsibleSection
          docId={docId}
          sectionId="removed-noise-audit"
          title="Removed noise audit"
          kind="text"
          className="border-t"
          summaryClassName="cursor-pointer text-[11px] text-slate-500 px-4 py-2 select-none"
          summary={<>Removed noise audit ({removedLines.length})</>}
        >
          <ul className="px-4 py-2 text-[11px] text-slate-600 space-y-0.5 max-h-48 overflow-auto">
            {removedLines.map((rl, i) => (
              <li key={i}>
                <span className="text-slate-400">[{rl.reason}]</span>{" "}
                <span className="text-slate-700">{rl.line}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </div>
  );
}

/**
 * Body for the "Structured analysis (JSON)" section. Stringification is
 * memoised on the `blob` identity so repeated re-renders (while open) never
 * re-serialise. Combined with the parent CollapsibleSection's lazy mount,
 * the stringify cost is paid at most once per open, per document.
 */
function StructuredJsonBody({ blob }: { blob: unknown }) {
  const json = useMemo(() => {
    try {
      return JSON.stringify(blob, null, 2) ?? "";
    } catch {
      return "/* structure not serialisable */";
    }
  }, [blob]);
  return (
    <pre className="bg-slate-900 text-emerald-300 text-[11px] leading-snug px-4 py-3 overflow-auto max-h-80 m-0">
      {json}
    </pre>
  );
}

export default function DocumentCard({
  doc,
  onRemove,
  canRemove = true,
}: {
  doc: IngestedDoc;
  onRemove?: () => void;
  /**
   * When false, the × is shown but disabled — used to block deletion of
   * a document whose upload is still in flight (no document id yet), which
   * would otherwise race the backend persist.
   */
  canRemove?: boolean;
}) {
  const meta =
    METHOD_META[doc.method] ?? { label: doc.method, cls: "bg-slate-100 text-slate-700" };

  // Stable per-card section namespace. `documentId` is the authoritative id;
  // fall back to the overloaded `path` for in-flight / error docs that have no
  // backend row yet. Used only to namespace section keys in the registry.
  const docId = doc.documentId ?? doc.path;

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-slate-50 flex-wrap">
        <strong className="text-sm flex-1 truncate">{doc.fileName}</strong>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${meta.cls}`}>
          {meta.label}
        </span>
        <span className="text-[11px] text-slate-500">
          {doc.charCount.toLocaleString()} chars
        </span>
        {doc.ocrAvailable && doc.method !== "text" && (
          <span className="text-[11px] text-orange-700">OCR</span>
        )}
        {onRemove && (
          <button
            onClick={canRemove ? onRemove : undefined}
            disabled={!canRemove}
            className={
              "text-lg leading-none px-1 " +
              (canRemove
                ? "text-slate-400 hover:text-slate-700"
                : "text-slate-200 cursor-not-allowed")
            }
            title={canRemove ? "Remove" : "Finishing upload…"}
          >
            ×
          </button>
        )}
      </div>

      {doc.error && (
        <div className="px-4 py-2 text-xs text-red-700 border-b bg-red-50">
          ⚠ {doc.error}
        </div>
      )}

      {/* Pull structured-store data out of doc.canonical (output of
          process_document). Falls back gracefully when missing — older
          ingestion runs only have doc.text. */}
      {(() => {
        const canon = (doc.canonical as ProcessedDocument | undefined) ?? undefined;
        const rawText = canon?.raw_text ?? doc.text;
        const cleanText = canon?.clean_text ?? doc.text;
        const docType = canon?.document_type;
        const meds = canon?.entities?.medications;
        const procs = canon?.entities?.procedures;
        const orgs = canon?.entities?.organisations;
        return (
          <>
            {docType && (
              <div className="px-4 py-1 text-[11px] text-slate-500 border-t">
                Type: <span className="font-semibold text-slate-700">{docType}</span>
              </div>
            )}

            {/* CANONICAL — people / parties, confirmed/queried/
                contradicted diagnoses, symptoms, medications,
                treatments/procedures, dates. These are the
                trustworthy view. */}
            <PeopleBlock people={canon?.people} parties={canon?.parties} />
            <MentionsBlock mentions={canon?.condition_mentions} />
            <SymptomsBlock symptoms={canon?.entities?.symptoms} />
            {meds && meds.length > 0 && (
              <div className="border-t px-4 py-3 space-y-1">
                <div className="text-[11px] font-semibold text-slate-600">
                  Medications <span className="text-slate-400">({meds.length})</span>
                </div>
                <Chips values={meds} cls="bg-orange-50 text-orange-800 border-orange-200" />
              </div>
            )}
            {procs && procs.length > 0 && (
              <div className="border-t px-4 py-3 space-y-1">
                <div className="text-[11px] font-semibold text-slate-600">
                  Treatments / procedures <span className="text-slate-400">({procs.length})</span>
                </div>
                <Chips values={procs} cls="bg-blue-50 text-blue-800 border-blue-200" />
              </div>
            )}
            {orgs && orgs.length > 0 && (
              <div className="border-t px-4 py-3 space-y-1">
                <div className="text-[11px] font-semibold text-slate-600">
                  Organisations <span className="text-slate-400">({orgs.length})</span>
                </div>
                <Chips values={orgs} cls="bg-violet-50 text-violet-800 border-violet-200" />
              </div>
            )}
            <DatesBlock dates={canon?.dates_struct} />

            {/* RAW NLP — kept available for debugging but collapsed and
                labelled as advisory. Display order: canonical above,
                raw below, so the trustworthy data wins the user's eye. */}
            {(doc.ner || doc.sci) && (
              <CollapsibleSection
                docId={docId}
                sectionId="debug-nlp"
                title="Debug raw NLP output"
                kind="debug"
                className="border-t group"
                summary={
                  <>
                    Debug raw NLP output
                    <span className="ml-2 text-[10px] text-slate-400">
                      (unfiltered spaCy / scispaCy candidates — advisory only)
                    </span>
                  </>
                }
                bodyClassName="divide-y"
              >
                <NerBlock ner={doc.ner} />
                <SciBlock sci={doc.sci} />
              </CollapsibleSection>
            )}

            {/* Event Inspector — additive validation surface for the
                Canonical Clinical Event Layer. Visible only when the
                developer toggle (`medico.devMode === "1"`) is on. */}
            <EventInspector events={canon?.clinical_events} docId={docId} />

            {/* Unified Events (debug) — post-processing aggregation of
                raw clinical events into a per-document canonical graph.
                Also gated by the developer toggle. */}
            <UnifiedEventsPanel events={canon?.unified_clinical_events} docId={docId} />

            {(rawText || cleanText) && (
              <TextToggle
                rawText={rawText}
                cleanText={cleanText}
                removedLines={canon?.removed_lines}
                warnings={canon?.warnings}
                docId={docId}
              />
            )}
          </>
        );
      })()}

      {/* structured analysis */}
      {(() => {
        // Single source of truth: prefer the AUTHORITATIVE canonical blob
        // (derived from clinical_events — incl. the resolved patient/parties)
        // over the legacy `structured` store, which is retained only as a
        // fallback for documents not yet reprocessed. This removes the
        // duplicate patient-resolution path: the panel can no longer display a
        // stale/blank `structured.parties.patient` that diverges from canonical.
        const blob = doc.canonical ?? doc.structured;
        if (!blob) return null;
        return (
          <CollapsibleSection
            docId={docId}
            sectionId="structured-json"
            title="Structured analysis (JSON)"
            kind="json"
            className="border-t"
            summaryClassName="cursor-pointer text-xs text-slate-500 px-4 py-2 select-none"
          >
            {/* Lazy: this body only mounts while the section is open, so the
                stringify below never runs for a collapsed card. Memoised per
                `blob` so re-renders while open don't re-serialise. */}
            <StructuredJsonBody blob={blob} />
          </CollapsibleSection>
        );
      })()}
    </div>
  );
}
