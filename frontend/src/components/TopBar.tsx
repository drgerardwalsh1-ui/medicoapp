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
};

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
}: TopBarProps) {
  return (
    <div className="flex justify-between items-center h-14 border-b px-4 bg-white shrink-0">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            ← Back
          </button>
        )}
        <h1 className="font-semibold text-slate-900">{title}</h1>
      </div>

      <div className="flex gap-2">
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
