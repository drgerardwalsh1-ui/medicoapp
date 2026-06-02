// Background History — tri-panel entity editor.
// Mirrors HouseholdRelationships interaction philosophy:
//   LEFT   — section navigator + grouped Add actions + Smart Select / Collapse All
//   MIDDLE — grouped entities (multi-select, select-all, drag-drop ordering,
//            status indicators)
//   RIGHT  — focused editor for the single selected entity OR shared-attribute
//            bulk editor when multiple are selected
//
// View state (active section, selected ids, expanded groups, scroll position)
// is persisted in sessionStorage keyed by clientId so navigation away and back
// restores the exact subsection / entity that was open.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { useComposedRefs } from "../../hooks/useComposedRefs";
import type { Client } from "../../types/client";
import {
  defaultPsychiatricHistory,
  type PsychiatricHistory,
  type HistoryEvent,
  type HistoryCategory,
  type HistoryTiming,
  type HistorySourceType,
  type PsychiatricDenials,
  type FamilyHistory,
  type DevelopmentalHistory,
  type EducationHistory,
  type TertiaryStudy,
  type WorkHistoryEntry,
  type MedicalCondition,
  type TreatmentEntry,
  type TreatmentCategory,
  type TreatmentHistory,
  type MedicationClass,
  type FrequencyValue,
  type PerceivedBenefit,
  type UUID,
} from "../../types/history";
import { PartialDateInput } from "../PartialDateInput";
import { FrequencyInput } from "../FrequencyInput";
import {
  MEDICATION_REGISTRY,
  MEDICATION_CLASS_LABELS,
  TREATMENT_MODALITIES,
  SIDE_EFFECT_CHIPS,
  searchMedications,
  classifyMedication,
} from "../../data/medications";
import {
  usePointerReorderEngine,
  sortHistory,
  moveHistory,
  HISTORY_CAPABILITIES,
} from "../../ordering";
import {
  buildSubject,
  generateHistoryNarrative,
  generateTreatmentNarrative,
} from "../../engine/narrativeEngine";

// ── Local helpers ─────────────────────────────────────────────────────────

function uid(): UUID {
  return crypto.randomUUID();
}

const HISTORY_CATEGORIES: HistoryCategory[] = [
  "psychiatric", "psychological", "medical", "family",
  "relationship", "trauma", "work", "other",
];

const SOURCE_TYPES: HistorySourceType[] = [
  "claimant", "records", "gp", "psychiatrist", "psychologist", "hospital", "other",
];

const TREATMENT_CATEGORIES: TreatmentCategory[] = [
  "medication", "psychological", "psychiatric", "gp", "hospital", "group_program", "neuromodulation", "other",
];

const TREATMENT_CATEGORY_LABELS: Record<TreatmentCategory, string> = {
  medication: "Medication",
  psychological: "Psychological therapy",
  psychiatric: "Psychiatric review",
  gp: "GP",
  hospital: "Hospital",
  group_program: "Group program",
  neuromodulation: "Neuromodulation",
  other: "Other",
};

// ── Reusable Chip ─────────────────────────────────────────────────────────

