// History ordering strategy — chronology is the backbone.
//
// Rules:
//   - PRIMARY: chronological by partial date.
//   - SECONDARY: items sharing the SAME date bucket may be manually
//     reordered among themselves. Drags across buckets are rejected.
//   - Unknown / missing dates form their own bucket (sort key = Infinity).
//   - No order_index field is introduced. Manual within-bucket order is
//     encoded purely by array position: when two items share a bucket
//     and the user drags one over the other, we splice within the array
//     positions of that bucket. Because the sort is stable, splice order
//     becomes the visual order for tied dates.
//
// This deliberately matches the audit's "what should happen" conclusion:
// chronology wins, manual order operates only inside same-date ties.

import type { OrderingStrategy, OrderingCapabilities } from "./types";
import { partialDateSortKey, type PartialDate } from "../types/history";

// History: reorder allowed only within the same date bucket; never across
// groups; chronology is the backbone so there is no explicit manual order.
export const HISTORY_CAPABILITIES: OrderingCapabilities = {
  reorderable: true,
  crossGroupMove: false,
  crossBucketMove: false,
  manualOrdering: false,
};

// Minimal shape — accepts any history entity that carries an id and an
// optional partial date. Specific entity types (HistoryEvent /
// TreatmentEntry / etc.) supply this shape via their own date field.

export type HistoryItem = {
  id: string;
  // Each entity uses a different date field name. The strategy is
  // parameterised on a getDate accessor rather than hard-coding one.
};

function bucketKeyFor(d: PartialDate | undefined): number {
  // Tie items into the same bucket only when their full (year, month,
  // day) tuple matches. partialDateSortKey already encodes this.
  return partialDateSortKey(d);
}

export type HistoryStrategyOptions<T extends HistoryItem> = {
  /** Extract the partial date for an item. Strategy never assumes a field name. */
  getDate: (item: T) => PartialDate | undefined;
};

/** Stable chronological sort. Used by useOrderedList for presentation. */
export function sortHistory<T extends HistoryItem>(
  items: T[],
  getDate: (item: T) => PartialDate | undefined
): T[] {
  // Pair items with their original index so the JS sort stays stable
  // for ties (V8 is stable as of 2019, but pairing makes intent explicit
  // and keeps behaviour identical across runtimes).
  return items
    .map((item, idx) => ({ item, idx, key: bucketKeyFor(getDate(item)) }))
    .sort((a, b) => {
      if (a.key !== b.key) return a.key - b.key;
      return a.idx - b.idx;
    })
    .map((p) => p.item);
}

/**
 * Move within the same date bucket only. Cross-bucket drags are
 * rejected (return items unchanged). Within a bucket, splice-reorder
 * the underlying array so that subsequent stable sorts preserve the
 * new visual order.
 */
export function moveHistory<T extends HistoryItem>(
  items: T[],
  fromId: string,
  toId: string,
  getDate: (item: T) => PartialDate | undefined
): T[] {
  if (fromId === toId) return items;
  const from = items.find((i) => i.id === fromId);
  const to = items.find((i) => i.id === toId);
  if (!from || !to) return items;
  if (bucketKeyFor(getDate(from)) !== bucketKeyFor(getDate(to))) return items;

  // Splice in the items array (not the sorted slice) — chronology is
  // re-applied on every render via sort(), so what matters is the
  // relative order of the two items within the items array.
  const next = [...items];
  const fromIdx = next.findIndex((i) => i.id === fromId);
  const toIdx = next.findIndex((i) => i.id === toId);
  if (fromIdx === -1 || toIdx === -1) return items;
  const [moved] = next.splice(fromIdx, 1);
  // After splice-out the target index shifts left by one when the source
  // was earlier in the array. Compute the canonical insertion index.
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
  next.splice(insertAt, 0, moved);
  return next;
}

/** Factory: bind a strategy to a specific date accessor. */
export function makeHistoryStrategy<T extends HistoryItem>(
  opts: HistoryStrategyOptions<T>
): OrderingStrategy<T> {
  return {
    capabilities: HISTORY_CAPABILITIES,
    sort: (items) => sortHistory(items, opts.getDate),
    move: ({ items, fromId, toId }) =>
      moveHistory(items, fromId, toId, opts.getDate),
  };
}
