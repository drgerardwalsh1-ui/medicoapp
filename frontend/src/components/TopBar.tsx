export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type TopBarProps = {
  title: string;
  onBack?: () => void;
  onSave?: () => void;
  showSave?: boolean;
  showVersionHistory?: boolean;
  onShowVersionHistory?: () => void;
  onExportDocx?: () => void;
  showExportDocx?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  saveStatus?: SaveStatus;
  saveDirty?: boolean;
  subtitle?: string;
};

function StatusPill({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  if (status === "saving") return <span className="text-xs text-slate-500">Saving…</span>;
  if (status === "saved")  return <span className="text-xs text-emerald-600">Saved</span>;
  if (status === "error")  return <span className="text-xs text-red-600">Save error</span>;
  if (dirty)               return <span className="text-xs text-amber-600">Unsaved</span>;
  return null;
}

export default function TopBar({
  title,
  onBack,
  onSave,
  showSave = false,
  showVersionHistory = false,
  onShowVersionHistory,
  onExportDocx,
  showExportDocx = false,
  saveDisabled = false,
  saveLabel = "Save",
  saveStatus = "idle",
  saveDirty = false,
  subtitle,
}: TopBarProps) {
  return (
    <div className="topbar flex justify-between items-center h-14 border-b px-4 bg-white shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-900 shrink-0"
          >
            ← Back
          </button>
        )}
        <h1 className="font-semibold text-slate-900 truncate">{title}</h1>
        {subtitle && (
          <span className="text-[11px] text-slate-400 bg-slate-100 rounded px-2 py-0.5 shrink-0">
            {subtitle}
          </span>
        )}
        {showSave && <StatusPill status={saveStatus} dirty={saveDirty} />}
      </div>

      <div className="flex gap-2 shrink-0">
        {showVersionHistory && (
          <button
            type="button"
            onClick={() => onShowVersionHistory?.()}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700"
          >
            Version History
          </button>
        )}
        {showSave && (
          <button
            type="button"
            onClick={() => onSave?.()}
            disabled={saveDisabled}
            className="text-xs px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
          >
            {saveLabel}
          </button>
        )}
        {showExportDocx && (
          <button
            type="button"
            onClick={() => onExportDocx?.()}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700"
          >
            Export DOCX
          </button>
        )}
      </div>
    </div>
  );
}
