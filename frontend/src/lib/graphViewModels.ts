/**
 * Contradiction Graph view models — pure-data layout, selectors, and a minimal
 * exploration API. NO UI framework assumptions, NO recomputation of backend
 * semantics: everything here is a deterministic re-arrangement of an
 * already-built `ContradictionGraph`.
 *
 * Exploration is modelled as an immutable state value + pure transition
 * functions (expand/collapse/filter); `visibleGraph()` derives the rendered
 * subset. All orderings are deterministic (sorted ids / stable input order).
 */

import type {
  ContradictionGraph,
  ContradictionNode,
  GraphEdge,
  GraphNode,
} from "./contradictionGraph";
import { isContradictionNode, isEntityNode, isFactNode } from "./contradictionGraph";

// ── Layout (pure data) ───────────────────────────────────────────────────────

/** Column order mirrors the reasoning flow: document → fact → contradiction → entity. */
const COLUMN_ORDER: Record<GraphNode["kind"], number> = {
  document: 0,
  fact: 1,
  contradiction: 2,
  entity: 3,
};

export type NodePosition = {
  nodeId: string;
  /** Column index (by node kind) and row index (by sorted id within column). */
  column: number;
  row: number;
  /** Unit-square coordinates in [0,1] — renderer-agnostic. */
  x: number;
  y: number;
};

export type GraphLayout = {
  positions: NodePosition[];
  columnCounts: number[];
};

/**
 * Deterministic columnar layout: nodes grouped into columns by kind, rows by
 * sorted node id. Pure data — a future renderer scales x/y as it likes.
 */
export function computeGraphLayout(graph: ContradictionGraph): GraphLayout {
  const columns: string[][] = [[], [], [], []];
  // graph.nodes is sorted by id (backend invariant) — row order inherits it.
  for (const n of graph.nodes) {
    columns[COLUMN_ORDER[n.kind]].push(n.id);
  }
  const positions: NodePosition[] = [];
  const nCols = columns.length;
  columns.forEach((ids, col) => {
    ids.forEach((nodeId, row) => {
      positions.push({
        nodeId,
        column: col,
        row,
        x: nCols === 1 ? 0.5 : col / (nCols - 1),
        y: ids.length === 1 ? 0.5 : row / (ids.length - 1),
      });
    });
  });
  return { positions, columnCounts: columns.map((c) => c.length) };
}

// ── Selectors (read-only) ────────────────────────────────────────────────────

/**
 * Undirected BFS subgraph around `nodeId` up to `maxDepth` hops (default 1).
 * Mirrors the backend `graph_query::subgraph` semantics; unknown id ⇒ empty.
 */
export function getContradictionSubgraph(
  graph: ContradictionGraph,
  nodeId: string,
  maxDepth: number = 1,
): ContradictionGraph {
  const known = new Set(graph.nodes.map((n) => n.id));
  const keep = new Set<string>();
  if (known.has(nodeId)) {
    keep.add(nodeId);
    let frontier = new Set<string>([nodeId]);
    for (let d = 0; d < maxDepth; d++) {
      const next = new Set<string>();
      for (const e of graph.edges) {
        if (frontier.has(e.from) && !keep.has(e.to)) {
          keep.add(e.to);
          next.add(e.to);
        }
        if (frontier.has(e.to) && !keep.has(e.from)) {
          keep.add(e.from);
          next.add(e.from);
        }
      }
      if (next.size === 0) break;
      frontier = next;
    }
  }
  return restrictTo(graph, keep);
}

/**
 * Contradiction nodes ranked by severity: severity_rank DESC, then resolution
 * confidence ASC (more contested first), then id ASC. Mirrors backend ranking.
 */
