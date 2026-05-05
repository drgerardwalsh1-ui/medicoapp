import { useState, useMemo } from "react";
import type {
  PIRSTableModel,
  ReasonEntry,
  PirsCategoryKey,
  CommonSubdomainEntry,
  SocialSubdomainEntry,
  SocialFunctioningData,
  EmployabilitySubdomainEntry,
  RelationshipEntry,
  ChildrenEntry,
} from "../types/types";
import {
  buildSubject,
  generateCategoryNarrative,
  formatFrequency,
} from "../engine/narrativeEngine";

// ── Infrastructure ────────────────────────────────────────────────────────────

function getSD<T>(table: PIRSTableModel | undefined, catIdx: number, key: string): T {
  const raw = (table?.reasons?.[catIdx] as ReasonEntry | undefined)?.subdomainData;
  return ((raw?.[key] ?? {}) as T);
}

function updateSD<T extends object>(
  table: PIRSTableModel,
  catIdx: number,
  key: string,
  patch: Partial<T>,
  onUpdate: (t: PIRSTableModel) => void
) {
  const reasons = [...(table.reasons ?? Array(6).fill({}))];
  const reason = { ...(reasons[catIdx] ?? {}) } as ReasonEntry;
  const sd = { ...(reason.subdomainData ?? {}) };
  sd[key] = { ...(sd[key] as object ?? {}), ...patch };
  reasons[catIdx] = { ...reason, subdomainData: sd };
  onUpdate({ ...table, reasons });
}

function updateFindings(
  table: PIRSTableModel,
  catIdx: number,
  findings: string,
  manual: boolean,
  onUpdate: (t: PIRSTableModel) => void
) {
  const reasons = [...(table.reasons ?? Array(6).fill({}))];
  const reason = { ...(reasons[catIdx] ?? {}) } as ReasonEntry;
  reasons[catIdx] = { ...reason, findings, findingsManuallyEdited: manual };
  onUpdate({ ...table, reasons });
}

function getFinding(table: PIRSTableModel | undefined, catIdx: number) {
  return (table?.reasons?.[catIdx] as ReasonEntry | undefined)?.findings ?? "";
}

function isFindingManual(table: PIRSTableModel | undefined, catIdx: number) {
  return (table?.reasons?.[catIdx] as ReasonEntry | undefined)?.findingsManuallyEdited ?? false;
}

// ── Frequency helpers ─────────────────────────────────────────────────────────

const FREQ_UNITS = ["Day", "Week", "Fortnight", "Month"];
const FREQ_QUICK = ["1", "2–3", "4–5", "Daily"];

// ── Subdomain status ──────────────────────────────────────────────────────────

type SubdomainStatus = "complete" | "partial" | "empty";

function computeStatus(data: CommonSubdomainEntry): SubdomainStatus {
  if (data.doesNotPerform || data.noIssues || data.managementLevel) return "complete";
  const hasPartial = !!(
    data.frequencyUnit || data.frequencyCount ||
    data.behaviourModifiers?.length ||
    data.recencyValue || data.evidenceSnippets?.length
  );
  return hasPartial ? "partial" : "empty";
}

// ── Management level display ──────────────────────────────────────────────────

const MGMT_DISPLAY: Record<string, string> = {
  independent: "independent",
  independent_difficulty: "independent with difficulty",
  needs_prompting: "requires prompting",
  needs_assistance: "requires assistance",
  dependent: "dependent",
};

// ── Option constants ──────────────────────────────────────────────────────────

const MANAGEMENT_OPTIONS = [
  { value: "independent",           label: "Independent" },
  { value: "independent_difficulty", label: "Difficulty" },
  { value: "needs_prompting",        label: "Prompting" },
  { value: "needs_assistance",       label: "Assistance" },
  { value: "dependent",              label: "Dependent" },
];

const BEHAVIOUR_MODIFIERS = [
  "Regular", "Irregular", "Avoids people", "Low motivation", "Anxiety", "Pain", "No enjoyment",
];

const WHO_CHIPS = ["Partner", "Family", "Friend", "Support worker", "Carer"];
const HOURS_CHIPS = ["<5", "5–10", "10–20", ">20"];
const RECENCY_UNITS = ["days", "weeks", "months", "years"];

const PRE_INJURY_CHIPS = [
  { value: "better", label: "Better pre-injury" },
  { value: "same",   label: "Same pre-injury" },
  { value: "worse",  label: "Worse pre-injury" },
];

const ACTIVITY_TYPE_CHIPS = [
  "Walking", "Gym", "Swimming", "Cycling", "Sport", "Clubs",
  "Church", "Social visits", "Dining out", "Gardening", "Arts/crafts", "Screen time",
];
const AVOIDANCE_REASON_CHIPS = [
  "Pain", "Fatigue", "Anxiety", "Low mood", "Embarrassment",
  "Physical limitation", "No motivation", "Social withdrawal",
];
const INITIATION_CHIPS = ["Self-initiated", "Prompted", "Avoidant"];
const INVOLVEMENT_CHIPS = ["Active", "Passive", "Withdrawn"];
const ENGAGEMENT_CHIPS  = ["Alone", "With friends", "Group setting", "None"];
const MOTIVATION_CHIPS  = ["Normal", "Moderate", "Low"];

const TRAVEL_MODE_CHIPS    = ["Car (driver)", "Car (passenger)", "Train", "Bus", "Tram", "Walk", "Taxi/rideshare"];
const DRIVING_STATUS_CHIPS = ["Drives independently", "Drives with difficulty", "Ceased — symptoms", "Ceased — licence", "Never drove"];

const MEMORY_ISSUE_CHIPS = [
  "Short-term", "Long-term", "Prospective", "Word-finding", "Repetition",
];

