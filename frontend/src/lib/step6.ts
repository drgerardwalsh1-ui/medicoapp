/**
 * STEP-6 frontend invocation path (closes audit F-A1).
 *
 * Thin controller: gathers the real persisted `clinical_events` the frontend
 * already fetches via `getClientExtraction`, invokes the backend
 * `build_step6_case` command, and parses the result. No business logic, no
 * contradiction/confidence/export logic — all of that lives in the backend.
 *
 * Family / legal producers do not exist in the extraction yet, so empty
 * collections are passed (no fabrication).
 */

import { TauriAPI } from "../api/tauriApi";
import type { DocumentExtractionInput } from "../components/DocumentCard";

/** One row of the backend `Step6Export` (mirrors `step6_export::Step6ExportRow`). */
export type Step6ExportRow = {
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

/** Parsed result of `build_step6_case` (mirrors backend `Step6Result`). */
export type Step6CaseResult = {
  case: {
    contradictions: unknown[];
    timeline: unknown[];
    [k: string]: unknown;
  };
  view: { enriched_contradictions: unknown[] };
  export: { rows: Step6ExportRow[] };
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
 * Run STEP-6 from an already-parsed extraction payload. Family/legal lists are
 * empty (no producer); participants are passed through (empty by default).
 */
export async function runStep6FromExtraction(
  extraction: DocumentExtractionInput[],
  participants: unknown[] = [],
): Promise<Step6CaseResult> {
  const clinicalEvents = collectClinicalEvents(extraction);
  const raw = await TauriAPI.buildStep6Case(clinicalEvents, [], [], participants);
  return JSON.parse(raw) as Step6CaseResult;
}

/**
 * Convenience: fetch the persisted extraction for a client and run STEP-6.
 * Used by the dev panel; the running app reaches the backend command here.
 */
export async function runStep6ForClient(
  clientId: string,
): Promise<Step6CaseResult> {
  const raw = await TauriAPI.getClientExtraction(clientId);
  const extraction = JSON.parse(raw) as DocumentExtractionInput[];
  return runStep6FromExtraction(extraction);
}

// ── STEP-6 Observability ─────────────────────────────────────────────────────
//
// Read-only mirror of the backend `Step6ObservabilityRoot`. Every nested layer
// is computed deterministically in the backend; the UI only reads these fields.
// Unit enums serialise as their variant name.

export type Step6TrendDirection =
  | "Increasing"
  | "Decreasing"
  | "Stable"
  | "Intermittent";
export type Step6ReadinessLevel =
  | "Ready"
  | "LimitedHistory"
  | "InsufficientHistory";
export type Step6Priority = "High" | "Medium" | "Low";

export type Step6ObservabilityRoot = {
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
      direction: Step6TrendDirection;
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
      trend_direction: Step6TrendDirection;
      readiness: Step6ReadinessLevel;
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
      readiness: Step6ReadinessLevel;
      trend_direction: Step6TrendDirection;
      appearances: number;
      priority: Step6Priority;
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

/** Run STEP-6 observability from an already-parsed extraction payload. */
export async function runStep6ObservabilityFromExtraction(
  extraction: DocumentExtractionInput[],
  participants: unknown[] = [],
  createdAtEpochMs: number = Date.now(),
): Promise<Step6ObservabilityRoot> {
  const clinicalEvents = collectClinicalEvents(extraction);
  const cleanTexts = collectCleanTexts(extraction);
  const raw = await TauriAPI.buildStep6Observability(
    clinicalEvents,
    [],
    [],
    participants,
    createdAtEpochMs,
    cleanTexts,
  );
  return JSON.parse(raw) as Step6ObservabilityRoot;
}

/**
 * Convenience: fetch the persisted extraction for a client and compose the
 * STEP-6 observability root. Single backend round-trip; no UI recomputation.
 */
export async function runStep6ObservabilityForClient(
  clientId: string,
  createdAtEpochMs: number = Date.now(),
): Promise<Step6ObservabilityRoot> {
  const raw = await TauriAPI.getClientExtraction(clientId);
  const extraction = JSON.parse(raw) as DocumentExtractionInput[];
  return runStep6ObservabilityFromExtraction(extraction, [], createdAtEpochMs);
}
