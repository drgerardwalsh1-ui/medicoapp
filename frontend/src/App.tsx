import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  PIC_SCHEMA,
  MOTOR_SCHEMA,
  HPL_OVERLAY,
  MEDILAW_OVERLAY,
  applyOverlay,
  evaluateSchema,
} from "./schemas/reportSchema";
import { Field } from "./renderers/renderField";
import { buildPIRSNarrative } from "./engine/pirsEngine";
import { exportReportToDocx } from "./engine/exportDocx";
import PIRSTable from "./components/PIRSTable";
import { PIRSCategoryEntry } from "./components/PIRSCategoryEntry";
import {
  TauriAPI,
  isTauri,
  type ClientStateSnapshot,
  type EventHistoryItem,
} from "./api/tauriApi";
import {
  formatFullName,
  parseClientBlob,
  defaultReport,
  type Client,
  type PreviousAssessorPIRS,
} from "./types/client";
import type { Relationship } from "./components/RelationshipManager";
import type { PIRSTableModel } from "./types/types";
import DSMAssessment from "./components/DSMAssessment";
import CurrentSymptoms from "./components/CurrentSymptoms";
import type { DSMAssessmentData } from "./types/dsm";

// ── Types ──────────────────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

function generateId(): string {
  return crypto.randomUUID();
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-AU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    return iso;
  }
}

function prettyEventType(t: string): string {
  switch (t) {
    case "client_created":               return "Client created";
    case "demographics_updated":         return "Demographics updated";
    case "document_uploaded":            return "Document uploaded";
    case "client_restored_from_version": return "Restored from earlier version";
    default:                             return t;
  }
}

// ── PIRS categories — keys are stable internal identifiers, labels are display only
// Index order MUST match PIRSTable.tsx CATEGORY_NAMES order (0–5)

const PIRS_CATEGORIES = [
  { key: "selfCare",            label: "Self-care",                          index: 0 },
  { key: "socialRecreational",  label: "Social & Recreational Activities",   index: 1 },
  { key: "travel",              label: "Travel",                             index: 2 },
  { key: "socialFunction",      label: "Social Functioning",                 index: 3 },
  { key: "concentration",       label: "Concentration, Persistence and Pace", index: 4 },
  { key: "adaptation",          label: "Employability / Adaptation",         index: 5 },
] as const;

type PirsCategoryKey = typeof PIRS_CATEGORIES[number]["key"];

function pirsKeyToIndex(key: PirsCategoryKey): number {
  return PIRS_CATEGORIES.find((c) => c.key === key)?.index ?? 0;
}

