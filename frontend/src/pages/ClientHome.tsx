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
import DocumentCard, {
  type IngestedDoc,
  toIngestedDocs,
  canonicalFromExtraction,
  type DocumentExtractionInput,
} from "../components/DocumentCard";
import DSMAssessment from "../components/DSMAssessment";
import type { DSMAssessmentData } from "../types/dsm";
import RelationshipManager, {
  type Relationship,
  defaultRelationships,
} from "../components/RelationshipManager";
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
  isPersistedClientId,
  type Client,
  type Appointment,
  type InjuryData,
} from "../types/client";
import { validateClientName } from "../types/clientValidation";
import {
  TimeService,
  TIMEZONE_OPTIONS,
  isValidTimeZone,
  durationMinutes,
  durationLabel as tsDurationLabel,
  endUtcFromDuration,
  formatTime24,
  formatDateISO,
  formatTimestamp as tsFormatTimestamp,
  getViewerTimeZone,
  useViewerTimeZone,
  isFutureInstant,
  compareInstants,
  DURATION_MINUTE_OPTIONS,
} from "../time";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TITLE_OPTIONS = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Other"];
const GENDER_PRESETS = ["Male", "Female", "Non-binary", "Prefer not to say"];
const DURATION_MINS = DURATION_MINUTE_OPTIONS;
function durationLabel(m: number): string {
  return tsDurationLabel(m);
}
function apptDurationMins(appt: Appointment): number {
  // Spec Part 8: duration is ALWAYS derived from end - start.
  return durationMinutes(appt.startUtc, appt.endUtc);
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

  // Subscribe to viewer-tz so timezone-derived display values refresh when
  // the system tz changes mid-session (spec Part 6).
  useViewerTimeZone();

  // ── Initial state ──────────────────────────────────────────────────────────
  const initClient: Client = client
    ? (client as Client)
    : defaultClient();

  const [data, setData] = useState<Client>(() => ({
    ...initClient,
    report: initClient.report ?? defaultReport(),
    assessmentChecklist: initClient.assessmentChecklist ?? defaultAssessmentChecklist(),
    relationships: initClient.relationships?.length
      ? initClient.relationships
      : isNew ? defaultRelationships() : [],
  }));

  const [isSaved, setIsSaved] = useState(!isNew);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] =
    useState<"idle" | "saving" | "saved" | "error">("idle");

  // First-paint value from the projection-sourced document list (carried
  // on the client object by `viewToClient`). The authoritative
  // rehydration on navigation / client switch is the `useEffect([client.id])`
  // below — this initializer just avoids an empty flash on first render.
  const [docs, setDocs] = useState<IngestedDoc[]>(() =>
    toIngestedDocs(client.documents),
  );

  // STEP 3/4 FIX: rehydrate the document list from the projection-sourced
  // `client.documents` on every client switch AND on remount (returning
  // from another page). Keyed on `client.id` so it fires exactly when the
  // identity changes — NOT on unrelated re-renders, so an in-session
  // upload (same id, no remount) is never clobbered. This is the single
  // projection-driven source of truth for the document list; the UI no
  // longer depends on transient ingestion-response state surviving
  // navigation.
  useEffect(() => {
    setDocs(toIngestedDocs(client.documents));

    // Then rehydrate persisted EXTRACTION content (clinical events +
    // attribution) from the projection via the dedicated read command.
    // This is what makes clinical content survive navigation — the UI no
    // longer depends on the `processPathAndPersist` response staying in
    // memory. Read-only; no reprocessing.
    if (!isPersistedClientId(client.id)) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await TauriAPI.getClientExtraction(client.id);
        const ext = JSON.parse(raw) as DocumentExtractionInput[];
        if (cancelled || ext.length === 0) return;
        const byId = new Map(ext.map((e) => [e.document_id, e]));
        setDocs((prev) =>
          prev.map((d) => {
            if (d.canonical) return d;
            const e = byId.get(d.path);
            return e ? { ...d, canonical: canonicalFromExtraction(e) } : d;
          }),
        );
      } catch (err) {
        console.warn("[client-home] getClientExtraction failed:", err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [checklistExpanded, setChecklistExpanded] = useState(() =>
    isAppointmentToday(data.appointments ?? [])
  );

  // "demographics" = default view; "dsm" = DSM-5-TR assessment engine
  const [clientHomeView, setClientHomeView] = useState<"demographics" | "dsm">("demographics");

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
  // Spec Parts 6 & 9: appointment-time fields shown in their *appointment*
  // timezone (the authoritative scheduling tz), not the viewer's. The
  // calendar — by contrast — positions in viewer-tz (handled in calendar/).
  // Spec Part 5: every appointment has a timezone; it is never floating.
  function apptToDisplay(appt: Appointment) {
    const tz = appt.appointmentTimeZone || getViewerTimeZone();
    return {
      date: formatDateISO(appt.startUtc, tz),
      time: formatTime24(appt.startUtc, tz),
      endTime: formatTime24(appt.endUtc, tz),
      timeZone: tz,
      isFuture: isFutureInstant(appt.startUtc),
    };
  }

  // Spec Parts 7 + 10: time edits go through TimeService so DST gaps reject
  // explicitly and the appointment-tz remains authoritative.
  function rebuildStartUtc(plainDate: string, time: string, tz: string): string | null {
    const [hh, mm] = time.split(":").map((s) => parseInt(s, 10));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    try {
      return TimeService.wallClockToUtcIso({
        plainDate,
        hour: hh,
        minute: mm,
        timeZone: tz,
        disambiguation: "reject",
      });
    } catch (err) {
      console.warn("[appointment] rejected ambiguous/non-existent time:", err);
      alert(
        "That time does not exist or is ambiguous in the chosen timezone (DST transition). Pick a different time."
      );
      return null;
    }
  }

  function updateAppointmentStart(id: string, date: string, time: string) {
    if (!date) return;
    const appt = data.appointments.find((a) => a.id === id);
    if (!appt) return;
    const tz = appt.appointmentTimeZone || getViewerTimeZone();
    const effectiveTime = time || "09:00";
    const newStartUtc = rebuildStartUtc(date, effectiveTime, tz);
    if (newStartUtc === null) return;
    // Spec Part 8: changing start preserves duration → end shifts by same delta.
    const dur = durationMinutes(appt.startUtc, appt.endUtc);
    const newEndUtc = endUtcFromDuration(newStartUtc, Math.max(dur, 0));
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) =>
        a.id === id
          ? { ...a, startUtc: newStartUtc, endUtc: newEndUtc }
          : a
      ),
    }));
    setIsDirty(true);
  }

  function updateAppointmentEnd(id: string, date: string, endTime: string) {
    if (!date || !endTime) return;
    const appt = data.appointments.find((a) => a.id === id);
    if (!appt) return;
    const tz = appt.appointmentTimeZone || getViewerTimeZone();
    const newEndUtc = rebuildStartUtc(date, endTime, tz);
    if (newEndUtc === null) return;
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) =>
        a.id === id ? { ...a, endUtc: newEndUtc } : a
      ),
    }));
    setIsDirty(true);
  }

  function updateAppointmentTimeZone(id: string, tzId: string) {
    if (!isValidTimeZone(tzId)) return;
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) =>
        a.id === id ? { ...a, appointmentTimeZone: tzId } : a
      ),
    }));
    setIsDirty(true);
  }

  function addAppointment() {
    const tz = getViewerTimeZone();
    const today = formatDateISO(TimeService.nowUtcIso(), tz);
    // Default new appointment to 09:00 in viewer-tz on today's wall-clock date.
    let startUtc: string;
    try {
      startUtc = TimeService.wallClockToUtcIso({
        plainDate: today,
        hour: 9,
        minute: 0,
        timeZone: tz,
        disambiguation: "compatible",
      });
    } catch {
      startUtc = TimeService.nowUtcIso();
    }
    const endUtc = endUtcFromDuration(startUtc, 60);
    const appt: Appointment = {
      id: crypto.randomUUID(),
      type: "assessment",
      startUtc,
      endUtc,
      appointmentTimeZone: tz,
    };
    setData((prev) => ({ ...prev, appointments: [...prev.appointments, appt] }));
    setIsDirty(true);
  }

  function deleteAppointment(id: string) {
    setData((prev) => ({ ...prev, appointments: prev.appointments.filter((a) => a.id !== id) }));
    setIsDirty(true);
  }

  // Spec Part 8: changing the duration dropdown updates END only.
  function setAppointmentDuration(id: string, mins: number) {
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) => {
        if (a.id !== id) return a;
        const newEndUtc = endUtcFromDuration(a.startUtc, mins);
        return { ...a, endUtc: newEndUtc };
      }),
    }));
    setIsDirty(true);
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

    // Rehydrate the uploaded-documents list from the projection. THE FIX:
    // the `docs` useState initializer reads `client.documents` exactly
    // once on mount, but `viewToClient` → `parseClientBlob(demographics)`
    // strips documents from the Client object, so on every navigation
    // back the initializer yields []. The projection `documents` table is
    // the source of truth for the document list; map it into `docs` here
    // (this runs on mount and on every refetchView).
    //
    // NOTE: the projection's DocumentSummary carries only metadata
    // (file_name / method / char_count). The richer in-session extraction
    // payloads (text / ner / sci / structured / canonical) are NOT in this
    // view, so rehydrated cards show the header + metadata; their
    // extraction sub-views populate when the document is re-opened. We
    // therefore PRESERVE any in-session docs (which already carry those
    // payloads) and only append projection docs not already shown.
    setDocs((prev) => {
      const viewDocs = toIngestedDocs(v.documents);
      if (prev.length === 0) return viewDocs;
      const have = new Set(prev.map((d) => d.fileName));
      const missing = viewDocs.filter((d) => !have.has(d.fileName));
      return missing.length ? [...prev, ...missing] : prev;
    });

    const parsed = parseClientBlob(v.id, v.demographics);
    setData((prev) => ({
      ...parsed,
      id: v.id,
      report: prev.report,
      // Preserve in-memory DSM state — it may be ahead of the server projection
      // because DSM changes are written to Tauri only on explicit Save.
      dsmAssessment: prev.dsmAssessment ?? parsed.dsmAssessment,
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
      relationships: data.relationships ?? [],
      householdRelationships: data.householdRelationships,
      dsmAssessment: data.dsmAssessment,
      assessmentChecklist: data.assessmentChecklist ?? defaultAssessmentChecklist(),
      report: data.report ?? defaultReport(),
    };
  }

  async function handleSave() {
    // Guard: prevent concurrent / duplicate saves
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    console.log("SAVE BUTTON CLICKED / handleSave entered");

    // STRICT: no "Unnamed Client". Name validation runs BEFORE the
    // blob is built so a draft can't slip through with empty identity.
    // Single-character names are allowed (see clientValidation.ts).
    const nameCheck = validateClientName({
      firstName: data.identity?.firstName,
      lastName: data.identity?.lastName,
    });
    if (!nameCheck.ok) {
      isSavingRef.current = false;
      setSaveStatus("error");
      alert(nameCheck.message);
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }

    const blob = buildBlob();
    setSaveStatus("saving");

    try {
      if (!isTauri) {
        // Synchronously mark clean BEFORE calling onSave so the unmount
        // cleanup (which runs when view switches) sees isDirty = false.
        isDirtyRef.current = false;
        setIsDirty(false);
        setIsSaved(true);
        setSaveStatus("saved");
        onSave?.(data);
        setTimeout(() => setSaveStatus("idle"), 2000);
        return;
      }

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
      // Synchronously mark clean BEFORE calling onSave so the unmount
      // cleanup (which fires when view switches to "client") sees isDirty = false.
      isDirtyRef.current = false;
      setIsDirty(false);
      setSaveStatus("saved");
      onSave?.({ ...data, id, documents: docs });
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.error("[client-home] save failed:", err);
      setSaveStatus("error");
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isSavingRef.current = false;
    }
  }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const handleSaveRef = useRef<(() => void | Promise<void>) | null>(null);
  handleSaveRef.current = handleSave;
  const isDirtyRef   = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const isSavingRef  = useRef(false);

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
      // Only flush on unmount if dirty AND not already in the middle of a save.
      // (isSavingRef prevents the double-write caused by view switching during save.)
      if (isDirtyRef.current && isTauri && !isSavingRef.current) {
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
      function safe<T>(s: string): T | undefined {
        try { return JSON.parse(s) as T; } catch { return undefined; }
      }

      // ── STRICT DB-BACKED INGESTION GATE ────────────────────────────────
      // The projection `clients` table is the SINGLE SOURCE OF TRUTH for
      // whether a client may receive uploads. We do NOT consult the
      // `isSaved` UI flag (which can desync from the DB on refresh /
      // navigation). Cheap local pre-check first (rejects the draft
      // sentinel / empty id), then the authoritative async existence
      // check against the backend.
      if (!isPersistedClientId(data.id)) {
        alert("Please save the client before uploading documents.");
        return;
      }
      let clientExists = false;
      try {
        clientExists = await TauriAPI.clientExists(data.id);
      } catch (err) {
        console.warn("[client-home] clientExists check failed:", err);
        clientExists = false;
      }
      if (!clientExists) {
        alert("Please save the client before uploading documents.");
        return;
      }

      // ── Persistence-boundary ingestion (canonical production path) ─────
      // The backend reads the raw file bytes, hashes them for chain-of-
      // custody, extracts text, runs the rule pipeline, and emits
      // DocumentExtracted + ClinicalEventsRecorded events.
      const canonRaw = await TauriAPI.processPathAndPersist({
        clientId: data.id,
        path,
        fileName,
      });
      const canonical = safe<Record<string, unknown>>(canonRaw);
      if (!canonical) {
        throw new Error("processPathAndPersist returned invalid JSON");
      }
      const text = (canonical.raw_text as string) ?? "";
      // `method` is now returned by process_path_and_persist. Do NOT fall
      // back to document_type — that masked the missing field by
      // displaying "report"/"imaging" as the extraction method.
      const method = (canonical.method as string) ?? "text";
      const cleanText = (canonical.clean_text as string) ?? "";
      const charCount = cleanText.length || text.length;
      const ocrAvailable = true;

      const initial: IngestedDoc = {
        fileName, path, method, charCount, ocrAvailable, text,
      };
      setDocs((prev) => { const u = [...prev, initial]; persistDocs(u); return u; });

      try {
        await refetchView(data.id);
      } catch (err) {
        console.warn("[client-home] refetchView failed:", err);
      }

      // NER / scispaCy / structured dev-mode views run in parallel as
      // before — they are independent of the persistence boundary.
      const [nerR, sciR, structR] = await Promise.allSettled([
        TauriAPI.runNer(text),
        TauriAPI.extractNlpEntities(text),
        TauriAPI.extractStructuredData(text, fileName),
      ]);

      const ner = nerR.status === "fulfilled"
        ? safe(nerR.value) ?? { error: "Invalid NER JSON" }
        : { error: nerR.reason?.toString() ?? "NER failed" };
      const sci = sciR.status === "fulfilled"
        ? safe(sciR.value) ?? { error: "Invalid scispaCy JSON" }
        : { error: sciR.reason?.toString() ?? "scispaCy failed" };
      const structured = structR.status === "fulfilled" ? safe(structR.value) : undefined;

      setDocs((prev) => {
        const u = prev.map((d) =>
          d.path === path && d.fileName === fileName && !d.ner && !d.sci
            ? { ...d, ner, sci, structured, canonical }
            : d
        );
        persistDocs(u);
        return u;
      });

      // ── Persistence-boundary attribution ───────────────────────────────
      // After each upload completes through the boundary path, resolve
      // participants/organisations/patient identities across ALL of the
      // client's canonical documents so the AttributionRecorded and
      // ExtractionRunRecorded events stay in sync. Best-effort; failures
      // here do not regress the upload itself.
      {
        try {
          const allCanonical: unknown[] = [];
          for (const d of docs) {
            if (d.canonical) allCanonical.push(d.canonical);
          }
          allCanonical.push(canonical);
          const runId =
            (canonical.run_id as string)
            ?? (typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `run-${Date.now()}`);
          await TauriAPI.persistAttributionForRun({
            clientId: data.id,
            runId,
            documents: allCanonical,
          });
        } catch (err) {
          console.warn("[client-home] persistAttributionForRun failed:", err);
        }
      }
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

      {/* ── Tab bar (shown once saved) — matches App.tsx header layout ── */}
      {isSaved && openReport && (
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
          {/* Row 1 — compact identity + actions */}
          <div className="px-4 flex items-center gap-3 h-10 border-b border-slate-100">
            <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-900 shrink-0">
              ← Home
            </button>
            <span className="text-sm font-semibold text-slate-700 shrink-0 truncate max-w-[200px]">
              {formatFullName(ident) || "Client"}
            </span>
            <SaveStatusIndicator status={saveStatus} dirty={isDirty} />
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {isTauri && historyItems.length > 0 && (
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700"
                  onClick={() => setShowVersionHistory(true)}
                >
                  Version History
                </button>
              )}
              <button
                className="text-xs px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
                onClick={() => handleSaveRef.current?.()}
                disabled={saveStatus === "saving"}
              >
                {saveStatus === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {/* Row 2 — section tab pills */}
          <div className="px-4 flex gap-0.5 items-end h-9">
            <button
              onClick={() => setClientHomeView("demographics")}
              className={`px-3 h-8 text-xs font-medium rounded-t border-t border-x transition ${
                clientHomeView === "demographics"
                  ? "bg-slate-100 border-slate-200 text-violet-700 select-none"
                  : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              Demographics
            </button>
            <button
              onClick={() => setClientHomeView("dsm")}
              className={`px-3 h-8 text-xs font-medium rounded-t border-t border-x transition ${
                clientHomeView === "dsm"
                  ? "bg-slate-100 border-slate-200 text-violet-700 select-none"
                  : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              DSM Assessment
            </button>
            {sectionTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setClientHomeView("demographics"); openReport(tab.index); }}
                className="px-3 h-8 text-xs font-medium rounded-t border-t border-x transition border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              >
                {tab.title}
              </button>
            ))}
          </div>
        </div>
      )}

    {/* DSM Assessment — full-height three-column layout */}
    {clientHomeView === "dsm" && isSaved && (
      <div className="flex flex-col" style={{ height: "calc(100vh - 79px)" }}>
        <DSMAssessment
          data={data.dsmAssessment}
          onChange={(dsmData: DSMAssessmentData) => {
            setData((prev) => {
              const updated = { ...prev, dsmAssessment: dsmData };
              // Propagate immediately so activeClient in main.tsx stays fresh —
              // this survives view switches to App.tsx and back without a Save.
              onSave?.(updated);
              return updated;
            });
            setIsDirty(true);
          }}
        />
      </div>
    )}

    <div className={`${clientHomeView === "dsm" && isSaved ? "hidden" : ""} ${isSaved && openReport ? "pt-6" : "pt-8"} pb-8 px-6`}>
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
        <RelationshipManager
          value={data.relationships ?? []}
          onChange={(rels: Relationship[]) => {
            setData((prev) => ({ ...prev, relationships: rels }));
            setIsDirty(true);
          }}
        />
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
              .sort((a, b) => compareInstants(a.startUtc, b.startUtc))
              .map((appt) => {
                const { date, time, endTime, timeZone, isFuture } = apptToDisplay(appt);
                const actualDur = apptDurationMins(appt);
                // Spec Part 8: surface the actual duration even if it isn't
                // one of the preset multiples — never silently coerce to 60.
                const durIsPreset = (DURATION_MINS as readonly number[]).includes(actualDur);
                return (
                  <div key={appt.id}
                    className={`p-2 rounded border space-y-1.5 ${
                      isFuture ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-slate-50"
                    }`}>
                    {/* Row 1: badge + date + start time + end time */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                        isFuture ? "bg-violet-200 text-violet-700" : "bg-slate-200 text-slate-500"
                      }`}>
                        {isFuture ? "Upcoming" : "Past"}
                      </span>
                      <input type="date" className="input text-xs py-1"
                        value={date}
                        onChange={(e) => updateAppointmentStart(appt.id, e.target.value, time)} />
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-slate-400 shrink-0">Start</span>
                        <TimeSelect value={time}
                          onChange={(t) => updateAppointmentStart(appt.id, date, t)} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-slate-400 shrink-0">End</span>
                        <TimeSelect value={endTime}
                          onChange={(t) => updateAppointmentEnd(appt.id, date, t)} />
                      </div>
                    </div>
                    {/* Row 2: timezone + duration (derived) + delete */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-400 shrink-0">TZ</span>
                      <select
                        className="input text-xs py-0.5 shrink-0"
                        style={{ maxWidth: 200 }}
                        value={timeZone}
                        onChange={(e) => updateAppointmentTimeZone(appt.id, e.target.value)}
                      >
                        {!TIMEZONE_OPTIONS.some((o) => o.id === timeZone) && (
                          <option value={timeZone}>{timeZone}</option>
                        )}
                        {TIMEZONE_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] text-slate-400 shrink-0">Duration</span>
                      <select
                        className="input text-xs py-0.5 shrink-0"
                        style={{ maxWidth: 120 }}
                        value={durIsPreset ? actualDur : "__custom__"}
                        onChange={(e) => {
                          if (e.target.value === "__custom__") return;
                          setAppointmentDuration(appt.id, Number(e.target.value));
                        }}
                      >
                        {!durIsPreset && (
                          <option value="__custom__">{durationLabel(actualDur)}</option>
                        )}
                        {DURATION_MINS.map((m) => (
                          <option key={m} value={m}>{durationLabel(m)}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => deleteAppointment(appt.id)}
                        className="text-slate-400 hover:text-red-500 px-1 shrink-0 text-base leading-none ml-auto">
                        ×
                      </button>
                    </div>
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
  // Spec Part 1: route every formatter through TimeService.
  return tsFormatTimestamp(iso);
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
