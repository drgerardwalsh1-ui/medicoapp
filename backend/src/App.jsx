import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { TauriAPI } from "./api/tauriCommands";

// ── Shared style helpers ──────────────────────────────────────────────────────
const pill = (bg, color, text) => (
  <span style={{
    background: bg, color, padding: "2px 8px", borderRadius: 3,
    fontSize: "0.78em", fontWeight: 600, whiteSpace: "nowrap",
  }}>{text}</span>
);

const ok   = (t) => pill("#e8f5e9", "#2e7d32", `✔ ${t}`);
const err  = (t) => pill("#fce4ec", "#c62828", `✘ ${t}`);
const warn = (t) => pill("#fff8e1", "#f57f17", `⚠ ${t}`);

// ── Method badge metadata ─────────────────────────────────────────────────────
const METHOD_META = {
  text:        { label: "Text layer", bg: "#e8f5e9", color: "#2e7d32" },
  ocr:         { label: "OCR",        bg: "#fff3e0", color: "#e65100" },
  text_sparse: { label: "Sparse text",bg: "#fff8e1", color: "#f57f17" },
  empty:       { label: "No content", bg: "#fce4ec", color: "#c62828" },
};

// ── Entity filtering (deterministic, no inference) ────────────────────────────
//
// Takes raw spaCy PERSON/ORG/DATE arrays and returns a cleaned object.
// Rules are pattern-based only — no AI, no interpretation.

// Prefixes that may precede a real name without being a name themselves
const PERSON_TITLE_PREFIXES = new Set([
  "dr", "mr", "mrs", "ms", "miss", "prof", "sr", "jr", "rev", "hon",
]);

// Job titles and role words that should not appear as standalone person entries
const PERSON_NOISE_WORDS = new Set([
  "paramedic", "dispatcher", "psychologist", "inspector", "practitioner",
  "nurse", "physician", "therapist", "consultant", "coordinator",
  "officer", "manager", "specialist", "director", "superintendent",
  "sergeant", "constable", "detective", "analyst", "assessor",
  "physiotherapist", "occupational", "radiologist", "surgeon", "doctor",
  "registrar", "associate", "professor", "clerk", "receptionist",
  "administrator", "supervisor", "worker", "operator", "technician",
  "police", "counsel", "barrister", "solicitor", "lawyer", "judge",
  "magistrate", "commissioner", "secretary", "minister", "general",
  "pathologist", "neurologist", "cardiologist", "oncologist",
  "neuropsychologist", "osteopath", "chiropractor", "dentist",
  "optometrist", "podiatrist", "dietitian", "midwife",
  "the", "a", "an", "of", "for", "in", "at", "to", "and",
]);

function isValidPerson(entry) {
  const words = entry.trim().split(/\s+/);
  // Must be 1–3 words
  if (words.length === 0 || words.length > 3) return false;

  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));

  // Non-title words — these carry the "name" burden
  const nonTitleWords = lowerWords.filter((w) => !PERSON_TITLE_PREFIXES.has(w));

  // If every non-title word is a known noise/role word → reject
  if (
    nonTitleWords.length > 0 &&
    nonTitleWords.every((w) => PERSON_NOISE_WORDS.has(w))
  ) return false;

  // At least one non-title word must start with a capital and be ≥ 2 chars
  const hasProperName = words.some((w, i) => {
    if (PERSON_TITLE_PREFIXES.has(lowerWords[i])) return false;
    return /^[A-Z]/.test(w) && w.length >= 2;
  });
  if (!hasProperName) return false;

  // All words must be capitalised (or a known title prefix)
  return words.every((w, i) =>
    /^[A-Z]/.test(w) || PERSON_TITLE_PREFIXES.has(lowerWords[i])
  );
}

// Single-word entries that are clearly not organisations
const ORG_NOISE_SINGLE = new Set([
  "nsw", "vic", "qld", "sa", "wa", "tas", "nt", "act",
  "control", "general", "inspector", "director", "manager", "officer",
  "the", "a",
]);

function isValidOrg(entry) {
  const trimmed = entry.trim();
  if (trimmed.length < 3) return false;
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    const lower = trimmed.toLowerCase();
    if (ORG_NOISE_SINGLE.has(lower)) return false;
    // Bare 2–3 letter state/acronym abbreviation
    if (/^[A-Z]{2,3}$/.test(trimmed)) return false;
    // All lowercase single word
    if (trimmed === trimmed.toLowerCase()) return false;
  }
  return true;
}

function deduplicateOrgs(orgs) {
  // Longer (more specific) entries first
  const sorted = [...orgs].sort((a, b) => b.length - a.length);
  const kept = [];
  for (const org of sorted) {
    const lower = org.toLowerCase();
    const covered = kept.some((k) => {
      const lk = k.toLowerCase();
      return lk.includes(lower) || lower.includes(lk);
    });
    if (!covered) kept.push(org);
  }
  return kept;
}

const MONTH_RE  = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const YEAR_RE   = /\b(19|20)\d{2}\b/;
const NUMDATE_RE = /\b\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?\b/;

const VAGUE_DATE_RE = [
  /^(months?|weeks?|days?|years?|hours?)$/i,
  /^(monthly|weekly|daily|yearly|annually|annual)$/i,
  /^\d+[-\s]*(week|month|day|year|hour)s?$/i,
  /^(the\s+|a\s+|an\s+)/i,
  /^(next|last|previous|upcoming|recent)\b/i,
  /^(morning|afternoon|evening|night|midnight|noon)$/i,
  /^(today|tomorrow|yesterday|now|then)$/i,
  /^\d{1,2}\s*(st|nd|rd|th)?\s*$/i,  // bare day ordinals only — 4-digit years must pass
];

function isValidDate(entry) {
  const t = entry.trim();
  if (!t) return false;
  if (VAGUE_DATE_RE.some((p) => p.test(t))) return false;
  return YEAR_RE.test(t) || MONTH_RE.test(t) || NUMDATE_RE.test(t);
}

/**
 * Filter raw spaCy entities into cleaned categories.
 * Pure function — deterministic, no side effects, no interpretation.
 * @param {{ PERSON: string[], ORG: string[], DATE: string[] }} raw
 * @returns {{ people: string[], organisations: string[], dates: string[] }}
 */
function filterEntities(raw) {
  if (!raw || raw.error) return { people: [], organisations: [], dates: [] };
  const people        = (raw.PERSON ?? []).filter(isValidPerson);
  const orgsFiltered  = (raw.ORG    ?? []).filter(isValidOrg);
  const organisations = deduplicateOrgs(orgsFiltered);
  const dates         = (raw.DATE   ?? []).filter(isValidDate);
  return { people, organisations, dates };
}

// ── structuredAnalysis merge layer ───────────────────────────────────────────
//
// Merges scispaCy (high-confidence biomedical NER) into the Rust-extracted
// structuredAnalysis so the final JSON contains the best of both sources.
//
// Rules:
//   • scispaCy is treated as PRIMARY for conditions / medications / procedures
//   • Rust-extracted entries are kept only when NOT already represented in
//     scispaCy output (union, scispaCy wins on overlap)
//   • Evidence from scispaCy gets confidence: 0.95, source: "scispaCy"
//   • Noise / invalid entries are filtered out before merging