function pirsKeyToLabel(key: PirsCategoryKey): string {
  return PIRS_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

// ── PIRS legal class definitions — keyed by category key, exact official text ──

type PirsCategoryDef = { cls: number; text: string }[];

const PIRS_DEFINITIONS: Record<PirsCategoryKey, PirsCategoryDef> = {
  selfCare: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population." },
    { cls: 2, text: "Mild impairment: can live independently, looks after self adequately, although may look unkempt occasionally, sometimes misses a meal or relies on take-away food." },
    { cls: 3, text: "Moderate impairment: cannot live independently without regular support. Needs prompting to shower daily and wear clean clothes. Does not prepare own meals, frequently misses meals. Family member or community nurse visits (or should visit) ×2–3 per week to ensure minimum level of hygiene and nutrition." },
    { cls: 4, text: "Severe impairment: Needs supervised residential care. If unsupervised, may accidentally or purposefully hurt self." },
    { cls: 5, text: "Totally impaired: Needs assistance with basic functions, such as feeding and toileting." },
  ],
  socialRecreational: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: Goes out regularly to cinemas, restaurants or other recreational venue. Belongs to clubs or associations and is actively involved with these." },
    { cls: 2, text: "Mild impairment: occasionally goes out to social events without needing a support person but does not become actively involved: eg. Dancing, cheering favourite team." },
    { cls: 3, text: "Moderate impairment: rarely goes to social events, and mostly when prompted by family or close friend. Will not go out without a support person. Not actively involved, remains quiet and withdrawn." },
    { cls: 4, text: "Severe impairment: Never leaves place of residence. Tolerates the company of family member or close friend, but will go to a different room or garden when others come to visit family or flat mate." },
    { cls: 5, text: "Totally impaired: Cannot tolerate living with anybody, extremely uncomfortable when visited by close family member." },
  ],
  travel: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: can travel to new environments without supervision." },
    { cls: 2, text: "Mild impairment: can travel without a support person, but only in a familiar area such as local shops, visiting a neighbour." },
    { cls: 3, text: "Moderate impairment: cannot travel away from own residence without a support person. Problems may be due to excessive anxiety or cognitive impairment." },
    { cls: 4, text: "Severe impairment: Finds it extremely uncomfortable to leave own residence even with trusted person." },
    { cls: 5, text: "Totally impaired: Cannot be left unsupervised, even at home. May require two or more persons to supervise when travelling." },
  ],
  socialFunction: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: No difficulty in forming and sustaining relationships, eg partner, close friendships lasting years." },
    { cls: 2, text: "Mild impairment: existing relationships are strained. Tension and arguments with partner or close family member, loss of some friendships." },
    { cls: 3, text: "Moderate impairment: previously established relationships severely strained, evidenced by periods of separation or domestic violence. Spouse, relatives or community services looking after children." },
    { cls: 4, text: "Severe impairment: Unable to form or sustain long term relationships. Pre-existing relationships ended, eg lost partner, close friends. Unable to care for dependents, eg own children, elderly parent." },
    { cls: 5, text: "Totally impaired: Unable to function within society. Living away from populated areas, actively avoids social contact." },
  ],
  concentration: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: Able to pass a TAFE or university course within normal time frame." },
    { cls: 2, text: "Mild impairment: can undertake a basic retraining course, or a standard course at a slower pace. Can focus on intellectually demanding tasks for periods of up to thirty minutes, eg. then feels fatigued or develops headache." },
    { cls: 3, text: "Moderate impairment: is unable to read more than newspaper articles. Finds it difficult to follow complex instructions, eg operating manuals, building plans, make significant repairs to motor vehicle, type long documents, follow a pattern for making clothes, tapestry or knitting." },
    { cls: 4, text: "Severe impairment: can only read a few lines before losing concentration. Difficulties following simple instructions. Concentration deficits obvious even during brief conversation. Unable to live alone, or needs regular assistance from relatives or community services." },
    { cls: 5, text: "Totally impaired: Needs constant supervision and assistance within institutional setting." },
  ],
  adaptation: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population. Able to work full time. Duties and performance are consistent with the person's education and training. The person is able to cope with the normal demands of the job." },
    { cls: 2, text: "Mild impairment: can work full time in a different environment. The duties require comparable skill and intellect. Can work in the same position, but no more than 20 hours per week. eg no longer happy to work with specific persons, work in a specific location due to travel required." },
    { cls: 3, text: "Moderate impairment: cannot work at all in same position. Can perform less than 20 hours per week in a different position, which requires less skill or is qualitatively different, eg less stressful." },
    { cls: 4, text: "Severe impairment: cannot work more than one or two days at a time, less than twenty hours per fortnight. Pace is reduced, attendance is erratic." },
    { cls: 5, text: "Totally impaired: cannot work at all." },
  ],
};

function formatDateShort(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return iso; }
}

// ── PIRS ordering ─────────────────────────────────────────────────────────────
// Order: Current PIRS (0) → Pre-injury PIRS (1) → everything else (2) by insertion

function pirsOrder(name: string): number {
  if (name === "Current PIRS") return 0;
  if (name === "Pre-injury PIRS") return 1;
  return 2;
}

function sortedPirsTables(tables: PIRSTableModel[]): PIRSTableModel[] {
  return [...tables].sort((a, b) => pirsOrder(a.name) - pirsOrder(b.name));
}

