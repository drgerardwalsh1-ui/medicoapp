// ── Live Assessment — the template IS the interview (Phase 2, rev 2) ──────────
// One continuously-scrolling canvas rendered from the selected interview
// template (the clinician's clone-and-adjust library, mirroring their Word
// MasterTemplate workflow):
//   • Left rail — the interview script: every section with live coverage,
//     the at-a-glance "what's left to cover".
//   • Centre — scrolling sections. Symptom sections render tri-state probe
//     chips (click cycles not-asked → present → denied → not-asked); an
//     undocumented negative is a visible hole, so "not asked" is distinct.
//   • Bottom — the omnibox, demoted to an accelerator: capture anything from
//     anywhere; it lands in the canonical store and ticks the right probe.
//   • Right — context rail (DSM / PIRS / discrepancy projections).
//
// State doctrine unchanged: the observation log is a projection cache of the
// Rust fact spine; every chip action is an append (edits and removals carry
// the same observation id; nothing is rewritten).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Client } from "../types/client";
import type { Observation } from "../types/observation";
import type { ObservationId, SymptomTypeId } from "../types/ontology";
import type { InterviewTemplate } from "../types/interviewTemplate";
import { parseOmniboxInput } from "../engine/omnibox";
import { computeCoverage, uncoveredItems } from "../engine/interviewCoverage";
import { listTemplates, getTemplate, storageArea } from "../engine/templateStore";
import { MSE_DOMAINS } from "../data/mseDomains";
import { CONCEPT_REGISTRY } from "../ontology/canonicalOntology";
import TemplateManager from "../components/TemplateManager";
import { isTauri, TauriAPI } from "../api/tauriApi";
import { isPersistedClientId } from "../types/client";
import {
  buildCandidateFacts,
  candidatesBySymptom,
  verificationQueue,
  type CandidateFact,
  type ExtractedClinicalEvent,
} from "../integration/candidateFacts";
import {
  appendObservation,
  hydrateClinicalState,
} from "../integration/clinicalSpine";
import { applyObservationToClient } from "../integration/liveAxBridge";
import ContextRail from "../components/ContextRail";

type SyncStatus = "local" | "syncing" | "synced" | "error";

type Props = {
  client: Client;
  /** Navigate to a sibling tab (MSE / PIRS sections link out). */
  onNavigateToTab?: (tab: string) => void;
  /** Flow-through: Live Ax captures update the shared SymptomEntity store /
   *  MoodState on the client blob, so the Current Symptoms, DSM, and MSE
   *  pages reflect them immediately (integration/liveAxBridge.ts). */
  onClientChange?: (client: Client) => void;
  /** Pre-built candidate facts. When provided, the page uses these instead of
   *  loading from the backend extraction (injection seam for tests / a shared
   *  candidate cache). */
  initialCandidates?: CandidateFact[];
};

function newProvenance(entrySource: "chip" | "toggle" | "review_action") {
  return {
    clinicianId: "interviewer",
    at: new Date().toISOString(),
    entrySource,
  } as const;
}

// MSE canvas groups: ontology-linked entities per MSE domain (the full MSE
// chip panel — appearance, speech, affect descriptors — lives on the MSE tab;
// the canvas captures the observed counterparts of reported symptoms, which
// is where reported-vs-observed discrepancies arise).
const MSE_LINKED_GROUPS = MSE_DOMAINS.filter(
  (d) => (d.linkedEntities ?? []).length > 0,
).map((d) => ({
  domainId: d.id,
  label: d.label,
  entities: (d.linkedEntities ?? []).map((id) => ({
    symptomTypeId: id,
    label: CONCEPT_REGISTRY.get(id)?.label ?? id.replace(/_/g, " "),
  })),
}));

function ticksStorageKey(clientId: string) {
  return `interviewTicks.v1:${clientId}`;
}

