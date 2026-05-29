// ── Phase 18 — Finalize Clinical Decision modal (snapshot-driven) ──────────────
// The ONLY commit mechanism in the system. Consumes the pre-finalization
// snapshot + replay (no overlay, no assessment), lets the clinician set
// Confirm / Reject / Defer per surfaced diagnosis, builds a final
// ClinicalDecision + augmented ReportSnapshotV2 via the pure decision module,
// and persists via the existing Rust IPC. The modal never recomputes engine
// outputs and never derives clinical data.

import { useState } from "react";
import {
  createClinicalDecisionFromSnapshot,
  type ClinicalDecision,
  type ConclusionStatus,
  type DiagnosticConclusion,
  type ReportSnapshotV2,
} from "./clinicalDecision";
import type { ClinicalReplay } from "./clinicalReplay";
import { TauriAPI, isTauri } from "../api/tauriApi";

export type PersistConfirmation = { id: string; savedAt: string } | null;

const STATUSES: ConclusionStatus[] = ["confirmed", "rejected", "deferred"];
// Only diagnoses the system surfaced (excluded/unlikely are not offered).
const DECIDABLE = new Set([
  "differential_primary",
  "likely",
  "probable",
  "possible",
  "subthreshold",
  "rule_out",
]);

export default function FinalizeDecisionModal({
  snapshot,
  replay: _replay,
  clientId,
  clinicianId,
  onClose,
  onFinalized,
}: {
  snapshot: ReportSnapshotV2;
  replay: ClinicalReplay; // passed through unchanged (forensic context only)
  clientId: string;
  clinicianId: string;
  onClose: () => void;
  onFinalized?: (
    decision: ClinicalDecision,
    snapshot: ReportSnapshotV2,
    confirmation: PersistConfirmation,
  ) => void;
}) {
  const decidable = snapshot.semanticStates.filter((s) => DECIDABLE.has(s.state));
  const [choices, setChoices] = useState<Record<string, ConclusionStatus>>({});
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const conclusions: DiagnosticConclusion[] = Object.entries(choices).map(
      ([diagnosisId, status]) => ({ diagnosisId, status }),
    );
    const { decision, snapshot: finalSnapshot } = createClinicalDecisionFromSnapshot(snapshot, {
      clientId,
      clinicianId,
      conclusions,
      rationale: rationale.trim() || undefined,
      timestamp: new Date().toISOString(),
      id: crypto.randomUUID(),
    });

    let confirmation: PersistConfirmation = null;
    try {
      if (isTauri) confirmation = await TauriAPI.persistClinicalDecision(finalSnapshot, decision);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[clinical-decision] persist failed", e);
    }

    setSubmitting(false);
    onFinalized?.(decision, finalSnapshot, confirmation);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-lg bg-white shadow-xl text-sm">
        <div className="px-4 py-3 border-b border-slate-200 font-medium text-slate-800">
          Finalize Clinical Decision
          <p className="text-[11px] font-normal text-slate-500 mt-0.5">
            The system does not diagnose. Each conclusion below is yours.
          </p>
        </div>

        <div className="p-4 space-y-2">
          {decidable.length === 0 && (
            <p className="text-slate-400">No diagnoses surfaced to decide on.</p>
          )}
          {decidable.map((s) => (
            <div key={s.diagnosisId} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
              <div className="min-w-0">
                <div className="truncate text-slate-800">{s.name}</div>
                <div className="text-[10px] text-slate-400">
                  system: {s.state}
                  {s.differentialGroup ? ` · ${s.differentialGroup}` : ""}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setChoices((c) => ({ ...c, [s.diagnosisId]: st }))}
                    className={
                      "px-2 py-1 rounded text-[11px] border " +
                      (choices[s.diagnosisId] === st
                        ? st === "confirmed"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : st === "rejected"
                            ? "bg-rose-600 text-white border-rose-600"
                            : "bg-slate-600 text-white border-slate-600"
                        : "bg-white text-slate-600 border-slate-300")
                    }
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Optional rationale…"
            className="w-full mt-2 rounded border border-slate-300 p-2 text-xs"
            rows={3}
          />
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-slate-600 border border-slate-300">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={Object.keys(choices).length === 0 || submitting}
            className="px-3 py-1.5 rounded bg-slate-800 text-white disabled:opacity-40"
          >
            {submitting ? "Saving…" : "Finalize & freeze snapshot"}
          </button>
        </div>
      </div>
    </div>
  );
}
