// ── Test D — Architecture freeze guard (Phase 4.2 §6) ──────────────────────────
// Fails the build on ANY structural drift in the frozen surface: command list,
// ClinicalState shape, recompute signature/output, or engine value exports.
// Changing any frozen item requires updating the matching FROZEN_* constant —
// which is the explicit, reviewable signal that a new Phase (5+) is required.

import { describe, it, expect } from "vitest";
import * as commands from "./commands";
import * as stateMod from "./state";
import * as recomputeMod from "./recompute";
import * as conflictsMod from "./conflicts";
import * as episodesMod from "./episodes";
import * as snapshotMod from "./snapshot";
import type { Ontology } from "../types/ontology";

const exportsOf = (m: object) => Object.keys(m).sort();

// ── Frozen value-export allowlists (type-only exports are erased at runtime) ───
const FROZEN_COMMANDS_EXPORTS = [
  "addObservation",
  "applyEpisodeCorrection",
  "attestCriterion",
  "concludeDiagnosis",
  "dispatch",
  "resolveConflict",
  "updateObservation",
].sort();

const FROZEN_STATE_EXPORTS = [
  "deserialiseState",
  "emptyState",
  "latestObservations",
  "runRecompute",
  "serialiseState",
].sort();

const FROZEN_RECOMPUTE_EXPORTS = ["recompute"].sort();
const FROZEN_CONFLICTS_EXPORTS = ["detectConflicts"].sort();
const FROZEN_EPISODES_EXPORTS = ["deriveEpisodes"].sort();
const FROZEN_SNAPSHOT_EXPORTS = ["buildSnapshot", "canonicalJSON", "contentHash"].sort();

const FROZEN_CLINICAL_STATE_KEYS = [
  "attestations",
  "conclusions",
  "corrections",
  "observationLog",
  "resolutions",
  "snapshots",
].sort();

const FROZEN_REASONING_OUTPUT_KEYS = [
  "candidacies",
  "conflicts",
  "episodes",
  "evidence",
  "memberships",
  "suggestions",
].sort();

const FROZEN_SNAPSHOT_KEYS = [
  "attestations",
  "candidacies",
  "conclusions",
  "conflicts",
  "contentHash",
  "corrections",
  "dsmVersion",
  "episodes",
  "evidence",
  "id",
  "memberships",
  "observations",
  "resolutions",
  "suggestions",
  "takenAt",
  "takenBy",
].sort();

const EMPTY_ONTOLOGY: Ontology = { symptomTypes: [], diagnoses: [], mappings: [] };

describe("Test D — architecture freeze", () => {
  it("command surface is frozen (no new value exports)", () => {
    expect(exportsOf(commands)).toEqual(FROZEN_COMMANDS_EXPORTS);
  });

  it("state / persistence surface is frozen", () => {
    expect(exportsOf(stateMod)).toEqual(FROZEN_STATE_EXPORTS);
  });

  it("engine core exports are frozen", () => {
    expect(exportsOf(recomputeMod)).toEqual(FROZEN_RECOMPUTE_EXPORTS);
    expect(exportsOf(conflictsMod)).toEqual(FROZEN_CONFLICTS_EXPORTS);
    expect(exportsOf(episodesMod)).toEqual(FROZEN_EPISODES_EXPORTS);
    expect(exportsOf(snapshotMod)).toEqual(FROZEN_SNAPSHOT_EXPORTS);
  });

  it("ClinicalState shape is frozen", () => {
    expect(Object.keys(stateMod.emptyState()).sort()).toEqual(FROZEN_CLINICAL_STATE_KEYS);
  });

  it("recompute signature is frozen (single input arg)", () => {
    expect(recomputeMod.recompute.length).toBe(1);
  });

  it("ReasoningOutput shape is frozen", () => {
    const out = stateMod.runRecompute(stateMod.emptyState(), EMPTY_ONTOLOGY);
    expect(Object.keys(out).sort()).toEqual(FROZEN_REASONING_OUTPUT_KEYS);
  });

  it("ReportSnapshot shape is frozen", () => {
    const snap = snapshotMod.buildSnapshot(stateMod.emptyState(), EMPTY_ONTOLOGY, {
      id: "s",
      takenAt: "2026-05-21T00:00:00Z",
      takenBy: "dr-a",
    });
    expect(Object.keys(snap).sort()).toEqual(FROZEN_SNAPSHOT_KEYS);
  });
});
