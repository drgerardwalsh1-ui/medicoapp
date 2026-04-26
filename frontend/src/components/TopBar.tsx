/**
 * Contextual top bar — page title, optional Back / Save / Version History.
 * Styling is intentionally minimal so it sits above existing pages
 * without redesigning their internal headers.
 */

export type TopBarProps = {
  title: string;
  onBack?: () => void;
  onSave?: () => void;
  showSave?: boolean;
  showVersionHistory?: boolean;
  onShowVersionHistory?: () => void;
};

export default function TopBar({
  title,
  onBack,
  onSave,
  showSave = false,
  showVersionHistory = false,
  onShowVersionHistory,
}: TopBarProps) {
  return (
    <div className="flex justify-between items-center h-16 border-b px-4 bg-white">
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
            className="text-xs px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white"
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}
