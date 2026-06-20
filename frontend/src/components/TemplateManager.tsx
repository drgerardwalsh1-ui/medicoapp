// ── Template manager — clone-and-adjust interview template library ────────────
// The app counterpart of the clinician's Word template folder. Built-ins are
// read-only references; cloning produces an editable copy (rename, reorder,
// remove/re-add sections, toggle probes within a symptom domain). Saved
// templates persist via engine/templateStore.ts.

import { useMemo, useState } from "react";
import type {
  InterviewSection,
  InterviewTemplate,
} from "../types/interviewTemplate";
import {
  cloneTemplate,
  deleteTemplate,
  listTemplates,
  saveTemplate,
} from "../engine/templateStore";
import { domainProbes } from "../engine/interviewCoverage";
import { BUILTIN_TEMPLATES } from "../data/interviewTemplates";
import { SYMPTOM_DOMAINS } from "../data/symptomDomains";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Fired after any change so the host refreshes its template list. */
  onChanged: (selectTemplateId?: string) => void;
};

// Catalog of addable sections: every structural section used by any builtin,
// plus one symptomDomain section per Current Symptoms domain.
function sectionCatalog(): InterviewSection[] {
  const seen = new Map<string, InterviewSection>();
  for (const t of BUILTIN_TEMPLATES)
    for (const s of t.sections) if (!seen.has(s.id)) seen.set(s.id, s);
  for (const d of SYMPTOM_DOMAINS) {
    const id = `sx-${d.id}`;
    if (!seen.has(id))
      seen.set(id, { id, kind: "symptomDomain", title: d.label, domainId: d.id });
  }
  return [...seen.values()];
}

