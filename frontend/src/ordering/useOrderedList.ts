// useOrderedList — composition hook binding raw data + strategy.
//
// This is the layer callers consume. It:
//   1. Memoises strategy.sort(items) for presentation.
//   2. Provides a typed onMove({ fromId, toId }) that delegates to
//      strategy.move and fires onChange with the result.
//
// Drag UI mechanics live in usePointerReorderEngine, NOT here.

import { useMemo } from "react";
import type { OrderingStrategy } from "./types";

export type UseOrderedListProps<TItem> = {
  items: TItem[];
  strategy: OrderingStrategy<TItem>;
  /** Called when the strategy produces a new array. */
  onChange: (next: TItem[]) => void;
};

export type UseOrderedList<TItem> = {
  /** Items in presentation order (strategy.sort applied). */
  items: TItem[];
  /** Apply a drag → strategy.move → onChange. */
  onMove: (fromId: string, toId: string) => void;
};

export function useOrderedList<TItem>({
  items,
  strategy,
  onChange,
}: UseOrderedListProps<TItem>): UseOrderedList<TItem> {
  const sorted = useMemo(() => strategy.sort(items), [items, strategy]);
  function onMove(fromId: string, toId: string) {
    const next = strategy.move({ items, fromId, toId });
    if (next === items) return; // strategy rejected the move
    onChange(next);
    strategy.persist?.(next);
  }
  return { items: sorted, onMove };
}
