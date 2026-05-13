import { useEffect, useState } from "react";
import {
  TauriAPI,
  isTauri,
  type ClientStateSnapshot,
  type EventHistoryItem,
} from "../api/tauriApi";
import { parseClientBlob, formatFullName, type Client } from "../types/client";
import { formatTimestamp as tsFormatTimestamp } from "../time";

// Single owner of the version-history UI for client pages. Replaces the two
// near-identical copies that previously lived in ClientHome.tsx (1417-1546)
// and App.tsx (770-893). Mounted once by ClientLayout — never by individual
// pages — so the chrome is consistent regardless of which tab is active.

export type VersionHistoryModalProps = {
  open: boolean;
  client: Client | null;
  onClose: () => void;
  onRestored?: () => void;
};

function prettyEventType(t: string): string {
  switch (t) {
    case "client_created":               return "Client created";
    case "demographics_updated":         return "Demographics updated";
    case "document_uploaded":            return "Document uploaded";
    case "client_restored_from_version": return "Restored from earlier version";
    default:                             return t;
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

export default function VersionHistoryModal({
  open,
  client,
  onClose,
  onRestored,
}: VersionHistoryModalProps) {
  const [historyItems, setHistoryItems] = useState<EventHistoryItem[]>([]);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<ClientStateSnapshot | null>(null);
  const [restoring, setRestoring] = useState(false);

  function closePreview() {
    setPreviewVersion(null);
    setPreviewSnapshot(null);
  }

  useEffect(() => {
    if (!open || !isTauri || !client?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await TauriAPI.getClientEventHistory(client.id);
        if (!cancelled) setHistoryItems(items);
      } catch (err) {
        console.warn("[version-history] failed to load events:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [open, client?.id]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (previewVersion !== null) closePreview();
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, previewVersion, onClose]);

  async function openPreview(version: number) {
    if (!isTauri || !client?.id) return;
    try {
      const snap = await TauriAPI.getClientSnapshotAtVersion(client.id, version);
      setPreviewSnapshot(snap);
      setPreviewVersion(version);
    } catch (err) {
      alert(`Snapshot unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function copyDemographicsFromPreview() {
    if (!isTauri || !client?.id || previewVersion === null) return;
    setRestoring(true);
    try {
      await TauriAPI.restoreClientFieldFromVersion(client.id, previewVersion, "demographics");
      closePreview();
      onClose();
      onRestored?.();
      alert("Demographics restored. Reopen the client to see the updated form.");
    } catch (err) {
      alert(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestoring(false);
    }
  }

  async function restoreFullFromPreview() {
    if (!isTauri || !client?.id || previewVersion === null) return;
    setRestoring(true);
    try {
      await TauriAPI.restoreClientFromVersion(client.id, previewVersion);
      closePreview();
      onClose();
      onRestored?.();
      alert("Full version restored. Reopen the client to see the updated form.");
    } catch (err) {
      alert(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRestoring(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closePreview();
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            {previewVersion !== null && (
              <button
                type="button"
                onClick={closePreview}
                className="text-slate-400 hover:text-slate-700 transition"
                title="Back"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-base font-semibold text-slate-900">
              {previewVersion !== null
                ? `Version Preview — v${previewVersion}`
                : `Version History${client ? ` — ${formatFullName(client.identity) || "(unnamed)"}` : ""}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => { closePreview(); onClose(); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title="Close (Esc)"
          >
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
                      <button
                        type="button"
                        onClick={() => openPreview(it.version)}
                        className="w-full text-left px-3 py-2.5 rounded-xl border border-transparent hover:bg-slate-50 hover:border-slate-200 transition group"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">v{it.version}</span>
                            <span className="text-xs text-slate-600">
                              {prettyEventType(it.event_type)}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {tsFormatTimestamp(it.timestamp)}
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
                  previewSnapshot.client_id ?? client?.id ?? "",
                  previewSnapshot.demographics
                );
                const d = parsed.identity;
                const inj = parsed.clinical.injury;
                const r = parsed.administrative.referrer;
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
                      ["Date of Injury", inj?.dateOfInjury],
                      ["Injury Type", inj?.injuryType === "other" ? inj?.injuryTypeOther : inj?.injuryType],
                      ["Claim Number", inj?.claimNumber],
                      ["Insurer", inj?.insurerName],
                      ["Insurer Ref", inj?.insurerReference],
                    ]} />
                    <PreviewSection title="Referrer" rows={[
                      ["Name", r.name],
                      ["Organisation", r.org],
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
            <button
              className="btn-secondary"
              onClick={copyDemographicsFromPreview}
              disabled={restoring}
            >
              Copy Demographics
            </button>
            <button
              className="btn-primary"
              onClick={restoreFullFromPreview}
              disabled={restoring}
              title="Append restore event — history preserved"
            >
              Restore Full Version
            </button>
            {restoring && (
              <span className="text-xs text-slate-500 self-center">Restoring…</span>
            )}
          </div>
        )}
        <div className="px-6 py-3 border-t bg-slate-50 shrink-0">
          <p className="text-[11px] text-slate-500">
            Restores append a new event — past history is never rewritten.
          </p>
        </div>
      </div>
    </div>
  );
}
