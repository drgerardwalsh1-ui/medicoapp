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
  /** Layer 1 — canonical store. */
  processDocument: (text: string, docId: string): Promise<JsonString> =>
    guarded("process_document", { text, docId }),

  /** Layer 2 — reasoning over parsed canonical store. */
  reasonDocument: (canonical: unknown): Promise<JsonString> =>
    guarded("reason_document", { canonical }),

  // ── Step 4 — first event-driven domain path ──────────────────────────────
  /**
   * Create a new client. Emits a `ClientCreated` event and projects forward.
   * Returns the new UUIDv7 `client_id`.
   */
  createClient: (
    name: string,
    demographics?: Record<string, unknown>
  ): Promise<string> =>
    guarded("create_client", { name, demographics: demographics ?? null }),

  /** Read a client view from the projection. Errors if not found. */
  getClientView: (clientId: string): Promise<ClientViewModel> =>
    guarded("get_client_view", { clientId }),

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

/** Mirrors `projection::ClientViewModel` on the Rust side. */
export type ClientViewModel = {
  id: string;
  name: string | null;
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
