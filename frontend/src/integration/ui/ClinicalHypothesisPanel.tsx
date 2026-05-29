// ── Phase 16 — Hypothesis panel (read-only, top-N only) ────────────────────────
// Renders ONLY the primary hypotheses. Never shows raw candidacy lists,
// constraint internals, or replay artifacts. Cognitive-load capped at the spec
// maximums (≤5 hypotheses, ≤3 signals per category).

import type { ClinicalHypothesis } from "../clinicalUX";

const STRENGTH_CLASS: Record<string, string> = {
  strong: "text-emerald-700",
  moderate: "text-slate-700",
  weak: "text-slate-400",
};

// Optional Phase-19 reasons per diagnosis (display-only label, e.g.
// "requires longitudinal confirmation"). Never alters truth.
export default function ClinicalHypothesisPanel({
  hypotheses,
  reasonsById,
}: {
  hypotheses: readonly ClinicalHypothesis[];
  reasonsById?: Readonly<Record<string, readonly string[]>>;
}) {
  if (hypotheses.length === 0) {
    return <p className="text-xs text-slate-400">No primary hypotheses surfaced.</p>;
  }
  return (
    <ul className="space-y-2 text-xs">
      {hypotheses.map((h) => (
        <li key={h.diagnosisId} className="rounded border border-slate-200 p-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-800">{h.diagnosisName}</span>
            <span className={`text-[10px] uppercase tracking-wide ${STRENGTH_CLASS[h.strengthLabel] ?? ""}`}>
              {h.status} · {h.strengthLabel}
            </span>
          </div>
          {h.supportingSignals.length > 0 && (
            <div className="mt-1">
              <div className="text-[10px] text-slate-500">Supports</div>
              <ul className="ml-3 list-disc text-slate-700">
                {h.supportingSignals.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {h.missingSignals.length > 0 && (
            <div className="mt-1">
              <div className="text-[10px] text-slate-500">Missing</div>
              <ul className="ml-3 list-disc text-slate-500">
                {h.missingSignals.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {h.temporalStatus && (
            <div className="mt-1 text-[10px] italic text-slate-500">
              temporal: {h.temporalStatus}
            </div>
          )}
          {reasonsById?.[h.diagnosisId]?.length ? (
            <ul className="mt-1 space-y-0.5">
              {reasonsById[h.diagnosisId].map((r, i) => (
                <li key={i} className="text-[10px] italic text-amber-600">
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
