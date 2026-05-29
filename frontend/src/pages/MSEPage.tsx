import { useMemo, useRef, useEffect, useCallback } from "react";
import type { Client, MSEData, MSEDomainState } from "../types/client";
import { defaultMSEData, defaultAttendees } from "../types/client";
import type { SymptomEntity, MoodState } from "../types/dsm";
import { defaultDSMAssessmentData } from "../types/dsm";
import { MSE_DOMAINS, type MSEDomainDef } from "../data/mseDomains";
import { MOOD_DESCRIPTORS } from "../data/moodState";
import { generateMSENarrative } from "../engine/mseNarrative";
import AttendeesPanel from "../components/AttendeesPanel";
import { durationMinutes, formatDateISO, getViewerTimeZone } from "../time";
import { Temporal } from "@js-temporal/polyfill";

// Body-only Mental State Examination page.
//
// Layout (spec Part 3 / Part 12):
//   - Left  — single continuous scrolling narrative workspace (NOT an
//             accordion). The generated prose is shown and is editable.
//   - Right — scrollable chip panel grouped by MSE domain. Chips are
//             selectable directly with no click-to-open step.
//
// Every domain defaults to a clinically normal state — the narrative reads
// "no abnormality" until a chip is selected.

export type MSEPageProps = {
  client: Client;
  onClientChange: (updated: Client) => void;
  onNavigateToSymptoms: () => void;
};

// Human-readable duration for the narrative ("1 hour 30 minutes").
function humanDuration(mins: number): string {
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  return parts.join(" ");
}

// Today's appointment (viewer day), else the first appointment.
function pickAppointment(client: Client) {
  const appts = client.appointments ?? [];
  if (appts.length === 0) return null;
  const viewerTz = getViewerTimeZone();
  const today = Temporal.Now.plainDateISO(viewerTz);
  const todays = appts.find((a) => {
    try {
      const tz = a.appointmentTimeZone || viewerTz;
      const d = Temporal.Instant.from(a.startUtc).toZonedDateTimeISO(tz).toPlainDate();
      return d.equals(today);
    } catch {
      return false;
    }
  });
  return todays ?? appts[0];
}

// ── Persistent UI view state ──────────────────────────────────────────────
// Scroll positions of the two panels are kept in sessionStorage keyed by
// clientId so navigating away (to another tab) and back restores the exact
// scroll position and editing context. UI state ONLY — never report data.

type MSEViewState = { leftScroll?: number; rightScroll?: number };

function mseViewKey(clientId: string): string {
  return `medicoapp:mseView:${clientId}`;
}

function loadMSEViewState(clientId: string): MSEViewState {
  try {
    const raw = sessionStorage.getItem(mseViewKey(clientId));
    return raw ? (JSON.parse(raw) as MSEViewState) : {};
  } catch {
    return {};
  }
}