const BARRIERS_CHIPS = [
  "Pain", "Fatigue", "Mood", "Cognition", "Social anxiety",
  "Physical capacity", "Transport", "Childcare", "Employer reluctance",
];

const RELATIONSHIP_QUALITY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "good", label: "Good" },
  { value: "strained", label: "Strained" },
  { value: "conflict", label: "Conflict" },
  { value: "no_relationship", label: "No relationship" },
];
const DEPENDENCY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "independent",   label: "Independent" },
  { value: "provides_care", label: "Provides care" },
  { value: "receives_care", label: "Receives care" },
];
const EMPLOYMENT_STATUS_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "full_time",   label: "Full time" },
  { value: "part_time",   label: "Part time" },
  { value: "casual",      label: "Casual" },
  { value: "unemployed",  label: "Unemployed" },
  { value: "not_seeking", label: "Not seeking work" },
  { value: "retired",     label: "Retired" },
  { value: "student",     label: "Student" },
];
const CONSISTENCY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "consistent", label: "Consistent" },
  { value: "reduced",    label: "Reduced" },
  { value: "erratic",    label: "Erratic" },
];
const LIVING_ARRANGEMENT_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "alone",         label: "Lives alone" },
  { value: "with_partner",  label: "Lives with partner" },
  { value: "with_children", label: "Lives with children" },
  { value: "with_parents",  label: "Lives with parents" },
  { value: "with_others",   label: "Lives with others" },
];
const CARE_RESPONSIBILITY_OPTIONS = [
  { value: "", label: "— select —" },
  { value: "full",   label: "Full care" },
  { value: "shared", label: "Shared care" },
  { value: "others", label: "Others care for children" },
];

// ── Primitive UI components ───────────────────────────────────────────────────

function SF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Sel({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Txt({
  value, onChange, placeholder, small,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  small?: boolean;
}) {
  return (
    <input
      className={`input ${small ? "text-xs py-0.5" : ""}`}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Snippets({ snippets, onChange }: { snippets: string[]; onChange: (s: string[]) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="label mb-0">Evidence snippets</label>
        <button type="button" className="text-xs text-violet-600 hover:text-violet-800"
          onClick={() => onChange([...snippets, ""])}>+ Add</button>
      </div>
      {snippets.length === 0 && (
        <p className="text-[11px] text-slate-400 italic">One clinical fact per entry.</p>
      )}
      {snippets.map((s, i) => (
        <div key={i} className="flex gap-1.5 mb-1.5">
          <input className="input flex-1 text-xs" value={s} placeholder="One clinical fact"
            onChange={(e) => { const n = [...snippets]; n[i] = e.target.value; onChange(n); }} />
          <button type="button" className="text-slate-400 hover:text-red-500 px-1"
            onClick={() => onChange(snippets.filter((_, idx) => idx !== i))}>×</button>
        </div>
      ))}
    </div>
  );
}

function FlagRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
      <input type="checkbox" className="w-3.5 h-3.5 accent-violet-600"
        checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ── Chip primitives ───────────────────────────────────────────────────────────

function Chips({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {options.map((opt) => (
          <button key={opt} type="button" onClick={() => toggle(opt)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              selected.includes(opt)
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
            }`}>{opt}</button>
        ))}
      </div>
    </div>
  );
}

function ChipSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {options.map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(value === opt ? "" : opt)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              value === opt
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
            }`}>{opt}</button>
        ))}
      </div>
    </div>
  );
}

// ── New structured components ─────────────────────────────────────────────────

function mgmtColor(v: string): string {
  if (v === "independent")           return "bg-emerald-600 text-white border-emerald-600";
  if (v === "independent_difficulty") return "bg-amber-500 text-white border-amber-500";
  if (v === "needs_prompting")        return "bg-orange-500 text-white border-orange-500";
  if (v === "needs_assistance")       return "bg-red-500 text-white border-red-500";
  if (v === "dependent")              return "bg-red-700 text-white border-red-700";
  return "bg-violet-600 text-white border-violet-600";
}

function ManagementLevel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">How do they manage this activity?</label>
      <div className="flex gap-1.5 flex-wrap mt-1">
        {MANAGEMENT_OPTIONS.map((opt) => (
          <button key={opt.value} type="button"
            onClick={() => onChange(value === opt.value ? "" : opt.value)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              value === opt.value ? mgmtColor(opt.value) : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
            }`}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FrequencyInput({ label = "Frequency", unit, count, onUnit, onCount }: {
  label?: string;
  unit: string; count: string;
  onUnit: (v: string) => void;
  onCount: (v: string) => void;
}) {
  const isDailyShortcut = count === "Daily";
  const formatted = formatFrequency(unit, count);
  const isQuick = FREQ_QUICK.includes(count);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="space-y-2 mt-1">
        {/* Count first, then unit */}
        <div className="flex gap-1.5 items-center flex-wrap">
          {FREQ_QUICK.map((c) => (
            <button key={c} type="button" onClick={() => onCount(count === c ? "" : c)}
              className={`text-xs px-2.5 py-1 rounded border transition ${
                count === c
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
              }`}>{c}</button>
          ))}
          <input
            type="text"
            className="input w-16 text-xs py-1"
            placeholder="other"
            value={isQuick ? "" : count}
            onChange={(e) => onCount(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FREQ_UNITS.map((u) => (
            <button key={u} type="button"
              disabled={isDailyShortcut}
              onClick={() => onUnit(unit === u ? "" : u)}
              className={`text-xs px-2.5 py-1 rounded border transition disabled:opacity-40 ${
                unit === u && !isDailyShortcut
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
              }`}>{u}</button>
          ))}
        </div>
        {formatted && (
          <p className="text-[11px] text-violet-700 font-medium bg-violet-50 rounded px-2 py-0.5 inline-block">
            {formatted}
          </p>
        )}
      </div>
    </div>
  );
}

function BehaviourModifiers({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  }
  return (
    <div>
      <label className="label">Behaviour modifiers</label>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {BEHAVIOUR_MODIFIERS.map((opt) => (
          <button key={opt} type="button" onClick={() => toggle(opt)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              selected.includes(opt)
                ? "bg-amber-500 text-white border-amber-500"
                : "bg-white text-slate-600 border-slate-300 hover:border-amber-400"
            }`}>{opt}</button>
        ))}
      </div>
    </div>
  );
}

