// ── Diagnosis-agnostic symptom capture interface ──────────────────────────────
// Three-column layout mirroring DSMAssessment:
//   Left  — symptom domain navigator (progress indicators)
//   Middle — symptom list for selected domain (rapid interview mode)
//   Right  — SymptomWorkspace (shared with DSM Assessment, same entity store)
//
// Single source of truth: DSMAssessmentData.symptoms
// Changes here propagate to DSM Assessment automatically.
// Changes in DSM Assessment propagate here automatically.

import { useState, useCallback, useRef } from "react";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { SymptomWorkspace } from "./DSMAssessment";
import { SYMPTOM_DOMAINS, getDsmRefsForEntity } from "../data/symptomDomains";
import type { SymptomDomain, SymptomDomainSection } from "../data/symptomDomains";
import { MOOD_DESCRIPTORS } from "../data/moodState";
import type {
  DSMAssessmentData,
  DSMTimelineEvent,
  SymptomEntity,
  MoodState,
} from "../types/dsm";
import {
  getOrCreateSymptom,
  defaultDSMAssessmentData,
} from "../types/dsm";
import SymptomPresenceControl from "../integration/ui/SymptomPresenceControl";

// ── Presence state (Phase 19.1 — direct write via shared control) ─────────────
// undefined (?) | true (✓) | false (✗) — bound directly to currentPresence.
// No cycle, no shadow state — SymptomPresenceControl is the only editor.
// (Presence is `boolean | undefined`, used inline at each call site.)

// ── Domain progress ───────────────────────────────────────────────────────────

type DomainProgress = "empty" | "partial" | "complete";

function domainProgress(
  domain: SymptomDomain,
  symptoms: Record<string, SymptomEntity>
): DomainProgress {
  const total = domain.symptoms.length;
  if (total === 0) return "empty";
  const assessed = domain.symptoms.filter(
    (s) => symptoms[s.symptomEntityId]?.currentPresence !== undefined
  ).length;
  if (assessed === 0) return "empty";
  if (assessed >= total) return "complete";
  return "partial";
}

function ProgressIcon({ progress }: { progress: DomainProgress }) {
  if (progress === "complete")
    return <span className="text-emerald-500 font-bold text-xs shrink-0">✓</span>;
  if (progress === "partial")
    return <span className="text-amber-500 font-bold text-xs shrink-0">◐</span>;
  return <span className="text-slate-300 text-xs shrink-0">○</span>;
}

// ── DSM mapping badge ─────────────────────────────────────────────────────────

function DsmMappingBadge({ entityId }: { entityId: string }) {
  const refs = getDsmRefsForEntity(entityId);
  if (refs.length === 0) return null;
  return (
    <span
      title={refs.map((r) => `${r.diagnosisId.toUpperCase()} ${r.criterionId}`).join(", ")}
      className="text-[9px] bg-slate-100 text-slate-400 px-1 py-0.5 rounded shrink-0 cursor-help"
    >
      DSM
    </span>
  );
}

// ── Quick indicator chips ─────────────────────────────────────────────────────

function QuickIndicators({ entity }: { entity: SymptomEntity | undefined }) {
  if (!entity) return null;
  return (
    <div className="flex gap-1 shrink-0">
      {entity.severity && (
        <span className="text-[9px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-medium">
          {entity.severity}
        </span>
      )}
      {(entity.subjectiveReports || entity.observedSigns || entity.notes || entity.evidenceFor) && (
        <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded" title="Notes exist">
          📝
        </span>
      )}
      {(entity.timelineEventIds?.length ?? 0) > 0 && (
        <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded" title="Timeline events">
          ◷
        </span>
      )}
      {(entity.descriptors?.length ?? 0) > 0 && (
        <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1 py-0.5 rounded" title="Descriptors selected">
          ✎
        </span>
      )}
    </div>
  );
}

// ── Presence toggle (Phase 19.1 — shared canonical control) ───────────────────
// Both the DSM workspace and this list now render the SAME
// SymptomPresenceControl bound to the same currentPresence field.
// (Legacy single-button cycle removed.)

// ── Symptom list row ──────────────────────────────────────────────────────────