// Medication normalisations: brand/partial → generic (lowercase keys)
const MED_NORMALISE = {
  aropax:       "paroxetine",
  paxil:        "paroxetine",
  paroxetin:    "paroxetine",
  zoloft:       "sertraline",
  prozac:       "fluoxetine",
  lexapro:      "escitalopram",
  cipralex:     "escitalopram",
  effexor:      "venlafaxine",
  cymbalta:     "duloxetine",
  pristiq:      "desvenlafaxine",
  remeron:      "mirtazapine",
  seroquel:     "quetiapine",
  zyprexa:      "olanzapine",
  lyrica:       "pregabalin",
  neurontin:    "gabapentin",
  valium:       "diazepam",
  rivotril:     "clonazepam",
  xanax:        "alprazolam",
  ativan:       "lorazepam",
  endone:       "oxycodone",
  nurofen:      "ibuprofen",
  panadol:      "paracetamol",
  voltaren:     "diclofenac",
};

function normaliseMed(name) {
  const lk = name.toLowerCase().trim();
  return MED_NORMALISE[lk] ?? lk;
}

// Terms that look like scispaCy conditions but are symptoms/descriptors/noise
const CONDITION_NOISE = new Set([
  "tearful", "distressed", "upset", "crying", "worried", "nervous",
  "pain", "ache", "aching", "tired", "fatigue", "fatigued",
  "stress", "stressed", "sad", "low mood",
  "sleep", "insomnia", "nightmares",
  "conflicting entities", "island", "assessment island",
]);

function isValidCondition(term) {
  if (!term || term.length < 3) return false;
  const lk = term.toLowerCase().trim();
  if (CONDITION_NOISE.has(lk)) return false;
  // Reject entries with obvious noise tokens
  if (/\bisland\b/i.test(term)) return false;
  if (/\bconflict/i.test(term)) return false;
  if (/\bentit/i.test(term)) return false;    // "Entities"
  // Single bare words that are clearly not diagnoses (unless capitalised acronym)
  if (!/\s/.test(term) && !/^[A-Z]{2,}$/.test(term) && lk === lk.replace(/[a-z]/g, "")) return false;
  return true;
}

// Terms that look like procedures but are clearly invalid
function isValidProcedure(term) {
  if (!term || term.length < 3) return false;
  const lk = term.toLowerCase().trim();
  if (/\bisland\b/i.test(term)) return false;
  if (/\bconflict/i.test(term)) return false;
  if (/\bentit/i.test(term)) return false;
  // Reject pure single common words that Rust produces as coarse matches
  if (["therapy", "assessment", "examination", "treatment", "review"].includes(lk)) return false;
  return true;
}

/**
 * Merge scispaCy biomedical entities into the Rust-extracted structuredAnalysis.
 *
 * @param {object|null} rustAnalysis   Parsed JSON from extractStructuredData
 * @param {object|null} sciEntities    Parsed JSON from extractNlpEntities
 * @param {string}      docId          Filename / document identifier
 * @returns {object}                   Merged structuredAnalysis object
 */
function mergeAnalysis(rustAnalysis, sciEntities, docId) {
  // Always return a valid object — never null
  const base = rustAnalysis ?? {
    doc_id: docId, document_type: "unknown", is_index_document: false,
    parties: { patient: "", doctor: "", organisation: "" },
    dates: [], key_findings: [],
    injuries_or_conditions: [], medications: [], procedures: [],
    timeline_events: [], source_text_snippets: [],
    _evidence: { conditions: [], medications: [], procedures: [] },
  };

  // Index documents carry no clinical fields — skip merge
  if (base.is_index_document) return base;

  // If scispaCy is unavailable or errored, return Rust data unchanged
  if (!sciEntities || sciEntities.error) return base;

  // ── Helper: check if a term is already represented in a list (substring match)
  function isRepresented(term, list) {
    const lk = term.toLowerCase();
    return list.some((existing) => {
      const le = existing.toLowerCase();
      return le === lk || le.includes(lk) || lk.includes(le);
    });
  }

  // ── Conditions ──────────────────────────────────────────────────────────────
  const sciConditions = (sciEntities.conditions ?? []).filter(isValidCondition);
  const rustConditions = (base.injuries_or_conditions ?? []).filter(isValidCondition);

  // Start with scispaCy conditions (highest confidence), add Rust ones not covered
  const mergedConditions = [...sciConditions];
  for (const c of rustConditions) {
    if (!isRepresented(c, mergedConditions)) mergedConditions.push(c);
  }

  // Evidence: scispaCy entries first with high confidence
  const sciCondEvidence = sciConditions.map((v) => ({
    value: v,
    source_document_id: docId,
    source_snippet: "",
    page: null,
    confidence: 0.95,
    source: "scispaCy",
  }));
  const rustCondEvidence = (base._evidence?.conditions ?? []).filter(
    (e) => !isRepresented(e.value ?? "", sciConditions)
  );
  const mergedCondEvidence = [...sciCondEvidence, ...rustCondEvidence];

  // ── Medications ─────────────────────────────────────────────────────────────
  const sciMeds = (sciEntities.medications ?? []).map(normaliseMed).filter(Boolean);
  const rustMeds = (base.medications ?? []).map(normaliseMed).filter(Boolean);

  // Deduplicate: build a set of normalised names, preserve first-seen form
  const medsSeen = new Set();
  const mergedMeds = [];
  for (const m of [...sciMeds, ...rustMeds]) {
    const norm = normaliseMed(m);
    if (!medsSeen.has(norm)) {
      medsSeen.add(norm);
      mergedMeds.push(m); // keep the original form (may have proper casing)
    }
  }

  const sciMedEvidence = sciMeds.map((v) => ({
    value: v,
    source_document_id: docId,
    source_snippet: "",
    page: null,
    confidence: 0.95,
    source: "scispaCy",
  }));
  const rustMedEvidence = (base._evidence?.medications ?? []).filter(
    (e) => !medsSeen.has(normaliseMed(e.value ?? ""))
  );
  const mergedMedEvidence = [...sciMedEvidence, ...rustMedEvidence];

  // ── Procedures ──────────────────────────────────────────────────────────────
  const sciProcs = (sciEntities.procedures ?? []).filter(isValidProcedure);
  const rustProcs = (base.procedures ?? []).filter(isValidProcedure);

  const mergedProcs = [...sciProcs];
  for (const p of rustProcs) {
    if (!isRepresented(p, mergedProcs)) mergedProcs.push(p);
  }

  const sciProcEvidence = sciProcs.map((v) => ({
    value: v,
    source_document_id: docId,
    source_snippet: "",
    page: null,
    confidence: 0.95,
    source: "scispaCy",
  }));
  const rustProcEvidence = (base._evidence?.procedures ?? []).filter(
    (e) => !isRepresented(e.value ?? "", sciProcs)
  );
  const mergedProcEvidence = [...sciProcEvidence, ...rustProcEvidence];

  return {
    ...base,
    injuries_or_conditions: mergedConditions,
    medications: mergedMeds,
    procedures: mergedProcs,
    _evidence: {
      conditions: mergedCondEvidence,
      medications: mergedMedEvidence,
      procedures: mergedProcEvidence,
    },
  };
}

// ── Clipboard helpers (module-level, no closures over App state) ─────────────

/**
 * Write text to the system clipboard.
 * Primary:  navigator.clipboard.writeText (Tauri's tauri:// is a secure origin).
 * Fallback: hidden-textarea + document.execCommand (deprecated but reliable in
 *           all Chromium / WKWebView environments when the primary fails).
 */
