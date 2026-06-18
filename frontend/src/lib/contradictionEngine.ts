/**
 * Contradiction Engine frontend invocation path (closes audit F-A1).
 *
 * Thin controller: gathers the real persisted `clinical_events` the frontend
 * already fetches via `getClientExtraction`, invokes the backend
 * `build_contradiction_case` command, and parses the result. No business logic, no
 * contradiction/confidence/export logic — all of that lives in the backend.
 *
 * Family / legal producers do not exist in the extraction yet, so empty
 * collections are passed (no fabrication).
 */

import { TauriAPI } from "../api/tauriApi";
import type { DocumentExtractionInput } from "../components/DocumentCard";

/** One row of the backend `ContradictionExport` (mirrors `contradiction_export::ContradictionExportRow`). */
export type ContradictionExportRow = {
  domain: string;
  subject: string;
  conflict_label: string;
  resolution_confidence: number;
  severity_rank: number;
  presentation_group: string;
  cross_domain_tag: string | null;
  contradiction_id: string;
  source_ids: string[];
  edge_ids: string[];
};

/** Parsed result of `build_contradiction_case` (mirrors backend `ContradictionResult`). */
export type ContradictionCaseResult = {
  case: {
    contradictions: unknown[];
    timeline: unknown[];
    [k: string]: unknown;
  };
  view: { enriched_contradictions: unknown[] };
  export: { rows: ContradictionExportRow[] };
  csv_lines: string[];
};

/** Flatten the per-document clinical events into one ordered array. */
export function collectClinicalEvents(
  extraction: DocumentExtractionInput[],
): unknown[] {
  const out: unknown[] = [];
  for (const doc of extraction) {
    for (const ce of doc.clinical_events ?? []) {
      out.push(ce);
    }
  }
  return out;
}

/**
 * Run Contradiction Engine from an already-parsed extraction payload. Family/legal lists are
 * empty (no producer); participants are passed through (empty by default).
 * ALWAYS sends the per-document clean texts — fact/value-disagreement
 * contradictions participate in every mode, not just observability.
 */
export async function runContradictionEngineFromExtraction(
  extraction: DocumentExtractionInput[],
  participants: unknown[] = [],
): Promise<ContradictionCaseResult> {
  const clinicalEvents = collectClinicalEvents(extraction);
  const cleanTexts = collectCleanTexts(extraction);
  const raw = await TauriAPI.buildContradictionCase(
    clinicalEvents,
    [],
    [],
    participants,
    cleanTexts,
  );
  return JSON.parse(raw) as ContradictionCaseResult;
}

/**
 * PRIMARY production output: run the engine over the full extraction input
 * (clinical events + clean texts) and return the typed Contradiction Graph.
 */
export async function runContradictionGraphFromExtraction(
  extraction: DocumentExtractionInput[],
  participants: unknown[] = [],
): Promise<string> {
  const clinicalEvents = collectClinicalEvents(extraction);
  const cleanTexts = collectCleanTexts(extraction);
  return TauriAPI.buildContradictionGraph(
    clinicalEvents,
    [],
    [],
    participants,
    cleanTexts,
  );
}

/** Convenience: fetch the persisted extraction for a client and build the graph. */
export async function runContradictionGraphForClient(clientId: string): Promise<string> {
  const raw = await TauriAPI.getClientExtraction(clientId);
  const extraction = JSON.parse(raw) as DocumentExtractionInput[];
  return runContradictionGraphFromExtraction(extraction);
}

/**
 * Convenience: fetch the persisted extraction for a client and run Contradiction Engine.
 * Used by the dev panel; the running app reaches the backend command here.
 */
export async function runContradictionEngineForClient(
  clientId: string,
): Promise<ContradictionCaseResult> {
  const raw = await TauriAPI.getClientExtraction(clientId);
  const extraction = JSON.parse(raw) as DocumentExtractionInput[];
  return runContradictionEngineFromExtraction(extraction);
}

// ── Contradiction Engine Observability ─────────────────────────────────────────────────────
//
// Read-only mirror of the backend `ContradictionObservabilityRoot`. Every nested layer
// is computed deterministically in the backend; the UI only reads these fields.
// Unit enums serialise as their variant name.

