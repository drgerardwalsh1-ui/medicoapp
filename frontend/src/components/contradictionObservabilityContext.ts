/**
 * Shared context + hook for contradiction observability. Kept in a non-component module
 * so the section file can export only components (React Fast Refresh friendly).
 *
 * The provider (in ContradictionObservabilitySection.tsx) supplies a single lazy fetch +
 * cache of the backend `ContradictionObservabilityRoot`, shared by the collapsible
 * section and the Copy All Data toolbar ("fetch once, reuse everywhere").
 */

import { createContext, useContext } from "react";

import type { ContradictionObservabilityRoot } from "../lib/contradictionEngine";

export type ContradictionObservabilityCtxValue = {
  /** Cached root, or null until first successful fetch. */
  root: ContradictionObservabilityRoot | null;
  loading: boolean;
  error: string | null;
  /** Whether observability is reachable for this client. */
  available: boolean;
  /**
   * Fetch-if-needed. Resolves the cached root (fetching once on first call), or
   * null when unavailable. Concurrent callers share one in-flight request.
   */
  ensure: () => Promise<ContradictionObservabilityRoot | null>;
};

export const ContradictionObservabilityCtx = createContext<ContradictionObservabilityCtxValue | null>(
  null,
);

export function useContradictionObservability(): ContradictionObservabilityCtxValue {
  const ctx = useContext(ContradictionObservabilityCtx);
  if (!ctx) {
    throw new Error(
      "useContradictionObservability must be used within a <ContradictionObservabilityProvider>",
    );
  }
  return ctx;
}
