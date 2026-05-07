// ── Shared FrequencyInput ─────────────────────────────────────────────────────
// Single source-of-truth frequency UI used by PIRS, RelationshipManager, and
// any future module.  All modules MUST import from here — no local copies.

import { formatFrequency } from "../engine/narrativeEngine";

export const FREQ_QUICK = ["1", "2–3", "4–5", "Daily"] as const;
export const FREQ_UNITS = ["Day", "Week", "Fortnight", "Month", "Year"] as const;

export function FrequencyInput({
  label = "Frequency",
  unit,
  count,
  onUnit,
  onCount,
}: {
  label?: string;
  unit: string;
  count: string;
  onUnit: (v: string) => void;
  onCount: (v: string) => void;
}) {
  const isDailyShortcut = count === "Daily";
  const formatted = formatFrequency(unit, count);
  const isQuick = (FREQ_QUICK as readonly string[]).includes(count);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-2 mt-1">
        {/* Count row — single-select; unselected chips dim when one is active */}
        <div className="flex gap-1.5 items-center flex-wrap">
          {FREQ_QUICK.map((c) => {
            const active  = count === c;
            const hasQuick = isQuick;
            const dimmed  = hasQuick && !active;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onCount(count === c ? "" : c)}
                className={`text-xs px-2.5 py-1 rounded border transition ${
                  active
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
                } ${dimmed ? "opacity-50" : ""}`}
              >
                {c}
              </button>
            );
          })}
          <input
            type="text"
            className="input w-16 text-xs py-1"
            placeholder="other"
            value={isQuick ? "" : count}
            onChange={(e) => onCount(e.target.value)}
          />
        </div>

        {/* Unit row — single-select; unselected dims when one is active */}
        <div className="flex gap-1.5 flex-wrap">
          {FREQ_UNITS.map((u) => {
            const active = unit === u && !isDailyShortcut;
            const hasUnit = !!unit && !isDailyShortcut;
            const dimmed  = hasUnit && !active;
            return (
              <button
                key={u}
                type="button"
                disabled={isDailyShortcut}
                onClick={() => onUnit(unit === u ? "" : u)}
                className={`text-xs px-2.5 py-1 rounded border transition disabled:opacity-40 ${
                  active
                    ? "bg-slate-700 text-white border-slate-700"
                    : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
                } ${dimmed ? "opacity-50" : ""}`}
              >
                {u}
              </button>
            );
          })}
        </div>

        {/* Formatted summary */}
        {formatted && (
          <p className="text-[11px] text-violet-700 font-medium bg-violet-50 rounded px-2 py-0.5 inline-block">
            {formatted}
          </p>
        )}
      </div>
    </div>
  );
}
