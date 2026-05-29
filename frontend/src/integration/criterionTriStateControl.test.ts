import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isCriterionActive,
  nextCriterionOn,
} from "./ui/CriterionTriStateControl";
import { isActive as isPresenceActive, nextPresenceOn } from "./ui/SymptomPresenceControl";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const SYMPTOM_SRC = read("integration/ui/SymptomPresenceControl.tsx");
const CRITERION_SRC = read("integration/ui/CriterionTriStateControl.tsx");
const DSM = read("components/DSMAssessment.tsx");
const CURRENT_SYMPTOMS = read("components/CurrentSymptoms.tsx");

describe("Phase 19.2 — tri-state semantic disambiguation", () => {
  it("1. SymptomPresenceControl source remains unchanged in shape (still ? ✓ ✗, no rendered DSM badge)", () => {
    // Spec: symptom control 'normal ? ✓ ✗ — no badge'.
    expect(SYMPTOM_SRC).toMatch(/symbol:\s*["']\?["']/);
    expect(SYMPTOM_SRC).toMatch(/symbol:\s*["']✓["']/);
    expect(SYMPTOM_SRC).toMatch(/symbol:\s*["']✗["']/);
    // No rendered criterion-domain markers (JSX text / attributes / data tags).
    expect(SYMPTOM_SRC).not.toMatch(/data-control-kind=["']criterion["']/);
    expect(SYMPTOM_SRC).not.toMatch(/>\s*DSM\s*</);
    expect(SYMPTOM_SRC).not.toMatch(/border-l-\d+\s+border-indigo-/);
  });

  it("2. CriterionTriStateControl is visually distinguishable from the symptom control", () => {
    // Visual marker(s): 'DSM' label + left-edge accent stripe + a distinct
    // active-tone palette + a data-control-kind attribute the tests can lock.
    expect(CRITERION_SRC).toMatch(/\bDSM\b/);
    expect(CRITERION_SRC).toMatch(/border-l-2 border-indigo-/);
    expect(CRITERION_SRC).toMatch(/data-control-kind=["']criterion["']/);
  });

  it("3. No shared state — different type unions, no cross-import", () => {
    expect(SYMPTOM_SRC).toMatch(/type\s+PresenceValue\s*=\s*boolean\s*\|\s*undefined/);
    expect(CRITERION_SRC).toMatch(/type\s+CriterionTriState\s*=\s*["']unknown["']\s*\|\s*["']met["']\s*\|\s*["']not_met["']/);
    // The two controls must not import each other (real code coupling, not
    // docstring references).
    expect(SYMPTOM_SRC).not.toMatch(/import\s+[^;]*CriterionTriStateControl/);
    expect(CRITERION_SRC).not.toMatch(/import\s+[^;]*SymptomPresenceControl/);
  });

  it("4. No engine / persistence / scoring imports introduced", () => {
    for (const src of [SYMPTOM_SRC, CRITERION_SRC]) {
      expect(src).not.toMatch(/from\s+["']\.\.\/(?:\.\.\/)?engine\//);
      expect(src).not.toMatch(/from\s+["']\.\.?\/clinicalBridge["']/);
      expect(src).not.toMatch(/from\s+["']\.\.?\/clinicalConstraints["']/);
      expect(src).not.toMatch(/from\s+["']\.\.?\/clinicalSemantics["']/);
      expect(src).not.toMatch(/from\s+["']\.\.?\/clinicalTemporal["']/);
    }
  });

  it("5. clicking the criterion control returns a CriterionTriState only", () => {
    // nextCriterionOn is the criterion-domain identity; it cannot return a
    // boolean — TypeScript would reject it. Runtime sanity check too.
    expect(nextCriterionOn("met")).toBe("met");
    expect(nextCriterionOn("not_met")).toBe("not_met");
    expect(nextCriterionOn("unknown")).toBe("unknown");
    // The returned value is never one of the presence values.
    for (const v of ["met", "not_met", "unknown"] as const) {
      expect(typeof nextCriterionOn(v)).toBe("string");
    }
  });

  it("6. clicking the symptom control returns a PresenceValue only", () => {
    expect(nextPresenceOn(true)).toBe(true);
    expect(nextPresenceOn(false)).toBe(false);
    expect(nextPresenceOn(undefined)).toBe(undefined);
    // Presence value space is disjoint from criterion strings.
    for (const v of [true, false, undefined] as const) {
      const r = nextPresenceOn(v);
      expect(["met", "not_met", "unknown"]).not.toContain(r);
    }
  });

  it("7. both controls render ? ✓ ✗ but are not interchangeable (active-class palettes differ)", () => {
    // Symbols equal.
    for (const sym of ["?", "✓", "✗"]) {
      expect(SYMPTOM_SRC).toContain(`symbol: "${sym}"`);
      expect(CRITERION_SRC).toContain(`symbol: "${sym}"`);
    }
    // Active classes diverge — symptom uses emerald/red; criterion uses indigo/amber.
    expect(SYMPTOM_SRC).toMatch(/bg-emerald-/);
    expect(SYMPTOM_SRC).toMatch(/bg-red-/);
    expect(CRITERION_SRC).toMatch(/bg-indigo-/);
    expect(CRITERION_SRC).toMatch(/bg-amber-/);
    // And the active helpers are domain-typed.
    expect(isPresenceActive(true, true)).toBe(true);
    expect(isCriterionActive("met", "met")).toBe(true);
  });

  it("8. no duplicated state coupling — DSM panel uses CriterionTriStateControl, symptom workspace uses SymptomPresenceControl", () => {
    // DSM panel (criterion adjudication) — uses CriterionTriStateControl.
    expect(DSM).toMatch(/<CriterionTriStateControl\s/);
    // The DSM panel's 'Current presence' block still uses SymptomPresenceControl.
    expect(DSM).toMatch(/<SymptomPresenceControl\s/);
    // Current Symptoms list uses ONLY the symptom control.
    expect(CURRENT_SYMPTOMS).toMatch(/<SymptomPresenceControl\s/);
    expect(CURRENT_SYMPTOMS).not.toMatch(/<CriterionTriStateControl/);
    // No remaining usage of the legacy local TriStateControl render call.
    expect(DSM).not.toMatch(/<TriStateControl\s/);
  });
});
