import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const PAGE = read("pages/CurrentSymptomsPage.tsx");
const DECISION_VIEW = read("integration/ui/ClinicalDecisionView.tsx");
const HYPOTHESIS_PANEL = read("integration/ui/ClinicalHypothesisPanel.tsx");
const FORENSIC_DRAWER = read("integration/ui/ClinicalForensicDrawer.tsx");
const CLINICAL_UX = read("integration/clinicalUX.ts");

describe("Phase 17 — UI migration: ClinicalDecisionView as primary", () => {
  it("1. CurrentSymptomsPage renders ClinicalDecisionView as the primary interface", () => {
    expect(PAGE).toMatch(/import\s+ClinicalDecisionView\s+from\s+["']\.\.\/integration\/ui\/ClinicalDecisionView["']/);
    expect(PAGE).toMatch(/<ClinicalDecisionView\s/);
  });

  it("2. ClinicalOverlayPanel is no longer rendered in the primary path", () => {
    // Not imported, not rendered.
    expect(PAGE).not.toMatch(/import[^;]*ClinicalOverlayPanel[^;]*from/);
    expect(PAGE).not.toMatch(/<ClinicalOverlayPanel/);
  });

  it("3. No candidacy list / overlay-panel components in the default UI tree", () => {
    expect(PAGE).not.toMatch(/<ClinicalOverlayPanel/);
    // Page does not render raw candidacy/summary lists itself.
    expect(PAGE).not.toMatch(/overlay\.candidacies/);
    expect(PAGE).not.toMatch(/overlay\.summaries/);
  });

  it("4. No semanticState list rendered directly in the page", () => {
    expect(PAGE).not.toMatch(/overlay\.states/);
    expect(PAGE).not.toMatch(/semanticStates/);
  });

  it("5. UI components do not import engine/* directly", () => {
    for (const src of [DECISION_VIEW, HYPOTHESIS_PANEL, FORENSIC_DRAWER, CLINICAL_UX]) {
      expect(src).not.toMatch(/from\s+["']\.\.\/(?:\.\.\/)?engine\//);
    }
  });

  it("6. ClinicalDecisionView consumes ONLY snapshot + replay", () => {
    // Component prop signature: { snapshot, replay }.
    expect(DECISION_VIEW).toMatch(/snapshot:\s*ReportSnapshotV2/);
    expect(DECISION_VIEW).toMatch(/replay:\s*ClinicalReplay/);
    // No bridge / overlay arguments leaked into the component.
    expect(DECISION_VIEW).not.toMatch(/overlay:\s*ClinicalOverlay/);
  });

  it("7. Snapshot is computed deterministically per client state via useMemo dependencies", () => {
    expect(PAGE).toMatch(/useMemo\(/);
    // Stable input deps — no Date.now() / random in the page.
    expect(PAGE).not.toMatch(/Date\.now\(/);
    expect(PAGE).not.toMatch(/Math\.random\(/);
    // takenAt is derived from stable client field, not a runtime stamp.
    expect(PAGE).toMatch(/takenAt:\s*client\.updated_at/);
  });

  it("8. Forensic drawer contains all the removed detail views", () => {
    // Drawer renders semantic evolution, constraint events, temporal qualifications,
    // differential map, and observations — the surfaces removed from main view.
    expect(FORENSIC_DRAWER).toMatch(/semanticEvolution/);
    expect(FORENSIC_DRAWER).toMatch(/constraintEvents/);
    expect(FORENSIC_DRAWER).toMatch(/temporalQualifications/);
    expect(FORENSIC_DRAWER).toMatch(/differentialMap/);
    expect(FORENSIC_DRAWER).toMatch(/observations/);
  });

  it("9. No duplicate diagnostic systems remain — only DecisionView in main render", () => {
    // The page imports DecisionView once; no other diagnostic-panel imports remain.
    const decisionImports = (PAGE.match(/ClinicalDecisionView/g) ?? []).length;
    expect(decisionImports).toBeGreaterThanOrEqual(2); // import + JSX
    expect(PAGE).not.toMatch(/ClinicalHypothesisPanel/); // rendered transitively, not directly
    expect(PAGE).not.toMatch(/ClinicalForensicDrawer/); // rendered transitively, not directly
  });

  it("10. UI state separation — symptom INPUT and decision VIEW are distinct sections", () => {
    // Input layer present
    expect(PAGE).toMatch(/<CurrentSymptoms\s/);
    // Decision view in a separate section, NOT inside the symptom input boundary
    expect(PAGE).toMatch(/<DSMErrorBoundary[^>]*>[\s\S]*?<CurrentSymptoms[\s\S]*?<\/DSMErrorBoundary>/);
    expect(PAGE).toMatch(/<\/DSMErrorBoundary>[\s\S]*<ClinicalDecisionView/);
  });

  it("data flow — page consumes engine output via the bridge/snapshot/replay pipeline, never re-runs the engine", () => {
    expect(PAGE).toMatch(/runClinicalOverlay/);
    expect(PAGE).toMatch(/buildReportSnapshotV2/);
    expect(PAGE).toMatch(/buildClinicalReplay/);
    // No direct engine imports from the page.
    expect(PAGE).not.toMatch(/from\s+["']\.\.\/engine\//);
  });
});
