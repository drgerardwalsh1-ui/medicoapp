// Ordering-strategy contract — domain-specific ordering rules.
//
// A strategy owns the MEANING of order for one domain. It must not touch
// the DOM, attach event listeners, or know anything about React.
// Strategies are plain pure functions consumed by useOrderedList.
//
// Three strategies exist today (Household, History, Timeline). The
// interaction layer (usePointerReorderEngine) is reused across all
// reorderable domains; only this strategy layer changes per domain.

export type MoveArgs<TItem> = {
  items: TItem[];
  fromId: string;
  toId: string;
};

// Declarative reorder semantics. Previously these had to be INFERRED from
// move() behaviour (e.g. timeline's move() returning items unchanged) —
// which is fragile. Capabilities make the contract explicit and type-level:
// the engine and UI read these flags instead of guessing.
export type OrderingCapabilities = {
  /**
   * Whether list-level drag-to-reorder is supported at all. When false,
   * the interaction engine attaches no drag listeners and callers should
   * not render drag handles or cursor-grab affordances.
   */
  reorderable: boolean;
  /** Whether an item may be dragged from one group into another. */
  crossGroupMove?: boolean;
  /** Whether an item may be dragged across date buckets (History). */
  crossBucketMove?: boolean;
  /** Whether the strategy persists an explicit manual order (order_index). */
  manualOrdering?: boolean;
};

export type OrderingStrategy<TItem> = {
  /** Declarative reorder semantics — see OrderingCapabilities. */
  capabilities: OrderingCapabilities;

  /** Pure presentational sort. Must be deterministic and side-effect free. */
  sort: (items: TItem[]) => TItem[];

  /**
   * Produce a new array reflecting the user's drag from fromId → toId.
   * The strategy decides whether the move is allowed (e.g. same date
   * bucket only) and whether any order-state fields need updating.
   * Return the original array unchanged to reject the move.
   */
  move: (args: MoveArgs<TItem>) => TItem[];

  /** Optional side-effect — typically a wrapper around onChange in callers. */
  persist?: (items: TItem[]) => void;
};

// Standardised DOM contract for the interaction engine. ALL reorderable
// rows across the app expose these two attributes; the drag handle
// exposes data-reorder-handle. Legacy attributes (data-rel-id /
// data-history-* / data-zone="drag") are migrated away.
export const REORDER_ID_ATTR = "data-reorder-id";
export const REORDER_GROUP_ATTR = "data-reorder-group";
export const REORDER_HANDLE_ATTR = "data-reorder-handle";
