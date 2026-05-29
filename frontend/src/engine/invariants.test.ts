import { describe, it, expect } from "vitest";
import type {
  CriterionId,
  DiagnosisId,
  Ontology,
  SymptomTypeId,
} from "../types/ontology";
import type { AttestationId, ObservationId } from "../types/ontology";
import {
  addObservation,
  updateObservation,
  attestCriterion,
  resolveConflict,
  applyEpisodeCorrection,
  concludeDiagnosis,
  type Command,
  dispatch,
} from "./commands";
import { emptyState, runRecompute, serialiseState, deserialiseState } from "./state";
import { buildSnapshot } from "./snapshot";

// ── Fixtures ────────────────────────────────────────────────────────────────────
const S = (s: string) => s as SymptomTypeId;
const D = (s: string) => s as DiagnosisId;
const C = (s: string) => s as CriterionId;

const ontology: Ontology = {
  symptomTypes: [
    { id: S("depressed_mood"), label: "Depressed mood", frames: ["subjective", "observed"] },
    { id: S("anhedonia"), label: "Anhedonia", frames: ["subjective"] },
    { id: S("concentration"), label: "Poor concentration", frames: ["subjective"] },
  ],
  diagnoses: [
    {
      id: D("mdd"),
      name: "Major Depressive Disorder",
      courseModel: "episodic",
      dsmVersion: "DSM-5-TR",
      criteria: [
        {
          criterionId: C("A"),
          type: "symptom_count",
          minRequired: 2,
          requiresTemporalCoOccurrence: true,
        },
      ],
    },
    {
      id: D("ptsd"),
      name: "PTSD",
      courseModel: "episodic",
      dsmVersion: "DSM-5-TR",
      criteria: [{ criterionId: C("E"), type: "symptom_count", minRequired: 1 }],
    },
  ],
  mappings: [
    { symptomTypeId: S("depressed_mood"), diagnosisId: D("mdd"), criterionId: C("A") },
    { symptomTypeId: S("anhedonia"), diagnosisId: D("mdd"), criterionId: C("A") },
    { symptomTypeId: S("concentration"), diagnosisId: D("mdd"), criterionId: C("A") },
    { symptomTypeId: S("concentration"), diagnosisId: D("ptsd"), criterionId: C("E") },
  ],
};

function seedState() {
  let s = emptyState();
  s = addObservation(s, {
    id: "o1" as ObservationId,
    clinicianId: "dr-a",
    at: "2026-05-20T01:00:00Z",
    symptomTypeId: S("depressed_mood"),
    frame: "subjective",
    presence: "present",
    onset: "2026-04-01",
  });
  s = addObservation(s, {
    id: "o2" as ObservationId,
    clinicianId: "dr-a",
    at: "2026-05-20T01:01:00Z",
    symptomTypeId: S("anhedonia"),
    frame: "subjective",
    presence: "present",
    onset: "2026-04-01",
  });
  s = addObservation(s, {
    id: "o3" as ObservationId,
    clinicianId: "dr-a",
    at: "2026-05-20T01:02:00Z",
    symptomTypeId: S("concentration"),
    frame: "subjective",
    presence: "unknown", // exercises unknown-propagation
  });
  return s;
}

// ── Test A — round-trip determinism ─────────────────────────────────────────────
describe("Test A — round-trip determinism", () => {
  it("serialize → deserialize → recompute matches original recompute", () => {
    const state = seedState();
    const out1 = runRecompute(state, ontology);
    const rebuilt = deserialiseState(serialiseState(state));
    const out2 = runRecompute(rebuilt, ontology);
    expect(out2).toEqual(out1);
  });

  it("same state recomputed twice is identical", () => {
    const state = seedState();
    expect(runRecompute(state, ontology)).toEqual(runRecompute(state, ontology));
  });
});

