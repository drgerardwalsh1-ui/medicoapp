import { useMemo, useState, useCallback } from "react";
import { evaluateSchema } from "../schemas/reportSchema";
import { deriveSchema } from "../components/ClientLayout";
import { Field } from "../renderers/renderField";
import { buildPIRSNarrative } from "../engine/pirsEngine";
import PIRSTable from "../components/PIRSTable";
import { PIRSCategoryEntry } from "../components/PIRSCategoryEntry";
import {
  defaultReport,
  type Client,
  type PreviousAssessorPIRS,
} from "../types/client";
import type { Relationship } from "../components/RelationshipManager";
import type { PIRSTableModel } from "../types/types";
import { Temporal } from "@js-temporal/polyfill";
import { getViewerTimeZone } from "../time";

// Body-only Report page. Renders ONE schema-driven section. The header,
// version history, save, and tab pills live in TopBar/ClientLayout — this
// component does NOT duplicate them (spec Part 13, Part 22). Replaces the
// previous frontend/src/App.tsx, which conflated body and chrome.

const PIRS_CATEGORIES = [
  { key: "selfCare",            label: "Self-care",                          index: 0 },
  { key: "socialRecreational",  label: "Social & Recreational Activities",   index: 1 },
  { key: "travel",              label: "Travel",                             index: 2 },
  { key: "socialFunction",      label: "Social Functioning",                 index: 3 },
  { key: "concentration",       label: "Concentration, Persistence and Pace", index: 4 },
  { key: "adaptation",          label: "Employability / Adaptation",         index: 5 },
] as const;

type PirsCategoryKey = typeof PIRS_CATEGORIES[number]["key"];

function pirsKeyToIndex(key: PirsCategoryKey): number {
  return PIRS_CATEGORIES.find((c) => c.key === key)?.index ?? 0;
}
function pirsKeyToLabel(key: PirsCategoryKey): string {
  return PIRS_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

type PirsCategoryDef = { cls: number; text: string }[];

const PIRS_DEFINITIONS: Record<PirsCategoryKey, PirsCategoryDef> = {
  selfCare: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population." },
    { cls: 2, text: "Mild impairment: can live independently, looks after self adequately, although may look unkempt occasionally, sometimes misses a meal or relies on take-away food." },
    { cls: 3, text: "Moderate impairment: cannot live independently without regular support. Needs prompting to shower daily and wear clean clothes. Does not prepare own meals, frequently misses meals. Family member or community nurse visits (or should visit) ×2–3 per week to ensure minimum level of hygiene and nutrition." },
    { cls: 4, text: "Severe impairment: Needs supervised residential care. If unsupervised, may accidentally or purposefully hurt self." },
    { cls: 5, text: "Totally impaired: Needs assistance with basic functions, such as feeding and toileting." },
  ],
  socialRecreational: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: Goes out regularly to cinemas, restaurants or other recreational venue. Belongs to clubs or associations and is actively involved with these." },
    { cls: 2, text: "Mild impairment: occasionally goes out to social events without needing a support person but does not become actively involved: eg. Dancing, cheering favourite team." },
    { cls: 3, text: "Moderate impairment: rarely goes to social events, and mostly when prompted by family or close friend. Will not go out without a support person. Not actively involved, remains quiet and withdrawn." },
    { cls: 4, text: "Severe impairment: Never leaves place of residence. Tolerates the company of family member or close friend, but will go to a different room or garden when others come to visit family or flat mate." },
    { cls: 5, text: "Totally impaired: Cannot tolerate living with anybody, extremely uncomfortable when visited by close family member." },
  ],
  travel: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: can travel to new environments without supervision." },
    { cls: 2, text: "Mild impairment: can travel without a support person, but only in a familiar area such as local shops, visiting a neighbour." },
    { cls: 3, text: "Moderate impairment: cannot travel away from own residence without a support person. Problems may be due to excessive anxiety or cognitive impairment." },
    { cls: 4, text: "Severe impairment: Finds it extremely uncomfortable to leave own residence even with trusted person." },
    { cls: 5, text: "Totally impaired: Cannot be left unsupervised, even at home. May require two or more persons to supervise when travelling." },
  ],
  socialFunction: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: No difficulty in forming and sustaining relationships, eg partner, close friendships lasting years." },
    { cls: 2, text: "Mild impairment: existing relationships are strained. Tension and arguments with partner or close family member, loss of some friendships." },
    { cls: 3, text: "Moderate impairment: previously established relationships severely strained, evidenced by periods of separation or domestic violence. Spouse, relatives or community services looking after children." },
    { cls: 4, text: "Severe impairment: Unable to form or sustain long term relationships. Pre-existing relationships ended, eg lost partner, close friends. Unable to care for dependents, eg own children, elderly parent." },
    { cls: 5, text: "Totally impaired: Unable to function within society. Living away from populated areas, actively avoids social contact." },
  ],
  concentration: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population: Able to pass a TAFE or university course within normal time frame." },
    { cls: 2, text: "Mild impairment: can undertake a basic retraining course, or a standard course at a slower pace. Can focus on intellectually demanding tasks for periods of up to thirty minutes, eg. then feels fatigued or develops headache." },
    { cls: 3, text: "Moderate impairment: is unable to read more than newspaper articles. Finds it difficult to follow complex instructions, eg operating manuals, building plans, make significant repairs to motor vehicle, type long documents, follow a pattern for making clothes, tapestry or knitting." },
    { cls: 4, text: "Severe impairment: can only read a few lines before losing concentration. Difficulties following simple instructions. Concentration deficits obvious even during brief conversation. Unable to live alone, or needs regular assistance from relatives or community services." },
    { cls: 5, text: "Totally impaired: Needs constant supervision and assistance within institutional setting." },
  ],
  adaptation: [
    { cls: 1, text: "No deficit, or minor deficit attributable to the normal variation in the general population. Able to work full time. Duties and performance are consistent with the person's education and training. The person is able to cope with the normal demands of the job." },
    { cls: 2, text: "Mild impairment: can work full time in a different environment. The duties require comparable skill and intellect. Can work in the same position, but no more than 20 hours per week. eg no longer happy to work with specific persons, work in a specific location due to travel required." },
    { cls: 3, text: "Moderate impairment: cannot work at all in same position. Can perform less than 20 hours per week in a different position, which requires less skill or is qualitatively different, eg less stressful." },
    { cls: 4, text: "Severe impairment: cannot work more than one or two days at a time, less than twenty hours per fortnight. Pace is reduced, attendance is erratic." },
    { cls: 5, text: "Totally impaired: cannot work at all." },
  ],
};

