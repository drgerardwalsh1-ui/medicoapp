import { describe, it, expect } from "vitest";
import {
  defaultClient,
  defaultIdentity,
  defaultAdministrative,
  defaultClinical,
  defaultReport,
  defaultAssessmentChecklist,
  defaultAttendees,
  defaultInjury,
  parseClientBlob,
  DRAFT_CLIENT_ID,
  isPersistedClientId,
} from "./client";

// These tests lock in the isolation invariant that prevents the
// "new client inherits previous client's data" regression. The bug was
// in main.tsx (`activeClient ?? defaultClient()` falling through to the
// previous activeClient), but a defensive test on the factories
// guarantees that ALL future entry points start from a clean object
// graph.

describe("client factories — fresh object identity (regression-locked)", () => {
  it("defaultClient() carries the DRAFT sentinel id — NOT a real UUID", () => {
    // Hardening change: defaultClient() must NOT mint crypto.randomUUID().
    // A draft carries no real persistence identity. The sentinel is the
    // same on every call and is never treated as a saved-client id.
    const a = defaultClient();
    const b = defaultClient();
    expect(a.id).toBe(DRAFT_CLIENT_ID);
    expect(b.id).toBe(DRAFT_CLIENT_ID);
    expect(isPersistedClientId(a.id)).toBe(false);
  });

  it("defaultClient() returns distinct top-level object references on each call", () => {
    const a = defaultClient();
    const b = defaultClient();
    expect(a).not.toBe(b);
    expect(a.identity).not.toBe(b.identity);
    expect(a.administrative).not.toBe(b.administrative);
    expect(a.administrative.referrer).not.toBe(b.administrative.referrer);
    expect(a.clinical).not.toBe(b.clinical);
    expect(a.appointments).not.toBe(b.appointments);
    expect(a.report).not.toBe(b.report);
    expect(a.report.fields).not.toBe(b.report.fields);
    expect(a.report.pirsTables).not.toBe(b.report.pirsTables);
    expect(a.report.previousAssessorPirs).not.toBe(b.report.previousAssessorPirs);
    expect(a.assessmentChecklist).not.toBe(b.assessmentChecklist);
    expect(a.assessmentChecklist.attendees).not.toBe(b.assessmentChecklist.attendees);
    expect(a.workTimeline).not.toBe(b.workTimeline);
  });

  it("mutating one defaultClient does not affect another (no shared inner state)", () => {
    const a = defaultClient();
    const b = defaultClient();
    a.appointments.push({
      id: crypto.randomUUID(),
      type: "assessment",
      startUtc: "2026-05-10T00:00:00Z",
      endUtc: "2026-05-10T01:00:00Z",
      appointmentTimeZone: "Australia/Sydney",
    });
    a.workTimeline!.push({
      id: crypto.randomUUID(),
      type: "assessment",
      title: "X",
      startedAtUtc: "2026-05-10T00:00:00Z",
      endedAtUtc: null,
      viewerTimeZone: "Australia/Sydney" as unknown as never, // brand erased in test only
      manuallyEdited: false,
      createdAutomatically: true,
    });
    a.identity.firstName = "Alice";
    a.report.fields["historyOfInjury"] = "narrative";
    expect(b.appointments).toEqual([]);
    expect(b.workTimeline).toEqual([]);
    expect(b.identity.firstName).toBe("");
    expect(b.report.fields).toEqual({});
  });

  it("nested factories all produce fresh refs (no module-level singletons)", () => {
    expect(defaultIdentity()).not.toBe(defaultIdentity());
    expect(defaultAdministrative()).not.toBe(defaultAdministrative());
    expect(defaultAdministrative().referrer).not.toBe(defaultAdministrative().referrer);
    expect(defaultClinical()).not.toBe(defaultClinical());
    expect(defaultInjury()).not.toBe(defaultInjury());
    expect(defaultReport()).not.toBe(defaultReport());
    expect(defaultReport().fields).not.toBe(defaultReport().fields);
    expect(defaultAssessmentChecklist()).not.toBe(defaultAssessmentChecklist());
    expect(defaultAssessmentChecklist().attendees).not.toBe(defaultAssessmentChecklist().attendees);
    expect(defaultAttendees()).not.toBe(defaultAttendees());
  });

  it("freshly created clients have empty identity / appointments / workTimeline", () => {
    const c = defaultClient();
    expect(c.identity.firstName).toBe("");
    expect(c.identity.lastName).toBe("");
    expect(c.identity.dateOfBirth).toBeNull();
    expect(c.administrative.referrer.org).toBeNull();
    expect(c.clinical.injury).toBeNull();
    expect(c.appointments).toEqual([]);
    expect(c.workTimeline).toEqual([]);
    expect(c.report.fields).toEqual({});
    expect(c.report.pirsTables).toEqual([]);
    expect(c.dsmAssessment).toBeUndefined();
  });

  it("parseClientBlob() with empty input yields a fresh, isolated client", () => {
    const a = parseClientBlob("a", null);
    const b = parseClientBlob("b", null);
    expect(a.identity).not.toBe(b.identity);
    expect(a.appointments).not.toBe(b.appointments);
    expect(a.report).not.toBe(b.report);
    expect(a.workTimeline).not.toBe(b.workTimeline);
    a.identity.firstName = "Alice";
    a.appointments.push({
      id: crypto.randomUUID(),
      type: "assessment",
      startUtc: "2026-05-10T00:00:00Z",
      endUtc: "2026-05-10T01:00:00Z",
      appointmentTimeZone: "Australia/Sydney",
    });
    expect(b.identity.firstName).toBe("");
    expect(b.appointments).toEqual([]);
  });
});