function WhoChips({ label, selected, onChange, other, onOther }: {
  label: string;
  selected: string[]; onChange: (v: string[]) => void;
  other: string; onOther: (v: string) => void;
}) {
  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-1.5 mt-1 items-center">
        {WHO_CHIPS.map((opt) => (
          <button key={opt} type="button" onClick={() => toggle(opt)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              selected.includes(opt)
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
            }`}>{opt}</button>
        ))}
        <input className="input flex-1 min-w-[120px] text-xs py-1" placeholder="Other (specify)"
          value={other} onChange={(e) => onOther(e.target.value)} />
      </div>
    </div>
  );
}

function HoursChip({ value, custom, onValue, onCustom }: {
  value: string; custom: string;
  onValue: (v: string) => void;
  onCustom: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">Support hours / week</label>
      <div className="flex gap-1.5 items-center flex-wrap mt-1">
        {HOURS_CHIPS.map((h) => (
          <button key={h} type="button" onClick={() => onValue(value === h ? "" : h)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              value === h
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
            }`}>{h} hrs</button>
        ))}
        <input type="text" className="input w-20 text-xs py-1" placeholder="exact"
          value={custom} onChange={(e) => onCustom(e.target.value)} />
      </div>
    </div>
  );
}

const RECENCY_COUNT_CHIPS = ["1", "2–3", "4–5"];

function RecencyInput({
  number, unit, sinceInjury, onPatch,
}: {
  number: string; unit: string; sinceInjury: boolean;
  onPatch: (p: Partial<Pick<CommonSubdomainEntry, "recencyNumber" | "recencyUnit" | "recencySinceInjury">>) => void;
}) {
  const isDaily = number === "Daily";
  const isPresetCount = RECENCY_COUNT_CHIPS.includes(number) || isDaily;
  const disableUnit = isDaily || sinceInjury;
  const disableCount = sinceInjury;

  const preview = sinceInjury
    ? "since the injury"
    : isDaily
    ? "daily"
    : number && unit
    ? `${number} ${number === "1" ? unit.replace(/s$/, "") : unit} ago`
    : null;

  return (
    <div>
      <label className="label">Recency (last performed)</label>
      <div className="space-y-2 mt-1">
        <div className="flex gap-1.5 items-center flex-wrap">
          {RECENCY_COUNT_CHIPS.map((c) => (
            <button key={c} type="button"
              disabled={disableCount}
              onClick={() => onPatch({ recencyNumber: number === c ? "" : c })}
              className={`text-xs px-2.5 py-1 rounded border transition disabled:opacity-40 ${
                number === c && !sinceInjury
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
              }`}>{c}</button>
          ))}
          <button type="button"
            disabled={disableCount}
            onClick={() => onPatch({ recencyNumber: isDaily ? "" : "Daily", recencyUnit: "" })}
            className={`text-xs px-2.5 py-1 rounded border transition disabled:opacity-40 ${
              isDaily && !sinceInjury
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
            }`}>Daily</button>
          <input
            type="text"
            className="input w-16 text-xs py-1"
            placeholder="other"
            disabled={disableCount}
            value={isPresetCount || sinceInjury ? "" : number}
            onChange={(e) => onPatch({ recencyNumber: e.target.value })}
          />
          {/* Since injury — exclusive chip */}
          <button type="button"
            onClick={() => sinceInjury
              ? onPatch({ recencySinceInjury: false })
              : onPatch({ recencySinceInjury: true, recencyNumber: "", recencyUnit: "" })
            }
            className={`text-xs px-2.5 py-1 rounded border transition ${
              sinceInjury
                ? "bg-slate-700 text-white border-slate-700"
                : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
            }`}>Since injury</button>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {RECENCY_UNITS.map((u) => (
            <button key={u} type="button"
              disabled={disableUnit}
              onClick={() => onPatch({ recencyUnit: unit === u ? "" : u })}
              className={`text-xs px-2.5 py-1 rounded border transition disabled:opacity-40 ${
                unit === u && !disableUnit
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
              }`}>{u}</button>
          ))}
        </div>
        {preview && (
          <p className="text-[11px] text-violet-700 font-medium bg-violet-50 rounded px-2 py-0.5 inline-block">
            {preview}
          </p>
        )}
      </div>
    </div>
  );
}

