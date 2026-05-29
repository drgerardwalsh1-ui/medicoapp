// ── Legal-grade snapshot builder (read-only derive, NOT a command) ─────────────
// Builds a ReportSnapshot fully reconstructable from ClinicalState + ontology.
// Canonicalisation rule: object keys are sorted recursively, undefined values
// dropped, and every array is given a deterministic order here in the engine —
// so the contentHash is byte-for-byte stable across rebuilds and restarts.

import type { Ontology } from "../types/ontology";
import type { ReportSnapshot } from "../types/review";
import type { ClinicalState } from "./state";
import { latestObservations, runRecompute } from "./state";

// ── Canonical JSON ──────────────────────────────────────────────────────────────
// Stable key ordering; undefined omitted; no reliance on JS object iteration
// order. Arrays are emitted in given order (callers pre-sort deterministically).
export function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k])).join(",") + "}";
  }
  return "null";
}

// Deterministic, dependency-free 53-bit hash (cyrb53) → hex. Pure function of
// the canonical string; no crypto/runtime dependency.
export function contentHash(canonical: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

function by<T>(key: (x: T) => string) {
  return (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

export type SnapshotMeta = {
  readonly id: string;
  readonly takenAt: string;
  readonly takenBy: string;
};

export function buildSnapshot(
  state: ClinicalState,
  ontology: Ontology,
  meta: SnapshotMeta,
): ReportSnapshot {
  const r = runRecompute(state, ontology);

  // Deterministic array ordering (engine-defined, no floating ambiguity).
  const observations = [...latestObservations(state)].sort(by((o) => o.id));
  const attestations = [...state.attestations].sort(by((a) => a.id));
  const resolutions = [...state.resolutions].sort(by((x) => x.conflictId + "|" + x.observationId));
  const corrections = [...state.corrections].sort(by((c) => canonicalJSON(c)));
  const conclusions = [...state.conclusions].sort(by((c) => c.diagnosisId + "|" + (c.episodeId ?? "")));
  const evidence = [...r.evidence].sort(by((e) => e.id));
  const suggestions = [...r.suggestions].sort(by((s) => s.diagnosisId + "|" + s.criterionId));
  const candidacies = [...r.candidacies].sort(by((c) => c.diagnosisId));
  const episodes = [...r.episodes].sort(by((e) => e.id));
  const memberships = [...r.memberships].sort(by((m) => m.episodeId + "|" + m.observationId));
  const conflicts = [...r.conflicts].sort(by((c) => c.id));

  const body = {
    id: meta.id,
    dsmVersion: "DSM-5-TR" as const,
    takenAt: meta.takenAt,
    takenBy: meta.takenBy,
    observations,
    attestations,
    resolutions,
    corrections,
    conclusions,
    evidence,
    suggestions,
    candidacies,
    episodes,
    memberships,
    conflicts,
  };

  return { ...body, contentHash: contentHash(canonicalJSON(body)) };
}