function SymptomListRow({
  def,
  entity,
  isSelected,
  onSelect,
  onPresenceChange,
}: {
  def: SymptomDomain["symptoms"][number];
  entity: SymptomEntity | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onPresenceChange: (next: boolean | undefined) => void;
}) {
  const presence = entity?.currentPresence;
  const hasEvidence = entity?.currentPresence === true;

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition border-b border-slate-50 ${
        isSelected
          ? "bg-violet-50 border-l-2 border-l-violet-500"
          : "hover:bg-slate-50 border-l-2 border-l-transparent"
      } ${hasEvidence ? "bg-emerald-50/30" : ""}`}
    >
      <SymptomPresenceControl value={presence} onChange={onPresenceChange} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium truncate ${
            presence === true ? "text-slate-900" : "text-slate-600"
          }`}>
            {def.label}
          </span>
          <DsmMappingBadge entityId={def.symptomEntityId} />
        </div>
        {entity?.descriptors && entity.descriptors.length > 0 && (
          <p className="text-[10px] text-slate-400 truncate mt-0.5">
            {entity.descriptors.slice(0, 3).join(" · ")}
            {entity.descriptors.length > 3 ? " …" : ""}
          </p>
        )}
      </div>

      <QuickIndicators entity={entity} />

      {/* Expand indicator */}
      <span className={`text-slate-300 text-xs shrink-0 transition ${isSelected ? "text-violet-400" : ""}`}>
        ▶
      </span>
    </div>
  );
}

// ── Left panel: Domain Navigator ──────────────────────────────────────────────

