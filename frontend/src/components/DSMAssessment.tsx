// ── DSM-5-TR Diagnostic Assessment Engine ────────────────────────────────────
// Three-column layout:
//   Left  — diagnosis hierarchy navigator
//   Middle — DSM criteria engine (collapsible rows)
//   Right  — shared symptom workspace (edits canonical SymptomEntity)
//
// Architecture contract:
//   • SymptomEntity is shared — editing sleep here updates ALL diagnoses
//   • CriterionAssessment is diagnosis-specific — met/not_met stays per-diagnosis
//   • Tri-state: unknown ≠ absent

import { useState, useCallback } from "react";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { FrequencyInput } from "./FrequencyInput";
import SymptomPresenceControl from "../integration/ui/SymptomPresenceControl";
import CriterionTriStateControl from "../integration/ui/CriterionTriStateControl";
import {
  DSM5_CATEGORIES,
  DSM5_DIAGNOSES,
  getDiagnosisDef,
} from "../data/dsm5";
import type {
  DSMAssessmentData,
  DSMCriterionDef,
  DSMDiagnosisDef,
  DSMSymptomDef,
  DSMTimelineEvent,
  DiagnosticInterpretation,
  SymptomEntity,
  SymptomSeverity,
  EpisodeSeverity,
  CriterionAssessment,
  TriState,
} from "../types/dsm";
import {
  findCriterionAssessment,
  upsertCriterionAssessment,
  getOrCreateSymptom,
  defaultDSMAssessmentData,
} from "../types/dsm";

// ── Chip helper ───────────────────────────────────────────────────────────────

function Chip({
  label,
  active,
  dimmed,
  variant = "violet",
  onClick,
}: {
  label: string;
  active: boolean;
  dimmed?: boolean;
  variant?: "violet" | "slate" | "emerald" | "red" | "amber";
  onClick: () => void;
}) {
  const activeClass =
    variant === "violet"  ? "bg-violet-600 text-white border-violet-600" :
    variant === "emerald" ? "bg-emerald-600 text-white border-emerald-600" :
    variant === "red"     ? "bg-red-500 text-white border-red-500" :
    variant === "amber"   ? "bg-amber-500 text-white border-amber-500" :
                            "bg-slate-700 text-white border-slate-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded border transition select-none ${
        active
          ? activeClass
          : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      {label}
    </button>
  );
}

// ── Tri-state control ─────────────────────────────────────────────────────────

const TRI_OPTION_LABELS: Record<TriState, string> = {
  unknown: "Unknown",
  met:     "Present",
  not_met: "Absent",
};

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: TriState }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
        status === "met"     ? "bg-emerald-500" :
        status === "not_met" ? "bg-red-400" :
                               "bg-slate-300"
      }`}
    />
  );
}

// ── Criterion completion badge ─────────────────────────────────────────────────

function CriterionBadge({
  met,
  total,
  required,
}: {
  met: number;
  total: number;
  required?: number;
}) {
  const reached = required !== undefined ? met >= required : undefined;
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
        reached === true  ? "bg-emerald-100 text-emerald-700" :
        reached === false ? "bg-amber-100 text-amber-700" :
                            "bg-slate-100 text-slate-500"
      }`}
    >
      {met}/{total}
    </span>
  );
}

// ── Criterion A auto-calculation bar ──────────────────────────────────────────

