// Capture Workspace — production clinician input surface.
// Reproduces the functional workflow of the case-workspace-v4 prototype using
// EXISTING MedicoApp types and the existing controlled-page persistence pattern
// ({ client, onClientChange } → parent autosaves via buildSaveBlob).
//
// Strictly a frontend capture surface: no new ontology, no ReferenceEntity, no
// backend/engine/rules changes. Free-text is parsed into structured drafts the
// clinician edits/removes, then committed into:
//   • HistoryEvent      → psychiatricHistory.preExistingEvents / subsequentEvents
//   • TreatmentEntry    → psychiatricHistory.treatmentHistory.treatments
//   • WorkHistoryEntry  → psychiatricHistory.workHistory
//   • DSMTimelineEvent  → dsmAssessment.timelineEvents  (optional, non-blocking)

import { useState, useCallback } from "react";
import type { Client } from "../types/client";
import {
  defaultPsychiatricHistory,
  type PsychiatricHistory,
  type HistoryEvent,
  type HistoryCategory,
  type HistoryTiming,
  type TreatmentEntry,
  type TreatmentCategory,
  type WorkHistoryEntry,
} from "../types/history";
import {
  defaultDSMAssessmentData,
  type DSMAssessmentData,
  type DSMTimelineEvent,
} from "../types/dsm";

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// ── Extraction (local, rule-based — mirrors the prototype lexicon) ─────────────
type Kind = "symptom" | "event" | "treatment" | "work";

const HISTORY_CATEGORIES: HistoryCategory[] = [
  "psychiatric", "psychological", "medical", "family", "relationship", "trauma", "work", "other",
];
const TREATMENT_CATEGORIES: TreatmentCategory[] = [
  "medication", "psychological", "psychiatric", "gp", "hospital", "group_program", "neuromodulation", "other",
];

