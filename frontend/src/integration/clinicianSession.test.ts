import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveClinicianId,
  setActiveClinicianId,
  clearActiveClinicianId,
  UNATTRIBUTED_CLINICIAN_ID,
} from "./clinicianSession";

describe("clinician identity resolution", () => {
  beforeEach(() => clearActiveClinicianId());

  it("falls back to a stable constant when unset (never random)", () => {
    expect(getActiveClinicianId()).toBe(UNATTRIBUTED_CLINICIAN_ID);
    expect(getActiveClinicianId()).toBe(getActiveClinicianId());
  });

  it("returns the set id deterministically (stable across calls = across reload)", () => {
    setActiveClinicianId("dr-smith");
    expect(getActiveClinicianId()).toBe("dr-smith");
    expect(getActiveClinicianId()).toBe("dr-smith");
  });

  it("ignores blank ids", () => {
    setActiveClinicianId("   ");
    expect(getActiveClinicianId()).toBe(UNATTRIBUTED_CLINICIAN_ID);
  });
});
