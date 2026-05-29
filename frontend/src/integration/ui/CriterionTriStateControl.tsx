// ── Phase 19.2 — Criterion tri-state control (visually disambiguated) ──────────
// Parallel to SymptomPresenceControl: SAME tri-state UX pattern, DIFFERENT
// semantic domain. This control adjudicates a DSM CRITERION
// (unknown | met | not_met) — it is NOT a symptom-presence control. The two
// types are deliberately kept SEPARATE data models; this component only
// disambiguates them visually so the clinician never asks "am I changing a
// symptom or a diagnostic rule?".
//
// Visual disambiguation:
//   - left-edge "DSM" accent stripe + tiny label
//   - muted criterion-tone active classes (distinct hues from symptom control)
//
// No engine / persistence / scoring imports.

export type CriterionTriState = "unknown" | "met" | "not_met";

const OPTIONS: { value: CriterionTriState; symbol: string; label: string; activeCls: string }[] = [
  { value: "unknown", symbol: "?", label: "Unknown", activeCls: "bg-slate-200 text-slate-700 border-slate-500" },
  { value: "met",     symbol: "✓", label: "Met (criterion satisfied)",     activeCls: "bg-indigo-100 text-indigo-800 border-indigo-500" },
  { value: "not_met", symbol: "✗", label: "Not met (criterion not satisfied)", activeCls: "bg-amber-100 text-amber-800 border-amber-500" },
];

// Pure helpers — exported for tests.
export function isCriterionActive(current: CriterionTriState, option: CriterionTriState): boolean {
  return current === option;
}
export function nextCriterionOn(clicked: CriterionTriState): CriterionTriState {
  return clicked;
}

export default function CriterionTriStateControl({
  value,
  onChange,
  compact = false,
  showLabel = true,
}: {
  value: CriterionTriState;
  onChange: (v: CriterionTriState) => void;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const dim = compact ? "w-6 h-6 text-[11px]" : "w-7 h-7 text-xs";
  return (
    <div
      className="flex items-center gap-1.5 pl-1.5 border-l-2 border-indigo-400"
      title="DSM criterion adjudication (not symptom presence)"
      data-control-kind="criterion"
    >
      {showLabel && (
        <span className="text-[9px] uppercase tracking-wider text-indigo-500 font-semibold select-none">
          DSM
        </span>
      )}
      <div className="flex gap-1 shrink-0">
        {OPTIONS.map((opt) => {
          const active = isCriterionActive(value, opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              aria-pressed={active}
              onClick={(e) => {
                e.stopPropagation();
                onChange(nextCriterionOn(opt.value));
              }}
              className={
                "rounded border flex items-center justify-center font-bold transition " +
                dim +
                " " +
                (active ? opt.activeCls : "bg-white text-slate-400 border-slate-200 hover:border-indigo-400")
              }
            >
              {opt.symbol}
            </button>
          );
        })}
      </div>
    </div>
  );
}
