// ── Phase 16 — Forensic drawer (read-only, collapsed by default) ───────────────
// All engine/replay/semantic/constraint/temporal artefacts live here. The
// default UI does not show this; the clinician opens it explicitly. Renders
// the replay structure verbatim — no transformation.

import { useState } from "react";
import { getForensicReplayData } from "../clinicalUX";
import type { ClinicalReplay } from "../clinicalReplay";

export default function ClinicalForensicDrawer({ replay }: { replay: ClinicalReplay }) {
  const [open, setOpen] = useState(false);
  const data = getForensicReplayData(replay); // identity passthrough

  return (
    <div className="border-t border-slate-200 pt-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] text-slate-500 hover:text-slate-700"
      >
        {open ? "▾" : "▸"} Show forensic details
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <details>
            <summary className="cursor-pointer text-slate-600">
              Observations ({data.observations.length})
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px]">
              {JSON.stringify(data.observations, null, 2)}
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-slate-600">
              Semantic evolution ({data.semanticEvolution.length})
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px]">
              {JSON.stringify(data.semanticEvolution, null, 2)}
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-slate-600">
              Constraint events ({data.constraintEvents.length})
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px]">
              {JSON.stringify(data.constraintEvents, null, 2)}
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-slate-600">
              Temporal qualifications ({data.temporalQualifications.length})
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px]">
              {JSON.stringify(data.temporalQualifications, null, 2)}
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-slate-600">
              Differential map ({data.differentialMap.length})
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px]">
              {JSON.stringify(data.differentialMap, null, 2)}
            </pre>
          </details>
          <div className="text-[10px] text-slate-400 break-all">
            snapshot: {data.meta.snapshotHash}
          </div>
        </div>
      )}
    </div>
  );
}
