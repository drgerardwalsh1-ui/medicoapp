/**
 * DocumentsSection — generic, future-proof section-management layer for the
 * Documents UI (DemographicsPage → DocumentCard).
 *
 * Two responsibilities, deliberately decoupled:
 *
 *   1. EXPAND / COLLAPSE ALL  (broadcast control)
 *      A tiny ref-backed external store holds only `{ defaultOpen, bulkNonce }`.
 *      `expandAll()` / `collapseAll()` flip `defaultOpen` and bump `bulkNonce`.
 *      Each <CollapsibleSection> subscribes via `useSyncExternalStore` and
 *      re-syncs its LOCAL open state whenever `bulkNonce` changes — so a bulk
 *      action re-renders only the sections, never the cards or the page
 *      (no context-value churn, no re-render storm). Between bulk actions each
 *      section is independently toggleable.
 *
 *      Future-proofing: there is NO per-section wiring and NO hardcoded section
 *      names. Any new collapsible added inside a DocumentCard participates
 *      automatically simply by being a <CollapsibleSection>. A section mounted
 *      AFTER a bulk action reads the current `defaultOpen` as its initial state,
 *      so it joins the prevailing expand/collapse posture with zero extra code.
 *
 *   2. SECTION REGISTRY  (ancillary only)
 *      Sections self-register `{ key, docId, sectionId, title, kind }` on mount.
 *      This registry is NOT on the critical path for expand/collapse (broadcast
 *      handles that) and NOT used for export (export is model-driven — see
 *      lib/documentExport.ts). It exists for counts, dev tooling, and future
 *      per-section features.
 *
 * Accessibility: <CollapsibleSection> wraps a NATIVE <details>/<summary>, so
 * keyboard toggling, focus, and `aria-expanded` semantics come for free; we
 * only control the `open` attribute and mirror user toggles back into state.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

// ── Types ────────────────────────────────────────────────────────────────

export type SectionDescriptor = {
  /** Stable composite key: `${docId}::${sectionId}`. */
  key: string;
  docId: string;
  sectionId: string;
  title: string;
  /** Free-form category tag (e.g. "debug", "json", "text"). */
  kind: string;
};

type BulkState = {
  /** The open posture the most recent bulk action established. */
  defaultOpen: boolean;
  /** Monotonic counter; each bulk action bumps it to force a re-sync. */
  bulkNonce: number;
};

// ── External store (ref-backed; no React re-render on the provider) ────────

class SectionStore {
  private state: BulkState = { defaultOpen: true, bulkNonce: 0 };
  private listeners = new Set<() => void>();
  private sections = new Map<string, SectionDescriptor>();

  // useSyncExternalStore contract — getSnapshot must be referentially stable
  // while unchanged, so we only replace `state` on an actual bulk action.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): BulkState => this.state;

  private emit() {
    for (const l of this.listeners) l();
  }

  expandAll = (): void => {
    this.state = { defaultOpen: true, bulkNonce: this.state.bulkNonce + 1 };
    this.emit();
  };

  collapseAll = (): void => {
    this.state = { defaultOpen: false, bulkNonce: this.state.bulkNonce + 1 };
    this.emit();
  };

  // Registry — intentionally does NOT notify listeners (not render-relevant).
  register = (d: SectionDescriptor): void => {
    this.sections.set(d.key, d);
  };

  unregister = (key: string): void => {
    this.sections.delete(key);
  };

  list = (): SectionDescriptor[] => Array.from(this.sections.values());

  count = (): number => this.sections.size;
}

// ── Context plumbing ───────────────────────────────────────────────────────

const StoreContext = createContext<SectionStore | null>(null);

export function DocumentsSectionProvider({ children }: { children: ReactNode }) {
  // One store instance per provider mount; stable across re-renders. Lazy
  // useState initialiser (not a ref) so the value is render-safe.
  const [store] = useState(() => new SectionStore());
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

function useSectionStore(): SectionStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error(
      "useSectionStore must be used within a <DocumentsSectionProvider>",
    );
  }
  return store;
}

/**
 * Toolbar-facing handle. Returns the stable bulk actions plus a live section
 * count. `expandAll` / `collapseAll` are stable method references, so a
 * component using only those never re-renders on bulk activity.
 */
export function useDocumentsSectionControls(): {
  expandAll: () => void;
  collapseAll: () => void;
  sectionCount: () => number;
} {
  const store = useSectionStore();
  return useMemo(
    () => ({
      expandAll: store.expandAll,
      collapseAll: store.collapseAll,
      sectionCount: store.count,
    }),
    [store],
  );
}

// ── CollapsibleSection ─────────────────────────────────────────────────────

export function CollapsibleSection({
  docId,
  sectionId,
  title,
  kind = "section",
  summary,
  summaryClassName,
  className,
  bodyClassName,
  children,
  lazy = true,
  defaultOpen,
}: {
  docId: string;
  /** Stable within a document; need NOT be globally unique. */
  sectionId: string;
  title: string;
  kind?: string;
  /** Optional rich summary content; falls back to `title`. */
  summary?: ReactNode;
  summaryClassName?: string;
  className?: string;
  /** When set, body children are wrapped in a <div> with this class. */
  bodyClassName?: string;
  children: ReactNode;
  /**
   * When true (default), body children are only mounted while the section is
   * open — so heavy work (e.g. JSON.stringify) never runs for a collapsed
   * section, regardless of how many documents are on screen.
   */
  lazy?: boolean;
  /**
   * Override the INITIAL open posture for this section only (e.g. a heavy
   * analysis block that should start collapsed even when the prevailing default
   * is open). Subsequent Expand All / Collapse All still control it normally.
   * When omitted, the section adopts the current bulk posture as before.
   */
  defaultOpen?: boolean;
}) {
  const store = useSectionStore();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Local open state — seeded from `defaultOpen` when provided, otherwise from
  // the current bulk posture (so a section mounted after a bulk action adopts
  // it). The seed only affects the first mount; bulk actions re-sync below.
  const [open, setOpen] = useState<boolean>(defaultOpen ?? snap.defaultOpen);

  // Re-sync to the bulk posture whenever a NEW bulk action fires. This is the
  // React-recommended "adjust state during render from a previous value"
  // pattern (no effect, no cascading-render warning): compare the last-seen
  // nonce held in state and, when it changes, snap `open` to the new default.
  const [lastNonce, setLastNonce] = useState<number>(snap.bulkNonce);
  if (lastNonce !== snap.bulkNonce) {
    setLastNonce(snap.bulkNonce);
    setOpen(snap.defaultOpen);
  }

  // Registry membership (ancillary; see module header).
  useEffect(() => {
    const key = `${docId}::${sectionId}`;
    store.register({ key, docId, sectionId, title, kind });
    return () => store.unregister(key);
  }, [store, docId, sectionId, title, kind]);

  return (
    <details
      className={className}
      open={open}
      onToggle={(e) => {
        // Mirror user (and programmatic) toggles into local state. The
        // equality guard prevents a feedback loop when we set `open` via props.
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen((prev) => (prev === next ? prev : next));
      }}
    >
      <summary
        className={
          summaryClassName ??
          "cursor-pointer text-xs px-4 py-2 select-none text-slate-500 hover:bg-slate-50"
        }
      >
        {summary ?? title}
      </summary>
      {(!lazy || open) &&
        (bodyClassName ? <div className={bodyClassName}>{children}</div> : children)}
    </details>
  );
}
