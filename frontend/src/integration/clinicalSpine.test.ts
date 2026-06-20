// ── Clinical fact spine — wire-format compatibility tests ─────────────────────
// Pins the contract between the Rust fold (clinical_fact_store::
// fold_clinical_state, camelCase serde) and the frontend deserialiseState.
// If either side renames a key, this fails before any runtime hydration does.

import { describe, expect, it } from "vitest";
import { parseClinicalStateWire, REVIEW_KINDS } from "./clinicalSpine";
import { emptyState, latestObservations, serialiseState } from "../engine/state";

// Exactly what the Rust DTO serialises for a populated client (keys sorted
// as serde_json emits them — order must be irrelevant to the decoder).
const RUST_WIRE = JSON.stringify({
  attestations: [{ id: "att1" }],
  conclusions: [{ id: "con1" }],
  corrections: [],
  observationLog: [
    {
      id: "o1",
      symptomTypeId: "concentration_difficulty",
      frame: "subjective",
      presence: "present",
      severity: "mild",
      provenance: { clinicianId: "dr", at: "2026-06-13T00:00:00Z", entrySource: "chip" },
    },
    {
      id: "o1",
      symptomTypeId: "concentration_difficulty",
      frame: "subjective",
      presence: "present",
      severity: "severe",
      provenance: { clinicianId: "dr", at: "2026-06-13T00:05:00Z", entrySource: "severity" },
    },
  ],
  resolutions: [],
  snapshots: [],
});

describe("clinical spine wire format", () => {
  it("decodes the Rust fold output into ClinicalState", () => {
    const state = parseClinicalStateWire(RUST_WIRE);
    expect(state.observationLog).toHaveLength(2);
    expect(state.attestations).toEqual([{ id: "att1" }]);
    expect(state.conclusions).toEqual([{ id: "con1" }]);
    expect(state.resolutions).toEqual([]);
    expect(state.corrections).toEqual([]);
    expect(state.snapshots).toEqual([]);
  });

  it("append-only edit semantics survive the wire: latest entry per id wins", () => {
    const state = parseClinicalStateWire(RUST_WIRE);
    const latest = latestObservations(state);
    expect(latest).toHaveLength(1);
    expect(latest[0].severity).toBe("severe");
  });

  it("an empty backend log decodes to the engine's empty state", () => {
    const wire = JSON.stringify({
      observationLog: [],
      attestations: [],
      resolutions: [],
      corrections: [],
      conclusions: [],
      snapshots: [],
    });
    expect(parseClinicalStateWire(wire)).toEqual(emptyState());
  });

  it("round-trips through the engine serialiser unchanged", () => {
    const state = parseClinicalStateWire(RUST_WIRE);
    expect(parseClinicalStateWire(serialiseState(state))).toEqual(state);
  });

  it("review kinds match the backend REVIEW_KINDS exactly", () => {
    expect([...REVIEW_KINDS]).toEqual([
      "attestation",
      "resolution",
      "correction",
      "conclusion",
      "snapshot",
    ]);
  });
});