function Chip({
  label,
  active,
  onClick,
  variant = "violet",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  variant?: "violet" | "slate" | "emerald" | "amber" | "red";
}) {
  const activeCls = {
    violet:  "bg-violet-600 text-white border-violet-600",
    slate:   "bg-slate-700 text-white border-slate-700",
    emerald: "bg-emerald-600 text-white border-emerald-600",
    amber:   "bg-amber-500 text-white border-amber-500",
    red:     "bg-red-600 text-white border-red-600",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded border transition ${
        active ? activeCls : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
      }`}
    >
      {label}
    </button>
  );
}

// ── Frequency adapter (Typed FrequencyValue ↔ FrequencyInput strings) ────

function freqValueFromInputs(unit: string, count: string): FrequencyValue | undefined {
  if (!unit && !count) return undefined;
  const unitMap: Record<string, FrequencyValue["unit"]> = {
    Day: "day", Week: "week", Fortnight: "week", Month: "month", Year: "year",
  };
  let timesPerUnit: number | undefined;
  if (count === "Daily") return { unit: "day", timesPerUnit: 1 };
  if (count === "1") timesPerUnit = 1;
  else if (count === "2–3") timesPerUnit = 2;
  else if (count === "4–5") timesPerUnit = 4;
  else if (count) {
    const n = Number(count);
    if (!Number.isNaN(n)) timesPerUnit = n;
  }
  const u: FrequencyValue["unit"] | undefined = unit === "Fortnight" ? "week" : unitMap[unit];
  if (!u) return count ? { unit: "day", timesPerUnit, freeText: count } : undefined;
  if (unit === "Fortnight") return { unit: "week", every: 2, timesPerUnit };
  return { unit: u, timesPerUnit };
}

function freqValueToInputs(f: FrequencyValue | undefined): { unit: string; count: string } {
  if (!f) return { unit: "", count: "" };
  if (f.freeText) return { unit: "", count: f.freeText };
  const unitDisplay: Record<FrequencyValue["unit"], string> = {
    day: "Day", week: "Week", month: "Month", year: "Year",
  };
  let unit = unitDisplay[f.unit];
  if (f.every === 2 && f.unit === "week") unit = "Fortnight";
  let count = "";
  if (f.timesPerUnit === 1) count = "1";
  else if (f.timesPerUnit === 2 || f.timesPerUnit === 3) count = "2–3";
  else if (f.timesPerUnit === 4 || f.timesPerUnit === 5) count = "4–5";
  else if (f.timesPerUnit != null) count = String(f.timesPerUnit);
  return { unit, count };
}

// ── Sections ──────────────────────────────────────────────────────────────

type SectionKey =
  | "treatments"
  | "medical"
  | "preExisting"
  | "subsequent"
  | "work"
  | "education"
  | "family"
  | "developmental"
  | "denials"
  | "narrative";

const SECTION_DEFS: { key: SectionKey; label: string; isEntityList: boolean }[] = [
  { key: "treatments",   label: "Treatments",         isEntityList: true  },
  { key: "medical",      label: "Medical conditions", isEntityList: true  },
  { key: "preExisting",  label: "Pre-existing events",isEntityList: true  },
  { key: "subsequent",   label: "Subsequent events",  isEntityList: true  },
  { key: "work",         label: "Work history",       isEntityList: true  },
  { key: "education",    label: "Education",          isEntityList: true  },
  { key: "family",       label: "Family history",     isEntityList: false },
  { key: "developmental",label: "Developmental",      isEntityList: false },
  { key: "denials",      label: "Denials",            isEntityList: false },
  { key: "narrative",    label: "Narrative preview",  isEntityList: false },
];

// Entity-list sections, in document order. The middle panel renders these
// as one continuous scrollable clinical document.
const ENTITY_SECTIONS: SectionKey[] = [
  "treatments", "medical", "preExisting", "subsequent", "work", "education",
];

// Expanded-group keys are namespaced by section so identically-named groups
// in different sections (e.g. treatment "psychiatric" vs event "psychiatric")
// never collide now that every section is mounted simultaneously.
function nsGroup(section: SectionKey, raw: string): string {
  return `${section}:${raw}`;
}

// ── Persistent UI view state ──────────────────────────────────────────────
// Kept in sessionStorage keyed by clientId so navigation away and back
// (Demographics → Background History) restores exact open subsection /
// entities / scroll position / focused editor. UI state ONLY — never
// persisted with medico-legal report data.

type BackgroundHistoryViewState = {
  activeSection?: SectionKey;
  selectedEntityIds?: string[];
  expandedGroups?: string[];
  scrollTop?: number;
};

function viewStateKey(clientId: string): string {
  return `medicoapp:bgHistoryView:${clientId}`;
}

function loadViewState(clientId: string): BackgroundHistoryViewState {
  try {
    const raw = sessionStorage.getItem(viewStateKey(clientId));
    return raw ? (JSON.parse(raw) as BackgroundHistoryViewState) : {};
  } catch {
    return {};
  }
}

function saveViewState(clientId: string, state: BackgroundHistoryViewState): void {
  try {
    sessionStorage.setItem(viewStateKey(clientId), JSON.stringify(state));
  } catch {
    // sessionStorage may be unavailable (private mode, quota) — fine to drop.
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────

export type HistoryEditorProps = {
  client: Client;
  onClientChange: (next: Client) => void;
};

export default function HistoryEditor({ client, onClientChange }: HistoryEditorProps) {
  const history: PsychiatricHistory = client.psychiatricHistory ?? defaultPsychiatricHistory();

  // ── In-memory scroll restoration for all three panels. The middle
  // panel already owns a ref (`middleScrollRef`) wired to a scroll-spy
  // for section anchors — the hook layers on top by save+restore-only,
  // it does not consume the scroll event itself, so the spy still fires.
  const historyScrollBase = `client:${client.id}:backgroundHistory`;
  const leftPanelScrollRef = useScrollRestoration<HTMLDivElement>(
    `${historyScrollBase}:left-panel`,
  );
  const rightPanelScrollRef = useScrollRestoration<HTMLDivElement>(
    `${historyScrollBase}:right-panel`,
  );

  // ── Persistent view state ───────────────────────────────────────────────
  const restored = useMemo(() => loadViewState(client.id), [client.id]);
  // activeSection drives ONLY the left-nav highlight + scroll target — it
  // never gates rendering. The middle panel always shows every section.
  const [activeSection, setActiveSection] = useState<SectionKey>(
    restored.activeSection ?? "treatments"
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(restored.selectedEntityIds ?? [])
  );
  // All groups across all sections default to expanded — non-active
  // sections are never auto-collapsed.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(restored.expandedGroups ?? allExpandableGroupKeys())
  );
  // Middle panel: the existing `middleScrollRef` drives a scroll-spy that
  // highlights the active section in the left nav. Compose it with the
  // central scroll-restoration callback ref so both consumers see the
  // same node.
  const middleScrollRef = useRef<HTMLDivElement | null>(null);
  const middleScrollRestoreRef = useScrollRestoration<HTMLDivElement>(
    `${historyScrollBase}:middle-panel`,
  );
  const composedMiddleScrollRef = useComposedRefs<HTMLDivElement>(
    middleScrollRef,
    middleScrollRestoreRef,
  );
  // One ref per section block so the navigator can scrollIntoView.
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLDivElement | null>>>({});
  // One ref per treatment-category group so left-panel subtype rows can
  // scroll directly to their subsection within the Treatments section.
  const treatmentGroupRefs = useRef<Partial<Record<TreatmentCategory, HTMLDivElement | null>>>({});

  // ── Persistence — UI state only, never report data ──────────────────────
  const persist = useCallback(() => {
    saveViewState(client.id, {
      activeSection,
      selectedEntityIds: [...selectedIds],
      expandedGroups: [...expandedGroups],
      scrollTop: middleScrollRef.current?.scrollTop ?? 0,
    });
  }, [client.id, activeSection, selectedIds, expandedGroups]);

  useEffect(() => { persist(); }, [persist]);

  // Restore scroll position once, after the document has rendered.
  useEffect(() => {
    const top = restored.scrollTop ?? 0;
    if (top > 0) {
      requestAnimationFrame(() => {
        if (middleScrollRef.current) middleScrollRef.current.scrollTop = top;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  // ── Scroll spy + scroll-position persistence ────────────────────────────
  // Lightweight: on scroll, highlight whichever section header is nearest
  // the top of the viewport, and persist scrollTop (throttled via rAF).
  const scrollRafRef = useRef<number | null>(null);
  function handleMiddleScroll() {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = middleScrollRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      let nearest: SectionKey | null = null;
      let nearestDist = Infinity;
      for (const def of SECTION_DEFS) {
        const el = sectionRefs.current[def.key];
        if (!el) continue;
        const dist = el.getBoundingClientRect().top - containerTop;
        // Prefer the last section whose header has passed (or is near) the top.
        if (dist <= 24 && Math.abs(dist) < nearestDist) {
          nearestDist = Math.abs(dist);
          nearest = def.key;
        }
      }
      if (nearest && nearest !== activeSection) setActiveSection(nearest);
      persist();
    });
  }

  function scrollToSection(key: SectionKey) {
    setActiveSection(key);
    const el = sectionRefs.current[key];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Navigate to one treatment-category subsection. Ensures the group is
  // expanded, then scrolls its wrapper into view; falls back to the
  // Treatments section header when the category currently has no entries.
  function scrollToTreatmentCategory(category: TreatmentCategory) {
    setActiveSection("treatments");
    setExpandedGroups((prev) => new Set([...prev, nsGroup("treatments", category)]));
    requestAnimationFrame(() => {
      const el = treatmentGroupRefs.current[category];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else sectionRefs.current.treatments?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ── Commit helpers ──────────────────────────────────────────────────────
  function commit(next: PsychiatricHistory) {
    onClientChange({ ...client, psychiatricHistory: next });
  }
  function commitTreatments(treatments: TreatmentEntry[]) {
    commit({ ...history, treatmentHistory: { ...history.treatmentHistory, treatments } });
  }
  function commitMedical(conditions: MedicalCondition[]) {
    commit({ ...history, generalMedicalHistory: conditions });
  }
  function commitEvents(timing: "pre_existing" | "subsequent", events: HistoryEvent[]) {
    commit(timing === "pre_existing"
      ? { ...history, preExistingEvents: events }
      : { ...history, subsequentEvents: events });
  }
  function commitWork(entries: WorkHistoryEntry[]) {
    commit({ ...history, workHistory: entries });
  }

  // ── Selection helpers ───────────────────────────────────────────────────
  // Selection persists across scroll/navigation — it is NOT reset when the
  // active section changes (continuous-document model).
  function clearSelection() { setSelectedIds(new Set()); }
  function toggleSelect(id: string, exclusive = false) {
    if (exclusive) { setSelectedIds(new Set([id])); return; }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectIds(ids: string[]) {
    setSelectedIds(new Set(ids));
  }

  // ── Add actions (left panel, ADD zone) — create + select + scroll ───────
  function afterAdd(section: SectionKey, freshId: string) {
    setSelectedIds(new Set([freshId]));
    // Defer scroll until the new entity is in the DOM.
    requestAnimationFrame(() => scrollToSection(section));
  }
  function addTreatment(category: TreatmentCategory) {
    const fresh: TreatmentEntry = { id: uid(), category, name: "", current: true };
    commitTreatments([...(history.treatmentHistory.treatments ?? []), fresh]);
    afterAdd("treatments", fresh.id);
  }
  function addMedical() {
    const fresh: MedicalCondition = { id: uid(), condition: "", active: true };
    commitMedical([...(history.generalMedicalHistory ?? []), fresh]);
    afterAdd("medical", fresh.id);
  }
  function addEvent(timing: "pre_existing" | "subsequent") {
    const fresh: HistoryEvent = {
      id: uid(),
      category: "psychiatric",
      timing,
      sourceType: "claimant",
    };
    const list = timing === "pre_existing" ? history.preExistingEvents : history.subsequentEvents;
    commitEvents(timing, [...(list ?? []), fresh]);
    afterAdd(timing === "pre_existing" ? "preExisting" : "subsequent", fresh.id);
  }
  function addWork() {
    const fresh: WorkHistoryEntry = { id: uid() };
    commitWork([...(history.workHistory ?? []), fresh]);
    afterAdd("work", fresh.id);
  }
  function addTertiary() {
    const fresh: TertiaryStudy = { id: uid() };
    commit({
      ...history,
      educationHistory: {
        ...history.educationHistory,
        tertiaryStudies: [...(history.educationHistory.tertiaryStudies ?? []), fresh],
      },
    });
    afterAdd("education", fresh.id);
  }

  // ── Smart Select / Collapse / Expand — operate on the active section ────
  function smartSelect() {
    setSelectedIds(new Set(entityIdsForSection(history, activeSection)));
  }
  function collapseAll() {
    const keys = new Set(groupKeysForSection(activeSection));
    setExpandedGroups((prev) => new Set([...prev].filter((k) => !keys.has(k))));
  }
  function expandAll() {
    const keys = groupKeysForSection(activeSection);
    setExpandedGroups((prev) => new Set([...prev, ...keys]));
  }
  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // The section the current selection belongs to — drives the right panel
  // regardless of which section is scrolled into view.
  const selectionSection = useMemo<SectionKey | null>(() => {
    const first = selectedIds.size ? [...selectedIds][0] : null;
    return first ? sectionOfEntity(history, first) : null;
  }, [selectedIds, history]);

  const activeIsEntityList = SECTION_DEFS.find((s) => s.key === activeSection)?.isEntityList;

  return (
    <div className="flex h-full overflow-hidden bg-slate-100">
      {/* ── LEFT panel — sticky navigator, independently scrollable ────── */}
      <aside className="w-56 bg-white border-r flex flex-col shrink-0">
        <div className="px-3 py-2 border-b shrink-0">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
            Background History
          </p>
        </div>

        {/* Single combined list — each row does BOTH:
              "+"   → creates an entity (creation)
              label → scrolls that section into view (navigation)
            Creation and navigation stay conceptually separate but share
            one row, removing the old duplicated Add / Sections lists. */}
        <div ref={leftPanelScrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {/* Treatments — parent navigates; subtype rows below create. */}
          <LeftRow
            label="Treatments"
            count={history.treatmentHistory.treatments?.length ?? 0}
            isActive={activeSection === "treatments"}
            onNavigate={() => scrollToSection("treatments")}
          />
          {TREATMENT_CATEGORIES.map((c) => (
            <LeftRow
              key={c}
              indent
              label={TREATMENT_CATEGORY_LABELS[c]}
              count={(history.treatmentHistory.treatments ?? []).filter((t) => t.category === c).length}
              onAdd={() => addTreatment(c)}
              onNavigate={() => scrollToTreatmentCategory(c)}
            />
          ))}

          <LeftRow
            label="Medical conditions"
            count={history.generalMedicalHistory?.length ?? 0}
            isActive={activeSection === "medical"}
            onAdd={addMedical}
            onNavigate={() => scrollToSection("medical")}
          />
          <LeftRow
            label="Pre-existing events"
            count={history.preExistingEvents?.length ?? 0}
            isActive={activeSection === "preExisting"}
            onAdd={() => addEvent("pre_existing")}
            onNavigate={() => scrollToSection("preExisting")}
          />
          <LeftRow
            label="Subsequent events"
            count={history.subsequentEvents?.length ?? 0}
            isActive={activeSection === "subsequent"}
            onAdd={() => addEvent("subsequent")}
            onNavigate={() => scrollToSection("subsequent")}
          />
          <LeftRow
            label="Work history"
            count={history.workHistory?.length ?? 0}
            isActive={activeSection === "work"}
            onAdd={addWork}
            onNavigate={() => scrollToSection("work")}
          />
          <LeftRow
            label="Education"
            count={history.educationHistory.tertiaryStudies?.length ?? 0}
            isActive={activeSection === "education"}
            onAdd={addTertiary}
            onNavigate={() => scrollToSection("education")}
          />
          {/* Singletons — navigation only (nothing to create). */}
          <LeftRow
            label="Family history"
            isActive={activeSection === "family"}
            onNavigate={() => scrollToSection("family")}
          />
          <LeftRow
            label="Developmental history"
            isActive={activeSection === "developmental"}
            onNavigate={() => scrollToSection("developmental")}
          />
          <LeftRow
            label="Denials"
            isActive={activeSection === "denials"}
            onNavigate={() => scrollToSection("denials")}
          />
          <LeftRow
            label="Narrative preview"
            isActive={activeSection === "narrative"}
            onNavigate={() => scrollToSection("narrative")}
          />
        </div>

        {/* Smart Select / Collapse / Expand — act on the active section */}
        {activeIsEntityList && (
          <div className="p-2 border-t space-y-1 shrink-0">
            <button
              className="w-full text-[11px] px-2 py-1 rounded bg-slate-700 text-white hover:bg-slate-600"
              onClick={smartSelect}
            >
              Smart Select
            </button>
            <button
              className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
              onClick={clearSelection}
            >
              Clear Selection
            </button>
            <div className="flex gap-1">
              <button
                className="flex-1 text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={collapseAll}
              >
                Collapse All
              </button>
              <button
                className="flex-1 text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={expandAll}
              >
                Expand All
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* ── MIDDLE panel — single continuous scrollable clinical document ─ */}
      <section
        ref={composedMiddleScrollRef}
        onScroll={handleMiddleScroll}
        className="flex-1 overflow-y-auto p-4 min-w-0"
      >
        <MiddlePanel
          history={history}
          selectedIds={selectedIds}
          expandedGroups={expandedGroups}
          onToggleGroup={toggleGroup}
          onToggleSelect={toggleSelect}
          onSelectIds={selectIds}
          onCommitTreatments={commitTreatments}
          onCommitMedical={commitMedical}
          onCommitEvents={commitEvents}
          onCommitWork={commitWork}
          onCommitHistory={commit}
          client={client}
          registerSectionRef={(key, el) => { sectionRefs.current[key] = el; }}
          registerTreatmentGroupRef={(category, el) => { treatmentGroupRefs.current[category] = el; }}
        />
      </section>

      {/* ── RIGHT panel — stable while the middle document scrolls ──────── */}
      <aside className="w-96 bg-white border-l flex flex-col shrink-0 overflow-hidden">
        <div className="px-4 py-3 border-b shrink-0">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {selectedIds.size > 1 ? `Bulk edit (${selectedIds.size})` : "Detail editor"}
          </h3>
        </div>
        <div ref={rightPanelScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          <RightPanel
            history={history}
            activeSection={selectionSection ?? activeSection}
            selectedIds={selectedIds}
            onCommitTreatments={commitTreatments}
            onCommitMedical={commitMedical}
            onCommitEvents={commitEvents}
            onCommitWork={commitWork}
            onCommitHistory={commit}
          />
        </div>
      </aside>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Section counts / group utilities
// ────────────────────────────────────────────────────────────────────────

function entityIdsForSection(h: PsychiatricHistory, key: SectionKey): string[] {
  switch (key) {
    case "treatments":  return (h.treatmentHistory.treatments ?? []).map((t) => t.id);
    case "medical":     return (h.generalMedicalHistory ?? []).map((c) => c.id);
    case "preExisting": return (h.preExistingEvents ?? []).map((e) => e.id);
    case "subsequent":  return (h.subsequentEvents ?? []).map((e) => e.id);
    case "work":        return (h.workHistory ?? []).map((e) => e.id);
    case "education":   return (h.educationHistory.tertiaryStudies ?? []).map((e) => e.id);
    default:            return [];
  }
}

// Section a given entity id belongs to — drives the right panel without
// depending on which section is currently scrolled into view.
function sectionOfEntity(h: PsychiatricHistory, id: string): SectionKey | null {
  if ((h.treatmentHistory.treatments ?? []).some((t) => t.id === id)) return "treatments";
  if ((h.generalMedicalHistory ?? []).some((c) => c.id === id)) return "medical";
  if ((h.preExistingEvents ?? []).some((e) => e.id === id)) return "preExisting";
  if ((h.subsequentEvents ?? []).some((e) => e.id === id)) return "subsequent";
  if ((h.workHistory ?? []).some((e) => e.id === id)) return "work";
  if ((h.educationHistory.tertiaryStudies ?? []).some((t) => t.id === id)) return "education";
  return null;
}

// Namespaced expandable-group keys for one section (used by Collapse/Expand
// All on the active section).
function groupKeysForSection(section: SectionKey): string[] {
  if (section === "treatments") return TREATMENT_CATEGORIES.map((c) => nsGroup(section, c));
  if (section === "preExisting" || section === "subsequent") {
    return HISTORY_CATEGORIES.map((c) => nsGroup(section, c));
  }
  if (section === "medical") return ["active", "inactive"].map((g) => nsGroup(section, g));
  if (section === "work") return ["current", "past"].map((g) => nsGroup(section, g));
  if (section === "education") return [nsGroup(section, "tertiary")];
  return [];
}

// Every expandable group across every section — the default expanded set,
// so non-active sections are never auto-collapsed.
function allExpandableGroupKeys(): string[] {
  return ENTITY_SECTIONS.flatMap(groupKeysForSection);
}

// ────────────────────────────────────────────────────────────────────────
// LeftRow — combined creation + navigation row.
//
//   [ + ]  Label (count)
//     ▲       ▲
//     │       └─ clicking the label NAVIGATES (scrolls the section in)
//     └───────── clicking the "+" CREATES a new entity
//
// Only the "+" creates; the text label never creates. Rows without an
// onAdd (singletons) render a spacer in place of the "+" so labels stay
// aligned and it is visually obvious they cannot create.
// ────────────────────────────────────────────────────────────────────────

function LeftRow({
  label,
  count,
  indent = false,
  isActive = false,
  onAdd,
  onNavigate,
}: {
  label: string;
  count?: number;
  indent?: boolean;
  isActive?: boolean;
  onAdd?: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${indent ? "ml-4" : ""}`}>
      {onAdd ? (
        <button
          type="button"
          aria-label={`Add ${label}`}
          title={`Add ${label}`}
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-violet-600 text-white text-xs leading-none hover:bg-violet-500"
        >
          +
        </button>
      ) : (
        <span className="shrink-0 w-5 h-5" aria-hidden />
      )}
      <button
        type="button"
        onClick={onNavigate}
        className={`flex-1 min-w-0 text-left px-2 py-1 rounded text-[11px] flex items-center justify-between transition ${
          isActive ? "bg-violet-100 text-violet-700 font-medium" : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        <span className="truncate">{label}</span>
        {count != null && (
          <span className="ml-1.5 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

// ── Section block — one heading + body, with a scroll-target ref ─────────

// Section header. For entity sections a `selection` descriptor enables the
// per-section Select all / Clear toolbar; singleton sections omit it.
type SectionSelection = {
  ids: string[];
  selectedIds: Set<string>;
  onSelectIds: (ids: string[]) => void;
};

function SectionBlock({
  sectionKey,
  title,
  registerSectionRef,
  selection,
  children,
}: {
  sectionKey: SectionKey;
  title: string;
  registerSectionRef: (key: SectionKey, el: HTMLDivElement | null) => void;
  selection?: SectionSelection;
  children: React.ReactNode;
}) {
  const total = selection?.ids.length ?? 0;
  const selectedInSection = selection
    ? selection.ids.filter((id) => selection.selectedIds.has(id)).length
    : 0;
  const allSelected = total > 0 && selectedInSection === total;
  return (
    <div
      ref={(el) => registerSectionRef(sectionKey, el)}
      className="scroll-mt-2"
    >
      <div className="border-b border-slate-300 pb-1 mb-2 flex items-center gap-2">
        <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
          {title}
          {selection && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
              {total}
            </span>
          )}
        </h2>
        {selection && total > 0 && (
          <div className="ml-auto flex items-center gap-2 text-[11px]">
            {selectedInSection > 0 && (
              <span className="text-slate-400">{selectedInSection} selected</span>
            )}
            <button
              type="button"
              className="text-violet-600 hover:text-violet-800 font-medium"
              onClick={() => selection.onSelectIds(allSelected ? [] : selection.ids)}
            >
              {allSelected ? "Clear" : "Select all"}
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// MIDDLE panel — grouped entity lists / singleton forms
// ────────────────────────────────────────────────────────────────────────

type MiddleProps = {
  client: Client;
  history: PsychiatricHistory;
  selectedIds: Set<string>;
  expandedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onToggleSelect: (id: string, exclusive?: boolean) => void;
  onSelectIds: (ids: string[]) => void;
  onCommitTreatments: (t: TreatmentEntry[]) => void;
  onCommitMedical: (m: MedicalCondition[]) => void;
  onCommitEvents: (timing: "pre_existing" | "subsequent", e: HistoryEvent[]) => void;
  onCommitWork: (w: WorkHistoryEntry[]) => void;
  onCommitHistory: (h: PsychiatricHistory) => void;
  registerSectionRef: (key: SectionKey, el: HTMLDivElement | null) => void;
  registerTreatmentGroupRef: (category: TreatmentCategory, el: HTMLDivElement | null) => void;
};

// The middle panel is ONE continuous scrollable document — every section
// is mounted in sequence. Non-active sections are never collapsed.
function MiddlePanel(props: MiddleProps) {
  const { history, client, registerSectionRef, selectedIds, onSelectIds } = props;
  const sel = (key: SectionKey): SectionSelection => ({
    ids: entityIdsForSection(history, key),
    selectedIds,
    onSelectIds,
  });
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <SectionBlock
        sectionKey="treatments"
        title="Treatments"
        registerSectionRef={registerSectionRef}
        selection={sel("treatments")}
      >
        <TreatmentsMiddle {...props} />
      </SectionBlock>

      <SectionBlock
        sectionKey="medical"
        title="Medical conditions"
        registerSectionRef={registerSectionRef}
        selection={sel("medical")}
      >
        <MedicalMiddle {...props} />
      </SectionBlock>

      <SectionBlock
        sectionKey="preExisting"
        title="Pre-existing events"
        registerSectionRef={registerSectionRef}
        selection={sel("preExisting")}
      >
        <EventsMiddle {...props} timing="pre_existing" />
      </SectionBlock>

      <SectionBlock
        sectionKey="subsequent"
        title="Subsequent events"
        registerSectionRef={registerSectionRef}
        selection={sel("subsequent")}
      >
        <EventsMiddle {...props} timing="subsequent" />
      </SectionBlock>

      <SectionBlock
        sectionKey="work"
        title="Work history"
        registerSectionRef={registerSectionRef}
        selection={sel("work")}
      >
        <WorkMiddle {...props} />
      </SectionBlock>

      <SectionBlock
        sectionKey="education"
        title="Education"
        registerSectionRef={registerSectionRef}
        selection={sel("education")}
      >
        <EducationMiddle {...props} />
      </SectionBlock>

      <SectionBlock sectionKey="family" title="Family history" registerSectionRef={registerSectionRef}>
        <FamilyForm
          value={history.familyHistory}
          onChange={(f) => props.onCommitHistory({ ...history, familyHistory: f })}
        />
      </SectionBlock>

      <SectionBlock sectionKey="developmental" title="Developmental history" registerSectionRef={registerSectionRef}>
        <DevelopmentalForm
          value={history.developmentalHistory}
          onChange={(d) => props.onCommitHistory({ ...history, developmentalHistory: d })}
        />
      </SectionBlock>

      <SectionBlock sectionKey="denials" title="Denials" registerSectionRef={registerSectionRef}>
        <DenialsForm
          denials={history.psychiatricDenials}
          onChange={(d) => props.onCommitHistory({ ...history, psychiatricDenials: d })}
        />
      </SectionBlock>

      <SectionBlock sectionKey="narrative" title="Narrative preview" registerSectionRef={registerSectionRef}>
        <NarrativePreview client={client} history={history} />
      </SectionBlock>
    </div>
  );
}

// ── Group container with collapse — drag mechanics live in the engine ────
//
// The engine (usePointerReorderEngine) is created once per Middle panel
// and shared across every group on that panel. EntityGroup is purely a
// presentation wrapper: it renders the section header and forwards a
// per-row reorderProps factory into EntityRow.

type GroupReorderProps = {
  // Declarative — drives whether EntityRow renders a drag handle at all.
  reorderable: boolean;
  rowProps: (id: string, group: string) => Record<string, string>;
  handleProps: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    isDragging: boolean;
    isDragOver: boolean;
    [k: string]: unknown;
  };
};

function EntityGroup({
  groupKey,
  groupLabel,
  items,
  expanded,
  onToggle,
  reorder,
  renderRow,
}: {
  groupKey: string;
  groupLabel: string;
  items: { id: string }[];
  expanded: boolean;
  onToggle: () => void;
  reorder: GroupReorderProps;
  renderRow: (id: string, ctx: { groupKey: string; reorder: GroupReorderProps }) => React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-[10px] font-semibold text-slate-500 uppercase tracking-wide px-1 py-1 hover:text-slate-700"
      >
        <span>{expanded ? "▾" : "▸"} {groupLabel}</span>
        <span className="text-slate-400">{items.length}</span>
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1">
          {items.map((item) => (
            <div key={item.id}>
              {renderRow(item.id, { groupKey, reorder })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Entity row (chip-like card with checkbox + status dot) ───────────────
// Uses the shared ordering engine: row carries data-reorder-id /
// data-reorder-group; the ⋮⋮ handle carries data-reorder-handle and
// onPointerDown is owned by the engine.

function EntityRow({
  id,
  groupKey,
  reorder,
  title,
  subtitle,
  status,
  selected,
  onClick,
  onDelete,
}: {
  id: string;
  groupKey: string;
  reorder: GroupReorderProps;
  title: string;
  subtitle?: string;
  status?: { color: "emerald" | "amber" | "slate" | "red" | "violet"; label: string };
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  const dotCls = {
    emerald: "bg-emerald-500",
    amber:   "bg-amber-500",
    slate:   "bg-slate-400",
    red:     "bg-red-500",
    violet:  "bg-violet-500",
  }[status?.color ?? "slate"];
  const handle = reorder.handleProps(id);
  return (
    <div
      {...reorder.rowProps(id, groupKey)}
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded border bg-white cursor-pointer transition ${
        selected ? "border-violet-400 ring-1 ring-violet-200" : "border-slate-200 hover:border-violet-300"
      } ${handle.isDragging ? "opacity-50" : ""} ${handle.isDragOver ? "ring-2 ring-violet-300" : ""}`}
    >
      {/* Drag handle rendered only when the strategy declares the list
          reorderable — capability-driven, not behaviour-inferred. */}
      {reorder.reorderable && (
        <span
          {...handle}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
          className="text-slate-300 cursor-grab select-none px-1"
        >⋮⋮</span>
      )}
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => { e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); onClick(e); }}
      />
      <span className={`inline-block w-2 h-2 rounded-full ${dotCls}`} title={status?.label} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800 truncate">{title || <span className="italic text-slate-400">(untitled)</span>}</div>
        {subtitle && <div className="text-[10px] text-slate-500 truncate">{subtitle}</div>}
      </div>
      {/* Inline delete — never triggers row selection (stops propagation). */}
      <button
        type="button"
        aria-label="Delete entity"
        title="Delete"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-red-600 hover:bg-red-50 text-sm leading-none"
      >
        ×
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Treatments middle
// ────────────────────────────────────────────────────────────────────────