function saveMSEViewState(clientId: string, state: MSEViewState): void {
  try {
    sessionStorage.setItem(mseViewKey(clientId), JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (private mode, quota) — fine to drop.
  }
}

function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-2.5 py-1 rounded-full text-xs font-medium border transition select-none",
        active
          ? "bg-violet-600 border-violet-600 text-white"
          : "bg-white border-slate-300 text-slate-600 hover:border-violet-400 hover:text-violet-700",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

const SELECT_CLS =
  "text-xs border border-slate-300 rounded px-2 py-1 bg-white text-slate-700";

export default function MSEPage({
  client,
  onClientChange,
  onNavigateToSymptoms,
}: MSEPageProps) {
  const mse: MSEData = client.mse ?? defaultMSEData();
  const chk = client.assessmentChecklist;
  const attendees = chk?.attendees ?? defaultAttendees();
  const symptoms: Record<string, SymptomEntity> =
    client.dsmAssessment?.symptoms ?? {};
  const moodState: MoodState =
    client.dsmAssessment?.moodState ?? { descriptors: [], notes: "" };

  const appt = pickAppointment(client);
  const assessmentDate = appt
    ? formatDateISO(appt.startUtc, appt.appointmentTimeZone || getViewerTimeZone())
    : "";
  const durationMins = appt ? durationMinutes(appt.startUtc, appt.endUtc) : 0;
  const durationText = humanDuration(durationMins);

  const generatedNarrative = useMemo(
    () =>
      generateMSENarrative({
        gender: client.identity?.gender,
        assessmentDate,
        modality: chk?.modality,
        attendees,
        mse,
        symptoms,
        moodState,
        durationLabel: durationText,
      }),
    [client.identity?.gender, assessmentDate, chk?.modality, attendees, mse, symptoms, moodState, durationText],
  );

  const narrativeText = mse.narrativeEdited
    ? mse.narrative ?? generatedNarrative
    : generatedNarrative;

  // ── Mutators ────────────────────────────────────────────────────────────────
  function updateMSE(patch: Partial<MSEData>) {
    onClientChange({ ...client, mse: { ...mse, ...patch } });
  }
  function domainState(id: string): MSEDomainState {
    return mse.domains?.[id] ?? { chips: [], notes: "" };
  }
  function setDomain(id: string, next: MSEDomainState) {
    updateMSE({ domains: { ...mse.domains, [id]: next } });
  }
  function toggleChip(domainId: string, chipId: string) {
    const st = domainState(domainId);
    const chips = st.chips.includes(chipId)
      ? st.chips.filter((c) => c !== chipId)
      : [...st.chips, chipId];
    setDomain(domainId, { ...st, chips });
  }
  function setNotes(domainId: string, notes: string) {
    setDomain(domainId, { ...domainState(domainId), notes });
  }
  function setAttendees(next: import("../types/client").AssessmentAttendees) {
    onClientChange({
      ...client,
      assessmentChecklist: {
        ...(chk ?? {
          completed: false,
          consentGiven: null,
          modality: "",
          modalityConfirmed: false,
          purposeExplained: false,
          technicalIssues: "none",
          attendees: next,
        }),
        attendees: next,
      },
    });
  }
  // Unified mood state — shared with the Current Symptoms "Mood & Emotional
  // State" domain. Writing here updates `dsmAssessment.moodState`, which
  // Current Symptoms reads from the same field.
  function setMoodState(next: MoodState) {
    const dsm = client.dsmAssessment ?? defaultDSMAssessmentData();
    onClientChange({ ...client, dsmAssessment: { ...dsm, moodState: next } });
  }
  function toggleMood(id: string) {
    const descriptors = moodState.descriptors.includes(id)
      ? moodState.descriptors.filter((d) => d !== id)
      : [...moodState.descriptors, id];
    setMoodState({ ...moodState, descriptors });
  }
  function onNarrativeEdit(text: string) {
    updateMSE({ narrative: text, narrativeEdited: true });
  }
  function regenerateNarrative() {
    updateMSE({ narrative: generatedNarrative, narrativeEdited: false });
  }

  // ── Scroll-position persistence ─────────────────────────────────────────
  const leftRef = useRef<HTMLTextAreaElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  // Restore both panels' scroll positions after the page has rendered.
  useEffect(() => {
    const restored = loadMSEViewState(client.id);
    requestAnimationFrame(() => {
      if (leftRef.current && restored.leftScroll)
        leftRef.current.scrollTop = restored.leftScroll;
      if (rightRef.current && restored.rightScroll)
        rightRef.current.scrollTop = restored.rightScroll;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const persistScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      saveMSEViewState(client.id, {
        leftScroll: leftRef.current?.scrollTop ?? 0,
        rightScroll: rightRef.current?.scrollTop ?? 0,
      });
    });
  }, [client.id]);

  // Persist on unmount too — covers tab changes that unmount the page
  // before a scroll event has flushed.
  useEffect(() => {
    return () => {
      saveMSEViewState(client.id, {
        leftScroll: leftRef.current?.scrollTop ?? 0,
        rightScroll: rightRef.current?.scrollTop ?? 0,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  // Live summary of a linked domain's present symptoms.
  function linkedSummary(def: MSEDomainDef): string[] {
    if (!def.linkedEntities) return [];
    return def.linkedEntities
      .filter((id) => symptoms[id]?.currentPresence === true)
      .map((id) => symptoms[id]?.symptomType || id);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left: continuous scrolling narrative workspace ── */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-800">
            Mental State Examination
          </h2>
          {assessmentDate && (
            <span className="text-xs text-slate-500">as at {assessmentDate}</span>
          )}
          {durationText && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              Duration: {durationText}
            </span>
          )}
          {chk?.modality && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 capitalize">
              {chk.modality}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {mse.narrativeEdited && (
              <span className="text-xs text-amber-600">Manually edited</span>
            )}
            <button
              type="button"
              onClick={regenerateNarrative}
              className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              Regenerate from selections
            </button>
          </div>
        </div>
        <textarea
          ref={leftRef}
          onScroll={persistScroll}
          className="flex-1 min-h-0 w-full resize-none px-5 py-4 text-sm leading-relaxed text-slate-800 font-serif outline-none"
          value={narrativeText}
          onChange={(e) => onNarrativeEdit(e.target.value)}
          spellCheck
        />
      </div>

      {/* ── Right: grouped chip / input panel ── */}
      <div
        ref={rightRef}
        onScroll={persistScroll}
        className="w-[420px] shrink-0 overflow-auto bg-slate-50"
      >
        <div className="p-4 space-y-5">
          {/* Carried-over attendee / interpreter info — shared state with
              Demographics. Editing here updates Demographics instantly. */}
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <AttendeesPanel
              attendees={attendees}
              onChange={setAttendees}
              variant="mse"
            />
          </div>

          {MSE_DOMAINS.map((def) => {
            const st = domainState(def.id);
            const linked = linkedSummary(def);
            return (
              <div
                key={def.id}
                className="bg-white rounded-lg border border-slate-200 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">
                    {def.label}
                  </h3>
                  {(def.linkedEntities || def.sharedMood) && (
                    <button
                      type="button"
                      onClick={onNavigateToSymptoms}
                      className="text-[11px] text-violet-600 hover:underline"
                    >
                      Edit in Current Symptoms →
                    </button>
                  )}
                </div>

                {def.sharedMood && (
                  <>
                    <div className="text-[11px] text-slate-500">
                      Shared with Current Symptoms — Mood &amp; Emotional State.
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {MOOD_DESCRIPTORS.map((d) => (
                        <Chip
                          key={d.id}
                          label={d.label}
                          active={moodState.descriptors.includes(d.id)}
                          onClick={() => toggleMood(d.id)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {def.linkedEntities && (
                  <div className="text-[11px] text-slate-500">
                    {linked.length > 0 ? (
                      <span>
                        From Current Symptoms:{" "}
                        <span className="text-slate-700">{linked.join(", ")}</span>
                      </span>
                    ) : (
                      <span>No linked symptoms recorded — domain reads as normal.</span>
                    )}
                  </div>
                )}

                {def.chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {def.chips.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.label}
                        active={st.chips.includes(c.id)}
                        onClick={() => toggleChip(def.id, c.id)}
                      />
                    ))}
                  </div>
                )}

                {def.id === "cognition" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      History
                      <select
                        className={SELECT_CLS}
                        value={mse.historyQuality || ""}
                        onChange={(e) =>
                          updateMSE({
                            historyQuality: e.target.value as MSEData["historyQuality"],
                          })
                        }
                      >
                        <option value="">good</option>
                        <option value="good">good</option>
                        <option value="reasonable">reasonable</option>
                        <option value="poor">poor</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      Coped
                      <select
                        className={SELECT_CLS}
                        value={mse.durationCoping || ""}
                        onChange={(e) =>
                          updateMSE({
                            durationCoping: e.target.value as MSEData["durationCoping"],
                          })
                        }
                      >
                        <option value="">well</option>
                        <option value="well">well</option>
                        <option value="fairly well">fairly well</option>
                        <option value="poorly">poorly</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      Concentration
                      <select
                        className={SELECT_CLS}
                        value={mse.concentrationDifficulty || ""}
                        onChange={(e) =>
                          updateMSE({
                            concentrationDifficulty:
                              e.target.value as MSEData["concentrationDifficulty"],
                          })
                        }
                      >
                        <option value="">no difficulty</option>
                        <option value="none">no difficulty</option>
                        <option value="mild">mild difficulty</option>
                        <option value="moderate">moderate difficulty</option>
                        <option value="severe">severe difficulty</option>
                      </select>
                    </label>
                  </div>
                )}

                <textarea
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-y min-h-[44px] outline-none focus:border-violet-400"
                  placeholder={`Additional observations — ${def.label.toLowerCase()}`}
                  value={def.sharedMood ? moodState.notes ?? "" : st.notes}
                  onChange={(e) =>
                    def.sharedMood
                      ? setMoodState({ ...moodState, notes: e.target.value })
                      : setNotes(def.id, e.target.value)
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