async function writeToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (primaryErr) {
      console.warn(
        "[clipboard] navigator.clipboard.writeText failed — trying execCommand fallback:",
        primaryErr
      );
    }
  }
  // execCommand fallback — deprecated but universally supported in WebViews
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;" +
    "opacity:0;pointer-events:none;";
  document.body.appendChild(el);
  el.focus();
  el.select();
  const succeeded = document.execCommand("copy");
  document.body.removeChild(el);
  if (!succeeded) throw new Error("execCommand('copy') returned false");
}

/**
 * Return a deep-copy of debugState with PII redacted.
 *
 * Redacted:    person names → [PERSON_n] placeholders, DOB patterns, ID numbers.
 * Preserved:   clinical terms, medications, organisations, conflict snippets.
 *
 * Redaction is applied ONLY inside this function.
 * The original debugState object is never mutated.
 */
function redactForClipboard(state) {
  if (!state) return state;

  const nameMap = new Map();   // original name → stable placeholder
  let nameSeq   = 0;

  function redactName(name) {
    if (!name) return name;
    if (!nameMap.has(name)) nameMap.set(name, `[PERSON_${++nameSeq}]`);
    return nameMap.get(name);
  }

  // ── NER raw (PERSON / ORG / DATE arrays) ────────────────────────────────
  const nerRaw = state.nerRaw && !state.nerRaw.error
    ? { ...state.nerRaw, PERSON: (state.nerRaw.PERSON ?? []).map(redactName) }
    : state.nerRaw;

  // ── NER cleaned (people / organisations / dates arrays) ─────────────────
  const nerCleaned = state.nerCleaned
    ? { ...state.nerCleaned, people: (state.nerCleaned.people ?? []).map(redactName) }
    : state.nerCleaned;

  // ── scispaCy (people array + people_roles object keys) ───────────────────
  const sciEntities = state.sciEntities && !state.sciEntities.error
    ? {
        ...state.sciEntities,
        people: (state.sciEntities.people ?? []).map(redactName),
        people_roles: Object.fromEntries(
          Object.entries(state.sciEntities.people_roles ?? {}).map(
            ([name, role]) => [redactName(name), role]
          )
        ),
      }
    : state.sciEntities;

  // ── Structured analysis — DOB and numeric-ID patterns via JSON string pass ─
  let structuredAnalysis = state.structuredAnalysis;
  if (structuredAnalysis && typeof structuredAnalysis === "object") {
    try {
      let s = JSON.stringify(structuredAnalysis);
      // Dates of birth
      s = s.replace(
        /(?:dob|date\s+of\s+birth)\s*[":\s,]\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/gi,
        "[DOB REDACTED]"
      );
      // 10-digit identifiers (Medicare, DVA, etc.)
      s = s.replace(/\b\d{10}\b/g, "[ID REDACTED]");
      // Claim / file / reference numbers
      s = s.replace(
        /\b(?:claim|file|case|ref(?:erence)?)\s*(?:no\.?|number|#)?\s*[:\s]\s*[A-Z0-9\-]{4,}/gi,
        "[REF REDACTED]"
      );
      structuredAnalysis = JSON.parse(s);
    } catch { /* leave unchanged if JSON round-trip fails */ }
  }

  return { ...state, nerRaw, nerCleaned, sciEntities, structuredAnalysis };
}

// ── DebugPanel ────────────────────────────────────────────────────────────────
function DebugPanel({ report, onClose, onCopy, copied }) {
  if (!report) return null;

  const r    = report;
  const diag = r.diagnosis ?? {};
  const env  = r.environment ?? {};
  const file = r.file ?? {};
  const text = r.text_extraction ?? {};
  const ocr  = r.ocr_pipeline_probe ?? {};

  const Row = ({ label, children }) => (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6, fontSize: "0.88em" }}>
      <span style={{ minWidth: 160, color: "#888", flexShrink: 0 }}>{label}</span>
      <span>{children}</span>
    </div>
  );

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: "0.82em", textTransform: "uppercase",
        letterSpacing: "0.06em", color: "#555", marginBottom: 8, borderBottom: "1px solid #eee",
        paddingBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <strong style={{ fontSize: "0.95em" }}>OCR Diagnostic Report</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCopy} style={{ fontSize: "0.82em", padding: "3px 10px",
            border: "1px solid #bbb", borderRadius: 4, cursor: "pointer", background: "#fff" }}>
            {copied === true ? "✔ Copied" : copied === "error" ? "⚠ Failed" : "Copy Debug"}
          </button>
          <button onClick={onClose} style={{ fontSize: "0.82em", padding: "3px 10px",
            border: "1px solid #bbb", borderRadius: 4, cursor: "pointer", background: "#fff" }}>
            Close
          </button>
        </div>
      </div>

      <div style={{ border: "1px solid #e0e0e0", borderRadius: 6, padding: "16px 18px",
        background: "#fafafa", fontSize: "0.88em" }}>

        <Section title="Quick Diagnosis">
          <Row label="OCR feature compiled">
            {r.ocr_feature_compiled ? ok("yes") : err("no — rebuild with --features ocr")}
          </Row>
          <Row label="tesseract in PATH">
            {env.tesseract?.found
              ? ok(env.tesseract.version || "found")
              : err("not found — brew install tesseract")}
          </Row>
          <Row label="pdftoppm in PATH">
            {env.pdftoppm?.found
              ? ok(env.pdftoppm.version || "found")
              : err("not found — brew install poppler")}
          </Row>
          <Row label="tessdata directory">
            {env.tessdata?.found
              ? ok(env.tessdata.path || "found")
              : err("not found — brew install tesseract")}
          </Row>
          <Row label="OCR will run on this file">
            {diag.ocr_will_run ? ok("yes") : warn("no")}
          </Row>
        </Section>

        <Section title="File">
          <Row label="Path">{file.path}</Row>
          <Row label="Exists">{file.exists ? ok("yes") : err("no — file not found")}</Row>
          <Row label="Extension">{file.extension || "(none)"}</Row>
          <Row label="Size">{(file.size_bytes ?? 0).toLocaleString()} bytes</Row>
          <Row label="Is PDF">{file.is_pdf ? ok("yes") : warn("no — only PDFs get full OCR")}</Row>
        </Section>

        <Section title="Text extraction (pdf-extract / DOCX parser)">
          <Row label="Success">{text.success ? ok("yes") : err(text.error ?? "failed")}</Row>
          <Row label="Total chars">{(text.char_count ?? 0).toLocaleString()}</Row>
          <Row label="Non-whitespace chars">{(text.non_ws_char_count ?? 0).toLocaleString()}</Row>
          <Row label="Sparse (< 50 non-ws)">
            {text.sparse ? warn("yes — OCR triggered") : ok("no — text layer sufficient")}
          </Row>
          {text.preview && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: "0.78em", color: "#888", marginBottom: 4 }}>Text preview (first 400 chars):</div>
              <pre style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 4,
                padding: 10, fontSize: "0.82em", maxHeight: 140, overflow: "auto",
                whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                {text.preview}
              </pre>
            </div>
          )}
        </Section>

        {file.is_pdf && (
          <Section title="PDF OCR pipeline probe (pdftoppm at 72 DPI)">
            {ocr.applicable === false
              ? <Row label="Status">{warn(ocr.reason)}</Row>
              : <>
                  <Row label="pdftoppm found">{ocr.pdftoppm_found ? ok("yes") : err("no")}</Row>
                  <Row label="pdftoppm exit code">
                    {ocr.exit_code === 0 ? ok(`${ocr.exit_code}`) : err(`${ocr.exit_code ?? "n/a"}`)}
                  </Row>
                  <Row label="Pages generated">
                    {ocr.page_count > 0
                      ? ok(`${ocr.page_count} page images`)
                      : err("0 — pdftoppm produced no images")}
                  </Row>
                  {ocr.stderr && (
                    <Row label="stderr">
                      <code style={{ color: "#c62828", fontSize: "0.85em" }}>{ocr.stderr}</code>
                    </Row>
                  )}
                  {ocr.pages?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: "0.78em", color: "#888", marginBottom: 4 }}>Page images:</div>
                      {ocr.pages.map((p, i) => (
                        <div key={i} style={{ fontSize: "0.8em", color: "#555" }}>
                          {p.filename} — {p.size_bytes.toLocaleString()} bytes
                        </div>
                      ))}
                    </div>
                  )}
                </>
            }
          </Section>
        )}

        <details>
          <summary style={{ cursor: "pointer", fontSize: "0.82em", color: "#888", userSelect: "none" }}>
            Raw JSON report
          </summary>
          <pre style={{ background: "#111", color: "#0f0", padding: 12, borderRadius: 4,
            fontSize: "0.75em", maxHeight: 300, overflow: "auto", marginTop: 8, lineHeight: 1.5 }}>
            {JSON.stringify(report, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}

// ── Entity display components ─────────────────────────────────────────────────

const ENTITY_STYLE = {
  PERSON: { bg: "#e3f2fd", color: "#0d47a1", border: "#90caf9" },
  ORG:    { bg: "#f3e5f5", color: "#4a148c", border: "#ce93d8" },
  DATE:   { bg: "#e8f5e9", color: "#1b5e20", border: "#a5d6a7" },
};

// One labelled row of chips for a single entity category
function EntityCategoryRow({ label, values, styleKey }) {
  if (!values || values.length === 0) return null;
  const s = ENTITY_STYLE[styleKey];
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 7 }}>
      <span style={{ fontSize: "0.73em", fontWeight: 700, minWidth: 84,
        color: s.color, flexShrink: 0, paddingTop: 3 }}>
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {values.map((v, i) => (
          <span key={i} style={{
            background: s.bg, color: s.color, border: `1px solid ${s.border}`,
            borderRadius: 4, padding: "1px 7px", fontSize: "0.78em", lineHeight: 1.6,
          }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

// One labelled panel — either raw spaCy output or cleaned output
function EntitiesBlock({ title, entities, isRaw, isRunning }) {
  const categories = isRaw
    ? [
        { label: "Person",       values: entities?.PERSON,        key: "PERSON" },
        { label: "Organisation", values: entities?.ORG,           key: "ORG"    },
        { label: "Date",         values: entities?.DATE,          key: "DATE"   },
      ]
    : [
        { label: "Person",       values: entities?.people,        key: "PERSON" },
        { label: "Organisation", values: entities?.organisations,  key: "ORG"    },
        { label: "Date",         values: entities?.dates,         key: "DATE"   },
      ];

  const hasAny = categories.some((c) => (c.values?.length ?? 0) > 0);

  return (
    <div style={{ flex: 1, padding: "10px 14px", minWidth: 0 }}>
      {/* Panel heading */}
      <div style={{ fontSize: "0.72em", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.06em", color: "#666", marginBottom: 9,
        paddingBottom: 5, borderBottom: "1px solid #eee" }}>
        {title}
      </div>

      {isRunning ? (
        <div style={{ fontSize: "0.8em", color: "#bbb" }}>⏳ Detecting…</div>
      ) : !hasAny ? (
        <div style={{ fontSize: "0.8em", color: "#ccc" }}>No entities found.</div>
      ) : (
        categories.map((c) => (
          <EntityCategoryRow
            key={c.key}
            label={c.label}
            values={c.values}
            styleKey={c.key}
          />
        ))
      )}
    </div>
  );
}

// Dual panel: Raw on the left, Cleaned on the right, separated by a divider.
// Placed above the extracted text so both views are immediately visible.
function EntitiesDualPanel({ rawEntities, cleanedEntities, isRunning }) {
  if (!isRunning && !rawEntities) return null;

  if (rawEntities?.error) {
    return (
      <div style={{ padding: "9px 14px", borderTop: "1px solid #efefef",
        fontSize: "0.81em", color: "#c62828" }}>
        ⚠ NER error: {rawEntities.error}
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid #efefef" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <EntitiesBlock
          title="Entities Detected (Raw)"
          entities={rawEntities}
          isRaw={true}
          isRunning={isRunning}
        />
        {/* Vertical divider */}
        <div style={{ width: 1, background: "#efefef", flexShrink: 0 }} />
        <EntitiesBlock
          title="Entities Detected (Cleaned)"
          entities={cleanedEntities}
          isRaw={false}
          isRunning={isRunning}
        />
      </div>
    </div>
  );
}

// ── ScispaCyPanel ─────────────────────────────────────────────────────────────
// Displays biomedical entities extracted by the scispaCy en_core_sci_md model.
// Six colour-coded category buckets + conflict detection + role-person links.
// Keys match the JSON keys returned by the nlp_service.py /extract endpoint.

const SCI_CATEGORY_STYLE = {
  conditions:    { bg: "#fce4ec", color: "#b71c1c", border: "#f48fb1", label: "Conditions"    },
  medications:   { bg: "#fff3e0", color: "#e65100", border: "#ffcc80", label: "Medications"   },
  procedures:    { bg: "#e3f2fd", color: "#0d47a1", border: "#90caf9", label: "Procedures"    },
  people:        { bg: "#e8f5e9", color: "#1b5e20", border: "#a5d6a7", label: "People"        },
  organisations: { bg: "#ede7f6", color: "#4527a0", border: "#b39ddb", label: "Organisations" },
  roles:         { bg: "#fff8e1", color: "#f57f17", border: "#ffe082", label: "Roles"         },
};

const SCI_CATEGORY_ORDER = [
  "conditions", "medications", "procedures", "people", "organisations", "roles",
];

function SciCategorySection({ categoryKey, values }) {
  if (!values || values.length === 0) return null;
  const s = SCI_CATEGORY_STYLE[categoryKey];
  const [open, setOpen] = useState(true);

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 7, width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: "2px 0",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: "0.72em", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: s.color, minWidth: 90 }}>
          {s.label}
        </span>
        <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`,
          borderRadius: 10, padding: "0 6px", fontSize: "0.7em", fontWeight: 700 }}>
          {values.length}
        </span>
        <span style={{ fontSize: "0.7em", color: "#bbb", marginLeft: "auto" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5, paddingLeft: 2 }}>
          {values.map((v, i) => (
            <span key={i} style={{
              background: s.bg, color: s.color, border: `1px solid ${s.border}`,
              borderRadius: 4, padding: "1px 8px", fontSize: "0.78em", lineHeight: 1.65,
            }}>
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictsSection({ conflicts }) {
  const [open, setOpen] = useState(true);
  if (!conflicts || conflicts.length === 0) return null;

  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed #ffd54f", paddingTop: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 7, width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: "2px 0",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: "0.72em", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "#f57f17" }}>
          ⚠ Diagnostic Conflicts
        </span>
        <span style={{ background: "#fff8e1", color: "#f57f17", border: "1px solid #ffe082",
          borderRadius: 10, padding: "0 6px", fontSize: "0.7em", fontWeight: 700 }}>
          {conflicts.length}
        </span>
        <span style={{ fontSize: "0.7em", color: "#bbb", marginLeft: "auto" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{
              background: "#fffde7", border: "1px solid #ffe082",
              borderRadius: 4, padding: "7px 10px", fontSize: "0.77em",
            }}>
              <div style={{ fontWeight: 700, color: "#b71c1c", marginBottom: 4 }}>
                {c.condition}
              </div>
              <div style={{ color: "#2e7d32", marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>Affirmed: </span>
                <span style={{ fontStyle: "italic" }}>{c.affirmed_by}</span>
              </div>
              <div style={{ color: "#c62828" }}>
                <span style={{ fontWeight: 600 }}>Disputed: </span>
                <span style={{ fontStyle: "italic" }}>{c.disputed_by}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScispaCyPanel({ sciEntities, isSciRunning }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!isSciRunning && !sciEntities) return null;

  if (sciEntities?.error) {
    return (
      <div style={{ padding: "9px 14px", borderTop: "1px solid #efefef",
        fontSize: "0.81em", color: "#c62828" }}>
        ⚠ scispaCy error: {sciEntities.error}
      </div>
    );
  }

  const total = isSciRunning ? 0 : SCI_CATEGORY_ORDER.reduce(
    (sum, cat) => sum + (sciEntities?.[cat]?.length ?? 0), 0
  );

  // Annotate people with linked roles: "Dr Smith" → "Dr Smith (psychiatrist)"
  const annotatedPeople = (sciEntities?.people ?? []).map((name) => {
    const role = sciEntities?.people_roles?.[name];
    return role ? `${name} (${role})` : name;
  });

  return (
    <div style={{ borderTop: "1px solid #efefef", padding: "10px 14px" }}>
      {/* Section heading */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: "0.72em", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "#666" }}>
          Medical Entities (scispaCy)
        </span>
        {!isSciRunning && total > 0 && (
          <span style={{ background: "#ede7f6", color: "#4527a0", borderRadius: 10,
            padding: "0 7px", fontSize: "0.7em", fontWeight: 700, border: "1px solid #b39ddb" }}>
            {total} found
          </span>
        )}
        {!isSciRunning && sciEntities && (
          <button
            onClick={() => setShowRaw((v) => !v)}
            style={{ marginLeft: "auto", fontSize: "0.72em", color: "#888",
              background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {showRaw ? "Hide raw JSON" : "Raw JSON"}
          </button>
        )}
      </div>

      {isSciRunning ? (
        <div style={{ fontSize: "0.8em", color: "#bbb" }}>⏳ Extracting biomedical entities…</div>
      ) : total === 0 ? (
        <div style={{ fontSize: "0.8em", color: "#ccc" }}>No biomedical entities detected.</div>
      ) : (
        <>
          {SCI_CATEGORY_ORDER.map((cat) => (
            <SciCategorySection
              key={cat}
              categoryKey={cat}
              values={cat === "people" ? annotatedPeople : sciEntities?.[cat]}
            />
          ))}
          <ConflictsSection conflicts={sciEntities?.conflicts} />
        </>
      )}

      {showRaw && sciEntities && (
        <details open style={{ marginTop: 8 }}>
          <summary style={{ display: "none" }} />
          <pre style={{ background: "#111", color: "#0f0", padding: "10px 12px",
            borderRadius: 4, fontSize: "0.74em", maxHeight: 280, overflow: "auto",
            margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(sciEntities, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── FileListPanel ─────────────────────────────────────────────────────────────
// Sidebar-style list of all currently loaded documents.
function FileListPanel({ files, onRemove, onScrollTo }) {
  if (files.length === 0) return null;

  return (
    <div style={{ marginBottom: 20, border: "1px solid #e0e0e0", borderRadius: 8,
      background: "#fafafa", overflow: "hidden" }}>

      <div style={{ padding: "10px 14px", borderBottom: "1px solid #e8e8e8",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.82em", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.06em", color: "#555" }}>
          Loaded documents
        </span>
        <span style={{ fontSize: "0.8em", color: "#aaa" }}>
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </div>

      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        {files.map((f) => {
          const meta = f.content
            ? (METHOD_META[f.content.method] ?? { label: f.content.method, bg: "#f5f5f5", color: "#555" })
            : { label: "…", bg: "#f5f5f5", color: "#aaa" };

          const stillWorking = f.isProcessing || f.isNerRunning || f.isSciRunning;
          return (
            <div key={f.id}
              style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px",
                background: "#fff", border: "1px solid #ececec", borderRadius: 6,
                cursor: f.content ? "pointer" : "default" }}
              onClick={() => f.content && onScrollTo(f.id)}
              title={f.path}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Filename */}
                <span style={{ flex: 1, fontSize: "0.88em", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.filename}
                </span>

                {/* Status / method badge */}
                {stillWorking
                  ? <span style={{ fontSize: "0.72em", color: "#4a90d9", flexShrink: 0,
                      fontWeight: 600 }}>
                      {STAGE_META[f.stage ?? "queued"]?.progress ?? 0}%
                    </span>
                  : <span style={{ background: meta.bg, color: meta.color, padding: "1px 7px",
                      borderRadius: 3, fontSize: "0.75em", fontWeight: 600, flexShrink: 0 }}>
                      {meta.label}
                    </span>
                }

                {/* Remove */}
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(f.id); }}
                  style={{ border: "none", background: "none", cursor: "pointer",
                    color: "#bbb", fontSize: "1.1em", padding: "0 2px",
                    lineHeight: 1, flexShrink: 0 }}
                  title="Remove document"
                >×</button>
              </div>

              {/* Compact progress bar — only while working */}
              {stillWorking && <ProgressBar stage={f.stage ?? "queued"} dense />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Progress bar component ────────────────────────────────────────────────────
//
// Displays a smoothly animating horizontal bar plus the current stage label.
// Each stage maps to a target % so the bar moves forward at deterministic
// points in the pipeline (no fake incrementing — honest, step-based progress).
//
// Stages (in order):
//   queued         0%
//   reading       15%   — file read + format parse starting
//   extracting    40%   — pdf-extract / docx / OCR in progress
//   entities      70%   — spaCy NER + scispaCy + Rust structured extract
//   merging       92%
//   done         100%
const STAGE_META = {
  queued:     { label: "Queued…",               progress: 0   },
  reading:    { label: "Reading file…",         progress: 15  },
  extracting: { label: "Extracting text (OCR)…",progress: 40  },
  entities:   { label: "Analysing entities…",   progress: 70  },
  merging:    { label: "Merging results…",      progress: 92  },
  done:       { label: "Complete",              progress: 100 },
  error:      { label: "Error",                 progress: 100 },
};

function ProgressBar({ stage, dense }) {
  const meta = STAGE_META[stage] ?? STAGE_META.queued;
  const isError = stage === "error";
  const isDone  = stage === "done";

  // Colour ramp: blue while active → green when complete → red on error
  const fillColour = isError ? "#c62828"
                   : isDone  ? "#2e7d32"
                             : "#4a90d9";
  const fillGradient = isError ? fillColour
                    : isDone   ? fillColour
                               : `linear-gradient(90deg, #4a90d9 0%, #6fb0ec 50%, #4a90d9 100%)`;

  const height = dense ? 4 : 6;
  const showShimmer = !isError && !isDone;

  return (
    <div style={{ width: "100%" }}>
      {/* Stage label + percent row — hidden in dense mode (sidebar) */}
      {!dense && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 5, fontSize: "0.78em",
          color: isError ? "#c62828" : isDone ? "#2e7d32" : "#666",
        }}>
          <span style={{ fontWeight: 500 }}>
            {isError ? "⚠ " : isDone ? "✔ " : ""}{meta.label}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.92em", color: "#999" }}>
            {meta.progress}%
          </span>
        </div>
      )}

      {/* Bar track */}
      <div style={{
        position: "relative",
        width: "100%",
        height,
        background: "#eef1f4",
        borderRadius: height,
        overflow: "hidden",
      }}>
        {/* Fill */}
        <div style={{
          width: `${meta.progress}%`,
          height: "100%",
          background: fillGradient,
          backgroundSize: "200% 100%",
          borderRadius: height,
          transition: "width 420ms cubic-bezier(0.22, 0.61, 0.36, 1), background-color 200ms",
          animation: showShimmer
            ? "pb-shimmer 1.6s linear infinite"
            : "none",
        }} />
      </div>

      {/* Keyframes injected once per document — harmless if duplicated */}
      <style>{`
        @keyframes pb-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ── FileContentCard ───────────────────────────────────────────────────────────
// Renders a single document's extracted text, NER entities, and structured analysis.
function FileContentCard({ file, onRemove, cardRef }) {
  if (!file) return null;

  const { id, filename, content, analysis, rawEntities, cleanedEntities,
          sciEntities, isProcessing, isNerRunning, isSciRunning, stage } = file;

  // Show the progress card while any pipeline stage is still running
  const stillWorking = isProcessing || isNerRunning || isSciRunning;
  if (stillWorking) {
    return (
      <div ref={cardRef} style={{ marginBottom: 20, border: "1px solid #e0e0e0", borderRadius: 8,
        padding: "16px 20px", background: "#fff" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 10, gap: 10,
        }}>
          <strong style={{ fontSize: "0.92em", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {filename}
          </strong>
          <button
            onClick={() => onRemove(id)}
            style={{ border: "none", background: "none", cursor: "pointer",
              color: "#bbb", fontSize: "1.15em", padding: "0 2px",
              lineHeight: 1, flexShrink: 0 }}
            title="Cancel / remove"
          >×</button>
        </div>
        <ProgressBar stage={stage ?? "queued"} />
      </div>
    );
  }

  if (!content) return null;

  const meta = METHOD_META[content.method] ?? { label: content.method, bg: "#f5f5f5", color: "#333" };

  return (
    <div ref={cardRef} id={`file-card-${id}`}
      style={{ marginBottom: 20, border: "1px solid #e0e0e0", borderRadius: 8,
        overflow: "hidden", background: "#fff" }}>

      {/* ── Card header ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
        borderBottom: "1px solid #efefef", background: "#fafafa", flexWrap: "wrap" }}>

        <strong style={{ fontSize: "0.92em", flex: 1, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename}
        </strong>

        <span style={{ background: meta.bg, color: meta.color, padding: "2px 8px",
          borderRadius: 3, fontSize: "0.78em", fontWeight: 600, flexShrink: 0 }}>
          {meta.label}
        </span>

        <span style={{ fontSize: "0.78em", color: "#aaa", flexShrink: 0 }}>
          {content.charCount.toLocaleString()} chars
        </span>

        {!content.ocrAvailable && content.method !== "text" && (
          <span style={{ fontSize: "0.75em", color: "#b71c1c", flexShrink: 0 }}>
            ⚠ Rebuild with <code>--features ocr</code>
          </span>
        )}

        {content.ocrError && (
          <span style={{ fontSize: "0.75em", color: "#e65100", flexShrink: 0 }}>
            ⚠ {content.ocrError}
          </span>
        )}

        <button
          onClick={() => onRemove(id)}
          style={{ border: "none", background: "none", cursor: "pointer",
            color: "#bbb", fontSize: "1.15em", padding: "0 2px",
            lineHeight: 1, flexShrink: 0, marginLeft: 4 }}
          title="Remove document"
        >×</button>
      </div>

      {/* ── Entity panels: Raw + Cleaned — placed above the text ────────────── */}
      <EntitiesDualPanel
        rawEntities={rawEntities}
        cleanedEntities={cleanedEntities}
        isRunning={isNerRunning}
      />

      {/* ── scispaCy biomedical entity panel ─────────────────────────────────── */}
      <ScispaCyPanel sciEntities={sciEntities} isSciRunning={isSciRunning} />

      {/* ── Extracted text ───────────────────────────────────────────────────── */}
      <div style={{ padding: "14px 16px", maxHeight: 440, overflow: "auto",
        fontSize: "0.9em", lineHeight: 1.75, whiteSpace: "pre-wrap",
        wordBreak: "break-word", fontFamily: "Georgia, 'Times New Roman', serif",
        color: content.text ? "#212121" : "#bbb",
        borderTop: "1px solid #efefef" }}>
        {content.text || "No readable content found in this file."}
      </div>

      {/* ── Structured analysis (collapsible) ────────────────────────────────── */}
      {analysis && (
        <details style={{ borderTop: "1px solid #efefef" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.82em", color: "#888",
            padding: "8px 14px", userSelect: "none" }}>
            Structured analysis (JSON)
          </summary>
          <pre style={{ background: "#111", color: "#0f0", padding: "12px 16px",
            fontSize: "0.76em", maxHeight: 360, overflow: "auto", margin: 0,
            lineHeight: 1.5, borderTop: "1px solid #222" }}>
            {analysis}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  // Each entry: { id, path, filename, content, analysis, isProcessing }
  const [files, setFiles]           = useState([]);
  const [path, setPath]             = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  // Diagnostics state
  const [diagReport, setDiagReport] = useState(null);
  const [isDebugging, setIsDebugging] = useState(false);
  const [diagCopied, setDiagCopied]   = useState(false);

  // ── Debug state ─────────────────────────────────────────────────────────────
  // Populated by addFile() after every pipeline run.  Holds the full output of
  // the most-recently processed file so the Copy Debug button always has real data.
  // Shape: { timestamp, fileName, filePath, extraction, nerRaw, nerCleaned,
  //          sciEntities, structuredAnalysis }
  const [debugState, setDebugState] = useState(null);
  // Ref mirror — keeps a synchronous pointer to the latest debugState so that
  // copyDiagnostics() (an async function) never reads a stale closure value.
  const debugStateRef = useRef(null);
  debugStateRef.current = debugState;

  // Refs for scroll-to behaviour
  const cardRefs = useRef({});

  // addFileRef prevents stale closures in Tauri event listeners
  const addFileRef = useRef(null);

  // ── Deduplication guards ─────────────────────────────────────────────────────
  //
  // processingPathsRef — synchronous Set of file paths currently in-flight.
  // React state updates are batched and asynchronous; two rapid identical calls
  // (e.g. Tauri double-emit or StrictMode re-run) would both pass the
  // `files.some()` check before either state update lands.  A ref is always
  // synchronous so the second call sees the first one's lock immediately.
  //
  // dropDebounceRef — collapses duplicate drag-drop events that some macOS /
  // Tauri versions emit multiple times for a single physical drop action.
  // Any paths seen within DROP_DEBOUNCE_MS of each other are treated as one burst.
  const processingPathsRef = useRef(new Set());
  const dropDebounceRef    = useRef({ paths: new Set(), timestamp: 0 });
  const DROP_DEBOUNCE_MS   = 300;

  // ── Derived state ───────────────────────────────────────────────────────────
  const anyProcessing = files.some((f) => f.isProcessing);

  // ── Core pipeline ───────────────────────────────────────────────────────────
  async function addFile(filePath) {
    const target = (filePath || path).trim();
    if (!target) return;

    // Guard 1 — path is already present in the loaded file list (state check)
    if (files.some((f) => f.path === target)) {
      console.log(`[addFile] skip — already loaded: ${target}`);
      setPath("");
      return;
    }

    // Guard 2 — path is currently being processed (synchronous ref check —
    // catches race conditions that React state batching would miss)
    if (processingPathsRef.current.has(target)) {
      console.log(`[addFile] skip — already in-flight: ${target}`);
      return;
    }

    processingPathsRef.current.add(target);
    console.log(`[addFile] start: ${target}`);

    const id       = Date.now();
    const filename = target.split("/").pop();

    // Immediately add a placeholder so the user sees something
    setFiles((prev) => [
      ...prev,
      {
        id, path: target, filename,
        content: null, analysis: "",
        rawEntities: null, cleanedEntities: null,
        sciEntities: null,
        isProcessing: true, isNerRunning: false, isSciRunning: false,
        stage: "queued",
      },
    ]);
    setPath(""); // clear input so next file can be typed/pasted

    // Small delay so users see the "Queued" stage before it advances
    await new Promise((r) => setTimeout(r, 60));
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, stage: "reading" } : f))
    );

    try {
      // ── Step 1: extract text content ───────────────────────────────────────
      // Bump to "extracting" just before the call so the bar animates forward
      // while the (potentially slow) OCR call runs.
      await new Promise((r) => setTimeout(r, 60));
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, stage: "extracting" } : f))
      );

      const contentRaw = await TauriAPI.extractFileContents(target);
      const content    = JSON.parse(contentRaw);

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                content: {
                  text:         content.text,
                  method:       content.method,
                  charCount:    content.char_count,
                  ocrAvailable: content.ocr_available,
                  ocrError:     content.ocr_error ?? null,
                },
                isProcessing: false,
                isNerRunning: true,  // NER starts now
                isSciRunning: true,  // scispaCy starts now
                stage: "entities",
              }
            : f
        )
      );

      // ── Step 2: NER + structured analysis + scispaCy fire in parallel ────────
      const [nerResult, analysisResult, sciResult] = await Promise.allSettled([
        TauriAPI.runNer(content.text),
        TauriAPI.extractStructuredData(content.text, filename),
        TauriAPI.extractNlpEntities(content.text),
      ]);

      // NER result — keep raw and derive cleaned separately
      let rawEntities    = null;
      let cleanedEntities = null;
      if (nerResult.status === "fulfilled") {
        rawEntities     = JSON.parse(nerResult.value);
        cleanedEntities = filterEntities(rawEntities);
      } else {
        rawEntities = { error: nerResult.reason?.toString() ?? "NER failed" };
      }

      // Structured analysis result — parse Rust base output
      let rustAnalysisParsed = null;
      if (analysisResult.status === "fulfilled") {
        try { rustAnalysisParsed = JSON.parse(analysisResult.value); } catch { /* ignore */ }
      }

      // scispaCy result
      let sciEntities = null;
      if (sciResult.status === "fulfilled") {
        sciEntities = JSON.parse(sciResult.value);
      } else {
        sciEntities = { error: sciResult.reason?.toString() ?? "scispaCy failed" };
      }

      // Advance to merging stage
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, stage: "merging" } : f))
      );

      // ── Merge: scispaCy into structuredAnalysis (primary source for clinical fields)
      const mergedAnalysisParsed = mergeAnalysis(rustAnalysisParsed, sciEntities, filename);
      const analysis = mergedAnalysisParsed
        ? JSON.stringify(mergedAnalysisParsed, null, 2)
        : "Error: " + (analysisResult.reason?.toString() ?? "failed");

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, rawEntities, cleanedEntities, analysis,
                sciEntities, isNerRunning: false, isSciRunning: false,
                stage: "done" }
            : f
        )
      );

      // ── Debug state ─────────────────────────────────────────────────────────
      // Build once after ALL pipeline steps complete.  This is the single source
      // of truth that the Copy Debug button copies (with redaction applied at
      // copy-time only — this object is stored unredacted).
      const parsedAnalysis = mergedAnalysisParsed;

      const newDebugState = {
        timestamp:  new Date().toISOString(),
        fileName:   filename,
        filePath:   target,
        extraction: {
          method:       content.method,
          charCount:    content.char_count,
          ocrAvailable: content.ocr_available ?? false,
          // Store only a preview so the payload stays manageable
          textPreview:  (content.text ?? "").slice(0, 500),
        },
        nerRaw:            rawEntities,    // spaCy PERSON / ORG / DATE
        nerCleaned:        cleanedEntities, // filtered people / organisations / dates
        sciEntities,                        // scispaCy conditions / medications / etc.
        structuredAnalysis: parsedAnalysis, // rule-based structured extraction
      };

      setDebugState(newDebugState);
      console.log("[debugState] set for:", filename, newDebugState);

      console.log(`[addFile] complete: ${target}`);
    } catch (e) {
      console.error(`[addFile] error: ${target}`, e);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, analysis: "Error: " + String(e),
                isProcessing: false, isNerRunning: false, isSciRunning: false,
                stage: "error" }
            : f
        )
      );
    } finally {
      // Release the in-flight lock so the path can be re-added if the user
      // removes the file and drops it again later.
      processingPathsRef.current.delete(target);
    }
  }

  addFileRef.current = addFile;

  // ── Remove a document ───────────────────────────────────────────────────────
  function removeFile(id) {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      // Also clear the in-flight lock for this path so re-adding it later works
      if (removed) processingPathsRef.current.delete(removed.path);
      return prev.filter((f) => f.id !== id);
    });
    delete cardRefs.current[id];
  }

  // ── Scroll to a document card ───────────────────────────────────────────────
  function scrollToCard(id) {
    cardRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────
  async function runDiagnostics() {
    const target = path.trim();
    if (!target) return;
    try {
      setIsDebugging(true);
      const raw = await TauriAPI.runDiagnostics(target);
      setDiagReport(JSON.parse(raw));
    } catch (e) {
      setDiagReport({ error: String(e) });
    } finally {
      setIsDebugging(false);
    }
  }

  async function copyDiagnostics() {
    // ── 1. Source of truth: read from the ref mirror of debugState ─────────────
    //    Using the ref (not just the closure variable) guarantees we read the
    //    value that React committed most recently, even if the async onClick
    //    handler captured an older closure.
    const current = debugStateRef.current;

    // ── 2. Validation ────────────────────────────────────────────────────────────
    if (!current) {
      console.warn(
        "[Copy Debug] debugState is null — process a file first before copying"
      );
      setDiagCopied("error");
      setTimeout(() => setDiagCopied(false), 3000);
      return;
    }

    // ── 3. Redact PII (names, DOBs, IDs) — UI display is never touched ─────────
    const redacted = redactForClipboard(current);

    // ── 4. Serialize ─────────────────────────────────────────────────────────────
    const text = JSON.stringify(redacted, null, 2);

    // ── 5. Debug log — verify payload BEFORE it reaches the clipboard ───────────
    console.log("[Copy Debug] payload being copied:", text);

    // ── 6. Write to clipboard (navigator.clipboard + execCommand fallback) ───────
    try {
      await writeToClipboard(text);
      setDiagCopied(true);
      console.log("[Copy Debug] clipboard write succeeded");
    } catch (e) {
      console.error("[Copy Debug] clipboard write failed:", e);
      setDiagCopied("error");
    }
    setTimeout(() => setDiagCopied(false), 2500);
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  //
  // Design notes:
  //   - `cancelled` flag: if the component unmounts before the async
  //     registerListeners() resolves (React StrictMode unmount/remount cycle),
  //     any already-resolved listeners are immediately unregistered.
  //   - Debounce: Tauri / macOS can emit the drag-drop event more than once for
  //     a single physical drop action.  We deduplicate paths seen within
  //     DROP_DEBOUNCE_MS of each other.
  //   - Only ONE set of listeners is ever active at a time — cleanup always
  //     runs before the next mount's registerListeners() call completes.
  useEffect(() => {
    let cancelled     = false;
    let unlistenEnter = null;
    let unlistenLeave = null;
    let unlistenDrop  = null;

    async function registerListeners() {
      unlistenEnter = await listen("tauri://drag-enter", () => setIsDragOver(true));
      if (cancelled) { unlistenEnter(); return; }

      unlistenLeave = await listen("tauri://drag-leave", () => setIsDragOver(false));
      if (cancelled) { unlistenEnter(); unlistenLeave(); return; }

      unlistenDrop = await listen("tauri://drag-drop", async (event) => {
        setIsDragOver(false);
        const incoming = event.payload?.paths ?? [];
        if (incoming.length === 0) return;

        const now = Date.now();
        const db  = dropDebounceRef.current;

        // Expand any directories to their contained document files
        const expanded = (
          await Promise.all(incoming.map((p) => TauriAPI.listDirectory(p)))
        ).flat();

        const toLoad = expanded.length > 0 ? expanded : incoming;

        if (now - db.timestamp < DROP_DEBOUNCE_MS) {
          // Within the debounce window — only forward paths not yet seen this burst
          const novel = toLoad.filter((p) => !db.paths.has(p));
          novel.forEach((p) => db.paths.add(p));
          if (novel.length > 0) {
            console.log(`[drop] burst dedup — ${novel.length} novel paths`);
            novel.forEach((p) => addFileRef.current(p));
          } else {
            console.log(`[drop] burst dedup — all paths already seen, suppressed`);
          }
        } else {
          // New burst — reset the window and process all paths
          dropDebounceRef.current = { paths: new Set(toLoad), timestamp: now };
          console.log(`[drop] new burst — ${toLoad.length} path(s): ${toLoad.join(", ")}`);
          toLoad.forEach((p) => addFileRef.current(p));
        }
      });

      if (cancelled) { unlistenEnter(); unlistenLeave(); unlistenDrop(); }
    }

    registerListeners();

    return () => {
      cancelled = true;
      unlistenEnter?.();
      unlistenLeave?.();
      unlistenDrop?.();
    };
  }, []);

  // ── File picker ─────────────────────────────────────────────────────────────
  async function pickFile() {
    const selected = await open({
      multiple: true, // allow multi-select in the picker too
      filters: [{ name: "Documents", extensions: ["pdf", "docx", "txt", "md", "log"] }],
    });
    if (!selected) return;
    const selections = Array.isArray(selected) ? selected : [selected];
    selections.forEach((p) => addFileRef.current(p));
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif",
      maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 20 }}>MedicoLegal Tool</h1>

      {/* ── Drop zone ──────────────────────────────────────────────────────── */}
      <div style={{
        border: isDragOver ? "2px solid #4a90d9" : "2px dashed #ccc",
        borderRadius: 8, padding: "24px", textAlign: "center",
        background: isDragOver ? "#e8f4ff" : "#fafafa",
        transition: "border-color 0.12s ease, background 0.12s ease",
        marginBottom: 16, userSelect: "none",
      }}>
        {isDragOver ? (
          <div style={{ fontSize: "1.1em", fontWeight: 600, color: "#4a90d9" }}>
            ↓ Release to add {/* plural-aware */ ""}
          </div>
        ) : (
          <>
            <div style={{ color: "#888", marginBottom: 12, fontSize: "0.92em" }}>
              Drop documents or a folder anywhere in this window
            </div>
            <button onClick={pickFile} disabled={anyProcessing} style={{
              padding: "8px 20px", borderRadius: 5, border: "1px solid #bbb",
              background: anyProcessing ? "#eee" : "#fff",
              cursor: anyProcessing ? "not-allowed" : "pointer", fontSize: "0.93em",
            }}>
              Choose file…
            </button>
          </>
        )}
      </div>

      {/* ── Path input + action buttons ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addFileRef.current()}
          placeholder="Or paste an absolute file path and press Load…"
          disabled={anyProcessing}
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 5,
            border: "1px solid #ccc", fontSize: "0.93em" }}
        />

        <button
          onClick={() => addFileRef.current()}
          disabled={anyProcessing || !path.trim()}
          style={{
            padding: "8px 20px", borderRadius: 5, border: "1px solid #4a90d9",
            background: anyProcessing || !path.trim() ? "#eee" : "#4a90d9",
            color:      anyProcessing || !path.trim() ? "#999" : "#fff",
            cursor:     anyProcessing || !path.trim() ? "not-allowed" : "pointer",
            fontSize: "0.93em", fontWeight: 600, whiteSpace: "nowrap",
          }}
        >
          {anyProcessing ? "Processing…" : "Add"}
        </button>

        {/* Diagnose button — targets the current path input */}
        <button
          onClick={runDiagnostics}
          disabled={isDebugging || !path.trim()}
          title="Run OCR diagnostic pipeline — tests tool availability, text extraction, and pdftoppm"
          style={{
            padding: "8px 16px", borderRadius: 5,
            border: "1px solid #7b1fa2",
            background: isDebugging || !path.trim() ? "#eee" : "#f3e5f5",
            color:      isDebugging || !path.trim() ? "#999" : "#6a1b9a",
            cursor:     isDebugging || !path.trim() ? "not-allowed" : "pointer",
            fontSize: "0.88em", fontWeight: 600, whiteSpace: "nowrap",
          }}
        >
          {isDebugging ? "Running…" : "🔬 Diagnose OCR"}
        </button>

        {/* Copy Debug — always accessible once a file has been processed.
            Reads directly from debugState (React state).  Redaction is
            applied only inside copyDiagnostics(); the UI remains unredacted. */}
        {debugState !== null && (
          <button
            onClick={copyDiagnostics}
            title={`Copy debug data for: ${debugState.fileName}`}
            style={{
              padding: "8px 16px", borderRadius: 5,
              border: `1px solid ${
                diagCopied === "error" ? "#c62828" :
                diagCopied === true    ? "#2e7d32" :
                                        "#546e7a"
              }`,
              background: diagCopied === "error" ? "#fce4ec" :
                          diagCopied === true    ? "#e8f5e9" :
                                                  "#eceff1",
              color: diagCopied === "error" ? "#c62828" :
                     diagCopied === true    ? "#2e7d32" :
                                             "#37474f",
              cursor: "pointer",
              fontSize: "0.88em", fontWeight: 600, whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            {diagCopied === true    ? "✔ Copied"  :
             diagCopied === "error" ? "⚠ Failed"  :
                                     "Copy Debug"}
          </button>
        )}
      </div>

      {/* ── Diagnostic report ───────────────────────────────────────────────── */}
      <DebugPanel
        report={diagReport}
        onClose={() => setDiagReport(null)}
        onCopy={copyDiagnostics}
        copied={diagCopied}
      />

      {/* ── Loaded document list ────────────────────────────────────────────── */}
      <FileListPanel
        files={files}
        onRemove={removeFile}
        onScrollTo={scrollToCard}
      />

      {/* ── Document content cards (stacked) ────────────────────────────────── */}
      {files.map((f) => (
        <FileContentCard
          key={f.id}
          file={f}
          onRemove={removeFile}
          cardRef={(el) => { if (el) cardRefs.current[f.id] = el; }}
        />
      ))}
    </div>
  );
}

export default App;
