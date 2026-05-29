// Household ordering strategy — manual-first override of semantic auto-sort.
//
// Semantics preserved from the original RelationshipManager:
//   - If ANY item in a group has order_mode === "manual", the entire
//     group is sorted by order_index ascending.
//   - Otherwise, partner groups use the deceased→ex→separated→current
//     priority; everything else sorts by age descending with ageless last.
//   - Drag-to-reorder converts the group to manual mode and re-stamps
//     order_index sequentially.
//
// order_index lives on the Relationship entity as persisted domain data.
// This strategy is the ONLY place that field is read or written.

import type { OrderingStrategy, OrderingCapabilities } from "./types";

// Household: manual reorder within a group; never across groups; explicit
// order_index persistence.
export const HOUSEHOLD_CAPABILITIES: OrderingCapabilities = {
  reorderable: true,
  crossGroupMove: false,
  manualOrdering: true,
};

// Minimal shape required by the strategy. We accept a structural subtype
// so RelationshipManager doesn't need to import this module solely to
// share its full Relationship type.
type AgeValue = { value: number; unit: "yr" | "mo" } | null;

export type HouseholdItem = {
  id: string;
  base_type: string;
  status?: string[];
  age?: AgeValue;
  order_mode?: "auto" | "manual";
  order_index?: number;
};

function ageToMonths(age: AgeValue | undefined): number {
  if (!age) return -1;
  return age.unit === "yr" ? age.value * 12 : age.value;
}

function getPartnerPriority(r: HouseholdItem): number {
  const s = r.status ?? [];
  if (s.includes("Deceased")) return 4;
  if (s.includes("Ex")) return 3;
  if (s.includes("Separated")) return 2;
  return 1;
}

function isGroupManual(items: HouseholdItem[]): boolean {
  return items.some((r) => r.order_mode === "manual");
}

/**
 * Sort a single household group. Group identity = `base_type`. The
 * caller is responsible for filtering items down to a single group
 * before calling sort — this matches RelationshipManager's prior
 * `sortGroup(rels.filter(... === bt), bt)` usage.
 */
export function sortHouseholdGroup<T extends HouseholdItem>(items: T[]): T[] {
  if (items.length === 0) return items;
  if (isGroupManual(items)) {
    return [...items].sort(
      (a, b) => (a.order_index ?? 9999) - (b.order_index ?? 9999)
    );
  }
  const bt = items[0].base_type;
  if (bt === "partner") {
    return [...items].sort(
      (a, b) => getPartnerPriority(a) - getPartnerPriority(b)
    );
  }
  return [...items].sort((a, b) => {
    const am = ageToMonths(a.age);
    const bm = ageToMonths(b.age);
    if (am === -1 && bm === -1) return 0;
    if (am === -1) return 1;
    if (bm === -1) return -1;
    return bm - am;
  });
}

/**
 * Apply a drag from fromId → toId. Both must belong to the same group
 * (same base_type). On success, every member of the group is stamped
 * with order_mode: "manual" and a fresh order_index. Items outside the
 * group are left untouched.
 */
export function moveHouseholdGroup<T extends HouseholdItem>(
  items: T[],
  fromId: string,
  toId: string
): T[] {
  if (fromId === toId) return items;
  const from = items.find((r) => r.id === fromId);
  const to = items.find((r) => r.id === toId);
  if (!from || !to) return items;
  if (from.base_type !== to.base_type) return items;
  const bt = from.base_type;

  // Reorder within the group's CURRENT visual order (so the user's
  // drag matches what they see on screen — auto-sorted groups become
  // manual at the splice positions, not at insertion-order positions).
  const groupSorted = sortHouseholdGroup(items.filter((r) => r.base_type === bt));
  const fromIdx = groupSorted.findIndex((r) => r.id === fromId);
  const toIdx = groupSorted.findIndex((r) => r.id === toId);
  if (fromIdx === -1 || toIdx === -1) return items;

  const reordered = [...groupSorted];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);

  const stamp = new Map(reordered.map((r, i) => [r.id, i]));
  return items.map((r) => {
    if (r.base_type !== bt) return r;
    return {
      ...r,
      order_mode: "manual" as const,
      order_index: stamp.get(r.id) ?? 0,
    };
  });
}

/**
 * Reset a single group back to auto-sort. Clears order_index on every
 * member; the next render reverts to semantic ordering.
 */
export function resetHouseholdGroup<T extends HouseholdItem>(
  items: T[],
  base_type: string
): T[] {
  return items.map((r) =>
    r.base_type === base_type
      ? { ...r, order_mode: "auto" as const, order_index: undefined }
      : r
  );
}

/**
 * Factory: build a strategy bound to a specific group (base_type).
 * useOrderedList consumes one strategy per group instance.
 */
export function makeHouseholdStrategy<T extends HouseholdItem>(): OrderingStrategy<T> {
  return {
    capabilities: HOUSEHOLD_CAPABILITIES,
    sort: sortHouseholdGroup,
    move: ({ items, fromId, toId }) => moveHouseholdGroup(items, fromId, toId),
  };
}
