/**
 * DocumentCard — single ingested-document panel.
 * Mirrors the legacy backend/src/App.jsx FileContentCard:
 *   header (filename + method badge + char count)
 *   spaCy NER entities (PERSON / ORG / DATE)
 *   scispaCy biomedical entities (conditions / medications / procedures / …)
 *   extracted text
 *   structured analysis JSON (collapsible)
 */

export type NerEntities = {
  PERSON?: string[];
  ORG?: string[];
  DATE?: string[];
  error?: string;
};

export type SciEntities = {
  conditions?: string[];
  medications?: string[];
  procedures?: string[];
  other?: string[];
  all?: string[];
  error?: string;
};

export type IngestedDoc = {
  fileName: string;
  path: string;
  method: string;
  charCount: number;
  ocrAvailable: boolean;
  text?: string;
  ner?: NerEntities;
  sci?: SciEntities;
  canonical?: unknown;
  structured?: unknown;
  error?: string;
};

const METHOD_META: Record<string, { label: string; cls: string }> = {
  text:        { label: "Text layer", cls: "bg-emerald-100 text-emerald-800" },
  ocr:         { label: "OCR",        cls: "bg-orange-100 text-orange-800" },
  text_sparse: { label: "Sparse text", cls: "bg-amber-100 text-amber-800" },
  empty:       { label: "No content", cls: "bg-rose-100 text-rose-800" },
  error:       { label: "Error",      cls: "bg-red-100 text-red-800" },
};

function Chips({ values, cls }: { values: string[]; cls: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v, i) => (
        <span
          key={i}
          className={`text-xs px-2 py-0.5 rounded border ${cls}`}
        >
          {v}
        </span>
      ))}
    </div>
  );
}

function NerBlock({ ner }: { ner?: NerEntities }) {
  if (!ner) return null;
  if (ner.error) {
    return (
      <div className="px-4 py-2 text-xs text-red-700 border-t">
        ⚠ NER error: {ner.error}
      </div>
    );
  }
  const groups: Array<[string, string[] | undefined, string]> = [
    ["People",        ner.PERSON, "bg-emerald-50 text-emerald-800 border-emerald-200"],
    ["Organisations", ner.ORG,    "bg-violet-50 text-violet-800 border-violet-200"],
    ["Dates",         ner.DATE,   "bg-sky-50 text-sky-800 border-sky-200"],
  ];
  const any = groups.some(([, v]) => v && v.length);
  if (!any) return null;
  return (
    <div className="border-t px-4 py-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        spaCy NER
      </div>
      {groups.map(([label, values, cls]) =>
        values && values.length ? (
          <div key={label} className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-600">
              {label} <span className="text-slate-400">({values.length})</span>
            </div>
            <Chips values={values} cls={cls} />
          </div>
        ) : null
      )}
    </div>
  );
}

function SciBlock({ sci }: { sci?: SciEntities }) {
  if (!sci) return null;
  if (sci.error) {
    return (
      <div className="px-4 py-2 text-xs text-red-700 border-t">
        ⚠ scispaCy error: {sci.error}
      </div>
    );
  }
  const groups: Array<[string, string[] | undefined, string]> = [
    ["Conditions",  sci.conditions,  "bg-rose-50 text-rose-800 border-rose-200"],
    ["Medications", sci.medications, "bg-orange-50 text-orange-800 border-orange-200"],
    ["Procedures",  sci.procedures,  "bg-blue-50 text-blue-800 border-blue-200"],
    ["Other",       sci.other,       "bg-slate-50 text-slate-700 border-slate-200"],
  ];
  const any = groups.some(([, v]) => v && v.length);
  if (!any) return null;
  return (
    <div className="border-t px-4 py-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        scispaCy biomedical
      </div>
      {groups.map(([label, values, cls]) =>
        values && values.length ? (
          <div key={label} className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-600">
              {label} <span className="text-slate-400">({values.length})</span>
            </div>
            <Chips values={values} cls={cls} />
          </div>
        ) : null
      )}
    </div>
  );
}

export default function DocumentCard({
  doc,
  onRemove,
}: {
  doc: IngestedDoc;
  onRemove?: () => void;
}) {
  const meta =
    METHOD_META[doc.method] ?? { label: doc.method, cls: "bg-slate-100 text-slate-700" };

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-slate-50 flex-wrap">
        <strong className="text-sm flex-1 truncate">{doc.fileName}</strong>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${meta.cls}`}>
          {meta.label}
        </span>
        <span className="text-[11px] text-slate-500">
          {doc.charCount.toLocaleString()} chars
        </span>
        {doc.ocrAvailable && doc.method !== "text" && (
          <span className="text-[11px] text-orange-700">OCR</span>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
            title="Remove"
          >
            ×
          </button>
        )}
      </div>

      {doc.error && (
        <div className="px-4 py-2 text-xs text-red-700 border-b bg-red-50">
          ⚠ {doc.error}
        </div>
      )}

      <NerBlock ner={doc.ner} />
      <SciBlock sci={doc.sci} />

      {/* extracted text */}
      {doc.text && (
        <div className="border-t px-4 py-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-relaxed font-serif text-slate-800">
          {doc.text}
        </div>
      )}

      {/* structured analysis */}
      {(() => {
        const blob = doc.structured ?? doc.canonical;
        if (!blob) return null;
        const json = JSON.stringify(blob, null, 2) ?? "";
        return (
          <details className="border-t">
            <summary className="cursor-pointer text-xs text-slate-500 px-4 py-2 select-none">
              Structured analysis (JSON)
            </summary>
            <pre className="bg-slate-900 text-emerald-300 text-[11px] leading-snug px-4 py-3 overflow-auto max-h-80 m-0">
              {json}
            </pre>
          </details>
        );
      })()}
    </div>
  );
}