export function getMostSevereContradictions(
  graph: ContradictionGraph,
): ContradictionNode[] {
  return graph.nodes
    .filter(isContradictionNode)
    .slice()
    .sort(
      (a, b) =>
        b.severity_rank - a.severity_rank ||
        a.confidence - b.confidence ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/**
 * Full TEMPORAL_NEXT chain through `factId`: walk back to the chain head, then
 * forward to the tail. Singleton when the fact has no temporal edges; empty
 * when the id is unknown.
 */
export function getTemporalDriftChain(
  graph: ContradictionGraph,
  factId: string,
): string[] {
  if (!graph.nodes.some((n) => n.id === factId)) return [];
  const temporal = graph.edges.filter((e) => e.kind === "TEMPORAL_NEXT");
  const prevOf = (id: string) => temporal.find((e) => e.to === id)?.from;
  const nextOf = (id: string) => temporal.find((e) => e.from === id)?.to;

  let head = factId;
  const seen = new Set<string>([head]);
  for (let p = prevOf(head); p !== undefined && !seen.has(p); p = prevOf(head)) {
    seen.add(p);
    head = p;
  }
  const chain = [head];
  const seenFwd = new Set<string>([head]);
  for (let n = nextOf(head); n !== undefined && !seenFwd.has(n); ) {
    seenFwd.add(n);
    chain.push(n);
    n = nextOf(n);
  }
  return chain;
}

// ── Exploration API (immutable state + pure transitions) ────────────────────

export type ExplorationState = {
  /** Node ids whose neighbourhoods are expanded. Sorted, deduplicated. */
  expandedNodeIds: string[];
  /** When set, only facts RELATES_TO-linked to this entity id (plus their
   *  neighbourhood) survive `visibleGraph`. */
  entityFilter: string | null;
  /** Contradictions below this severity_rank are hidden. 0 = show all. */
  severityThreshold: number;
};

export const initialExplorationState: ExplorationState = {
  expandedNodeIds: [],
  entityFilter: null,
  severityThreshold: 0,
};

export function expandNode(state: ExplorationState, nodeId: string): ExplorationState {
  if (state.expandedNodeIds.includes(nodeId)) return state;
  return {
    ...state,
    expandedNodeIds: [...state.expandedNodeIds, nodeId].sort(),
  };
}

export function collapseNode(state: ExplorationState, nodeId: string): ExplorationState {
  if (!state.expandedNodeIds.includes(nodeId)) return state;
  return {
    ...state,
    expandedNodeIds: state.expandedNodeIds.filter((id) => id !== nodeId),
  };
}

export function filterByEntity(
  state: ExplorationState,
  entityId: string | null,
): ExplorationState {
  return { ...state, entityFilter: entityId };
}

export function filterBySeverityThreshold(
  state: ExplorationState,
  threshold: number,
): ExplorationState {
  return { ...state, severityThreshold: Math.max(0, Math.floor(threshold)) };
}

/**
 * Derive the visible subset for the current exploration state:
 *   1. Base set: contradiction nodes meeting the severity threshold.
 *   2. Entity filter: restrict facts to those related to the entity, and keep
 *      only contradictions supported by a surviving fact.
 *   3. Expansion: each expanded node pulls in its 1-hop neighbourhood.
 *   4. Edges: kept iff both endpoints are visible.
 */
export function visibleGraph(
  graph: ContradictionGraph,
  state: ExplorationState,
): ContradictionGraph {
  const keep = new Set<string>();

  const entityFactIds: Set<string> | null = state.entityFilter
    ? new Set(
        graph.edges
          .filter((e) => e.kind === "RELATES_TO" && e.from === state.entityFilter)
          .map((e) => e.to),
      )
    : null;

  const supportsOf = (cxId: string): string[] =>
    graph.edges
      .filter((e) => e.kind === "SUPPORTS" && e.to === cxId)
      .map((e) => e.from);

  for (const n of graph.nodes) {
    if (isContradictionNode(n)) {
      if (n.severity_rank < state.severityThreshold) continue;
      if (entityFactIds && !supportsOf(n.id).some((f) => entityFactIds.has(f))) {
        continue;
      }
      keep.add(n.id);
    }
    if (isEntityNode(n) && state.entityFilter === n.id) keep.add(n.id);
    if (isFactNode(n) && entityFactIds?.has(n.id)) keep.add(n.id);
  }

  for (const expanded of state.expandedNodeIds) {
    if (!keep.has(expanded)) continue;
    for (const e of graph.edges) {
      if (e.from === expanded) keep.add(e.to);
      if (e.to === expanded) keep.add(e.from);
    }
  }

  return restrictTo(graph, keep);
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Restrict a graph to `keep`, recomputing metadata counts deterministically. */
function restrictTo(graph: ContradictionGraph, keep: Set<string>): ContradictionGraph {
  const nodes: GraphNode[] = graph.nodes.filter((n) => keep.has(n.id));
  const edges: GraphEdge[] = graph.edges.filter(
    (e) => keep.has(e.from) && keep.has(e.to),
  );
  const nodeCounts: Record<string, number> = {};
  for (const n of nodes) nodeCounts[n.kind] = (nodeCounts[n.kind] ?? 0) + 1;
  const edgeCounts: Record<string, number> = {};
  for (const e of edges) edgeCounts[e.kind] = (edgeCounts[e.kind] ?? 0) + 1;
  return {
    nodes,
    edges,
    metadata: {
      schema_version: graph.metadata.schema_version,
      contradiction_count: nodeCounts["contradiction"] ?? 0,
      node_counts: nodeCounts,
      edge_counts: edgeCounts,
    },
  };
}
