import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const PAGE = read("pages/CurrentSymptomsPage.tsx");
const VIEW = read("integration/ui/ClinicalDecisionView.tsx");
const HYPOTHESIS_PANEL = read("integration/ui/ClinicalHypothesisPanel.tsx");
const FORENSIC_DRAWER = read("integration/ui/ClinicalForensicDrawer.tsx");

describe("Phase 18.1 — non-dominating decision UX", () => {
  it("1. CurrentSymptoms remains interactable (rendered normally, not disabled / not wrapped in disabling container)", () => {
    expect(PAGE).toMatch(/<CurrentSymptoms\s/);
    // No disabling attributes / pointer-events-none / scroll trap on the input layer.
    expect(PAGE).not.toMatch(/pointer-events-none/);
    expect(PAGE).not.toMatch(/disabled\s*=\s*\{?\s*true\b/);
    expect(PAGE).not.toMatch(/inert\b/);
  });

  it("2. ClinicalDecisionView defaults to collapsed", () => {
    // expanded state defaults to false (with or without an explicit generic).
    expect(VIEW).toMatch(/const\s+\[expanded[^\]]*\]\s*=\s*useState\b[^;]*\(\s*false\s*\)/);
    expect(VIEW).toMatch(/Default COLLAPSED/);
  });

  it("3. Expanded state is inline in document flow (no fixed positioning, no overlays)", () => {
    // No fixed / absolute viewport-blocking containers in the view itself.
    expect(VIEW).not.toMatch(/className=["'`][^"'`]*\bfixed\b/);
    expect(VIEW).not.toMatch(/className=["'`][^"'`]*\babsolute\b/);
    expect(VIEW).not.toMatch(/inset-0/);
  });

  it("4. No fixed positioning anywhere in decision view or its child panels", () => {
    for (const src of [VIEW, HYPOTHESIS_PANEL, FORENSIC_DRAWER]) {
      expect(src).not.toMatch(/className=["'`][^"'`]*\bfixed\b/);
    }
  });

  it("5. Collapsed mode caps hypotheses at 2", () => {
    // Implementation uses a literal cap of 2.
    expect(VIEW).toMatch(/COLLAPSED_HYPOTHESIS_CAP\s*=\s*2/);
    expect(VIEW).toMatch(/\.slice\(0,\s*COLLAPSED_HYPOTHESIS_CAP\)/);
  });

  it("6. Finalize button is visible in collapsed mode (header, not inside expanded block)", () => {
    // The Finalize button text appears in the header (always rendered when
    // canFinalize). It must appear BEFORE the expanded-only block.
    const finalizeIdx = VIEW.search(/>\s*Finalize\s*</);
    const expandedBlockIdx = VIEW.indexOf("{expanded && (");
    expect(finalizeIdx).toBeGreaterThan(-1);
    expect(expandedBlockIdx).toBeGreaterThan(-1);
    expect(finalizeIdx).toBeLessThan(expandedBlockIdx);
  });

  it("7. Expanded mode reveals decision pressure / temporal flags / forensic drawer", () => {
    // These sections are inside the {expanded && ...} block.
    expect(VIEW).toMatch(/\{expanded && \(/);
    expect(VIEW).toMatch(/Decision pressure/);
    expect(VIEW).toMatch(/Temporal flags/);
    expect(VIEW).toMatch(/<ClinicalForensicDrawer/);
  });

  it("8. No viewport-blocking containers (no h-screen / min-h-screen / full-viewport sizing)", () => {
    for (const src of [VIEW, HYPOTHESIS_PANEL, FORENSIC_DRAWER]) {
      expect(src).not.toMatch(/h-screen/);
      expect(src).not.toMatch(/min-h-screen/);
      expect(src).not.toMatch(/h-full\s/); // top-level full-height that could trap scroll
    }
  });

  it("9. Snapshot/replay flow unchanged — view passes them through unmutated", () => {
    // Snapshot + replay forwarded to the modal verbatim; never reconstructed.
    expect(VIEW).toMatch(/snapshot=\{snapshot\}/);
    expect(VIEW).toMatch(/replay=\{replay\}/);
    // View never builds a decision itself (Phase 18 invariant preserved).
    expect(VIEW).not.toMatch(/createClinicalDecision\b/);
    expect(VIEW).not.toMatch(/createClinicalDecisionFromSnapshot\b/);
  });

  it("10. No engine imports introduced", () => {
    for (const src of [VIEW, HYPOTHESIS_PANEL, FORENSIC_DRAWER]) {
      expect(src).not.toMatch(/from\s+["']\.\.\/(?:\.\.\/)?engine\//);
      expect(src).not.toMatch(/from\s+["']\.\.?\/clinicalBridge["']/);
    }
  });

  it("page layout — decision view sits BELOW symptom entry in document flow", () => {
    expect(PAGE).toMatch(/<DSMErrorBoundary[\s\S]*?<CurrentSymptoms[\s\S]*?<\/DSMErrorBoundary>[\s\S]*<ClinicalDecisionView/);
  });
});
