/**
 * Contradiction Graph Model — frontend mirror types.
 *
 * Read-only, structural mirror of the backend `graph_types` module
 * (`build_contradiction_graph` Tauri command). The UI NEVER recomputes graph
 * semantics: every node, edge, weight, and confidence is backend-derived and
 * deterministic. Serde mapping: node unions are tagged with `kind`
 * (snake_case); edge kinds serialise as SCREAMING_SNAKE_CASE tokens.
 */

export type NodeKind = "fact" | "document" | "contradiction" | "entity";

export type EdgeKind =
  | "SUPPORTS"
  | "CONTRADICTS"
  | "DERIVED_FROM"
  | "RELATES_TO"
  | "TEMPORAL_NEXT"
  | "WEAKENS"
  | "STRENGTHENS";

export type NodeProvenance = {
  documents: string[];
  extraction_source: string;
};

type NodeBase = {
  id: string;
  confidence: number;
  timestamp: string | null;
  provenance: NodeProvenance;
};

export type FactNode = NodeBase & {
  kind: "fact";
  subject: string;
  value: string;
  support_count: number;
  /** Explicit negation state ("affirmed" | "negated") when extraction recorded one. */
  polarity: string | null;
  /** `[start, end)` byte offsets of the matched span in the source clean text. */
  text_span: [number, number] | null;
  /** Sentence-level evidence (sorted, deduplicated). */
  evidence: string[];
};

export type DocumentNode = NodeBase & {
  kind: "document";
  source: string;
};

export type ContradictionNode = NodeBase & {
  kind: "contradiction";
  contradiction_id: string;
  domain: string;
  conflict_label: string;
  subject: string;
  severity_rank: number;
};

export type EntityNode = NodeBase & {
  kind: "entity";
  name: string;
  entity_kind: string;
};

export type GraphNode = FactNode | DocumentNode | ContradictionNode | EntityNode;

export type GraphEdge = {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  weight: number;
  reasoning: string;
  provenance: string;
};

export type GraphMetadata = {
  schema_version: string;
  contradiction_count: number;
  node_counts: Record<string, number>;
  edge_counts: Record<string, number>;
};

export type ContradictionGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: GraphMetadata;
};

/** Parse the JSON string returned by the `build_contradiction_graph` command. */
export function parseContradictionGraph(raw: string): ContradictionGraph {
  return JSON.parse(raw) as ContradictionGraph;
}

// ── Type guards ──────────────────────────────────────────────────────────────

export function isFactNode(n: GraphNode): n is FactNode {
  return n.kind === "fact";
}
export function isDocumentNode(n: GraphNode): n is DocumentNode {
  return n.kind === "document";
}
export function isContradictionNode(n: GraphNode): n is ContradictionNode {
  return n.kind === "contradiction";
}
export function isEntityNode(n: GraphNode): n is EntityNode {
  return n.kind === "entity";
}
