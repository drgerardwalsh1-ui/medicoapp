import type { Option } from "../types/fieldTypes";

type FieldProps = {
  label: string;
  value: any;
  onChange: (v: any) => void;
  type?: "text" | "textarea" | "number" | "select";
  options?: Option[];
};

export function Field({
  label,
  value,
  onChange,
  type = "text",
  options = []
}: FieldProps) {

  const baseInput =
    "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition";

  const labelClass =
    "text-sm font-medium text-slate-700 mb-1 block";

  return (
    <div className="space-y-1">
      <label className={labelClass}>
        {label}
      </label>

      {/* TEXT */}
      {type === "text" && (
        <input
          className={baseInput}
          value={value?.label || ""}
          onChange={(e) =>
            onChange({
              value: e.target.value,
              label: e.target.value
            })
          }
        />
      )}

      {/* TEXTAREA */}
      {type === "textarea" && (
        <textarea
          className={`${baseInput} min-h-[100px] resize-y`}
          value={value?.label || ""}
          onChange={(e) =>
            onChange({
              value: e.target.value,
              label: e.target.value
            })
          }
        />
      )}

      {/* NUMBER */}
      {type === "number" && (
        <input
          type="number"
          className={baseInput}
          value={value?.value ?? ""}
          onChange={(e) =>
            onChange({
              value: Number(e.target.value),
              label: e.target.value
            })
          }
        />
      )}

      {/* SELECT */}
      {type === "select" && (
        <select
          className={baseInput}
          value={value?.value ?? ""}
          onChange={(e) => {
            const selected = options.find(
              (o) => String(o.value) === e.target.value
            );

            if (selected) {
              onChange({
                value: selected.value,
                label: selected.label,
                backgroundValue:
                  selected.backgroundValue ?? selected.value
              });
            }
          }}
        >
          <option value="">Select...</option>

          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}