// ── Phase 18.1 — Decision view as collapsible secondary panel ──────────────────
// CurrentSymptoms is the primary task; this panel is non-blocking,
// inline (no fixed positioning, no viewport-blocking containers, no overlays),
// and defaults to COLLAPSED. The clinician can ignore it entirely during
// symptom entry; expansion is opt-in.
//
// Engine, persistence, and finalization flow are NOT changed by this phase —
// only layout / cognitive-load shaping.

import { useState } from "react";
import ClinicalHypothesisPanel from "./ClinicalHypothesisPanel";
import ClinicalForensicDrawer from "./ClinicalForensicDrawer";
import FinalizeDecisionModal, { type PersistConfirmation } from "../FinalizeDecisionModal";
import { buildClinicalDecisionViewModel, type ClinicalHypothesis } from "../clinicalUX";
import { prioritizeClinicalDisplay } from "../clinicalPrioritization";
import { getActiveClinicianId } from "../clinicianSession";
import type { ReportSnapshotV2, ClinicalDecision } from "../clinicalDecision";
import type { ClinicalReplay } from "../clinicalReplay";

const COLLAPSED_HYPOTHESIS_CAP = 2;

export default function ClinicalDecisionView({
  snapshot,
  replay,
  clientId,
  clinicianId,
  onFinalized,
}: {
  snapshot: ReportSnapshotV2;
  replay: ClinicalReplay;
  clientId?: string;
  clinicianId?: string;
  onFinalized?: (
    decision: ClinicalDecision,
    snapshot: ReportSnapshotV2,
    confirmation: PersistConfirmation,
  ) => void;
}) {
  const vm = buildClinicalDecisionViewModel(snapshot, replay);

  // Phase 19 — display prioritization. Truth (vm) is unchanged; we only choose
  // which entries to foreground and which to demote to a Secondary section.
  const priorities = prioritizeClinicalDisplay(snapshot, replay);
  const priorityById = new Map(priorities.map((p) => [p.diagnosisId, p]));
  const reasonsById: Record<string, readonly string[]> = {};
  for (const p of priorities) if (p.displayReason.length) reasonsById[p.diagnosisId] = p.displayReason;

  // Primary = foreground items. If a foreground item has no Phase-16
  // hypothesis (e.g. promoted acute alternative), synthesize a minimal one
  // from the semantic state so the clinician sees it in the primary list.
  const vmIds = new Set(vm.primaryHypotheses.map((h) => h.diagnosisId));
  const promoted: ClinicalHypothesis[] = priorities
    .filter((p) => p.displayPriority === "foreground" && !vmIds.has(p.diagnosisId))
    .map((p) => ({
      diagnosisId: p.diagnosisId,
      diagnosisName: p.name,
      status: (p.semanticState as ClinicalHypothesis["status"]) ?? "possible",
      strengthLabel: "weak",
      supportingSignals: [],
      missingSignals: [],
      temporalStatus: p.temporalStatus,
    }));
  const primaryHypotheses: ClinicalHypothesis[] = [
    ...vm.primaryHypotheses.filter(
      (h) => priorityById.get(h.diagnosisId)?.displayPriority === "foreground",
    ),
    ...promoted,
  ];
  const secondaryHypotheses: ClinicalHypothesis[] = vm.primaryHypotheses.filter(
    (h) => priorityById.get(h.diagnosisId)?.displayPriority === "secondary",
  );

  const [expanded, setExpanded] = useState(false); // Default COLLAPSED.
  const [openPressureFor, setOpenPressureFor] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [lastSnapshotHash, setLastSnapshotHash] = useState<string | null>(null);

  const resolvedClientId = clientId ?? snapshot.clientId;
  const resolvedClinicianId = clinicianId ?? getActiveClinicianId();
  const canFinalize = !!resolvedClientId;

  const topHypotheses = primaryHypotheses.slice(0, COLLAPSED_HYPOTHESIS_CAP);
  const temporalWarningCount = vm.temporalFlags.filter((f) =>
    /Insufficient|not satisfied/.test(f.label),
  ).length;

  return (
    // Inline document flow only — no fixed/absolute positioning, no full-viewport
    // containers. Bounded max-height when collapsed for visual compactness.
    <aside
      aria-label="Clinical decision support (secondary)"
      className={
        "rounded border border-slate-200 bg-white text-xs " +
        (expanded ? "" : "max-h-32 overflow-hidden")
      }
    >
      {/* Header — present in both states; compact and non-blocking. */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-[10px] text-slate-500 hover:text-slate-700"
          aria-expanded={expanded}
        >
          {expanded ? "▾" : "▸"} Clinical decision support
        </button>
        <div className="flex items-center gap-2">
          {temporalWarningCount > 0 && (
            <span className="text-[10px] text-amber-600" title="temporal warnings">
              {temporalWarningCount} temporal
            </span>
          )}
          {canFinalize && (
            <button
              type="button"
              onClick={() => setFinalizing(true)}
              className="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-white"
            >
              Finalize
            </button>
          )}
        </div>
      </div>

      {/* COLLAPSED MODE — only top 1–2 hypotheses, no supports/missing. */}
      {!expanded && (
        <ul className="px-3 py-1 space-y-0.5">
          {topHypotheses.length === 0 && (
            <li className="text-[10px] text-slate-400">No surfaced hypotheses.</li>
          )}
          {topHypotheses.map((h) => (
            <li key={h.diagnosisId} className="flex items-center justify-between text-slate-700">
              <span className="truncate">{h.diagnosisName}</span>
              <span className="text-[9px] uppercase tracking-wide text-slate-400">{h.status}</span>
            </li>
          ))}
          {lastSnapshotHash && (
            <li className="text-[9px] text-emerald-700 break-all">
              Decision recorded · {lastSnapshotHash}
            </li>
          )}
        </ul>
      )}

      {/* EXPANDED MODE — inline details. */}
      {expanded && (
        <div className="p-3 space-y-3">
          <section>
            <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">
              Primary hypotheses
            </h3>
            <ClinicalHypothesisPanel hypotheses={primaryHypotheses} reasonsById={reasonsById} />
          </section>

          {secondaryHypotheses.length > 0 && (
            <section>
              <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Secondary differentials
              </h3>
              <ClinicalHypothesisPanel hypotheses={secondaryHypotheses} reasonsById={reasonsById} />
            </section>
          )}

          {vm.decisionPressure.length > 0 && (
            <section>
              <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                Decision pressure
              </h3>
              <ul className="space-y-1">
                {vm.decisionPressure.map((p) => {
                  const open = openPressureFor === p.diagnosisId;
                  return (
                    <li key={p.diagnosisId} className="rounded border border-slate-200 p-2">
                      <button
                        type="button"
                        onClick={() => setOpenPressureFor(open ? null : p.diagnosisId)}
                        className="flex w-full items-center justify-between text-slate-700"
                      >
                        <span>{p.diagnosisId}</span>
                        <span className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
                      </button>
                      {open && (
                        <div className="mt-1 space-y-1">
                          {p.confirmIf.length > 0 && (
                            <div>
                              <div className="text-[10px] text-emerald-600">Confirm if</div>
                              <ul className="ml-3 list-disc">
                                {p.confirmIf.map((s, i) => <li key={i}>{s}</li>)}
                              </ul>
                            </div>
                          )}
                          {p.rejectIf.length > 0 && (
                            <div>
                              <div className="text-[10px] text-rose-600">Reject if</div>
                              <ul className="ml-3 list-disc">
                                {p.rejectIf.map((s, i) => <li key={i}>{s}</li>)}
                              </ul>
                            </div>
                          )}
                          {p.unknowns.length > 0 && (
                            <div>
                              <div className="text-[10px] text-slate-500">Unknowns</div>
                              <ul className="ml-3 list-disc">
                                {p.unknowns.map((s, i) => <li key={i}>{s}</li>)}
                              </ul>
                            </div>
                          )}
                          <div className="text-[9px] italic text-slate-400">source: {p.source}</div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {vm.temporalFlags.length > 0 && (
            <section>
              <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                Temporal flags
              </h3>
              <ul className="flex flex-wrap gap-1">
                {vm.temporalFlags.map((f) => (
                  <li
                    key={f.diagnosisId}
                    className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700"
                    title={f.diagnosisId}
                  >
                    {f.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ClinicalForensicDrawer replay={replay} />
        </div>
      )}

      {finalizing && canFinalize && (
        <FinalizeDecisionModal
          snapshot={snapshot}
          replay={replay}
          clientId={resolvedClientId!}
          clinicianId={resolvedClinicianId}
          onClose={() => setFinalizing(false)}
          onFinalized={(decision, finalSnapshot, confirmation) => {
            setLastSnapshotHash(finalSnapshot.snapshotHash);
            onFinalized?.(decision, finalSnapshot, confirmation);
          }}
        />
      )}
    </aside>
  );
}
