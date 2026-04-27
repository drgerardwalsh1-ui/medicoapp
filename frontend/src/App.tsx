import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  PIC_SCHEMA,
  MOTOR_SCHEMA,
  HPL_OVERLAY,
  MEDILAW_OVERLAY,
  applyOverlay,
  evaluateSchema
} from "./schemas/reportSchema";
import { Field } from "./renderers/renderField";
import { buildPIRSNarrative } from "./engine/pirsEngine";
import { exportReportToDocx } from "./engine/exportDocx";
import PIRSTable from "./components/PIRSTable";
import {
  TauriAPI,
  isTauri,
  type ClientStateSnapshot,
  type EventHistoryItem,
} from "./api/tauriApi";
import {
  mergeBlob,
  defaultReportData,
  type PreviousAssessorPIRS,
} from "./types/client";
import type { PIRSTableModel } from "./types/types";

// ── Types ──────────────────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

function generateId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

export default function App({ client, goHome, onSave }: {
  client: any;
  goHome: () => void;
  onSave?: (updated: any) => void;
}) {
  const initReport = client?.report ?? defaultReportData();

  const [report, setReport]   = useState<Record<string, any>>(initReport.fields ?? {});
  const [pirsTables, setPirsTables] = useState<PIRSTableModel[]>(
    (initReport.pirsTables ?? []).map((t: any) => ({ ...t, id: t.id ?? generateId() }))
  );
  const [previousAssessorPirs, setPreviousAssessorPirs] = useState<PreviousAssessorPIRS[]>(
    initReport.previousAssessorPirs ?? []
  );

  const [baseSchema,         setBaseSchema]         = useState(PIC_SCHEMA);
  const [overlay,            setOverlay]            = useState<any>(null);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [saveStatus,         setSaveStatus]         = useState<SaveStatus>("idle");
  const [isDirty,            setIsDirty]            = useState(false);

  // ── Sorted PIRS for display ───────────────────────────────────────────────

  const displayPirsTables = useMemo(() => sortedPirsTables(pirsTables), [pirsTables]);

  // ── Schema evaluation ─────────────────────────────────────────────────────

  const schema = useMemo(() => {
    let merged = baseSchema;
    if (overlay) merged = applyOverlay(baseSchema, overlay);
    return evaluateSchema(merged, report);
  }, [baseSchema, overlay, report]);

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

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);

  const handleSave = useCallback(async () => {
    if (!client?.id) return;
    setSaveStatus("saving");
    const blob = {
      // Demographics flat at top level
      ...client.demographics,
      injury:       client.injury,
      referrer:     client.referrer,
      appointments: client.appointments ?? [],
      assessmentChecklist: client.assessmentChecklist,
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
      onSave?.({ ...client, report: blob.report });
      setSaveStatus("saved");
      setIsDirty(false);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.error("[report-builder] save failed:", err);
      setSaveStatus("error");
    }
  }, [client, report, pirsTables, previousAssessorPirs, onSave]);

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

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex bg-slate-100">

      {/* LEFT SIDEBAR */}
      <div className="w-64 bg-white border-r p-4 flex flex-col gap-3">
        <h1 className="text-lg font-semibold text-slate-900">Report Builder</h1>

        <div className="space-y-2">
          <button className="btn-secondary w-full" onClick={() => setBaseSchema(PIC_SCHEMA)}>PIC</button>
          <button className="btn-secondary w-full" onClick={() => setBaseSchema(MOTOR_SCHEMA)}>MOTOR</button>
        </div>

        <div className="pt-2 border-t space-y-2">
          <button className="btn-secondary w-full" onClick={() => setOverlay(HPL_OVERLAY)}>HPL Overlay</button>
          <button className="btn-secondary w-full" onClick={() => setOverlay(MEDILAW_OVERLAY)}>Medilaw Overlay</button>
          <button className="btn-secondary w-full" onClick={() => setOverlay(null)}>Clear Overlay</button>
        </div>

        <div className="pt-2 border-t space-y-2">
          <button
            className="btn-secondary w-full"
            onClick={() => setHistoryOpen(true)}
            disabled={!isTauri || !client?.id}
          >
            Version History
          </button>
        </div>

        <div className="mt-auto space-y-2">
          <button
            className="btn-primary w-full"
            onClick={() => handleSaveRef.current?.()}
            disabled={saveStatus === "saving"}
          >
            {saveStatus === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            className="btn-secondary w-full"
            onClick={() => exportReportToDocx(client, schema.title)}
          >
            Export DOCX
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* HEADER */}
          <div className="flex justify-between items-center">
            <button onClick={goHome} className="text-sm text-slate-500 hover:text-slate-900">
              ← Back
            </button>
            <div className="flex items-center gap-4">
              <SaveIndicator status={saveStatus} dirty={isDirty} />
              <span className="text-sm text-slate-500">{client?.name}</span>
              <button
                onClick={() => handleSaveRef.current?.()}
                disabled={saveStatus === "saving"}
                className="btn-primary text-xs py-1 px-3"
              >
                Save
              </button>
            </div>
          </div>

          {/* TITLE + TABS */}
          <div className="card">
            <h2 className="text-2xl font-semibold mb-4">{schema.title}</h2>
            <div className="flex flex-wrap gap-2">
              {schema.sections.map((section: any, index: number) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSectionIndex(index)}
                  className={`px-3 py-1 rounded-lg text-sm transition ${
                    index === activeSectionIndex
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 hover:bg-slate-200"
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </div>
          </div>

          {/* CONTENT CARD */}
          <div className="card space-y-4">

            {/* Normal section */}
            {activeSection && activeSection.id !== "pirs" && (
              <div className="space-y-4">
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

            {/* PIRS section */}
            {activeSection?.id === "pirs" && (
              <div className="space-y-6">

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    className="btn-primary"
                    disabled={pirsTables.some((t) => t.name === "Current PIRS")}
                    onClick={() => addPIRSTable("Current PIRS")}
                  >
                    + Current
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={pirsTables.some((t) => t.name === "Pre-injury PIRS")}
                    onClick={() => addPIRSTable("Pre-injury PIRS")}
                  >
                    + Pre-injury
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => addPIRSTable("Previous Assessor PIRS")}
                  >
                    + Previous Assessor
                  </button>
                </div>

                {/* Current + Pre-injury PIRS (sorted) */}
                <div className="space-y-4">
                  {displayPirsTables.map((t) => (
                    <div key={t.id} className="card card-hover">
                      <PIRSTable
                        table={t}
                        update={(updated) => updatePirsTable(t.id, { ...updated, id: t.id })}
                      />
                    </div>
                  ))}
                </div>

                {/* Previous Assessor PIRS (sorted by date ascending) */}
                {previousAssessorPirs.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-700 border-t pt-3">
                      Previous Assessor PIRS
                    </h3>
                    {[...previousAssessorPirs]
                      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
                      .map((entry) => (
                        <div key={entry.id} className="card card-hover space-y-3">
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="label">Date</label>
                              <input
                                type="date"
                                className="input"
                                value={entry.date}
                                onChange={(e) =>
                                  updatePrevAssessor(entry.id, { ...entry, date: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label className="label">Author</label>
                              <input
                                className="input"
                                value={entry.author}
                                onChange={(e) =>
                                  updatePrevAssessor(entry.id, { ...entry, author: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label className="label">Role</label>
                              <input
                                className="input"
                                value={entry.authorRole}
                                onChange={(e) =>
                                  updatePrevAssessor(entry.id, { ...entry, authorRole: e.target.value })
                                }
                              />
                            </div>
                          </div>
                          <PIRSTable
                            table={entry.table}
                            update={(updated) =>
                              updatePrevAssessor(entry.id, { ...entry, table: { ...updated, id: entry.table.id } })
                            }
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
      </div>

      {/* RIGHT PANEL — narrative */}
      <div className="w-80 bg-white border-l p-4 flex flex-col">
        <h3 className="font-semibold mb-2 text-slate-900">PIRS Narrative</h3>
        <div className="text-sm whitespace-pre-wrap text-slate-600 overflow-y-auto">
          {buildPIRSNarrative({ pirsTables: allTablesForNarrative })}
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
                Version History — {client?.name || "(no client)"}
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
              const blob = mergeBlob(previewSnapshot.demographics);
              const d = blob.demographics;
              const inj = blob.injury;
              const r = blob.referrer;
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
                      {row("Occupation", d.occupation)}
                      {row("Employer", d.employer)}
                    </dl>
                  </section>
                  <section className="space-y-2">
                    <h3 className="section-title">Injury</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {row("Date of Injury", inj.dateOfInjury)}
                      {row("Injury Type", inj.injuryType === "other" ? inj.injuryTypeOther : inj.injuryType)}
                      {row("Claim Number", inj.claimNumber)}
                      {row("Insurer", inj.insurerName)}
                      {row("Insurer Ref", inj.insurerReference)}
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
