import { useState, useMemo, useRef, useEffect } from "react";
import { FrequencyInput } from "./FrequencyInput";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BaseType =
  | "partner" | "child" | "parent" | "sibling"
  | "grandparent" | "grandchild" | "other_relative"
  | "friend" | "household_member" | "carer" | "other";

export type AgeValue = { value: number; unit: "yr" | "mo" } | null;

export type ContactFrequency = {
  count: string;     // "1" | "2–3" | "4–5" | "Daily" | free text | ""
  unit: string;      // "Day" | "Week" | "Fortnight" | "Month" | "Year" | ""
  modifiers: string[];
};

export type PartnerContextEntry = {
  status: "" | "yes" | "no";
  details: string;
};

export type PartnerContext = {
  domestic_violence: PartnerContextEntry;
  separation_periods: PartnerContextEntry;
};

export type LivingArrangement = "" | "lives_with_client" | "client_lives_with_them" | "shared_care" | "none";

export type RelationshipAttributes = {
  quality?: "" | "good" | "strained" | "conflict" | "no_relationship" | "never_met";
  dependency?: "" | "independent" | "provides_care" | "receives_care";
  contact_frequency?: ContactFrequency;
  partner_context?: PartnerContext;
  living_arrangement?: LivingArrangement;
  role_other_text?: string;       // free-text role for other_relative, carer, household_member, other
  provider_company?: string;      // carer only
};

export type Relationship = {
  id: string;
  base_type: BaseType;
  role: string | null;
  status: string[];
  modifiers: string[];
  name: string;
  age: AgeValue;
  links: { parents: string[]; children: string[] };
  attributes?: RelationshipAttributes;
  order_mode?: "auto" | "manual";   // "auto" = system-sorted; "manual" = drag-order
  order_index?: number;             // only meaningful when order_mode === "manual"
};

// ── Exported constants (reuse across entire app) ──────────────────────────────

export const QUALITY_OPTIONS = [
  { value: "good",            label: "Good" },
  { value: "strained",        label: "Strained" },
  { value: "conflict",        label: "Conflict" },
  { value: "no_relationship", label: "No relationship" },
  { value: "never_met",       label: "Never met" },
] as const;

export const DEPENDENCY_OPTIONS = [
  { value: "independent",   label: "Independent" },
  { value: "provides_care", label: "Provides care" },
  { value: "receives_care", label: "Receives care" },
] as const;

export const CF_FREQUENCY_OPTIONS = ["1", "2–3", "4–5", "Daily"] as const;
export const CF_PERIOD_OPTIONS    = ["Day", "Week", "Fortnight", "Month", "Year"] as const;
export const CF_MODIFIER_OPTIONS  = ["Regular", "Irregular", "Avoids people", "Low motivation"] as const;

// ── Default factory ───────────────────────────────────────────────────────────

export function defaultRelationships(): Relationship[] {
  return [
    { id: crypto.randomUUID(), base_type: "parent", role: "Mother", status: [], modifiers: [], name: "", age: null, links: { parents: [], children: [] } },
    { id: crypto.randomUUID(), base_type: "parent", role: "Father", status: [], modifiers: [], name: "", age: null, links: { parents: [], children: [] } },
  ];
}

// ── Derived utilities (exported for PIRS / narrative) ─────────────────────────

const BASE_TYPE_LABELS: Record<BaseType, string> = {
  partner: "Partner", child: "Child", parent: "Parent", sibling: "Sibling",
  grandparent: "Grandparent", grandchild: "Grandchild", other_relative: "Other relative",
  friend: "Friend", household_member: "Household member", carer: "Carer", other: "Other",
};

export function deriveLabel(rel: Relationship): string {
  const statusPrefix = rel.status.length ? rel.status.join(" ") + " " : "";
  const roleStr = rel.role ?? BASE_TYPE_LABELS[rel.base_type];
  const modSuffix = rel.modifiers.length ? " • " + rel.modifiers.join(" • ") : "";
  return `${statusPrefix}${roleStr}${modSuffix}`;
}

// A relationship is a co-habitant only when living_arrangement is explicitly
// set to a non-"none" / non-empty value.
function isCohabitant(r: Relationship): boolean {
  const la = r.attributes?.living_arrangement;
  return !!la && la !== "none";
}

export function deriveLivingArrangement(rels: Relationship[]): string {
  const activePartner = rels.some(
    (r) => r.base_type === "partner" && isCohabitant(r) && !r.status.includes("Ex") && !r.status.includes("Deceased")
  );
  if (activePartner) return "Lives with partner";

  if (rels.some((r) => r.base_type === "child"  && isCohabitant(r))) return "Lives with children";
  if (rels.some((r) => r.base_type === "parent" && isCohabitant(r))) return "Lives with parents";
  if (rels.some(isCohabitant))                                        return "Lives with others";
  return "Lives alone";
}

// ── Shared UI: ContactFrequencyPanel ─────────────────────────────────────────
// Wraps the standard FrequencyInput + relationship-specific contact modifiers.

