import { describe, it, expect } from "vitest";

import { renderExportBundle } from "./documentExport";
import type { IngestedDoc } from "../components/DocumentCard";

const docs = [
  {
    fileName: "a.pdf",
    path: "/a.pdf",
    method: "text",
    charCount: 10,
    documentId: "doc-1",
  },
] as unknown as IngestedDoc[];

describe("Copy All Data — STEP-6 payload extension", () => {
  it("omits the step6 block when no payload is supplied (unchanged export)", () => {
    const bundle = renderExportBundle(docs);
    expect(bundle).not.toContain("STEP 6 OBSERVABILITY (JSON):");
    // Existing document content is still present.
    expect(bundle).toContain("DOCUMENT 1: a.pdf");
  });

  it("appends a top-level step6 JSON block when supplied", () => {
    const step6 = { snapshot: { report_id: "step6:1:1:1:0" }, dashboard: { summary: { total_items: 1 } } };
    const bundle = renderExportBundle(docs, step6);
    expect(bundle).toContain("STEP 6 OBSERVABILITY (JSON):");
    expect(bundle).toContain('"report_id": "step6:1:1:1:0"');
    // Document content remains intact (payload extended, not restructured).
    expect(bundle).toContain("DOCUMENT 1: a.pdf");
  });

  it("treats null step6 as absent", () => {
    const bundle = renderExportBundle(docs, null);
    expect(bundle).not.toContain("STEP 6 OBSERVABILITY (JSON):");
  });
});
