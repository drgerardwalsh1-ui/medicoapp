/**
 * Step6DevPanel — developer-only host that invokes the backend STEP-6 command
 * with the client's real persisted extraction and renders the result.
 *
 * This is the production reachability point (audit F-A1): clicking the button
 * drives `getClientExtraction → build_step6_case → CanonicalCase/export` in the
 * running app. Gated behind `localStorage["medico.devMode"] === "1"` (the same
 * dev toggle DocumentCard uses), so it never appears in normal use.
 */

import { useState } from "react";
import { runStep6ForClient, type Step6CaseResult } from "../lib/step6";

export default function Step6DevPanel({ clientId }: { clientId: string }) {
  const [result, setResult] = useState<Step6CaseResult | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(await runStep6ForClient(clientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-slate-300 rounded-lg p-3 text-xs space-y-2 bg-slate-50">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-600">STEP-6 (dev)</span>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-white disabled:opacity-40"
        >
          {busy ? "Running…" : "Build STEP-6 case"}
        </button>
      </div>

      {error && (
        <div className="text-red-700">STEP-6 failed: {error}</div>
      )}

      {result && (
        <div className="space-y-1">
          <div>
            Contradictions:{" "}
            <span className="font-semibold">{result.case.contradictions.length}</span>
            {"  ·  "}Timeline entries:{" "}
            <span className="font-semibold">{result.case.timeline.length}</span>
          </div>
          <pre className="bg-slate-900 text-emerald-300 text-[11px] leading-snug px-3 py-2 overflow-auto max-h-60 m-0">
            {result.csv_lines.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