export type ContradictionTrendDirection =
  | "Increasing"
  | "Decreasing"
  | "Stable"
  | "Intermittent";
export type ContradictionReadinessLevel =
  | "Ready"
  | "LimitedHistory"
  | "InsufficientHistory";
export type ContradictionPriority = "High" | "Medium" | "Low";

export type ContradictionObservabilityRoot = {
  snapshot: {
    schema_version: string;
    report_id: string;
    created_at_epoch_ms: number;
    report: {
      view: { enriched_contradictions: unknown[] };
      graph: { nodes: unknown[]; edges: unknown[] };
      analytics: {
        cluster_metrics: unknown[];
        graph_summary: {
          node_count: number;
          edge_count: number;
          cluster_count: number;
          largest_cluster_size: number;
          isolated_node_count: number;
        };
      };
      narrative: unknown;
    };
  };
  history: { contradictions: unknown[]; summary: Record<string, number> };
  trends: {
    trends: Array<{
      contradiction_id: string;
      appearances: number;
      presence_ratio: number;
      confidence_start: number;
      confidence_end: number;
      confidence_delta: number;
      direction: ContradictionTrendDirection;
    }>;
    summary: {
      increasing_count: number;
      decreasing_count: number;
      stable_count: number;
      intermittent_count: number;
    };
  };
  readiness: {
    items: Array<{
      contradiction_id: string;
      snapshot_count: number;
      appearances: number;
      presence_ratio: number;
      confidence_range: number;
      trend_direction: ContradictionTrendDirection;
      readiness: ContradictionReadinessLevel;
    }>;
    summary: {
      insufficient_count: number;
      limited_count: number;
      ready_count: number;
    };
  };
  queue: {
    items: Array<{
      contradiction_id: string;
      readiness: ContradictionReadinessLevel;
      trend_direction: ContradictionTrendDirection;
      appearances: number;
      priority: ContradictionPriority;
    }>;
    high_priority_count: number;
    medium_priority_count: number;
    low_priority_count: number;
  };
  dashboard: {
    summary: {
      total_items: number;
      high_priority_count: number;
      medium_priority_count: number;
      low_priority_count: number;
      increasing_count: number;
      decreasing_count: number;
      stable_count: number;
      intermittent_count: number;
      ready_count: number;
      limited_count: number;
      insufficient_count: number;
    };
  };
};

/** Collect `[docId, cleanText]` pairs for documents that carry clean text. */
export function collectCleanTexts(
  extraction: DocumentExtractionInput[],
): [string, string][] {
  const out: [string, string][] = [];
  for (const doc of extraction) {
    const text = doc.clean_text ?? "";
    if (text) out.push([doc.document_id ?? "", text]);
  }
  return out;
}

/** Run Contradiction Engine observability from an already-parsed extraction payload. */
export async function runContradictionObservabilityFromExtraction(
  extraction: DocumentExtractionInput[],
  participants: unknown[] = [],
  createdAtEpochMs: number = Date.now(),
): Promise<ContradictionObservabilityRoot> {
  const clinicalEvents = collectClinicalEvents(extraction);
  const cleanTexts = collectCleanTexts(extraction);
  const raw = await TauriAPI.buildContradictionObservability(
    clinicalEvents,
    [],
    [],
    participants,
    createdAtEpochMs,
    cleanTexts,
  );
  return JSON.parse(raw) as ContradictionObservabilityRoot;
}

/**
 * Convenience: fetch the persisted extraction for a client and compose the
 * Contradiction Engine observability root. Single backend round-trip; no UI recomputation.
 */
export async function runContradictionObservabilityForClient(
  clientId: string,
  createdAtEpochMs: number = Date.now(),
): Promise<ContradictionObservabilityRoot> {
  const raw = await TauriAPI.getClientExtraction(clientId);
  const extraction = JSON.parse(raw) as DocumentExtractionInput[];
  return runContradictionObservabilityFromExtraction(extraction, [], createdAtEpochMs);
}
