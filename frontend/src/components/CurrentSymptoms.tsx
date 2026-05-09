// ── Diagnosis-agnostic symptom capture interface ──────────────────────────────
// Three-column layout mirroring DSMAssessment:
//   Left  — symptom domain navigator (progress indicators)
//   Middle — symptom list for selected domain (rapid interview mode)
//   Right  — SymptomWorkspace (shared with DSM Assessment, same entity store)
//
// Single source of truth: DSMAssessmentData.symptoms
// Changes here propagate to DSM Assessment automatically.
// Changes in DSM Assessment propagate here automatically.

import { useState, useCallback } from "react";
import { SymptomWorkspace } from "./DSMAssessment";
import { SYMPTOM_DOMAINS, getDsmRefsForEntity } from "../data/symptomDomains";
import type { SymptomDomain } from "../data/symptomDomains";
import type {
  DSMAssessmentData,
  DSMTimelineEvent,
  SymptomEntity,
} from "../types/dsm";
import {
  getOrCreateSymptom,
  defaultDSMAssessmentData,
} from "../types/dsm";

// ── Presence state cycle ──────────────────────────────────────────────────────
// undefined → true → false → undefined
// Displayed as: ○ → ● → ✕ → ○

type Presence = boolean | undefined;

function cyclePresence(current: Presence): Presence {
  if (current === undefined) return true;
  if (current === true) return false;
  return undefined;
}

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

// ── Presence toggle button ────────────────────────────────────────────────────

function PresenceToggle({
  presence,
  onToggle,
}: {
  presence: Presence;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={
        presence === undefined ? "Unknown — click to mark Present"
        : presence === true    ? "Present — click to mark Absent"
        :                        "Absent — click to clear"
      }
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition shrink-0 ${
        presence === true
          ? "bg-emerald-500 border-emerald-500 text-white"
          : presence === false
          ? "bg-red-400 border-red-400 text-white"
          : "bg-white border-slate-300 text-slate-400 hover:border-slate-500"
      }`}
    >
      {presence === true ? "●" : presence === false ? "✕" : "○"}
    </button>
  );
}

// ── Symptom list row ──────────────────────────────────────────────────────────

function SymptomListRow({
  def,
  entity,
  isSelected,
  onSelect,
  onPresenceToggle,
}: {
  def: SymptomDomain["symptoms"][number];
  entity: SymptomEntity | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onPresenceToggle: () => void;
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
      <PresenceToggle presence={presence} onToggle={onPresenceToggle} />

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
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  symptoms: Record<string, SymptomEntity>;
}) {
  return (
    <div className="h-full overflow-y-auto py-3 select-none">
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

// ── Middle panel: Symptom List ────────────────────────────────────────────────

function SymptomList({
  domain,
  symptoms,
  selectedEntityId,
  onSelect,
  onPresenceToggle,
}: {
  domain: SymptomDomain;
  symptoms: Record<string, SymptomEntity>;
  selectedEntityId: string | null;
  onSelect: (entityId: string | null) => void;
  onPresenceToggle: (entityId: string, symptomType: string) => void;
}) {
  const present  = domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === true);
  const absent   = domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === false);
  const unknown  = domain.symptoms.filter((s) => symptoms[s.symptomEntityId]?.currentPresence === undefined);

  // Render in order: unknown first (not yet asked), then present, then absent
  const ordered = [...unknown, ...present, ...absent];

  return (
    <div className="h-full overflow-y-auto">
      {/* Domain header */}
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 z-10">
        <h2 className="text-base font-semibold text-slate-900">{domain.label}</h2>
        <div className="flex gap-3 mt-1 text-[11px] text-slate-500">
          <span>
            <span className="text-emerald-600 font-semibold">{present.length}</span> present
          </span>
          <span>
            <span className="text-red-500 font-semibold">{absent.length}</span> absent
          </span>
          <span>
            <span className="text-slate-400 font-semibold">{unknown.length}</span> not yet asked
          </span>
        </div>
      </div>

      {/* Symptom rows */}
      <div>
        {ordered.map((symDef) => {
          const entity = symptoms[symDef.symptomEntityId];
          return (
            <SymptomListRow
              key={symDef.symptomEntityId}
              def={symDef}
              entity={entity}
              isSelected={selectedEntityId === symDef.symptomEntityId}
              onSelect={() =>
                onSelect(
                  selectedEntityId === symDef.symptomEntityId
                    ? null
                    : symDef.symptomEntityId
                )
              }
              onPresenceToggle={() =>
                onPresenceToggle(symDef.symptomEntityId, symDef.label)
              }
            />
          );
        })}
      </div>

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
}: {
  data?: DSMAssessmentData;
  onChange: (data: DSMAssessmentData) => void;
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

  const handlePresenceToggle = useCallback(
    (entityId: string, symptomType: string) => {
      const entity = data.symptoms[entityId];
      const current = entity?.currentPresence;
      const next = cyclePresence(current);
      updateSymptom(entityId, symptomType, { currentPresence: next });
    },
    [data.symptoms, updateSymptom]
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
        />
      </div>

      {/* Middle + Right wrapper */}
      <div className="flex-1 flex overflow-hidden min-w-0">

        {/* Middle column — Symptom list */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col border-r border-slate-200 bg-white">
          {selectedDomain ? (
            <SymptomList
              domain={selectedDomain}
              symptoms={data.symptoms}
              selectedEntityId={selectedEntityId}
              onSelect={setSelectedEntityId}
              onPresenceToggle={handlePresenceToggle}
            />
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
