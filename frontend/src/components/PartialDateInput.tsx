// Compact partial-date editor — year is required for a date to render;
// month and day are optional. Used throughout the History subsystem for
// "began circa 2020" / "mid-2022" style inputs that ISO dates can't model.
// Never used for time calculations (spec: display + history only).

import type { PartialDate } from "../types/history";
import { formatPartialDate } from "../time";

const MONTHS = [
  { v: 1,  label: "Jan" },
  { v: 2,  label: "Feb" },
  { v: 3,  label: "Mar" },
  { v: 4,  label: "Apr" },
  { v: 5,  label: "May" },
  { v: 6,  label: "Jun" },
  { v: 7,  label: "Jul" },
  { v: 8,  label: "Aug" },
  { v: 9,  label: "Sep" },
  { v: 10, label: "Oct" },
  { v: 11, label: "Nov" },
  { v: 12, label: "Dec" },
];

export type PartialDateInputProps = {
  label?: string;
  value: PartialDate | undefined;
  onChange: (next: PartialDate | undefined) => void;
  allowApproximate?: boolean;
};

export function PartialDateInput({
  label,
  value,
  onChange,
  allowApproximate = true,
}: PartialDateInputProps) {
  const v = value ?? {};
  const yearStr = v.year != null ? String(v.year) : "";
  const monthStr = v.month != null ? String(v.month) : "";
  const dayStr = v.day != null ? String(v.day) : "";

  function commit(next: PartialDate) {
    const empty = next.year == null && next.month == null && next.day == null;
    onChange(empty && !next.approximate ? undefined : next);
  }

  return (
    <div>
      {label && <label className="label">{label}</label>}
      <div className="flex gap-1.5 items-center mt-1 flex-wrap">
        <input
          type="number"
          className="input w-20 text-xs py-1"
          placeholder="YYYY"
          value={yearStr}
          min={1900}
          max={2100}
          onChange={(e) => {
            const n = e.target.value;
            commit({ ...v, year: n === "" ? undefined : Number(n) });
          }}
        />
        <select
          className="input w-20 text-xs py-1"
          value={monthStr}
          onChange={(e) =>
            commit({ ...v, month: e.target.value === "" ? undefined : Number(e.target.value) })
          }
        >
          <option value="">Month</option>
          {MONTHS.map((m) => (
            <option key={m.v} value={m.v}>{m.label}</option>
          ))}
        </select>
        <input
          type="number"
          className="input w-16 text-xs py-1"
          placeholder="DD"
          value={dayStr}
          min={1}
          max={31}
          onChange={(e) => {
            const n = e.target.value;
            commit({ ...v, day: n === "" ? undefined : Number(n) });
          }}
        />
        {allowApproximate && (
          <label className="text-[11px] text-slate-500 flex items-center gap-1 select-none">
            <input
              type="checkbox"
              checked={!!v.approximate}
              onChange={(e) => commit({ ...v, approximate: e.target.checked })}
            />
            circa
          </label>
        )}
        {(v.year != null || v.month != null) && (
          <span className="text-[11px] text-violet-700 font-medium bg-violet-50 rounded px-2 py-0.5">
            {formatPartialDate(v)}
          </span>
        )}
      </div>
    </div>
  );
}
