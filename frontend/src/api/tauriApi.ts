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

  // Optional top-level mirrors that the projection may surface alongside
  // demographics. Kept loose (`any`) — the consumer falls back to the nested
  // shape when these are absent.
  referrer?: any;
  appointment?: any;
};

export type TauriAPIType = typeof TauriAPI;