function CriterionACalcBar({
  def,
  assessments,
  diagnosisId,
}: {
  def: DSMCriterionDef;
  assessments: CriterionAssessment[];
  diagnosisId: string;
}) {
  if (!def.symptoms || def.minRequired === undefined) return null;

  const anchors = def.symptoms.filter((s) => s.isMandatoryAnchor);
  const metCount = def.symptoms.filter((s) => {
    const a = findCriterionAssessment(assessments, diagnosisId, def.id, s.id);
    return a?.status === "met";
  }).length;
  const anchorMet = anchors.some((s) => {
    const a = findCriterionAssessment(assessments, diagnosisId, def.id, s.id);
    return a?.status === "met";
  });
  const thresholdMet = metCount >= def.minRequired;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs text-slate-600 flex-wrap">
      <span className="font-medium text-slate-700">Auto-count:</span>
      <span className={`font-semibold ${thresholdMet ? "text-emerald-700" : "text-amber-700"}`}>
        {metCount}/{def.symptoms.length} symptoms present
      </span>
      <span className="text-slate-400">·</span>
      <span>
        Threshold ({def.minRequired}+):{" "}
        <span className={thresholdMet ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
          {thresholdMet ? "Reached" : "Not reached"}
        </span>
      </span>
      <span className="text-slate-400">·</span>
      <span>
        Anchor:{" "}
        <span className={anchorMet ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
          {anchorMet ? "Present" : "Missing"}
        </span>
      </span>
      <span className="ml-auto text-[10px] text-slate-400 italic">
        Clinician confirmation required — auto-count does not diagnose
      </span>
    </div>
  );
}

// ── Left column: Diagnosis Navigator ─────────────────────────────────────────

function DiagnosisNavigator({
  selectedId,
  onSelect,
  assessments,
  scrollKey,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  assessments: CriterionAssessment[];
  scrollKey?: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useScrollRestoration<HTMLDivElement>(scrollKey);

  function toggleCategory(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  function diagnosisProgress(def: DSMDiagnosisDef) {
    const total = def.criteria.reduce((n, c) => {
      if (c.type === "symptom_count" && c.symptoms) return n + c.symptoms.length;
      return n + 1;
    }, 0);
    const touched = assessments.filter(
      (a) => a.diagnosisId === def.id && a.status !== "unknown"
    ).length;
    return { touched, total };
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto py-3 select-none">
      <p className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
        Diagnoses
      </p>
      {DSM5_CATEGORIES.map((cat) => {
        const isCollapsed = collapsed.has(cat.name);
        return (
          <div key={cat.name} className="mb-1">
            <button
              type="button"
              onClick={() => toggleCategory(cat.name)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 rounded"
            >
              <span className={`text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
              {cat.name}
            </button>
            {!isCollapsed &&
              cat.diagnosisIds.map((id) => {
                const def = getDiagnosisDef(id);
                if (!def) return null;
                const { touched, total } = diagnosisProgress(def);
                const isSelected = selectedId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelect(id)}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-left rounded transition ${
                      isSelected
                        ? "bg-violet-50 border border-violet-200"
                        : "hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    <span
                      className={`text-xs font-medium flex-1 ${
                        isSelected ? "text-violet-700" : "text-slate-700"
                      }`}
                    >
                      {def.abbreviation} — {def.name}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {touched}/{total}
                    </span>
                  </button>
                );
              })}
          </div>
        );
      })}
      <div className="px-3 mt-4 text-[10px] text-slate-400 italic">
        Mood · Trauma · Substance-Related Disorders
      </div>
    </div>
  );
}

// ── Symptom row (within Criterion A) ─────────────────────────────────────────

function SymptomRow({
  def,
  entity,
  assessment,
  isSelected,
  onSelect,
  onStatusChange,
}: {
  def: DSMSymptomDef;
  entity: SymptomEntity | undefined;
  assessment: CriterionAssessment | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onStatusChange: (status: TriState) => void;
}) {
  const status: TriState = assessment?.status ?? "unknown";
  // Evidence captured on Symptoms page but not yet confirmed in DSM Assessment
  const hasSymptomEvidence = entity?.currentPresence === true && status === "unknown";
  const hasData =
    entity &&
    (entity.onsetDate || entity.subjectiveReports || entity.evidenceFor || entity.notes);

  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition border-b border-slate-50 ${
        isSelected
          ? "bg-violet-50 border-l-2 border-l-violet-500"
          : "hover:bg-slate-50 border-l-2 border-l-transparent"
      }`}
    >
      <StatusDot status={status} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-700 truncate">
            {def.label}
          </span>
          {def.isMandatoryAnchor && (
            <span className="text-[9px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-semibold shrink-0">
              ANCHOR
            </span>
          )}
          {hasSymptomEvidence && (
            <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-semibold shrink-0">
              SEEN
            </span>
          )}
        </div>
        {hasData && (
          <p className="text-[10px] text-slate-400 truncate mt-0.5">
            {entity?.onsetDate
              ? `Onset: ${entity.onsetDate}`
              : entity?.subjectiveReports
              ? entity.subjectiveReports.slice(0, 60)
              : "Data entered"}
          </p>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <CriterionTriStateControl value={status} onChange={onStatusChange} compact />
      </div>
    </div>
  );
}

// ── Criterion A engine (symptom count) ───────────────────────────────────────

function CriterionAPanel({
  def,
  diagnosisId,
  data,
  selectedSymptomDefId,
  onSelectSymptom,
  onStatusChange,
}: {
  def: DSMCriterionDef;
  diagnosisId: string;
  data: DSMAssessmentData;
  selectedSymptomDefId: string | null;
  onSelectSymptom: (id: string | null) => void;
  onStatusChange: (symptomDefId: string, status: TriState) => void;
}) {
  if (!def.symptoms) return null;

  return (
    <div>
      <CriterionACalcBar def={def} assessments={data.criterionAssessments} diagnosisId={diagnosisId} />
      {def.symptoms.map((sym) => {
        const assessment = findCriterionAssessment(
          data.criterionAssessments, diagnosisId, def.id, sym.id
        );
        const entity = data.symptoms[sym.symptomEntityId];
        return (
          <SymptomRow
            key={sym.id}
            def={sym}
            entity={entity}
            assessment={assessment}
            isSelected={selectedSymptomDefId === sym.id}
            onSelect={() =>
              onSelectSymptom(selectedSymptomDefId === sym.id ? null : sym.id)
            }
            onStatusChange={(status) => onStatusChange(sym.id, status)}
          />
        );
      })}
    </div>
  );
}

// ── Criterion B–E engine (non-symptom criteria) ───────────────────────────────

function CriterionBEPanel({
  def,
  diagnosisId,
  data,
  isSelected,
  onSelect,
  onStatusChange,
  onAreaUpdate,
}: {
  def: DSMCriterionDef;
  diagnosisId: string;
  data: DSMAssessmentData;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  onStatusChange: (status: TriState) => void;
  onAreaUpdate: (areaId: string, field: string, value: string) => void;
}) {
  const assessment = findCriterionAssessment(data.criterionAssessments, diagnosisId, def.id);
  const status: TriState = assessment?.status ?? "unknown";

  return (
    <div>
      <div
        onClick={() => onSelect(isSelected ? null : def.id)}
        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition border-b border-slate-100 ${
          isSelected ? "bg-violet-50 border-l-2 border-l-violet-500" : "hover:bg-slate-50 border-l-2 border-l-transparent"
        }`}
      >
        <StatusDot status={status} />
        <span className="flex-1 text-xs font-medium text-slate-700">Overall assessment</span>
        <div onClick={(e) => e.stopPropagation()}>
          <CriterionTriStateControl value={status} onChange={onStatusChange} compact />
        </div>
      </div>

      {isSelected && def.assessmentAreas && (
        <div className="bg-slate-50 border-b border-slate-100">
          {def.assessmentAreas.map((area) => {
            const areaData = assessment?.areas?.[area.id] ?? {};
            return (
              <div key={area.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                <p className="text-xs font-semibold text-slate-600 mb-1">{area.label}</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {area.prompts.map((p) => (
                    <span
                      key={p}
                      className="text-[10px] bg-white border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded"
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-emerald-700 block mb-0.5">
                      Evidence for
                    </label>
                    <textarea
                      className="input text-xs py-1.5 min-h-[60px] resize-none"
                      value={areaData.evidenceFor ?? ""}
                      onChange={(e) => onAreaUpdate(area.id, "evidenceFor", e.target.value)}
                      placeholder="Supporting evidence…"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-red-600 block mb-0.5">
                      Evidence against
                    </label>
                    <textarea
                      className="input text-xs py-1.5 min-h-[60px] resize-none"
                      value={areaData.evidenceAgainst ?? ""}
                      onChange={(e) => onAreaUpdate(area.id, "evidenceAgainst", e.target.value)}
                      placeholder="Contradicting evidence…"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="px-4 py-3">
            <label className="text-[10px] font-semibold text-slate-600 block mb-1">
              Clinician notes
            </label>
            <textarea
              className="input text-xs py-1.5 min-h-[60px] resize-none"
              value={assessment?.clinicianNotes ?? ""}
              onChange={(e) =>
                onAreaUpdate("__notes__", "clinicianNotes", e.target.value)
              }
              placeholder="Clinician interpretation and notes…"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Criterion accordion row ───────────────────────────────────────────────────

function CriterionAccordion({
  def,
  diagnosisId,
  data,
  selectedSymptomDefId,
  selectedBECriterionId,
  onSelectSymptom,
  onSelectBECriterion,
  onSymptomStatusChange,
  onCriterionStatusChange,
  onAreaUpdate,
}: {
  def: DSMCriterionDef;
  diagnosisId: string;
  data: DSMAssessmentData;
  selectedSymptomDefId: string | null;
  selectedBECriterionId: string | null;
  onSelectSymptom: (id: string | null) => void;
  onSelectBECriterion: (id: string | null) => void;
  onSymptomStatusChange: (criterionId: string, symptomDefId: string, status: TriState) => void;
  onCriterionStatusChange: (criterionId: string, status: TriState) => void;
  onAreaUpdate: (criterionId: string, areaId: string, field: string, value: string) => void;
}) {
  const [open, setOpen] = useState(true);

  const isSymptomType = def.type === "symptom_count";
  const assessment = !isSymptomType
    ? findCriterionAssessment(data.criterionAssessments, diagnosisId, def.id)
    : undefined;
  const criterionStatus: TriState = assessment?.status ?? "unknown";

  // Summary dot for non-symptom criteria
  const metCount = isSymptomType && def.symptoms
    ? def.symptoms.filter((s) => {
        const a = findCriterionAssessment(data.criterionAssessments, diagnosisId, def.id, s.id);
        return a?.status === "met";
      }).length
    : undefined;

  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 transition"
      >
        <span className={`text-slate-400 transition-transform text-xs ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        {!isSymptomType && <StatusDot status={criterionStatus} />}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-800">{def.label}</span>
          <p className="text-[11px] text-slate-500 truncate mt-0.5">{def.description}</p>
        </div>
        {isSymptomType && def.symptoms && (
          <CriterionBadge
            met={metCount ?? 0}
            total={def.symptoms.length}
            required={def.minRequired}
          />
        )}
      </button>

      {open && (
        <div className="bg-white">
          {isSymptomType ? (
            <CriterionAPanel
              def={def}
              diagnosisId={diagnosisId}
              data={data}
              selectedSymptomDefId={selectedSymptomDefId}
              onSelectSymptom={onSelectSymptom}
              onStatusChange={(symptomDefId, status) =>
                onSymptomStatusChange(def.id, symptomDefId, status)
              }
            />
          ) : (
            <CriterionBEPanel
              def={def}
              diagnosisId={diagnosisId}
              data={data}
              isSelected={selectedBECriterionId === def.id}
              onSelect={(id) => onSelectBECriterion(id)}
              onStatusChange={(status) => onCriterionStatusChange(def.id, status)}
              onAreaUpdate={(areaId, field, value) =>
                onAreaUpdate(def.id, areaId, field, value)
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Right panel: Symptom Workspace ────────────────────────────────────────────

// Two distinct severity scales — see SymptomSeverity vs EpisodeSeverity in
// types/dsm.ts. Conflating them was the cause of the long-standing
// "moderate-severe" type error: episode severity has 4 levels; symptom
// severity has 3.
const SYMPTOM_SEVERITY_OPTIONS: ReadonlyArray<Exclude<SymptomSeverity, "">> = [
  "mild", "moderate", "severe",
];
const EPISODE_SEVERITY_OPTIONS: ReadonlyArray<Exclude<EpisodeSeverity, "">> = [
  "mild", "moderate", "moderate-severe", "severe", "extreme",
];
// Eating disorders use a 4-level scale without "moderate-severe" (Mild/Moderate/Severe/Extreme)
const EATING_SEVERITY_OPTIONS: ReadonlyArray<Exclude<EpisodeSeverity, "">> = [
  "mild", "moderate", "severe", "extreme",
];

function severityLabel(s: string): string {
  if (s === "moderate-severe") return "Moderate-severe";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Auto-severity calculation based on met symptom count and diagnosis
// thresholds. Returns EpisodeSeverity — this is the *episode-level*
// suggestion, not a symptom rating.
//
// Two severity models are supported:
//   • Four-level (MDD/PDD): mild → moderate → moderate-severe → severe
//     uses thresh.moderateSevere + optional agitationSymptomEntityId
//   • Three-level (SUDs): mild (2–3) → moderate (4–5) → severe (6+)
//     uses thresh.severe directly; no "moderate-severe" rung
function calcAutoSeverity(
  def: DSMDiagnosisDef,
  data: DSMAssessmentData
): EpisodeSeverity {
  const thresh = def.severityThresholds;
  if (!thresh) return "";
  const drivingCriterion = def.criteria.find((c) => c.id === thresh.criterionId);
  if (!drivingCriterion?.symptoms) return "";
  const metCount = drivingCriterion.symptoms.filter((s) => {
    const a = findCriterionAssessment(data.criterionAssessments, def.id, thresh.criterionId, s.id);
    return a?.status === "met";
  }).length;
  if (metCount < thresh.mild) return "";

  // Three-level SUD path: severe threshold present, no moderateSevere rung
  if (thresh.severe !== undefined && thresh.moderateSevere === undefined) {
    if (metCount >= thresh.severe) return "severe";
    if (metCount >= thresh.moderate) return "moderate";
    return "mild";
  }

  // Four-level path (MDD/PDD)
  const modSevere = thresh.moderateSevere ?? Infinity;
  const agitationMet = thresh.agitationSymptomEntityId
    ? (() => {
        const agitSymDef = drivingCriterion.symptoms!.find(
          (s) => s.symptomEntityId === thresh.agitationSymptomEntityId
        );
        if (!agitSymDef) return false;
        const a = findCriterionAssessment(data.criterionAssessments, def.id, thresh.criterionId, agitSymDef.id);
        return a?.status === "met";
      })()
    : false;
  if (agitationMet && metCount >= modSevere) return "severe";
  if (metCount >= modSevere) return "moderate-severe";
  if (metCount >= thresh.moderate) return "moderate";
  return "mild";
}
const PROGRESSION_OPTIONS = [
  { value: "improving",   label: "Improving" },
  { value: "stable",      label: "Stable" },
  { value: "worsening",   label: "Worsening" },
  { value: "fluctuating", label: "Fluctuating" },
] as const;
export function SymptomWorkspace({
  def,
  entity,
  onUpdate,
  onAddTimelineEvent,
  scrollKey,
}: {
  def: DSMSymptomDef;
  entity: SymptomEntity;
  onUpdate: (updates: Partial<SymptomEntity>) => void;
  onAddTimelineEvent: (event: Omit<DSMTimelineEvent, "id">) => void;
  scrollKey?: string;
}) {
  const isSuicide = def.symptomEntityId === "suicidal_ideation";
  const extra = (entity.extra ?? {}) as Record<string, string | string[]>;
  const scrollRef = useScrollRestoration<HTMLDivElement>(scrollKey);

  function updateExtra(key: string, value: unknown) {
    onUpdate({ extra: { ...entity.extra, [key]: value } });
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 z-10">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500 font-medium">Symptom Workspace</p>
            <h3 className="text-sm font-semibold text-slate-800">{def.label}</h3>
          </div>
          {def.isMandatoryAnchor && (
            <span className="text-[9px] bg-violet-100 text-violet-600 px-1.5 py-1 rounded font-semibold shrink-0">
              ANCHOR
            </span>
          )}
        </div>
        {def.prompts.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-slate-400 mb-1">Select descriptors (narrative):</p>
            <div className="flex flex-wrap gap-1">
              {def.prompts.map((p) => {
                const selected = entity.descriptors?.includes(p) ?? false;
                return (
                  <Chip
                    key={p}
                    label={p}
                    active={selected}
                    variant="violet"
                    onClick={() => {
                      const current = entity.descriptors ?? [];
                      const next = selected
                        ? current.filter((d) => d !== p)
                        : [...current, p];
                      onUpdate({ descriptors: next });
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-4">

        {/* ── BMI entry (shown when captureHints includes "bmiEntry") ── */}
        {def.captureHints?.includes("bmiEntry") && (
          <div className="rounded-lg bg-teal-50 border border-teal-200 px-3 py-2.5">
            <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wider mb-2">
              BMI / Weight Documentation
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Current BMI</label>
                <input
                  type="text"
                  className="input text-xs py-1.5"
                  value={(entity.extra?.bmiValue as string) ?? ""}
                  onChange={(e) => onUpdate({ extra: { ...entity.extra, bmiValue: e.target.value } })}
                  placeholder="e.g. 15.2"
                />
                <p className="text-[9px] text-teal-600 mt-0.5 italic">
                  Mild ≥17 · Moderate 16–16.99 · Severe 15–15.99 · Extreme &lt;15
                </p>
              </div>
              <div>
                <label className="label text-xs">Current weight</label>
                <input
                  type="text"
                  className="input text-xs py-1.5"
                  value={(entity.extra?.currentWeight as string) ?? ""}
                  onChange={(e) => onUpdate({ extra: { ...entity.extra, currentWeight: e.target.value } })}
                  placeholder="e.g. 42 kg"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Substance-specific fields (shown when captureHints includes "substanceQuantity") ── */}
        {def.captureHints?.includes("substanceQuantity") && (
          <>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-3">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
                Substance Use Details
              </p>

              {/* Quantity */}
              <div>
                <label className="label text-xs">Substance quantity</label>
                <input
                  type="text"
                  className="input text-xs py-1.5"
                  value={entity.substanceQuantity ?? ""}
                  onChange={(e) => onUpdate({ substanceQuantity: e.target.value })}
                  placeholder="e.g. 3 drinks/day · 1g/day · 2 pills/day"
                />
              </div>

              {/* Change over time */}
              <div>
                <label className="label text-xs">Change over time</label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {(["Increasing", "Decreasing", "Fluctuating", "Binge pattern", "Stable"] as const).map((opt) => {
                    const active = entity.substanceChangeOverTime?.includes(opt) ?? false;
                    return (
                      <Chip
                        key={opt}
                        label={opt}
                        active={active}
                        variant="amber"
                        onClick={() => {
                          const current = entity.substanceChangeOverTime ?? [];
                          onUpdate({
                            substanceChangeOverTime: active
                              ? current.filter((v) => v !== opt)
                              : [...current, opt],
                          });
                        }}
                      />
                    );
                  })}
                </div>
                <textarea
                  className="input text-xs py-1.5 min-h-[50px] resize-none"
                  value={entity.substanceChangeNotes ?? ""}
                  onChange={(e) => onUpdate({ substanceChangeNotes: e.target.value })}
                  placeholder="Notes on pattern — triggers, escalation, binge cycles…"
                />
              </div>
            </div>
            <hr className="border-slate-100" />
          </>
        )}

        {/* Current presence — Phase 19.1 shared canonical control.
            Bound directly to the same currentPresence field the symptom list
            edits, so both surfaces stay synchronised by design. */}
        <div>
          <label className="label text-xs">Current presence</label>
          <SymptomPresenceControl
            value={entity.currentPresence}
            onChange={(next) => onUpdate({ currentPresence: next })}
          />
        </div>

        {/* Symptom-level severity (3-level — DSM clinical-interview rating) */}
        <div>
          <label className="label text-xs">Symptom severity</label>
          <div className="flex gap-1.5 flex-wrap">
            {SYMPTOM_SEVERITY_OPTIONS.map((s) => {
              const active = entity.severity === s;
              const hasVal = !!entity.severity;
              return (
                <Chip
                  key={s}
                  label={severityLabel(s)}
                  active={active}
                  dimmed={hasVal && !active}
                  variant="violet"
                  onClick={() => onUpdate({ severity: active ? "" : s })}
                />
              );
            })}
          </div>
        </div>

        {/* Frequency */}
        <FrequencyInput
          label="Symptom frequency"
          count={entity.frequencyCount ?? ""}
          unit={entity.frequencyUnit ?? ""}
          onCount={(v) => onUpdate({ frequencyCount: v })}
          onUnit={(v) => onUpdate({ frequencyUnit: v })}
        />

        {/* Duration */}
        <FrequencyInput
          label="Duration (how long symptom has been present)"
          count={entity.durationCount ?? ""}
          unit={entity.durationUnit ?? ""}
          onCount={(v) => onUpdate({ durationCount: v })}
          onUnit={(v) => onUpdate({ durationUnit: v })}
        />

        <hr className="border-slate-100" />

        {/* Temporal section */}
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Temporal</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Onset date</label>
                <input
                  type="date"
                  className="input text-xs py-1.5"
                  value={entity.onsetDate ?? ""}
                  onChange={(e) => onUpdate({ onsetDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label text-xs">Onset context</label>
                <input
                  type="text"
                  className="input text-xs py-1.5"
                  value={entity.onsetContext ?? ""}
                  onChange={(e) => onUpdate({ onsetContext: e.target.value })}
                  placeholder="Triggering event…"
                />
              </div>
            </div>

            <div>
              <label className="label text-xs">Progression</label>
              <div className="flex gap-1.5 flex-wrap">
                {PROGRESSION_OPTIONS.map(({ value, label }) => {
                  const active = entity.progression === value;
                  const hasVal = !!entity.progression;
                  return (
                    <Chip
                      key={value}
                      label={label}
                      active={active}
                      dimmed={hasVal && !active}
                      variant="slate"
                      onClick={() => onUpdate({ progression: active ? "" : value })}
                    />
                  );
                })}
              </div>
            </div>

            <div>
              <label className="label text-xs">Episodic?</label>
              <div className="flex gap-2">
                <Chip
                  label="Episodic"
                  active={entity.episodic === true}
                  onClick={() => onUpdate({ episodic: entity.episodic === true ? undefined : true })}
                  variant="amber"
                />
                <Chip
                  label="Persistent"
                  active={entity.episodic === false}
                  onClick={() => onUpdate({ episodic: entity.episodic === false ? undefined : false })}
                  variant="slate"
                />
              </div>
            </div>

            {entity.episodic && (
              <div>
                <label className="label text-xs">Remission periods</label>
                <textarea
                  className="input text-xs py-1.5 min-h-[60px] resize-none"
                  value={entity.remissionPeriods ?? ""}
                  onChange={(e) => onUpdate({ remissionPeriods: e.target.value })}
                  placeholder="Describe any remission periods…"
                />
              </div>
            )}
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Pre-injury baseline */}
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Pre-injury baseline</p>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Chip
                label="Pre-existing"
                active={entity.preExisting === true}
                onClick={() => onUpdate({ preExisting: entity.preExisting === true ? undefined : true })}
                variant="amber"
              />
              <Chip
                label="Post-injury onset"
                active={entity.preExisting === false}
                onClick={() => onUpdate({ preExisting: entity.preExisting === false ? undefined : false })}
                variant="violet"
              />
            </div>
            {entity.preExisting !== undefined && (
              <div>
                <label className="label text-xs">Pre-injury description</label>
                <textarea
                  className="input text-xs py-1.5 min-h-[60px] resize-none"
                  value={entity.preInjuryDescription ?? ""}
                  onChange={(e) => onUpdate({ preInjuryDescription: e.target.value })}
                  placeholder="Describe pre-injury state…"
                />
              </div>
            )}
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Suicide-specific section */}
        {isSuicide && (
          <>
            <div>
              <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                Suicide / Self-harm Assessment
              </p>
              <div className="space-y-3">
                {[
                  { key: "passiveIdeation",  label: "Passive death wishes", placeholder: "e.g. 'I wish I could go to sleep and not wake up'…" },
                  { key: "activeIdeation",   label: "Active suicidal ideation", placeholder: "Nature, frequency, controllability…" },
                  { key: "plan",             label: "Plan", placeholder: "Method, means, specificity…" },
                  { key: "attempts",         label: "History of attempts", placeholder: "Dates, methods, medical severity…" },
                  { key: "protectiveFactors", label: "Protective factors", placeholder: "Family, faith, future plans, treatment…" },
                  { key: "currentRisk",      label: "Current risk formulation", placeholder: "Low / moderate / high — rationale…" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="label text-xs">{label}</label>
                    <textarea
                      className={`input text-xs py-1.5 min-h-[56px] resize-none ${
                        key === "currentRisk" ? "border-red-200 focus:ring-red-400" : ""
                      }`}
                      value={(extra[key] as string) ?? ""}
                      onChange={(e) => updateExtra(key, e.target.value)}
                      placeholder={placeholder}
                    />
                  </div>
                ))}
              </div>
            </div>
            <hr className="border-slate-100" />
          </>
        )}

        {/* Evidence */}
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Evidence</p>
          <div className="space-y-2">
            <div>
              <label className="label text-xs text-emerald-700">Evidence for</label>
              <textarea
                className="input text-xs py-1.5 min-h-[72px] resize-none"
                value={entity.evidenceFor ?? ""}
                onChange={(e) => onUpdate({ evidenceFor: e.target.value })}
                placeholder="Supporting evidence, direct quotes, observations…"
              />
            </div>
            <div>
              <label className="label text-xs text-red-600">Evidence against</label>
              <textarea
                className="input text-xs py-1.5 min-h-[72px] resize-none"
                value={entity.evidenceAgainst ?? ""}
                onChange={(e) => onUpdate({ evidenceAgainst: e.target.value })}
                placeholder="Contradicting evidence, inconsistencies…"
              />
            </div>
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Subjective / objective split */}
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Clinical capture</p>
          <div className="space-y-2">
            <div>
              <label className="label text-xs">Subjective reports</label>
              <textarea
                className="input text-xs py-1.5 min-h-[72px] resize-none"
                value={entity.subjectiveReports ?? ""}
                onChange={(e) => onUpdate({ subjectiveReports: e.target.value })}
                placeholder="Patient's own description in their words…"
              />
            </div>
            <div>
              <label className="label text-xs">Observed signs</label>
              <textarea
                className="input text-xs py-1.5 min-h-[72px] resize-none"
                value={entity.observedSigns ?? ""}
                onChange={(e) => onUpdate({ observedSigns: e.target.value })}
                placeholder="Clinician observations during interview…"
              />
            </div>
            <div>
              <label className="label text-xs">Clinician interpretation</label>
              <textarea
                className="input text-xs py-1.5 min-h-[72px] resize-none"
                value={entity.clinicianInterpretation ?? ""}
                onChange={(e) => onUpdate({ clinicianInterpretation: e.target.value })}
                placeholder="Clinical synthesis, differential weight…"
              />
            </div>
            <div>
              <label className="label text-xs">Notes</label>
              <textarea
                className="input text-xs py-1.5 min-h-[56px] resize-none"
                value={entity.notes ?? ""}
                onChange={(e) => onUpdate({ notes: e.target.value })}
                placeholder="Additional notes…"
              />
            </div>
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Timeline */}
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Add to timeline</p>
          <TimelineEventCreator
            symptomEntityId={def.symptomEntityId}
            symptomLabel={def.label}
            onAdd={onAddTimelineEvent}
          />
          {(entity.timelineEventIds?.length ?? 0) > 0 && (
            <p className="text-[10px] text-slate-400 mt-2">
              {entity.timelineEventIds?.length} event(s) linked
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Timeline event creator ─────────────────────────────────────────────────────

function TimelineEventCreator({
  symptomEntityId,
  symptomLabel,
  onAdd,
}: {
  symptomEntityId: string;
  symptomLabel: string;
  onAdd: (event: Omit<DSMTimelineEvent, "id">) => void;
}) {
  const [type, setType] = useState<DSMTimelineEvent["type"]>("onset");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");

  const EVENT_TYPES: { value: DSMTimelineEvent["type"]; label: string }[] = [
    { value: "onset",      label: "Onset" },
    { value: "worsening",  label: "Worsening" },
    { value: "remission",  label: "Remission" },
    { value: "recurrence", label: "Recurrence" },
    { value: "treatment",  label: "Treatment" },
  ];

  function handleAdd() {
    if (!description.trim()) return;
    onAdd({ type, date: date || undefined, description, symptomEntityIds: [symptomEntityId] });
    setDescription("");
    setDate("");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {EVENT_TYPES.map(({ value, label }) => {
          const active = type === value;
          const hasVal = !!type;
          return (
            <Chip
              key={value}
              label={label}
              active={active}
              dimmed={hasVal && !active}
              variant="violet"
              onClick={() => setType(value)}
            />
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          type="date"
          className="input text-xs py-1.5 w-36 shrink-0"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          type="text"
          className="input text-xs py-1.5"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={`${symptomLabel} — ${type}…`}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!description.trim()}
          className="btn-primary text-xs px-3 shrink-0 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ── Diagnostic interpretation footer ──────────────────────────────────────────

function DiagnosticInterpretationPanel({
  def,
  data,
  onUpdate,
}: {
  def: DSMDiagnosisDef;
  data: DSMAssessmentData;
  onUpdate: (updates: Partial<DiagnosticInterpretation>) => void;
}) {
  const interp = data.diagnosticInterpretations.find((d) => d.diagnosisId === def.id);

  // Auto-calculated severity (read-only suggestion)
  const autoSeverity = calcAutoSeverity(def, data);
  const effectiveSeverity = interp?.severityOverridden
    ? (interp?.severity ?? "")
    : autoSeverity;

  // Criterion summary
  const symptomCriteria = def.criteria.filter((c) => c.type === "symptom_count");
  const nonSymptomCriteria = def.criteria.filter((c) => c.type !== "symptom_count");

  const criterionSummaries = symptomCriteria.map((c) => {
    const symptoms = c.symptoms ?? [];
    const anchors = symptoms.filter((s) => s.isMandatoryAnchor);
    const metCount = symptoms.filter((s) => {
      const a = findCriterionAssessment(data.criterionAssessments, def.id, c.id, s.id);
      return a?.status === "met";
    }).length;
    const anchorMet = anchors.length > 0
      ? anchors.some((s) => {
          const a = findCriterionAssessment(data.criterionAssessments, def.id, c.id, s.id);
          return a?.status === "met";
        })
      : true;
    const thresholdMet = metCount >= (c.minRequired ?? 1) && anchorMet;
    return { id: c.id, metCount, total: symptoms.length, minRequired: c.minRequired ?? 1, anchorMet, thresholdMet };
  });

  const criteriaStatuses = nonSymptomCriteria.map((c) => {
    const a = findCriterionAssessment(data.criterionAssessments, def.id, c.id);
    return { id: c.id, status: a?.status ?? "unknown" as TriState };
  });

  return (
    <div className="border-t border-slate-200 bg-slate-50">
      <div className="px-4 py-3 space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-800">Diagnostic Summary</h4>
          <Chip
            label={interp?.clinicianConfirmed ? "Confirmed" : "Confirm diagnosis"}
            active={!!interp?.clinicianConfirmed}
            variant="emerald"
            onClick={() =>
              onUpdate({
                clinicianConfirmed: !interp?.clinicianConfirmed,
                confirmedAt: !interp?.clinicianConfirmed ? new Date().toISOString() : undefined,
              })
            }
          />
        </div>

        {/* Criteria status grid */}
        <div className="grid grid-cols-2 gap-2">
          {criterionSummaries.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg border p-2 text-xs ${
                c.thresholdMet ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
              }`}
            >
              <span className="font-semibold">Criterion {c.id}:</span>{" "}
              <span className={c.thresholdMet ? "text-emerald-700" : "text-amber-700"}>
                {c.metCount}/{c.total} (min {c.minRequired})
                {c.thresholdMet ? " ✓" : ""}
                {!c.anchorMet ? " — anchor absent" : ""}
              </span>
            </div>
          ))}
          {criteriaStatuses.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg border p-2 text-xs ${
                c.status === "met"     ? "border-emerald-200 bg-emerald-50" :
                c.status === "not_met" ? "border-red-100 bg-red-50" :
                                         "border-slate-200 bg-white"
              }`}
            >
              <span className="font-semibold">Criterion {c.id}:</span>{" "}
              <span className={c.status === "met" ? "text-emerald-700" : c.status === "not_met" ? "text-red-600" : "text-slate-500"}>
                {TRI_OPTION_LABELS[c.status]}
              </span>
            </div>
          ))}
        </div>

        {/* Severity — auto-suggested (count-based) OR manual (eating disorders, SUDs) */}
        {(def.severityThresholds || def.showManualSeverity) && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="label text-xs mb-0">Episode severity</label>
              {def.severityThresholds && autoSeverity && !interp?.severityOverridden && (
                <span className="text-[10px] text-violet-500 italic">auto-suggested</span>
              )}
              {def.showManualSeverity && !def.severityThresholds && (
                <span className="text-[10px] text-slate-400 italic">clinician-rated</span>
              )}
              {interp?.severityOverridden && def.severityThresholds && (
                <button
                  type="button"
                  className="text-[10px] text-slate-400 hover:text-slate-700 underline"
                  onClick={() => onUpdate({ severityOverridden: false, severity: undefined })}
                >
                  reset to auto
                </button>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(def.showManualSeverity && !def.severityThresholds
                ? EATING_SEVERITY_OPTIONS
                : EPISODE_SEVERITY_OPTIONS
              ).map((s) => {
                const active = effectiveSeverity === s;
                const isAuto = !!def.severityThresholds && autoSeverity === s && !interp?.severityOverridden;
                return (
                  <Chip
                    key={s}
                    label={severityLabel(s)}
                    active={active || isAuto}
                    dimmed={effectiveSeverity !== "" && !active && !isAuto}
                    variant="violet"
                    onClick={() => {
                      if (active) {
                        onUpdate({ severity: "", severityOverridden: true });
                      } else {
                        onUpdate({ severity: s, severityOverridden: true });
                      }
                    }}
                  />
                );
              })}
            </div>

            {/* BMI entry for AN (eating disorder severity is BMI-based) */}
            {def.showBmiEntry && (
              <div className="mt-2 flex items-center gap-3">
                <div>
                  <label className="label text-xs mb-0">BMI</label>
                  <input
                    type="text"
                    className="input text-xs py-1 w-24"
                    value={interp?.bmi ?? ""}
                    onChange={(e) => onUpdate({ bmi: e.target.value })}
                    placeholder="e.g. 15.8"
                  />
                </div>
                <p className="text-[9px] text-slate-400 mt-4 italic">
                  Mild ≥17 · Moderate 16–16.99 · Severe 15–15.99 · Extreme &lt;15
                </p>
              </div>
            )}
          </div>
        )}

        {/* Specifier chips */}
        {def.specifiers && def.specifiers.length > 0 && (
          <div>
            <label className="label text-xs">Specifiers</label>
            <div className="flex flex-wrap gap-1.5">
              {def.specifiers.map((spec) => {
                const selected = interp?.specifiers?.includes(spec) ?? false;
                return (
                  <Chip
                    key={spec}
                    label={spec}
                    active={selected}
                    variant="slate"
                    onClick={() => {
                      const current = interp?.specifiers ?? [];
                      const next = selected
                        ? current.filter((s) => s !== spec)
                        : [...current, spec];
                      onUpdate({ specifiers: next });
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Clinician notes */}
        <div className="space-y-2">
          <div>
            <label className="label text-xs">Clinician interpretation</label>
            <textarea
              className="input text-xs py-1.5 min-h-[72px] resize-none"
              value={interp?.interpretation ?? ""}
              onChange={(e) => onUpdate({ interpretation: e.target.value })}
              placeholder="Diagnostic formulation, weight of evidence, clinical reasoning…"
            />
          </div>
          <div>
            <label className="label text-xs">Differentials considered</label>
            <textarea
              className="input text-xs py-1.5 min-h-[56px] resize-none"
              value={interp?.differentials?.join("\n") ?? ""}
              onChange={(e) =>
                onUpdate({ differentials: e.target.value.split("\n").filter(Boolean) })
              }
              placeholder="One per line: e.g. Adjustment disorder, Persistent depressive disorder…"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Timeline panel ─────────────────────────────────────────────────────────────

function TimelinePanel({
  events,
  onDelete,
}: {
  events: DSMTimelineEvent[];
  onDelete: (id: string) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-slate-400 italic">
        No timeline events yet. Add events from the symptom workspace.
      </div>
    );
  }
  const sorted = [...events].sort((a, b) =>
    (a.date ?? "9999") < (b.date ?? "9999") ? -1 : 1
  );
  return (
    <div className="divide-y divide-slate-100">
      {sorted.map((ev) => (
        <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5">
          <span
            className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
              ev.type === "onset"      ? "bg-violet-500" :
              ev.type === "worsening" ? "bg-red-400" :
              ev.type === "remission" ? "bg-emerald-400" :
              ev.type === "treatment" ? "bg-blue-400" :
                                        "bg-slate-300"
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {ev.date && (
                <span className="text-[10px] text-slate-400 font-medium">{ev.date}</span>
              )}
              <span className={`text-[9px] uppercase font-semibold px-1 rounded ${
                ev.type === "onset"      ? "bg-violet-100 text-violet-600" :
                ev.type === "worsening" ? "bg-red-100 text-red-600" :
                ev.type === "remission" ? "bg-emerald-100 text-emerald-700" :
                ev.type === "treatment" ? "bg-blue-100 text-blue-700" :
                                          "bg-slate-100 text-slate-500"
              }`}>
                {ev.type}
              </span>
            </div>
            <p className="text-xs text-slate-700 mt-0.5">{ev.description}</p>
          </div>
          <button
            type="button"
            onClick={() => onDelete(ev.id)}
            className="text-slate-300 hover:text-red-500 transition text-xs shrink-0 mt-0.5"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Middle column: Criteria Engine ────────────────────────────────────────────

function CriteriaEngine({
  def,
  data,
  selectedSymptomDefId,
  selectedBECriterionId,
  onSelectSymptom,
  onSelectBECriterion,
  onSymptomStatusChange,
  onCriterionStatusChange,
  onAreaUpdate,
  onInterpretationUpdate,
  onDeleteTimelineEvent,
  scrollKey,
}: {
  def: DSMDiagnosisDef;
  data: DSMAssessmentData;
  selectedSymptomDefId: string | null;
  selectedBECriterionId: string | null;
  onSelectSymptom: (id: string | null) => void;
  onSelectBECriterion: (id: string | null) => void;
  onSymptomStatusChange: (criterionId: string, symptomDefId: string, status: TriState) => void;
  onCriterionStatusChange: (criterionId: string, status: TriState) => void;
  onAreaUpdate: (criterionId: string, areaId: string, field: string, value: string) => void;
  onInterpretationUpdate: (updates: Partial<import("../types/dsm").DiagnosticInterpretation>) => void;
  onDeleteTimelineEvent: (id: string) => void;
  scrollKey?: string;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const diagnosisEvents = data.timelineEvents.filter(
    (e) => !e.diagnosisId || e.diagnosisId === def.id
  );
  const scrollRef = useScrollRestoration<HTMLDivElement>(scrollKey);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {/* Diagnosis header */}
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 z-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              {def.category}
            </p>
            <h2 className="text-base font-semibold text-slate-900">{def.name}</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowTimeline((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded border transition ${
              showTimeline
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"
            }`}
          >
            Timeline {diagnosisEvents.length > 0 ? `(${diagnosisEvents.length})` : ""}
          </button>
        </div>
      </div>

      {showTimeline && (
        <div className="border-b border-slate-200 bg-white">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs font-semibold text-slate-600">Clinical Timeline</p>
          </div>
          <TimelinePanel events={diagnosisEvents} onDelete={onDeleteTimelineEvent} />
        </div>
      )}

      {/* Criteria */}
      <div className="divide-y divide-slate-200">
        {def.criteria.map((criterion) => (
          <CriterionAccordion
            key={criterion.id}
            def={criterion}
            diagnosisId={def.id}
            data={data}
            selectedSymptomDefId={selectedSymptomDefId}
            selectedBECriterionId={selectedBECriterionId}
            onSelectSymptom={onSelectSymptom}
            onSelectBECriterion={onSelectBECriterion}
            onSymptomStatusChange={onSymptomStatusChange}
            onCriterionStatusChange={onCriterionStatusChange}
            onAreaUpdate={onAreaUpdate}
          />
        ))}
      </div>

      {/* Diagnostic summary footer */}
      <DiagnosticInterpretationPanel
        def={def}
        data={data}
        onUpdate={onInterpretationUpdate}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DSMAssessment({
  data: externalData,
  onChange,
  scrollKeyBase,
}: {
  data?: DSMAssessmentData;
  onChange: (data: DSMAssessmentData) => void;
  /**
   * Stable base for inner-panel scroll restoration. The three panels
   * (left/middle/right) append their own suffix, so positions are
   * remembered independently per client/tab.
   */
  scrollKeyBase?: string;
}) {
  const data: DSMAssessmentData = externalData ?? defaultDSMAssessmentData();

  // UI state (not persisted)
  const [selectedDiagnosisId, setSelectedDiagnosisId] = useState(
    DSM5_DIAGNOSES[0]?.id ?? "mdd"
  );
  const [selectedSymptomDefId, setSelectedSymptomDefId] = useState<string | null>(null);
  const [selectedBECriterionId, setSelectedBECriterionId] = useState<string | null>(null);

  const selectedDiagnosis = getDiagnosisDef(selectedDiagnosisId);

  // Resolve selected symptom def and entity for the right panel
  const selectedSymptomDef = selectedSymptomDefId
    ? selectedDiagnosis?.criteria
        .flatMap((c) => c.symptoms ?? [])
        .find((s) => s.id === selectedSymptomDefId)
    : null;

  // ── Mutations ────────────────────────────────────────────────────────────────

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

  const handleSymptomStatusChange = useCallback(
    (criterionId: string, symptomDefId: string, status: TriState) => {
      const updated = upsertCriterionAssessment(data.criterionAssessments, {
        diagnosisId: selectedDiagnosisId,
        criterionId,
        symptomDefId,
        status,
      });
      onChange({ ...data, criterionAssessments: updated });
    },
    [data, onChange, selectedDiagnosisId]
  );

  const handleCriterionStatusChange = useCallback(
    (criterionId: string, status: TriState) => {
      const updated = upsertCriterionAssessment(data.criterionAssessments, {
        diagnosisId: selectedDiagnosisId,
        criterionId,
        status,
      });
      onChange({ ...data, criterionAssessments: updated });
    },
    [data, onChange, selectedDiagnosisId]
  );

  const handleAreaUpdate = useCallback(
    (criterionId: string, areaId: string, field: string, value: string) => {
      const existing = findCriterionAssessment(
        data.criterionAssessments, selectedDiagnosisId, criterionId
      ) ?? { diagnosisId: selectedDiagnosisId, criterionId, status: "unknown" as TriState };

      const isNotesField = areaId === "__notes__";
      const updated = upsertCriterionAssessment(data.criterionAssessments, {
        ...existing,
        ...(isNotesField
          ? { [field]: value }
          : {
              areas: {
                ...(existing.areas ?? {}),
                [areaId]: {
                  ...(existing.areas?.[areaId] ?? {}),
                  [field]: value,
                },
              },
            }),
      });
      onChange({ ...data, criterionAssessments: updated });
    },
    [data, onChange, selectedDiagnosisId]
  );

  const handleInterpretationUpdate = useCallback(
    (updates: Partial<import("../types/dsm").DiagnosticInterpretation>) => {
      const existing = data.diagnosticInterpretations.find(
        (d) => d.diagnosisId === selectedDiagnosisId
      ) ?? { diagnosisId: selectedDiagnosisId };
      const others = data.diagnosticInterpretations.filter(
        (d) => d.diagnosisId !== selectedDiagnosisId
      );
      onChange({
        ...data,
        diagnosticInterpretations: [...others, { ...existing, ...updates }],
      });
    },
    [data, onChange, selectedDiagnosisId]
  );

  const handleAddTimelineEvent = useCallback(
    (event: Omit<DSMTimelineEvent, "id">) => {
      const id = crypto.randomUUID();
      const newEvent: DSMTimelineEvent = { ...event, id, diagnosisId: selectedDiagnosisId };
      // Link to symptom entity if applicable
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
    [data, onChange, selectedDiagnosisId]
  );

  const handleDeleteTimelineEvent = useCallback(
    (eventId: string) => {
      onChange({
        ...data,
        timelineEvents: data.timelineEvents.filter((e) => e.id !== eventId),
      });
    },
    [data, onChange]
  );

  // ── Right panel selection logic ────────────────────────────────────────────

  function handleSelectSymptom(id: string | null) {
    setSelectedSymptomDefId(id);
    setSelectedBECriterionId(null);
  }

  function handleSelectBECriterion(id: string | null) {
    setSelectedBECriterionId(id);
    setSelectedSymptomDefId(null);
  }

  const showRightPanel = selectedSymptomDef !== null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-slate-50" style={{ minHeight: 0 }}>

      {/* Left column — Diagnosis navigator (fixed 220px) */}
      <div
        className="shrink-0 bg-white border-r border-slate-200 overflow-hidden flex flex-col"
        style={{ width: 220 }}
      >
        <DiagnosisNavigator
          selectedId={selectedDiagnosisId}
          onSelect={(id) => {
            setSelectedDiagnosisId(id);
            setSelectedSymptomDefId(null);
            setSelectedBECriterionId(null);
          }}
          assessments={data.criterionAssessments}
          scrollKey={scrollKeyBase ? `${scrollKeyBase}:left-panel` : undefined}
        />
      </div>

      {/* Middle + Right wrapper — fills remaining space after left column */}
      <div className="flex-1 flex overflow-hidden min-w-0">

        {/* Middle column — Criteria engine (takes up space left by right panel) */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col border-r border-slate-200 bg-white">
          {selectedDiagnosis ? (
            <CriteriaEngine
              def={selectedDiagnosis}
              data={data}
              selectedSymptomDefId={selectedSymptomDefId}
              selectedBECriterionId={selectedBECriterionId}
              onSelectSymptom={handleSelectSymptom}
              onSelectBECriterion={handleSelectBECriterion}
              onSymptomStatusChange={handleSymptomStatusChange}
              onCriterionStatusChange={handleCriterionStatusChange}
              onAreaUpdate={handleAreaUpdate}
              onInterpretationUpdate={handleInterpretationUpdate}
              onDeleteTimelineEvent={handleDeleteTimelineEvent}
              scrollKey={
                scrollKeyBase
                  ? `${scrollKeyBase}:criteria-panel:${selectedDiagnosisId}`
                  : undefined
              }
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-slate-400">
              Select a diagnosis from the left panel.
            </div>
          )}
        </div>

        {/* Right column — Symptom workspace (65% of wrapper when open, 0 when closed) */}
        <div
          className={`shrink-0 bg-white overflow-hidden flex flex-col transition-all duration-200 border-l border-slate-200 ${
            showRightPanel ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          style={{ width: showRightPanel ? "65%" : 0 }}
        >
          {selectedSymptomDef && (
            <SymptomWorkspace
              def={selectedSymptomDef}
              entity={
                getOrCreateSymptom(
                  data,
                  selectedSymptomDef.symptomEntityId,
                  selectedSymptomDef.label
                )
              }
              onUpdate={(updates) =>
                updateSymptom(
                  selectedSymptomDef.symptomEntityId,
                  selectedSymptomDef.label,
                  updates
                )
              }
              onAddTimelineEvent={handleAddTimelineEvent}
              scrollKey={
                scrollKeyBase
                  ? `${scrollKeyBase}:symptom-panel:${selectedSymptomDef.symptomEntityId}`
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
