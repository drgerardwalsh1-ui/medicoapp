import { describe, it, expect } from "vitest";

import type { ContradictionGraph } from "./contradictionGraph";
import {
  collapseNode,
  computeGraphLayout,
  expandNode,
  filterByEntity,
  filterBySeverityThreshold,
  getContradictionSubgraph,
  getMostSevereContradictions,
  getTemporalDriftChain,
  initialExplorationState,
  visibleGraph,
} from "./graphViewModels";

/**
 * Fixture mirroring the backend lowering of two contradictions:
 *  - cx:smoke (severity 3): "never smoked" (2021-01-01) vs "20-year smoker"
 *    (2021-06-01) — dated, so a TEMPORAL_NEXT edge exists.
 *  - cx:wrist (severity 2): affirmed vs negated, undated.
 * Node/edge ids and ordering follow the backend's deterministic scheme.
 */
function fixture(): ContradictionGraph {
  const prov = (docs: string[]) => ({
    documents: docs,
    extraction_source: "contradiction_engine:value",
  });
  const nodes: ContradictionGraph["nodes"] = [
    { kind: "contradiction", id: "cx:smoke", contradiction_id: "smoke", domain: "clinical", conflict_label: "value", subject: "smoking", severity_rank: 3, confidence: 0.5, timestamp: "2021-01-01", provenance: prov(["docA", "docB"]) },
    { kind: "contradiction", id: "cx:wrist", contradiction_id: "wrist", domain: "clinical", conflict_label: "assertion", subject: "fractured wrist", severity_rank: 2, confidence: 0.5, timestamp: null, provenance: prov(["docC"]) },
    { kind: "document", id: "doc:docA", source: "docA", confidence: 1.0, timestamp: "2021-01-01", provenance: prov(["docA"]) },
    { kind: "document", id: "doc:docB", source: "docB", confidence: 1.0, timestamp: "2021-06-01", provenance: prov(["docB"]) },
    { kind: "document", id: "doc:docC", source: "docC", confidence: 1.0, timestamp: null, provenance: prov(["docC"]) },
    { kind: "entity", id: "ent:subject:fractured wrist", name: "fractured wrist", entity_kind: "subject", confidence: 1.0, timestamp: null, provenance: prov(["docC"]) },
    { kind: "entity", id: "ent:subject:smoking", name: "smoking", entity_kind: "subject", confidence: 1.0, timestamp: "2021-01-01", provenance: prov(["docA", "docB"]) },
    { kind: "fact", id: "fact:smoke:never", subject: "smoking", value: "never", support_count: 1, confidence: 0.5, polarity: "affirmed", text_span: [0, 10] as [number, number], evidence: ["fixture sentence"], timestamp: "2021-01-01", provenance: prov(["docA"]) },
    { kind: "fact", id: "fact:smoke:smoker", subject: "smoking", value: "smoker", support_count: 1, confidence: 0.5, polarity: "affirmed", text_span: [0, 10] as [number, number], evidence: ["fixture sentence"], timestamp: "2021-06-01", provenance: prov(["docB"]) },
    { kind: "fact", id: "fact:wrist:affirmed", subject: "fractured wrist", value: "affirmed", support_count: 1, confidence: 0.5, polarity: "affirmed", text_span: [0, 10] as [number, number], evidence: ["fixture sentence"], timestamp: null, provenance: prov(["docC"]) },
    { kind: "fact", id: "fact:wrist:negated", subject: "fractured wrist", value: "negated", support_count: 1, confidence: 0.5, polarity: "affirmed", text_span: [0, 10] as [number, number], evidence: ["fixture sentence"], timestamp: null, provenance: prov(["docC"]) },
  ];
  const edge = (
    kind: ContradictionGraph["edges"][number]["kind"],
    from: string,
    to: string,
    weight = 0.5,
  ) => ({
    id: `${kind}:${from}->${to}`,
    kind,
    from,
    to,
    weight,
    reasoning: "test",
    provenance: "fixture",
  });
  const edges = [
    edge("CONTRADICTS", "fact:smoke:never", "fact:smoke:smoker", 1.0),
    edge("CONTRADICTS", "fact:wrist:affirmed", "fact:wrist:negated", 1.0),
    edge("DERIVED_FROM", "fact:smoke:never", "doc:docA", 1.0),
    edge("DERIVED_FROM", "fact:smoke:smoker", "doc:docB", 1.0),
    edge("DERIVED_FROM", "fact:wrist:affirmed", "doc:docC", 1.0),
    edge("DERIVED_FROM", "fact:wrist:negated", "doc:docC", 1.0),
    edge("RELATES_TO", "ent:subject:fractured wrist", "fact:wrist:affirmed", 1.0),
    edge("RELATES_TO", "ent:subject:fractured wrist", "fact:wrist:negated", 1.0),
    edge("RELATES_TO", "ent:subject:smoking", "fact:smoke:never", 1.0),
    edge("RELATES_TO", "ent:subject:smoking", "fact:smoke:smoker", 1.0),
    edge("STRENGTHENS", "cx:smoke", "fact:smoke:never"),
    edge("STRENGTHENS", "cx:wrist", "fact:wrist:affirmed"),
    edge("SUPPORTS", "fact:smoke:never", "cx:smoke"),
    edge("SUPPORTS", "fact:smoke:smoker", "cx:smoke"),
    edge("SUPPORTS", "fact:wrist:affirmed", "cx:wrist"),
    edge("SUPPORTS", "fact:wrist:negated", "cx:wrist"),
    edge("TEMPORAL_NEXT", "fact:smoke:never", "fact:smoke:smoker", 1.0),
    edge("WEAKENS", "cx:smoke", "fact:smoke:smoker"),
    edge("WEAKENS", "cx:wrist", "fact:wrist:negated"),
  ];
  return {
    nodes,
    edges,
    metadata: {
      schema_version: "1.0",
      contradiction_count: 2,
      node_counts: { contradiction: 2, document: 3, entity: 2, fact: 4 },
      edge_counts: {
        CONTRADICTS: 2, DERIVED_FROM: 4, RELATES_TO: 4, STRENGTHENS: 2,
        SUPPORTS: 4, TEMPORAL_NEXT: 1, WEAKENS: 2,
      },
    },
  };
}

