import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC wrapper so the controller is testable without the Tauri runtime.
// `vi.hoisted` so the fns exist before the hoisted `vi.mock` factory runs.
const { buildContradictionCase, getClientExtraction } = vi.hoisted(() => ({
  buildContradictionCase: vi.fn(),
  getClientExtraction: vi.fn(),
}));
vi.mock("../api/tauriApi", () => ({
  isTauri: true,
  TauriAPI: { buildContradictionCase, getClientExtraction },
}));

import {
  collectClinicalEvents,
  runContradictionEngineFromExtraction,
  runContradictionEngineForClient,
  type ContradictionCaseResult,
} from "./contradictionEngine";

const SAMPLE_RESULT: ContradictionCaseResult = {
  case: {
    contradictions: [{ domain: "clinical", conflict_label: "assertion" }],
    timeline: [],
  },
  view: { enriched_contradictions: [{}] },
  export: {
    rows: [
      {
        domain: "clinical",
        subject: "fractured wrist",
        conflict_label: "assertion",
        resolution_confidence: 0.5,
        severity_rank: 3,
        presentation_group: "clinical:assertion",
        cross_domain_tag: null,
        contradiction_id: "contradiction::canonical#diagnosis#fractured wrist",
        source_ids: ["canonical#diagnosis#fractured wrist"],
        edge_ids: [],
      },
    ],
  },
  csv_lines: ["domain,subject,...", "clinical,fractured wrist,..."],
};

beforeEach(() => {
  buildContradictionCase.mockReset();
  getClientExtraction.mockReset();
  buildContradictionCase.mockResolvedValue(JSON.stringify(SAMPLE_RESULT));
});

describe("Contradiction Engine frontend invocation path", () => {
  // 2. extraction_payload_reaches_backend_command
  it("extraction_payload_reaches_backend_command", async () => {
    const extraction = [
      { document_id: "docA", clinical_events: [{ event_id: "e1" }, { event_id: "e2" }] },
      { document_id: "docB", clinical_events: [{ event_id: "e3" }] },
    ];
    await runContradictionEngineFromExtraction(extraction);

    expect(buildContradictionCase).toHaveBeenCalledTimes(1);
    const [clinicalEvents, familyEvents, legalEvents, participants] =
      buildContradictionCase.mock.calls[0];
    // All three docs' clinical_events flattened, in order.
    expect(clinicalEvents).toEqual([
      { event_id: "e1" },
      { event_id: "e2" },
      { event_id: "e3" },
    ]);
    expect(familyEvents).toEqual([]);
    expect(legalEvents).toEqual([]);
    expect(participants).toEqual([]);
  });

  // 3. command_result_is_rendered_or_consumed
  it("command_result_is_rendered_or_consumed", async () => {
    const result = await runContradictionEngineFromExtraction([
      { document_id: "docA", clinical_events: [{ event_id: "e1" }] },
    ]);
    // Result is parsed and consumable by a caller (the dev panel renders these).
    expect(result.case.contradictions.length).toBe(1);
    expect(result.export.rows.length).toBe(1);
    expect(result.csv_lines.length).toBeGreaterThan(0);
  });

  // 4. no_family_or_legal_data_still_succeeds
  it("no_family_or_legal_data_still_succeeds", async () => {
    const result = await runContradictionEngineFromExtraction([
      { document_id: "docA", clinical_events: [{ event_id: "e1" }] },
    ]);
    const [, familyEvents, legalEvents] = buildContradictionCase.mock.calls[0];
    expect(familyEvents).toEqual([]);
    expect(legalEvents).toEqual([]);
    expect(result).toBeTruthy();
  });

  // 5. end_to_end_ui_path_is_deterministic
  it("end_to_end_ui_path_is_deterministic", async () => {
    const ext = [{ document_id: "docA", clinical_events: [{ event_id: "e1" }] }];
    const a = await runContradictionEngineFromExtraction(ext);
    const b = await runContradictionEngineFromExtraction(ext);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("collectClinicalEvents flattens in document order and tolerates missing arrays", () => {
    const flat = collectClinicalEvents([
      { document_id: "d1", clinical_events: [{ event_id: "a" }] },
      { document_id: "d2" }, // no clinical_events
      { document_id: "d3", clinical_events: [{ event_id: "b" }] },
    ]);
    expect(flat).toEqual([{ event_id: "a" }, { event_id: "b" }]);
  });

  it("runContradictionEngineForClient fetches extraction then invokes the command", async () => {
    getClientExtraction.mockResolvedValue(
      JSON.stringify([{ document_id: "docA", clinical_events: [{ event_id: "e1" }] }]),
    );
    const result = await runContradictionEngineForClient("client-1");
    expect(getClientExtraction).toHaveBeenCalledWith("client-1");
    expect(buildContradictionCase).toHaveBeenCalledTimes(1);
    expect(result.case.contradictions.length).toBe(1);
  });
});