// ── Save status indicator ─────────────────────────────────────────────────────

function SaveIndicator({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  if (status === "saving") return <span className="text-xs text-slate-500">Saving…</span>;
  if (status === "saved")  return <span className="text-xs text-emerald-600">Saved</span>;
  if (status === "error")  return <span className="text-xs text-red-600">Save error</span>;
  if (dirty)               return <span className="text-xs text-amber-600">Unsaved</span>;
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function App({ client, goHome, onSave, initialSectionIndex = 0 }: {
  client: Client | null;
  goHome: () => void;
  onSave?: (updated: Client) => void;
  initialSectionIndex?: number;
}) {
  const initReport = client?.report ?? defaultReport();

  const [report, setReport]   = useState<Record<string, any>>(initReport.fields ?? {});
  const [pirsTables, setPirsTables] = useState<PIRSTableModel[]>(
    (initReport.pirsTables ?? []).map((t: any) => ({ ...t, id: t.id ?? generateId() }))
  );
  const [previousAssessorPirs, setPreviousAssessorPirs] = useState<PreviousAssessorPIRS[]>(
    initReport.previousAssessorPirs ?? []
  );
  const [relationships, setRelationships] = useState<Relationship[]>(
    (client?.relationships ?? []) as Relationship[]
  );

  const [activeSectionIndex, setActiveSectionIndex] = useState(initialSectionIndex);
  const [activePirsCategory, setActivePirsCategory] = useState<PirsCategoryKey>("selfCare");
  const [saveStatus,         setSaveStatus]         = useState<SaveStatus>("idle");
  const [isDirty,            setIsDirty]            = useState(false);

  // DSM Assessment view — shares the same sticky header tab bar
  const [inDSMView,  setInDSMView]  = useState(false);
  const [dsmData,    setDsmData]    = useState<DSMAssessmentData | undefined>(
    client?.dsmAssessment
  );

  // ── Sorted PIRS for display ───────────────────────────────────────────────

  const displayPirsTables = useMemo(() => sortedPirsTables(pirsTables), [pirsTables]);

  // ── Schema — derived from referrer org (no manual selection) ─────────────

  const schema = useMemo(() => {
    const org = (client?.administrative?.referrer?.org ?? "") as string;
    let base = org === "PIC Motor" ? MOTOR_SCHEMA : PIC_SCHEMA;
    let ov: typeof HPL_OVERLAY | null = null;
    if (org === "HPL") ov = HPL_OVERLAY;
    if (org === "Medilaw") ov = MEDILAW_OVERLAY;
    const merged = ov ? applyOverlay(base, ov) : base;
    return evaluateSchema(merged, report);
  }, [client?.administrative?.referrer?.org, report]);

  const activeSection = schema.sections?.[activeSectionIndex];

  // ── PIRS mutations ────────────────────────────────────────────────────────

  function addPIRSTable(name: string) {
    if (name === "Current PIRS" && pirsTables.some((t) => t.name === "Current PIRS")) return;
    if (name === "Pre-injury PIRS" && pirsTables.some((t) => t.name === "Pre-injury PIRS")) return;

    if (name === "Previous Assessor PIRS") {
      const newEntry: PreviousAssessorPIRS = {
        id: generateId(),
        date: "",
        author: "",
        authorRole: "",
        table: {
          id: generateId(),
          name: "Previous Assessor PIRS",
          classes: [1, 1, 1, 1, 1, 1],
          preExisting: 0,
          treatmentEffect: 0,
          reasons: Array(6).fill({ rationale: "", findings: "" }),
        },
      };
      setPreviousAssessorPirs((prev) => [...prev, newEntry]);
    } else {
      setPirsTables((prev) => [
        ...prev,
        {
          id: generateId(),
          name,
          classes: [1, 1, 1, 1, 1, 1],
          preExisting: 0,
          treatmentEffect: 0,
          reasons: Array(6).fill({ rationale: "", findings: "" }),
        },
      ]);
    }
    setIsDirty(true);
  }

  function updatePirsTable(id: string, updated: PIRSTableModel) {
    setPirsTables((prev) => prev.map((t) => (t.id === id ? updated : t)));
    setIsDirty(true);
  }

  function updatePrevAssessor(id: string, updated: PreviousAssessorPIRS) {
    setPreviousAssessorPirs((prev) => prev.map((p) => (p.id === id ? updated : p)));
    setIsDirty(true);
  }

  function handleRelationshipsChange(rels: Relationship[]) {
    setRelationships(rels);
    setIsDirty(true);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);

  const handleSave = useCallback(async () => {
    if (!client?.id) return;
    setSaveStatus("saving");
    const blob = {
      identity:      client.identity,
      administrative: client.administrative,
      clinical:      client.clinical,
      appointments:  client.appointments ?? [],
      assessmentChecklist: client.assessmentChecklist,
      relationships,
      dsmAssessment: dsmData,
      report: {
        fields:              report,
        pirsTables,
        previousAssessorPirs,
        history:             (initReport.history ?? []) as unknown[],
        lastUpdated:         new Date().toISOString(),
      },
    };
    try {
      if (isTauri) {
        await TauriAPI.updateClientDemographics(client.id, blob);
      }
      onSave?.({ ...client, report: blob.report, relationships, dsmAssessment: dsmData });
      setSaveStatus("saved");
      setIsDirty(false);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.error("[report-builder] save failed:", err);
      setSaveStatus("error");
    }
  }, [client, report, pirsTables, previousAssessorPirs, relationships, onSave]);

  handleSaveRef.current = handleSave;

  // ── Keyboard shortcut: Cmd/Ctrl+S ─────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveRef.current?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Debounced auto-save (500ms) ───────────────────────────────────────────

  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => handleSaveRef.current?.(), 500);
    return () => clearTimeout(timer);
  }, [isDirty, report, pirsTables, previousAssessorPirs]);

  // ── Mark dirty on report/PIRS changes ────────────────────────────────────

  // (setIsDirty(true) called in addPIRSTable / updatePirsTable / updatePrevAssessor;
  //  for report fields we mark dirty here)
  const prevReport = useRef(report);
  useEffect(() => {
    if (prevReport.current !== report) {
      setIsDirty(true);
      prevReport.current = report;
    }
  }, [report]);

  // ── Version History ───────────────────────────────────────────────────────

  const [historyOpen,      setHistoryOpen]      = useState(false);
  const [historyItems,     setHistoryItems]      = useState<EventHistoryItem[]>([]);
  const [previewVersion,   setPreviewVersion]    = useState<number | null>(null);
  const [previewSnapshot,  setPreviewSnapshot]   = useState<ClientStateSnapshot | null>(null);
  const [historyBusy,      setHistoryBusy]       = useState(false);

  async function loadHistory() {
    if (!isTauri || !client?.id) return;
    try { setHistoryItems(await TauriAPI.getClientEventHistory(client.id)); }
    catch (err) { console.warn("[report-builder] history failed:", err); }
  }

  useEffect(() => {
    if (historyOpen) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, client?.id]);

  async function openVersion(version: number) {
    if (!isTauri || !client?.id) return;
    try {
      const snap = await TauriAPI.getClientSnapshotAtVersion(client.id, version);
      setPreviewSnapshot(snap);
      setPreviewVersion(version);
    } catch (err) {
      alert(`Snapshot unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function closePreview() { setPreviewVersion(null); setPreviewSnapshot(null); }

  async function copyDemographicsAt(version: number) {
    if (!isTauri || !client?.id) return;
    setHistoryBusy(true);
    try {
      await TauriAPI.restoreClientFieldFromVersion(client.id, version, "demographics");
      await loadHistory();
      closePreview();
      alert("Demographics restored. Reopen the client to see the updated form.");
    } catch (err) { alert(`Copy failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setHistoryBusy(false); }
  }

  async function restoreFullAt(version: number) {
    if (!isTauri || !client?.id) return;
    setHistoryBusy(true);
    try {
      await TauriAPI.restoreClientFromVersion(client.id, version);
      await loadHistory();
      closePreview();
      alert("Full version restored. Reopen the client to see the updated form.");
    } catch (err) { alert(`Restore failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setHistoryBusy(false); }
  }

  // ── Narrative combines pirsTables + previousAssessorPirs tables ───────────

  const allTablesForNarrative = useMemo(() => {
    const prev = previousAssessorPirs.map((p) => p.table);
    return sortedPirsTables([...pirsTables, ...prev]);
  }, [pirsTables, previousAssessorPirs]);

  // ── Category activation from PIRSTable row interactions ──────────────────

  const handlePirsCategoryFocus = useCallback((index: number) => {
    const cat = PIRS_CATEGORIES[index];
    if (!cat) return;
    setActivePirsCategory(cat.key);
    console.log("Active category key:", cat.key);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  const activeCategoryIndex = pirsKeyToIndex(activePirsCategory);
  const currentPirsTable    = pirsTables.find((t) => t.name === "Current PIRS");
  const inPirs = activeSection?.id === "pirs";
  const inSymptoms = activeSection?.id === "symptoms" && !inDSMView;

  return (
    <div className="h-screen flex flex-col bg-slate-100">

      {/* HEADER — row 1: identity + actions; row 2: tab pills */}
      <div className="border-b bg-white shrink-0">
        {/* Row 1 — compact identity + actions */}
        <div className="px-4 flex items-center gap-3 h-10 border-b border-slate-100">
          <button onClick={goHome} className="text-sm text-slate-500 hover:text-slate-900 shrink-0">
            ← Back
          </button>
          <span className="text-sm font-semibold text-slate-800 shrink-0 truncate max-w-[200px]">
            {formatFullName(client?.identity)}
          </span>
          {client?.administrative?.referrer?.org && (
            <span className="text-[11px] text-slate-400 bg-slate-100 rounded px-2 py-0.5 shrink-0">
              {client.administrative.referrer.org}
            </span>
          )}
          <SaveIndicator status={saveStatus} dirty={isDirty} />
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40"
              onClick={() => setHistoryOpen(true)}
              disabled={!isTauri || !client?.id}
            >
              Version History
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
              onClick={() => handleSaveRef.current?.()}
              disabled={saveStatus === "saving"}
            >
              {saveStatus === "saving" ? "Saving…" : "Save"}
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700"
              onClick={() => client && exportReportToDocx(client, schema.title)}
            >
              Export DOCX
            </button>
          </div>
        </div>
        {/* Row 2 — section tab pills */}
        <div className="px-4 flex gap-0.5 items-end h-9">
          <button
            onClick={goHome}
            className="px-3 h-8 text-xs font-medium rounded-t border-t border-x transition border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
          >
            Demographics
          </button>
          <button
            onClick={() => setInDSMView(true)}
            className={`px-3 h-8 text-xs font-medium rounded-t border-t border-x transition ${
              inDSMView
                ? "bg-slate-100 border-slate-200 text-violet-700"
                : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            DSM Assessment
          </button>
          {schema.sections.map((section: any, index: number) => (
            <button
              key={section.id}
              onClick={() => { setActiveSectionIndex(index); setInDSMView(false); }}
              className={`px-3 h-8 text-xs font-medium rounded-t border-t border-x transition ${
                !inDSMView && index === activeSectionIndex
                  ? "bg-slate-100 border-slate-200 text-violet-700"
                  : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              {section.title}
            </button>
          ))}
        </div>
      </div>

      {/* DSM Assessment — full-height, replaces report content when active */}
      {inDSMView && (
        <div className="flex-1 overflow-hidden">
          <DSMAssessment
            data={dsmData}
            onChange={(updated: DSMAssessmentData) => {
              setDsmData(updated);
              setIsDirty(true);
              onSave?.({ ...client!, dsmAssessment: updated });
            }}
          />
        </div>
      )}

      {/* Current Symptoms — full-height three-column interview interface */}
      {inSymptoms && (
        <div className="flex-1 overflow-hidden">
          <CurrentSymptoms
            data={dsmData}
            onChange={(updated: DSMAssessmentData) => {
              setDsmData(updated);
              setIsDirty(true);
              onSave?.({ ...client!, dsmAssessment: updated });
            }}
          />
        </div>
      )}

      <div className={`flex flex-1 overflow-hidden ${inDSMView || inSymptoms ? "hidden" : ""}`}>

        {/* LEFT SIDEBAR — PIRS category nav (only in PIRS section) */}
        {inPirs && (
          <div className="w-44 bg-white border-r flex flex-col shrink-0">
            <div className="px-3 py-2 border-b">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Category</p>
            </div>
            <nav className="flex-1 overflow-y-auto p-1.5">
              {PIRS_CATEGORIES.map((cat) => {
                const cls = currentPirsTable?.classes[cat.index] ?? 1;
                const isActive = activePirsCategory === cat.key;
                return (
                  <button
                    key={cat.key}
                    onClick={() => {
                      setActivePirsCategory(cat.key);
                      console.log("Active category key:", cat.key);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 flex items-center justify-between transition ${
                      isActive
                        ? "bg-violet-100 text-violet-700 font-medium"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      cls >= 4 ? "bg-red-100 text-red-700" :
                      cls >= 3 ? "bg-amber-100 text-amber-700" :
                      "bg-slate-100 text-slate-500"
                    }`}>{cls}</span>
                  </button>
                );
              })}
            </nav>
            {/* Summary: add PIRS tables */}
            <div className="p-2 border-t space-y-1">
              <button
                className="w-full text-[11px] px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40"
                disabled={pirsTables.some((t) => t.name === "Current PIRS")}
                onClick={() => addPIRSTable("Current PIRS")}
              >+ Current PIRS</button>
              <button
                className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                disabled={pirsTables.some((t) => t.name === "Pre-injury PIRS")}
                onClick={() => addPIRSTable("Pre-injury PIRS")}
              >+ Pre-injury</button>
              <button
                className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={() => addPIRSTable("Previous Assessor PIRS")}
              >+ Prev. Assessor</button>
            </div>
          </div>
        )}

        {/* MAIN CONTENT */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">

            {/* Normal section */}
            {activeSection && !inPirs && (
              <div className="card space-y-4">
                <h2 className="section-title">{activeSection.title}</h2>
                {activeSection.fields.map((field: any) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    type={field.type}
                    value={report[field.key]}
                    onChange={(v) => setReport({ ...report, [field.key]: v })}
                  />
                ))}
              </div>
            )}

            {/* PIRS — per-category structured entry */}
            {inPirs && (
              <div className="space-y-6">

                {/* Category entry — structured subdomain inputs */}
                <div className="card">
                  <h2 className="section-title mb-4">{pirsKeyToLabel(activePirsCategory)}</h2>
                  <PIRSCategoryEntry
                    categoryKey={activePirsCategory}
                    categoryIndex={activeCategoryIndex}
                    table={currentPirsTable}
                    onUpdateTable={(updated) => updatePirsTable(updated.id, updated)}
                    subjectGender={client?.identity?.gender}
                    relationships={activePirsCategory === "socialFunction" ? relationships : undefined}
                    onRelationshipsChange={activePirsCategory === "socialFunction" ? handleRelationshipsChange : undefined}
                  />
                </div>

                {/* Full PIRS tables (calculations, comparison tables) */}
                <div className="space-y-4">
                  {displayPirsTables.map((t) => (
                    <div key={t.id} className="card card-hover">
                      <PIRSTable
                        table={t}
                        update={(updated) => updatePirsTable(t.id, { ...updated, id: t.id })}
                        onCategoryFocus={handlePirsCategoryFocus}
                      />
                    </div>
                  ))}
                </div>

                {/* Previous Assessor PIRS tables */}
                {previousAssessorPirs.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-700 border-t pt-3">Previous Assessor PIRS</h3>
                    {[...previousAssessorPirs]
                      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
                      .map((entry) => (
                        <div key={entry.id} className="card card-hover space-y-3">
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="label">Date</label>
                              <input type="date" className="input" value={entry.date}
                                onChange={(e) => updatePrevAssessor(entry.id, { ...entry, date: e.target.value })} />
                            </div>
                            <div>
                              <label className="label">Author</label>
                              <input className="input" value={entry.author}
                                onChange={(e) => updatePrevAssessor(entry.id, { ...entry, author: e.target.value })} />
                            </div>
                            <div>
                              <label className="label">Role</label>
                              <input className="input" value={entry.authorRole}
                                onChange={(e) => updatePrevAssessor(entry.id, { ...entry, authorRole: e.target.value })} />
                            </div>
                          </div>
                          <PIRSTable
                            table={entry.table}
                            update={(updated) =>
                              updatePrevAssessor(entry.id, { ...entry, table: { ...updated, id: entry.table.id } })
                            }
                            onCategoryFocus={handlePirsCategoryFocus}
                          />
                        </div>
                      ))}
                  </div>
                )}

                {/* Narrative preview */}
                <div className="bg-slate-50 border rounded-xl p-4 text-sm whitespace-pre-wrap">
                  {buildPIRSNarrative({ pirsTables: allTablesForNarrative })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL — PIRS Decision Assistant */}
        <div className="w-72 bg-white border-l flex flex-col shrink-0 overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {inPirs ? `${pirsKeyToLabel(activePirsCategory)} — Reference` : "PIRS Reference"}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-600">
            {inPirs ? (
              <>
                {/* Category-specific legal definitions — exact official text */}
                <div>
                  <p className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide mb-2">
                    Class Definitions — {pirsKeyToLabel(activePirsCategory)}
                  </p>
                  <div className="space-y-3">
                    {(PIRS_DEFINITIONS[activePirsCategory] ?? []).map((d) => {
                      const selected = currentPirsTable?.classes[activeCategoryIndex] === d.cls;
                      return (
                        <div
                          key={d.cls}
                          className={`rounded-lg p-2.5 border text-[11px] leading-relaxed ${
                            selected
                              ? "bg-violet-50 border-violet-300 text-violet-900"
                              : "border-slate-100 text-slate-600"
                          }`}
                        >
                          <span className={`font-bold mr-1.5 ${selected ? "text-violet-700" : "text-slate-800"}`}>
                            Class {d.cls}
                          </span>
                          {d.text}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Previous assessors — filtered to selected category only */}
                {previousAssessorPirs.length > 0 && (
                  <div className="space-y-3 border-t pt-3">
                    <p className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide">
                      Previous Assessors — {pirsKeyToLabel(activePirsCategory)}
                    </p>
                    {[...previousAssessorPirs]
                      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
                      .map((entry) => {
                        const cls = entry.table.classes[activeCategoryIndex] ?? "—";
                        const narrative = entry.table.reasons?.[activeCategoryIndex]?.findings ?? "";
                        return (
                          <div key={entry.id} className="pb-3 border-b border-slate-100 last:border-0 space-y-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-slate-800 leading-tight">
                                {entry.date ? formatDateShort(entry.date) : ""}
                                {entry.author ? ` — ${entry.author}` : ""}
                              </span>
                              <span className="font-bold text-slate-700 shrink-0">Class {cls}</span>
                            </div>
                            {entry.authorRole && (
                              <p className="text-[11px] text-slate-400">{entry.authorRole}</p>
                            )}
                            {narrative && (
                              <p className="text-slate-600 italic leading-snug">"{narrative}"</p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}

                {previousAssessorPirs.length === 0 && (
                  <p className="text-[11px] text-slate-400 italic">No previous assessor entries.</p>
                )}

                <p className="text-[10px] text-slate-300 border-t pt-3 leading-relaxed">
                  Source-attributed only. No inferences, rankings, or suggestions.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-slate-400 italic mt-4">
                Switch to the PIRS Assessment section to see category-specific reference.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── VERSION HISTORY MODAL ── */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setHistoryOpen(false); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                Version History — {formatFullName(client?.identity) || "(no client)"}
              </h2>
              <button className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
                onClick={() => setHistoryOpen(false)}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {historyItems.length === 0 ? (
                <p className="text-sm text-slate-500">No events found.</p>
              ) : (
                <ul className="space-y-1">
                  {[...historyItems].reverse().map((it) => (
                    <li key={it.version}>
                      <button type="button" onClick={() => openVersion(it.version)}
                        className="w-full text-left px-3 py-2 rounded hover:bg-slate-100 border border-transparent hover:border-slate-200 transition">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-slate-700">v{it.version}</span>
                          <span className="text-[11px] text-slate-400">{formatTimestamp(it.timestamp)}</span>
                        </div>
                        <div className="text-[12px] text-slate-500 truncate">{prettyEventType(it.event_type)}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-6 py-3 border-t bg-slate-50">
              <p className="text-[11px] text-slate-500">
                Restores append a new event — past history is never rewritten.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── VERSION PREVIEW MODAL ── */}
      {previewVersion !== null && (
        <div
          className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closePreview(); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Preview — v{previewVersion}</h2>
              <span className="text-xs text-slate-500">
                {previewSnapshot?.last_updated ? formatTimestamp(previewSnapshot.last_updated) : ""}
              </span>
            </div>
            {previewSnapshot ? (() => {
              const parsed = parseClientBlob(
                previewSnapshot.client_id ?? client?.id ?? "",
                previewSnapshot.demographics
              );
              const d = parsed.identity;
              const inj = parsed.clinical.injury;
              const r = parsed.administrative.referrer;
              const row = (label: string, value: unknown) =>
                value !== undefined && value !== null && value !== "" ? (
                  <div key={label} className="contents">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-slate-900">{String(value)}</dd>
                  </div>
                ) : null;
              return (
                <div className="space-y-4 text-sm">
                  <section className="space-y-2">
                    <h3 className="section-title">Demographics</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {row("Title", d.title === "Other" ? d.titleOther : d.title)}
                      {row("First Name", d.firstName)}
                      {row("Last Name", d.lastName)}
                      {row("Gender", d.gender)}
                      {row("Date of Birth", d.dateOfBirth)}
                      {row("Hand Dominance", d.handDominance)}
                      {row("Occupation", parsed.administrative.occupation)}
                      {row("Employer", parsed.administrative.employer)}
                    </dl>
                  </section>
                  <section className="space-y-2">
                    <h3 className="section-title">Injury</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {row("Date of Injury", inj?.dateOfInjury)}
                      {row("Injury Type", inj?.injuryType === "other" ? inj?.injuryTypeOther : inj?.injuryType)}
                      {row("Claim Number", inj?.claimNumber)}
                      {row("Insurer", inj?.insurerName)}
                      {row("Insurer Ref", inj?.insurerReference)}
                    </dl>
                  </section>
                  <section className="space-y-2">
                    <h3 className="section-title">Referrer</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {row("Name", r.name)}
                      {row("Organisation", r.org)}
                    </dl>
                  </section>
                </div>
              );
            })() : <p className="text-sm text-slate-500">Loading snapshot…</p>}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <button className="btn-secondary"
                onClick={() => copyDemographicsAt(previewVersion)}
                disabled={historyBusy || !previewSnapshot}>
                Copy Demographics
              </button>
              <button className="btn-primary"
                onClick={() => restoreFullAt(previewVersion)}
                disabled={historyBusy || !previewSnapshot}>
                Restore Full Version
              </button>
              <button className="btn-secondary ml-auto" onClick={closePreview}>Close</button>
            </div>
            <p className="text-[11px] text-slate-400">
              Editing in this preview is disabled by design. All restores append a new event.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
