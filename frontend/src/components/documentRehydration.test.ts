import { describe, it, expect } from "vitest";
import { toIngestedDocs, canonicalFromExtraction } from "./DocumentCard";

// Regression lock for the "documents disappear after navigation" bug.
// Root cause was that the projection document list was dropped during
// client reconstruction; `toIngestedDocs` is the single mapper every
// rehydration site now uses, so it must faithfully map BOTH the
// projection (snake_case) and in-session (camelCase) shapes.

describe("toIngestedDocs — projection → UI document mapping", () => {
  it("maps a projection DocumentSummary (snake_case) to an IngestedDoc", () => {
    const out = toIngestedDocs([
      {
        id: "doc-1",
        file_name: "FakeClient1.pdf",
        method: "ocr",
        char_count: 777,
        uploaded_at: "2026-06-01T00:00:00Z",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe("FakeClient1.pdf");
    expect(out[0].method).toBe("ocr");
    expect(out[0].charCount).toBe(777);
    // The projection id becomes the stable path key for rehydrated docs.
    expect(out[0].path).toBe("doc-1");
  });

  it("preserves in-session camelCase docs (incl. rich extraction payloads)", () => {
    const canonical = { doc_id: "x", clinical_events: [] };
    const out = toIngestedDocs([
      {
        fileName: "Live.pdf",
        path: "/tmp/Live.pdf",
        method: "text",
        charCount: 42,
        ocrAvailable: true,
        text: "hello",
        canonical,
      },
    ]);
    expect(out[0].fileName).toBe("Live.pdf");
    expect(out[0].path).toBe("/tmp/Live.pdf");
    expect(out[0].charCount).toBe(42);
    expect(out[0].ocrAvailable).toBe(true);
    expect(out[0].text).toBe("hello");
    // Rich extraction payload round-trips losslessly.
    expect(out[0].canonical).toBe(canonical);
  });

  it("returns [] for null/undefined/empty (no crash on missing documents)", () => {
    expect(toIngestedDocs(null)).toEqual([]);
    expect(toIngestedDocs(undefined)).toEqual([]);
    expect(toIngestedDocs([])).toEqual([]);
  });

  it("sets documentId from DocumentSummary.id (deletion identifier, NOT path)", () => {
    // Identifier-strategy lock: rehydrated docs must carry the authoritative
    // documentId so deletion never relies on the overloaded `path`.
    const out = toIngestedDocs([
      { id: "019e-doc-uuid", file_name: "TEST CASE 3.docx", method: "text", char_count: 557 },
    ]);
    expect(out[0].documentId).toBe("019e-doc-uuid");
    expect(out[0].path).toBe("019e-doc-uuid"); // path still mirrors id for rehydrated docs
  });

  it("leaves documentId undefined when no id is present (non-persisted doc)", () => {
    const out = toIngestedDocs([
      { fileName: "InProgress.pdf", path: "/tmp/InProgress.pdf", method: "text", charCount: 10 },
    ]);
    expect(out[0].documentId).toBeUndefined();
  });

  it("falls back gracefully when fields are absent", () => {
    const out = toIngestedDocs([{}]);
    expect(out[0].fileName).toBe("(unnamed)");
    expect(out[0].method).toBe("text");
    expect(out[0].charCount).toBe(0);
    expect(out[0].ocrAvailable).toBe(false);
  });

  it("maps a mixed list (navigation scenario: projection + in-session)", () => {
    // Simulates hydrateFromView merging a freshly-uploaded in-session doc
    // with the projection list on refetch.
    const out = toIngestedDocs([
      { id: "d1", file_name: "A.pdf", method: "ocr", char_count: 100 },
      { fileName: "B.pdf", path: "/tmp/B.pdf", method: "text", charCount: 50, ocrAvailable: false },
    ]);
    expect(out.map((d) => d.fileName)).toEqual(["A.pdf", "B.pdf"]);
    expect(out.map((d) => d.charCount)).toEqual([100, 50]);
  });
});

describe("canonicalFromExtraction — rebuild canonical from persisted events", () => {
  const ce = (over: Record<string, unknown>) => ({
    event_id: "e",
    source_document_id: "d",
    source_snippet: "snip",
    participants: [],
    ...over,
  });

  it("reconstructs clinical_events verbatim + derived summary blocks", () => {
    const canon = canonicalFromExtraction({
      document_id: "d1",
      raw_text: "RAW",
      clean_text: "CLEAN",
      clinical_events: [
        ce({ event_type: "diagnosis", concept: "post-traumatic stress disorder", assertion_status: "affirmed", source_snippet: "Dx: PTSD" }),
        ce({ event_type: "diagnosis", concept: "depression", assertion_status: "queried", source_snippet: "? depn" }),
        ce({ event_type: "symptom", concept: "anxiety" }),
        ce({ event_type: "medication_mention", concept: "sertraline" }),
        ce({ event_type: "procedure", concept: "physiotherapy" }),
        ce({ event_type: "investigation_mention", concept: "mri" }),
        ce({ event_type: "organisation", concept: "Personal Injury Commission" }),
        ce({ event_type: "person", concept: "Dr Lewis", participants: [{ role: "author", name: "Dr Lewis" }] }),
        ce({ event_type: "person", concept: "Jane Doe", participants: [{ role: "patient", name: "Jane Doe" }] }),
        ce({ event_type: "document_date", concept: "2021-07-11", date: "2021-07-11", date_precision: "day", source_snippet: "11 July 2021" }),
      ],
      attributions: [{ event_id: "e", participant_name: "Dr Lewis", participant_role: "treating_psychologist" }],
    });

    // Verbatim clinical events preserved.
    expect(canon.clinical_events).toHaveLength(10);
    // Persisted texts carried through (text toggle survives).
    expect(canon.raw_text).toBe("RAW");
    expect(canon.clean_text).toBe("CLEAN");
    // Derived entity summary lists.
    expect(canon.entities?.conditions).toEqual(["post-traumatic stress disorder", "depression"]);
    expect(canon.entities?.symptoms).toEqual(["anxiety"]);
    expect(canon.entities?.medications).toEqual(["sertraline"]);
    expect(canon.entities?.procedures).toEqual(["physiotherapy", "mri"]);
    expect(canon.entities?.organisations).toEqual(["Personal Injury Commission"]);
    // Condition mentions carry assertion status (affirm/queried preserved).
    expect(canon.condition_mentions).toEqual([
      { term: "post-traumatic stress disorder", status: "affirmed", snippet: "Dx: PTSD" },
      { term: "depression", status: "queried", snippet: "? depn" },
    ]);
    // Dates.
    expect(canon.dates_struct).toEqual([
      { raw: "11 July 2021", value: "2021-07-11", precision: "day" },
    ]);
    // People + derived parties.
    expect(canon.people?.map((p) => p.name)).toEqual(["Dr Lewis", "Jane Doe"]);
    expect(canon.parties?.doctor).toBe("Dr Lewis");
    expect(canon.parties?.patient).toBe("Jane Doe");
    expect(canon.parties?.organisation).toBe("Personal Injury Commission");
    // Attribution preserved on the canonical blob.
    expect(canon.attributions).toHaveLength(1);
  });

  it("handles an empty extraction (no crash, empty canonical)", () => {
    const canon = canonicalFromExtraction({ document_id: "d", clinical_events: [], attributions: [] });
    expect(canon.clinical_events).toEqual([]);
    expect(canon.entities?.conditions).toEqual([]);
    expect(canon.condition_mentions).toEqual([]);
  });

  it("does NOT reconstruct NER or unified events (transient by design)", () => {
    const canon = canonicalFromExtraction({
      document_id: "d",
      clinical_events: [{ event_id: "e", event_type: "diagnosis", concept: "x", source_document_id: "d", source_snippet: "s", participants: [] }],
    });
    // unified_clinical_events intentionally left undefined (dev-only rollup).
    expect(canon.unified_clinical_events).toBeUndefined();
  });
});