type LexEntry = { re: RegExp; kind: Kind; label: string; category: string };
const LEX: LexEntry[] = [
  // symptoms → emitted as DSMTimelineEvent(onset)
  { re: /\b(low mood|depressed|depression|feeling down|flat)\b/i, kind: "symptom", label: "Depressed mood", category: "" },
  { re: /\b(anhedonia|no interest|lost interest|no enjoyment)\b/i, kind: "symptom", label: "Anhedonia", category: "" },
  { re: /\b(nightmare|nightmares|bad dreams)\b/i, kind: "symptom", label: "Nightmares", category: "" },
  { re: /\b(flashback|flashbacks|intrusive|reliving)\b/i, kind: "symptom", label: "Flashbacks", category: "" },
  { re: /\b(hypervigil|on edge|on guard|startle|jumpy)\b/i, kind: "symptom", label: "Hypervigilance", category: "" },
  { re: /\b(anxious|anxiety|panic|on edge)\b/i, kind: "symptom", label: "Anxiety", category: "" },
  { re: /\b(insomnia|poor sleep|couldn'?t sleep|cant sleep|not sleeping|trouble sleeping)\b/i, kind: "symptom", label: "Sleep disturbance", category: "" },
  // events → HistoryEvent
  { re: /\b(injury|injured|accident|the accident)\b/i, kind: "event", label: "Index injury", category: "trauma" },
  { re: /\b(assault|attack|incident)\b/i, kind: "event", label: "Incident", category: "trauma" },
  { re: /\b(bullying|bullied|harassment)\b/i, kind: "event", label: "Workplace bullying", category: "work" },
  { re: /\b(disciplinary|warning|performance review)\b/i, kind: "event", label: "Disciplinary meeting", category: "work" },
  { re: /\b(divorce|separation|separated|breakup)\b/i, kind: "event", label: "Relationship breakdown", category: "relationship" },
  { re: /\b(bereavement|passed away|death of|died)\b/i, kind: "event", label: "Bereavement", category: "relationship" },
  // work → WorkHistoryEntry
  { re: /\b(lost (my )?job|terminated|sacked|made redundant|dismissed|resigned|stopped working)\b/i, kind: "work", label: "Employment ended", category: "" },
  { re: /\b(returned to work|return to work|back to work)\b/i, kind: "work", label: "Return to work", category: "" },
  // treatments → TreatmentEntry
  { re: /\b(emdr)\b/i, kind: "treatment", label: "EMDR", category: "psychological" },
  { re: /\b(cbt|psychotherapy|counselling|counseling|therapy)\b/i, kind: "treatment", label: "Psychological therapy", category: "psychological" },
  { re: /\b(sertraline|fluoxetine|mirtazapine|venlafaxine|escitalopram|citalopram|ssri|snri|antidepressant|medication)\b/i, kind: "treatment", label: "Medication", category: "medication" },
];

function detectTimeAnchor(t: string): string {
  if (/since (the )?injury|after (the )?injury|post.?injury|after the accident/i.test(t)) return "post-injury";
  const wk = /\+?\s*(\d+)\s*(?:wk|week|weeks)\b/i.exec(t); if (wk) return `+${wk[1]}wk`;
  const mo = /\+?\s*(\d+)\s*(?:month|months|mo)\b/i.exec(t); if (mo) return `+${mo[1]}mo`;
  const yr = /(\d+)\s*(?:year|years|yr)s?\s*ago/i.exec(t); if (yr) return `${yr[1]}y ago`;
  if (/childhood|as a child|growing up/i.test(t)) return "childhood";
  return "";
}
function detectTiming(t: string, anchor: string): HistoryTiming {
  if (/\b(before|prior to|pre-?existing|pre-?injury)\b/i.test(t) || anchor === "childhood" || /y ago$/.test(anchor)) return "pre_existing";
  return "subsequent";
}

export type Draft = {
  id: string;
  kind: Kind;
  label: string;
  category: string;     // HistoryCategory | TreatmentCategory (kind-dependent)
  timing: HistoryTiming;
  timeAnchor: string;
  raw: string;
};

function parse(text: string): Draft[] {
  const t = text.trim();
  if (!t) return [];
  const anchor = detectTimeAnchor(t);
  const timing = detectTiming(t, anchor);
  const seen = new Set<string>();
  const out: Draft[] = [];
  for (const l of LEX) {
    if (l.re.test(t) && !seen.has(l.label)) {
      seen.add(l.label);
      out.push({ id: uid(), kind: l.kind, label: l.label, category: l.category, timing, timeAnchor: anchor, raw: t });
    }
  }
  if (out.length === 0) {
    // nothing recognised — keep the utterance as an editable generic event
    out.push({ id: uid(), kind: "event", label: t, category: "other", timing, timeAnchor: anchor, raw: t });
  }
  return out;
}

// ── Commit: drafts → real typed objects on the client (one update per commit) ──
function applyDraft(client: Client, d: Draft): Client {
  const ph: PsychiatricHistory = client.psychiatricHistory ?? defaultPsychiatricHistory();

  if (d.kind === "symptom") {
    const dsm: DSMAssessmentData = client.dsmAssessment ?? defaultDSMAssessmentData();
    const ev: DSMTimelineEvent = {
      id: uid(),
      type: "onset",
      description: d.timeAnchor ? `${d.label} (${d.timeAnchor})` : d.label,
    };
    return { ...client, dsmAssessment: { ...dsm, timelineEvents: [...dsm.timelineEvents, ev] } };
  }

  if (d.kind === "treatment") {
    const entry: TreatmentEntry = {
      id: uid(),
      category: (TREATMENT_CATEGORIES.includes(d.category as TreatmentCategory) ? d.category : "other") as TreatmentCategory,
      name: d.label,
      current: true,
      ...(d.timeAnchor ? { indication: d.timeAnchor } : {}),
    };
    return {
      ...client,
      psychiatricHistory: {
        ...ph,
        treatmentHistory: { ...ph.treatmentHistory, treatments: [...ph.treatmentHistory.treatments, entry] },
      },
    };
  }

  if (d.kind === "work") {
    const entry: WorkHistoryEntry = {
      id: uid(),
      reasonForLeaving: d.label,
      ...(d.timeAnchor ? { notes: d.timeAnchor } : {}),
    };
    return { ...client, psychiatricHistory: { ...ph, workHistory: [...ph.workHistory, entry] } };
  }

  // event → HistoryEvent
  const event: HistoryEvent = {
    id: uid(),
    title: d.label,
    category: (HISTORY_CATEGORIES.includes(d.category as HistoryCategory) ? d.category : "other") as HistoryCategory,
    timing: d.timing,
    sourceType: "claimant",
    ...(d.timeAnchor ? { claimantClarification: d.timeAnchor } : {}),
  };
  const key = d.timing === "pre_existing" ? "preExistingEvents" : "subsequentEvents";
  return { ...client, psychiatricHistory: { ...ph, [key]: [...ph[key], event] } };
}

// ── UI ─────────────────────────────────────────────────────────────────────────
const KIND_LABEL: Record<Kind, string> = { symptom: "Symptom", event: "Event", treatment: "Treatment", work: "Work" };
const KIND_DEST: Record<Kind, string> = {
  symptom: "→ DSM timeline (onset)", event: "→ History event", treatment: "→ Treatment", work: "→ Work history",
};
const EXAMPLES = [
  "couldn't sleep since injury",
  "started EMDR after injury",
  "lost job 3 months after accident",
  "low mood and flashbacks",
  "bullying at work before the injury",
];

export type CaptureWorkspaceProps = { client: Client; onClientChange: (updated: Client) => void };

export default function CaptureWorkspace({ client, onClientChange }: CaptureWorkspaceProps) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const submit = useCallback(() => {
    const next = parse(text);
    if (next.length) setDrafts((d) => [...next, ...d]);
    setText("");
  }, [text]);

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const remove = (id: string) => setDrafts((ds) => ds.filter((d) => d.id !== id));

  const commitOne = (d: Draft) => { onClientChange(applyDraft(client, d)); remove(d.id); };
  const commitAll = () => {
    if (!drafts.length) return;
    const next = drafts.reduceRight((acc, d) => applyDraft(acc, d), client); // preserve display order
    onClientChange(next);
    setDrafts([]);
  };

  const ph = client.psychiatricHistory;
  const dsm = client.dsmAssessment;
  const events = [...(ph?.preExistingEvents ?? []), ...(ph?.subsequentEvents ?? [])];
  const treatments = ph?.treatmentHistory?.treatments ?? [];
  const work = ph?.workHistory ?? [];
  const timeline = dsm?.timelineEvents ?? [];

  const group = (k: Kind) => drafts.filter((d) => d.kind === k);
  const anchors = drafts.filter((d) => d.timeAnchor);

  return (
    <div className="h-full flex gap-4 p-4 overflow-hidden text-slate-800">
      {/* LEFT — capture + drafts */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="text-violet-600 font-mono text-lg">⌘</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            placeholder="Capture… e.g. couldn't sleep since injury"
            className="flex-1 h-11 rounded-lg border-2 border-violet-200 focus:border-violet-500 outline-none px-3 text-[15px]"
            autoComplete="off"
          />
          <button type="button" onClick={submit} className="h-11 px-4 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">Add ↵</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setText(e)} className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-500 hover:text-violet-700 hover:border-violet-300">{e}</button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Extracted entities <span className="text-slate-400">({drafts.length})</span></h2>
          <button type="button" onClick={commitAll} disabled={!drafts.length}
            className="text-xs px-3 py-1.5 rounded-md bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700">Commit all</button>
        </div>

        {/* live preview grouped by kind */}
        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>{group("symptom").length} symptoms</span>
          <span>{group("event").length} events</span>
          <span>{group("treatment").length} treatments</span>
          <span>{group("work").length} work</span>
          <span>{anchors.length} time anchors</span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {drafts.length === 0 && (
            <p className="text-xs text-slate-400">Type a fragment above and press Enter. Parsed entities appear here — edit or remove before committing.</p>
          )}
          {drafts.map((d) => (
            <div key={d.id} className="border border-slate-200 rounded-lg p-2.5 bg-white">
              <div className="flex items-center gap-2 flex-wrap">
                <select value={d.kind} onChange={(e) => patch(d.id, { kind: e.target.value as Kind })}
                  className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-slate-50">
                  {(["symptom", "event", "treatment", "work"] as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <input value={d.label} onChange={(e) => patch(d.id, { label: e.target.value })}
                  className="flex-1 min-w-[120px] text-sm border border-slate-200 rounded px-2 py-1" />
                <span className="text-[10px] text-slate-400">{KIND_DEST[d.kind]}</span>
                <button type="button" onClick={() => commitOne(d)} className="text-[11px] px-2 py-1 rounded border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">Commit</button>
                <button type="button" onClick={() => remove(d.id)} className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:text-red-600">Remove</button>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] text-slate-500">
                {d.kind === "event" && (
                  <>
                    <select value={d.category} onChange={(e) => patch(d.id, { category: e.target.value })} className="border border-slate-200 rounded px-1.5 py-1">
                      {HISTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={d.timing} onChange={(e) => patch(d.id, { timing: e.target.value as HistoryTiming })} className="border border-slate-200 rounded px-1.5 py-1">
                      {(["pre_existing", "subsequent", "current"] as HistoryTiming[]).map((tm) => <option key={tm} value={tm}>{tm}</option>)}
                    </select>
                  </>
                )}
                {d.kind === "treatment" && (
                  <select value={d.category} onChange={(e) => patch(d.id, { category: e.target.value })} className="border border-slate-200 rounded px-1.5 py-1">
                    {TREATMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <label className="flex items-center gap-1">time anchor
                  <input value={d.timeAnchor} onChange={(e) => patch(d.id, { timeAnchor: e.target.value })} placeholder="—"
                    className="w-24 border border-slate-200 rounded px-1.5 py-0.5 font-mono" /></label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT — case summary (committed) */}
      <aside className="w-80 shrink-0 border-l border-slate-200 pl-4 overflow-y-auto">
        <h2 className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase mb-2">Case summary</h2>
        <Section title={`History events (${events.length})`} items={events.map((e) => `${e.title ?? "(untitled)"} · ${e.category} · ${e.timing}`)} />
        <Section title={`Treatments (${treatments.length})`} items={treatments.map((t) => `${t.name || "(unnamed)"} · ${t.category}`)} />
        <Section title={`Work history (${work.length})`} items={work.map((w) => w.reasonForLeaving || w.role || w.employer || "(entry)")} />
        <Section title={`DSM timeline (${timeline.length})`} items={timeline.map((t) => `${t.type}: ${t.description}`)} />
      </aside>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-3">
      <h3 className="text-[11px] font-semibold text-slate-700 mb-1">{title}</h3>
      {items.length === 0
        ? <p className="text-[11px] text-slate-400">none</p>
        : <ul className="space-y-0.5">{items.map((s, i) => <li key={i} className="text-[12px] text-slate-600 leading-snug">{s}</li>)}</ul>}
    </div>
  );
}
