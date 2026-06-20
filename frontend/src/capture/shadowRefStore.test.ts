// MedicoApp → shadow bridge probe — dev-gate + emission shape (read-only, inert).
import { describe, it, expect, beforeEach } from "vitest";
import {
  shadowEmitFromObservation, getShadowRefLog, __resetShadowRefLog, __setShadowEnabledForTest,
} from "./shadowRefStore";

describe("shadowRefStore bridge probe", () => {
  beforeEach(() => { __resetShadowRefLog(); __setShadowEnabledForTest(false); });

  it("is a hard no-op when the dev/test gate is OFF (production behaviour)", () => {
    shadowEmitFromObservation({ id: "o1", symptomTypeId: "depressed_mood", onset: "2023-06-01" }, "client-A");
    expect(getShadowRefLog()).toHaveLength(0); // nothing logged → no PHI in production
  });

  it("emits ReferenceEntity records from real-shaped capture when enabled (STEP-C)", () => {
    __setShadowEnabledForTest(true);
    // three distinct user actions = three committed observations
    shadowEmitFromObservation({ id: "obs-101", symptomTypeId: "depressed_mood", onset: "after the injury" }, "client-A");
    shadowEmitFromObservation({ id: "obs-102", symptomTypeId: "insomnia" }, "client-A");
    shadowEmitFromObservation({ id: "obs-103", symptomTypeId: "nightmares", onset: "+2wk" }, "client-A");

    const log = getShadowRefLog().map((r) => ({ kind: r.kind, label: r.label, source: r.provenance.source, sourceEventId: r.sourceEventId }));
    // symptom + temporal-anchor referents extracted from existing-label kinds only
    expect(log).toEqual([
      { kind: "symptom", label: "depressed_mood", source: "medicoapp", sourceEventId: "obs-101" },
      { kind: "document_date", label: "after the injury", source: "medicoapp", sourceEventId: "obs-101" },
      { kind: "symptom", label: "insomnia", source: "medicoapp", sourceEventId: "obs-102" },
      { kind: "symptom", label: "nightmares", source: "medicoapp", sourceEventId: "obs-103" },
      { kind: "document_date", label: "+2wk", source: "medicoapp", sourceEventId: "obs-103" },
    ]);
    // STEP-4 shape: every record carries refId + provenance.at
    for (const r of getShadowRefLog()) {
      expect(r.refId.startsWith("ref:")).toBe(true);
      expect(typeof r.provenance.at).toBe("string");
    }
  });

  it("never throws into the caller, even on malformed input", () => {
    __setShadowEnabledForTest(true);
    expect(() => shadowEmitFromObservation(undefined as never, "client-A")).not.toThrow();
    expect(() => shadowEmitFromObservation({} as never, "client-A")).not.toThrow();
  });
});