function formatDateShort(iso: string): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  try {
    const tz = getViewerTimeZone();
    const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
    const dd = String(z.day).padStart(2, "0");
    const mm = String(z.month).padStart(2, "0");
    return `${dd}/${mm}/${z.year}`;
  } catch {
    return iso;
  }
}

function pirsOrder(name: string): number {
  if (name === "Current PIRS") return 0;
  if (name === "Pre-injury PIRS") return 1;
  return 2;
}
function sortedPirsTables(tables: PIRSTableModel[]): PIRSTableModel[] {
  return [...tables].sort((a, b) => pirsOrder(a.name) - pirsOrder(b.name));
}

function generateId(): string {
  return crypto.randomUUID();
}

export type ReportPageProps = {
  client: Client;
  sectionId: string;
  onClientChange: (updated: Client) => void;
};

export default function ReportPage({ client, sectionId, onClientChange }: ReportPageProps) {
  const initReport = client.report ?? defaultReport();

  // Derive the schema (referrer-org-driven) and locate the requested section.
  const schema = useMemo(
    () => evaluateSchema(deriveSchema(client), initReport.fields ?? {}),
    [client?.administrative?.referrer?.org, initReport.fields]
  );
  const activeSection = schema.sections.find((s: { id: string }) => s.id === sectionId);

  const fields = (initReport.fields ?? {}) as Record<string, unknown>;
  // Memoize ID normalization so legacy tables without ids get stable
  // identifiers across renders. New tables created in this component
  // already include ids from generateId() at construction time.
  const pirsTables: PIRSTableModel[] = useMemo(
    () => (initReport.pirsTables ?? []).map((t) => ({ ...t, id: t.id ?? generateId() })),
    [initReport.pirsTables]
  );
  const previousAssessorPirs: PreviousAssessorPIRS[] = initReport.previousAssessorPirs ?? [];
  const relationships: Relationship[] = (client.relationships ?? []) as Relationship[];

  const [activePirsCategory, setActivePirsCategory] = useState<PirsCategoryKey>("selfCare");

  // ── Mutators — every change rebuilds activeClient via onClientChange ───
  function setReportFields(next: Record<string, unknown>) {
    onClientChange({
      ...client,
      report: { ...initReport, fields: next },
    });
  }
  function setPirsTables(next: PIRSTableModel[]) {
    onClientChange({
      ...client,
      report: { ...initReport, pirsTables: next },
    });
  }
  function setPreviousAssessorPirs(next: PreviousAssessorPIRS[]) {
    onClientChange({
      ...client,
      report: { ...initReport, previousAssessorPirs: next },
    });
  }
  function setRelationships(next: Relationship[]) {
    onClientChange({ ...client, relationships: next });
  }

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
      setPreviousAssessorPirs([...previousAssessorPirs, newEntry]);
    } else {
      setPirsTables([
        ...pirsTables,
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
  }

  function updatePirsTable(id: string, updated: PIRSTableModel) {
    setPirsTables(pirsTables.map((t) => (t.id === id ? updated : t)));
  }
  function updatePrevAssessor(id: string, updated: PreviousAssessorPIRS) {
    setPreviousAssessorPirs(previousAssessorPirs.map((p) => (p.id === id ? updated : p)));
  }

  // ── Narrative + display helpers ─────────────────────────────────────────
  const displayPirsTables = useMemo(() => sortedPirsTables(pirsTables), [pirsTables]);
  const allTablesForNarrative = useMemo(() => {
    const prev = previousAssessorPirs.map((p) => p.table);
    return sortedPirsTables([...pirsTables, ...prev]);
  }, [pirsTables, previousAssessorPirs]);

  const handlePirsCategoryFocus = useCallback((index: number) => {
    const cat = PIRS_CATEGORIES[index];
    if (!cat) return;
    setActivePirsCategory(cat.key);
  }, []);

  const activeCategoryIndex = pirsKeyToIndex(activePirsCategory);
  const currentPirsTable = pirsTables.find((t) => t.name === "Current PIRS");
  const inPirs = activeSection?.id === "pirs";

  return (
    <div className="flex h-full overflow-hidden bg-slate-100">
      {/* LEFT SIDEBAR — PIRS category nav (PIRS section only) */}
      {inPirs && (
        <div className="w-44 bg-white border-r flex flex-col shrink-0">
          <div className="px-3 py-2 border-b">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Category</p>
          </div>
          <nav className="flex-1 overflow-y-auto p-1.5">
            {PIRS_CATEGORIES.map((cat) => {
              const cls = currentPirsTable?.classes[cat.index] ?? 1;
              const isActive = activePirsCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActivePirsCategory(cat.key)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 flex items-center justify-between transition ${
                    isActive
                      ? "bg-violet-100 text-violet-700 font-medium"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    cls >= 4 ? "bg-red-100 text-red-700" :
                    cls >= 3 ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-500"
                  }`}>{cls}</span>
                </button>
              );
            })}
          </nav>
          <div className="p-2 border-t space-y-1">
            <button
              className="w-full text-[11px] px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40"
              disabled={pirsTables.some((t) => t.name === "Current PIRS")}
              onClick={() => addPIRSTable("Current PIRS")}
            >+ Current PIRS</button>
            <button
              className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={pirsTables.some((t) => t.name === "Pre-injury PIRS")}
              onClick={() => addPIRSTable("Pre-injury PIRS")}
            >+ Pre-injury</button>
            <button
              className="w-full text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
              onClick={() => addPIRSTable("Previous Assessor PIRS")}
            >+ Prev. Assessor</button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {!activeSection && (
            <div className="card text-sm text-slate-500">
              Section not available for this referrer.
            </div>
          )}

          {/* Generic schema-driven section */}
          {activeSection && !inPirs && (
            <div className="card space-y-4">
              <h2 className="section-title">{activeSection.title}</h2>
              {activeSection.fields.map((field: { key: string; label: string; type?: "text" | "textarea" | "number" | "select" }) => (
                <Field
                  key={field.key}
                  label={field.label}
                  type={field.type ?? "text"}
                  value={fields[field.key]}
                  onChange={(v) => setReportFields({ ...fields, [field.key]: v })}
                />
              ))}
            </div>
          )}

          {/* PIRS — per-category structured entry */}
          {inPirs && (
            <div className="space-y-6">
              <div className="card">
                <h2 className="section-title mb-4">{pirsKeyToLabel(activePirsCategory)}</h2>
                <PIRSCategoryEntry
                  categoryKey={activePirsCategory}
                  categoryIndex={activeCategoryIndex}
                  table={currentPirsTable}
                  onUpdateTable={(updated) => updatePirsTable(updated.id, updated)}
                  subjectGender={client.identity?.gender}
                  relationships={activePirsCategory === "socialFunction" ? relationships : undefined}
                  onRelationshipsChange={activePirsCategory === "socialFunction" ? setRelationships : undefined}
                />
              </div>

              <div className="space-y-4">
                {displayPirsTables.map((t) => (
                  <div key={t.id} className="card card-hover">
                    <PIRSTable
                      table={t}
                      update={(updated) => updatePirsTable(t.id, { ...updated, id: t.id })}
                      onCategoryFocus={handlePirsCategoryFocus}
                    />
                  </div>
                ))}
              </div>

              {previousAssessorPirs.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-700 border-t pt-3">Previous Assessor PIRS</h3>
                  {[...previousAssessorPirs]
                    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
                    .map((entry) => (
                      <div key={entry.id} className="card card-hover space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="label">Date</label>
                            <input type="date" className="input" value={entry.date}
                              onChange={(e) => updatePrevAssessor(entry.id, { ...entry, date: e.target.value })} />
                          </div>
                          <div>
                            <label className="label">Author</label>
                            <input className="input" value={entry.author}
                              onChange={(e) => updatePrevAssessor(entry.id, { ...entry, author: e.target.value })} />
                          </div>
                          <div>
                            <label className="label">Role</label>
                            <input className="input" value={entry.authorRole}
                              onChange={(e) => updatePrevAssessor(entry.id, { ...entry, authorRole: e.target.value })} />
                          </div>
                        </div>
                        <PIRSTable
                          table={entry.table}
                          update={(updated) =>
                            updatePrevAssessor(entry.id, { ...entry, table: { ...updated, id: entry.table.id } })
                          }
                          onCategoryFocus={handlePirsCategoryFocus}
                        />
                      </div>
                    ))}
                </div>
              )}

              <div className="bg-slate-50 border rounded-xl p-4 text-sm whitespace-pre-wrap">
                {buildPIRSNarrative({ pirsTables: allTablesForNarrative })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL — PIRS Decision Assistant (PIRS section only) */}
      {inPirs && (
        <div className="w-72 bg-white border-l flex flex-col shrink-0 overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {pirsKeyToLabel(activePirsCategory)} — Reference
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-600">
            <div>
              <p className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide mb-2">
                Class Definitions — {pirsKeyToLabel(activePirsCategory)}
              </p>
              <div className="space-y-3">
                {(PIRS_DEFINITIONS[activePirsCategory] ?? []).map((d) => {
                  const selected = currentPirsTable?.classes[activeCategoryIndex] === d.cls;
                  return (
                    <div
                      key={d.cls}
                      className={`rounded-lg p-2.5 border text-[11px] leading-relaxed ${
                        selected
                          ? "bg-violet-50 border-violet-300 text-violet-900"
                          : "border-slate-100 text-slate-600"
                      }`}
                    >
                      <span className={`font-bold mr-1.5 ${selected ? "text-violet-700" : "text-slate-800"}`}>
                        Class {d.cls}
                      </span>
                      {d.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {previousAssessorPirs.length > 0 && (
              <div className="space-y-3 border-t pt-3">
                <p className="font-semibold text-slate-700 text-[11px] uppercase tracking-wide">
                  Previous Assessors — {pirsKeyToLabel(activePirsCategory)}
                </p>
                {[...previousAssessorPirs]
                  .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
                  .map((entry) => {
                    const cls = entry.table.classes[activeCategoryIndex] ?? "—";
                    const narrative = entry.table.reasons?.[activeCategoryIndex]?.findings ?? "";
                    return (
                      <div key={entry.id} className="pb-3 border-b border-slate-100 last:border-0 space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-slate-800 leading-tight">
                            {entry.date ? formatDateShort(entry.date) : ""}
                            {entry.author ? ` — ${entry.author}` : ""}
                          </span>
                          <span className="font-bold text-slate-700 shrink-0">Class {cls}</span>
                        </div>
                        {entry.authorRole && (
                          <p className="text-[11px] text-slate-400">{entry.authorRole}</p>
                        )}
                        {narrative && (
                          <p className="text-slate-600 italic leading-snug">"{narrative}"</p>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {previousAssessorPirs.length === 0 && (
              <p className="text-[11px] text-slate-400 italic">No previous assessor entries.</p>
            )}

            <p className="text-[10px] text-slate-300 border-t pt-3 leading-relaxed">
              Source-attributed only. No inferences, rankings, or suggestions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
