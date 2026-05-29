// usePointerReorderEngine — shared pointer-drag mechanics.
//
// This hook ONLY handles pointer-drag interaction:
//   - pointerdown capture on the drag handle
//   - document-level pointermove + pointerup
//   - elementFromPoint → closest(REORDER_ID_ATTR) target resolution
//   - same-group enforcement (drop rejected if groups differ)
//   - drag UI state exposed through getHandleProps(id)
//
// It does NOT sort data, mutate arrays, or know anything about dates,
// order_index, or buckets. Domain rules live in OrderingStrategy.
//
// Replaces the duplicated pointer-drag implementations previously
// embedded in RelationshipManager.startPointerDrag and
// HistoryEditor.EntityGroup.startDrag.

import { useRef, useState } from "react";
import {
  REORDER_ID_ATTR,
  REORDER_GROUP_ATTR,
  REORDER_HANDLE_ATTR,
} from "./types";

export type ReorderMove<TId extends string = string> = {
  fromId: TId;
  toId: TId;
  group: string;
};

export type UsePointerReorderEngineProps<TId extends string = string> = {
  /**
   * DOM → id extractor. Defaults to reading `data-reorder-id` on the
   * nearest ancestor. Callers may override to enforce stricter scoping
   * (e.g. only consider rows inside a specific container).
   */
  getId?: (el: Element) => TId | null;
  /** DOM → group extractor. Defaults to `data-reorder-group`. */
  getGroup?: (el: Element) => string | null;
  /** Called when a valid same-group drop occurs. */
  onMove: (args: ReorderMove<TId>) => void;
  /**
   * Strategy capability gate — pass `strategy.capabilities.reorderable`.
   * When false the engine attaches NO drag listeners and getHandleProps
   * returns an inert handle. Defaults to true.
   */
  reorderable?: boolean;
};

export type HandleProps = {
  onPointerDown: (e: React.PointerEvent) => void;
  isDragging: boolean;
  isDragOver: boolean;
  [attr: string]: unknown;
};

export type RowProps = {
  [attr: string]: string;
};

export type UsePointerReorderEngine<TId extends string = string> = {
  /**
   * Attach to the reorderable row container. Returns the standard
   * `data-reorder-id` + `data-reorder-group` attributes so the engine
   * can resolve drop targets without callers managing attribute names.
   */
  getRowProps: (id: TId, group: string) => RowProps;
  /**
   * Attach to the drag handle element. The handle is the ONLY element
   * that initiates a drag (not the whole row) — callers wire this to a
   * dedicated grip / ⠿ control.
   */
  getHandleProps: (id: TId) => HandleProps;
  /** Active drag source id, or null. Useful for global cursor/styling. */
  draggingId: TId | null;
  /** Current drop-target id under the pointer, or null. */
  dragOverId: TId | null;
};

const defaultGetId = (el: Element): string | null =>
  (el as HTMLElement).getAttribute?.(REORDER_ID_ATTR) ?? null;

const defaultGetGroup = (el: Element): string | null =>
  (el as HTMLElement).getAttribute?.(REORDER_GROUP_ATTR) ?? null;

export function usePointerReorderEngine<TId extends string = string>({
  getId = defaultGetId as (el: Element) => TId | null,
  getGroup = defaultGetGroup,
  onMove,
  reorderable = true,
}: UsePointerReorderEngineProps<TId>): UsePointerReorderEngine<TId> {
  // Source is kept in a ref so document-level listeners don't capture
  // stale state. Mirror state is only for UI feedback.
  const dragRef = useRef<{ id: TId; group: string } | null>(null);
  const [draggingId, setDraggingId] = useState<TId | null>(null);
  const [dragOverId, setDragOverId] = useState<TId | null>(null);

  function resolveTarget(ev: PointerEvent): { id: TId; group: string } | null {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el) return null;
    const row =
      (el.closest(`[${REORDER_ID_ATTR}]`) as Element | null) ?? null;
    if (!row) return null;
    const id = getId(row);
    const group = getGroup(row);
    if (!id || !group) return null;
    return { id, group };
  }

  function start(id: TId, group: string, e: React.PointerEvent) {
    // Hard gate — a non-reorderable strategy must never attach listeners.
    if (!reorderable) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id, group };
    setDraggingId(id);

    const onPointerMove = (ev: PointerEvent) => {
      const tgt = resolveTarget(ev);
      // Constrain visual feedback to same-group hits only — matches the
      // drop rule below so the ring never falsely advertises a valid drop.
      if (tgt && tgt.group === group) setDragOverId(tgt.id);
      else setDragOverId(null);
    };

    const onPointerUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      const tgt = resolveTarget(ev);
      const src = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      setDragOverId(null);
      if (
        src &&
        tgt &&
        tgt.id !== src.id &&
        tgt.group === src.group
      ) {
        onMove({ fromId: src.id, toId: tgt.id, group: src.group });
      }
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  return {
    getRowProps: (id, group) => ({
      [REORDER_ID_ATTR]: id,
      [REORDER_GROUP_ATTR]: group,
    }),
    getHandleProps: (id) => {
      // Non-reorderable strategy → inert handle: no attribute, no-op
      // pointerdown. Callers should also skip rendering the handle, but
      // this guarantees safety even if they don't.
      if (!reorderable) {
        return {
          onPointerDown: () => undefined,
          isDragging: false,
          isDragOver: false,
        };
      }
      // Reading group lazily off the row at pointerdown time keeps the
      // hook ignorant of where the group string lives in caller state.
      return {
        [REORDER_HANDLE_ATTR]: "true",
        onPointerDown: (e: React.PointerEvent) => {
          const row = (e.currentTarget as HTMLElement).closest(
            `[${REORDER_ID_ATTR}]`
          );
          const group = row ? getGroup(row) : null;
          if (!group) return;
          start(id, group, e);
        },
        isDragging: draggingId === id,
        isDragOver: dragOverId === id && draggingId !== id,
      };
    },
    draggingId,
    dragOverId,
  };
}
