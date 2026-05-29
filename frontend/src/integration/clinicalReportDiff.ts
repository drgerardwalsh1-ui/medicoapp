// ── Phase 13 — Forensic Replay Diff (pure structural, no interpretation) ───────
// Deterministic structural comparison of two ClinicalReportExportV1 objects.
// It NEVER interprets clinical meaning — it only reports what bytes changed.
//
// Allowed imports only: the export type (structural recursion handles the rest).

import type { ClinicalReportExportV1 } from "./clinicalReportSerializer";

export type ClinicalReportDiffV1 = {
  readonly changedSections: ReadonlyArray<{
    readonly section: string;
    readonly path: string;
    readonly before?: unknown;
    readonly after?: unknown;
  }>;
  readonly addedFields: ReadonlyArray<{ readonly path: string; readonly value: unknown }>;
  readonly removedFields: ReadonlyArray<{ readonly path: string; readonly value: unknown }>;
  readonly identical: boolean;
};

// ── helpers ────────────────────────────────────────────────────────────────────
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sectionOf(path: string): string {
  const m = path.match(/^([^.[]+)/);
  return m ? m[1] : path;
}

function isPresent(v: unknown): boolean {
  return v !== undefined;
}

// Deep equality with canonical-style semantics:
//  - undefined ≠ null
//  - object keys filtered to present-only (undefined values treated as absent)
//  - arrays compared index-by-index
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a).filter((k) => a[k] !== undefined).sort();
    const bk = Object.keys(b).filter((k) => b[k] !== undefined).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

type Change = { section: string; path: string; before?: unknown; after?: unknown };
type Field = { path: string; value: unknown };

function walk(
  base: unknown,
  target: unknown,
  path: string,
  changed: Change[],
  added: Field[],
  removed: Field[],
): void {
  // Arrays — index-by-index (observations + differential members rule)
  if (Array.isArray(base) && Array.isArray(target)) {
    const len = Math.max(base.length, target.length);
    for (let i = 0; i < len; i++) {
      const subPath = `${path}[${i}]`;
      const aHas = i < base.length;
      const bHas = i < target.length;
      if (aHas && !bHas) removed.push({ path: subPath, value: base[i] });
      else if (!aHas && bHas) added.push({ path: subPath, value: target[i] });
      else walk(base[i], target[i], subPath, changed, added, removed);
    }
    return;
  }
  // Objects — union of keys with canonical sort; undefined keys treated as absent
  if (isPlainObject(base) && isPlainObject(target)) {
    const keys = new Set<string>();
    for (const k of Object.keys(base)) if (isPresent(base[k])) keys.add(k);
    for (const k of Object.keys(target)) if (isPresent(target[k])) keys.add(k);
    const sorted = [...keys].sort();
    for (const k of sorted) {
      const subPath = path ? `${path}.${k}` : k;
      const aHas = isPresent(base[k]);
      const bHas = isPresent(target[k]);
      if (aHas && !bHas) removed.push({ path: subPath, value: base[k] });
      else if (!aHas && bHas) added.push({ path: subPath, value: target[k] });
      else walk(base[k], target[k], subPath, changed, added, removed);
    }
    return;
  }
  // Type mismatch or primitives — report as changed leaf.
  if (!deepEqual(base, target)) {
    changed.push({ section: sectionOf(path) || "(root)", path, before: base, after: target });
  }
}

function byPath<T extends { path: string }>(arr: T[]): T[] {
  return arr.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function diffClinicalReports(
  base: ClinicalReportExportV1,
  target: ClinicalReportExportV1,
): ClinicalReportDiffV1 {
  const changed: Change[] = [];
  const added: Field[] = [];
  const removed: Field[] = [];
  walk(base, target, "", changed, added, removed);
  return {
    changedSections: byPath(changed),
    addedFields: byPath(added),
    removedFields: byPath(removed),
    identical: changed.length === 0 && added.length === 0 && removed.length === 0,
  };
}