export function ContactFrequencyPanel({
  value: cf,
  onChange,
}: {
  value: ContactFrequency | undefined;
  onChange: (v: ContactFrequency) => void;
}) {
  const count = cf?.count ?? "";
  const unit  = cf?.unit  ?? "";
  const mods  = cf?.modifiers ?? [];

  return (
    <div className="space-y-2">
      <FrequencyInput
        label="Contact frequency"
        count={count}
        unit={unit}
        onCount={(c) => onChange({ count: c, unit, modifiers: mods })}
        onUnit={(u) => onChange({ count, unit: u, modifiers: mods })}
      />
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Contact pattern</p>
        <div className="flex flex-wrap gap-1">
          {CF_MODIFIER_OPTIONS.map((m) => (
            <button key={m} type="button"
              onClick={() => onChange({ count, unit, modifiers: mods.includes(m) ? mods.filter((x) => x !== m) : [...mods, m] })}
              className={`text-xs px-2 py-0.5 rounded border transition ${
                mods.includes(m) ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-600 border-slate-300 hover:border-amber-400"
              }`}>{m}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Internal constants ────────────────────────────────────────────────────────

const BASE_TYPES: Array<{ value: BaseType; label: string }> = [
  { value: "partner",          label: "Partner" },
  { value: "child",            label: "Child" },
  { value: "parent",           label: "Parent" },
  { value: "sibling",          label: "Sibling" },
  { value: "grandparent",      label: "Grandparent" },
  { value: "grandchild",       label: "Grandchild" },
  { value: "other_relative",   label: "Other relative" },
  { value: "household_member", label: "Household member" },
  { value: "friend",           label: "Friend" },
  { value: "carer",            label: "Carer" },
  { value: "other",            label: "Other" },
];

const GROUP_ORDER: BaseType[] = [
  "partner", "child", "parent", "sibling", "grandparent", "grandchild",
  "other_relative", "household_member", "friend", "carer", "other",
];

const GROUP_LABELS: Record<BaseType, string> = {
  partner: "Partner", child: "Children", parent: "Parents", sibling: "Siblings",
  grandparent: "Grandparents", grandchild: "Grandchildren", other_relative: "Other relatives",
  household_member: "Household members", friend: "Friends", carer: "Carers", other: "Other",
};

// Single-select role chips per base_type.
// household_member and other use only free text (role_other_text).
const ROLE_OPTIONS: Partial<Record<BaseType, string[]>> = {
  partner:        ["Husband", "Wife", "Boyfriend", "Girlfriend", "De facto"],
  child:          ["Daughter", "Son", "Non-binary"],
  parent:         ["Mother", "Father"],
  sibling:        ["Brother", "Sister"],
  grandparent:    ["Maternal Grandmother", "Maternal Grandfather", "Paternal Grandmother", "Paternal Grandfather"],
  grandchild:     ["Son's Son", "Son's Daughter", "Daughter's Son", "Daughter's Daughter"],
  other_relative: ["Maternal Aunt", "Maternal Uncle", "Paternal Aunt", "Paternal Uncle", "Male Cousin", "Female Cousin"],
  carer:          ["Cleaner", "Mower", "Food delivery", "Nurse", "Support worker", "Transport", "Informal", "Paid"],
};

// base_types that also have a free-text role input (role_other_text)
const ROLE_OTHER_TEXT_TYPES = new Set<BaseType>(["other_relative", "carer", "household_member", "other"]);

const LIVING_ARRANGEMENT_OPTIONS: Array<{ value: LivingArrangement; label: string }> = [
  { value: "lives_with_client",      label: "Lives with client" },
  { value: "client_lives_with_them", label: "Client lives with them" },
  { value: "shared_care",            label: "Shared care" },
  { value: "none",                   label: "No cohabitation" },
];

function getStatusOptions(bt: BaseType): string[] {
  if (bt === "partner") return ["Ex", "Separated", "Deceased"];
  if (bt === "friend")  return ["Ex", "Deceased"];
  return ["Deceased"];
}

// Multi-select modifiers per base_type.
// household_member entries are split into two mutually-exclusive groups (see below).
const MODIFIER_OPTIONS: Partial<Record<BaseType, string[]>> = {
  child:            ["Step", "Adopted", "Foster", "Half"],
  parent:           ["Step", "Adoptive", "Foster"],
  sibling:          ["Step", "Half"],
};

// Household member — two mutually-exclusive groups rendered on separate rows.
const HM_GENDER_GROUP = ["Male", "Female"] as const;
const HM_ROLE_GROUP   = ["Flatmate", "Boarder", "Lodger"] as const;

// Helper: toggle a household_member modifier enforcing mutual-exclusivity within its group.
function toggleHouseholdModifier(mod: string, currentMods: string[]): string[] {
  const group = (HM_GENDER_GROUP as readonly string[]).includes(mod) ? HM_GENDER_GROUP : HM_ROLE_GROUP;
  const filtered = currentMods.filter((m) => !(group as readonly string[]).includes(m));
  return currentMods.includes(mod) ? filtered : [...filtered, mod];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseAge(input: string): AgeValue {
  const s = input.trim();
  if (!s) return null;
  const mo = s.match(/^(\d+)\s*mo?$/i);
  if (mo) return { value: Number(mo[1]), unit: "mo" };
  const yr = s.match(/^(\d+)\s*(?:yr?s?|y)?$/i);
  if (yr) return { value: Number(yr[1]), unit: "yr" };
  return null;
}

function formatAge(age: AgeValue): string {
  if (!age) return "";
  return `${age.value}${age.unit}`;
}

function ageToMonths(age: AgeValue): number {
  if (!age) return -1;
  return age.unit === "yr" ? age.value * 12 : age.value;
}

function getPartnerPriority(r: Relationship): number {
  if (r.status.includes("Deceased"))  return 4;
  if (r.status.includes("Ex"))        return 3;
  if (r.status.includes("Separated")) return 2;
  return 1;
}

export function isCurrentPartner(r: Relationship): boolean {
  return (
    r.base_type === "partner" &&
    !r.status.includes("Ex") &&
    !r.status.includes("Deceased") &&
    !r.status.includes("Separated")
  );
}

function isGroupManual(rels: Relationship[]): boolean {
  return rels.some((r) => r.order_mode === "manual");
}

function sortGroup(rels: Relationship[], bt: BaseType): Relationship[] {
  // Manual order overrides everything
  if (isGroupManual(rels)) {
    return [...rels].sort((a, b) => (a.order_index ?? 9999) - (b.order_index ?? 9999));
  }
  // Partner priority sort
  if (bt === "partner") {
    return [...rels].sort((a, b) => getPartnerPriority(a) - getPartnerPriority(b));
  }
  // Auto: age DESC, ageless at end
  return [...rels].sort((a, b) => {
    const am = ageToMonths(a.age);
    const bm = ageToMonths(b.age);
    if (am === -1 && bm === -1) return 0;
    if (am === -1) return 1;
    if (bm === -1) return -1;
    return bm - am;
  });
}

// ── Chip button primitives ────────────────────────────────────────────────────

// dimmed = true on unselected chips within a single-select group that already
// has a selection.  Chips remain clickable — only opacity is reduced.
function Chip({ label, active, onClick, variant = "violet", dimmed = false }: {
  label: string; active: boolean; onClick: () => void;
  variant?: "violet" | "slate" | "amber";
  dimmed?: boolean;
}) {
  const on =
    variant === "slate"  ? "bg-slate-700 text-white border-slate-700" :
    variant === "amber"  ? "bg-amber-500 text-white border-amber-500" :
    "bg-violet-600 text-white border-violet-600";
  const off =
    variant === "amber"
      ? "bg-white text-slate-600 border-slate-300 hover:border-amber-400"
      : "bg-white text-slate-600 border-slate-300 hover:border-violet-400";
  return (
    <button type="button" onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded border transition ${active ? on : off} ${dimmed && !active ? "opacity-50" : ""}`}>
      {label}
    </button>
  );
}

// ── Column 3 attribute panel ──────────────────────────────────────────────────

function AttrPanel({
  rel,
  onUpdateAttr,
}: {
  rel: Relationship;
  onUpdateAttr: (attrs: Partial<RelationshipAttributes>) => void;
}) {
  const attrs = rel.attributes ?? {};
  return (
    <div className="space-y-4 p-3">
      <p className="text-xs font-semibold text-slate-700 truncate">{deriveLabel(rel)}</p>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Quality</p>
        <div className="flex flex-wrap gap-1">
          {QUALITY_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label}
              active={attrs.quality === o.value}
              dimmed={!!attrs.quality && attrs.quality !== o.value}
              onClick={() => onUpdateAttr({ quality: attrs.quality === o.value ? "" : o.value })} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Dependency</p>
        <div className="flex flex-wrap gap-1">
          {DEPENDENCY_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label}
              active={attrs.dependency === o.value}
              dimmed={!!attrs.dependency && attrs.dependency !== o.value}
              onClick={() => onUpdateAttr({ dependency: attrs.dependency === o.value ? "" : o.value })} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Contact frequency</p>
        <ContactFrequencyPanel
          value={attrs.contact_frequency}
          onChange={(cf) => onUpdateAttr({ contact_frequency: cf })} />
      </div>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Living arrangement</p>
        <div className="flex flex-wrap gap-1">
          {LIVING_ARRANGEMENT_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label}
              active={attrs.living_arrangement === o.value}
              dimmed={!!attrs.living_arrangement && attrs.living_arrangement !== o.value}
              onClick={() => onUpdateAttr({ living_arrangement: attrs.living_arrangement === o.value ? "" : o.value })} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BatchPanel({
  count,
  batchAttrs,
  onBatchAttrs,
  onApply,
  onClear,
}: {
  count: number;
  batchAttrs: RelationshipAttributes;
  onBatchAttrs: (p: Partial<RelationshipAttributes>) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{count} selected</p>
        <button type="button" onClick={onClear}
          className="text-[11px] text-slate-400 hover:text-red-500">Clear</button>
      </div>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Quality</p>
        <div className="flex flex-wrap gap-1">
          {QUALITY_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label}
              active={batchAttrs.quality === o.value}
              dimmed={!!batchAttrs.quality && batchAttrs.quality !== o.value}
              onClick={() => onBatchAttrs({ quality: batchAttrs.quality === o.value ? "" : o.value })} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Dependency</p>
        <div className="flex flex-wrap gap-1">
          {DEPENDENCY_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label}
              active={batchAttrs.dependency === o.value}
              dimmed={!!batchAttrs.dependency && batchAttrs.dependency !== o.value}
              onClick={() => onBatchAttrs({ dependency: batchAttrs.dependency === o.value ? "" : o.value })} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Contact frequency</p>
        <ContactFrequencyPanel
          value={batchAttrs.contact_frequency}
          onChange={(cf) => onBatchAttrs({ contact_frequency: cf })} />
      </div>
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Living arrangement</p>
        <div className="flex flex-wrap gap-1">
          {LIVING_ARRANGEMENT_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label}
              active={batchAttrs.living_arrangement === o.value}
              dimmed={!!batchAttrs.living_arrangement && batchAttrs.living_arrangement !== o.value}
              onClick={() => onBatchAttrs({ living_arrangement: batchAttrs.living_arrangement === o.value ? "" : o.value })} />
          ))}
        </div>
      </div>
      <button type="button" onClick={onApply}
        className="w-full text-xs px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-500 transition">
        Apply to Selected
      </button>
    </div>
  );
}

// ── Partner context helpers ───────────────────────────────────────────────────

function emptyPartnerCtx(): PartnerContext {
  return {
    domestic_violence:  { status: "", details: "" },
    separation_periods: { status: "", details: "" },
  };
}

function PartnerContextEditor({
  value: pctx,
  onChange,
}: {
  value: PartnerContext;
  onChange: (v: PartnerContext) => void;
}) {
  function updDV(p: Partial<PartnerContextEntry>) {
    onChange({ ...pctx, domestic_violence: { ...pctx.domestic_violence, ...p } });
  }
  function updSep(p: Partial<PartnerContextEntry>) {
    onChange({ ...pctx, separation_periods: { ...pctx.separation_periods, ...p } });
  }

  return (
    <>
      {/* Domestic violence */}
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Domestic violence</p>
        <div className="flex gap-1 mb-1.5">
          <Chip label="Yes" active={pctx.domestic_violence.status === "yes"} variant="slate"
            dimmed={pctx.domestic_violence.status === "no"}
            onClick={() => updDV({ status: pctx.domestic_violence.status === "yes" ? "" : "yes" })} />
          <Chip label="No" active={pctx.domestic_violence.status === "no"} variant="slate"
            dimmed={pctx.domestic_violence.status === "yes"}
            onClick={() => updDV({ status: pctx.domestic_violence.status === "no" ? "" : "no" })} />
        </div>
        {pctx.domestic_violence.status === "yes" && (
          <textarea
            className="input text-xs w-full"
            rows={2}
            placeholder="Details…"
            value={pctx.domestic_violence.details}
            onChange={(e) => updDV({ details: e.target.value })}
          />
        )}
      </div>

      {/* Periods of separation */}
      <div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Periods of separation</p>
        <div className="flex gap-1 mb-1.5">
          <Chip label="Yes" active={pctx.separation_periods.status === "yes"} variant="slate"
            dimmed={pctx.separation_periods.status === "no"}
            onClick={() => updSep({ status: pctx.separation_periods.status === "yes" ? "" : "yes" })} />
          <Chip label="No" active={pctx.separation_periods.status === "no"} variant="slate"
            dimmed={pctx.separation_periods.status === "yes"}
            onClick={() => updSep({ status: pctx.separation_periods.status === "no" ? "" : "no" })} />
        </div>
        {pctx.separation_periods.status === "yes" && (
          <textarea
            className="input text-xs w-full"
            rows={2}
            placeholder="Details…"
            value={pctx.separation_periods.details}
            onChange={(e) => updSep({ details: e.target.value })}
          />
        )}
      </div>
    </>
  );
}

// ── Central Interaction Router — event type catalogue ─────────────────────────
// All chip-row zone interactions (A/B/C/D) dispatch through handleInteraction().
// No JSX event handler may call setState directly — only the router may do so.

// Drag events are handled outside this router via pointer events (see startPointerDrag).
type InteractionEvt =
  | { type: "select";               id: string }
  | { type: "toggle_select";        id: string }
  | { type: "expand";               id: string }
  | { type: "delete";               id: string }
  // Global boundary: fires on every document pointerdown; router decides whether to collapse.
  | { type: "global_pointer_down";  event: PointerEvent };

// ── Main component ────────────────────────────────────────────────────────────

export default function RelationshipManager({
  value,
  onChange,
}: {
  value: Relationship[];
  onChange: (v: Relationship[]) => void;
}) {
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editingAgeId,  setEditingAgeId]  = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [showNames,     setShowNames]     = useState(false);
  const [ageRaw,        setAgeRaw]        = useState<Record<string, string>>({});
  const [batchAttrs,    setBatchAttrs]    = useState<RelationshipAttributes>({});
  // Drag state: which id is being dragged, and which id is the current drop target
  const [draggingId,    setDraggingId]    = useState<string | null>(null);
  const [dragOverId,    setDragOverId]    = useState<string | null>(null);

  const isBatch   = selected.size >= 2;
  const singleId  = selected.size === 1 ? [...selected][0] : null;
  const singleRel = singleId ? value.find((r) => r.id === singleId) ?? null : null;

  // ── Mutations ─────────────────────────────────────────────────────────────

  function add(bt: BaseType) {
    const rel: Relationship = {
      id: crypto.randomUUID(),
      base_type: bt,
      role: null,           // MUST be null — no auto-selection
      status: [], modifiers: [], name: "", age: null,
      links: { parents: [], children: [] },
    };
    onChange([...value, rel]);
    setEditingId(rel.id);
    setSelected(new Set([rel.id]));
    setBatchAttrs({});
  }

  function patch(id: string, p: Partial<Relationship>) {
    onChange(value.map((r) => r.id === id ? { ...r, ...p } : r));
  }

  function updateAttr(id: string, attrs: Partial<RelationshipAttributes>) {
    onChange(value.map((r) =>
      r.id === id ? { ...r, attributes: { ...r.attributes, ...attrs } } : r
    ));
  }

  function remove(id: string) {
    onChange(value.filter((r) => r.id !== id));
    setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
    if (editingId === id)    setEditingId(null);
    if (editingAgeId === id) setEditingAgeId(null);
    if (editingNameId === id) setEditingNameId(null);
    setAgeRaw((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function toggleCheck(id: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
    setBatchAttrs({});
  }

  // ── Central Interaction Router ────────────────────────────────────────────
  // Single dispatch point for ALL chip-row zone events.
  // Zone A = select/toggle_select  Zone B = expand (open only)
  // Zone C = delete                Zone D = pointer drag (outside router)
  // Collapse is ONLY triggered by global_pointer_down hitting outside all zones.
  function handleInteraction(evt: InteractionEvt) {
    switch (evt.type) {
      case "select":
        // Zone A plain click — exclusive select, or deselect if already the sole selection
        setSelected((prev) => {
          if (prev.size === 1 && prev.has(evt.id)) return new Set<string>();
          return new Set<string>([evt.id]);
        });
        setBatchAttrs({});
        break;
      case "toggle_select":
        // Zone A Ctrl/Cmd click or checkbox — add/remove from multi-selection
        toggleCheck(evt.id);
        break;
      case "expand":
        // Zone B — open inline edit panel (never toggles; collapse is global only)
        setEditingId(evt.id);
        break;
      case "delete":
        // Zone C — remove relationship
        remove(evt.id);
        break;
      case "global_pointer_down": {
        // Collapse ONLY if the pointer landed outside every protected zone.
        const el = evt.event.target as Element | null;
        if (!el) break;
        const insideZone =
          el.closest('[data-zone="row"]')        ||
          el.closest('[data-zone="attributes"]') ||
          el.closest('[data-zone="drag"]')       ||
          el.closest('[data-zone="expand"]')     ||
          el.closest('[data-zone="delete"]');
        if (!insideZone) setEditingId(null);
        break;
      }
    }
  }

  // ── Global collapse boundary ──────────────────────────────────────────────
  // One listener only. setEditingId is stable so the empty-dep closure is safe.
  useEffect(() => {
    function handleGlobalPointerDown(e: PointerEvent) {
      handleInteraction({ type: "global_pointer_down", event: e });
    }
    document.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => document.removeEventListener("pointerdown", handleGlobalPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearSelection() {
    setSelected(new Set());
    setBatchAttrs({});
  }

  function toggleGroupSelect(ids: string[]) {
    const allIn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const s = new Set(prev);
      if (allIn) ids.forEach((id) => s.delete(id));
      else ids.forEach((id) => s.add(id));
      return s;
    });
    setBatchAttrs({});
  }

  function applySmartSelect(option: string) {
    let ids: string[] = [];
    switch (option) {
      case "siblings":    ids = value.filter((r) => r.base_type === "sibling").map((r) => r.id); break;
      case "children":    ids = value.filter((r) => r.base_type === "child").map((r) => r.id); break;
      case "parents":     ids = value.filter((r) => r.base_type === "parent").map((r) => r.id); break;
      case "dependents":  ids = value.filter((r) => r.attributes?.dependency === "receives_care").map((r) => r.id); break;
      // Co-habitant = living_arrangement explicitly set to something other than "none"
      case "cohabitants": ids = value.filter(isCohabitant).map((r) => r.id); break;
    }
    setSelected(new Set(ids));
    setBatchAttrs({});
  }

  // ── Drag-and-drop ordering ─────────────────────────────────────────────────

  function handleDrop(dragId: string, dropId: string, bt: BaseType) {
    if (dragId === dropId) return;
    const groupRels = sortGroup(value.filter((r) => r.base_type === bt), bt);
    const from = groupRels.findIndex((r) => r.id === dragId);
    const to   = groupRels.findIndex((r) => r.id === dropId);
    if (from === -1 || to === -1) return;
    const reordered = [...groupRels];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const stamp = new Map(reordered.map((r, i) => [r.id, i]));
    onChange(value.map((r) => {
      if (r.base_type !== bt) return r;
      return { ...r, order_mode: "manual" as const, order_index: stamp.get(r.id) ?? 0 };
    }));
  }

  // ── Pointer-event drag (replaces HTML5 DnD — reliable in Tauri/WKWebView) ───
  // A ref (not state) carries the drag source so there are zero stale-closure issues.
  const ptrDragRef = useRef<{ id: string; bt: BaseType } | null>(null);

  function startPointerDrag(id: string, dragBt: BaseType, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    ptrDragRef.current = { id, bt: dragBt };
    setDraggingId(id);

    function onMove(ev: PointerEvent) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest("[data-rel-id]");
      setDragOverId(row?.getAttribute("data-rel-id") ?? null);
    }

    function onUp(ev: PointerEvent) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);

      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest("[data-rel-id]");
      const dropId = row?.getAttribute("data-rel-id") ?? null;
      const dropBt = row?.getAttribute("data-rel-bt") as BaseType | null;

      const src = ptrDragRef.current;
      ptrDragRef.current = null;
      setDraggingId(null);
      setDragOverId(null);

      if (src && dropId && dropId !== src.id && dropBt === src.bt) {
        handleDrop(src.id, dropId, src.bt);
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function resetGroupOrder(bt: BaseType) {
    onChange(value.map((r) =>
      r.base_type === bt ? { ...r, order_mode: "auto" as const, order_index: undefined } : r
    ));
  }

  // ── Batch apply ───────────────────────────────────────────────────────────

  function applyBatch() {
    const ids = selected;
    onChange(value.map((r) => {
      if (!ids.has(r.id)) return r;
      const a: RelationshipAttributes = { ...r.attributes };
      if (batchAttrs.quality               !== undefined) a.quality               = batchAttrs.quality;
      if (batchAttrs.dependency            !== undefined) a.dependency            = batchAttrs.dependency;
      if (batchAttrs.contact_frequency     !== undefined) a.contact_frequency     = batchAttrs.contact_frequency;
      if (batchAttrs.living_arrangement    !== undefined) a.living_arrangement    = batchAttrs.living_arrangement;
      return { ...r, attributes: a };
    }));
    setBatchAttrs({});
  }

  function toggleStatus(id: string, s: string, bt: BaseType) {
    onChange(value.map((r) => {
      if (r.id !== id) return r;
      const isAdding = !r.status.includes(s);
      let newStatus = isAdding
        ? [...r.status, s]
        : r.status.filter((x) => x !== s);
      // Ex and Separated are mutually exclusive for partners
      if (bt === "partner" && isAdding) {
        if (s === "Ex")        newStatus = newStatus.filter((x) => x !== "Separated");
        if (s === "Separated") newStatus = newStatus.filter((x) => x !== "Ex");
      }
      // Separated auto-trigger: set separation_periods.status = "yes"
      let newAttrs = r.attributes;
      if (bt === "partner" && s === "Separated" && isAdding) {
        const pctx = r.attributes?.partner_context ?? emptyPartnerCtx();
        newAttrs = {
          ...r.attributes,
          partner_context: { ...pctx, separation_periods: { ...pctx.separation_periods, status: "yes" } },
        };
      }
      return { ...r, status: newStatus, attributes: newAttrs };
    }));
  }

  // ── Age raw input ─────────────────────────────────────────────────────────

  function onAgeChange(id: string, raw: string) {
    setAgeRaw((prev) => ({ ...prev, [id]: raw }));
    const parsed = parseAge(raw);
    if (parsed !== null || raw === "") patch(id, { age: parsed });
  }

  function onAgeBlur(id: string) {
    setAgeRaw((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  function ageDisplay(rel: Relationship): string {
    return ageRaw[rel.id] !== undefined ? ageRaw[rel.id] : formatAge(rel.age);
  }

  // ── Grouping ──────────────────────────────────────────────────────────────

  const grouped = useMemo(() => (
    GROUP_ORDER
      .map((bt) => ({ bt, rels: sortGroup(value.filter((r) => r.base_type === bt), bt) }))
      .filter((g) => g.rels.length > 0)
  ), [value]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">

      {/* Top controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
          <input type="checkbox" className="w-3 h-3 accent-violet-600"
            checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
          Show names
        </label>

        <select className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-600 bg-white"
          value=""
          onChange={(e) => { if (e.target.value) applySmartSelect(e.target.value); }}>
          <option value="">Smart Select…</option>
          <option value="siblings">All Siblings</option>
          <option value="children">All Children</option>
          <option value="parents">All Parents</option>
          <option value="dependents">All Dependents</option>
          <option value="cohabitants">All Co-habitants</option>
        </select>

        <button type="button"
          className="text-xs px-2 py-1 border border-slate-200 rounded text-slate-600 hover:bg-slate-50"
          onClick={() => setEditingId(null)}>
          Collapse All
        </button>

        {selected.size > 0 && (
          <button type="button" onClick={clearSelection}
            className="text-xs text-slate-400 hover:text-red-500 ml-auto">
            Clear ({selected.size})
          </button>
        )}
      </div>

      {/* 3-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 256px", gap: "8px", alignItems: "start" }}>

        {/* Column 1 — Base type add buttons */}
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-1 mb-1.5">Add</p>
          {BASE_TYPES.map(({ value: bt, label }) => (
            <button key={bt} type="button" onClick={() => add(bt)}
              className="w-full text-left text-xs px-2 py-1 rounded text-slate-600 hover:bg-violet-50 hover:text-violet-700 transition">
              + {label}
            </button>
          ))}
        </div>

        {/* Column 2 — Grouped chips */}
        <div className="space-y-3 min-w-0">
          {value.length === 0 && (
            <p className="text-xs text-slate-400 italic px-1 pt-1">No relationships added.</p>
          )}
          {grouped.map(({ bt, rels }) => {
            const groupIds  = rels.map((r) => r.id);
            const allGroupSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
            const groupIsManual    = isGroupManual(rels);
            return (
              <div key={bt}>
                {/* Group header */}
                <div className="flex items-center justify-between px-1 mb-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                      {GROUP_LABELS[bt]}
                    </p>
                    {groupIsManual && (
                      <span className="text-[9px] text-slate-400 bg-slate-100 rounded px-1 py-px select-none" title="Drag to reorder">
                        ⠿ manual
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {groupIsManual && (
                      <button type="button"
                        className="text-[10px] text-slate-400 hover:text-slate-600"
                        onClick={() => resetGroupOrder(bt)}>
                        Reset order
                      </button>
                    )}
                    <button type="button"
                      className="text-[10px] text-violet-500 hover:text-violet-700"
                      onClick={() => toggleGroupSelect(groupIds)}>
                      {allGroupSelected ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                </div>

                {/* Partner validation warning */}
                {bt === "partner" && rels.filter(isCurrentPartner).length > 1 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">
                    ⚠ Multiple current partners detected.
                  </p>
                )}

                {/* Chip rows */}
                <div className="space-y-px">
                  {rels.map((rel) => {
                    const isSel       = selected.has(rel.id);
                    const isOpen      = editingId === rel.id;
                    const isEditAge   = editingAgeId === rel.id;
                    const isEditName  = editingNameId === rel.id;
                    const roles       = ROLE_OPTIONS[rel.base_type] ?? [];
                    const mods        = MODIFIER_OPTIONS[rel.base_type] ?? [];
                    const rawAge      = ageDisplay(rel);
                    const badAge      = !!ageRaw[rel.id] && !parseAge(ageRaw[rel.id] ?? "");
                    const statusOpts  = getStatusOptions(rel.base_type);
                    const isDragOver  = dragOverId === rel.id && draggingId !== rel.id;

                    return (
                      <div key={rel.id} data-zone="row">
                        {/* ── Chip row ── zones: D(drag) · multi-sel(checkbox) · B(expand) · A(label) · age · name · C(delete) */}
                        <div
                          data-rel-id={rel.id}
                          data-rel-bt={bt}
                          onClick={(e) => { e.stopPropagation(); handleInteraction(e.metaKey || e.ctrlKey ? { type: "toggle_select", id: rel.id } : { type: "select", id: rel.id }); }}
                          className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs transition select-none ${
                            isDragOver  ? "ring-2 ring-violet-400 bg-violet-50" :
                            isSel       ? "bg-violet-50" :
                            isOpen      ? "bg-slate-50" :
                            "hover:bg-slate-50"
                          } ${draggingId === rel.id ? "opacity-40" : ""}`}>

                          {/* Zone D — Drag handle (pointer events, not HTML5 DnD) */}
                          <span
                            data-zone="drag"
                            onPointerDown={(e) => startPointerDrag(rel.id, bt, e)}
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-300 cursor-grab shrink-0 select-none leading-none text-sm px-0.5 hover:text-slate-500"
                            title="Drag to reorder">⠿</span>

                          {/* Multi-select checkbox — independent of Zone A */}
                          <input type="checkbox" className="w-3 h-3 accent-violet-600 shrink-0 cursor-pointer"
                            checked={isSel}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => handleInteraction({ type: "toggle_select", id: rel.id })} />

                          {/* Zone B — Expand (opens panel; collapse is global-only) */}
                          <button type="button"
                            data-zone="expand"
                            className={`shrink-0 text-slate-400 hover:text-violet-500 leading-none transition-transform ${isOpen ? "rotate-90" : ""}`}
                            style={{ fontSize: 10 }}
                            onClick={(e) => { e.stopPropagation(); handleInteraction({ type: "expand", id: rel.id }); }}
                            title="Expand">▶</button>

                          {/* Zone A — Label (click = toggle selection) */}
                          <span
                            className={`flex-1 min-w-0 text-left font-medium truncate cursor-pointer ${
                              isSel ? "text-violet-700" : "text-slate-700 hover:text-violet-600"
                            }`}>
                            {deriveLabel(rel)}
                            {rel.status.includes("Deceased") && (
                              <span className="ml-1 text-[10px] text-slate-400">†</span>
                            )}
                          </span>

                          {/* Age — always visible, clickable to inline-edit */}
                          {isEditAge ? (
                            <input
                              autoFocus
                              className="input text-[11px] py-0 w-16 shrink-0"
                              placeholder="12 or 6mo"
                              value={rawAge}
                              onChange={(e) => onAgeChange(rel.id, e.target.value)}
                              onBlur={() => { onAgeBlur(rel.id); setEditingAgeId(null); }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span
                              className="text-slate-400 shrink-0 text-[11px] cursor-pointer hover:text-violet-500"
                              onClick={(e) => { e.stopPropagation(); setEditingAgeId(rel.id); }}
                              title="Click to edit age"
                            >
                              {rel.age ? formatAge(rel.age) : <span className="text-slate-300">age</span>}
                            </span>
                          )}
                          {badAge && isEditAge && (
                            <span className="text-[10px] text-amber-500 shrink-0">12 or 6mo</span>
                          )}

                          {/* Name — visible when Show Names is ON, clickable to inline-edit */}
                          {showNames && (
                            isEditName ? (
                              <input
                                autoFocus
                                className="input text-[11px] py-0 w-20 shrink-0"
                                placeholder="First name"
                                value={rel.name}
                                onChange={(e) => patch(rel.id, { name: e.target.value })}
                                onBlur={() => setEditingNameId(null)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span
                                className="text-slate-400 shrink-0 text-[11px] truncate max-w-[70px] cursor-pointer hover:text-violet-500"
                                onClick={(e) => { e.stopPropagation(); setEditingNameId(rel.id); }}
                                title="Click to edit name"
                              >
                                {rel.name || <span className="text-slate-300">name</span>}
                              </span>
                            )
                          )}

                          {/* Zone C — Delete (isolated far right) */}
                          <button type="button"
                            data-zone="delete"
                            className="text-slate-300 hover:text-red-400 shrink-0 px-1 leading-none text-base ml-1"
                            onClick={(e) => { e.stopPropagation(); handleInteraction({ type: "delete", id: rel.id }); }}>×</button>
                        </div>

                        {/* Inline edit panel — Role → Modifiers → Status */}
                        {isOpen && (
                          <div className="ml-5 mb-2 mt-0.5 p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2.5">

                            {roles.length > 0 && (
                              <div>
                                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Role</p>
                                <div className="flex flex-wrap gap-1">
                                  {roles.map((r) => (
                                    <Chip key={r} label={r} active={rel.role === r}
                                      dimmed={!!rel.role && rel.role !== r}
                                      onClick={() => patch(rel.id, { role: rel.role === r ? null : r })} />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Household member: two mutually-exclusive modifier groups on separate rows */}
                            {rel.base_type === "household_member" ? (
                              <div>
                                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Type</p>
                                {/* Row 1: Gender (mutually exclusive) */}
                                <div className="flex gap-1 mb-1">
                                  {HM_GENDER_GROUP.map((m) => {
                                    const hasGender = HM_GENDER_GROUP.some((g) => rel.modifiers.includes(g));
                                    return (
                                      <Chip key={m} label={m} active={rel.modifiers.includes(m)} variant="slate"
                                        dimmed={hasGender && !rel.modifiers.includes(m)}
                                        onClick={() => patch(rel.id, { modifiers: toggleHouseholdModifier(m, rel.modifiers) })} />
                                    );
                                  })}
                                </div>
                                {/* Row 2: Role type (mutually exclusive) */}
                                <div className="flex gap-1">
                                  {HM_ROLE_GROUP.map((m) => {
                                    const hasRole = HM_ROLE_GROUP.some((r) => rel.modifiers.includes(r));
                                    return (
                                      <Chip key={m} label={m} active={rel.modifiers.includes(m)} variant="slate"
                                        dimmed={hasRole && !rel.modifiers.includes(m)}
                                        onClick={() => patch(rel.id, { modifiers: toggleHouseholdModifier(m, rel.modifiers) })} />
                                    );
                                  })}
                                </div>
                              </div>
                            ) : mods.length > 0 && (
                              <div>
                                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Modifiers</p>
                                <div className="flex flex-wrap gap-1">
                                  {mods.map((m) => (
                                    <Chip key={m} label={m} active={rel.modifiers.includes(m)} variant="slate"
                                      onClick={() => patch(rel.id, {
                                        modifiers: rel.modifiers.includes(m) ? rel.modifiers.filter((x) => x !== m) : [...rel.modifiers, m],
                                      })} />
                                  ))}
                                </div>
                              </div>
                            )}

                            {statusOpts.length > 0 && (
                              <div>
                                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Status</p>
                                <div className="flex flex-wrap gap-1">
                                  {statusOpts.map((s) => (
                                    <Chip key={s} label={s} active={rel.status.includes(s)} variant="slate"
                                      onClick={() => toggleStatus(rel.id, s, rel.base_type)} />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Free-text role (other_relative, carer, household_member, other) */}
                            {ROLE_OTHER_TEXT_TYPES.has(rel.base_type) && (
                              <div>
                                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                                  {rel.base_type === "carer" ? "Additional role" : "Role (free text)"}
                                </p>
                                <input
                                  className="input text-xs py-0.5 w-full"
                                  placeholder={rel.base_type === "carer" ? "e.g. Physiotherapist" : "Describe role…"}
                                  value={rel.attributes?.role_other_text ?? ""}
                                  onChange={(e) => updateAttr(rel.id, { role_other_text: e.target.value })}
                                />
                              </div>
                            )}

                            {/* Provider company (carer only) */}
                            {rel.base_type === "carer" && (
                              <div>
                                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">Provider / company</p>
                                <input
                                  className="input text-xs py-0.5 w-full"
                                  placeholder="Organisation name…"
                                  value={rel.attributes?.provider_company ?? ""}
                                  onChange={(e) => updateAttr(rel.id, { provider_company: e.target.value })}
                                />
                              </div>
                            )}

                            {/* Partner-specific: domestic violence + periods of separation */}
                            {rel.base_type === "partner" && (
                              <PartnerContextEditor
                                value={rel.attributes?.partner_context ?? emptyPartnerCtx()}
                                onChange={(pc) => updateAttr(rel.id, { partner_context: pc })}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Column 3 — Attribute panel */}
        <div data-zone="attributes" className="border border-slate-200 rounded-lg bg-white overflow-hidden sticky top-0">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              {isBatch ? "Batch Edit" : "Attributes"}
            </p>
          </div>
          {isBatch ? (
            <BatchPanel
              count={selected.size}
              batchAttrs={batchAttrs}
              onBatchAttrs={(p) => setBatchAttrs((prev) => ({ ...prev, ...p }))}
              onApply={applyBatch}
              onClear={clearSelection} />
          ) : singleRel ? (
            <AttrPanel
              rel={singleRel}
              onUpdateAttr={(attrs) => updateAttr(singleRel.id, attrs)} />
          ) : (
            <p className="text-[11px] text-slate-400 italic p-3">
              Select a relationship to edit attributes.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