export default function TemplateManager({ open, onClose, onChanged }: Props) {
  const [templates, setTemplates] = useState<InterviewTemplate[]>(() => listTemplates());
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id ?? "");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const catalog = useMemo(sectionCatalog, []);
  const [addPick, setAddPick] = useState<string>("");

  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];
  const editable = selected && !selected.builtin;

  const refresh = (selectId?: string) => {
    const next = listTemplates();
    setTemplates(next);
    if (selectId) setSelectedId(selectId);
    onChanged(selectId);
  };

  const update = (mutate: (t: InterviewTemplate) => InterviewTemplate) => {
    if (!selected || selected.builtin) return;
    const next = mutate(selected);
    saveTemplate(next);
    refresh(next.id);
  };

  const moveSection = (index: number, delta: number) =>
    update((t) => {
      const sections = [...t.sections];
      const j = index + delta;
      if (j < 0 || j >= sections.length) return t;
      [sections[index], sections[j]] = [sections[j], sections[index]];
      return { ...t, sections };
    });

  const removeSection = (id: string) =>
    update((t) => ({ ...t, sections: t.sections.filter((s) => s.id !== id) }));

  const addSection = () => {
    const section = catalog.find((s) => s.id === addPick);
    if (!section) return;
    update((t) =>
      t.sections.some((s) => s.id === section.id)
        ? t
        : { ...t, sections: [...t.sections, section] },
    );
    setAddPick("");
  };

  const toggleProbe = (section: InterviewSection, probeId: string) =>
    update((t) => ({
      ...t,
      sections: t.sections.map((s) => {
        if (s.id !== section.id) return s;
        const all = domainProbes({ ...s, probeIds: undefined }).map((p) => p.symptomTypeId);
        const current = new Set(s.probeIds ?? all);
        if (current.has(probeId)) current.delete(probeId);
        else current.add(probeId);
        // Keep stable domain order; empty selection is allowed (clinician's call).
        return { ...s, probeIds: all.filter((id) => current.has(id)) };
      }),
    }));

  if (!open || !selected) return null;

  return (
    <div
      className="absolute inset-0 z-20 bg-slate-900/30 flex items-center justify-center p-6"
      data-testid="template-manager"
    >
      <div className="bg-white rounded-lg border border-slate-300 shadow-xl w-full max-w-3xl max-h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Interview templates</h2>
          <span className="text-[11px] text-slate-400">
            clone a built-in, then adjust — like your Word template library
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-slate-400 hover:text-slate-700 text-sm px-1"
            aria-label="Close template manager"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Template list */}
          <div className="w-56 shrink-0 border-r border-slate-200 overflow-y-auto py-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={[
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-1.5",
                  t.id === selected.id ? "bg-violet-50 text-violet-800" : "text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                <span className="flex-1 truncate">{t.name}</span>
                {t.builtin && (
                  <span className="text-[9px] uppercase tracking-wide text-slate-400">built-in</span>
                )}
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 text-xs">
            <div className="flex items-center gap-2 mb-3">
              {editable ? (
                <input
                  value={selected.name}
                  onChange={(e) => update((t) => ({ ...t, name: e.target.value }))}
                  className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm font-medium"
                  data-testid="template-name"
                />
              ) : (
                <div className="flex-1 text-sm font-medium text-slate-800">{selected.name}</div>
              )}
              <button
                type="button"
                onClick={() => {
                  const clone = cloneTemplate(selected.id);
                  if (clone) refresh(clone.id);
                }}
                className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
              >
                Clone
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    deleteTemplate(selected.id);
                    refresh(listTemplates()[0]?.id);
                  }}
                  className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>

            {!editable && (
              <div className="mb-3 px-2 py-1.5 bg-slate-50 rounded text-slate-500">
                Built-ins are read-only — clone to edit.
              </div>
            )}

            <ul className="space-y-1">
              {selected.sections.map((s, i) => {
                const probes =
                  s.kind === "symptomDomain"
                    ? domainProbes({ ...s, probeIds: undefined })
                    : [];
                const active = new Set(
                  s.probeIds ?? probes.map((p) => p.symptomTypeId),
                );
                const expanded = expandedSection === s.id;
                return (
                  <li key={s.id} className="border border-slate-200 rounded">
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <span className="flex-1 text-slate-800">{s.title}</span>
                      {s.kind === "symptomDomain" && (
                        <button
                          type="button"
                          onClick={() => setExpandedSection(expanded ? null : s.id)}
                          className="text-violet-700 hover:underline"
                        >
                          {active.size}/{probes.length} probes
                        </button>
                      )}
                      {editable && (
                        <>
                          <button type="button" onClick={() => moveSection(i, -1)} className="text-slate-400 hover:text-slate-700 px-0.5" aria-label={`Move ${s.title} up`}>↑</button>
                          <button type="button" onClick={() => moveSection(i, 1)} className="text-slate-400 hover:text-slate-700 px-0.5" aria-label={`Move ${s.title} down`}>↓</button>
                          <button type="button" onClick={() => removeSection(s.id)} className="text-slate-400 hover:text-red-600 px-0.5" aria-label={`Remove ${s.title}`}>✕</button>
                        </>
                      )}
                    </div>
                    {expanded && s.kind === "symptomDomain" && (
                      <div className="px-2 pb-2 flex flex-wrap gap-1">
                        {probes.map((p) => (
                          <button
                            key={p.symptomTypeId}
                            type="button"
                            disabled={!editable}
                            onClick={() => toggleProbe(s, p.symptomTypeId)}
                            className={[
                              "px-2 py-0.5 rounded-full border text-[11px]",
                              active.has(p.symptomTypeId)
                                ? "bg-violet-50 border-violet-300 text-violet-800"
                                : "bg-white border-slate-200 text-slate-400 line-through",
                              editable ? "" : "cursor-default opacity-70",
                            ].join(" ")}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {editable && (
              <div className="mt-3 flex items-center gap-2">
                <select
                  value={addPick}
                  onChange={(e) => setAddPick(e.target.value)}
                  className="border border-slate-300 rounded px-1.5 py-1 bg-white"
                  data-testid="add-section-pick"
                >
                  <option value="">Add section…</option>
                  {catalog
                    .filter((s) => !selected.sections.some((x) => x.id === s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={addSection}
                  disabled={!addPick}
                  className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
