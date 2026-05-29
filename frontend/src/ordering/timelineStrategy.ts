// Timeline ordering strategy — pure time-driven sort.
//
// WorkTimeline (and the appointment calendar) never expose a list-level
// reorder. Drag in those views mutates an entity's startUtc/endUtc, and
// the list re-sorts as a side effect. This strategy formalises that:
//   - sort by startUtc ascending
//   - move() is a no-op — list reordering is not a supported operation
//
// Provided so callers can plug into useOrderedList uniformly. The
// pointer-reorder engine is NOT wired up for timeline rows; the calendar
// has its own time-positioning gesture (CalendarGrid.tsx) that is
// orthogonal to list ordering.

import type { OrderingStrategy, OrderingCapabilities } from "./types";

// Timeline: list reorder is intentionally unsupported — chronology by
// startUtc is canonical and the only way to change order is to change a
// date. Declared explicitly so the engine attaches no drag listeners.
export const TIMELINE_CAPABILITIES: OrderingCapabilities = {
  reorderable: false,
  manualOrdering: false,
};

export type TimelineItem = {
  id: string;
  startedAtUtc: string; // ISO 8601 UTC; lexicographic compare matches chronological order
};

export function sortTimeline<T extends TimelineItem>(items: T[]): T[] {
  return [...items].sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc));
}

export function makeTimelineStrategy<T extends TimelineItem>(): OrderingStrategy<T> {
  return {
    capabilities: TIMELINE_CAPABILITIES,
    sort: sortTimeline,
    // Reorder is a no-op: chronology is canonical. Returning items
    // unchanged is the documented "reject move" signal.
    move: ({ items }) => items,
  };
}
