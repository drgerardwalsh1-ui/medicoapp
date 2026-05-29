import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isActive, nextPresenceOn } from "./ui/SymptomPresenceControl";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const CONTROL_SRC = read("integration/ui/SymptomPresenceControl.tsx");
const CURRENT_SYMPTOMS = read("components/CurrentSymptoms.tsx");
const DSM = read("components/DSMAssessment.tsx");

describe("Phase 19.1 — unified symptom presence control", () => {
  it("1. existing present symptom → ✓ active on initial render", () => {
    expect(isActive(true, true)).toBe(true);
    expect(isActive(true, false)).toBe(false);
    expect(isActive(true, undefined)).toBe(false);
  });

  it("2. existing absent symptom → ✗ active on initial render", () => {
    expect(isActive(false, false)).toBe(true);
    expect(isActive(false, true)).toBe(false);
    expect(isActive(false, undefined)).toBe(false);
  });

  it("3. existing unknown/unset → ? active on initial render", () => {
    expect(isActive(undefined, undefined)).toBe(true);
    expect(isActive(undefined, true)).toBe(false);
    expect(isActive(undefined, false)).toBe(false);
  });

  it("4–6. single click sets the chosen value (no cycle, no second click)", () => {
    // Clicking ✓ → true; clicking ✗ → false; clicking ? → undefined.
    expect(nextPresenceOn(true)).toBe(true);
    expect(nextPresenceOn(false)).toBe(false);
    expect(nextPresenceOn(undefined)).toBe(undefined);
  });

  it("7. DSM workspace and Current Symptoms list both use the SAME shared control", () => {
    expect(CURRENT_SYMPTOMS).toMatch(/from\s+["']\.\.\/integration\/ui\/SymptomPresenceControl["']/);
    expect(DSM).toMatch(/from\s+["']\.\.\/integration\/ui\/SymptomPresenceControl["']/);
    expect(CURRENT_SYMPTOMS).toMatch(/<SymptomPresenceControl\s/);
    expect(DSM).toMatch(/<SymptomPresenceControl\s/);
  });

  it("8. no duplicate chip controls remain (DSM workspace no longer renders Present/Absent chips for currentPresence)", () => {
    // The DSM workspace must no longer render a Chip pair for the
    // "Current presence" block. Look for the specific old wiring.
    expect(DSM).not.toMatch(/label=["']Present["']\s+active=\{[^}]*currentPresence\s*===\s*true/);
    expect(DSM).not.toMatch(/label=["']Absent["']\s+active=\{[^}]*currentPresence\s*===\s*false/);
    // The CurrentSymptoms list no longer defines/uses the cycling PresenceToggle.
    expect(CURRENT_SYMPTOMS).not.toMatch(/function\s+PresenceToggle\s*\(/);
    expect(CURRENT_SYMPTOMS).not.toMatch(/<PresenceToggle\s/);
  });

  it("9. no duplicate local presence state — control writes directly to currentPresence; no shadow state inside the control", () => {
    // SymptomPresenceControl owns NO local state.
    expect(CONTROL_SRC).not.toMatch(/\buseState\b/);
    expect(CONTROL_SRC).not.toMatch(/\buseRef\b/);
    // CurrentSymptoms removed its cyclePresence helper; the page persists the
    // explicit value passed from the control.
    expect(CURRENT_SYMPTOMS).not.toMatch(/function\s+cyclePresence\s*\(/);
    expect(CURRENT_SYMPTOMS).toMatch(/currentPresence:\s*next/);
  });

  it("10. no engine imports introduced in the new control", () => {
    expect(CONTROL_SRC).not.toMatch(/from\s+["']\.\.\/(?:\.\.\/)?engine\//);
    expect(CONTROL_SRC).not.toMatch(/from\s+["']\.\.?\/clinicalBridge["']/);
    expect(CONTROL_SRC).not.toMatch(/from\s+["']\.\.?\/clinicalConstraints["']/);
    expect(CONTROL_SRC).not.toMatch(/from\s+["']\.\.?\/clinicalSemantics["']/);
    expect(CONTROL_SRC).not.toMatch(/from\s+["']\.\.?\/clinicalTemporal["']/);
  });

  it("11. no double-click required — onChange always sets the explicit clicked value", () => {
    // nextPresenceOn returns exactly what was clicked → first click always wins.
    for (const v of [true, false, undefined] as const) expect(nextPresenceOn(v)).toBe(v);
    // The control's onClick handler does not check the prior value before calling onChange.
    expect(CONTROL_SRC).toMatch(/onChange\(nextPresenceOn\(opt\.value\)\)/);
  });

  it("control exposes exactly the three states ? ✓ ✗", () => {
    expect(CONTROL_SRC).toMatch(/symbol:\s*["']\?["']/);
    expect(CONTROL_SRC).toMatch(/symbol:\s*["']✓["']/);
    expect(CONTROL_SRC).toMatch(/symbol:\s*["']✗["']/);
  });
});
