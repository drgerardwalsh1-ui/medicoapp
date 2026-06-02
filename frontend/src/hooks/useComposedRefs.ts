import { useCallback, useRef } from "react";
import type { MutableRefObject, RefCallback } from "react";

// Either form of ref React supports.
export type AnyRef<T> =
  | RefCallback<T>
  | MutableRefObject<T | null>
  | null
  | undefined;

/**
 * Compose multiple refs into a single callback ref. Useful when a node
 * needs to be observed by more than one hook (e.g. an existing layout
 * ref + the scroll-restoration callback ref).
 *
 * The returned callback ref is stable across renders: we read the
 * latest input refs from a ref of their own so callers don't need to
 * memoise their arguments.
 */
export function useComposedRefs<T>(...refs: AnyRef<T>[]): RefCallback<T> {
  const refsRef = useRef(refs);
  refsRef.current = refs;
  return useCallback((node: T | null) => {
    for (const ref of refsRef.current) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(node);
      } else {
        (ref as MutableRefObject<T | null>).current = node;
      }
    }
  }, []);
}
