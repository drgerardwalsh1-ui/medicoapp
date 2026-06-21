/**
 * TAURI API WRAPPER
 *
 * The ONLY place in the frontend that is allowed to call invoke().
 * Every function here maps 1-to-1 with a registered Rust command.
 *
 * Core commands (always available):
 *   ✔ greet
 *   ✔ read_file
 *   ✔ extract_text_hybrid
 *
 * OCR commands (available only in `--features ocr` builds):
 *   ⚙ run_ocr_command  — throws if the backend was compiled without --features ocr
 *
 * DO NOT add a wrapper here unless the matching Rust command is also:
 *   - implemented with  #[tauri::command]
 *   - listed in  generate_handler!  (for the correct feature set)
 *   - added to TAURI_CONTRACT in tauriContract.js
 */

import { invoke } from "@tauri-apps/api/core";

export const TauriAPI = {
  // ── Core ───────────────────────────────────────────────────────────────────

  /**
   * Health-check / greeting.
   * @param {string} name
   * @returns {Promise<string>}
   */
  greet: (name) => invoke("greet", { name }),

  /**
   * Read a plain-text file from disk via the Rust backend.
   * @param {string} path  Absolute file path
   * @returns {Promise<string>}
   */
  readFile: (path) => invoke("read_file", { path }),

  /**
   * Extract readable text from a document (TXT, PDF, DOCX).
   * Routes to the backend extraction pipeline (pdf-extract / zip / read_to_string).
   * @param {string} path  Absolute file path
   * @returns {Promise<string>}
   */
  extractTextHybrid: (path) => invoke("extract_text_hybrid", { path }),

  /**
   * Run rule-based medico-legal extraction on raw document text.
   * Returns a JSON string conforming to the canonical medico-legal schema,
   * including per-field provenance in `_evidence`.
   * @param {string} text   Raw extracted document text
   * @param {string} docId  Caller-supplied identifier (typically the filename)
   * @returns {Promise<string>}  JSON string
   */
  /**
   * Extract the full readable content of a file, with automatic OCR fallback
   * for pages/sections where the text layer is sparse or absent.
   * @param {string} path  Absolute file path
   * @returns {Promise<string>}  JSON string: { text, method, char_count, ocr_available }
   */
  extractFileContents: (path) =>
    invoke("extract_file_contents", { path }),

  /**
   * Run the full OCR diagnostic pipeline for a given file.
   * Tests: OCR feature flag, tool availability (tesseract, pdftoppm),
   * text extraction output, and the PDF→image→OCR pipeline probe.
   * @param {string} path  Absolute file path
   * @returns {Promise<string>}  JSON diagnostic report
   */
  runDiagnostics: (path) =>
    invoke("run_diagnostics", { path }),

  extractStructuredData: (text, docId) =>
    invoke("extract_structured_data", { text, docId }),

  /**
   * Aggregate an array of structured medico-legal documents into a single case summary.
   * Deduplicates conditions, medications, and procedures; merges and sorts the timeline.
   * @param {object[]} documents  Array of structured document objects (canonical schema)
   * @returns {Promise<string>}   JSON string containing { case_summary: { ... } }
   */
  aggregateCase: (documents) => invoke("aggregate_case", { documents }),

  /**
   * Run spaCy NER on raw text and return DATE, ORG, PERSON entities.
   * Executes ner.py (en_core_web_sm) via a Python3 subprocess.
   * No interpretation, no inference, no merging — raw entity spans only.
   * @param {string} text  Extracted document text
   * @returns {Promise<string>}  JSON: { PERSON: string[], ORG: string[], DATE: string[] }
   */
  runNer: (text) => invoke("run_ner", { text }),

  /**
   * Run scispaCy (en_core_sci_md) biomedical entity extraction on raw text.
   * Starts a local Python HTTP service on first call; reuses it for the session.
   * Returns JSON: { medications, procedures, conditions, other, all }
   * @param {string} text  Extracted document text
   * @returns {Promise<string>}  JSON string
   */
  extractNlpEntities: (text) => invoke("extract_nlp_entities", { text }),

  /**
   * List all supported document files inside a directory.
   * If `dirPath` is a file with a supported extension, returns [dirPath].
   * Returns an empty array for unsupported files or errors.
   * @param {string} dirPath  Absolute directory (or file) path
   * @returns {Promise<string[]>}  Resolved array of absolute file paths
   */
  listDirectory: async (dirPath) => {
    try {
      const raw = await invoke("list_directory", { dirPath });
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  // ── OCR (requires `--features ocr` build) ─────────────────────────────────

  /**
   * Run Tesseract OCR on an image or scanned document.
   * ⚠ Only works when the backend was compiled with `--features ocr`.
   * Rejects with "Command run_ocr_command not found" in core-mode builds.
   * @param {string} path  Absolute file path (image or PDF page render)
   * @returns {Promise<string>}
   */
  runOCR: (path) => invoke("run_ocr_command", { path }),

  // ── Reasoning pipeline ─────────────────────────────────────────────────────
  //
  // Five-stage pipeline: pre-extracted text → structured medico-legal report.
  // Each stage tries Ollama (local LLM, http://127.0.0.1:11434) first and
  // falls back to deterministic rule-based processing on any failure.
  // `method` in every response: "ollama" | "rules" | "rules_ollama_invalid"

  /**
   * Stage 1 — Segment a document into background / clinical_findings / opinions.
   * @param {string} text   Pre-extracted document text
   * @param {string} docId  Document identifier (filename)
   * @returns {Promise<string>}  JSON: { doc_id, method, word_count,
   *                                     segments: { background, clinical_findings, opinions } }
   */
  segmentDocument: (text, docId) =>
    invoke("segment_document", { text, docId }),

  /**
   * Stage 2 — Extract discrete medico-legal claims from document text.
   * @param {string} text   Pre-extracted document text
   * @param {string} docId  Document identifier
   * @returns {Promise<string>}  JSON: { doc_id, method,
   *                                     claims: { id, text, category, confidence, tags }[] }
   */
  extractClaims: (text, docId) =>
    invoke("extract_claims", { text, docId }),

  /**
   * Stage 3 — Detect contradictions between claims across multiple documents.
   * @param {object[]} claimSets  Array of extractClaims outputs (one per document)
   * @returns {Promise<string>}   JSON: { method, doc_count,
   *                                      conflicts: { topic, claim_a, claim_a_source,
   *                                                   claim_b, claim_b_source,
   *                                                   severity, explanation }[] }
   */
  detectPipelineConflicts: (claimSets) =>
    invoke("detect_pipeline_conflicts", { claimSets }),

  /**
   * Stage 4 — Reconstruct a chronological timeline from structured documents.
   * @param {object[]} documents  Array of extractStructuredData outputs
   * @returns {Promise<string>}   JSON: { method,
   *                                      timeline: { date, date_iso, event,
   *                                                  source, category }[] }
   */
  reconstructTimeline: (documents) =>
    invoke("reconstruct_timeline", { documents }),

  /**
   * Stage 5 — Synthesise a final medico-legal report from all pipeline outputs.
   * @param {object} caseSummary  Output of aggregateCase (full or case_summary sub-object)
   * @param {object} conflicts    Output of detectPipelineConflicts
   * @param {object} timeline     Output of reconstructTimeline
   * @returns {Promise<string>}   JSON: { method,
   *                                      report: { executive_summary, injury_narrative,
   *                                                treatment_history, opinions_and_causation,
   *                                                conflicts_summary, recommendations,
   *                                                overall_assessment, timeline, metadata } }
   */
  synthesiseReport: (caseSummary, conflicts, timeline) =>
    invoke("synthesise_report", { caseSummary, conflicts, timeline }),

  // ── Two-layer deterministic pipeline ───────────────────────────────────────
  //
  // Layer 1 → Layer 2 usage:
  //
  //   const canonical = JSON.parse(await TauriAPI.processDocument(rawText, docId));
  //   const reasoning = JSON.parse(await TauriAPI.reasonDocument(canonical));
  //
  // Never pass rawText directly to reasonDocument.

  /**
   * **Layer 1 — canonical document store.**
   *
   * Converts raw OCR / extracted text into the single source of truth.
   * Fully deterministic, no network.
   *
   * Pipeline: normalise text → extract entities + dates → clean/normalise →
   *           extract organisations → output canonical store.
   *
   * @param {string} text   Raw extracted document text (may contain OCR noise)
   * @param {string} docId  Caller-supplied document identifier (typically the filename)
   * @returns {Promise<string>}  JSON string (immutable canonical store):
   *   {
   *     doc_id:     string,
   *     clean_text: string,
   *     entities: {
   *       conditions:    string[],
   *       medications:   string[],
   *       procedures:    string[],
   *       organisations: string[]
   *     },
   *     dates: string[]          // ISO "YYYY-MM-DD"
   *   }
   */
  processDocument: (text, docId) =>
    invoke("process_document", { text, docId }),

  /**
   * **Layer 2 — reasoning over the canonical store.**
   *
   * Accepts the parsed output of `processDocument` and produces timeline,
   * conflict detection, and a medico-legal summary.
   *
   * ⚠ Must receive the PARSED object from `processDocument`, not raw OCR text.
   *   Pass `JSON.parse(await TauriAPI.processDocument(...))` as `canonical`.
   *
   * @param {object} canonical  Parsed canonical store from `processDocument`
   * @returns {Promise<string>}  JSON string:
   *   {
   *     timeline:  { date_iso: string, event: string, category: string }[],
   *     conflicts: { type: string, details: string }[],
   *     summary: {
   *       key_conditions: string[],
   *       key_treatments: string[],
   *       overview:       string
   *     }
   *   }
   */
  reasonDocument: (canonical) =>
    invoke("reason_document", { canonical }),
};