function PreInjuryChip({ value, notes, onChange, onNotes }: {
  value: string; notes: string;
  onChange: (v: string) => void;
  onNotes: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">Pre-injury comparison</label>
      <div className="flex gap-1.5 mt-1 flex-wrap">
        {PRE_INJURY_CHIPS.map((opt) => (
          <button key={opt.value} type="button" onClick={() => onChange(value === opt.value ? "" : opt.value)}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              value === opt.value
                ? "bg-slate-600 text-white border-slate-600"
                : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
            }`}>{opt.label}</button>
        ))}
      </div>
      {value && (
        <input className="input mt-1.5 text-xs" placeholder="Notes (optional)"
          value={notes} onChange={(e) => onNotes(e.target.value)} />
      )}
    </div>
  );
}

// ── Common subdomain fields (rewritten) ───────────────────────────────────────

function CommonFields({
  data, onPatch, extraTop, extraBottom,
}: {
  data: CommonSubdomainEntry;
  onPatch: (p: Partial<CommonSubdomainEntry>) => void;
  extraTop?: React.ReactNode;
  extraBottom?: React.ReactNode;
}) {
  const ml = data.managementLevel ?? "";
  const needsPrompting  = ml === "needs_prompting";
  const needsAssistance = ml === "needs_assistance" || ml === "dependent";

  return (
    <div className="space-y-3">

      {/* Negative overrides — always visible */}
      <div className="flex gap-4">
        <FlagRow checked={!!data.doesNotPerform} label="Does not perform"
          onChange={(v) => onPatch({ doesNotPerform: v, noIssues: v ? false : data.noIssues })} />
        <FlagRow checked={!!data.noIssues} label="No issues"
          onChange={(v) => onPatch({ noIssues: v, doesNotPerform: v ? false : data.doesNotPerform })} />
      </div>

      {!data.doesNotPerform && !data.noIssues && (
        <>
          {extraTop}

          {/* 1. Frequency */}
          <FrequencyInput
            unit={data.frequencyUnit ?? ""}
            count={data.frequencyCount ?? ""}
            onUnit={(v) => onPatch({ frequencyUnit: v })}
            onCount={(v) => onPatch({ frequencyCount: v })} />

          {/* 2. Behaviour modifiers */}
          <BehaviourModifiers
            selected={data.behaviourModifiers ?? []}
            onChange={(v) => onPatch({ behaviourModifiers: v })} />

          {/* 3. How do they manage this activity */}
          <ManagementLevel value={ml} onChange={(v) => onPatch({ managementLevel: v })} />

          {/* 4a. Conditional: prompting */}
          {needsPrompting && (
            <div className="pl-3 border-l-2 border-orange-300 space-y-3">
              <WhoChips label="Who prompts"
                selected={data.promptingWhoChips ?? []}
                onChange={(v) => onPatch({ promptingWhoChips: v })}
                other={data.promptingWhoOther ?? ""}
                onOther={(v) => onPatch({ promptingWhoOther: v })} />
              <FrequencyInput label="Prompting frequency"
                unit={data.promptingFrequencyUnit ?? ""}
                count={data.promptingFrequencyCount ?? ""}
                onUnit={(v) => onPatch({ promptingFrequencyUnit: v })}
                onCount={(v) => onPatch({ promptingFrequencyCount: v })} />
            </div>
          )}

          {/* 4b. Conditional: assistance / dependent */}
          {needsAssistance && (
            <div className="pl-3 border-l-2 border-red-300 space-y-3">
              <WhoChips label="Who assists"
                selected={data.assistWhoChips ?? []}
                onChange={(v) => onPatch({ assistWhoChips: v })}
                other={data.assistWhoOther ?? ""}
                onOther={(v) => onPatch({ assistWhoOther: v })} />
              <HoursChip
                value={data.supportHoursChip ?? ""}
                custom={data.supportHoursCustom ?? ""}
                onValue={(v) => onPatch({ supportHoursChip: v })}
                onCustom={(v) => onPatch({ supportHoursCustom: v })} />
            </div>
          )}

          {/* Recency */}
          <RecencyInput
            number={data.recencyNumber ?? ""}
            unit={data.recencyUnit ?? ""}
            sinceInjury={!!data.recencySinceInjury}
            onPatch={onPatch} />

          {/* Pre-injury */}
          <PreInjuryChip
            value={data.preInjuryComparison ?? ""}
            notes={data.preInjuryComparisonNotes ?? ""}
            onChange={(v) => onPatch({ preInjuryComparison: v as CommonSubdomainEntry["preInjuryComparison"] })}
            onNotes={(v) => onPatch({ preInjuryComparisonNotes: v })} />

          {extraBottom}

          {/* Optional notes */}
          <Txt value={data.optionalFreeText ?? ""}
            onChange={(v) => onPatch({ optionalFreeText: v })}
            placeholder="Additional notes (optional)" small />

          {/* Evidence snippets */}
          <Snippets snippets={data.evidenceSnippets ?? []} onChange={(s) => onPatch({ evidenceSnippets: s })} />
        </>
      )}
    </div>
  );
}

// ── Accordion section (with status dot) ──────────────────────────────────────

function AccordionSection({
  id: _id, title, isOpen, onToggle, status, children,
}: {
  id: string; title: string; isOpen: boolean;
  onToggle: () => void;
  status?: SubdomainStatus;
  children: React.ReactNode;
}) {
  const dot =
    status === "complete" ? "bg-emerald-500" :
    status === "partial"  ? "bg-amber-400" :
    "bg-slate-200";

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-700 transition text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          <span>{title}</span>
        </div>
        <span className="text-slate-400 text-xs">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && <div className="px-3 py-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Self-care Panel ───────────────────────────────────────────────────────────

const SELF_CARE_SUBDOMAINS = [
  { key: "bathing",         label: "Bathing / Showering" },
  { key: "grooming",        label: "Grooming / Personal hygiene" },
  { key: "cooking",         label: "Cooking / Meal preparation" },
  { key: "householdChores", label: "Household chores" },
  { key: "shopping",        label: "Shopping" },
  { key: "other",           label: "Other self-care" },
];

function SelfCarePanel({ table, catIdx, onUpdate, open, onToggle }: PanelProps) {
  return (
    <div className="space-y-2">
      {SELF_CARE_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<CommonSubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<CommonSubdomainEntry>) => updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            status={computeStatus(data)} isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <CommonFields data={data} onPatch={patch} />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Social & Recreational Panel ───────────────────────────────────────────────

const SOCIAL_SUBDOMAINS = [
  { key: "socialOutings",      label: "Social outings" },
  { key: "hobbies",            label: "Hobbies" },
  { key: "exercise",           label: "Exercise / Sport" },
  { key: "culturalActivities", label: "Cultural / Religious activities" },
  { key: "socialParticipation", label: "Social participation" },
];

function SocialRecreationalPanel({ table, catIdx, onUpdate, open, onToggle }: PanelProps) {
  const flags = getSD<{ doesNotGoOut?: boolean; noHobbies?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: object) => updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!flags.doesNotGoOut} label="Does not go out"
          onChange={(v) => patchFlags({ doesNotGoOut: v })} />
        <FlagRow checked={!!flags.noHobbies} label="No hobbies or activities"
          onChange={(v) => patchFlags({ noHobbies: v })} />
      </div>

      {SOCIAL_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<SocialSubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<SocialSubdomainEntry>) => updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            status={computeStatus(data)} isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <CommonFields
              data={data}
              onPatch={patch}
              extraTop={
                <div className="space-y-3">
                  <Chips label="Activity types" options={ACTIVITY_TYPE_CHIPS}
                    selected={data.activityTypes ?? []} onChange={(v) => patch({ activityTypes: v })} />
                  <div className="grid grid-cols-2 gap-3">
                    <ChipSelect label="Initiation" options={INITIATION_CHIPS}
                      value={data.initiation ?? ""} onChange={(v) => patch({ initiation: v as SocialSubdomainEntry["initiation"] })} />
                    <ChipSelect label="Involvement" options={INVOLVEMENT_CHIPS}
                      value={data.involvementLevel ?? ""} onChange={(v) => patch({ involvementLevel: v as SocialSubdomainEntry["involvementLevel"] })} />
                  </div>
                  <ChipSelect label="Social engagement" options={ENGAGEMENT_CHIPS}
                    value={data.socialEngagementType ?? ""} onChange={(v) => patch({ socialEngagementType: v })} />
                  <ChipSelect label="Motivation" options={MOTIVATION_CHIPS}
                    value={data.motivationLevel ?? ""} onChange={(v) => patch({ motivationLevel: v })} />
                </div>
              }
              extraBottom={
                <div className="space-y-3">
                  <div>
                    <FlagRow checked={!!data.avoidanceBehaviour} label="Avoidance behaviour present"
                      onChange={(v) => patch({ avoidanceBehaviour: v })} />
                    {data.avoidanceBehaviour && (
                      <div className="mt-2 pl-3 border-l-2 border-amber-300">
                        <Chips label="Avoidance reasons" options={AVOIDANCE_REASON_CHIPS}
                          selected={data.avoidanceReasons ?? []} onChange={(v) => patch({ avoidanceReasons: v })} />
                      </div>
                    )}
                  </div>
                  <div>
                    <FlagRow checked={!!data.supportPersonRequired} label="Support person required"
                      onChange={(v) => patch({ supportPersonRequired: v })} />
                    {data.supportPersonRequired && (
                      <div className="mt-2 pl-3 border-l-2 border-violet-300">
                        <Txt value={data.supportPersonDetails ?? ""}
                          onChange={(v) => patch({ supportPersonDetails: v })}
                          placeholder="Who / what role?" small />
                      </div>
                    )}
                  </div>
                </div>
              }
            />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Travel Panel ──────────────────────────────────────────────────────────────

const TRAVEL_SUBDOMAINS = [
  { key: "localTravel",    label: "Local travel" },
  { key: "longDistance",   label: "Long-distance travel" },
  { key: "driving",        label: "Driving" },
  { key: "publicTransport", label: "Public transport" },
];

type TravelSD = CommonSubdomainEntry & {
  travelMode?: string[];
  drivingStatus?: string;
  safetyIssues?: boolean;
  safetyDescription?: string;
  distanceCapacity?: string;
};

function TravelPanel({ table, catIdx, onUpdate, open, onToggle }: PanelProps) {
  const flags = getSD<{ doesNotTravel?: boolean; cannotLeaveResidence?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: object) => updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!flags.doesNotTravel} label="Does not travel"
          onChange={(v) => patchFlags({ doesNotTravel: v })} />
        <FlagRow checked={!!flags.cannotLeaveResidence} label="Cannot leave residence"
          onChange={(v) => patchFlags({ cannotLeaveResidence: v })} />
      </div>

      {TRAVEL_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<TravelSD>(table, catIdx, key);
        const patch = (p: Partial<TravelSD>) => updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            status={computeStatus(data)} isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <CommonFields
              data={data}
              onPatch={(p) => patch(p as Partial<TravelSD>)}
              extraTop={
                <div className="space-y-3">
                  <Chips label="Travel mode" options={TRAVEL_MODE_CHIPS}
                    selected={data.travelMode ?? []} onChange={(v) => patch({ travelMode: v })} />
                  <ChipSelect label="Driving status" options={DRIVING_STATUS_CHIPS}
                    value={data.drivingStatus ?? ""} onChange={(v) => patch({ drivingStatus: v })} />
                  <SF label="Distance capacity">
                    <Txt value={data.distanceCapacity ?? ""} onChange={(v) => patch({ distanceCapacity: v })}
                      placeholder="e.g. within 2km, unable beyond suburb" small />
                  </SF>
                </div>
              }
              extraBottom={
                <div>
                  <FlagRow checked={!!data.safetyIssues} label="Safety issues when travelling"
                    onChange={(v) => patch({ safetyIssues: v })} />
                  {data.safetyIssues && (
                    <div className="mt-2 pl-3 border-l-2 border-red-300">
                      <Txt value={data.safetyDescription ?? ""} onChange={(v) => patch({ safetyDescription: v })}
                        placeholder="Describe safety concerns" small />
                    </div>
                  )}
                </div>
              }
            />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Social Functioning Panel ──────────────────────────────────────────────────

function RelationshipEntitySection({
  label: _label, data, onChange, children,
}: {
  label: string;
  data: RelationshipEntry;
  onChange: (p: Partial<RelationshipEntry>) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <SF label="Status">
        <Txt value={data.status ?? ""} onChange={(v) => onChange({ status: v })}
          placeholder="e.g. together, separated, no contact" small />
      </SF>
      <div className="grid grid-cols-2 gap-3">
        <SF label="Quality">
          <Sel value={data.quality ?? ""} options={RELATIONSHIP_QUALITY_OPTIONS}
            onChange={(v) => onChange({ quality: v as RelationshipEntry["quality"] })} />
        </SF>
        <SF label="Contact frequency">
          <Txt value={data.contactFrequency ?? ""} onChange={(v) => onChange({ contactFrequency: v })}
            placeholder="e.g. daily, weekly" small />
        </SF>
      </div>
      <SF label="Dependency">
        <Sel value={data.dependency ?? ""} options={DEPENDENCY_OPTIONS}
          onChange={(v) => onChange({ dependency: v as RelationshipEntry["dependency"] })} />
      </SF>
      {children}
      <Snippets snippets={data.evidenceSnippets ?? []} onChange={(s) => onChange({ evidenceSnippets: s })} />
    </div>
  );
}

function SocialFunctioningPanel({ table, catIdx, onUpdate, open, onToggle }: PanelProps) {
  const sf = getSD<SocialFunctioningData>(table, catIdx, "_sf");
  const patchSf = (p: Partial<SocialFunctioningData>) =>
    updateSD(table!, catIdx, "_sf", p, onUpdate);

  const patchEntity = <K extends keyof SocialFunctioningData>(
    entity: K,
    patch: Partial<SocialFunctioningData[K] & object>
  ) => {
    const existing = (sf[entity] ?? {}) as object;
    patchSf({ [entity]: { ...existing, ...patch } } as Partial<SocialFunctioningData>);
  };

  const entities: Array<{
    key: "partner" | "parents" | "siblings" | "friends";
    label: string; negateKey: keyof SocialFunctioningData;
  }> = [
    { key: "partner",  label: "Partner",        negateKey: "noPartner" },
    { key: "parents",  label: "Parents",         negateKey: "parentsDeceased" },
    { key: "siblings", label: "Siblings",        negateKey: "noSiblings" },
    { key: "friends",  label: "Friends (close)", negateKey: "noCloseFriends" },
  ];

  const children = (sf.children ?? {}) as ChildrenEntry;
  const patchChildren = (p: Partial<ChildrenEntry>) => patchSf({ children: { ...children, ...p } });

  return (
    <div className="space-y-2">
      <div className="bg-slate-50 rounded-lg p-3 space-y-2">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Flags</p>
        <div className="grid grid-cols-2 gap-1.5">
          <FlagRow checked={!!sf.noPartner}     label="No partner"        onChange={(v) => patchSf({ noPartner: v })} />
          <FlagRow checked={!!sf.noChildren}    label="No children"       onChange={(v) => patchSf({ noChildren: v })} />
          <FlagRow checked={!!sf.parentsDeceased} label="Parents deceased" onChange={(v) => patchSf({ parentsDeceased: v })} />
          <FlagRow checked={!!sf.noSiblings}    label="No siblings"       onChange={(v) => patchSf({ noSiblings: v })} />
          <FlagRow checked={!!sf.noCloseFriends} label="No close friends" onChange={(v) => patchSf({ noCloseFriends: v })} />
        </div>
        <div className="pt-1">
          <FlagRow checked={!!sf.domesticViolenceHistory} label="History of domestic violence"
            onChange={(v) => patchSf({ domesticViolenceHistory: v })} />
        </div>
      </div>

      <AccordionSection id="living" title="Living arrangement"
        isOpen={open.has("living")} onToggle={() => onToggle("living")}>
        <div className="space-y-3">
          <SF label="Situation">
            <Sel value={sf.livingArrangement ?? ""} options={LIVING_ARRANGEMENT_OPTIONS}
              onChange={(v) => patchSf({ livingArrangement: v as SocialFunctioningData["livingArrangement"] })} />
          </SF>
          <Txt value={sf.livingArrangementDetails ?? ""} onChange={(v) => patchSf({ livingArrangementDetails: v })}
            placeholder='e.g. "Lives with 2 children aged 8 and 10"' small />
        </div>
      </AccordionSection>

      {!sf.noChildren && (
        <AccordionSection id="children" title="Children"
          isOpen={open.has("children")} onToggle={() => onToggle("children")}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SF label="Number">
                <input type="number" className="input" min={0}
                  value={children.numberOfChildren ?? ""}
                  onChange={(e) => patchChildren({ numberOfChildren: Number(e.target.value) })} />
              </SF>
              <SF label="Ages">
                <Txt value={children.ages ?? ""} onChange={(v) => patchChildren({ ages: v })}
                  placeholder="e.g. 8, 10, 15" small />
              </SF>
            </div>
            <SF label="Care responsibility">
              <Sel value={children.careResponsibility ?? ""} options={CARE_RESPONSIBILITY_OPTIONS}
                onChange={(v) => patchChildren({ careResponsibility: v as ChildrenEntry["careResponsibility"] })} />
            </SF>
            <RelationshipEntitySection label="Children" data={children} onChange={(p) => patchChildren(p)} />
          </div>
        </AccordionSection>
      )}

      {entities.map(({ key, label, negateKey }) => {
        if (sf[negateKey]) return null;
        const data = (sf[key] ?? {}) as RelationshipEntry;
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <RelationshipEntitySection label={label} data={data}
              onChange={(p) => patchEntity(key, p)} />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Concentration Panel ───────────────────────────────────────────────────────

const CONCENTRATION_SUBDOMAINS = [
  { key: "reading",               label: "Reading" },
  { key: "taskCompletion",        label: "Task completion" },
  { key: "followingInstructions", label: "Following instructions" },
  { key: "conversationFocus",     label: "Conversation / focus" },
];

type ConcentrationSD = CommonSubdomainEntry & {
  durationCapacity?: string;
  fatigueOnset?: string;
  memoryIssues?: boolean;
  memoryIssueType?: string[];
  studyAbility?: boolean;
  studySupport?: string;
};

function ConcentrationPanel({ table, catIdx, onUpdate, open, onToggle }: PanelProps) {
  const flags = getSD<{ cannotSustain?: boolean; severeImpairment?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: object) => updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!flags.cannotSustain} label="Cannot sustain attention"
          onChange={(v) => patchFlags({ cannotSustain: v })} />
        <FlagRow checked={!!flags.severeImpairment} label="Severe impairment"
          onChange={(v) => patchFlags({ severeImpairment: v })} />
      </div>

      {CONCENTRATION_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<ConcentrationSD>(table, catIdx, key);
        const patch = (p: Partial<ConcentrationSD>) => updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            status={computeStatus(data)} isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <CommonFields
              data={data}
              onPatch={(p) => patch(p as Partial<ConcentrationSD>)}
              extraTop={
                <div className="grid grid-cols-2 gap-3">
                  <SF label="Duration capacity">
                    <Txt value={data.durationCapacity ?? ""} onChange={(v) => patch({ durationCapacity: v })}
                      placeholder="e.g. 10 min" small />
                  </SF>
                  <SF label="Fatigue onset">
                    <Txt value={data.fatigueOnset ?? ""} onChange={(v) => patch({ fatigueOnset: v })}
                      placeholder="e.g. after 5 min" small />
                  </SF>
                </div>
              }
              extraBottom={
                <div className="space-y-3">
                  <div>
                    <FlagRow checked={!!data.memoryIssues} label="Memory issues present"
                      onChange={(v) => patch({ memoryIssues: v })} />
                    {data.memoryIssues && (
                      <div className="mt-2 pl-3 border-l-2 border-amber-300">
                        <Chips label="Memory issue types" options={MEMORY_ISSUE_CHIPS}
                          selected={data.memoryIssueType ?? []} onChange={(v) => patch({ memoryIssueType: v })} />
                      </div>
                    )}
                  </div>
                  <div>
                    <FlagRow checked={!!data.studyAbility} label="Able to study / undertake training"
                      onChange={(v) => patch({ studyAbility: v })} />
                    {data.studyAbility && (
                      <div className="mt-2 pl-3 border-l-2 border-emerald-300">
                        <Txt value={data.studySupport ?? ""} onChange={(v) => patch({ studySupport: v })}
                          placeholder="Support needed for study" small />
                      </div>
                    )}
                  </div>
                </div>
              }
            />
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Employability Panel ───────────────────────────────────────────────────────

const EMPLOYABILITY_SUBDOMAINS = [
  { key: "currentWork",  label: "Current work" },
  { key: "workCapacity", label: "Work capacity" },
  { key: "volunteering", label: "Volunteering" },
  { key: "jobSeeking",   label: "Job-seeking" },
];

function EmployabilityPanel({ table, catIdx, onUpdate, open, onToggle }: PanelProps) {
  const flags = getSD<{ notWorking?: boolean; notSeekingWork?: boolean }>(table, catIdx, "_flags");
  const patchFlags = (p: object) => updateSD(table!, catIdx, "_flags", p, onUpdate);

  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-1">
        <FlagRow checked={!!flags.notWorking} label="Not working"
          onChange={(v) => patchFlags({ notWorking: v })} />
        <FlagRow checked={!!flags.notSeekingWork} label="Not seeking work"
          onChange={(v) => patchFlags({ notSeekingWork: v })} />
      </div>

      {EMPLOYABILITY_SUBDOMAINS.map(({ key, label }) => {
        const data = getSD<EmployabilitySubdomainEntry>(table, catIdx, key);
        const patch = (p: Partial<EmployabilitySubdomainEntry>) =>
          updateSD(table!, catIdx, key, p, onUpdate);
        return (
          <AccordionSection key={key} id={key} title={label}
            isOpen={open.has(key)} onToggle={() => onToggle(key)}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <SF label="Employment status">
                  <Sel value={data.employmentStatus ?? ""} options={EMPLOYMENT_STATUS_OPTIONS}
                    onChange={(v) => patch({ employmentStatus: v as EmployabilitySubdomainEntry["employmentStatus"] })} />
                </SF>
                <SF label="Hours / week">
                  <Txt value={data.hoursPerWeek ?? ""} onChange={(v) => patch({ hoursPerWeek: v })}
                    placeholder="e.g. 20" small />
                </SF>
              </div>
              <SF label="Consistency">
                <Sel value={data.consistency ?? ""} options={CONSISTENCY_OPTIONS}
                  onChange={(v) => patch({ consistency: v as EmployabilitySubdomainEntry["consistency"] })} />
              </SF>
              <SF label="Job type / history">
                <Txt value={data.jobTypeHistory ?? ""} onChange={(v) => patch({ jobTypeHistory: v })}
                  placeholder="e.g. labourer, admin, nursing" small />
              </SF>
              <SF label="Work attempts since injury">
                <Txt value={data.workAttemptsSinceInjury ?? ""} onChange={(v) => patch({ workAttemptsSinceInjury: v })}
                  placeholder="e.g. returned 2022, resigned due to pain" small />
              </SF>
              <Chips label="Barriers to work" options={BARRIERS_CHIPS}
                selected={data.barrierTypes ?? []} onChange={(v) => patch({ barrierTypes: v })} />
              {(data.barrierTypes?.length ?? 0) > 0 && (
                <Txt value={data.barriers ?? ""} onChange={(v) => patch({ barriers: v })}
                  placeholder="Additional barrier detail" small />
              )}
              <FlagRow checked={!!data.inconsistentHistoryFlag} label="Inconsistent work history reported"
                onChange={(v) => patch({ inconsistentHistoryFlag: v })} />
              <SF label="Last employment (recency)">
                <Txt value={data.lastEmployment ?? ""} onChange={(v) => patch({ lastEmployment: v })}
                  placeholder="e.g. 2 years ago, Jan 2022" small />
              </SF>
              <PreInjuryChip
                value={data.preInjuryComparison ?? ""}
                notes={data.preInjuryComparisonNotes ?? ""}
                onChange={(v) => patch({ preInjuryComparison: v as EmployabilitySubdomainEntry["preInjuryComparison"] })}
                onNotes={(v) => patch({ preInjuryComparisonNotes: v })} />
              <Snippets snippets={data.evidenceSnippets ?? []} onChange={(s) => patch({ evidenceSnippets: s })} />
            </div>
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ── Panel props type ──────────────────────────────────────────────────────────

type PanelProps = {
  table: PIRSTableModel;
  catIdx: number;
  onUpdate: (t: PIRSTableModel) => void;
  open: Set<string>;
  onToggle: (key: string) => void;
};

// ── Auto-sentence generation (delegated to narrativeEngine) ──────────────────

function generateAutoFindings(
  table: PIRSTableModel | undefined,
  catIdx: number,
  categoryKey: PirsCategoryKey,
  subjectGender: string | null | undefined
): string {
  if (!table) return "";
  return generateCategoryNarrative(table, catIdx, categoryKey, buildSubject(subjectGender));
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PIRSCategoryEntry({
  categoryKey,
  categoryIndex,
  table,
  onUpdateTable,
  subjectGender,
}: {
  categoryKey: PirsCategoryKey;
  categoryIndex: number;
  table: PIRSTableModel | undefined;
  onUpdateTable: (t: PIRSTableModel) => void;
  subjectGender?: string | null;
}) {
  const [openSubdomains, setOpenSubdomains] = useState<Set<string>>(new Set());
  const [focusMode, setFocusMode] = useState(false);

  function toggleSubdomain(key: string) {
    setOpenSubdomains((prev) => {
      const next = new Set(focusMode ? [] : prev);
      if (prev.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function collapseAll() { setOpenSubdomains(new Set()); }

  const findings  = getFinding(table, categoryIndex);
  const isManual  = isFindingManual(table, categoryIndex);

  const autoFindings = useMemo(
    () => generateAutoFindings(table, categoryIndex, categoryKey, subjectGender),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, categoryIndex, categoryKey, subjectGender]
  );

  function handleFindingsChange(val: string) {
    if (!table) return;
    updateFindings(table, categoryIndex, val, true, onUpdateTable);
  }

  function regenerateFindings() {
    if (!table) return;
    updateFindings(table, categoryIndex, autoFindings, false, onUpdateTable);
  }

  const classValue = table?.classes[categoryIndex] ?? 1;
  function setClass(v: number) {
    if (!table) return;
    const classes = [...table.classes];
    classes[categoryIndex] = v;
    onUpdateTable({ ...table, classes });
  }

  if (!table) {
    return (
      <div className="card p-4 text-sm text-slate-400 italic">
        Add a Current PIRS table to enter structured data.
      </div>
    );
  }

  const panelProps: PanelProps = {
    table,
    catIdx: categoryIndex,
    onUpdate: onUpdateTable,
    open: openSubdomains,
    onToggle: toggleSubdomain,
  };

  return (
    <div className="space-y-4">

      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500">Class</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setClass(v)}
                className={`w-8 h-8 text-xs font-bold rounded border transition ${
                  v === classValue
                    ? v >= 4 ? "bg-red-600 text-white border-red-600"
                      : v >= 3 ? "bg-amber-500 text-white border-amber-500"
                      : "bg-violet-600 text-white border-violet-600"
                    : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
                }`}
              >{v}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" className="w-3 h-3 accent-violet-600"
              checked={focusMode} onChange={(e) => setFocusMode(e.target.checked)} />
            Focus mode
          </label>
          <button type="button"
            className="text-[11px] px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100"
            onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      </div>

      {/* Category panel */}
      {categoryKey === "selfCare"           && <SelfCarePanel           {...panelProps} />}
      {categoryKey === "socialRecreational" && <SocialRecreationalPanel {...panelProps} />}
      {categoryKey === "travel"             && <TravelPanel             {...panelProps} />}
      {categoryKey === "socialFunction"     && <SocialFunctioningPanel  {...panelProps} />}
      {categoryKey === "concentration"      && <ConcentrationPanel      {...panelProps} />}
      {categoryKey === "adaptation"         && <EmployabilityPanel      {...panelProps} />}

      {/* Findings */}
      <div className="border-t pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="label mb-0">Findings</label>
          <div className="flex items-center gap-2">
            {isManual && (
              <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                manually edited
              </span>
            )}
            {autoFindings && (
              <button type="button"
                className="text-[11px] text-violet-600 hover:text-violet-800"
                onClick={regenerateFindings}>
                {isManual ? "Reset to generated" : "Regenerate"}
              </button>
            )}
          </div>
        </div>
        <textarea
          className="input w-full"
          rows={5}
          value={findings}
          onChange={(e) => handleFindingsChange(e.target.value)}
        />
        {!isManual && autoFindings && !findings && (
          <p className="text-[11px] text-slate-400 italic">
            Fill subdomains above to auto-generate findings.
          </p>
        )}
      </div>
    </div>
  );
}
