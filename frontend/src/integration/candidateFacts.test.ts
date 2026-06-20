// ── Candidate facts engine tests ────────────────────────────────────────────────
// Pins the ingestion → interview mapping: deterministic, fail-closed, presence
// read from the extractor (never inferred), provenance preserved verbatim.

import { describe, expect, it } from "vitest";
import {
  buildCandidateFacts,
  candidatesBySymptom,
  verificationQueue,
  type ExtractedClinicalEvent,
} from "./candidateFacts";

function ev(overrides: Partial<ExtractedClinicalEvent>): ExtractedClinicalEvent {
  return {
    event_id: overrides.event_id ?? `e-${Math.random()}`,
    event_type: "symptom",
    concept: "anxiety",
    source_document_id: "doc1",
    source_snippet: "...the claimant reported anxiety...",
    ...overrides,
  };
}

describe("symptom mapping (echo, don't re-ask)", () => {
  it("maps an extracted symptom to an ontology concept with provenance", () => {
    const [c] = buildCandidateFacts([
      ev({
        event_id: "e1",
        concept: "difficulty sleeping",
        assertion_status: "affirmed",
        source_section: "Treating GP",
        page: 47,
        participants: [{ role: "treating_gp", name: "Dr Smith" }],
      }),
    ]);
    expect(c.kind).toBe("symptom");
    expect(c.symptomTypeId).toBe("sleep_disturbance");
    expect(c.mapped).toBe(true);
    expect(c.presence).toBe("present");
    expect(c.provenance).toMatchObject({
      documentId: "doc1",
      section: "Treating GP",
      page: 47,
      author: "Dr Smith",
      snippet: "...the claimant reported anxiety...",
    });
  });

  it("reads presence from assertion_status — never inferred", () => {
    expect(buildCandidateFacts([ev({ concept: "low mood", assertion_status: "negated" })])[0].presence).toBe("absent");
    expect(buildCandidateFacts([ev({ concept: "low mood", assertion_status: "queried" })])[0].presence).toBe("uncertain");
    expect(buildCandidateFacts([ev({ concept: "low mood", assertion_status: "differential" })])[0].presence).toBe("uncertain");
  });

  it("flags historical mentions with a pre-injury epoch hint", () => {
    const [c] = buildCandidateFacts([ev({ concept: "depression", assertion_status: "historical" })]);
    expect(c.presence).toBe("present");
    expect(c.preInjuryHint).toBe(true);
  });

  it("fails closed: a physical-condition concept maps to no symptom", () => {
    const [c] = buildCandidateFacts([
      ev({ event_id: "e9", concept: "rheumatoid arthritis", assertion_status: "affirmed" }),
    ]);
    expect(c.mapped).toBe(false);
    expect(c.symptomTypeId).toBeUndefined();
    expect(c.label).toBe("rheumatoid arthritis"); // raw concept preserved
  });

  it("dedupes re-runs by stable event_id", () => {
    const e = ev({ event_id: "same", concept: "low mood" });
    expect(buildCandidateFacts([e, { ...e }])).toHaveLength(1);
  });
});

describe("diagnosis mapping", () => {
  it("maps canonical diagnosis names to DSM ids", () => {
    const facts = buildCandidateFacts([
      ev({ event_id: "d1", event_type: "diagnosis", concept: "post-traumatic stress disorder", assertion_status: "affirmed" }),
      ev({ event_id: "d2", event_type: "diagnosis", concept: "major depressive disorder", assertion_status: "affirmed" }),
      ev({ event_id: "d3", event_type: "diagnosis", concept: "adjustment disorder", assertion_status: "affirmed" }),
    ]);
    expect(facts.map((f) => f.diagnosisId)).toEqual(["ptsd", "mdd", "adj"]);
    expect(facts.every((f) => f.kind === "diagnosis" && f.mapped)).toBe(true);
  });

  it("unknown diagnosis names fail closed (unmapped, still queued)", () => {
    const [c] = buildCandidateFacts([
      ev({ event_id: "dx", event_type: "diagnosis", concept: "fibromyalgia", assertion_status: "affirmed" }),
    ]);
    expect(c.mapped).toBe(false);
    expect(c.diagnosisId).toBeUndefined();
  });
});

describe("grouping & verification queue", () => {
  const facts = buildCandidateFacts([
    ev({ event_id: "s1", concept: "difficulty sleeping", assertion_status: "affirmed" }),
    ev({ event_id: "s2", concept: "panic attacks", assertion_status: "affirmed" }),
    ev({ event_id: "s3", concept: "rheumatoid arthritis", assertion_status: "affirmed" }), // unmapped symptom
    ev({ event_id: "d1", event_type: "diagnosis", concept: "post-traumatic stress disorder", assertion_status: "affirmed" }),
    ev({ event_id: "m1", event_type: "medication_mention", concept: "sertraline", assertion_status: "affirmed" }),
    ev({ event_id: "p1", event_type: "person", concept: "Dr Jones" }),
  ]);

  it("indexes mapped symptom candidates by concept for inline chips", () => {
    const idx = candidatesBySymptom(facts);
    expect(idx.has("sleep_disturbance")).toBe(true);
    expect(idx.has("panic_attacks")).toBe(true);
    // unmapped symptom is NOT placed inline
    expect([...idx.values()].flat().every((c) => c.mapped)).toBe(true);
  });

  it("verification queue = unmapped symptoms + diagnoses + medications (not people)", () => {
    const q = verificationQueue(facts).map((c) => c.candidateId).sort();
    expect(q).toEqual(["d1", "m1", "s3"]);
  });
});