function TreatmentsMiddle({
  history,
  selectedIds,
  expandedGroups,
  onToggleGroup,
  onToggleSelect,
  onCommitTreatments,
  registerTreatmentGroupRef,
}: MiddleProps) {
  const treatments = history.treatmentHistory.treatments ?? [];
  const groups = useMemo(() => {
    const m = new Map<TreatmentCategory, TreatmentEntry[]>();
    for (const c of TREATMENT_CATEGORIES) m.set(c, []);
    for (const t of treatments) m.get(t.category)?.push(t);
    return m;
  }, [treatments]);

  // Engine enforces same-group (category) via data-reorder-group; treatments
  // have no date-bucket constraint beyond that, so a plain splice on the
  // underlying array is the correct move. Order is implicit (array index).
  const engine = usePointerReorderEngine<string>({
    reorderable: HISTORY_CAPABILITIES.reorderable,
    onMove: ({ fromId, toId }) => {
      const next = [...treatments];
      const from = next.findIndex((t) => t.id === fromId);
      const to = next.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) return;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onCommitTreatments(next);
    },
  });
  const reorder: GroupReorderProps = {
    reorderable: HISTORY_CAPABILITIES.reorderable,
    rowProps: (id, group) => engine.getRowProps(id, group),
    handleProps: (id) => engine.getHandleProps(id),
  };

  function removeTreatment(id: string) {
    if (selectedIds.has(id)) onToggleSelect(id);
    onCommitTreatments(treatments.filter((t) => t.id !== id));
  }

  return (
    <div className="space-y-3">
      {TREATMENT_CATEGORIES.map((c) => {
        const items = groups.get(c) ?? [];
        if (items.length === 0) return null;
        return (
          // Wrapper carries a ref so the left-panel subtype rows can
          // scroll directly to this category group.
          <div key={c} ref={(el) => registerTreatmentGroupRef(c, el)} className="scroll-mt-2">
            <EntityGroup
              groupKey={c}
              groupLabel={TREATMENT_CATEGORY_LABELS[c].toUpperCase()}
              items={items}
              expanded={expandedGroups.has(nsGroup("treatments", c))}
              onToggle={() => onToggleGroup(nsGroup("treatments", c))}
              reorder={reorder}
              renderRow={(id, ctx) => {
                const t = items.find((x) => x.id === id)!;
                const subtitle = treatmentSubtitle(t);
                return (
                  <EntityRow
                    id={t.id}
                    groupKey={ctx.groupKey}
                    reorder={ctx.reorder}
                    title={t.name || (t.category === "medication" ? "(medication)" : TREATMENT_CATEGORY_LABELS[t.category])}
                    subtitle={subtitle}
                    status={
                      t.current
                        ? { color: "emerald", label: "Current" }
                        : { color: "slate", label: "Ceased" }
                    }
                    selected={selectedIds.has(t.id)}
                    onClick={(ev) => onToggleSelect(t.id, !ev.shiftKey && !ev.metaKey && !ev.ctrlKey)}
                    onDelete={() => removeTreatment(t.id)}
                  />
                );
              }}
            />
          </div>
        );
      })}
      {treatments.length === 0 && (
        <div className="card text-sm text-slate-500">
          No treatments. Use a “+” on the left to create one.
        </div>
      )}
    </div>
  );
}

