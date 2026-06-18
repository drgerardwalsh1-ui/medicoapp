import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC wrapper so the controller is testable without the Tauri runtime.
const { buildContradictionObservability, getClientExtraction } = vi.hoisted(() => ({
  buildContradictionObservability: vi.fn(),
  getClientExtraction: vi.fn(),
}));
vi.mock("../api/tauriApi", () => ({
  isTauri: true,
  TauriAPI: { buildContradictionObservability, getClientExtraction },
}));

import {
  runContradictionObservabilityFromExtraction,
  runContradictionObservabilityForClient,
  type ContradictionObservabilityRoot,
} from "./contradictionEngine";

// Minimal but structurally-complete observability root (mirrors the backend
// ContradictionObservabilityRoot serialisation shape the UI reads).
const SAMPLE_ROOT: ContradictionObservabilityRoot = {
  snapshot: {
    schema_version: "1.0",
    report_id: "step6:1:1:1:0",
    created_at_epoch_ms: 1000,
    report: {
      view: { enriched_contradictions: [{}] },
      graph: { nodes: [{}], edges: [] },
      analytics: {
        cluster_metrics: [{}],
        graph_summary: {
          node_count: 1,
          edge_count: 0,
          cluster_count: 1,
          largest_cluster_size: 1,
          isolated_node_count: 1,
        },
      },
      narrative: {},
    },
  },
  history: { contradictions: [{}], summary: { snapshot_count: 1 } },
  trends: {
    trends: [
      {
        contradiction_id: "i1",
        appearances: 1,
        presence_ratio: 1,
        confidence_start: 0.5,
        confidence_end: 0.5,
        confidence_delta: 0,
        direction: "Stable",
      },
    ],
    summary: { increasing_count: 0, decreasing_count: 0, stable_count: 1, intermittent_count: 0 },
  },
  readiness: {
    items: [
      {
        contradiction_id: "i1",
        snapshot_count: 1,
        appearances: 1,
        presence_ratio: 1,
        confidence_range: 0,
        trend_direction: "Stable",
        readiness: "InsufficientHistory",
      },
    ],
    summary: { insufficient_count: 1, limited_count: 0, ready_count: 0 },
  },
  queue: {
    items: [
      {
        contradiction_id: "i1",
        readiness: "InsufficientHistory",
        trend_direction: "Stable",
        appearances: 1,
        priority: "Low",
      },
    ],
    high_priority_count: 0,
    medium_priority_count: 0,
    low_priority_count: 1,
  },
  dashboard: {
    summary: {
      total_items: 1,
      high_priority_count: 0,
      medium_priority_count: 0,
      low_priority_count: 1,
      increasing_count: 0,
      decreasing_count: 0,
      stable_count: 1,
      intermittent_count: 0,
      ready_count: 0,
      limited_count: 0,
      insufficient_count: 1,
    },
  },
};

beforeEach(() => {
  buildContradictionObservability.mockReset();
  getClientExtraction.mockReset();
  buildContradictionObservability.mockResolvedValue(JSON.stringify(SAMPLE_ROOT));
});

describe("Contradiction Engine observability invocation path", () => {
  it("flattens extraction and invokes the single observability command", async () => {
    const extraction = [
      { document_id: "docA", clinical_events: [{ event_id: "e1" }, { event_id: "e2" }] },
      { document_id: "docB", clinical_events: [{ event_id: "e3" }] },
    ];
    const root = await runContradictionObservabilityFromExtraction(extraction, [], 1000);

    expect(buildContradictionObservability).toHaveBeenCalledTimes(1);
    const [clinicalEvents, familyEvents, legalEvents, participants, ts] =
      buildContradictionObservability.mock.calls[0];
    expect(clinicalEvents).toEqual([
      { event_id: "e1" },
      { event_id: "e2" },
      { event_id: "e3" },
    ]);
    expect(familyEvents).toEqual([]);
    expect(legalEvents).toEqual([]);
    expect(participants).toEqual([]);
    expect(ts).toBe(1000);
    // The whole composed root is returned for read-only display.
    expect(root.dashboard.summary.total_items).toBe(1);
    expect(root.queue.low_priority_count).toBe(1);
  });

  it("ONE backend call composes all layers (no per-subsection fetches)", async () => {
    await runContradictionObservabilityFromExtraction([
      { document_id: "docA", clinical_events: [{ event_id: "e1" }] },
    ]);
    // Exactly one IPC call yields snapshot + history + trends + readiness +
    // queue + dashboard.
    expect(buildContradictionObservability).toHaveBeenCalledTimes(1);
  });

  it("runContradictionObservabilityForClient fetches extraction then composes once", async () => {
    getClientExtraction.mockResolvedValue(
      JSON.stringify([{ document_id: "docA", clinical_events: [{ event_id: "e1" }] }]),
    );
    const root = await runContradictionObservabilityForClient("client-1", 1000);
    expect(getClientExtraction).toHaveBeenCalledWith("client-1");
    expect(buildContradictionObservability).toHaveBeenCalledTimes(1);
    expect(root.snapshot.report_id).toBe("step6:1:1:1:0");
  });
});