describe("graphViewModels — selectors", () => {
  it("ranks most severe contradictions deterministically", () => {
    const ranked = getMostSevereContradictions(fixture());
    expect(ranked.map((c) => c.id)).toEqual(["cx:smoke", "cx:wrist"]);
  });

  it("extracts a 1-hop subgraph around a contradiction", () => {
    const sub = getContradictionSubgraph(fixture(), "cx:wrist", 1);
    expect(sub.nodes.map((n) => n.id)).toEqual([
      "cx:wrist",
      "fact:wrist:affirmed",
      "fact:wrist:negated",
    ]);
    // Edges between kept nodes survive; edges to dropped nodes do not.
    expect(sub.edges.every((e) => !e.id.includes("doc:"))).toBe(true);
    expect(sub.metadata.contradiction_count).toBe(1);
  });

  it("returns the full temporal drift chain from either end", () => {
    const g = fixture();
    const expected = ["fact:smoke:never", "fact:smoke:smoker"];
    expect(getTemporalDriftChain(g, "fact:smoke:never")).toEqual(expected);
    expect(getTemporalDriftChain(g, "fact:smoke:smoker")).toEqual(expected);
    expect(getTemporalDriftChain(g, "fact:wrist:affirmed")).toEqual([
      "fact:wrist:affirmed",
    ]);
    expect(getTemporalDriftChain(g, "missing")).toEqual([]);
  });

  it("subgraph of unknown id is empty", () => {
    const sub = getContradictionSubgraph(fixture(), "nope", 2);
    expect(sub.nodes).toEqual([]);
    expect(sub.edges).toEqual([]);
  });
});

describe("graphViewModels — exploration state", () => {
  it("severity threshold hides weaker contradictions", () => {
    const state = filterBySeverityThreshold(initialExplorationState, 3);
    const vis = visibleGraph(fixture(), state);
    expect(vis.nodes.map((n) => n.id)).toEqual(["cx:smoke"]);
  });

  it("expandNode pulls in the 1-hop neighbourhood; collapse removes it", () => {
    let state = filterBySeverityThreshold(initialExplorationState, 0);
    state = expandNode(state, "cx:wrist");
    const vis = visibleGraph(fixture(), state);
    expect(vis.nodes.map((n) => n.id)).toContain("fact:wrist:affirmed");
    expect(vis.nodes.map((n) => n.id)).toContain("fact:wrist:negated");

    const collapsed = collapseNode(state, "cx:wrist");
    const vis2 = visibleGraph(fixture(), collapsed);
    expect(vis2.nodes.map((n) => n.id)).toEqual(["cx:smoke", "cx:wrist"]);
  });

  it("entity filter restricts contradictions and facts to that entity", () => {
    const state = filterByEntity(initialExplorationState, "ent:subject:smoking");
    const vis = visibleGraph(fixture(), state);
    const ids = vis.nodes.map((n) => n.id);
    expect(ids).toContain("cx:smoke");
    expect(ids).toContain("ent:subject:smoking");
    expect(ids).not.toContain("cx:wrist");
    expect(ids).not.toContain("fact:wrist:affirmed");
  });

  it("transitions are pure and idempotent", () => {
    const s1 = expandNode(initialExplorationState, "cx:smoke");
    const s2 = expandNode(s1, "cx:smoke");
    expect(s2).toBe(s1); // no-op returns same reference
    expect(initialExplorationState.expandedNodeIds).toEqual([]);
  });
});

describe("graphViewModels — layout", () => {
  it("computes a deterministic columnar layout in the unit square", () => {
    const layout = computeGraphLayout(fixture());
    expect(layout.columnCounts).toEqual([3, 4, 2, 2]); // doc, fact, cx, entity
    expect(layout.positions.length).toBe(11);
    for (const p of layout.positions) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    // Determinism: identical input ⇒ identical output.
    expect(computeGraphLayout(fixture())).toEqual(layout);
  });
});
