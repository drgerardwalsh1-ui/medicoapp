// Capture-layer ReferenceEntity — invariant tests (SHADOW MODE).
// Proves: append-only, separate id spaces, best-effort resolution, supersede-not-
// delete, merge/split retention, conflict-flag-not-adjudicate, no clinical content.
import { describe, it, expect } from "vitest";
import {
  SHADOW_MODE, newReferenceEntityId, createReference, resolveReference,
  mergeReferences, splitReference, attachReference, project,
  type ReferenceLog, type ReferenceEntityId,
} from "./referenceEntity";

const prov = { clinicianId: "dr-x", at: "2024-01-01T00:00:00Z" };
const empty: ReferenceLog = Object.freeze([]);

describe("ReferenceEntity capture-layer identity adapter", () => {
  it("runs in shadow mode", () => {
    expect(SHADOW_MODE).toBe(true);
  });

  it("mints capture ids that are never backend event_ids (separate id spaces)", () => {
    const id = newReferenceEntityId();
    expect(id.startsWith("ref:")).toBe(true);     // capture-layer prefix
    expect(id).not.toMatch(/#/);                   // backend ids look like {doc}#{type}#{idx}#{hash}
  });

  it("is append-only: each op returns a NEW log; the prior log is unchanged", () => {
    const { log: l1, id } = createReference(empty, { kind: "trauma", label: "workplace injury", provenance: prov });
    expect(empty.length).toBe(0);                  // original untouched
    expect(l1.length).toBe(1);
    const l2 = attachReference(l1, { refId: id, target: { kind: "finding", id: "F-sleep" }, by: "dr-x", at: prov.at });
    expect(l1.length).toBe(1);                     // l1 untouched
    expect(l2.length).toBe(2);
    expect(Object.isFrozen(l2)).toBe(true);
  });

  it("projects an unresolved reference (resolution is best-effort, 0..1)", () => {
    const { log, id } = createReference(empty, { kind: "trauma", label: "bullying incident", provenance: prov });
    const v = project(log).entities.get(id)!;
    expect(v.ref.label).toBe("bullying incident");
    expect(v.resolution).toBeUndefined();          // unresolved is valid
  });

  it("resolves to a ClinicalEvent and supersedes (never deletes) on re-resolution", () => {
    let { log, id } = createReference(empty, { kind: "diagnosis", label: "PTSD", provenance: prov });
    log = resolveReference(log, { refId: id, eventId: "docA#diagnosis#0#abc123", resolvedBy: "dr-x", at: prov.at });
    log = resolveReference(log, { refId: id, eventId: "docB#diagnosis#1#def456", resolvedBy: "dr-x", at: "2024-02-01T00:00:00Z" });
    const v = project(log).entities.get(id)!;
    expect(v.resolution!.eventId).toBe("docB#diagnosis#1#def456"); // latest confirmed
    expect(v.resolution!.status).toBe("confirmed");
    expect(v.resolutionHistory).toHaveLength(2);                  // prior retained
    expect(v.resolutionHistory[0].status).toBe("superseded");
  });

  it("merge retains both references and points merged → survivor", () => {
    let { log, id: a } = createReference(empty, { kind: "work", label: "the meeting", provenance: prov });
    let b: ReferenceEntityId;
    ({ log, id: b } = createReference(log, { kind: "work", label: "disciplinary meeting", provenance: prov }));
    log = mergeReferences(log, { survivorId: b, mergedIds: [a], by: "dr-x", at: prov.at });
    const ents = project(log).entities;
    expect(ents.get(a)!.mergedInto).toBe(b);       // both retained; a → b
    expect(ents.get(b)!.mergedInto).toBeUndefined();
  });

  it("flags conflicting resolutions on merge but does NOT adjudicate them", () => {
    let { log, id: a } = createReference(empty, { kind: "diagnosis", label: "injury (claimant)", provenance: prov });
    let b: ReferenceEntityId;
    ({ log, id: b } = createReference(log, { kind: "diagnosis", label: "injury (records)", provenance: prov }));
    log = resolveReference(log, { refId: a, eventId: "docA#diagnosis#0#aaa", resolvedBy: "dr-x", at: prov.at });
    log = resolveReference(log, { refId: b, eventId: "docB#diagnosis#0#bbb", resolvedBy: "dr-x", at: prov.at });
    log = mergeReferences(log, { survivorId: b, mergedIds: [a], by: "dr-x", at: prov.at });
    const v = project(log).entities.get(b)!;
    expect(v.resolutionConflict).toBe(true);       // surfaced, not resolved
    expect(v.resolution!.eventId).toBe("docB#diagnosis#0#bbb"); // survivor's own resolution unchanged
  });

  it("split retains the source and creates new references", () => {
    const { log: l1, id: src } = createReference(empty, { kind: "trauma", label: "two events conflated", provenance: prov });
    const { log: l2, ids } = splitReference(l1, {
      sourceId: src,
      created: [
        { kind: "trauma", label: "bullying incident 1", provenance: prov },
        { kind: "trauma", label: "bullying incident 2", provenance: prov },
      ], by: "dr-x", at: prov.at,
    });
    const ents = project(l2).entities;
    expect(ents.has(src)).toBe(true);              // source retained (append-only)
    expect(ids).toHaveLength(2);
    expect(ents.get(ids[0])!.ref.label).toBe("bullying incident 1");
  });

  it("rejects clinical content on a reference (truth-layer creep guard)", () => {
    expect(() => createReference(empty, {
      kind: "diagnosis", label: "x", provenance: prov,
      // @ts-expect-error — extra clinical field is forbidden
      severity: "severe",
    })).toThrow(/no clinical content/i);
  });
});
