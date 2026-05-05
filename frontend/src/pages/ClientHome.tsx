import { useState, useMemo, useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { PIC_SCHEMA } from "../schemas/reportSchema";
import {
  TauriAPI,
  isTauri,
  type ClientViewModel,
  type ClientStateSnapshot,
  type EventHistoryItem,
} from "../api/tauriApi";
import DocumentCard, { type IngestedDoc } from "../components/DocumentCard";
import {
  formatFullName,
  parseClientBlob,
  defaultClient,
  defaultAssessmentChecklist,
  defaultAttendees,
  defaultReport,
  defaultInjury,
  isAppointmentToday,
  calcAge,
  calcAgeAtDate,
  calcYearsSince,
  defaultHouseholdRelationships,
  RELATIONSHIP_STATUS_OPTIONS,
  COHABITATION_STATUS_OPTIONS,
  LIVING_ARRANGEMENT_OPTIONS,
  HOUSEHOLD_SUPPORT_TYPE_OPTIONS,
  RELATIONSHIP_TYPE_GROUPS,
  type Client,
  type Appointment,
  type InjuryData,
  type HouseholdRelationships,
  type HouseholdMember,
  type RelationshipStatus,
  type CohabitationStatus,
  type RelationshipType,
  type LivingArrangement,
} from "../types/client";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TITLE_OPTIONS = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Other"];
const GENDER_PRESETS = ["Male", "Female", "Non-binary", "Prefer not to say"];
const DURATION_MINS = [15, 30, 45, 60, 75, 90, 105, 120];
function durationLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}
function apptDurationMins(appt: Appointment): number {
  return Math.round((new Date(appt.end).getTime() - new Date(appt.start).getTime()) / 60_000);
}
const HAND_OPTIONS = [
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
  { value: "ambidextrous", label: "Ambidextrous" },
  { value: "not_applicable", label: "Not Applicable" },
  { value: "other", label: "Other" },
];
const INJURY_TYPES = [
  { value: "motor", label: "Motor Vehicle Accident" },
  { value: "workplace", label: "Workplace Injury" },
  { value: "illness", label: "Illness" },
  { value: "other", label: "Other" },
];
const TECHNICAL_ISSUES = [
  { value: "none", label: "None" },
  { value: "minor", label: "Minor" },
  { value: "significant", label: "Significant" },
];
const ORG_PRESETS = ["PIC Workers", "PIC Motor", "HPL", "Medilaw"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClientHome({
  client,
  isNew,
  onSave,
  onCancel,
  openReport,
  registerSaveHandler,
  registerVersionHistoryHandler,
}: {
  client: any;
  isNew: boolean;
  onSave?: (c: any) => void;
  onCancel?: () => void;
  openReport?: (sectionIndex?: number) => void;
  registerSaveHandler?: (fn: (() => void) | null) => void;
  registerVersionHistoryHandler?: (fn: (() => void) | null) => void;
}) {

  // ── Initial state ──────────────────────────────────────────────────────────
  const initClient: Client = client
    ? (client as Client)
    : defaultClient();

  const [data, setData] = useState<Client>(() => ({
    ...initClient,
    report: initClient.report ?? defaultReport(),
    assessmentChecklist: initClient.assessmentChecklist ?? defaultAssessmentChecklist(),
  }));

  const [isSaved, setIsSaved] = useState(!isNew);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] =
    useState<"idle" | "saving" | "saved" | "error">("idle");

  const [docs, setDocs] = useState<IngestedDoc[]>(() =>
    ((client as any)?.documents || []).map((d: any): IngestedDoc => ({
      fileName: d.fileName ?? d.file_name ?? "(unnamed)",
      path: d.path ?? d.id ?? "",
      method: d.method ?? "text",
      charCount:
        typeof d.charCount === "number"
          ? d.charCount
          : typeof d.char_count === "number"
            ? d.char_count
            : 0,
      ocrAvailable: d.ocrAvailable ?? false,
      text: d.text,
      ner: d.ner,
      sci: d.sci,
      structured: d.structured,
      canonical: d.canonical,
      error: d.error,
    }))
  );

  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [checklistExpanded, setChecklistExpanded] = useState(() =>
    isAppointmentToday(data.appointments ?? [])
  );

  // ── Derived aliases ────────────────────────────────────────────────────────
  const ident = data.identity;
  const admin = data.administrative;
  const inj = data.clinical.injury;
  const ref = data.administrative.referrer;
  const chk = data.assessmentChecklist ?? defaultAssessmentChecklist();
  const att = chk.attendees ?? {};

  // ── Computed display values ────────────────────────────────────────────────
  const displayAge = useMemo(
    () => (ident.dateOfBirth ? calcAge(ident.dateOfBirth) : ""),
    [ident.dateOfBirth]
  );
  const displayAgeAtInjury = useMemo(
    () =>
      ident.dateOfBirth && inj?.dateOfInjury
        ? calcAgeAtDate(ident.dateOfBirth, inj.dateOfInjury)
        : "",
    [ident.dateOfBirth, inj?.dateOfInjury]
  );
  const displayYearsSince = useMemo(
    () => (inj?.dateOfInjury ? calcYearsSince(inj.dateOfInjury) : ""),
    [inj?.dateOfInjury]
  );

  // ── Appointment helpers ────────────────────────────────────────────────────
  function apptToDisplay(appt: Appointment) {
    const d = new Date(appt.start);
    return {
      date: [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"),
      time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      isFuture: d.getTime() >= Date.now(),
    };
  }

  function updateAppointment(id: string, date: string, time: string) {
    if (!date) return;
    const effectiveTime = time || "09:00";
    const start = new Date(`${date}T${effectiveTime}:00`);
    if (isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + 60 * 60_000);
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) =>
        a.id === id ? { ...a, start: start.toISOString(), end: end.toISOString() } : a
      ),
    }));
    setIsDirty(true);
  }

  function addAppointment() {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(9);
    const end = new Date(now.getTime() + 60 * 60_000);
    const appt: Appointment = {
      id: crypto.randomUUID(),
      start: now.toISOString(),
      end: end.toISOString(),
      type: "assessment",
    };
    setData((prev) => ({ ...prev, appointments: [...prev.appointments, appt] }));
    setIsDirty(true);
  }

  function deleteAppointment(id: string) {
    setData((prev) => ({ ...prev, appointments: prev.appointments.filter((a) => a.id !== id) }));
    setIsDirty(true);
  }

  function setAppointmentDuration(id: string, mins: number) {
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) => {
        if (a.id !== id) return a;
        const end = new Date(new Date(a.start).getTime() + mins * 60_000);
        return { ...a, end: end.toISOString() };
      }),
    }));
    setIsDirty(true);
  }

  // ── Household helpers ──────────────────────────────────────────────────────
  const hr = data.householdRelationships ?? defaultHouseholdRelationships();

  function updateHousehold(patch: Partial<HouseholdRelationships>) {
    setData((prev) => ({
      ...prev,
      householdRelationships: {
        householdMembers: [],
        ...prev.householdRelationships,
        ...patch,
      },
    }));
    setIsDirty(true);
  }

  function addMember() {
    const newMember: HouseholdMember = {
      id: crypto.randomUUID(),
      relationshipToClaimant: "Other",
      livesWithClaimant: "Lives with claimant full-time",
      providesSupport: false,
    };
    updateHousehold({ householdMembers: [...hr.householdMembers, newMember] });
  }

  function updateMember(id: string, patch: Partial<HouseholdMember>) {
    updateHousehold({
      householdMembers: hr.householdMembers.map((m) =>
        m.id === id ? { ...m, ...patch } : m
      ),
    });
  }

  function deleteMember(id: string) {
    updateHousehold({ householdMembers: hr.householdMembers.filter((m) => m.id !== id) });
  }

  // ── Update helpers ─────────────────────────────────────────────────────────

  function updateIdentity(field: keyof typeof ident, value: unknown) {
    setData((prev) => ({
      ...prev,
      identity: { ...prev.identity, [field]: value },
    }));
    setIsDirty(true);
  }

  function updateAdministrative(field: keyof typeof admin, value: unknown) {
    setData((prev) => ({
      ...prev,
      administrative: { ...prev.administrative, [field]: value },
    }));
    setIsDirty(true);
  }

  function updateReferrer(field: string, value: unknown) {
    setData((prev) => ({
      ...prev,
      administrative: {
        ...prev.administrative,
        referrer: { ...prev.administrative.referrer, [field]: value },
      },
    }));
    setIsDirty(true);
  }

  function updateInjury(field: keyof InjuryData, value: unknown) {
    setData((prev) => ({
      ...prev,
      clinical: {
        injury: { ...(prev.clinical.injury ?? defaultInjury()), [field]: value } as InjuryData,
      },
    }));
    setIsDirty(true);
  }

  function updateChecklist(field: string, value: unknown) {
    setData((prev) => ({
      ...prev,
      assessmentChecklist: {
        ...(prev.assessmentChecklist ?? defaultAssessmentChecklist()),
        [field]: value,
      },
    }));
    setIsDirty(true);
  }

  function updateAttendees(field: string, value: unknown) {
    setData((prev) => ({
      ...prev,
      assessmentChecklist: {
        ...(prev.assessmentChecklist ?? defaultAssessmentChecklist()),
        attendees: {
          ...(prev.assessmentChecklist?.attendees ?? {}),
          [field]: value,
        },
      },
    }));
    setIsDirty(true);
  }

  // ── Projection hydration ───────────────────────────────────────────────────
  const [, setViewState] = useState<ClientViewModel | null>(null);

  function hydrateFromView(v: ClientViewModel) {
    setViewState(v);
    const parsed = parseClientBlob(v.id, v.demographics);
    setData((prev) => ({
      ...parsed,
      id: v.id,
      report: prev.report,
      assessmentChecklist: {
        ...defaultAssessmentChecklist(),
        ...parsed.assessmentChecklist,
        attendees: {
          ...defaultAttendees(),
          ...parsed.assessmentChecklist.attendees,
        },
      },
      appointments: parsed.appointments.length
        ? parsed.appointments
        : prev.appointments,
    }));
  }

  async function refetchView(id: string) {
    try {
      const v = await TauriAPI.getClientView(id);
      hydrateFromView(v);
    } catch (err) {
      console.warn("[client-home] getClientView failed:", err);
    }
    refreshHistory(id).catch(() => undefined);
  }

  useEffect(() => {
    if (!isTauri || !data.id) return;
    let cancelled = false;
    (async () => {
      try {
        const v = await TauriAPI.getClientView(data.id);
        if (!cancelled) hydrateFromView(v);
      } catch {
        /* not in projection yet */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Version History ────────────────────────────────────────────────────────
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<EventHistoryItem[]>([]);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [previewSnapshot, setPreviewSnapshot] =
    useState<ClientStateSnapshot | null>(null);
  const [restoring, setRestoring] = useState(false);

  async function refreshHistory(id: string) {
    if (!isTauri || !id) return;
    try {
      setHistoryItems(await TauriAPI.getClientEventHistory(id));
    } catch (err) {
      console.warn("[client-home] getClientEventHistory failed:", err);
    }
  }

  useEffect(() => {
    if (!isTauri || !data.id) return;
    refreshHistory(data.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id]);

  async function openPreview(version: number) {
    if (!isTauri || !data.id) return;
    try {
      const snap = await TauriAPI.getClientSnapshotAtVersion(data.id, version);
      setPreviewSnapshot(snap);
      setPreviewVersion(version);
    } catch (err) {
      alert(
        `Snapshot unavailable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  function closePreview() {
    setPreviewVersion(null);
    setPreviewSnapshot(null);
  }

  async function copyDemographicsFromPreview() {
    if (!isTauri || !data.id || previewVersion === null) return;
    setRestoring(true);
    try {
      await TauriAPI.restoreClientFieldFromVersion(
        data.id, previewVersion, "demographics"
      );
      await refetchView(data.id);
      closePreview();
    } catch (err) {
      alert(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestoring(false);
    }
  }

  async function restoreFullFromPreview() {
    if (!isTauri || !data.id || previewVersion === null) return;
    setRestoring(true);
    try {
      await TauriAPI.restoreClientFromVersion(data.id, previewVersion);
      await refetchView(data.id);
      closePreview();
    } catch (err) {
      alert(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestoring(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  function buildBlob(): Record<string, unknown> {
    const dob = data.identity.dateOfBirth;
    const doi = data.clinical.injury?.dateOfInjury ?? null;
    return {
      identity: data.identity,
      administrative: data.administrative,
      clinical: {
        injury: data.clinical.injury ? {
          ...data.clinical.injury,
          ageAtInjury:
            dob && doi ? calcAgeAtDate(dob, doi) : (data.clinical.injury.ageAtInjury ?? null),
          yearsSinceInjury: doi
            ? calcYearsSince(doi)
            : (data.clinical.injury.yearsSinceInjury ?? null),
        } : null,
      },
      appointments: data.appointments,
      householdRelationships: data.householdRelationships,
      assessmentChecklist: data.assessmentChecklist ?? defaultAssessmentChecklist(),
      report: data.report ?? defaultReport(),
    };
  }

  async function handleSave() {
    console.log("SAVE BUTTON CLICKED / handleSave entered");
    const blob = buildBlob();
    setSaveStatus("saving");

    if (!isTauri) {
      onSave?.(data);
      setData(data);
      setIsSaved(true);
      setIsDirty(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }

    try {
      let id = data.id;
      let exists = false;
      try {
        await TauriAPI.getClientView(id);
        exists = true;
      } catch {
        exists = false;
      }

      if (!exists) {
        id = await TauriAPI.createClient(blob);
      } else {
        await TauriAPI.updateClientDemographics(id, blob);
      }

      await refetchView(id);
      setIsSaved(true);
      onSave?.({ ...data, id, documents: docs });
      setIsDirty(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.error("[client-home] save failed:", err);
      setSaveStatus("error");
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const handleSaveRef = useRef<(() => void | Promise<void>) | null>(null);
  handleSaveRef.current = handleSave;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // ── TopBar bridges ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof registerSaveHandler !== "function") return;
    const trigger = () => {
      const el = document.activeElement;
      if (el instanceof HTMLElement) el.blur();
      setTimeout(() => handleSaveRef.current?.(), 0);
    };
    registerSaveHandler(trigger);
    return () => registerSaveHandler(null);
  }, [registerSaveHandler]);

  useEffect(() => {
    if (typeof registerVersionHistoryHandler !== "function") return;
    registerVersionHistoryHandler(() => setShowVersionHistory(true));
    return () => registerVersionHistoryHandler(null);
  }, [registerVersionHistoryHandler]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const el = document.activeElement;
        if (el instanceof HTMLElement) el.blur();
        setTimeout(() => handleSaveRef.current?.(), 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (previewVersion !== null) { closePreview(); return; }
      if (showVersionHistory) setShowVersionHistory(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewVersion, showVersionHistory]);

  // ── Auto-save (debounced 500ms) ────────────────────────────────────────────
  useEffect(() => {
    if (!isDirty || !isSaved || !isTauri) return;
    const timer = setTimeout(() => handleSaveRef.current?.(), 500);
    return () => clearTimeout(timer);
  }, [isDirty, isSaved, data]);

  useEffect(() => {
    return () => {
      if (isDirtyRef.current && isTauri) {
        const el = document.activeElement;
        if (el instanceof HTMLElement) el.blur();
        handleSaveRef.current?.();
      }
    };
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Document ingestion ─────────────────────────────────────────────────────
  function persistDocs(_updated: IngestedDoc[]) { /* projection is canonical */ }

  async function ingestPath(path: string, fileName: string) {
    try {
      const raw = await TauriAPI.extractFileContents(path);
      const meta = JSON.parse(raw) as {
        text: string; method: string; char_count: number; ocr_available: boolean;
      };
      const initial: IngestedDoc = {
        fileName, path, method: meta.method,
        charCount: meta.char_count, ocrAvailable: meta.ocr_available,
        text: meta.text,
      };
      setDocs((prev) => { const u = [...prev, initial]; persistDocs(u); return u; });

      if (data.id) {
        try {
          await TauriAPI.attachDocument(data.id, fileName, meta.method, meta.char_count);
          await refetchView(data.id);
        } catch (err) {
          console.warn("[client-home] attachDocument failed:", err);
        }
      }

      const [nerR, sciR, structR, canonR] = await Promise.allSettled([
        TauriAPI.runNer(meta.text),
        TauriAPI.extractNlpEntities(meta.text),
        TauriAPI.extractStructuredData(meta.text, fileName),
        TauriAPI.processDocument(meta.text, fileName),
      ]);

      function safe<T>(s: string): T | undefined {
        try { return JSON.parse(s) as T; } catch { return undefined; }
      }
      const ner = nerR.status === "fulfilled"
        ? safe(nerR.value) ?? { error: "Invalid NER JSON" }
        : { error: nerR.reason?.toString() ?? "NER failed" };
      const sci = sciR.status === "fulfilled"
        ? safe(sciR.value) ?? { error: "Invalid scispaCy JSON" }
        : { error: sciR.reason?.toString() ?? "scispaCy failed" };
      const structured = structR.status === "fulfilled" ? safe(structR.value) : undefined;
      const canonical = canonR.status === "fulfilled" ? safe(canonR.value) : undefined;

      setDocs((prev) => {
        const u = prev.map((d) =>
          d.path === path && d.fileName === fileName && !d.ner && !d.sci
            ? { ...d, ner, sci, structured, canonical }
            : d
        );
        persistDocs(u);
        return u;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDocs((prev) => {
        const u: IngestedDoc[] = [
          ...prev,
          { fileName, path, method: "error", charCount: 0, ocrAvailable: false, error: message },
        ];
        persistDocs(u);
        return u;
      });
    }
  }

  const ingestPathRef = useRef(ingestPath);
  ingestPathRef.current = ingestPath;

  useEffect(() => {
    if (!isSaved || !isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const off = await getCurrentWebview().onDragDropEvent(async (event) => {
          const payload = event.payload as
            | { type: "enter" | "over" }
            | { type: "drop"; paths: string[] }
            | { type: "leave" };
          if (payload.type === "enter" || payload.type === "over") {
            setDragOver(true); return;
          }
          if (payload.type === "leave") {
            setDragOver(false); return;
          }
          if (payload.type === "drop") {
            setDragOver(false);
            setIngesting(true);
            try {
              for (const p of payload.paths) {
                const fn = p.split(/[\\/]/).pop() || p;
                await ingestPathRef.current(p, fn);
              }
            } finally { setIngesting(false); }
          }
        });
        if (cancelled) off(); else unlisten = off;
      } catch (err) {
        console.error("[ingest] drag-drop subscribe failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isSaved]);

  function markChecklistComplete() {
    setData((prev) => ({
      ...prev,
      assessmentChecklist: {
        ...(prev.assessmentChecklist ?? defaultAssessmentChecklist()),
        completed: true,
        completedAt: new Date().toISOString(),
      },
    }));
    setIsDirty(true);
    setTimeout(() => handleSaveRef.current?.(), 0);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const sectionTabs = PIC_SCHEMA.sections.map((s, i) => ({ id: s.id, title: s.title, index: i }));

  return (
    <div className="bg-slate-100 min-h-full">

      {/* ── Tab bar (shown once saved) ── */}
      {isSaved && openReport && (
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
          <div className="px-4 flex items-center gap-3 h-10 border-b border-slate-100">
            <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-900 shrink-0">
              ← Home
            </button>
            <span className="text-sm font-semibold text-slate-700 shrink-0 truncate max-w-[200px]">
              {formatFullName(ident) || "Client"}
            </span>
            <SaveStatusIndicator status={saveStatus} dirty={isDirty} />
          </div>
          <div className="px-4 flex gap-0.5 items-end h-9">
            {/* Demographics tab — active */}
            <div className="px-3 h-8 flex items-center text-xs font-medium rounded-t border-t border-x bg-slate-100 border-slate-200 text-violet-700 select-none">
              Demographics
            </div>
            {sectionTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => openReport(tab.index)}
                className="px-3 h-8 text-xs font-medium rounded-t border-t border-x transition border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              >
                {tab.title}
              </button>
            ))}
          </div>
        </div>
      )}

    <div className={`${isSaved && openReport ? "pt-6" : "pt-8"} pb-8 px-6`}>
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header — shown when not using tab bar (new client or no openReport) */}
      {(!isSaved || !openReport) && (
        <div className="flex justify-between items-center">
          <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-900">
            ← Back
          </button>
          <span className="text-sm font-semibold text-slate-700">
            {formatFullName(ident) || "New Client"}
          </span>
          <SaveStatusIndicator status={saveStatus} dirty={isDirty} />
        </div>
      )}

      {/* ── IDENTITY ── */}
      <div className="card space-y-4">
        <h2 className="section-title">Demographics</h2>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="label">Title</label>
            <select className="input" value={ident.title || ""}
              onChange={(e) => updateIdentity("title", e.target.value || null)}>
              <option value="">—</option>
              {TITLE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {ident.title === "Other" && (
            <div>
              <label className="label">Title (specify)</label>
              <input className="input" value={ident.titleOther || ""}
                onChange={(e) => updateIdentity("titleOther", e.target.value || null)} />
            </div>
          )}
          <div className={ident.title === "Other" ? "" : "col-span-1"}>
            <label className="label">First Name</label>
            <input className="input" value={ident.firstName || ""}
              onChange={(e) => updateIdentity("firstName", e.target.value)} />
          </div>
          <div>
            <label className="label">Middle Name</label>
            <input className="input" value={ident.middleName || ""}
              onChange={(e) => updateIdentity("middleName", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Last Name</label>
            <input className="input" value={ident.lastName || ""}
              onChange={(e) => updateIdentity("lastName", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Gender</label>
            <select
              className="input"
              value={GENDER_PRESETS.includes(ident.gender ?? "") ? (ident.gender ?? "") : (ident.gender ? "Other" : "")}
              onChange={(e) => {
                if (e.target.value === "Other") updateIdentity("gender", "");
                else updateIdentity("gender", e.target.value || null);
              }}
            >
              <option value="">—</option>
              {GENDER_PRESETS.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value="Other">Other</option>
            </select>
            {!GENDER_PRESETS.includes(ident.gender ?? "") && (ident.gender !== null && ident.gender !== undefined) && (
              <input
                className="input mt-1"
                placeholder="Specify gender"
                value={ident.gender}
                onChange={(e) => updateIdentity("gender", e.target.value || null)}
              />
            )}
          </div>
          <div>
            <label className="label">Date of Birth</label>
            <input type="date" className="input" value={ident.dateOfBirth || ""}
              onChange={(e) => updateIdentity("dateOfBirth", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Age</label>
            <div className="input bg-slate-50 text-slate-600">
              {displayAge !== "" ? `${displayAge} yrs` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ── PERSONAL & OCCUPATIONAL ── */}
      <div className="card space-y-4">
        <h2 className="section-title">Personal &amp; Occupational</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Occupation</label>
            <input className="input" value={admin.occupation || ""}
              onChange={(e) => updateAdministrative("occupation", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Current Employer</label>
            <input className="input" value={admin.employer || ""}
              onChange={(e) => updateAdministrative("employer", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Hand Dominance</label>
            <select className="input" value={ident.handDominance || ""}
              onChange={(e) => updateIdentity("handDominance", e.target.value || null)}>
              <option value="">—</option>
              {HAND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {ident.handDominance === "other" && (
            <div>
              <label className="label">Hand Dominance (specify)</label>
              <input className="input" value={ident.handDominanceOther || ""}
                onChange={(e) => updateIdentity("handDominanceOther", e.target.value || null)} />
            </div>
          )}
        </div>
      </div>

      {/* ── INJURY DETAILS ── */}
      <div className="card space-y-4">
        <h2 className="section-title">Injury Details</h2>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Date of Injury</label>
            <input type="date" className="input" value={inj?.dateOfInjury || ""}
              onChange={(e) => updateInjury("dateOfInjury", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Age at Injury</label>
            <div className="input bg-slate-50 text-slate-600">
              {displayAgeAtInjury !== "" ? `${displayAgeAtInjury} yrs` : "—"}
            </div>
          </div>
          <div>
            <label className="label">Years Since Injury</label>
            <div className="input bg-slate-50 text-slate-600">
              {displayYearsSince !== "" ? `${displayYearsSince} yr${displayYearsSince !== 1 ? "s" : ""}` : "—"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Injury Type</label>
            <select className="input" value={inj?.injuryType || ""}
              onChange={(e) => updateInjury("injuryType", e.target.value || null)}>
              <option value="">—</option>
              {INJURY_TYPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {inj?.injuryType === "other" && (
            <div>
              <label className="label">Injury Type (specify)</label>
              <input className="input" value={inj?.injuryTypeOther || ""}
                onChange={(e) => updateInjury("injuryTypeOther", e.target.value || null)} />
            </div>
          )}
          <div>
            <label className="label">Employer at Time of Injury</label>
            <input className="input" value={inj?.employerAtInjury || ""}
              onChange={(e) => updateInjury("employerAtInjury", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Claim Number</label>
            <input className="input" value={inj?.claimNumber || ""}
              onChange={(e) => updateInjury("claimNumber", e.target.value || null)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Insurer Name</label>
            <input className="input" value={inj?.insurerName || ""}
              onChange={(e) => updateInjury("insurerName", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Insurer Reference</label>
            <input className="input" value={inj?.insurerReference || ""}
              onChange={(e) => updateInjury("insurerReference", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Insurer Contact</label>
            <input className="input" value={inj?.insurerContactPerson || ""}
              onChange={(e) => updateInjury("insurerContactPerson", e.target.value || null)} />
          </div>
        </div>
      </div>

      {/* ── REFERRER ── */}
      <div className="card space-y-4">
        <h2 className="section-title">Referrer</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Referrer Name</label>
            <input className="input" value={ref.name || ""}
              onChange={(e) => updateReferrer("name", e.target.value || null)} />
          </div>
          <div>
            <label className="label">Organisation</label>
            <input
              className="input"
              list="org-presets"
              value={ref.org || ""}
              placeholder="Select or type…"
              onChange={(e) => updateReferrer("org", e.target.value || null)}
            />
            <datalist id="org-presets">
              {ORG_PRESETS.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>
        </div>
      </div>

      {/* ── HOUSEHOLD & RELATIONSHIPS ── */}
      <div className="card space-y-4">
        <h2 className="section-title">Household &amp; Relationships</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Relationship at Time of Injury</label>
            <select className="input" value={hr.relationshipAtInjury ?? ""}
              onChange={(e) => updateHousehold({ relationshipAtInjury: (e.target.value as RelationshipStatus) || undefined })}>
              <option value="">—</option>
              {RELATIONSHIP_STATUS_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {hr.relationshipAtInjury === "Other" && (
              <input className="input mt-1" placeholder="Specify"
                value={hr.relationshipAtInjuryOther ?? ""}
                onChange={(e) => updateHousehold({ relationshipAtInjuryOther: e.target.value || undefined })} />
            )}
          </div>
          <div>
            <label className="label">Current Relationship Status</label>
            <select className="input" value={hr.currentRelationship ?? ""}
              onChange={(e) => updateHousehold({ currentRelationship: (e.target.value as RelationshipStatus) || undefined })}>
              <option value="">—</option>
              {RELATIONSHIP_STATUS_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {hr.currentRelationship === "Other" && (
              <input className="input mt-1" placeholder="Specify"
                value={hr.currentRelationshipOther ?? ""}
                onChange={(e) => updateHousehold({ currentRelationshipOther: e.target.value || undefined })} />
            )}
          </div>
        </div>

        {/* Partner block — shown when in a partnered relationship */}
        {(hr.currentRelationship === "Married" || hr.currentRelationship === "De facto") && (
          <div className="border border-slate-200 rounded-lg p-3 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Partner</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cohabitation</label>
                <select className="input" value={hr.partnerDetails?.cohabitationStatus ?? ""}
                  onChange={(e) => updateHousehold({
                    partnerDetails: {
                      exists: true, providesSupport: false,
                      ...hr.partnerDetails,
                      cohabitationStatus: (e.target.value as CohabitationStatus) || undefined,
                    },
                  })}>
                  <option value="">—</option>
                  {COHABITATION_STATUS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Years Together</label>
                <input type="number" min={0} className="input"
                  value={hr.partnerDetails?.yearsTogether ?? ""}
                  onChange={(e) => updateHousehold({
                    partnerDetails: {
                      exists: true, providesSupport: false,
                      ...hr.partnerDetails,
                      yearsTogether: e.target.value ? Number(e.target.value) : null,
                    },
                  })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-violet-600"
                checked={!!hr.partnerDetails?.providesSupport}
                onChange={(e) => updateHousehold({
                  partnerDetails: {
                    exists: true, providesSupport: false,
                    ...hr.partnerDetails,
                    providesSupport: e.target.checked,
                  },
                })} />
              Partner provides support
            </label>
            {hr.partnerDetails?.providesSupport && (
              <div className="pl-3 border-l-2 border-violet-300 space-y-2">
                <label className="label">Support types</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {HOUSEHOLD_SUPPORT_TYPE_OPTIONS.map((st) => {
                    const cur = hr.partnerDetails?.support?.supportType ?? [];
                    const isSel = cur.includes(st);
                    return (
                      <button key={st} type="button"
                        onClick={() => updateHousehold({
                          partnerDetails: {
                            exists: true, providesSupport: true,
                            ...hr.partnerDetails,
                            support: {
                              ...hr.partnerDetails?.support,
                              supportType: isSel ? cur.filter((x) => x !== st) : [...cur, st],
                            },
                          },
                        })}
                        className={`text-xs px-2.5 py-1 rounded-full border transition ${isSel ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"}`}>
                        {st}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Household members */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Household Members</h3>
            <button type="button" onClick={addMember}
              className="text-xs text-violet-600 hover:text-violet-800 font-medium">+ Add</button>
          </div>
          {hr.householdMembers.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No members added.</p>
          ) : (
            <div className="space-y-3">
              {hr.householdMembers.map((m) => (
                <div key={m.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select className="input text-xs flex-1" value={m.relationshipToClaimant}
                      onChange={(e) => updateMember(m.id, { relationshipToClaimant: e.target.value as RelationshipType })}>
                      {RELATIONSHIP_TYPE_GROUPS.map((g) => (
                        <optgroup key={g.group} label={g.group}>
                          {g.types.map((t) => <option key={t} value={t}>{t}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <button type="button" onClick={() => deleteMember(m.id)}
                      className="text-slate-400 hover:text-red-500 px-1 text-base leading-none shrink-0">×</button>
                  </div>
                  {m.relationshipToClaimant === "Other" && (
                    <input className="input text-xs" placeholder="Specify relationship"
                      value={m.relationshipOther ?? ""}
                      onChange={(e) => updateMember(m.id, { relationshipOther: e.target.value || undefined })} />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label">Age</label>
                      <input type="number" min={0} className="input text-xs"
                        value={m.age ?? ""}
                        onChange={(e) => updateMember(m.id, { age: e.target.value ? Number(e.target.value) : null })} />
                    </div>
                    <div>
                      <label className="label">Living arrangement</label>
                      <select className="input text-xs" value={m.livesWithClaimant}
                        onChange={(e) => updateMember(m.id, { livesWithClaimant: e.target.value as LivingArrangement })}>
                        {LIVING_ARRANGEMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" className="w-3.5 h-3.5 accent-violet-600"
                      checked={m.providesSupport}
                      onChange={(e) => updateMember(m.id, { providesSupport: e.target.checked })} />
                    Provides support to claimant
                  </label>
                  {m.providesSupport && (
                    <div className="pl-3 border-l-2 border-violet-300 space-y-1">
                      <label className="label">Support types</label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {HOUSEHOLD_SUPPORT_TYPE_OPTIONS.map((st) => {
                          const cur = m.support?.supportType ?? [];
                          const isSel = cur.includes(st);
                          return (
                            <button key={st} type="button"
                              onClick={() => updateMember(m.id, {
                                support: {
                                  ...m.support,
                                  supportType: isSel ? cur.filter((x) => x !== st) : [...cur, st],
                                },
                              })}
                              className={`text-xs px-2.5 py-1 rounded-full border transition ${isSel ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-300 hover:border-violet-400"}`}>
                              {st}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── APPOINTMENTS ── */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0">Appointments</h2>
          <button type="button" onClick={addAppointment}
            className="text-xs text-violet-600 hover:text-violet-800 font-medium">
            + Add
          </button>
        </div>
        {data.appointments.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No appointments yet.</p>
        ) : (
          <div className="space-y-2">
            {[...data.appointments]
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
              .map((appt) => {
                const { date, time, isFuture } = apptToDisplay(appt);
                return (
                  <div key={appt.id}
                    className={`flex items-center gap-2 p-2 rounded border ${
                      isFuture ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-slate-50"
                    }`}>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                      isFuture ? "bg-violet-200 text-violet-700" : "bg-slate-200 text-slate-500"
                    }`}>
                      {isFuture ? "Upcoming" : "Past"}
                    </span>
                    <input type="date" className="input text-xs py-1 flex-1"
                      value={date}
                      onChange={(e) => updateAppointment(appt.id, e.target.value, time)} />
                    <TimeSelect value={time}
                      onChange={(t) => updateAppointment(appt.id, date, t)} />
                    <select
                      className="input text-xs py-1 shrink-0"
                      value={DURATION_MINS.includes(apptDurationMins(appt)) ? apptDurationMins(appt) : 60}
                      onChange={(e) => setAppointmentDuration(appt.id, Number(e.target.value))}
                    >
                      {DURATION_MINS.map((m) => (
                        <option key={m} value={m}>{durationLabel(m)}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => deleteAppointment(appt.id)}
                      className="text-slate-400 hover:text-red-500 px-1 shrink-0 text-base leading-none">
                      ×
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* ── ASSESSMENT CHECKLIST ── */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="section-title mb-0">Assessment Checklist</h2>
            {chk.completed && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                Complete
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setChecklistExpanded((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-800 transition"
          >
            {checklistExpanded ? "Collapse ▲" : "Expand ▼"}
          </button>
        </div>

        {checklistExpanded && (
          <div className="space-y-5 pt-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Assessment Modality</label>
                <input className="input" value={chk.modality || ""}
                  placeholder="e.g. Videoconference, In-person"
                  onChange={(e) => updateChecklist("modality", e.target.value)} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" className="w-4 h-4 accent-violet-600"
                    checked={!!chk.modalityConfirmed}
                    onChange={(e) => updateChecklist("modalityConfirmed", e.target.checked)} />
                  Modality confirmed with referrer
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Consent Given</label>
                <select className="input"
                  value={chk.consentGiven === null ? "" : chk.consentGiven ? "yes" : "no"}
                  onChange={(e) =>
                    updateChecklist(
                      "consentGiven",
                      e.target.value === "" ? null : e.target.value === "yes"
                    )
                  }>
                  <option value="">— Not recorded —</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" className="w-4 h-4 accent-violet-600"
                    checked={!!chk.purposeExplained}
                    onChange={(e) => updateChecklist("purposeExplained", e.target.checked)} />
                  Purpose of assessment explained
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Technical Issues</label>
                <select className="input" value={chk.technicalIssues || "none"}
                  onChange={(e) => updateChecklist("technicalIssues", e.target.value)}>
                  {TECHNICAL_ISSUES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              {chk.technicalIssues && chk.technicalIssues !== "none" && (
                <div>
                  <label className="label">Technical Notes</label>
                  <input className="input" value={chk.technicalNotes || ""}
                    onChange={(e) => updateChecklist("technicalNotes", e.target.value)} />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Attendees</h3>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input type="checkbox" className="w-4 h-4 accent-violet-600"
                  checked={!!att.attendedAlone}
                  onChange={(e) => updateAttendees("attendedAlone", e.target.checked)} />
                Attended alone
              </label>
              {!att.attendedAlone && (
                <div>
                  <label className="label">Support Person</label>
                  <input className="input" value={att.supportPerson || ""}
                    onChange={(e) => updateAttendees("supportPerson", e.target.value)} />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input type="checkbox" className="w-4 h-4 accent-violet-600"
                  checked={!!att.interpreterPresent}
                  onChange={(e) => updateAttendees("interpreterPresent", e.target.checked)} />
                Interpreter present
              </label>
              {att.interpreterPresent && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Interpreter Name</label>
                    <input className="input" value={att.interpreterName || ""}
                      onChange={(e) => updateAttendees("interpreterName", e.target.value)} />
                  </div>
                  <div>
                    <label className="label">NAATI Number</label>
                    <input className="input" value={att.interpreterNaati || ""}
                      onChange={(e) => updateAttendees("interpreterNaati", e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Language</label>
                    <input className="input" value={att.interpreterLanguage || ""}
                      onChange={(e) => updateAttendees("interpreterLanguage", e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {!chk.completed ? (
              <button
                type="button"
                onClick={markChecklistComplete}
                className="btn-primary"
              >
                Mark Assessment Complete
              </button>
            ) : (
              <p className="text-xs text-emerald-600">
                Completed{" "}
                {chk.completedAt ? formatTimestamp(chk.completedAt) : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── ACTIONS ── */}
      <div className="card flex flex-wrap gap-3 items-center">
        {!isSaved ? (
          <>
            <button onClick={handleSave} className="btn-primary">
              Create Client
            </button>
            <button onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={handleSave} className="btn-primary">
              Save
            </button>
            {openReport && (
              <button onClick={openReport} className="btn-secondary">
                Report Builder
              </button>
            )}
            {isTauri && historyItems.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowVersionHistory(true)}
              >
                Version History
              </button>
            )}
            {!chk.completed && isAppointmentToday(data.appointments ?? []) && (
              <span className="text-xs text-amber-600 font-medium ml-auto">
                Assessment checklist incomplete
              </span>
            )}
          </>
        )}
      </div>

      {/* ── FILE DROP ── */}
      {isSaved && (
        <div className="card space-y-3">
          <div
            className={`border-dashed border-2 rounded-xl text-center py-10 transition
              ${dragOver
                ? "border-violet-500 bg-violet-50 text-violet-700"
                : "border-slate-300 text-slate-500"}`}
          >
            <div className="text-sm">
              {ingesting
                ? "Ingesting…"
                : isTauri
                  ? "Drag & Drop Files Here"
                  : "Drag & drop requires the Tauri runtime"}
            </div>
          </div>

          {docs.length > 0 && (
            <div className="space-y-3">
              <h3 className="section-title">Documents</h3>
              {docs.map((d, i) => (
                <DocumentCard
                  key={`${d.path}-${i}`}
                  doc={d}
                  onRemove={() => {
                    setDocs((prev) => {
                      const u = prev.filter((_, idx) => idx !== i);
                      persistDocs(u);
                      return u;
                    });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

    </div>
    </div>

    {/* ── VERSION HISTORY MODAL ── */}
    {showVersionHistory && (
      <div
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            closePreview();
            setShowVersionHistory(false);
          }
        }}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-3">
              {previewVersion !== null && (
                <button type="button" onClick={closePreview}
                  className="text-slate-400 hover:text-slate-700 transition" title="Back">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <h2 className="text-base font-semibold text-slate-900">
                {previewVersion !== null
                  ? `Version Preview — v${previewVersion}`
                  : "Version History"}
              </h2>
            </div>
            <button type="button"
              onClick={() => { closePreview(); setShowVersionHistory(false); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              title="Close (Esc)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {previewVersion === null ? (
              <div className="p-6">
                {historyItems.length === 0 ? (
                  <p className="text-sm text-slate-500">No events recorded yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {[...historyItems].reverse().map((it) => (
                      <li key={it.version}>
                        <button type="button" onClick={() => openPreview(it.version)}
                          className="w-full text-left px-3 py-2.5 rounded-xl border border-transparent hover:bg-slate-50 hover:border-slate-200 transition group">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-700">v{it.version}</span>
                              <span className="text-xs text-slate-600">
                                {prettyEventType(it.event_type)}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {formatTimestamp(it.timestamp)}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {previewSnapshot ? (() => {
                  const parsed = parseClientBlob(
                    previewSnapshot.client_id ?? data.id,
                    previewSnapshot.demographics
                  );
                  const d = parsed.identity;
                  const inj2 = parsed.clinical.injury;
                  const r2 = parsed.administrative.referrer;
                  return (
                    <>
                      <PreviewSection title="Demographics" rows={[
                        ["Title", d.title === "Other" ? d.titleOther : d.title],
                        ["First Name", d.firstName],
                        ["Middle Name", d.middleName],
                        ["Last Name", d.lastName],
                        ["Gender", d.gender],
                        ["Date of Birth", d.dateOfBirth],
                        ["Hand Dominance", d.handDominance],
                      ]} />
                      <PreviewSection title="Personal & Occupational" rows={[
                        ["Occupation", parsed.administrative.occupation],
                        ["Employer", parsed.administrative.employer],
                      ]} />
                      <PreviewSection title="Injury Details" rows={[
                        ["Date of Injury", inj2?.dateOfInjury],
                        ["Injury Type", inj2?.injuryType === "other" ? inj2?.injuryTypeOther : inj2?.injuryType],
                        ["Claim Number", inj2?.claimNumber],
                        ["Insurer", inj2?.insurerName],
                        ["Insurer Ref", inj2?.insurerReference],
                      ]} />
                      <PreviewSection title="Referrer" rows={[
                        ["Name", r2.name],
                        ["Organisation", r2.org],
                      ]} />
                    </>
                  );
                })() : (
                  <p className="text-sm text-slate-500">Loading…</p>
                )}
              </div>
            )}
          </div>

          {previewVersion !== null && previewSnapshot && (
            <div className="px-6 py-4 border-t border-slate-200 shrink-0 flex gap-3 flex-wrap">
              <button className="btn-secondary" onClick={copyDemographicsFromPreview}
                disabled={restoring}>
                Copy Demographics
              </button>
              <button className="btn-primary" onClick={restoreFullFromPreview}
                disabled={restoring}
                title="Append restore event — history preserved">
                Restore Full Version
              </button>
              {restoring && (
                <span className="text-xs text-slate-500 self-center">Restoring…</span>
              )}
            </div>
          )}
        </div>
      </div>
    )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function TimeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [hh = "", mm = ""] = (value || "").split(":");
  const safeHH = HOURS_24.includes(hh) ? hh : "";
  const safeMM = MINUTES_5.includes(mm) ? mm : "";

  return (
    <div className="flex gap-1 items-center">
      <select
        className="input"
        value={safeHH}
        onChange={(e) => onChange(`${e.target.value}:${safeMM || "00"}`)}
      >
        <option value="">HH</option>
        {HOURS_24.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-slate-400 font-semibold select-none">:</span>
      <select
        className="input"
        value={safeMM}
        onChange={(e) => onChange(`${safeHH || "00"}:${e.target.value}`)}
      >
        <option value="">MM</option>
        {MINUTES_5.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}

function SaveStatusIndicator({
  status,
  dirty,
}: {
  status: "idle" | "saving" | "saved" | "error";
  dirty: boolean;
}) {
  if (status === "saving") return <span className="text-xs text-slate-500">Saving…</span>;
  if (status === "saved") return <span className="text-xs text-emerald-600">Saved</span>;
  if (status === "error") return <span className="text-xs text-red-600">Error saving</span>;
  if (dirty) return <span className="text-xs text-amber-600">Unsaved changes</span>;
  return null;
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
    case "client_created": return "Client created";
    case "demographics_updated": return "Demographics updated";
    case "document_uploaded": return "Document uploaded";
    case "client_restored_from_version": return "Restored from earlier version";
    default: return t;
  }
}

function PreviewSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, unknown]>;
}) {
  const filled = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (filled.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {filled.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-900">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
