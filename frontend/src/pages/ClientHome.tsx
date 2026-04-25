import { useState, useMemo, useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { TauriAPI, isTauri, type ClientViewModel } from "../api/tauriApi";
import DocumentCard, { type IngestedDoc } from "../components/DocumentCard";

function calcAge(dob: string) {
  if (!dob) return "";
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function buildClientName(d: any) {
  const first = d?.forename || "";
  const last = d?.surname || "";
  return `${first} ${last}`.trim() || "Unnamed Client";
}

export default function ClientHome({
  client,
  isNew,
  onSave,
  onCancel,
  openReport,
  mode
}: any) {

  const [data, setData] = useState<any>(() => ({
    id: client?.id || Date.now().toString(),
    name: client?.name || "",
    demographics: client?.demographics || {},
    referrer: client?.referrer || {},
    appointment: client?.appointment || {}
  }));
  const [isSaved, setIsSaved] = useState(!isNew);
  const [docs, setDocs] = useState<IngestedDoc[]>(client?.documents || []);
  const [ingesting, setIngesting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const d = data.demographics || {};
  const r = data.referrer || {};
  const a = data.appointment || {};

  function update(section: string, field: string, value: any) {
    setData((prev: any) => ({
      ...prev,
      [section]: {
        ...(prev[section] || {}),
        [field]: value
      }
    }));
  }

  const age = useMemo(() => calcAge(d.dob), [d.dob]);

  // ── Step 5 — projection-driven hydration ────────────────────────────────
  // The projection in `projection.db` is the single source of truth for
  // demographics. While typing, transient local state in `data` holds the
  // in-progress form; on Save we persist via Tauri commands and then
  // re-fetch `getClientView` to overwrite local state with the projection's
  // canonical answer.
  const [view, setView] = useState<ClientViewModel | null>(null);

  function hydrateFromView(v: ClientViewModel) {
    setView(v);
    const blob = (v.demographics ?? {}) as any;
    // Prefer top-level fields if the projection surfaces them, then fall
    // back to the nested-blob shape (`{demographics, referrer, appointment}`)
    // that the existing UI persists. Either way we land on plain `{}` so
    // the form inputs always have a defined object to read from.
    setData((prev: any) => ({
      ...prev,
      id: v.id,
      name: v.name ?? prev.name,
      demographics: blob.demographics ?? blob ?? {},
      referrer: (v as any).referrer ?? blob.referrer ?? {},
      appointment: (v as any).appointment ?? blob.appointment ?? {},
    }));
  }

  // Debug-only reference so `view` isn't flagged as unused while still
  // being available for future read paths (e.g. Report Builder hydration).
  if (typeof window !== "undefined" && (window as any).__DEV_PROJECTION__) {
    // eslint-disable-next-line no-console
    console.debug("[client-home] last view", view);
  }

  async function refetchView(id: string) {
    try {
      const v = await TauriAPI.getClientView(id);
      hydrateFromView(v);
    } catch (err) {
      console.warn("[client-home] getClientView failed:", err);
    }
  }

  // Initial load: if Tauri is available and the parent supplied an id that
  // already exists in the projection, hydrate from it. Misses are silent —
  // the user must Save to materialise the projection record.
  useEffect(() => {
    if (!isTauri || !data.id) return;
    let cancelled = false;
    (async () => {
      try {
        const v = await TauriAPI.getClientView(data.id);
        if (!cancelled) hydrateFromView(v);
      } catch {
        /* not in projection yet — first Save will create it */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildDemographicsBlob() {
    return {
      demographics: data.demographics,
      referrer: data.referrer,
      appointment: data.appointment,
    };
  }

  async function handleSave() {
    const blob = buildDemographicsBlob();
    const computedName = buildClientName(data.demographics);

    if (!isTauri) {
      // Browser fallback: parent owns persistence.
      const updated = { ...data, name: computedName, documents: docs };
      onSave?.(updated);
      setData(updated);
      setIsSaved(true);
      return;
    }

    try {
      let id = data.id as string;
      // Determine whether the projection already knows this client.
      let exists = false;
      try {
        await TauriAPI.getClientView(id);
        exists = true;
      } catch {
        exists = false;
      }

      if (!exists) {
        id = await TauriAPI.createClient(computedName, blob);
        // createClient seeds demographics; no follow-up update needed.
      } else {
        await TauriAPI.updateClientDemographics(id, blob);
      }

      await refetchView(id);
      setIsSaved(true);
      // Notify the parent so its in-memory list reflects the canonical id.
      onSave?.({ ...data, id, name: computedName, documents: docs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[client-home] save failed:", err);
      alert(`Save failed: ${msg}`);
    }
  }

  // Document-list local mirror is only used to render the rich NER /
  // scispaCy chips in `DocumentCard`. The projection holds the canonical
  // metadata (id, file_name, method, char_count); see `view?.documents`.
  function persistDocs(_updated: IngestedDoc[]) {
    // Intentionally a no-op for projection-driven mode: docs live in the
    // projection. Local state is purely ephemeral display memory.
  }

  async function ingestPath(path: string, fileName: string) {
    console.log(`[ingest] start: ${fileName} (${path})`);
    try {
      const raw = await TauriAPI.extractFileContents(path);
      const meta = JSON.parse(raw) as {
        text: string;
        method: string;
        char_count: number;
        ocr_available: boolean;
      };
      console.log(
        `[ingest] extracted ${meta.char_count} chars via ${meta.method}`
      );

      // Push initial card (text + method) so the user sees feedback immediately.
      const initial: IngestedDoc = {
        fileName,
        path,
        method: meta.method,
        charCount: meta.char_count,
        ocrAvailable: meta.ocr_available,
        text: meta.text
      };
      setDocs((prev) => {
        const updated = [...prev, initial];
        persistDocs(updated);
        return updated;
      });

      // Step 5 — register this document against the projection so
      // ClientViewModel.documents reflects it. Rich NER / scispaCy data
      // remains in local state for the existing chip display; the
      // projection only stores the basic metadata.
      if (data.id) {
        try {
          await TauriAPI.attachDocument(
            data.id,
            fileName,
            meta.method,
            meta.char_count
          );
          await refetchView(data.id);
        } catch (err) {
          console.warn("[client-home] attachDocument failed:", err);
        }
      }

      // Fan-out: NER + scispaCy + structured + canonical in parallel.
      const [nerR, sciR, structR, canonR] = await Promise.allSettled([
        TauriAPI.runNer(meta.text),
        TauriAPI.extractNlpEntities(meta.text),
        TauriAPI.extractStructuredData(meta.text, fileName),
        TauriAPI.processDocument(meta.text, fileName)
      ]);

      function safeParse<T = unknown>(s: string): T | undefined {
        try { return JSON.parse(s) as T; } catch { return undefined; }
      }

      const ner =
        nerR.status === "fulfilled"
          ? safeParse(nerR.value) ?? { error: "Invalid NER JSON" }
          : { error: nerR.reason?.toString() ?? "NER failed" };

      const sci =
        sciR.status === "fulfilled"
          ? safeParse(sciR.value) ?? { error: "Invalid scispaCy JSON" }
          : { error: sciR.reason?.toString() ?? "scispaCy failed" };

      const structured =
        structR.status === "fulfilled" ? safeParse(structR.value) : undefined;

      const canonical =
        canonR.status === "fulfilled" ? safeParse(canonR.value) : undefined;

      console.log(
        `[ingest] ${fileName} → NER:${nerR.status} sci:${sciR.status} struct:${structR.status} canon:${canonR.status}`
      );

      setDocs((prev) => {
        const updated = prev.map((d) =>
          d.path === path && d.fileName === fileName && !d.ner && !d.sci
            ? { ...d, ner, sci, structured, canonical }
            : d
        );
        persistDocs(updated);
        return updated;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ingest] failed for ${fileName}:`, err);
      setDocs((prev) => {
        const updated: IngestedDoc[] = [
          ...prev,
          {
            fileName,
            path,
            method: "error",
            charCount: 0,
            ocrAvailable: false,
            error: message
          }
        ];
        persistDocs(updated);
        return updated;
      });
    }
  }

  // Tauri v2 intercepts drops at the webview layer (dragDropEnabled: true),
  // so the browser-level onDrop never fires with a real path. Subscribe to
  // the Tauri webview drag-drop event instead — it delivers absolute paths.
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
            setDragOver(true);
            return;
          }
          if (payload.type === "leave") {
            setDragOver(false);
            return;
          }
          if (payload.type === "drop") {
            setDragOver(false);
            setIngesting(true);
            try {
              for (const p of payload.paths) {
                const fileName = p.split(/[\\/]/).pop() || p;
                await ingestPathRef.current(p, fileName);
              }
            } finally {
              setIngesting(false);
            }
          }
        });
        if (cancelled) off();
        else unlisten = off;
      } catch (err) {
        console.error("[ingest] failed to subscribe to webview drag-drop:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isSaved]);

  return (
  <div className="min-h-screen bg-slate-100 py-10 px-6">
    <div className="max-w-3xl mx-auto space-y-6">

      {/* HEADER */}
      <div className="flex justify-between items-center">
        <button
          onClick={onCancel}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← Back
        </button>

        <div className="text-xs font-medium px-3 py-1 rounded-full bg-slate-200 text-slate-700">
          Mode: {mode?.toUpperCase?.() || "TEST"}
        </div>
      </div>

      {/* TITLE */}
      <div className="card">
        <h1 className="text-2xl font-semibold text-slate-900">
          {buildClientName(data.demographics)}
        </h1>
      </div>

      {/* ================= DEMOGRAPHICS ================= */}
      <div className="card space-y-4">
        <h2 className="section-title">Demographics</h2>

        <div className="grid grid-cols-2 gap-4">

          <div>
            <label className="label">Forename</label>
            <input
              className="input"
              value={d.forename || ""}
              onChange={e => update("demographics", "forename", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Surname</label>
            <input
              className="input"
              value={d.surname || ""}
              onChange={e => update("demographics", "surname", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Date of Birth</label>
            <input
              type="date"
              className="input"
              value={d.dob || ""}
              onChange={e => update("demographics", "dob", e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <div className="w-full text-sm bg-slate-50 border rounded-xl px-3 py-2">
              Age: <span className="font-medium text-slate-900">{age}</span>
            </div>
          </div>

          <div>
            <label className="label">Hand Dominance</label>
            <input
              className="input"
              value={d.hand || ""}
              onChange={e => update("demographics", "hand", e.target.value)}
            />
          </div>

        </div>
      </div>

      {/* ================= REFERRER ================= */}
      <div className="card space-y-4">
        <h2 className="section-title">Referrer</h2>

        <div className="grid grid-cols-2 gap-4">

          <div>
            <label className="label">Referrer Name</label>
            <input
              className="input"
              value={r.name || ""}
              onChange={e => update("referrer", "name", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Organisation</label>
            <input
              className="input"
              value={r.org || ""}
              onChange={e => update("referrer", "org", e.target.value)}
            />
          </div>

        </div>
      </div>

      {/* ================= APPOINTMENT ================= */}
      <div className="card space-y-4">
        <h2 className="section-title">Appointment</h2>

        <div className="grid grid-cols-2 gap-4">

          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={a.date || ""}
              onChange={e => update("appointment", "date", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Time</label>
            <input
              type="time"
              className="input"
              value={a.time || ""}
              onChange={e => update("appointment", "time", e.target.value)}
            />
          </div>

          <div className="col-span-2">
            <label className="label">Location</label>
            <input
              className="input"
              value={a.location || ""}
              onChange={e => update("appointment", "location", e.target.value)}
            />
          </div>

        </div>
      </div>

      {/* ================= ACTIONS ================= */}
      <div className="card flex flex-wrap gap-3 justify-between items-center">

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
            <div className="flex gap-2">
              <button onClick={handleSave} className="btn-primary">
                Save
              </button>

              <button onClick={openReport} className="btn-secondary">
                Report Builder
              </button>
            </div>
          </>
        )}

      </div>

      {/* ================= FILE DROP ================= */}
      {isSaved && (
        <div className="card space-y-3">
          <div
            className={`border-dashed border-2 rounded-xl text-center py-10 transition
              ${dragOver ? "border-violet-500 bg-violet-50 text-violet-700"
                         : "border-slate-300 text-slate-500"}`}
          >
            <div className="text-sm">
              {ingesting
                ? "Ingesting…"
                : isTauri
                  ? "Drag & Drop Files Here"
                  : "Drag & drop requires the Tauri runtime — run via `cargo tauri dev`"}
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
                      const updated = prev.filter((_, idx) => idx !== i);
                      persistDocs(updated);
                      return updated;
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
);
}