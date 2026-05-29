import { useState, useMemo, useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  TauriAPI,
  isTauri,
  type ClientViewModel,
} from "../api/tauriApi";
import DocumentCard, { type IngestedDoc } from "../components/DocumentCard";
import AttendeesPanel from "../components/AttendeesPanel";
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
  ASSESSMENT_MODALITY_OPTIONS,
  calcAge,
  calcAgeAtDate,
  calcYearsSince,
  type Client,
  type Appointment,
  type InjuryData,
} from "../types/client";
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

// Body-only Demographics page. All upper chrome (back, identity, save,
// version history, tabs) lives in TopBar/ClientLayout — this component
// renders ONLY the form cards (spec Part 13, Part 22). Replaces the previous
// frontend/src/pages/ClientHome.tsx, which conflated body and chrome.

const TITLE_OPTIONS = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Other"];
const GENDER_PRESETS = ["Male", "Female", "Non-binary", "Prefer not to say"];
const DURATION_MINS = DURATION_MINUTE_OPTIONS;

function durationLabel(m: number): string {
  return tsDurationLabel(m);
}
function apptDurationMins(appt: Appointment): number {
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

export type DemographicsPageProps = {
  client: Client | null;
  isNew: boolean;
  onClientChange: (updated: Client) => void;
  onCreate?: () => Promise<void> | void;
  onCancel?: () => void;
};

export default function DemographicsPage({
  client,
  isNew,
  onClientChange,
  onCreate,
  onCancel,
}: DemographicsPageProps) {

  // Subscribe to viewer-tz so timezone-derived display values refresh when
  // the system tz changes mid-session (spec Part 6).
  useViewerTimeZone();

  // ── Local mirror of `client` — initialized once, only updated by user edits.
  // The `key={activeClient.id}` in the parent forces remount when the active
  // client switches, so this effectively re-initializes from props at the
  // right moments.
  const initial: Client = client ?? defaultClient();
  const [data, setData] = useState<Client>(() => ({
    ...initial,
    report: initial.report ?? defaultReport(),
    assessmentChecklist: initial.assessmentChecklist ?? defaultAssessmentChecklist(),
    relationships: initial.relationships?.length
      ? initial.relationships
      : isNew ? defaultRelationships() : [],
  }));

  const [docs, setDocs] = useState<IngestedDoc[]>(() => {
    // Documents on the client are server-canonical (sourced from the
    // ClientViewModel projection) and may use snake_case field names from
    // older blobs. We accept both shapes defensively.
    type LooseDoc = Partial<IngestedDoc> & {
      file_name?: string;
      id?: string;
      char_count?: number;
    };
    const raw = ((client as unknown as { documents?: LooseDoc[] } | null)?.documents ?? []);
    return raw.map((d): IngestedDoc => ({
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
    }));
  });

  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [checklistExpanded, setChecklistExpanded] = useState(() =>
    isAppointmentToday(data.appointments ?? [])
  );

  // ── Aliases ────────────────────────────────────────────────────────────────
  const ident = data.identity;
  const admin = data.administrative;
  const inj = data.clinical.injury;
  const ref = data.administrative.referrer;
  const chk = data.assessmentChecklist ?? defaultAssessmentChecklist();
  const att = chk.attendees ?? defaultAttendees();

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

  // ── Bubble local edits up to main.tsx -------------------------------------
  // Spec Part 17: every per-tab body propagates changes through the same
  // controlled-component contract so the activeClient is always coherent.
  // Skip the very first effect run (would echo the initial mirror).
  //
  // Race fix: workTimeline can be mutated from OUTSIDE this page (the
  // global TimerBar appends/closes events while the user is typing here).
  // Local `data` doesn't auto-sync from the `client` prop, so a naive
  // `onClientChange(data)` would clobber any timer-added events on the
  // next keystroke. We always re-read workTimeline from the prop when
  // propagating — the timer is the source of truth for that field, never
  // this page's local mirror.
  const skipFirstPropagate = useRef(true);
  useEffect(() => {
    if (skipFirstPropagate.current) {
      skipFirstPropagate.current = false;
      return;
    }
    onClientChange({
      ...data,
      workTimeline: client?.workTimeline ?? data.workTimeline,
    });
  }, [data]);

  // ── Appointment helpers ────────────────────────────────────────────────────
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
  }

  function updateAppointmentTimeZone(id: string, tzId: string) {
    if (!isValidTimeZone(tzId)) return;
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) =>
        a.id === id ? { ...a, appointmentTimeZone: tzId } : a
      ),
    }));
  }

  function addAppointment() {
    const tz = getViewerTimeZone();
    const today = formatDateISO(TimeService.nowUtcIso(), tz);
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
  }

  function deleteAppointment(id: string) {
    setData((prev) => ({ ...prev, appointments: prev.appointments.filter((a) => a.id !== id) }));
  }

  function setAppointmentDuration(id: string, mins: number) {
    setData((prev) => ({
      ...prev,
      appointments: prev.appointments.map((a) => {
        if (a.id !== id) return a;
        const newEndUtc = endUtcFromDuration(a.startUtc, mins);
        return { ...a, endUtc: newEndUtc };
      }),
    }));
  }

  // ── Update helpers ─────────────────────────────────────────────────────────
  function updateIdentity(field: keyof typeof ident, value: unknown) {
    setData((prev) => ({ ...prev, identity: { ...prev.identity, [field]: value } }));
  }
  function updateAdministrative(field: keyof typeof admin, value: unknown) {
    setData((prev) => ({ ...prev, administrative: { ...prev.administrative, [field]: value } }));
  }
  function updateReferrer(field: string, value: unknown) {
    setData((prev) => ({
      ...prev,
      administrative: { ...prev.administrative, referrer: { ...prev.administrative.referrer, [field]: value } },
    }));
  }
  function updateInjury(field: keyof InjuryData, value: unknown) {
    setData((prev) => ({
      ...prev,
      clinical: { injury: { ...(prev.clinical.injury ?? defaultInjury()), [field]: value } as InjuryData },
    }));
  }
  function updateChecklist(field: string, value: unknown) {
    setData((prev) => ({
      ...prev,
      assessmentChecklist: { ...(prev.assessmentChecklist ?? defaultAssessmentChecklist()), [field]: value },
    }));
  }
  function setAttendees(next: import("../types/client").AssessmentAttendees) {
    setData((prev) => ({
      ...prev,
      assessmentChecklist: {
        ...(prev.assessmentChecklist ?? defaultAssessmentChecklist()),
        attendees: next,
      },
    }));
  }

  function markChecklistComplete() {
    setData((prev) => ({
      ...prev,
      assessmentChecklist: {
        ...(prev.assessmentChecklist ?? defaultAssessmentChecklist()),
        completed: true,
        completedAt: new Date().toISOString(),
      },
    }));
  }

  // ── Hydrate from projection on mount (saved clients only) ─────────────────
  function hydrateFromView(v: ClientViewModel) {
    const parsed = parseClientBlob(v.id, v.demographics);
    setData((prev) => ({
      ...parsed,
      id: v.id,
      report: prev.report,
      dsmAssessment: prev.dsmAssessment ?? parsed.dsmAssessment,
      assessmentChecklist: {
        ...defaultAssessmentChecklist(),
        ...parsed.assessmentChecklist,
        attendees: { ...defaultAttendees(), ...parsed.assessmentChecklist.attendees },
      },
      appointments: parsed.appointments.length ? parsed.appointments : prev.appointments,
      // Preserve any timer events recorded against this client since the
      // last server projection — never clobber chronology with stale data.
      workTimeline: prev.workTimeline ?? parsed.workTimeline ?? [],
    }));
  }

  async function refetchView(id: string) {
    try {
      const v = await TauriAPI.getClientView(id);
      hydrateFromView(v);
    } catch (err) {
      console.warn("[demographics] getClientView failed:", err);
    }
  }

  useEffect(() => {
    if (!isTauri || !data.id || isNew) return;
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
          console.warn("[demographics] attachDocument failed:", err);
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
    if (isNew || !isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const off = await getCurrentWebview().onDragDropEvent(async (event) => {
          const payload = event.payload as
            | { type: "enter" | "over" }
            | { type: "drop"; paths: string[] }
            | { type: "leave" };
          if (payload.type === "enter" || payload.type === "over") { setDragOver(true); return; }
          if (payload.type === "leave") { setDragOver(false); return; }
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
  }, [isNew]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-slate-100 min-h-full">
    <div className="pt-6 pb-8 px-6">
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ── IDENTITY ── */}
      <div className="card space-y-4">
        <h2 className="section-title">Demographics</h2>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="label">Title</label>
            <select className="input" value={ident.title || ""}
              onChange={(e) => updateIdentity("title", e.target.value || null)}>
              <option value="">—</option>
              {TITLE_OPTIONS.map((t) => (<option key={t} value={t}>{t}</option>))}
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
              {HAND_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
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
              {INJURY_TYPES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
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
                const durIsPreset = (DURATION_MINS as readonly number[]).includes(actualDur);
                return (
                  <div key={appt.id}
                    className={`p-2 rounded border space-y-1.5 ${
                      isFuture ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-slate-50"
                    }`}>
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
                        <TimeSelect value={time} onChange={(t) => updateAppointmentStart(appt.id, date, t)} />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-slate-400 shrink-0">End</span>
                        <TimeSelect value={endTime} onChange={(t) => updateAppointmentEnd(appt.id, date, t)} />
                      </div>
                    </div>
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
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
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
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {ASSESSMENT_MODALITY_OPTIONS.map((o) => {
                    const active = chk.modality === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => updateChecklist("modality", active ? "" : o.value)}
                        className={[
                          "px-2.5 py-1 rounded-full text-xs font-medium border transition select-none",
                          active
                            ? "bg-violet-600 border-violet-600 text-white"
                            : "bg-white border-slate-300 text-slate-600 hover:border-violet-400 hover:text-violet-700",
                        ].join(" ")}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
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
                  {TECHNICAL_ISSUES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
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

            <AttendeesPanel
              attendees={att}
              onChange={setAttendees}
              variant="demographics"
            />

            {!chk.completed ? (
              <button type="button" onClick={markChecklistComplete} className="btn-primary">
                Mark Assessment Complete
              </button>
            ) : (
              <p className="text-xs text-emerald-600">
                Completed{" "}
                {chk.completedAt ? tsFormatTimestamp(chk.completedAt) : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── ACTIONS ── (only the "Create / Cancel" controls for new clients;
          existing clients save through the centralized TopBar Save button) */}
      {isNew ? (
        <div className="card flex flex-wrap gap-3 items-center">
          <button onClick={() => onCreate?.()} className="btn-primary">
            Create Client
          </button>
          {onCancel && (
            <button onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
          )}
        </div>
      ) : (
        !chk.completed && isAppointmentToday(data.appointments ?? []) && (
          <div className="card text-xs text-amber-600 font-medium">
            Assessment checklist incomplete
          </div>
        )
      )}

      {/* ── FILE DROP ── */}
      {!isNew && (
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
    </div>
  );
}

// Suppress unused-import lint without breaking the public formatter signature.
void formatFullName;

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
  // Minutes derived from a timer / duration calculation are not constrained
  // to 5-minute increments. Display whatever the appointment actually holds
  // by injecting the real minute value as a selectable option — otherwise
  // an off-grid value (e.g. ":47") falls through to the "MM" placeholder.
  const isValidMinute = /^[0-5]\d$/.test(mm);
  const safeMM = isValidMinute ? mm : "";
  const minuteOptions =
    isValidMinute && !MINUTES_5.includes(mm)
      ? [...MINUTES_5, mm].sort((a, b) => Number(a) - Number(b))
      : MINUTES_5;

  return (
    <div className="flex gap-1 items-center">
      <select className="input" value={safeHH}
        onChange={(e) => onChange(`${e.target.value}:${safeMM || "00"}`)}>
        <option value="">HH</option>
        {HOURS_24.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-slate-400 font-semibold select-none">:</span>
      <select className="input" value={safeMM}
        onChange={(e) => onChange(`${safeHH || "00"}:${e.target.value}`)}>
        <option value="">MM</option>
        {minuteOptions.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}
