// Phase 6 — Evidentiary Argument Panel (PURE RE-PRESENTATION, no new logic).
//
// This panel introduces NO computation. It re-organises ALREADY-COMPUTED
// projections into the four explicit forensic roles a report must keep separate
// for cross-examination:
//
//   CLAIM          ← clinicalBridge overlay summaries (diagnostic claims)
//   SUPPORTING     ← overlay.suggestions (engine's per-criterion supporting refs)
//   CONTRADICTING  ← Rust contradiction_* engine ONLY (sole source)
//   PROVENANCE     ← event-store history (opens the canonical VersionHistoryModal)
//
// It computes nothing: no scoring, no weighting, no inference, no graph, no new
// fields. Every value shown is taken verbatim from props the workspace already
// memoised. Local state is limited to UI expand/collapse.

import { useState } from "react";
import type { ClinicalOverlay } from "../integration/clinicalBridge";
import type { CandidateFact } from "../integration/candidateFacts";

type ClaimSummary = ClinicalOverlay["summaries"][number];
type Suggestions = ClinicalOverlay["suggestions"];

export type EvidentiaryArgumentPanelProps = {
  /** Already-memoised clinical overlay (CLAIM + SUPPORTING). Not recomputed. */
  overlay: ClinicalOverlay;
  /** Already-loaded candidate facts (authoritative evidence layer). */
  candidates: readonly CandidateFact[];
  /** Opens the single canonical VersionHistoryModal (PROVENANCE). Wiring only. */
  onOpenProvenance?: () => void;
};

const TIER_STYLE: Record<ClaimSummary["tier"], string> = {
  likely: "bg-violet-100 text-violet-700",
  contributing: "bg-sky-100 text-sky-700",
  uncertain: "bg-slate-100 text-slate-500",
};

export default function EvidentiaryArgumentPanel({
  overlay,
  candidates,
  onOpenProvenance,
}: EvidentiaryArgumentPanelProps) {
  // Evidence layer = candidate facts marked present (verbatim; no interpretation).
  const presentEvidence = candidates.filter((c) => c.presence === "present");

  return (
    <section
      data-testid="evidentiary-argument"
      className="mt-4 border-t border-slate-200 pt-3"
    >
      <h2 className="text-[10.5px] font-bold tracking-wider text-slate-600 uppercase mb-2">
        Evidentiary argument
      </h2>

      {overlay.summaries.length === 0 ? (
        <p className="text-[12px] text-slate-400">
          No diagnostic claims surfaced by the engine yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {overlay.summaries.map((claim) => (
            <ArgumentItem
              key={claim.diagnosisId}
              claim={claim}
              suggestions={overlay.suggestions}
              onOpenProvenance={onOpenProvenance}
            />
          ))}
        </ul>
      )}

      {/* Evidence on record — re-presents candidateFacts (authoritative evidence
          layer) verbatim. Not attributed to claims here (attribution is the
          engine's job, shown per-claim above). */}
      <div className="mt-3">
        <h3 className="text-[11px] font-semibold text-slate-700 mb-1">
          Evidence on record ({presentEvidence.length})
        </h3>
        {presentEvidence.length === 0 ? (
          <p className="text-[11px] text-slate-400">none</p>
        ) : (
          <ul className="space-y-0.5">
            {presentEvidence.map((c) => (
              <li key={c.candidateId} className="text-[12px] text-slate-600 leading-snug">
                {c.label} <span className="text-slate-400">· {c.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ArgumentItem({
  claim,
  suggestions,
  onOpenProvenance,
}: {
  claim: ClaimSummary;
  suggestions: Suggestions;
  onOpenProvenance?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // SUPPORTING — taken verbatim from the engine's suggestions for this claim.
  const supporting = suggestions.filter(
    (s) => s.diagnosisId === claim.diagnosisId && s.supporting.length > 0,
  );

  return (
    <li className="border border-slate-200 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-medium text-slate-800">{claim.name}</span>
        <span
          className={`ml-auto text-[9.5px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${TIER_STYLE[claim.tier]}`}
        >
          {claim.tier}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2.5 space-y-2">
          <Role label="Claim">
            {claim.name}{" "}
            <span className="text-slate-400">
              · engine state {claim.state} · {claim.metCriteria}/{claim.totalCriteria} criteria met
            </span>
          </Role>

          <Role label="Supporting evidence">
            {supporting.length === 0 ? (
              <span className="text-slate-400">none recorded against required criteria</span>
            ) : (
              <ul className="space-y-0.5">
                {supporting.map((s) => (
                  <li key={s.criterionId} className="text-slate-600">
                    {s.criterionId}{" "}
                    <span className="text-slate-400">({s.supporting.length})</span>
                  </li>
                ))}
              </ul>
            )}
          </Role>

          <Role label="Contradicting evidence">
            {/* Sole permitted source is the Rust contradiction_* engine; its
                projection is not wired into this workspace, so nothing is shown
                rather than substituting a different engine's output. */}
            <span className="text-slate-400">
              none surfaced — contradiction-engine projection not available in this workspace
            </span>
          </Role>

          <Role label="Provenance">
            {onOpenProvenance ? (
              <button
                type="button"
                onClick={onOpenProvenance}
                className="text-violet-700 hover:underline"
              >
                Trace through event history ↧
              </button>
            ) : (
              <span className="text-slate-400">append-only event history</span>
            )}
          </Role>
        </div>
      )}
    </li>
  );
}

function Role({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-[12px]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="mt-0.5 text-slate-700">{children}</div>
    </div>
  );
}