function treatmentSubtitle(t: TreatmentEntry): string {
  const parts: string[] = [];
  if (t.category === "medication") {
    if (t.drugClass) parts.push(MEDICATION_CLASS_LABELS[t.drugClass]);
    if (t.dose?.value != null) parts.push(`${t.dose.value}${t.dose.unit ?? "mg"}`);
  } else {
    if (t.subtype) parts.push(t.subtype);
  }
  if (t.commenced?.year) parts.push(`since ${t.commenced.year}`);
  if (t.perceivedBenefit) parts.push(`${t.perceivedBenefit} benefit`);
  return parts.join(" · ");
}

// ────────────────────────────────────────────────────────────────────────
// Medical middle
// ────────────────────────────────────────────────────────────────────────

function MedicalMiddle({
  history,
  selectedIds,
  expandedGroups,
  onToggleGroup,
  onToggleSelect,
  onCommitMedical,
}: MiddleProps) {
  const conditions = history.generalMedicalHistory ?? [];
  const active = conditions.filter((c) => c.active);
  const inactive = conditions.filter((c) => !c.active);

  const engine = usePointerReorderEngine<string>({
    reorderable: HISTORY_CAPABILITIES.reorderable,
    onMove: ({ fromId, toId }) => {
      const next = [...conditions];
      const from = next.findIndex((c) => c.id === fromId);
      const to = next.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0) return;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onCommitMedical(next);
    },
  });
  const reorder: GroupReorderProps = {
    reorderable: HISTORY_CAPABILITIES.reorderable,
    rowProps: (id, group) => engine.getRowProps(id, group),
    handleProps: (id) => engine.getHandleProps(id),
  };

  function removeCondition(id: string) {
    if (selectedIds.has(id)) onToggleSelect(id);
    onCommitMedical(conditions.filter((c) => c.id !== id));
  }

  const groups: { key: string; label: string; items: MedicalCondition[] }[] = [
    { key: "active",   label: "ACTIVE",   items: active },
    { key: "inactive", label: "INACTIVE", items: inactive },
  ];

  return (
    <div className="space-y-3">
      {groups.map((g) => g.items.length > 0 && (
        <EntityGroup
          key={g.key}
          groupKey={g.key}
          groupLabel={g.label}
          items={g.items}
          expanded={expandedGroups.has(nsGroup("medical", g.key))}
          onToggle={() => onToggleGroup(nsGroup("medical", g.key))}
          reorder={reorder}
          renderRow={(id, ctx) => {
            const c = g.items.find((x) => x.id === id)!;
            return (
              <EntityRow
                id={c.id}
                groupKey={ctx.groupKey}
                reorder={ctx.reorder}
                title={c.condition || "(condition)"}
                subtitle={c.severity}
                status={c.severity === "severe"
                  ? { color: "red", label: "Severe" }
                  : c.severity === "moderate"
                    ? { color: "amber", label: "Moderate" }
                    : { color: "slate", label: c.severity ?? "" }}
                selected={selectedIds.has(c.id)}
                onClick={(ev) => onToggleSelect(c.id, !ev.shiftKey && !ev.metaKey && !ev.ctrlKey)}
                onDelete={() => removeCondition(c.id)}
              />
            );
          }}
        />
      ))}
      {conditions.length === 0 && (
        <div className="card text-sm text-slate-500">No medical conditions recorded.</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Events middle (pre-existing OR subsequent)
// ────────────────────────────────────────────────────────────────────────

function EventsMiddle({
  history,
  timing,
  selectedIds,
  expandedGroups,
  onToggleGroup,
  onToggleSelect,
  onCommitEvents,
}: MiddleProps & { timing: "pre_existing" | "subsequent" }) {
  const sectionKey: SectionKey = timing === "pre_existing" ? "preExisting" : "subsequent";
  const all = useMemo(
    () => (timing === "pre_existing" ? history.preExistingEvents : history.subsequentEvents) ?? [],
    [timing, history.preExistingEvents, history.subsequentEvents]
  );

  // Chronology is the backbone — historyStrategy.sort() is the SINGLE
  // place ordering is applied. There is no post-drag re-sort override:
  // a drag mutates the underlying array via moveHistory (within the same
  // date bucket only), and sortHistory re-applies chronology on render.
  const sorted = useMemo(
    () => sortHistory(all, (e) => e.date),
    [all]
  );

  const groups = useMemo(() => {
    const m = new Map<HistoryCategory, HistoryEvent[]>();
    for (const c of HISTORY_CATEGORIES) m.set(c, []);
    for (const e of sorted) m.get(e.category)?.push(e);
    return m;
  }, [sorted]);

  // Engine enforces same-category drops (data-reorder-group=category);
  // historyStrategy.move additionally rejects cross-date-bucket drags.
  const engine = usePointerReorderEngine<string>({
    reorderable: HISTORY_CAPABILITIES.reorderable,
    onMove: ({ fromId, toId }) => {
      const next = moveHistory(all, fromId, toId, (e) => e.date);
      if (next !== all) onCommitEvents(timing, next);
    },
  });
  const reorder: GroupReorderProps = {
    reorderable: HISTORY_CAPABILITIES.reorderable,
    rowProps: (id, group) => engine.getRowProps(id, group),
    handleProps: (id) => engine.getHandleProps(id),
  };

  function removeEvent(id: string) {
    if (selectedIds.has(id)) onToggleSelect(id);
    onCommitEvents(timing, all.filter((e) => e.id !== id));
  }

  return (
    <div className="space-y-3">
      {HISTORY_CATEGORIES.map((c) => {
        const items = groups.get(c) ?? [];
        if (items.length === 0) return null;
        return (
          <EntityGroup
            key={c}
            groupKey={c}
            groupLabel={c.toUpperCase()}
            items={items}
            expanded={expandedGroups.has(nsGroup(sectionKey, c))}
            onToggle={() => onToggleGroup(nsGroup(sectionKey, c))}
            reorder={reorder}
            renderRow={(id, ctx) => {
              const e = items.find((x) => x.id === id)!;
              return (
                <EntityRow
                  id={e.id}
                  groupKey={ctx.groupKey}
                  reorder={ctx.reorder}
                  title={e.title || "(event)"}
                  subtitle={`${e.sourceType}${e.date?.year ? ` · ${e.date.year}` : ""}`}
                  status={significanceStatus(e.significance)}
                  selected={selectedIds.has(e.id)}
                  onClick={(ev) => onToggleSelect(e.id, !ev.shiftKey && !ev.metaKey && !ev.ctrlKey)}
                  onDelete={() => removeEvent(e.id)}
                />
              );
            }}
          />
        );
      })}
      {(!all || all.length === 0) && (
        <div className="card text-sm text-slate-500">
          No {timing === "pre_existing" ? "pre-existing" : "subsequent"} events recorded.
        </div>
      )}
    </div>
  );
}

function significanceStatus(s: HistoryEvent["significance"]): { color: "emerald" | "amber" | "slate" | "red" | "violet"; label: string } {
  if (s === "significant") return { color: "red",    label: "Significant" };
  if (s === "moderate")    return { color: "amber",  label: "Moderate" };
  if (s === "minor")       return { color: "slate",  label: "Minor" };
  return { color: "slate", label: "" };
}

// ────────────────────────────────────────────────────────────────────────
// Work history middle
// ────────────────────────────────────────────────────────────────────────

function WorkMiddle({
  history,
  selectedIds,
  expandedGroups,
  onToggleGroup,
  onToggleSelect,
  onCommitWork,
}: MiddleProps) {
  const entries = history.workHistory ?? [];
  // Work history is presented chronologically by start date within each
  // current/past group. historyStrategy provides the stable date sort;
  // moveHistory keeps within-bucket reordering for tied dates.
  const sorted = useMemo(
    () => sortHistory(entries, (e) => e.startDate),
    [entries]
  );
  const current = sorted.filter((e) => e.current);
  const past = sorted.filter((e) => !e.current);

  const engine = usePointerReorderEngine<string>({
    reorderable: HISTORY_CAPABILITIES.reorderable,
    onMove: ({ fromId, toId }) => {
      const next = moveHistory(entries, fromId, toId, (e) => e.startDate);
      if (next !== entries) onCommitWork(next);
    },
  });
  const reorder: GroupReorderProps = {
    reorderable: HISTORY_CAPABILITIES.reorderable,
    rowProps: (id, group) => engine.getRowProps(id, group),
    handleProps: (id) => engine.getHandleProps(id),
  };

  function removeWork(id: string) {
    if (selectedIds.has(id)) onToggleSelect(id);
    onCommitWork(entries.filter((e) => e.id !== id));
  }

  const groups: { key: string; label: string; items: WorkHistoryEntry[] }[] = [
    { key: "current", label: "CURRENT", items: current },
    { key: "past",    label: "PAST",    items: past    },
  ];

  return (
    <div className="space-y-3">
      {groups.map((g) => g.items.length > 0 && (
        <EntityGroup
          key={g.key}
          groupKey={g.key}
          groupLabel={g.label}
          items={g.items}
          expanded={expandedGroups.has(nsGroup("work", g.key))}
          onToggle={() => onToggleGroup(nsGroup("work", g.key))}
          reorder={reorder}
          renderRow={(id, ctx) => {
            const e = g.items.find((x) => x.id === id)!;
            const sub: string[] = [];
            if (e.startDate?.year) sub.push(String(e.startDate.year));
            if (e.endDate?.year) sub.push(`→ ${e.endDate.year}`);
            else if (e.current) sub.push("→ current");
            return (
              <EntityRow
                id={e.id}
                groupKey={ctx.groupKey}
                reorder={ctx.reorder}
                title={e.role || e.employer || "(role)"}
                subtitle={[e.employer, sub.join(" ")].filter(Boolean).join(" · ")}
                status={e.current ? { color: "emerald", label: "Current" } : { color: "slate", label: "Past" }}
                selected={selectedIds.has(e.id)}
                onClick={(ev) => onToggleSelect(e.id, !ev.shiftKey && !ev.metaKey && !ev.ctrlKey)}
                onDelete={() => removeWork(e.id)}
              />
            );
          }}
        />
      ))}
      {entries.length === 0 && (
        <div className="card text-sm text-slate-500">No work history recorded.</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Education middle
// ────────────────────────────────────────────────────────────────────────

function EducationMiddle({
  history,
  selectedIds,
  expandedGroups,
  onToggleGroup,
  onToggleSelect,
  onCommitHistory,
}: MiddleProps) {
  const edu = history.educationHistory;
  const tertiary = edu.tertiaryStudies ?? [];

  // Tertiary studies carry no date field — a single bucket, freely
  // reorderable. Plain splice; engine enforces the single-group constraint.
  const engine = usePointerReorderEngine<string>({
    reorderable: HISTORY_CAPABILITIES.reorderable,
    onMove: ({ fromId, toId }) => {
      const next = [...tertiary];
      const from = next.findIndex((t) => t.id === fromId);
      const to = next.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) return;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onCommitHistory({ ...history, educationHistory: { ...edu, tertiaryStudies: next } });
    },
  });
  const reorder: GroupReorderProps = {
    reorderable: HISTORY_CAPABILITIES.reorderable,
    rowProps: (id, group) => engine.getRowProps(id, group),
    handleProps: (id) => engine.getHandleProps(id),
  };

  function removeTertiary(id: string) {
    if (selectedIds.has(id)) onToggleSelect(id);
    onCommitHistory({
      ...history,
      educationHistory: { ...edu, tertiaryStudies: tertiary.filter((t) => t.id !== id) },
    });
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Schooling</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Highest year completed</label>
            <input className="input" value={edu.highestYearCompleted ?? ""} onChange={(e) => onCommitHistory({ ...history, educationHistory: { ...edu, highestYearCompleted: e.target.value } })} />
          </div>
          <div>
            <label className="label">School name</label>
            <input className="input" value={edu.schoolName ?? ""} onChange={(e) => onCommitHistory({ ...history, educationHistory: { ...edu, schoolName: e.target.value } })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={!!edu.leftSchoolEarly} onChange={(e) => onCommitHistory({ ...history, educationHistory: { ...edu, leftSchoolEarly: e.target.checked } })} />
          Left school early
        </label>
        <div>
          <label className="label">Additional narrative</label>
          <textarea className="input min-h-[60px]" value={edu.additionalNarrative ?? ""} onChange={(e) => onCommitHistory({ ...history, educationHistory: { ...edu, additionalNarrative: e.target.value } })} />
        </div>
      </div>

      <EntityGroup
        groupKey="tertiary"
        groupLabel="TERTIARY"
        items={tertiary}
        expanded={expandedGroups.has(nsGroup("education", "tertiary"))}
        onToggle={() => onToggleGroup(nsGroup("education", "tertiary"))}
        reorder={reorder}
        renderRow={(id, ctx) => {
          const t = tertiary.find((x) => x.id === id)!;
          return (
            <EntityRow
              id={t.id}
              groupKey={ctx.groupKey}
              reorder={ctx.reorder}
              title={t.course || "(course)"}
              subtitle={t.institution}
              status={t.completed ? { color: "emerald", label: "Completed" } : { color: "amber", label: "Not completed" }}
              selected={selectedIds.has(t.id)}
              onClick={(ev) => onToggleSelect(t.id, !ev.shiftKey && !ev.metaKey && !ev.ctrlKey)}
              onDelete={() => removeTertiary(t.id)}
            />
          );
        }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// RIGHT panel — single editor OR bulk editor
// ────────────────────────────────────────────────────────────────────────

type RightProps = {
  history: PsychiatricHistory;
  activeSection: SectionKey;
  selectedIds: Set<string>;
  onCommitTreatments: (t: TreatmentEntry[]) => void;
  onCommitMedical: (m: MedicalCondition[]) => void;
  onCommitEvents: (timing: "pre_existing" | "subsequent", e: HistoryEvent[]) => void;
  onCommitWork: (w: WorkHistoryEntry[]) => void;
  onCommitHistory: (h: PsychiatricHistory) => void;
};

function RightPanel(props: RightProps) {
  const { activeSection, selectedIds, history } = props;

  if (!SECTION_DEFS.find((s) => s.key === activeSection)?.isEntityList) {
    return (
      <p className="text-xs text-slate-500 italic">
        This section is edited inline in the centre panel.
      </p>
    );
  }
  if (selectedIds.size === 0) {
    return (
      <p className="text-xs text-slate-500 italic">
        Select one or more entities to edit. Use Smart Select for the whole section.
      </p>
    );
  }

  if (activeSection === "treatments") {
    const all = history.treatmentHistory.treatments ?? [];
    const selected = all.filter((t) => selectedIds.has(t.id));
    if (selected.length === 1) {
      return (
        <TreatmentDetailEditor
          entry={selected[0]}
          onChange={(patch) =>
            props.onCommitTreatments(all.map((t) => (t.id === selected[0].id ? { ...t, ...patch } : t)))
          }
          onRemove={() => props.onCommitTreatments(all.filter((t) => t.id !== selected[0].id))}
        />
      );
    }
    return (
      <TreatmentBulkEditor
        selected={selected}
        onApply={(patch) =>
          props.onCommitTreatments(all.map((t) => (selectedIds.has(t.id) ? { ...t, ...patch } : t)))
        }
        onRemove={() => props.onCommitTreatments(all.filter((t) => !selectedIds.has(t.id)))}
      />
    );
  }

  if (activeSection === "medical") {
    const all = history.generalMedicalHistory ?? [];
    const selected = all.filter((c) => selectedIds.has(c.id));
    if (selected.length === 1) {
      return (
        <MedicalDetailEditor
          entry={selected[0]}
          onChange={(patch) =>
            props.onCommitMedical(all.map((c) => (c.id === selected[0].id ? { ...c, ...patch } : c)))
          }
          onRemove={() => props.onCommitMedical(all.filter((c) => c.id !== selected[0].id))}
        />
      );
    }
    return (
      <MedicalBulkEditor
        selected={selected}
        onApply={(patch) =>
          props.onCommitMedical(all.map((c) => (selectedIds.has(c.id) ? { ...c, ...patch } : c)))
        }
        onRemove={() => props.onCommitMedical(all.filter((c) => !selectedIds.has(c.id)))}
      />
    );
  }

  if (activeSection === "preExisting" || activeSection === "subsequent") {
    const timing = activeSection === "preExisting" ? "pre_existing" : "subsequent";
    const all = (timing === "pre_existing" ? history.preExistingEvents : history.subsequentEvents) ?? [];
    const selected = all.filter((e) => selectedIds.has(e.id));
    if (selected.length === 1) {
      return (
        <EventDetailEditor
          entry={selected[0]}
          onChange={(patch) =>
            props.onCommitEvents(timing, all.map((e) => (e.id === selected[0].id ? { ...e, ...patch } : e)))
          }
          onRemove={() => props.onCommitEvents(timing, all.filter((e) => e.id !== selected[0].id))}
        />
      );
    }
    return (
      <EventBulkEditor
        selected={selected}
        onApply={(patch) =>
          props.onCommitEvents(timing, all.map((e) => (selectedIds.has(e.id) ? { ...e, ...patch } : e)))
        }
        onRemove={() => props.onCommitEvents(timing, all.filter((e) => !selectedIds.has(e.id)))}
      />
    );
  }

  if (activeSection === "work") {
    const all = history.workHistory ?? [];
    const selected = all.filter((e) => selectedIds.has(e.id));
    if (selected.length === 1) {
      return (
        <WorkDetailEditor
          entry={selected[0]}
          onChange={(patch) =>
            props.onCommitWork(all.map((e) => (e.id === selected[0].id ? { ...e, ...patch } : e)))
          }
          onRemove={() => props.onCommitWork(all.filter((e) => e.id !== selected[0].id))}
        />
      );
    }
    return (
      <WorkBulkEditor
        selected={selected}
        onApply={(patch) =>
          props.onCommitWork(all.map((e) => (selectedIds.has(e.id) ? { ...e, ...patch } : e)))
        }
        onRemove={() => props.onCommitWork(all.filter((e) => !selectedIds.has(e.id)))}
      />
    );
  }

  if (activeSection === "education") {
    const all = history.educationHistory.tertiaryStudies ?? [];
    const selected = all.filter((t) => selectedIds.has(t.id));
    function commitTertiary(next: TertiaryStudy[]) {
      props.onCommitHistory({ ...history, educationHistory: { ...history.educationHistory, tertiaryStudies: next } });
    }
    if (selected.length === 1) {
      const t = selected[0];
      return (
        <div className="space-y-3">
          <input className="input" placeholder="Course" value={t.course ?? ""} onChange={(e) => commitTertiary(all.map((x) => (x.id === t.id ? { ...x, course: e.target.value } : x)))} />
          <input className="input" placeholder="Institution" value={t.institution ?? ""} onChange={(e) => commitTertiary(all.map((x) => (x.id === t.id ? { ...x, institution: e.target.value } : x)))} />
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={!!t.completed} onChange={(e) => commitTertiary(all.map((x) => (x.id === t.id ? { ...x, completed: e.target.checked } : x)))} />
            Completed
          </label>
          <textarea className="input min-h-[60px]" placeholder="Notes" value={t.notes ?? ""} onChange={(e) => commitTertiary(all.map((x) => (x.id === t.id ? { ...x, notes: e.target.value } : x)))} />
          <button type="button" className="text-[11px] text-red-600" onClick={() => commitTertiary(all.filter((x) => x.id !== t.id))}>Remove</button>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Bulk apply to {selected.length} tertiary entries</p>
        <Chip
          label="Mark completed"
          active={false}
          onClick={() => commitTertiary(all.map((x) => (selectedIds.has(x.id) ? { ...x, completed: true } : x)))}
          variant="emerald"
        />
        <Chip
          label="Mark not completed"
          active={false}
          onClick={() => commitTertiary(all.map((x) => (selectedIds.has(x.id) ? { ...x, completed: false } : x)))}
          variant="amber"
        />
        <button
          type="button"
          className="text-[11px] text-red-600"
          onClick={() => commitTertiary(all.filter((x) => !selectedIds.has(x.id)))}
        >
          Remove {selected.length}
        </button>
      </div>
    );
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────
// TreatmentDetailEditor + TreatmentBulkEditor
// ────────────────────────────────────────────────────────────────────────

function TreatmentDetailEditor({
  entry,
  onChange,
  onRemove,
}: {
  entry: TreatmentEntry;
  onChange: (patch: Partial<TreatmentEntry>) => void;
  onRemove: () => void;
}) {
  const isMed = entry.category === "medication";
  const freqInputs = freqValueToInputs(entry.frequency);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-violet-700 uppercase">
          {TREATMENT_CATEGORY_LABELS[entry.category]}
        </div>
        <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>Remove</button>
      </div>

      {isMed ? (
        <MedicationNameInput
          name={entry.name}
          drugClass={entry.drugClass}
          onChange={(name, cls) => onChange({ name, drugClass: cls ?? entry.drugClass })}
        />
      ) : (
        <div>
          <label className="label">Name / modality</label>
          <input
            className="input"
            value={entry.name}
            onChange={(e) => onChange({ name: e.target.value })}
            list={`tx-modality-${entry.id}`}
          />
          <datalist id={`tx-modality-${entry.id}`}>
            {TREATMENT_MODALITIES.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      )}

      {isMed && (
        <>
          <div>
            <label className="label">Drug class</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(Object.keys(MEDICATION_CLASS_LABELS) as MedicationClass[]).map((c) => (
                <Chip
                  key={c}
                  label={MEDICATION_CLASS_LABELS[c]}
                  active={entry.drugClass === c}
                  onClick={() => onChange({ drugClass: entry.drugClass === c ? undefined : c })}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Dose</label>
              <input
                type="number"
                className="input"
                value={entry.dose?.value ?? ""}
                onChange={(e) =>
                  onChange({
                    dose: {
                      value: e.target.value === "" ? undefined : Number(e.target.value),
                      unit: entry.dose?.unit ?? "mg",
                    },
                  })
                }
              />
            </div>
            <div>
              <label className="label">Unit</label>
              <div className="flex gap-1.5 mt-1">
                {(["mcg", "mg", "g"] as const).map((u) => (
                  <Chip
                    key={u}
                    label={u}
                    active={(entry.dose?.unit ?? "mg") === u}
                    onClick={() => onChange({ dose: { ...entry.dose, unit: u } })}
                    variant="slate"
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="label">Side effects</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SIDE_EFFECT_CHIPS.map((s) => {
                const active = (entry.sideEffects ?? "").toLowerCase().includes(s.toLowerCase());
                return (
                  <Chip
                    key={s}
                    label={s}
                    active={active}
                    onClick={() => {
                      const current = entry.sideEffects ?? "";
                      const next = active
                        ? current.split(",").map((x) => x.trim()).filter((x) => x.toLowerCase() !== s.toLowerCase()).join(", ")
                        : (current ? `${current}, ${s.toLowerCase()}` : s.toLowerCase());
                      onChange({ sideEffects: next });
                    }}
                    variant="amber"
                  />
                );
              })}
            </div>
            <input
              className="input mt-2"
              placeholder="Additional / free-text"
              value={entry.sideEffects ?? ""}
              onChange={(e) => onChange({ sideEffects: e.target.value })}
            />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Provider</label>
          <input className="input" value={entry.providerName ?? ""} onChange={(e) => onChange({ providerName: e.target.value })} />
        </div>
        <div>
          <label className="label">Indication</label>
          <input className="input" value={entry.indication ?? ""} onChange={(e) => onChange({ indication: e.target.value })} />
        </div>
        <PartialDateInput label="Commenced" value={entry.commenced} onChange={(d) => onChange({ commenced: d })} />
        <PartialDateInput label="Ceased" value={entry.ceased} onChange={(d) => onChange({ ceased: d })} />
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={entry.current} onChange={(e) => onChange({ current: e.target.checked })} />
        Currently ongoing
      </label>

      <FrequencyInput
        label="Frequency"
        unit={freqInputs.unit}
        count={freqInputs.count}
        onUnit={(u) => onChange({ frequency: freqValueFromInputs(u, freqInputs.count) })}
        onCount={(c) => onChange({ frequency: freqValueFromInputs(freqInputs.unit, c) })}
      />

      <div>
        <label className="label">Perceived benefit</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(["none", "minimal", "partial", "moderate", "significant"] as const).map((b) => (
            <Chip
              key={b}
              label={b}
              active={entry.perceivedBenefit === b}
              onClick={() => onChange({ perceivedBenefit: entry.perceivedBenefit === b ? undefined : b })}
              variant={b === "significant" ? "emerald" : b === "none" ? "red" : "slate"}
            />
          ))}
        </div>
      </div>

      {!entry.current && (
        <div>
          <label className="label">Reason ceased</label>
          <input className="input" value={entry.ceasedReason ?? ""} onChange={(e) => onChange({ ceasedReason: e.target.value })} />
        </div>
      )}
      <div>
        <label className="label">Duration (free text — used when dates unknown)</label>
        <input className="input" value={entry.durationText ?? ""} onChange={(e) => onChange({ durationText: e.target.value })} />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[50px]" value={entry.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
      </div>
    </div>
  );
}

function TreatmentBulkEditor({
  selected,
  onApply,
  onRemove,
}: {
  selected: TreatmentEntry[];
  onApply: (patch: Partial<TreatmentEntry>) => void;
  onRemove: () => void;
}) {
  const [freqInputs, setFreqInputs] = useState({ unit: "", count: "" });
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Apply shared attributes to {selected.length} treatments. Empty fields are not applied.
      </p>

      <div>
        <label className="label">Perceived benefit</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(["none", "minimal", "partial", "moderate", "significant"] as PerceivedBenefit[]).map((b) => (
            <Chip
              key={b}
              label={b}
              active={false}
              onClick={() => onApply({ perceivedBenefit: b })}
              variant={b === "significant" ? "emerald" : b === "none" ? "red" : "slate"}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="label">Current</label>
        <div className="flex gap-1.5 mt-1">
          <Chip label="Mark current" active={false} onClick={() => onApply({ current: true })} variant="emerald" />
          <Chip label="Mark ceased" active={false} onClick={() => onApply({ current: false })} variant="slate" />
        </div>
      </div>

      <div>
        <FrequencyInput
          label="Frequency"
          unit={freqInputs.unit}
          count={freqInputs.count}
          onUnit={(u) => setFreqInputs({ ...freqInputs, unit: u })}
          onCount={(c) => setFreqInputs({ ...freqInputs, count: c })}
        />
        <button
          type="button"
          className="mt-1 text-[11px] px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-500"
          onClick={() => onApply({ frequency: freqValueFromInputs(freqInputs.unit, freqInputs.count) })}
        >
          Apply frequency
        </button>
      </div>

      <div>
        <label className="label">Drug class (medications only)</label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(Object.keys(MEDICATION_CLASS_LABELS) as MedicationClass[]).map((c) => (
            <Chip
              key={c}
              label={MEDICATION_CLASS_LABELS[c]}
              active={false}
              onClick={() => onApply({ drugClass: c })}
            />
          ))}
        </div>
      </div>

      <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>
        Remove {selected.length}
      </button>
    </div>
  );
}

// ── Medication autocomplete ──────────────────────────────────────────────

function MedicationNameInput({
  name,
  drugClass,
  onChange,
}: {
  name: string;
  drugClass: MedicationClass | undefined;
  onChange: (name: string, cls: MedicationClass | undefined) => void;
}) {
  const suggestions = useMemo(() => searchMedications(name, 12), [name]);
  return (
    <div>
      <label className="label">Medication name</label>
      <input
        className="input"
        value={name}
        list="medication-registry"
        onChange={(e) => {
          const v = e.target.value;
          const cls = classifyMedication(v);
          onChange(v, cls ?? drugClass);
        }}
      />
      <datalist id="medication-registry">
        {(suggestions.length ? suggestions : MEDICATION_REGISTRY.slice(0, 30)).map((m) => (
          <option key={m.name} value={m.name}>
            {MEDICATION_CLASS_LABELS[m.class]}
          </option>
        ))}
      </datalist>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Medical detail / bulk editors
// ────────────────────────────────────────────────────────────────────────

function MedicalDetailEditor({
  entry,
  onChange,
  onRemove,
}: {
  entry: MedicalCondition;
  onChange: (patch: Partial<MedicalCondition>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Condition</label>
        <input className="input" value={entry.condition} onChange={(e) => onChange({ condition: e.target.value })} />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {(["mild", "moderate", "severe"] as const).map((s) => (
          <Chip
            key={s}
            label={s}
            active={entry.severity === s}
            onClick={() => onChange({ severity: entry.severity === s ? undefined : s })}
            variant={s === "severe" ? "red" : s === "moderate" ? "amber" : "slate"}
          />
        ))}
        <Chip
          label="active"
          active={!!entry.active}
          onClick={() => onChange({ active: !entry.active })}
          variant="emerald"
        />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[60px]" value={entry.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
      </div>
      <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>Remove</button>
    </div>
  );
}

function MedicalBulkEditor({
  selected,
  onApply,
  onRemove,
}: {
  selected: MedicalCondition[];
  onApply: (patch: Partial<MedicalCondition>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Bulk apply to {selected.length} conditions</p>
      <div>
        <label className="label">Severity</label>
        <div className="flex gap-1.5 mt-1">
          {(["mild", "moderate", "severe"] as const).map((s) => (
            <Chip key={s} label={s} active={false} onClick={() => onApply({ severity: s })} variant={s === "severe" ? "red" : s === "moderate" ? "amber" : "slate"} />
          ))}
        </div>
      </div>
      <div>
        <label className="label">Status</label>
        <div className="flex gap-1.5 mt-1">
          <Chip label="Mark active" active={false} onClick={() => onApply({ active: true })} variant="emerald" />
          <Chip label="Mark inactive" active={false} onClick={() => onApply({ active: false })} variant="slate" />
        </div>
      </div>
      <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>Remove {selected.length}</button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Event detail / bulk editors
// ────────────────────────────────────────────────────────────────────────

function EventDetailEditor({
  entry,
  onChange,
  onRemove,
}: {
  entry: HistoryEvent;
  onChange: (patch: Partial<HistoryEvent>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Title</label>
        <input className="input" value={entry.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <PartialDateInput label="Date" value={entry.date} onChange={(d) => onChange({ date: d })} />
      <div>
        <label className="label">Category</label>
        <div className="flex gap-1.5 flex-wrap mt-1">
          {HISTORY_CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={entry.category === c} onClick={() => onChange({ category: c })} />
          ))}
        </div>
      </div>
      <div>
        <label className="label">Source</label>
        <div className="flex gap-1.5 flex-wrap mt-1">
          {SOURCE_TYPES.map((s) => (
            <Chip key={s} label={s} active={entry.sourceType === s} onClick={() => onChange({ sourceType: s })} variant="slate" />
          ))}
        </div>
      </div>
      <div>
        <label className="label">Source statement</label>
        <textarea className="input min-h-[60px]" value={entry.sourceText ?? ""} onChange={(e) => onChange({ sourceText: e.target.value })} />
      </div>
      <div>
        <label className="label">Claimant clarification</label>
        <textarea className="input min-h-[50px]" value={entry.claimantClarification ?? ""} onChange={(e) => onChange({ claimantClarification: e.target.value })} />
      </div>
      <div>
        <label className="label">Effect on functioning</label>
        <textarea className="input min-h-[50px]" value={entry.effectOnFunctioning ?? ""} onChange={(e) => onChange({ effectOnFunctioning: e.target.value })} />
      </div>
      <div>
        <label className="label">Assessor comment</label>
        <textarea className="input min-h-[50px]" value={entry.assessorComment ?? ""} onChange={(e) => onChange({ assessorComment: e.target.value })} />
      </div>
      <div>
        <label className="label">Significance</label>
        <div className="flex gap-1.5 flex-wrap mt-1">
          {(["none", "minor", "moderate", "significant"] as const).map((s) => (
            <Chip key={s} label={s} active={entry.significance === s} onClick={() => onChange({ significance: entry.significance === s ? undefined : s })} variant={s === "significant" ? "red" : s === "moderate" ? "amber" : "slate"} />
          ))}
        </div>
      </div>
      <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>Remove</button>
    </div>
  );
}

function EventBulkEditor({
  selected,
  onApply,
  onRemove,
}: {
  selected: HistoryEvent[];
  onApply: (patch: Partial<HistoryEvent>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Bulk apply to {selected.length} events</p>
      <div>
        <label className="label">Category</label>
        <div className="flex gap-1.5 flex-wrap mt-1">
          {HISTORY_CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={false} onClick={() => onApply({ category: c })} />
          ))}
        </div>
      </div>
      <div>
        <label className="label">Source</label>
        <div className="flex gap-1.5 flex-wrap mt-1">
          {SOURCE_TYPES.map((s) => (
            <Chip key={s} label={s} active={false} onClick={() => onApply({ sourceType: s })} variant="slate" />
          ))}
        </div>
      </div>
      <div>
        <label className="label">Significance</label>
        <div className="flex gap-1.5 mt-1">
          {(["none", "minor", "moderate", "significant"] as const).map((s) => (
            <Chip key={s} label={s} active={false} onClick={() => onApply({ significance: s })} variant={s === "significant" ? "red" : s === "moderate" ? "amber" : "slate"} />
          ))}
        </div>
      </div>
      <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>Remove {selected.length}</button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Work detail / bulk editors
// ────────────────────────────────────────────────────────────────────────

function WorkDetailEditor({
  entry,
  onChange,
  onRemove,
}: {
  entry: WorkHistoryEntry;
  onChange: (patch: Partial<WorkHistoryEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Employer</label>
        <input className="input" value={entry.employer ?? ""} onChange={(e) => onChange({ employer: e.target.value })} />
      </div>
      <div>
        <label className="label">Role</label>
        <input className="input" value={entry.role ?? ""} onChange={(e) => onChange({ role: e.target.value })} />
      </div>
      <PartialDateInput label="Start" value={entry.startDate} onChange={(d) => onChange({ startDate: d })} />
      <PartialDateInput label="End" value={entry.endDate} onChange={(d) => onChange({ endDate: d })} />
      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={!!entry.current} onChange={(e) => onChange({ current: e.target.checked })} />
        Current role
      </label>
      <div>
        <label className="label">Reason for leaving</label>
        <input className="input" value={entry.reasonForLeaving ?? ""} onChange={(e) => onChange({ reasonForLeaving: e.target.value })} />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[50px]" value={entry.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
      </div>
      <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>Remove</button>
    </div>
  );
}

function WorkBulkEditor({
  selected,
  onApply,
  onRemove,
}: {
  selected: WorkHistoryEntry[];
  onApply: (patch: Partial<WorkHistoryEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Bulk apply to {selected.length} roles</p>
      <div className="flex gap-1.5">
        <Chip label="Mark current" active={false} onClick={() => onApply({ current: true })} variant="emerald" />
        <Chip label="Mark past" active={false} onClick={() => onApply({ current: false })} variant="slate" />
      </div>
      <button type="button" className="text-[11px] text-red-600" onClick={onRemove}>Remove {selected.length}</button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Singleton forms (denials, family, developmental)
// ────────────────────────────────────────────────────────────────────────

function DenialsForm({
  denials,
  onChange,
}: {
  denials: PsychiatricDenials;
  onChange: (d: PsychiatricDenials) => void;
}) {
  const rows: { key: keyof PsychiatricDenials; label: string }[] = [
    { key: "deniedPreExistingPsychHistory", label: "Pre-existing psychiatric history" },
    { key: "deniedMentalHealthAdmissions",  label: "Prior mental health admissions"   },
    { key: "deniedSelfHarmHistory",         label: "Self-harm history"                },
    { key: "deniedViolenceHistory",         label: "Violence history"                 },
  ];
  return (
    <div className="card space-y-3">
      <p className="text-xs text-slate-500">
        Items the claimant denied. The narrative engine collapses to a single
        sentence when all four are denied.
      </p>
      {rows.map((r) => (
        <label key={r.key} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={denials[r.key]} onChange={(e) => onChange({ ...denials, [r.key]: e.target.checked })} />
          Denied: {r.label}
        </label>
      ))}
    </div>
  );
}

function FamilyForm({
  value,
  onChange,
}: {
  value: FamilyHistory;
  onChange: (f: FamilyHistory) => void;
}) {
  return (
    <div className="card space-y-3">
      <div>
        <label className="label">Known psychiatric family history</label>
        <div className="flex gap-1.5 mt-1">
          {(["none", "unknown", "present"] as const).map((v) => (
            <Chip key={v} label={v} active={value.knownPsychiatricFamilyHistory === v} onClick={() => onChange({ ...value, knownPsychiatricFamilyHistory: v })} />
          ))}
        </div>
      </div>
      <div>
        <label className="label">Details</label>
        <textarea className="input min-h-[80px]" value={value.details ?? ""} onChange={(e) => onChange({ ...value, details: e.target.value })} />
      </div>
    </div>
  );
}

function DevelopmentalForm({
  value,
  onChange,
}: {
  value: DevelopmentalHistory;
  onChange: (d: DevelopmentalHistory) => void;
}) {
  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Birth place</label>
          <input className="input" value={value.birthPlace ?? ""} onChange={(e) => onChange({ ...value, birthPlace: e.target.value })} />
        </div>
        <div>
          <label className="label">Moved during childhood</label>
          <input className="input" value={value.movedDuringChildhood ?? ""} onChange={(e) => onChange({ ...value, movedDuringChildhood: e.target.value })} />
        </div>
        <div>
          <label className="label">Sibling position</label>
          <input type="number" className="input" value={value.siblingPosition ?? ""} onChange={(e) => onChange({ ...value, siblingPosition: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">Total siblings</label>
          <input type="number" className="input" value={value.totalSiblings ?? ""} onChange={(e) => onChange({ ...value, totalSiblings: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <label className="label">Childhood description</label>
        <textarea className="input min-h-[60px]" value={value.childhoodDescription ?? ""} onChange={(e) => onChange({ ...value, childhoodDescription: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={!!value.childhoodTrauma} onChange={(e) => onChange({ ...value, childhoodTrauma: e.target.checked })} />
        Childhood trauma noted
      </label>
      {value.childhoodTrauma && (
        <div>
          <label className="label">Childhood trauma details</label>
          <textarea className="input min-h-[60px]" value={value.childhoodTraumaDetails ?? ""} onChange={(e) => onChange({ ...value, childhoodTraumaDetails: e.target.value })} />
        </div>
      )}
      <div>
        <label className="label">Narrative notes</label>
        <textarea className="input min-h-[60px]" value={value.narrativeNotes ?? ""} onChange={(e) => onChange({ ...value, narrativeNotes: e.target.value })} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Narrative preview (read-only, deterministic)
// ────────────────────────────────────────────────────────────────────────

function NarrativePreview({ client, history }: { client: Client; history: PsychiatricHistory }) {
  const subj = buildSubject(client.identity?.gender);
  const hist = generateHistoryNarrative(history, subj);
  const tx = generateTreatmentNarrative(history.treatmentHistory, subj);
  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="section-title mb-2">Psychiatric history</h3>
        <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
          {hist || <span className="text-slate-400 italic">No history recorded.</span>}
        </p>
      </div>
      <div className="card">
        <h3 className="section-title mb-2">Treatment</h3>
        <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
          {tx || <span className="text-slate-400 italic">No treatment recorded.</span>}
        </p>
      </div>
    </div>
  );
}
