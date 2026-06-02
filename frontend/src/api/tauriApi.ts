/**
 * TAURI API WRAPPER (TypeScript port of backend/src/api/tauriCommands.js)
 *
 * The ONLY place in the frontend that calls invoke().
 * Calls are guarded by `isTauri` so plain `vite dev` in a browser fails
 * loud-but-graceful instead of crashing on `window.__TAURI_INTERNALS__`.
 */

import { invoke } from "@tauri-apps/api/core";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// eslint-disable-next-line no-console
console.log(`TAURI AVAILABLE: ${isTauri}`);

function guarded<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    return Promise.reject(
      new Error(
        `Tauri runtime not available — cannot invoke "${cmd}". Run via \`cargo tauri dev\`.`
      )
    );
  }
  return invoke<T>(cmd, args);
}

/** Raw JSON string returned by a Rust command. */
export type JsonString = string;

export const TauriAPI = {
  // ── Core ───────────────────────────────────────────────────────────────────
  greet: (name: string): Promise<string> => guarded("greet", { name }),
  readFile: (path: string): Promise<string> => guarded("read_file", { path }),
  extractTextHybrid: (path: string): Promise<string> =>
    guarded("extract_text_hybrid", { path }),

  /** Returns JSON: { text, method, char_count, ocr_available } */
  extractFileContents: (path: string): Promise<JsonString> =>
    guarded("extract_file_contents", { path }),

  runDiagnostics: (path: string): Promise<JsonString> =>
    guarded("run_diagnostics", { path }),

  extractStructuredData: (text: string, docId: string): Promise<JsonString> =>
    guarded("extract_structured_data", { text, docId }),

  aggregateCase: (documents: unknown[]): Promise<JsonString> =>
    guarded("aggregate_case", { documents }),

  /** Returns JSON: { PERSON: string[], ORG: string[], DATE: string[] } */
  runNer: (text: string): Promise<JsonString> => guarded("run_ner", { text }),

  /** Returns JSON: { medications, procedures, conditions, other, all } */
  extractNlpEntities: (text: string): Promise<JsonString> =>
    guarded("extract_nlp_entities", { text }),

  /** Resolves to absolute file paths. Returns [] outside Tauri or on error. */
  listDirectory: async (dirPath: string): Promise<string[]> => {
    try {
      const raw = await guarded<string>("list_directory", { dirPath });
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  },

  // ── OCR (only available with `--features ocr`) ─────────────────────────────
  runOCR: (path: string): Promise<string> =>
    guarded("run_ocr_command", { path }),

  // ── Reasoning pipeline ─────────────────────────────────────────────────────
  segmentDocument: (text: string, docId: string): Promise<JsonString> =>
    guarded("segment_document", { text, docId }),

  extractClaims: (text: string, docId: string): Promise<JsonString> =>
    guarded("extract_claims", { text, docId }),

  detectPipelineConflicts: (claimSets: unknown[]): Promise<JsonString> =>
    guarded("detect_pipeline_conflicts", { claimSets }),

  reconstructTimeline: (documents: unknown[]): Promise<JsonString> =>
    guarded("reconstruct_timeline", { documents }),

  synthesiseReport: (
    caseSummary: unknown,
    conflicts: unknown,
    timeline: unknown
  ): Promise<JsonString> =>
    guarded("synthesise_report", { caseSummary, conflicts, timeline }),

  // ── Two-layer deterministic pipeline ───────────────────────────────────────
  /**
   * Layer 1 — canonical store. **Legacy** entry point: extracts in-memory
   * but does not persist to the medico-legal boundary. Kept for
   * non-persistence callers (dev tooling, fixtures); new code SHOULD
   * call `processPathAndPersist` instead. See PERSISTENCE.md.
   */
  processDocument: (text: string, docId: string): Promise<JsonString> =>
    guarded("process_document", { text, docId }),

  /** Layer 2 — reasoning over parsed canonical store. */
  reasonDocument: (canonical: unknown): Promise<JsonString> =>
    guarded("reason_document", { canonical }),

  // ── Persistence boundary — canonical PRODUCTION ingestion path ───────────
  //
  // These three commands are the ONLY supported way to bring a real
  // medico-legal document into the system. They:
  //   1. hash the raw bytes for chain-of-custody,
  //   2. run the deterministic rule pipeline,
  //   3. emit immutable boundary events (DocumentExtracted,
  //      ClinicalEventsRecorded, AttributionRecorded,
  //      ExtractionRunRecorded),
  //   4. project the events forward so the boundary tables
  //      (clinical_events, resolved_attributions, …) are queryable
  //      immediately.
  //
  // `processDocument` above is reserved for in-memory dev work and is
  // NOT the canonical production path.

  /**
   * Canonical production ingestion. Reads bytes from `path` in the
   * backend (no IPC round-trip of large PDFs), runs the full pipeline,
   * and persists DocumentExtracted + ClinicalEventsRecorded events.
   *
   * Returns the same JSON shape as `processDocument` plus the boundary
   * fields (`document_id`, `run_id`, `pipeline_version`,
   * `rule_corpus_hash`, `source_bytes_sha256`, `clean_text_sha256`).
   */
  processPathAndPersist: (params: {
    clientId: string;
    path: string;
    fileName?: string;
    docId?: string;
  }): Promise<JsonString> =>
    guarded("process_path_and_persist", params),

  /**
   * Bytes-in variant for cases where the frontend has the bytes (eg
   * dropped Blob → ArrayBuffer) but no on-disk path. Heavier than
   * `processPathAndPersist` because bytes traverse IPC, so prefer the
   * path-based command for normal uploads.
   */
  processAndPersistDocument: (params: {
    clientId: string;
    docId: string;
    fileName: string;
    method: string;
    text: string;
    bytes?: number[];
    ocrEngineVersion?: string;
  }): Promise<JsonString> =>
    guarded("process_and_persist_document", params),

  /**
   * Resolve participants/organisations/patients for a batch of
   * canonical documents and emit AttributionRecorded +
   * ExtractionRunRecorded events. Call once per upload batch (e.g.
   * after all documents for a client have been ingested).
   */
  persistAttributionForRun: (params: {
    clientId: string;
    runId: string;
    documents: unknown[];
  }): Promise<JsonString> =>
    guarded("persist_attribution_for_run", params),

  /**
   * Diagnostic-only: scan the projection's `clinical_events` rows and
   * verify each `source_snippet` byte-matches
   * `clean_text[char_offset_start..char_offset_end]`. Returns a JSON
   * report. Does not fail ingestion; surfaces drift for audit.
   */
  auditSnippetIntegrity: (clientId?: string): Promise<JsonString> =>
    guarded("audit_snippet_integrity", { clientId: clientId ?? null }),

  // ── Step 4 — first event-driven domain path ──────────────────────────────
  /**
   * Create a new client. Emits a `ClientCreated` event and projects forward.
   * Returns the new UUIDv7 `client_id`.
   */
  createClient: (
    demographics?: Record<string, unknown>
  ): Promise<string> =>
    guarded("create_client", { demographics: demographics ?? null }),

  /** Read a client view from the projection. Errors if not found. */
  getClientView: (clientId: string): Promise<ClientViewModel> =>
    guarded("get_client_view", { clientId }),

  /**
   * Authoritative existence check against the projection `clients`
   * table. The SINGLE SOURCE OF TRUTH for "may this client receive
   * document uploads?". The ingestion gate calls this instead of
   * trusting any UI flag — a desynced `isSaved` boolean or a draft
   * sentinel id can never permit an upload against a non-existent
   * client.
   */
  clientExists: (clientId: string): Promise<boolean> =>
    guarded("client_exists", { clientId }),

  /**
   * Read persisted extraction results for a client, per document.
   * Returns the clinical events + resolved attributions the ingestion
   * pipeline already wrote to `projection.db`, so the UI can rehydrate
   * clinical content after navigation WITHOUT reprocessing. Source of
   * truth is the projection; this command only exposes the boundary
   * tables that `getClientView` omits.
   */
  getClientExtraction: (clientId: string): Promise<JsonString> =>
    guarded("get_client_extraction", { clientId }),

  /** List every client in the projection (full views). */
  listClients: (): Promise<ClientViewModel[]> => guarded("list_clients"),

  // ── Step 6 — Version History (additive, audit-preserving) ───────────────
  /** Ordered event history (oldest first) for a client. */
  getClientEventHistory: (clientId: string): Promise<EventHistoryItem[]> =>
    guarded("get_client_event_history", { clientId }),

  /** Pure replay up to and including `version`. Stream-validated. */
  getClientSnapshotAtVersion: (
    clientId: string,
    version: number
  ): Promise<ClientStateSnapshot> =>
    guarded("get_client_snapshot_at_version", { clientId, version }),

  /**
   * Promote a historical snapshot forward by emitting a brand-new
   * `ClientRestoredFromVersion` event. Past events are not modified.
   * Returns the new event version.
   */
  restoreClientFromVersion: (
    clientId: string,
    version: number
  ): Promise<number> =>
    guarded("restore_client_from_version", { clientId, version }),

  /**
   * Promote a single field from a historical snapshot forward.
   * Currently supports `"demographics"` (emits `DemographicsUpdated`).
   */
  restoreClientFieldFromVersion: (
    clientId: string,
    version: number,
    field: string
  ): Promise<number> =>
    guarded("restore_client_field_from_version", { clientId, version, field }),

  // ── System Management ────────────────────────────────────────────────────

  /**
   * Wipe all client data (events + projection). DESTRUCTIVE AND IRREVERSIBLE.
   * Frontend must require explicit "DELETE" confirmation before calling.
   * Returns JSON: { status: "ok", message: string }
   */
  resetDatabase: (): Promise<JsonString> => guarded("reset_database"),

  /**
   * Run a SELECT-only SQL query against the projection DB (default) or events DB.
   * `db` can be "projection" (default) or "events".
   * Returns JSON: { columns: string[], rows: any[][] }
   */
  runSqlQuery: (query: string, db?: "projection" | "events"): Promise<JsonString> =>
    guarded("run_sql_query", { query, db: db ?? "projection" }),

  /**
   * Export all events and projection data as a pretty-printed JSON bundle.
   */
  exportAllData: (): Promise<JsonString> => guarded("export_all_data"),

  /**
   * Open a native save dialog, write `content` to the chosen path.
   * Returns the absolute path, or rejects with "cancelled" if dismissed.
   */
  saveTextFile: (content: string, defaultFilename: string): Promise<string> =>
    guarded("save_text_file", { content, defaultFilename }),

  /**
   * Reveal a file or folder in Finder (macOS) / Explorer (Windows).
   */
  revealInFinder: (path: string): Promise<void> =>
    guarded("reveal_in_finder", { path }),

  /**
   * Step 7 — pure replay-based diff between two versions. UI not wired yet.
   * Returns a deterministic list of `{field, from, to}` for the
   * `demographics` / `referrer` / `appointment` sub-blobs.
   */
  diffClientVersions: (
    clientId: string,
    versionA: number,
    versionB: number
  ): Promise<VersionDiff[]> =>
    guarded("diff_client_versions", { clientId, versionA, versionB }),

  /**
   * Replace a client's demographics blob. Emits `DemographicsUpdated`
   * and projects forward. Returns the new version.
   */
  updateClientDemographics: (
    clientId: string,
    demographics: Record<string, unknown>
  ): Promise<number> =>
    guarded("update_client_demographics", { clientId, demographics }),

  /**
   * Delete a client. Emits a `ClientDeleted` event and removes the row
   * (plus child rows) from the projection. Returns the new event version.
   * Frontend MUST surface a confirmation dialog before calling.
   */
  deleteClient: (clientId: string): Promise<number> =>
    guarded("delete_client", { clientId }),

  // ── Psychiatric History (event-sourced via the omnibus blob) ───────────
  // The existing `update_client_demographics` Rust command persists the
  // full client blob (including psychiatricHistory, see buildSaveBlob in
  // main.tsx). These wrappers expose finer-grained, history-specific
  // entry points so future Rust commands can replace the call site
  // without churning every caller.
  //
  // FOLLOW-UP (Rust):
  //   - update_client_psychiatric_history  → emits PsychiatricHistoryUpdated
  //   - add_treatment_entry                → emits TreatmentEntryAdded
  //   - update_treatment_entry             → emits TreatmentEntryUpdated
  //   - add_medical_condition              → emits MedicalConditionAdded
  //   - update_history_event               → emits HistoryEventUpdated
  // Until those land, all five wrappers go through update_client_demographics
  // with the latest full blob (already the established pattern for DSM and
  // WorkTimeline data).

  updateClientPsychiatricHistory: (
    clientId: string,
    fullDemographics: Record<string, unknown>
  ): Promise<number> =>
    guarded("update_client_demographics", { clientId, demographics: fullDemographics }),

  addTreatmentEntry: (
    clientId: string,
    fullDemographics: Record<string, unknown>
  ): Promise<number> =>
    guarded("update_client_demographics", { clientId, demographics: fullDemographics }),

  updateTreatmentEntry: (
    clientId: string,
    fullDemographics: Record<string, unknown>
  ): Promise<number> =>
    guarded("update_client_demographics", { clientId, demographics: fullDemographics }),

  addMedicalCondition: (
    clientId: string,
    fullDemographics: Record<string, unknown>
  ): Promise<number> =>
    guarded("update_client_demographics", { clientId, demographics: fullDemographics }),

  updateHistoryEvent: (
    clientId: string,
    fullDemographics: Record<string, unknown>
  ): Promise<number> =>
    guarded("update_client_demographics", { clientId, demographics: fullDemographics }),

  /**
   * Attach an already-extracted document to a client. Returns the new
   * document_id (UUIDv7). The frontend is expected to have already run
   * the extraction pipeline and supply the resulting metadata.
   */
  attachDocument: (
    clientId: string,
    fileName: string,
    method: string,
    charCount: number,
    correlationId?: string
  ): Promise<string> =>
    guarded("attach_document", {
      clientId,
      fileName,
      method,
      charCount,
      correlationId: correlationId ?? null,
    }),

  // ── Phase 7 — clinician decision persistence (opaque JSON) ─────────────────
  /**
   * Persist a frozen ReportSnapshotV2 + ClinicalDecision as opaque JSON.
   * The backend does not interpret or validate clinical content.
   * Returns { id, savedAt }.
   */
  persistClinicalDecision: (
    snapshot: unknown,
    decision: unknown
  ): Promise<{ id: string; savedAt: string }> =>
    guarded("persist_clinical_decision", { snapshot, decision }),
};

/** Mirrors the Rust `EventHistoryItem`. */
export type EventHistoryItem = {
  version: number;
  timestamp: string;
  event_type: string;
};

/** Mirrors the Rust `VersionDiff` (Step 7). */
export type VersionDiff = {
  field: string;
  from: unknown;
  to: unknown;
};

/** Mirrors the Rust `reducer::ClientState` (snake_case field names). */
export type ClientStateSnapshot = {
  client_id: string;
  last_version: number;
  first_seen: string | null;
  last_updated: string | null;
  name: string | null;
  demographics: Record<string, unknown> | null;
  documents: Array<{
    document_id: string;
    file_name: string;
    char_count: number;
    method: string;
    uploaded_at: string;
  }>;
};

/** Mirrors `projection::DocumentSummary`. */
export type DocumentSummary = {
  id: string;
  file_name: string | null;
  method: string | null;
  char_count: number;
  uploaded_at: string | null;
};

/** Mirrors `projection::PIRSTableViewModel`. */
export type PIRSTableViewModel = {
  version: number;
  snapshot: unknown;
  created_at: string;
};

/** Mirrors `projection::ResolvedAttributionView`. */
export type ResolvedAttributionView = {
  event_id: string;
  participant_id: string | null;
  participant_name: string | null;
  participant_role: string | null;
  organisation_id: string | null;
  organisation_name: string | null;
  patient_id: string | null;
};

/**
 * Mirrors `projection::DocumentExtraction` — persisted clinical content
 * for one document, returned by `getClientExtraction`. `clinical_events`
 * are verbatim `ClinicalEvent` JSON objects from the projection.
 */
export type DocumentExtraction = {
  document_id: string;
  file_name: string | null;
  raw_text: string | null;
  clean_text: string | null;
  clinical_events: unknown[];
  attributions: ResolvedAttributionView[];
};

/** Mirrors `projection::ClientViewModel` on the Rust side. */
export type ClientViewModel = {
  id: string;
  demographics: Record<string, unknown> | null;
  last_version: number;
  created_at: string | null;
  updated_at: string | null;
  document_count: number;
  documents: DocumentSummary[];
  entities: unknown[];
  timeline: unknown[];
  pirs_snapshots: PIRSTableViewModel[];

};

export type TauriAPIType = typeof TauriAPI;
