// Public surface for the centralised ordering engine.
//
// Architecture:
//   1. Interaction Engine (shared) — usePointerReorderEngine
//   2. Ordering Strategy (domain rules) — householdStrategy / historyStrategy / timelineStrategy
//   3. Ordered List Controller (composition) — useOrderedList
//
// Standard DOM contract: data-reorder-id, data-reorder-group, data-reorder-handle.

export type { OrderingStrategy, OrderingCapabilities, MoveArgs } from "./types";
export {
  REORDER_ID_ATTR,
  REORDER_GROUP_ATTR,
  REORDER_HANDLE_ATTR,
} from "./types";

export {
  usePointerReorderEngine,
} from "./usePointerReorderEngine";
export type {
  UsePointerReorderEngine,
  UsePointerReorderEngineProps,
  ReorderMove,
  HandleProps,
  RowProps,
} from "./usePointerReorderEngine";

export {
  useOrderedList,
} from "./useOrderedList";
export type {
  UseOrderedList,
  UseOrderedListProps,
} from "./useOrderedList";

export {
  sortHouseholdGroup,
  moveHouseholdGroup,
  resetHouseholdGroup,
  makeHouseholdStrategy,
  HOUSEHOLD_CAPABILITIES,
} from "./householdStrategy";
export type { HouseholdItem } from "./householdStrategy";

export {
  sortHistory,
  moveHistory,
  makeHistoryStrategy,
  HISTORY_CAPABILITIES,
} from "./historyStrategy";
export type { HistoryItem, HistoryStrategyOptions } from "./historyStrategy";

export {
  sortTimeline,
  makeTimelineStrategy,
  TIMELINE_CAPABILITIES,
} from "./timelineStrategy";
export type { TimelineItem } from "./timelineStrategy";
