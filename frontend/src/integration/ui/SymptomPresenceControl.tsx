// ── Phase 19.1 — Shared symptom-presence control (canonical, single source) ────
// ONE reusable tri-state control for symptom presence. Bound directly to the
// authoritative `currentPresence: boolean | undefined` field on SymptomEntity —
// it carries NO local shadow state, NO optimistic copy, NO derived cache.
// Every consumer (DSM workspace + Current Symptoms list) renders the same
// component reading/writing the same field, so all visible instances stay in
// sync automatically.
//
// Single click immediately sets the chosen value (no second-click required, no
// cycle, no toggle-deselect on the active button).

export type PresenceValue = boolean | undefined;

const OPTIONS: { value: PresenceValue; symbol: string; label: string; activeCls: string }[] = [
  { value: undefined, symbol: "?", label: "Unknown",  activeCls: "bg-slate-100 text-slate-600 border-slate-400" },
  { value: true,      symbol: "✓", label: "Present",  activeCls: "bg-emerald-500 text-white border-emerald-500" },
  { value: false,     symbol: "✗", label: "Absent",   activeCls: "bg-red-500 text-white border-red-500" },
];

// Pure helper — exported for tests; UI binds directly to it.
export function isActive(current: PresenceValue, option: PresenceValue): boolean {
  return current === option;
}

// Pure helper — exported for tests; defines the "click = set to that value"
// semantics. Single click always sets the chosen value; never deselects on a
// second click.
export function nextPresenceOn(clicked: PresenceValue): PresenceValue {
  return clicked;
}

export default function SymptomPresenceControl({
  value,
  onChange,
  size = "md",
  className = "",
}: {
  value: PresenceValue;
  onChange: (next: PresenceValue) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "sm" ? "w-6 h-6 text-[11px]" : "w-7 h-7 text-xs";
  return (
    <div className={`flex gap-1 shrink-0 ${className}`}>
      {OPTIONS.map((opt) => {
        const active = isActive(value, opt.value);
        return (
          <button
            key={opt.label}
            type="button"
            title={opt.label}
            aria-pressed={active}
            onClick={(e) => {
              e.stopPropagation();
              onChange(nextPresenceOn(opt.value));
            }}
            className={
              "rounded border flex items-center justify-center font-bold transition " +
              dim +
              " " +
              (active ? opt.activeCls : "bg-white text-slate-400 border-slate-200 hover:border-slate-400")
            }
          >
            {opt.symbol}
          </button>
        );
      })}
    </div>
  );
}
