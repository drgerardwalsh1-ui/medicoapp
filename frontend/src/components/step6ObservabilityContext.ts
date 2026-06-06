/**
 * Shared context + hook for STEP 6 observability. Kept in a non-component module
 * so the section file can export only components (React Fast Refresh friendly).
 *
 * The provider (in Step6ObservabilitySection.tsx) supplies a single lazy fetch +
 * cache of the backend `Step6ObservabilityRoot`, shared by the collapsible
 * section and the Copy All Data toolbar ("fetch once, reuse everywhere").
 */

import { createContext, useContext } from "react";

import type { Step6ObservabilityRoot } from "../lib/step6";

export type Step6ObservabilityCtxValue = {
  /** Cached root, or null until first successful fetch. */
  root: Step6ObservabilityRoot | null;
  loading: boolean;
  error: string | null;
  /** Whether observability is reachable for this client. */
  available: boolean;
  /**
   * Fetch-if-needed. Resolves the cached root (fetching once on first call), or
   * null when unavailable. Concurrent callers share one in-flight request.
   */
  ensure: () => Promise<Step6ObservabilityRoot | null>;
};

export const Step6ObservabilityCtx = createContext<Step6ObservabilityCtxValue | null>(
  null,
);

export function useStep6Observability(): Step6ObservabilityCtxValue {
  const ctx = useContext(Step6ObservabilityCtx);
  if (!ctx) {
    throw new Error(
      "useStep6Observability must be used within a <Step6ObservabilityProvider>",
    );
  }
  return ctx;
}
