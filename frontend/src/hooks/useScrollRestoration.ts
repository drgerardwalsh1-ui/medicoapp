import { useCallback, useEffect, useRef } from "react";
import type { RefCallback } from "react";

// ── Storage ──────────────────────────────────────────────────────────────────
//
// Positions live in an in-memory Map (the source of truth during a session)
// plus a sessionStorage mirror so they survive route remounts and full page
// refreshes during the same session. Cleared automatically on tab close.

type ScrollPosition = {
  top: number;
  left: number;
};

const STORAGE_KEY = "scroll-restoration:v1";
const positions = new Map<string, ScrollPosition>();
const DEBUG =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

// Time window after a node attaches during which we keep retrying the
// restore. After this window expires we stop, so the user can scroll
// freely without our retries pulling them back.
const RESTORE_WINDOW_MS = 1500;

let hydrated = false;
function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, ScrollPosition>;
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v &&
        typeof v === "object" &&
        typeof v.top === "number" &&
        typeof v.left === "number"
      ) {
        positions.set(k, v);
      }
    }
  } catch {
    // sessionStorage may throw under quota or sandbox — fall back to memory only.
  }
}

let persistRafId: number | null = null;
function persist() {
  if (typeof window === "undefined") return;
  if (persistRafId !== null) return;
  persistRafId = requestAnimationFrame(() => {
    persistRafId = null;
    try {
      const obj: Record<string, ScrollPosition> = {};
      for (const [k, v] of positions) obj[k] = v;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignore quota errors
    }
  });
}

function writePosition(key: string, pos: ScrollPosition) {
  positions.set(key, pos);
  persist();
  if (DEBUG) console.log("scroll save", key, pos.top);
}

function readPosition(key: string): ScrollPosition {
  return positions.get(key) ?? { top: 0, left: 0 };
}

// Flush positions to sessionStorage when the tab is hidden or closed.
// Covers the "user closes the tab mid-scroll" case where the rAF-scheduled
// persist hasn't run yet.
if (typeof window !== "undefined") {
  hydrateOnce();
  const flush = () => {
    if (persistRafId !== null) {
      cancelAnimationFrame(persistRafId);
      persistRafId = null;
    }
    try {
      const obj: Record<string, ScrollPosition> = {};
      for (const [k, v] of positions) obj[k] = v;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  };
  window.addEventListener("pagehide", flush);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────
//
// `useScrollRestoration(scrollKey)` returns a stable callback ref. Attach it
// to the scrollable element (`<div ref={scrollRef}>`). The callback ref fires
// when the DOM node is actually attached or replaced — which is the only
// reliable signal that the scrollable target exists. We don't rely on
// `useEffect([ref])` (refs don't trigger effects) or on `ref.current` polling.
//
// Lifecycle:
//   - Attach (node arrives):
//       1. wire a scroll listener (rAF-throttled save)
//       2. read saved position for the current key and apply it
//       3. retry on rAF + ResizeObserver until either the position is
//          reached or the restore window elapses
//   - Detach / node replaced:
//       1. save the OLD node's position under the OLD key
//       2. tear down listener, observers, pending rAF
//   - Key change (same node stays mounted):
//       1. save under the previous key
//       2. restore from the new key
//
// `scrollKey` may be null/undefined — the hook is then a no-op (still returns
// a stable ref) so callers can mount the ref before the key is known.
export function useScrollRestoration<T extends HTMLElement>(
  scrollKey: string | null | undefined,
): RefCallback<T> {
  // Always-current key for handlers attached once at mount time.
  const keyRef = useRef<string | null | undefined>(scrollKey);

  // Per-element bookkeeping. We hold the currently-attached node and the
  // teardown closure here so the callback ref can find them on detach.
  type Attached = {
    node: T;
    cleanup: () => void;
  };
  const attachedRef = useRef<Attached | null>(null);

  // Apply a saved position to a node, retrying across rAF + ResizeObserver
  // until we either match the target or run out of time. We restart this
  // loop on attach AND on key change.
  function startRestore(node: T, key: string): () => void {
    const target = readPosition(key);
    const start = Date.now();
    let rafId: number | null = null;
    let finished = false;

    const attempt = () => {
      rafId = null;
      if (finished) return;
      if (Date.now() - start > RESTORE_WINDOW_MS) {
        finished = true;
        return;
      }
      // Apply unconditionally on each attempt — content may have grown
      // since the last attempt, so the same `scrollTo` can now reach
      // further into the page.
      node.scrollTo({ top: target.top, left: target.left, behavior: "auto" });
      const closeEnough =
        Math.abs(node.scrollTop - target.top) < 1 &&
        Math.abs(node.scrollLeft - target.left) < 1;
      if (closeEnough) {
        finished = true;
        if (DEBUG) console.log("scroll restore", key, target.top);
        return;
      }
      rafId = requestAnimationFrame(attempt);
    };

    rafId = requestAnimationFrame(attempt);

    // ResizeObserver: when the content height grows (async data load),
    // try again — but still respect the restore window so we eventually
    // stop and let the user own the scroll.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (finished) return;
        if (Date.now() - start > RESTORE_WINDOW_MS) {
          finished = true;
          ro?.disconnect();
          return;
        }
        if (rafId === null) rafId = requestAnimationFrame(attempt);
      });
      ro.observe(node);
    }

    return () => {
      finished = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
  }

  // Wire a node up: scroll listener + initial restore. Returns a teardown
  // that also captures the final scroll position under the current key.
  function attach(node: T): () => void {
    let saveRafId: number | null = null;
    const onScroll = () => {
      if (saveRafId !== null) return;
      saveRafId = requestAnimationFrame(() => {
        saveRafId = null;
        const k = keyRef.current;
        if (!k) return;
        writePosition(k, { top: node.scrollTop, left: node.scrollLeft });
      });
    };
    node.addEventListener("scroll", onScroll, { passive: true });

    const key = keyRef.current;
    let cancelRestore: (() => void) | null = key ? startRestore(node, key) : null;

    return () => {
      node.removeEventListener("scroll", onScroll);
      if (saveRafId !== null) cancelAnimationFrame(saveRafId);
      cancelRestore?.();
      cancelRestore = null;
      const k = keyRef.current;
      if (k) {
        writePosition(k, { top: node.scrollTop, left: node.scrollLeft });
      }
    };
  }

  // Stable callback ref. React will call it with `null` first when
  // detaching the old node, then with the new node. We treat any node
  // change (including null → node and node → null) symmetrically.
  const refCallback = useCallback<RefCallback<T>>((node) => {
    const prev = attachedRef.current;
    if (prev && prev.node !== node) {
      prev.cleanup();
      attachedRef.current = null;
    }
    if (node && (!prev || prev.node !== node)) {
      attachedRef.current = { node, cleanup: attach(node) };
    }
    // If `node === prev.node` (rare — React doesn't normally call with
    // the same node twice), leave the existing attachment in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle key change on a still-mounted node. The callback ref does NOT
  // fire on prop changes, so without this effect a stable scroll
  // container (e.g. AppLayout's <main> when view switches) would never
  // re-restore for the new key.
  useEffect(() => {
    const prevKey = keyRef.current;
    keyRef.current = scrollKey;
    const attached = attachedRef.current;
    if (!attached) return;
    if (prevKey && prevKey !== scrollKey) {
      writePosition(prevKey, {
        top: attached.node.scrollTop,
        left: attached.node.scrollLeft,
      });
    }
    if (scrollKey && scrollKey !== prevKey) {
      const cancel = startRestore(attached.node, scrollKey);
      return cancel;
    }
  }, [scrollKey]);

  return refCallback;
}