function DomainNavigator({
  selectedId,
  onSelect,
  symptoms,
  scrollKey,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  symptoms: Record<string, SymptomEntity>;
  scrollKey?: string;
}) {
  const scrollRef = useScrollRestoration<HTMLDivElement>(scrollKey);
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto py-3 select-none">
      <p className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
        Symptom Domains
      </p>
      {SYMPTOM_DOMAINS.map((domain) => {
        const progress = domainProgress(domain, symptoms);
        const isSelected = domain.id === selectedId;
        return (
          <button
            key={domain.id}
            type="button"
            onClick={() => onSelect(domain.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded transition mb-0.5 ${
              isSelected
                ? "bg-violet-50 border border-violet-200"
                : "hover:bg-slate-50 border border-transparent"
            }`}
          >
            <ProgressIcon progress={progress} />
            <span className={`text-xs font-medium flex-1 ${
              isSelected ? "text-violet-700" : "text-slate-700"
            }`}>
              {domain.label}
            </span>
            <span className="text-[10px] text-slate-400 shrink-0">
              {domain.symptoms.filter(
                (s) => symptoms[s.symptomEntityId]?.currentPresence !== undefined
              ).length}/{domain.symptoms.length}
            </span>
          </button>
        );
      })}
      <div className="px-3 mt-4 text-[10px] text-slate-400 italic">
        ✓ complete · ◐ partial · ○ not yet explored
      </div>
    </div>
  );
}

// ── Section header with optional editable label ───────────────────────────────

function SectionHeader({
  section,
  leadEntity,
  onLabelChange,
}: {
  section: SymptomDomainSection;
  leadEntity: SymptomEntity | undefined;
  onLabelChange: (newLabel: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const displayLabel = leadEntity?.customLabel || section.label;

  function startEdit() {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit(val: string) {
    setEditing(false);
    if (val.trim()) onLabelChange(val.trim());
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-100 border-b border-slate-200 mt-1 first:mt-0">
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          defaultValue={displayLabel}
          className="text-xs font-semibold text-slate-700 bg-transparent border-b border-violet-400 outline-none flex-1"
          onBlur={(e) => commitEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit(e.currentTarget.value);
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
        />
      ) : (
        <span className="text-xs font-semibold text-slate-600 flex-1">{displayLabel}</span>
      )}
      {section.editableLabel && !editing && (
        <button
          type="button"
          title="Rename this section"
          onClick={startEdit}
          className="text-[10px] text-slate-400 hover:text-violet-600 transition shrink-0 px-1"
        >
          ✎
        </button>
      )}
    </div>
  );
}

// ── Shared mood-state panel ───────────────────────────────────────────────────
// Bound to DSMAssessmentData.moodState — the SAME field the MSE Mood domain
// edits. Selecting a descriptor here is instantly reflected in the MSE, and
// vice versa. Supports general emotional-state capture alongside the DSM
// depressive-symptom items still listed in the symptom list below.

function MoodStatePanel({
  moodState,
  onChange,
}: {
  moodState: MoodState;
  onChange: (next: MoodState) => void;
}) {
  function toggle(id: string) {
    const descriptors = moodState.descriptors.includes(id)
      ? moodState.descriptors.filter((d) => d !== id)
      : [...moodState.descriptors, id];
    onChange({ ...moodState, descriptors });
  }
  return (
    <div className="shrink-0 border-b border-slate-200 bg-violet-50/40 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700">Mood State</h3>
        <span className="text-[10px] text-slate-400">Shared with MSE</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MOOD_DESCRIPTORS.map((d) => {
          const active = moodState.descriptors.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition select-none ${
                active
                  ? "bg-violet-600 border-violet-600 text-white"
                  : "bg-white border-slate-300 text-slate-600 hover:border-violet-400 hover:text-violet-700"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      <textarea
        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y min-h-[40px] outline-none focus:border-violet-400"
        placeholder="Mood / emotional state notes"
        value={moodState.notes ?? ""}
        onChange={(e) => onChange({ ...moodState, notes: e.target.value })}
      />
    </div>
  );
}

// ── Middle panel: Symptom List ────────────────────────────────────────────────

function SymptomList({
  domain,
  symptoms,
  selectedEntityId,
  onSelect,
  onPresenceChange,
  onSectionLabelChange,
  scrollKey,
}: {
  domain: SymptomDomain;
  symptoms: Record<string, SymptomEntity>;
  selectedEntityId: string | null;
  onSelect: (entityId: string | null) => void;
  onPresenceChange: (entityId: string, symptomType: string, next: boolean | undefined) => void;
  onSectionLabelChange: (leadEntityId: string, newLabel: string) => void;
  scrollKey?: string;
}) {
  const totalPresent = domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === true).length;
  const totalAbsent  = domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === false).length;
  const totalUnknown = domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === undefined).length;

  // If domain has sections, render with section headers (no reordering within sections)
  // If no sections, render in unknown→present→absent order
  const renderWithSections = !!domain.sections?.length;
  const scrollRef = useScrollRestoration<HTMLDivElement>(scrollKey);

  function renderRows(syms: typeof domain.symptoms) {
    return syms.map((symDef) => {
      const entity = symptoms[symDef.symptomEntityId];
      return (
        <SymptomListRow
          key={symDef.symptomEntityId}
          def={symDef}
          entity={entity}
          isSelected={selectedEntityId === symDef.symptomEntityId}
          onSelect={() =>
            onSelect(selectedEntityId === symDef.symptomEntityId ? null : symDef.symptomEntityId)
          }
          onPresenceChange={(next) => onPresenceChange(symDef.symptomEntityId, symDef.label, next)}
        />
      );
    });
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {/* Domain header */}
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 z-10">
        <h2 className="text-base font-semibold text-slate-900">{domain.label}</h2>
        <div className="flex gap-3 mt-1 text-[11px] text-slate-500">
          <span><span className="text-emerald-600 font-semibold">{totalPresent}</span> present</span>
          <span><span className="text-red-500 font-semibold">{totalAbsent}</span> absent</span>
          <span><span className="text-slate-400 font-semibold">{totalUnknown}</span> not yet asked</span>
        </div>
      </div>

      {renderWithSections ? (
        /* Sectioned rendering: Alcohol / Cannabis / Opioids / etc. */
        <div>
          {domain.sections!.map((section) => {
            const sectionSyms = domain.symptoms.filter((s) =>
              section.symptomEntityIds.includes(s.symptomEntityId)
            );
            const leadEntityId = section.symptomEntityIds[0];
            const leadEntity = leadEntityId ? symptoms[leadEntityId] : undefined;

            return (
              <div key={section.id}>
                <SectionHeader
                  section={section}
                  leadEntity={leadEntity}
                  onLabelChange={(label) => onSectionLabelChange(leadEntityId, label)}
                />
                {renderRows(sectionSyms)}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat rendering: unknown first, then present, then absent */
        <div>
          {renderRows([
            ...domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === undefined),
            ...domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === true),
            ...domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === false),
          ])}
        </div>
      )}

      {/* DSM mapping legend */}
      <div className="px-4 py-3 border-t border-slate-100 mt-2">
        <p className="text-[10px] text-slate-400">
          <span className="bg-slate-100 text-slate-400 px-1 py-0.5 rounded text-[9px] mr-1">DSM</span>
          Symptoms marked Present automatically provide evidence to the DSM Assessment page.
          Clinician must still confirm each DSM criterion.
        </p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CurrentSymptoms({
  data: externalData,
  onChange,
  scrollKeyBase,
}: {
  data?: DSMAssessmentData;
  onChange: (data: DSMAssessmentData) => void;
  /**
   * Stable base for inner-panel scroll restoration. The domain
   * navigator, symptom list, and symptom detail panel each append
   * their own suffix.
   */
  scrollKeyBase?: string;
}) {
  const data: DSMAssessmentData = externalData ?? defaultDSMAssessmentData();

  const [selectedDomainId, setSelectedDomainId] = useState(SYMPTOM_DOMAINS[0]?.id ?? "mood");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  const selectedDomain = SYMPTOM_DOMAINS.find((d) => d.id === selectedDomainId);
  const selectedSymDef = selectedDomain?.symptoms.find(
    (s) => s.symptomEntityId === selectedEntityId
  );
  const showRightPanel = selectedSymDef !== null && selectedSymDef !== undefined;

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateSymptom = useCallback(
    (entityId: string, symptomType: string, updates: Partial<SymptomEntity>) => {
      const existing = getOrCreateSymptom(data, entityId, symptomType);
      onChange({
        ...data,
        symptoms: {
          ...data.symptoms,
          [entityId]: { ...existing, ...updates },
        },
      });
    },
    [data, onChange]
  );

  // Phase 19.1 — direct write of the chosen presence value (no cycle).
  // SymptomPresenceControl always passes the explicit next value.
  const handlePresenceChange = useCallback(
    (entityId: string, symptomType: string, next: boolean | undefined) => {
      updateSymptom(entityId, symptomType, { currentPresence: next });
    },
    [updateSymptom]
  );

  // Store a custom section label on the lead entity of an editable section
  const handleSectionLabelChange = useCallback(
    (leadEntityId: string, newLabel: string) => {
      const existing = data.symptoms[leadEntityId];
      const symptomType = existing?.symptomType ?? newLabel;
      onChange({
        ...data,
        symptoms: {
          ...data.symptoms,
          [leadEntityId]: {
            ...(existing ?? {}),
            id: leadEntityId,
            symptomType,
            customLabel: newLabel,
          },
        },
      });
    },
    [data, onChange]
  );

  const handleAddTimelineEvent = useCallback(
    (event: Omit<DSMTimelineEvent, "id">) => {
      const id = crypto.randomUUID();
      const newEvent: DSMTimelineEvent = { ...event, id };
      let updatedSymptoms = data.symptoms;
      if (event.symptomEntityIds) {
        for (const entityId of event.symptomEntityIds) {
          const existing = data.symptoms[entityId];
          if (existing) {
            updatedSymptoms = {
              ...updatedSymptoms,
              [entityId]: {
                ...existing,
                timelineEventIds: [...(existing.timelineEventIds ?? []), id],
              },
            };
          }
        }
      }
      onChange({
        ...data,
        symptoms: updatedSymptoms,
        timelineEvents: [...data.timelineEvents, newEvent],
      });
    },
    [data, onChange]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-slate-50" style={{ minHeight: 0 }}>

      {/* Left column — Domain navigator (fixed 220px) */}
      <div
        className="shrink-0 bg-white border-r border-slate-200 overflow-hidden flex flex-col"
        style={{ width: 220 }}
      >
        <DomainNavigator
          selectedId={selectedDomainId}
          onSelect={(id) => {
            setSelectedDomainId(id);
            setSelectedEntityId(null);
          }}
          symptoms={data.symptoms}
          scrollKey={scrollKeyBase ? `${scrollKeyBase}:domain-list` : undefined}
        />
      </div>

      {/* Middle + Right wrapper */}
      <div className="flex-1 flex overflow-hidden min-w-0">

        {/* Middle column — Symptom list */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col border-r border-slate-200 bg-white">
          {selectedDomain ? (
            <>
              {selectedDomain.id === "mood" && (
                <MoodStatePanel
                  moodState={data.moodState ?? { descriptors: [], notes: "" }}
                  onChange={(next) => onChange({ ...data, moodState: next })}
                />
              )}
              <SymptomList
                domain={selectedDomain}
                symptoms={data.symptoms}
                selectedEntityId={selectedEntityId}
                onSelect={setSelectedEntityId}
                onPresenceChange={handlePresenceChange}
                onSectionLabelChange={handleSectionLabelChange}
                scrollKey={
                  scrollKeyBase
                    ? `${scrollKeyBase}:symptom-list:${selectedDomain.id}`
                    : undefined
                }
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-slate-400">
              Select a domain from the left panel.
            </div>
          )}
        </div>

        {/* Right column — Symptom Workspace (65% of wrapper when open) */}
        <div
          className={`shrink-0 bg-white overflow-hidden flex flex-col transition-all duration-200 border-l border-slate-200 ${
            showRightPanel ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          style={{ width: showRightPanel ? "65%" : 0 }}
        >
          {showRightPanel && selectedSymDef && (
            <SymptomWorkspace
              def={selectedSymDef}
              entity={getOrCreateSymptom(data, selectedSymDef.symptomEntityId, selectedSymDef.label)}
              onUpdate={(updates) =>
                updateSymptom(
                  selectedSymDef.symptomEntityId,
                  selectedSymDef.label,
                  updates
                )
              }
              onAddTimelineEvent={handleAddTimelineEvent}
              scrollKey={
                scrollKeyBase
                  ? `${scrollKeyBase}:detail-panel:${selectedSymDef.symptomEntityId}`
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