// ── Test B — command purity ──────────────────────────────────────────────────────
describe("Test B — command purity", () => {
  const base = seedState();
  const cases: Command[] = [
    {
      type: "addObservation",
      input: {
        id: "oX" as ObservationId,
        clinicianId: "dr-a",
        at: "2026-05-20T02:00:00Z",
        symptomTypeId: S("depressed_mood"),
        frame: "observed",
        presence: "present",
      },
    },
    {
      type: "updateObservation",
      input: {
        id: "o3" as ObservationId,
        clinicianId: "dr-a",
        at: "2026-05-20T02:01:00Z",
        presence: "present",
      },
    },
    {
      type: "attestCriterion",
      input: {
        id: "a1" as AttestationId,
        clinicianId: "dr-a",
        at: "2026-05-20T02:02:00Z",
        diagnosisId: D("mdd"),
        criterionId: C("A"),
        status: "met",
        suggestedStatusAtAttest: "suggested_met",
        agreedWithSuggestion: true,
      },
    },
    {
      type: "resolveConflict",
      input: {
        conflictId: "cf:o3",
        observationId: "o3" as ObservationId,
        clinicianId: "dr-a",
        at: "2026-05-20T02:03:00Z",
        attributeToDiagnosisId: D("mdd"),
      },
    },
    {
      type: "applyEpisodeCorrection",
      input: {
        kind: "adjust",
        episodeId: "ep:mdd" as never,
        onset: "2026-03-15",
        clinicianId: "dr-a",
        at: "2026-05-20T02:04:00Z",
      },
    },
    {
      type: "concludeDiagnosis",
      input: {
        clinicianId: "dr-a",
        at: "2026-05-20T02:05:00Z",
        diagnosisId: D("mdd"),
        decision: "confirmed",
        candidacyAtDecision: "threshold_likely_met",
      },
    },
  ];

  for (const cmd of cases) {
    it(`${cmd.type} does not mutate input and returns a new reference`, () => {
      const before = JSON.parse(JSON.stringify(base));
      const next = dispatch(base, cmd);
      expect(JSON.parse(JSON.stringify(base))).toEqual(before); // input untouched
      expect(next).not.toBe(base); // new top-level reference
    });
  }

  it("attestCriterion requires a reason when disagreeing", () => {
    expect(() =>
      attestCriterion(base, {
        id: "a2" as AttestationId,
        clinicianId: "dr-a",
        at: "2026-05-20T02:06:00Z",
        diagnosisId: D("mdd"),
        criterionId: C("A"),
        status: "not_met",
        suggestedStatusAtAttest: "suggested_met",
        agreedWithSuggestion: false,
      }),
    ).toThrow();
  });

  it("updateObservation appends a version, never overwrites", () => {
    const next = updateObservation(base, {
      id: "o1" as ObservationId,
      clinicianId: "dr-a",
      at: "2026-05-20T02:07:00Z",
      severity: "severe",
    });
    expect(next.observationLog.length).toBe(base.observationLog.length + 1);
    expect(next.observationLog.filter((o) => o.id === "o1").length).toBe(2);
  });

  it("resolveConflict / concludeDiagnosis append only", () => {
    const r = resolveConflict(base, {
      conflictId: "cf:o3",
      observationId: "o3" as ObservationId,
      clinicianId: "dr-a",
      at: "2026-05-20T02:08:00Z",
      attributeToDiagnosisId: "keep_shared",
    });
    expect(r.resolutions.length).toBe(base.resolutions.length + 1);
    const c = concludeDiagnosis(base, {
      clinicianId: "dr-a",
      at: "2026-05-20T02:09:00Z",
      diagnosisId: D("ptsd"),
      decision: "deferred",
      candidacyAtDecision: "approaching_threshold",
    });
    expect(c.conclusions.length).toBe(base.conclusions.length + 1);
  });
});

// ── Test C — snapshot stability ──────────────────────────────────────────────────
describe("Test C — snapshot stability", () => {
  const meta = { id: "snap-1", takenAt: "2026-05-21T00:00:00Z", takenBy: "dr-a" };

  it("repeated builds yield identical contentHash", () => {
    const state = seedState();
    const h1 = buildSnapshot(state, ontology, meta).contentHash;
    const h2 = buildSnapshot(state, ontology, meta).contentHash;
    expect(h1).toBe(h2);
  });

  it("hash is stable across serialize round-trip", () => {
    const state = seedState();
    const rebuilt = deserialiseState(serialiseState(state));
    expect(buildSnapshot(rebuilt, ontology, meta).contentHash).toBe(
      buildSnapshot(state, ontology, meta).contentHash,
    );
  });

  it("hash changes when clinical truth changes", () => {
    const state = seedState();
    const h1 = buildSnapshot(state, ontology, meta).contentHash;
    const mutated = updateObservation(state, {
      id: "o3" as ObservationId,
      clinicianId: "dr-a",
      at: "2026-05-20T03:00:00Z",
      presence: "present",
    });
    expect(buildSnapshot(mutated, ontology, meta).contentHash).not.toBe(h1);
  });
});