function loadTicks(clientId: string): Set<string> {
  try {
    const raw = storageArea()?.getItem(ticksStorageKey(clientId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

type CandidateAction = "confirmed" | "contested";

function actionsStorageKey(clientId: string) {
  return `candidateActions.v1:${clientId}`;
}

function loadCandidateActions(clientId: string): Record<string, CandidateAction> {
  try {
    const raw = storageArea()?.getItem(actionsStorageKey(clientId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Map a candidate's presence onto an observation presence (uncertain →
// "unknown": surfaced, but never counted as present/absent until resolved).
function candidatePresence(c: CandidateFact): Observation["presence"] {
  return c.presence === "uncertain" ? "unknown" : c.presence;
}

export default function LiveAssessmentPage({
  client,
  onNavigateToTab,
  onClientChange,
  initialCandidates,
}: Props) {
  const referenceInjuryDate = client.clinical?.injury?.dateOfInjury ?? undefined;
  const [observations, setObservations] = useState<Observation[]>([]);
  const [manualTicks, setManualTicks] = useState<ReadonlySet<string>>(() =>
    loadTicks(client.id),
  );
  const [templateId, setTemplateId] = useState<string>(() => listTemplates()[0].id);
  const [templates, setTemplates] = useState<InterviewTemplate[]>(() => listTemplates());
  const [managerOpen, setManagerOpen] = useState(false);
  const [input, setInput] = useState("");
  const [altIndex, setAltIndex] = useState(0);
  const [sync, setSync] = useState<SyncStatus>("local");
  const [showAudit, setShowAudit] = useState(false);
  const [candidates, setCandidates] = useState<CandidateFact[]>(initialCandidates ?? []);
  const [candidateActions, setCandidateActions] = useState<Record<string, CandidateAction>>(
    () => loadCandidateActions(client.id),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  // Latest client blob for the flow-through bridge: rapid successive captures
  // between renders must compound onto the freshest blob, not a stale prop.
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  const template = getTemplate(templateId) ?? templates[0];
  const spineEnabled = isTauri && isPersistedClientId(client.id);

  useEffect(() => {
    if (!spineEnabled) return;
    let cancelled = false;
    setSync("syncing");
    hydrateClinicalState(client.id)
      .then((state) => {
        if (cancelled) return;
        setObservations([...state.observationLog]);
        setSync("synced");
      })
      .catch(() => !cancelled && setSync("error"));
    return () => {
      cancelled = true;
    };
  }, [client.id, spineEnabled]);

  // Load candidate facts from the persisted, deterministically-extracted
  // clinical events (the brief). They surface as confirm-or-contest, never
  // auto-asserted (zero-hallucination).
  useEffect(() => {
    if (!spineEnabled || initialCandidates) return; // injected candidates win
    let cancelled = false;
    TauriAPI.getClientExtraction(client.id)
      .then((json) => {
        if (cancelled) return;
        const docs = JSON.parse(json) as Array<{
          clinical_events?: ExtractedClinicalEvent[];
        }>;
        const events = docs.flatMap((d) => d.clinical_events ?? []);
        setCandidates(buildCandidateFacts(events));
      })
      .catch(() => {
        /* no extraction yet — candidates stay empty */
      });
    return () => {
      cancelled = true;
    };
  }, [client.id, spineEnabled, initialCandidates]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const persist = useCallback(
    (obs: Observation) => {
      setObservations((prev) => [...prev, obs]);
      // Flow-through to the shared entity store (Current Symptoms / DSM /
      // MSE linked + shared-mood domains read it).
      if (onClientChange) {
        const next = applyObservationToClient(clientRef.current, obs);
        if (next !== clientRef.current) {
          clientRef.current = next;
          onClientChange(next);
        }
      }
      if (!spineEnabled) return;
      setSync("syncing");
      appendObservation(client.id, obs)
        .then(() => setSync("synced"))
        .catch(() => setSync("error"));
    },
    [client.id, spineEnabled, onClientChange],
  );

  // The live (latest non-tombstoned) subjective observation for a concept.
  // ONE chain per concept+frame: chips and the omnibox amend the SAME
  // observation id (append-only versioning) — they never fork parallel
  // facts, so a chip-set "present" and a typed "no …" always converge.
  const liveObservationFor = useCallback(
    (
      symptomTypeId: string,
      frame: Observation["frame"] = "subjective",
    ): Observation | undefined => {
      const latestById = new Map<string, Observation>();
      for (const o of observations) {
        if ((o.symptomTypeId as string) === symptomTypeId && o.frame === frame)
          latestById.set(o.id as string, o);
      }
      return [...latestById.values()].filter((o) => !o.tombstoned).at(-1);
    },
    [observations],
  );

  // Tri-state probe cycle: not-asked → present → denied → not-asked.
  // Each step is an APPEND; "back to not-asked" is a tombstone of the chain.
  // Frame-scoped: subjective chips (symptom sections) and observed chips
  // (MSE section) maintain SEPARATE chains — reported ≠ observed, always.
  const cycleProbe = useCallback(
    (symptomTypeId: string, frame: Observation["frame"] = "subjective") => {
      const live = liveObservationFor(symptomTypeId, frame);

      if (!live) {
        persist({
          id: crypto.randomUUID() as ObservationId,
          symptomTypeId: symptomTypeId as SymptomTypeId,
          frame,
          presence: "present",
          provenance: newProvenance("chip"),
        });
      } else if (live.presence === "present") {
        persist({ ...live, presence: "absent", provenance: newProvenance("toggle") });
      } else {
        persist({ ...live, tombstoned: true, provenance: newProvenance("review_action") });
      }
    },
    [liveObservationFor, persist],
  );

  const recordAction = useCallback(
    (candidateId: string, action: CandidateAction) => {
      setCandidateActions((prev) => {
        const next = { ...prev, [candidateId]: action };
        try {
          storageArea()?.setItem(actionsStorageKey(client.id), JSON.stringify(next));
        } catch {
          /* session-only */
        }
        return next;
      });
    },
    [client.id],
  );

  // Confirm a documented candidate: assert (or amend) the subjective fact for
  // its concept with the extractor's presence, then mark it confirmed so it
  // leaves the "from the brief" strip. Onset carries the document date when
  // present so the epoch is derived, not re-asked.
  const confirmCandidate = useCallback(
    (c: CandidateFact) => {
      if (c.symptomTypeId) {
        const live = liveObservationFor(c.symptomTypeId);
        persist({
          ...(live ?? {
            id: crypto.randomUUID() as ObservationId,
            symptomTypeId: c.symptomTypeId as SymptomTypeId,
            frame: "subjective" as const,
          }),
          presence: candidatePresence(c),
          onset: c.provenance.date ?? live?.onset,
          provenance: newProvenance("review_action"),
        });
      }
      recordAction(c.candidateId, "confirmed");
    },
    [liveObservationFor, persist, recordAction],
  );

  const contestCandidate = useCallback(
    (c: CandidateFact) => recordAction(c.candidateId, "contested"),
    [recordAction],
  );

  // Mapped symptom candidates not yet acted on, indexed by concept.
  const pendingBySymptom = useMemo(() => {
    const pending = candidates.filter((c) => !candidateActions[c.candidateId]);
    return candidatesBySymptom(pending);
  }, [candidates, candidateActions]);

  // Verification queue (unmapped symptoms + diagnoses + medications) not acted.
  const queue = useMemo(
    () => verificationQueue(candidates).filter((c) => !candidateActions[c.candidateId]),
    [candidates, candidateActions],
  );

  const proposal = useMemo(
    () => parseOmniboxInput(input, referenceInjuryDate),
    [input, referenceInjuryDate],
  );
  const selected = useMemo(() => {
    if (!proposal) return null;
    if (altIndex === 0) return { symptomTypeId: proposal.symptomTypeId, label: proposal.label };
    return proposal.alternatives[altIndex - 1] ?? { symptomTypeId: proposal.symptomTypeId, label: proposal.label };
  }, [proposal, altIndex]);

  const assertProposal = useCallback(() => {
    if (!proposal || !selected) return;
    // Amend the live chain when this concept already has a fact (so a typed
    // "no si" flips the chip-set "present" and vice versa). New fields from
    // the proposal override; everything else carries forward. Only a concept
    // with no live fact mints a new observation id.
    const live = liveObservationFor(selected.symptomTypeId);
    persist({
      ...(live ?? {
        id: crypto.randomUUID() as ObservationId,
        symptomTypeId: selected.symptomTypeId as SymptomTypeId,
        frame: "subjective" as const,
      }),
      presence: proposal.presence,
      severity: proposal.severity ?? live?.severity,
      frequencyCount: proposal.frequencyCount ?? live?.frequencyCount,
      frequencyUnit: proposal.frequencyUnit ?? live?.frequencyUnit,
      durationCount: proposal.durationCount ?? live?.durationCount,
      durationUnit: proposal.durationUnit ?? live?.durationUnit,
      onset: proposal.onset ?? live?.onset,
      note: proposal.note ?? live?.note,
      provenance: newProvenance("chip"),
    });
    setInput("");
    setAltIndex(0);
  }, [proposal, selected, liveObservationFor, persist]);

  const coverage = useMemo(
    () => computeCoverage(template, observations, manualTicks),
    [template, observations, manualTicks],
  );
  const totals = useMemo(
    () =>
      coverage.reduce(
        (acc, c) => ({ touched: acc.touched + c.touched, total: acc.total + c.total }),
        { touched: 0, total: 0 },
      ),
    [coverage],
  );
  const remaining = useMemo(() => uncoveredItems(coverage), [coverage]);

  const scrollToSection = (id: string) =>
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const toggleManualTick = (id: string) =>
    setManualTicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        storageArea()?.setItem(ticksStorageKey(client.id), JSON.stringify([...next]));
      } catch {
        // Storage unavailable — ticks live for this session only.
      }
      return next;
    });

  const syncLabel: Record<SyncStatus, string> = {
    local: "in-memory",
    syncing: "syncing…",
    synced: "event log ✓",
    error: "sync failed — facts kept locally",
  };

  return (
    <div className="relative flex h-full bg-slate-100" data-testid="live-assessment">
      {/* ── Interview script rail (at-a-glance coverage) ── */}
      <nav
        className="w-52 shrink-0 border-r border-slate-200 bg-white overflow-y-auto text-xs"
        data-testid="script-rail"
      >
        <div className="px-3 pt-3 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-1">
            <select
              value={template.id}
              onChange={(e) => setTemplateId(e.target.value)}
              className="flex-1 min-w-0 text-xs border border-slate-300 rounded px-1.5 py-1 bg-white"
              data-testid="template-picker"
              title="Interview template (clone & adjust in template manager)"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setManagerOpen(true)}
              className="px-1.5 py-1 text-slate-400 hover:text-slate-700 border border-slate-300 rounded text-xs"
              title="Manage templates (clone & adjust)"
              data-testid="open-template-manager"
            >
              ⚙
            </button>
          </div>
          <div className="mt-1.5 text-[10px] text-slate-400">
            Coverage {totals.touched}/{totals.total} · {syncLabel[sync]}
          </div>
        </div>
        {coverage.map((c) => (
          <button
            key={c.section.id}
            type="button"
            onClick={() => scrollToSection(c.section.id)}
            className="w-full text-left px-3 py-1.5 flex items-center gap-1.5 hover:bg-slate-50"
          >
            <span
              className={
                c.complete
                  ? "text-emerald-600"
                  : c.touched > 0
                    ? "text-violet-600"
                    : "text-slate-300"
              }
            >
              {c.complete ? "●" : c.touched > 0 ? "◐" : "○"}
            </span>
            <span className="flex-1 truncate text-slate-700">{c.section.title}</span>
            {c.section.kind === "symptomDomain" && (
              <span className="text-[10px] text-slate-400 tabular-nums">
                {c.touched}/{c.total}
              </span>
            )}
          </button>
        ))}
        <div className="px-3 py-2 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowAudit((v) => !v)}
            className="text-[11px] text-violet-700 hover:underline"
          >
            {remaining.length} items not yet covered
          </button>
        </div>
      </nav>

      {/* ── Scrolling interview canvas ── */}
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Verification queue — extracted facts that didn't map to a probe
              (unmapped symptoms, diagnoses, medications). Triaged manually;
              nothing auto-asserts. */}
          {queue.length > 0 && (
            <div
              className="bg-sky-50 border border-sky-200 rounded p-3 text-xs"
              data-testid="verification-queue"
            >
              <div className="font-medium text-sky-800 mb-1.5">
                From the brief — needs verification ({queue.length})
              </div>
              <ul className="space-y-1">
                {queue.map((cand) => (
                  <li key={cand.candidateId} className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-white border border-sky-200 text-[10px] uppercase tracking-wide text-sky-700">
                      {cand.kind}
                    </span>
                    <span className="font-medium text-slate-800">{cand.label}</span>
                    <span
                      className="text-slate-400 truncate max-w-[18rem]"
                      title={`${cand.provenance.snippet}${
                        cand.provenance.author ? ` — ${cand.provenance.author}` : ""
                      }${cand.provenance.page ? ` p.${cand.provenance.page}` : ""}`}
                    >
                      “{cand.provenance.snippet}”
                    </span>
                    <button
                      type="button"
                      onClick={() => confirmCandidate(cand)}
                      className="ml-auto px-1.5 py-0.5 rounded border border-sky-300 text-sky-700 hover:bg-sky-100"
                      title={
                        cand.kind === "symptom"
                          ? "Mark reviewed (unmapped — record manually in the relevant section)"
                          : "Mark reviewed"
                      }
                    >
                      Reviewed
                    </button>
                    <button
                      type="button"
                      onClick={() => contestCandidate(cand)}
                      className="px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100"
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showAudit && (
            <div
              className="bg-amber-50 border border-amber-200 rounded p-3 text-xs"
              data-testid="coverage-audit"
            >
              <div className="font-medium text-amber-800 mb-1">
                Not yet covered ({remaining.length})
              </div>
              {remaining.length === 0 ? (
                <div className="text-emerald-700">Everything covered.</div>
              ) : (
                <ul className="text-amber-700 columns-2 gap-4">
                  {remaining.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {coverage.map((c) => (
            <section
              key={c.section.id}
              ref={(el) => {
                if (el) sectionRefs.current.set(c.section.id, el);
              }}
              className="bg-white rounded border border-slate-200 p-4 scroll-mt-2"
              data-testid={`section-${c.section.id}`}
            >
              <div className="flex items-baseline gap-2 mb-1">
                <h3 className="text-sm font-semibold text-slate-800">{c.section.title}</h3>
                {c.section.kind === "symptomDomain" ? (
                  <span className="text-[10px] text-slate-400">
                    {c.touched}/{c.total} probed
                  </span>
                ) : (
                  <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={manualTicks.has(c.section.id)}
                      onChange={() => toggleManualTick(c.section.id)}
                    />
                    covered
                  </label>
                )}
              </div>
              {c.section.prompt && (
                <div className="text-[11px] text-slate-400 mb-2">{c.section.prompt}</div>
              )}

              {/* From the brief — confirm or contest documented facts for
                  this section's probes. Echo, don't re-ask. */}
              {c.section.kind === "symptomDomain" &&
                (() => {
                  const pending = c.probes.flatMap(
                    (p) => pendingBySymptom.get(p.symptomTypeId) ?? [],
                  );
                  if (pending.length === 0) return null;
                  return (
                    <div
                      className="mb-2 rounded bg-sky-50 border border-sky-200 p-2 space-y-1.5"
                      data-testid={`brief-${c.section.id}`}
                    >
                      <div className="text-[10px] uppercase tracking-wide text-sky-700">
                        From the brief — confirm or contest
                      </div>
                      {pending.map((cand) => (
                        <div key={cand.candidateId} className="flex items-center gap-2 text-xs">
                          <span className="font-medium text-slate-800">{cand.label}</span>
                          <span
                            className={
                              cand.presence === "absent"
                                ? "text-slate-500"
                                : cand.presence === "uncertain"
                                  ? "text-amber-600"
                                  : "text-violet-700"
                            }
                          >
                            {cand.presence === "absent"
                              ? "denied"
                              : cand.presence === "uncertain"
                                ? "queried"
                                : "reported"}
                          </span>
                          {cand.preInjuryHint && (
                            <span className="text-sky-700 text-[10px]">pre-injury</span>
                          )}
                          <span
                            className="text-slate-400 truncate max-w-[16rem]"
                            title={`${cand.provenance.snippet}${
                              cand.provenance.author ? ` — ${cand.provenance.author}` : ""
                            }${cand.provenance.page ? ` p.${cand.provenance.page}` : ""}`}
                          >
                            “{cand.provenance.snippet}”
                          </span>
                          <button
                            type="button"
                            onClick={() => confirmCandidate(cand)}
                            className="ml-auto px-1.5 py-0.5 rounded border border-violet-300 text-violet-700 hover:bg-violet-100"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => contestCandidate(cand)}
                            className="px-1.5 py-0.5 rounded border border-slate-300 text-slate-500 hover:bg-slate-100"
                          >
                            Contest
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}

              {c.section.kind === "symptomDomain" && (
                <div className="flex flex-wrap gap-1.5">
                  {c.probes.map((p) => (
                    <button
                      key={p.symptomTypeId}
                      type="button"
                      onClick={() => cycleProbe(p.symptomTypeId)}
                      title="Click cycles: not asked → present → denied → not asked"
                      className={[
                        "px-2.5 py-1 rounded-full text-xs border transition",
                        p.state === "present"
                          ? "bg-violet-50 border-violet-400 text-violet-800"
                          : p.state === "absent"
                            ? "bg-slate-100 border-slate-300 text-slate-500 line-through"
                            : "bg-white border-dashed border-slate-300 text-slate-500 hover:border-slate-400",
                      ].join(" ")}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}

              {c.section.kind === "mse" && (
                <div className="space-y-2">
                  {/* Observed-frame capture: separate chains from the reported
                      chips above. A reported/observed disagreement is flagged,
                      never merged — it feeds the inconsistency reasoning. */}
                  {MSE_LINKED_GROUPS.map((g) => (
                    <div key={g.domainId} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-slate-400 w-24 shrink-0">
                        {g.label}
                      </span>
                      {g.entities.map((e) => {
                        const observed = liveObservationFor(e.symptomTypeId, "observed");
                        const reported = liveObservationFor(e.symptomTypeId, "subjective");
                        const discrepant =
                          !!observed &&
                          !!reported &&
                          observed.presence !== "unknown" &&
                          reported.presence !== "unknown" &&
                          observed.presence !== reported.presence;
                        return (
                          <button
                            key={e.symptomTypeId}
                            type="button"
                            onClick={() => cycleProbe(e.symptomTypeId, "observed")}
                            title="Observed sign — click cycles: not examined → observed → not observed"
                            className={[
                              "px-2.5 py-1 rounded-full text-xs border transition",
                              observed?.presence === "present"
                                ? "bg-sky-50 border-sky-400 text-sky-800"
                                : observed?.presence === "absent"
                                  ? "bg-slate-100 border-slate-300 text-slate-500 line-through"
                                  : "bg-white border-dashed border-slate-300 text-slate-500 hover:border-slate-400",
                            ].join(" ")}
                          >
                            {e.label}
                            {discrepant && (
                              <span className="ml-1 text-amber-600" title="Disagrees with the client's report">
                                ⚠
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => onNavigateToTab?.("mse")}
                    className="text-xs text-violet-700 hover:underline"
                  >
                    Full MSE workspace (appearance, speech, affect…) →
                  </button>
                </div>
              )}
              {c.section.kind === "pirs" && (
                <button
                  type="button"
                  onClick={() => onNavigateToTab?.("pirs")}
                  className="text-xs text-violet-700 hover:underline"
                >
                  Open the PIRS workspace →
                </button>
              )}
            </section>
          ))}
        </div>

        {/* ── Omnibox — accelerator, docked ── */}
        <div className="border-t border-slate-200 bg-white p-3">
          {input.trim() && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="proposal">
              {proposal && selected ? (
                <>
                  <span className="px-2 py-0.5 rounded-full bg-violet-600 text-white font-medium">
                    {selected.label}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                    {proposal.presence === "absent" ? "denied" : "present"}
                  </span>
                  {proposal.severity && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">{proposal.severity}</span>
                  )}
                  {proposal.durationCount && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                      {proposal.durationCount} {proposal.durationUnit}
                    </span>
                  )}
                  {proposal.onset && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      since {proposal.onset}
                    </span>
                  )}
                  <span className="text-slate-400">Enter asserts · Tab cycles</span>
                </>
              ) : (
                <span className="text-amber-600">No matching concept — nothing is guessed.</span>
              )}
            </div>
          )}
          <input
            ref={inputRef}
            data-testid="omnibox"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setAltIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                assertProposal();
              } else if (e.key === "Tab" && proposal) {
                e.preventDefault();
                setAltIndex((i) => (i + 1) % (proposal.alternatives.length + 1));
              } else if (e.key === "Escape") {
                setInput("");
                setAltIndex(0);
              }
            }}
            placeholder='⌘K — capture out-of-order mentions from anywhere: "nightmares nightly since mva" · "no si"'
            className="w-full px-3 py-1.5 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </main>

      <ContextRail observations={observations} referenceInjuryDate={referenceInjuryDate} />

      <TemplateManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onChanged={(selectId) => {
          setTemplates(listTemplates());
          if (selectId) setTemplateId(selectId);
        }}
      />
    </div>
  );
}
