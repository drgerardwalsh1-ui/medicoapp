/**
 * STEP 6 OBSERVABILITY — a collapsible analysis block inside the Demographics
 * Documents stack.
 *
 * Design rules (see task spec):
 *   - NOT a page/route. A single <CollapsibleSection> at the same structural
 *     level as the per-document analysis blocks, defaulting COLLAPSED, and
 *     responding to the existing Expand All / Collapse All controls.
 *   - ALL data comes from ONE backend object: `Step6ObservabilityRoot`. The UI
 *     never recomputes history / trends / readiness / queue / dashboard — it
 *     only reads and groups already-computed fields for display.
 *   - LAZY: the root is fetched once, on first expand (or first Copy All Data),
 *     then cached. No re-fetch on expand/collapse. Never blocks initial render.
 *
 * The provider exposes `ensure()` so BOTH this section and the Copy All Data
 * toolbar share a single fetch + cache ("fetch once, reuse everywhere").
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CollapsibleSection } from "./DocumentsSection";
import {
  Step6ObservabilityCtx,
  useStep6Observability,
} from "./step6ObservabilityContext";
import {
  runStep6ObservabilityForClient,
  type Step6ObservabilityRoot,
  type Step6Priority,
  type Step6ReadinessLevel,
  type Step6TrendDirection,
} from "../lib/step6";

// ── Provider (shared lazy fetch + cache) ─────────────────────────────────────

export function Step6ObservabilityProvider({
  clientId,
  children,
}: {
  /** Persisted client id, or null when observability is unavailable. */
  clientId: string | null;
  children: ReactNode;
}) {
  const available = !!clientId;
  const rootRef = useRef<Step6ObservabilityRoot | null>(null);
  const inflightRef = useRef<Promise<Step6ObservabilityRoot | null> | null>(null);
  const [root, setRoot] = useState<Step6ObservabilityRoot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // NB: the cache resets automatically when `clientId` changes because the
  // call site keys this provider on `clientId` (fresh mount = fresh cache).

  const ensure = useCallback(async (): Promise<Step6ObservabilityRoot | null> => {
    if (!clientId) return null;
    if (rootRef.current) return rootRef.current;
    if (inflightRef.current) return inflightRef.current;

    setLoading(true);
    setError(null);
    const p = runStep6ObservabilityForClient(clientId)
      .then((r) => {
        rootRef.current = r;
        setRoot(r);
        setLoading(false);
        return r;
      })
      .catch((e: unknown) => {
        inflightRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        return null;
      });
    inflightRef.current = p;
    return p;
  }, [clientId]);

  return (
    <Step6ObservabilityCtx.Provider value={{ root, loading, error, available, ensure }}>
      {children}
    </Step6ObservabilityCtx.Provider>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export default function Step6ObservabilitySection() {
  const { available } = useStep6Observability();
  if (!available) return null;

  return (
    <CollapsibleSection
      docId="case"
      sectionId="step6-observability"
      kind="step6"
      title="STEP 6 OBSERVABILITY"
      defaultOpen={false}
      className="rounded-xl border border-slate-200 bg-white"
      summaryClassName="cursor-pointer text-xs font-medium px-4 py-2 select-none text-slate-600 hover:bg-slate-50"
      bodyClassName="px-4 pb-4 pt-1 space-y-4"
    >
      <Step6ObservabilityBody />
    </CollapsibleSection>
  );
}

/** Mounted only while the section is open (lazy) — triggers the single fetch. */
function Step6ObservabilityBody() {
  const { root, loading, error, ensure } = useStep6Observability();

  useEffect(() => {
    // Fetch on first expand; cached afterwards (no re-fetch on toggle).
    void ensure();
  }, [ensure]);

  if (error) {
    return (
      <div className="text-xs text-rose-600">
        Failed to load STEP 6 observability: {error}
      </div>
    );
  }
  if (!root) {
    return (
      <div className="text-xs text-slate-400">
        {loading ? "Loading STEP 6 observability…" : "No data."}
      </div>
    );
  }

  return <Step6ObservabilityContent root={root} />;
}

// Shared tooltip copy: the clinical-only edge formation rule. Describes ONLY
// what creates edges (clinical diagnosis/symptom connectivity). The degenerate
// "all nodes isolated" outcome is explained solely by the conditional render
// line in Graph Summary — not restated here.
const CLINICAL_EDGE_RULE =
  "Edges connect clinical (diagnosis/symptom) contradictions only.";

// ── Content (pure read of the root; no recomputation) ────────────────────────

function Step6ObservabilityContent({ root }: { root: Step6ObservabilityRoot }) {
  const r = root.snapshot.report;
  const gs = r.analytics.graph_summary;

  const trendIds = (d: Step6TrendDirection) =>
    root.trends.trends.filter((t) => t.direction === d).map((t) => t.contradiction_id);
  const readyIds = (lvl: Step6ReadinessLevel) =>
    root.readiness.items.filter((i) => i.readiness === lvl).map((i) => i.contradiction_id);
  const queueIds = (p: Step6Priority) =>
    root.queue.items.filter((i) => i.priority === p).map((i) => i.contradiction_id);

  const d = root.dashboard.summary;

  return (
    <div className="space-y-4 text-xs text-slate-600">
      {/* A. Snapshot Summary */}
      <Subsection title="Snapshot Summary">
        <KV k="report_id" v={root.snapshot.report_id} mono />
        <KV k="contradictions" v={r.view.enriched_contradictions.length} />
        <KV k="cluster count" v={r.analytics.cluster_metrics.length} />
        <KV k="nodes" v={r.graph.nodes.length} />
        <KV
          k="edges"
          v={r.graph.edges.length}
          title={CLINICAL_EDGE_RULE}
        />
      </Subsection>

      {/* B. Monitoring Queue */}
      <Subsection title="Monitoring Queue">
        <IdRow label="High priority" ids={queueIds("High")} />
        <IdRow label="Medium priority" ids={queueIds("Medium")} />
        <IdRow label="Low priority" ids={queueIds("Low")} />
      </Subsection>

      {/* C. Trends */}
      <Subsection title="Trends">
        <IdRow label="Increasing" ids={trendIds("Increasing")} />
        <IdRow label="Decreasing" ids={trendIds("Decreasing")} />
        <IdRow label="Stable" ids={trendIds("Stable")} />
        <IdRow label="Intermittent" ids={trendIds("Intermittent")} />
      </Subsection>

      {/* D. Forecast Readiness */}
      <Subsection title="Forecast Readiness">
        <IdRow label="Ready" ids={readyIds("Ready")} />
        <IdRow label="LimitedHistory" ids={readyIds("LimitedHistory")} />
        <IdRow label="InsufficientHistory" ids={readyIds("InsufficientHistory")} />
      </Subsection>

      {/* E. Dashboard Summary */}
      <Subsection title="Dashboard Summary">
        <KV k="total_items" v={d.total_items} />
        <KV
          k="priority (H/M/L)"
          v={`${d.high_priority_count} / ${d.medium_priority_count} / ${d.low_priority_count}`}
        />
        <KV
          k="readiness (R/L/I)"
          v={`${d.ready_count} / ${d.limited_count} / ${d.insufficient_count}`}
        />
        <KV
          k="trend (↑/↓/=/∿)"
          v={`${d.increasing_count} / ${d.decreasing_count} / ${d.stable_count} / ${d.intermittent_count}`}
        />
      </Subsection>

      {/* F. Graph Summary (compact) */}
      <Subsection title="Graph Summary">
        <KV k="cluster count" v={gs.cluster_count} />
        <KV k="largest cluster size" v={gs.largest_cluster_size} />
        <KV
          k="isolated nodes"
          v={gs.isolated_node_count}
          title={CLINICAL_EDGE_RULE}
        />
        {gs.edge_count === 0 && (
          <div className="text-slate-400">
            cluster interpretation: all nodes are isolated (no clinical edges)
          </div>
        )}
        <p className="text-[11px] leading-snug text-slate-400 pt-1">
          Edges connect clinical (diagnosis/symptom) contradictions only.
        </p>
      </Subsection>
    </div>
  );
}

// ── Presentational helpers ───────────────────────────────────────────────────

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function KV({
  k,
  v,
  mono = false,
  title,
}: {
  k: string;
  v: string | number;
  mono?: boolean;
  /** Optional native tooltip shown on hover over the row (no layout change). */
  title?: string;
}) {
  return (
    <div className="flex justify-between gap-3" title={title}>
      <span className={title ? "text-slate-500 cursor-help" : "text-slate-500"}>{k}</span>
      <span className={mono ? "font-mono text-slate-700" : "text-slate-700"}>{v}</span>
    </div>
  );
}

function IdRow({ label, ids }: { label: string; ids: string[] }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">
        {label} <span className="text-slate-400">({ids.length})</span>
      </span>
      <span className="font-mono text-right text-slate-700 break-all">
        {ids.length ? ids.join(", ") : "—"}
      </span>
    </div>
  );
}
