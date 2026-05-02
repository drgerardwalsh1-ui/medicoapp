import { useState, useRef, useCallback, useEffect } from "react";
import { TauriAPI, isTauri } from "../api/tauriApi";
import { buildClientName } from "../types/client";

// ─── Toast ────────────────────────────────────────────────────────────────────

type ToastItem = {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  detail?: { label: string; action: () => void }[];
};

let toastSeq = 0;

function Toast({ items, remove }: { items: ToastItem[]; remove: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={
            "pointer-events-auto flex flex-col gap-1.5 rounded-lg px-4 py-3 shadow-lg text-sm " +
            (t.kind === "success"
              ? "bg-green-700 text-white"
              : t.kind === "error"
              ? "bg-red-700 text-white"
              : "bg-slate-800 text-white")
          }
        >
          <div className="flex items-start justify-between gap-3">
            <span>{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              className="opacity-60 hover:opacity-100 leading-none text-base shrink-0 mt-0.5"
            >
              ×
            </button>
          </div>
          {t.detail && t.detail.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {t.detail.map((d) => (
                <button
                  key={d.label}
                  onClick={d.action}
                  className="text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback(
    (kind: ToastItem["kind"], message: string, detail?: ToastItem["detail"]) => {
      const id = ++toastSeq;
      setItems((prev) => [...prev, { id, kind, message, detail }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 7000);
    },
    []
  );

  const remove = useCallback(
    (id: number) => setItems((prev) => prev.filter((t) => t.id !== id)),
    []
  );

  return { items, push, remove };
}

// ─── Clipboard helper ─────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for environments where clipboard API is unavailable
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type QueryResult = { columns: string[]; rows: unknown[][] } | null;

// ─── Preset queries ───────────────────────────────────────────────────────────

const PRESET_QUERIES = [
  {
    label: "All Clients",
    db: "projection" as const,
    sql: "SELECT id, name, last_version, created_at, updated_at, document_count FROM clients ORDER BY created_at DESC",
  },
  {
    label: "All Documents",
    db: "projection" as const,
    sql: "SELECT d.client_id, c.name, d.file_name, d.method, d.char_count, d.uploaded_at FROM documents d LEFT JOIN clients c ON c.id = d.client_id ORDER BY d.uploaded_at DESC",
  },
  {
    label: "Demographics (all clients)",
    db: "projection" as const,
    sql: "SELECT id, name, demographics FROM clients ORDER BY name",
  },
  {
    label: "All Events",
    db: "events" as const,
    sql: "SELECT client_id, version, type, timestamp, payload_json FROM events ORDER BY timestamp DESC LIMIT 100",
  },
  {
    label: "Event counts per client",
    db: "events" as const,
    sql: "SELECT client_id, COUNT(*) as event_count, MIN(timestamp) as first, MAX(timestamp) as last FROM events GROUP BY client_id",
  },
];

// ─── Reset modal ──────────────────────────────────────────────────────────────

function ResetModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-bold text-red-600 mb-2">Reset All Data</h2>
        <p className="text-sm text-slate-700 mb-4">
          This will permanently delete{" "}
          <strong>all clients, events, and documents</strong>. This action cannot
          be undone.
        </p>
        <p className="text-sm text-slate-600 mb-2">
          Type{" "}
          <span className="font-mono font-bold text-red-600">DELETE</span> to
          confirm:
        </p>
        <input
          type="text"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4 font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          placeholder="Type DELETE here"
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={typed !== "DELETE"}
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-semibold disabled:opacity-40 hover:bg-red-700 disabled:cursor-not-allowed"
          >
            Wipe All Data
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── JSON preview modal ───────────────────────────────────────────────────────

function JsonModal({
  title,
  data,
  onClose,
}: {
  title: string;
  data: unknown;
  onClose: () => void;
}) {
  const [pretty, setPretty] = useState(true);
  const text = pretty
    ? JSON.stringify(data, null, 2)
    : JSON.stringify(data);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-3xl mx-4 max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800 truncate">{title}</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPretty((v) => !v)}
              className="text-xs px-3 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-100"
            >
              {pretty ? "Minify" : "Pretty"}
            </button>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-800 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-slate-800 bg-slate-50 rounded-b-xl whitespace-pre-wrap break-all">
          {text}
        </pre>
      </div>
    </div>
  );
}

// ─── Database Explorer ────────────────────────────────────────────────────────

function DatabaseExplorer({
  push,
}: {
  push: (kind: ToastItem["kind"], msg: string, detail?: ToastItem["detail"]) => void;
}) {
  const [sql, setSql] = useState(PRESET_QUERIES[0].sql);
  const [db, setDb] = useState<"projection" | "events">("projection");
  const [result, setResult] = useState<QueryResult>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [jsonModal, setJsonModal] = useState<{
    title: string;
    data: unknown;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function runQuery() {
    if (!isTauri) {
      setError("Tauri runtime not available — run via `cargo tauri dev`.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const raw = await TauriAPI.runSqlQuery(sql.trim(), db);
      const parsed = JSON.parse(raw) as QueryResult;
      setResult(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function applyPreset(p: (typeof PRESET_QUERIES)[number]) {
    setSql(p.sql);
    setDb(p.db);
    textareaRef.current?.focus();
  }

  async function copyResults() {
    if (!result) return;
    const obj = { columns: result.columns, rows: result.rows };
    try {
      await copyToClipboard(JSON.stringify(obj, null, 2));
      push("success", "Query results copied to clipboard");
    } catch {
      push("error", "Copy failed — please try again");
    }
  }

  async function copyCell(value: unknown) {
    try {
      await copyToClipboard(value == null ? "NULL" : String(value));
      push("info", "Cell value copied");
    } catch {
      push("error", "Copy failed");
    }
  }

  // Build a row object from columns + values for JSON view
  function rowToObject(row: unknown[]): Record<string, unknown> {
    if (!result) return {};
    return Object.fromEntries(result.columns.map((col, i) => [col, row[i]]));
  }

  return (
    <div>
      {jsonModal && (
        <JsonModal
          title={jsonModal.title}
          data={jsonModal.data}
          onClose={() => setJsonModal(null)}
        />
      )}

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {PRESET_QUERIES.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-100"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* DB selector + textarea */}
      <div className="flex gap-3 items-start mb-3">
        <select
          value={db}
          onChange={(e) => setDb(e.target.value as "projection" | "events")}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-700 bg-white"
        >
          <option value="projection">projection.db</option>
          <option value="events">events.db</option>
        </select>
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={4}
          spellCheck={false}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
          placeholder="SELECT ..."
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              runQuery();
            }
          }}
        />
      </div>

      <button
        onClick={runQuery}
        disabled={running || !sql.trim()}
        className="mb-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {running ? "Running…" : "Run Query"}
        <span className="ml-2 text-xs opacity-70">⌘↵</span>
      </button>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono">
          {error}
        </div>
      )}

      {result && (
        <div>
          {/* Results toolbar */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">
              {result.rows.length} row{result.rows.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={copyResults}
              className="text-xs px-3 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-100"
            >
              Copy Results JSON
            </button>
          </div>

          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-600 font-semibold">
                <tr>
                  <th className="px-2 py-2 border-b border-slate-200 w-8 text-slate-400">#</th>
                  {result.columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 whitespace-nowrap border-b border-slate-200"
                    >
                      {col}
                    </th>
                  ))}
                  <th className="px-2 py-2 border-b border-slate-200 w-14" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={result.columns.length + 2}
                      className="px-3 py-4 text-slate-400 text-center"
                    >
                      No rows returned.
                    </td>
                  </tr>
                ) : (
                  result.rows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-slate-50 group">
                      <td className="px-2 py-1.5 text-slate-400 font-mono text-right">
                        {ri + 1}
                      </td>
                      {(row as unknown[]).map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-3 py-1.5 text-slate-700 max-w-xs truncate font-mono cursor-pointer"
                          title={cell == null ? "NULL" : String(cell)}
                          onClick={() => copyCell(cell)}
                        >
                          {cell == null ? (
                            <span className="text-slate-400 italic">NULL</span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() =>
                            setJsonModal({
                              title: `Row ${ri + 1}`,
                              data: rowToObject(row as unknown[]),
                            })
                          }
                          className="opacity-0 group-hover:opacity-100 text-xs text-blue-600 hover:underline"
                        >
                          JSON
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Click any cell to copy its value.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Global export section ────────────────────────────────────────────────────

function GlobalExport({
  push,
}: {
  push: (kind: ToastItem["kind"], msg: string, detail?: ToastItem["detail"]) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function getJson(): Promise<string> {
    return TauriAPI.exportAllData();
  }

  async function handleExportToFile() {
    if (!isTauri) { push("error", "Tauri runtime not available."); return; }
    setBusy(true);
    try {
      const json = await getJson();
      const filename = `clients_export_${new Date().toISOString().slice(0, 10)}.json`;
      const savedPath = await TauriAPI.saveTextFile(json, filename);
      push("success", `Exported successfully to: ${savedPath}`, [
        {
          label: "Open Folder",
          action: () => TauriAPI.revealInFinder(savedPath).catch(() => {}),
        },
        {
          label: "Copy Path",
          action: () => copyToClipboard(savedPath).catch(() => {}),
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") push("error", `Export failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyAll() {
    if (!isTauri) { push("error", "Tauri runtime not available."); return; }
    setBusy(true);
    try {
      const json = await getJson();
      await copyToClipboard(json);
      const meta = JSON.parse(json) as { client_count: number; event_count: number };
      push(
        "success",
        `All client data copied to clipboard (${meta.client_count} clients, ${meta.event_count} events)`
      );
    } catch (e) {
      push("error", `Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-3 flex-wrap">
      <button
        onClick={handleExportToFile}
        disabled={busy}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Working…" : "Export JSON"}
      </button>
      <button
        onClick={handleCopyAll}
        disabled={busy}
        className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Copy All JSON to Clipboard
      </button>
    </div>
  );
}

// ─── Per-client tools ─────────────────────────────────────────────────────────

function ClientTools({
  push,
}: {
  push: (kind: ToastItem["kind"], msg: string, detail?: ToastItem["detail"]) => void;
}) {
  const [clients, setClients] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [jsonModal, setJsonModal] = useState<{
    title: string;
    data: unknown;
  } | null>(null);

  async function loadClients() {
    if (!isTauri) { push("error", "Tauri runtime not available."); return; }
    setLoading(true);
    try {
      const list = await TauriAPI.listClients();
      setClients(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId((list[0] as { id: string }).id);
      }
    } catch (e) {
      push("error", `Load failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function selectedClient(): unknown | null {
    if (!clients || !selectedId) return null;
    return (
      (clients as Array<{ id: string }>).find((c) => c.id === selectedId) ?? null
    );
  }

  async function copyClientJson(pretty: boolean) {
    const c = selectedClient();
    if (!c) return;
    const text = pretty ? JSON.stringify(c, null, 2) : JSON.stringify(c);
    try {
      await copyToClipboard(text);
      push("success", "Client JSON copied to clipboard");
    } catch {
      push("error", "Copy failed — please try again");
    }
  }

  async function downloadClientJson() {
    if (!isTauri) { push("error", "Tauri runtime not available."); return; }
    const c = selectedClient() as { id: string; identity?: unknown } | null;
    if (!c) return;
    const name = buildClientName((c as any).identity);
    const slug = (name || c.id).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const filename = `client_${slug}.json`;
    try {
      const json = JSON.stringify(c, null, 2);
      const savedPath = await TauriAPI.saveTextFile(json, filename);
      push("success", `Saved to: ${savedPath}`, [
        {
          label: "Open Folder",
          action: () => TauriAPI.revealInFinder(savedPath).catch(() => {}),
        },
      ]);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "cancelled") {
        console.error("Download failed:", err);
        push("error", `Save failed: ${msg}`);
      }
    }
  }

  function logToConsole() {
    const c = selectedClient();
    if (!c) return;
    // eslint-disable-next-line no-console
    console.log("[medicoapp] Client data:", c);
    push("info", "Client data logged to console (open DevTools to view)");
  }

  const client = selectedClient() as { id: string; identity?: unknown } | null;

  return (
    <div>
      {jsonModal && (
        <JsonModal
          title={jsonModal.title}
          data={jsonModal.data}
          onClose={() => setJsonModal(null)}
        />
      )}

      <div className="flex gap-3 items-center mb-4 flex-wrap">
        {!clients ? (
          <button
            onClick={loadClients}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load Clients"}
          </button>
        ) : (
          <>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-700 bg-white max-w-xs"
            >
              {(clients as Array<{ id: string; identity?: unknown }>).map((c) => (
                <option key={c.id} value={c.id}>
                  {buildClientName((c.identity as any) ?? null) || c.id}
                </option>
              ))}
            </select>
            <button
              onClick={loadClients}
              disabled={loading}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Refresh
            </button>
          </>
        )}
      </div>

      {client && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() =>
              setJsonModal({
                title: buildClientName((client.identity as any) ?? null) || "Client",
                data: client,
              })
            }
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
          >
            View JSON
          </button>
          <button
            onClick={() => copyClientJson(true)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
          >
            Copy Pretty JSON
          </button>
          <button
            onClick={() => copyClientJson(false)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
          >
            Copy Minified JSON
          </button>
          <button
            onClick={downloadClientJson}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
          >
            Download JSON
          </button>
          <button
            onClick={logToConsole}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-500 hover:bg-slate-50"
          >
            Log to Console
          </button>
        </div>
      )}

      {clients && clients.length === 0 && (
        <p className="text-sm text-slate-400">No clients in the database.</p>
      )}
    </div>
  );
}

// ─── Debug Tools ──────────────────────────────────────────────────────────────

function DebugTools() {
  const [log, setLog] = useState<string[]>([]);

  function addLog(msg: string) {
    setLog((prev) => [
      `[${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}] ${msg}`,
      ...prev.slice(0, 49),
    ]);
  }

  async function handleValidate() {
    if (!isTauri) { addLog("Not in Tauri runtime."); return; }
    try {
      const clients = await TauriAPI.listClients();
      addLog(
        `OK: ${clients.length} client${clients.length !== 1 ? "s" : ""} in projection.`
      );
    } catch (e) {
      addLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div className="flex gap-3 flex-wrap mb-4">
        <button
          onClick={handleValidate}
          className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
        >
          Validate DB
        </button>
        <button
          onClick={() => setLog([])}
          className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-500 hover:bg-slate-50"
        >
          Clear Log
        </button>
      </div>

      {log.length > 0 ? (
        <div className="bg-slate-900 text-green-400 rounded-lg p-3 text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No log output yet.</p>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SystemPage({ onReset }: { onReset?: () => void }) {
  const { items: toasts, push, remove } = useToast();
  const [showReset, setShowReset] = useState(false);

  async function handleReset() {
    setShowReset(false);
    try {
      const raw = await TauriAPI.resetDatabase();
      const res = JSON.parse(raw) as { message: string };
      push("success", res.message ?? "Database cleared — ready for fresh data");
      // Propagate to root: clear in-memory state and navigate Home
      onReset?.();
    } catch (e) {
      push("error", `Reset failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <Toast items={toasts} remove={remove} />

      {showReset && (
        <ResetModal
          onClose={() => setShowReset(false)}
          onConfirm={handleReset}
        />
      )}

      {/* ── Data Management ─────────────────────────────────────────────── */}
      <Section title="Data Management">
        <p className="text-sm text-slate-600 mb-4">
          Permanently delete all client records, events, and documents. This
          cannot be undone.
        </p>
        <button
          onClick={() => setShowReset(true)}
          className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
        >
          Reset All Data…
        </button>
      </Section>

      {/* ── Export ──────────────────────────────────────────────────────── */}
      <Section title="Export">
        <p className="text-sm text-slate-600 mb-4">
          Export all client and event data. Opens a save dialog so you choose
          where the file goes.
        </p>
        <GlobalExport push={push} />
      </Section>

      {/* ── Per-client tools ─────────────────────────────────────────────── */}
      <Section title="Client Data Inspector">
        <p className="text-sm text-slate-600 mb-4">
          Access the exact stored data for any single client — copy, download,
          or log to console.
        </p>
        <ClientTools push={push} />
      </Section>

      {/* ── Database Explorer ────────────────────────────────────────────── */}
      <Section title="Database Explorer">
        <DatabaseExplorer push={push} />
      </Section>

      {/* ── Debug Tools ─────────────────────────────────────────────────── */}
      <Section title="Debug Tools">
        <DebugTools />
      </Section>

      {/* ── App Info ────────────────────────────────────────────────────── */}
      <Section title="App Info">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-slate-500">App</dt>
          <dd className="text-slate-800 font-medium">medicoapp</dd>
          <dt className="text-slate-500">Architecture</dt>
          <dd className="text-slate-800">
            Event-sourced SQLite (events.db + projection.db)
          </dd>
          <dt className="text-slate-500">Frontend</dt>
          <dd className="text-slate-800">React + TypeScript + Tauri v2</dd>
          <dt className="text-slate-500">DB location</dt>
          <dd className="text-slate-800 font-mono text-xs">~/.medicoapp/</dd>
          <dt className="text-slate-500">Runtime</dt>
          <dd className="text-slate-800">
            {isTauri ? "Tauri (desktop)" : "Browser (no DB access)"}
          </dd>
        </dl>
      </Section>
    </div>
  );
}
