// ── Phase 14 — Forensic Replay Evolution (pure, multi-snapshot, structural) ────
// Compares a chronological sequence of ClinicalReportExportV1 objects and
// produces a deterministic evolution map. Uses the Phase-13 diff engine for
// per-step comparisons; never reimplements diff logic and never recomputes
// cryptographic hashes (the authoritative snapshot hash already present in
// each export is used as identity).

import type { ClinicalReportExportV1 } from "./clinicalReportSerializer";
import { diffClinicalReports, type ClinicalReportDiffV1 } from "./clinicalReportDiff";

export type ClinicalReplayDiffV1 = {
  readonly steps: ReadonlyArray<{
    readonly fromHash: string;
    readonly toHash: string;
    readonly structuralDiff: ClinicalReportDiffV1;
  }>;
  readonly invariantPaths: readonly string[];
  readonly volatilePaths: readonly string[];
  readonly identicalAcrossAll: boolean;
};

// ── Leaf-path enumerator (traversal only — not diff logic) ────────────────────
// Canonical-sorted key order, [i] for arrays, undefined-as-absent (mirrors the
// rules already used by Phases 11 and 13). Records leaf values (primitives /
// null) per report index so classification can compare across the full sequence.
function enumerateLeaves(
  value: unknown,
  path: string,
  idx: number,
  total: number,
  values: Map<string, unknown[]>,
  presence: Map<string, boolean[]>,
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      enumerateLeaves(value[i], `${path}[${i}]`, idx, total, values, presence);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    for (const k of keys) {
      enumerateLeaves(obj[k], path ? `${path}.${k}` : k, idx, total, values, presence);
    }
    return;
  }
  // Leaf (primitive or null)
  if (!values.has(path)) {
    values.set(path, new Array(total).fill(undefined));
    presence.set(path, new Array(total).fill(false));
  }
  values.get(path)![idx] = value;
  presence.get(path)![idx] = true;
}

function identityHash(r: ClinicalReportExportV1): string {
  // Use the snapshot hash already carried in the export (Phase 7 lineage).
  // Per Phase 14 spec we do not recompute hashes here.
  return r.audit.snapshotHash;
}

const lex = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function diffClinicalReportSequence(
  reports: readonly ClinicalReportExportV1[],
): ClinicalReplayDiffV1 {
  // ── Stepwise structural diffs (delegated to Phase 13) ────────────────────────
  const steps = [];
  for (let i = 0; i + 1 < reports.length; i++) {
    const base = reports[i];
    const target = reports[i + 1];
    steps.push({
      fromHash: identityHash(base),
      toHash: identityHash(target),
      structuralDiff: diffClinicalReports(base, target),
    });
  }

  // ── Path classification across the FULL sequence ────────────────────────────
  const values = new Map<string, unknown[]>();
  const presence = new Map<string, boolean[]>();
  for (let i = 0; i < reports.length; i++) {
    enumerateLeaves(reports[i], "", i, reports.length, values, presence);
  }

  const invariant: string[] = [];
  const volatile: string[] = [];
  for (const [path, pres] of presence) {
    const vals = values.get(path)!;
    const allPresent = pres.every(Boolean);
    if (!allPresent) {
      volatile.push(path); // existence changes across the sequence
      continue;
    }
    const first = vals[0];
    const allEqual = vals.every((v) => Object.is(v, first));
    (allEqual ? invariant : volatile).push(path);
  }

  invariant.sort(lex);
  volatile.sort(lex);

  const identicalAcrossAll =
    reports.length <= 1 || steps.every((s) => s.structuralDiff.identical);

  return {
    steps,
    invariantPaths: invariant,
    volatilePaths: volatile,
    identicalAcrossAll,
  };
}
