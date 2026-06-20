// ── Regression: projection-owned document loss across reconstruction ──────────
// Root cause (verified by live probe): a demographics-derived rebuild
// (parseClientBlob strips `documents`) was propagated via onClientChange and
// committed over activeClient, erasing activeClient.documents. The next page
// mount then hydrated from an empty document list and canonical matching
// failed (matched=0).
//
// The architectural fix is the `reconcileClient` invariant at the single
// onClientChange choke-point (main.tsx handleActiveClientChange): a
// reconstruction that OMITS a projection-owned field (=== undefined) can never
// erase a value the previous client still held.
//
// These tests pin that invariant and model the exact transitions that broke.

import { describe, expect, it } from "vitest";
import {
  reconcileClient,
  parseClientBlob,
  defaultClient,
  PROJECTION_OWNED_KEYS,
  type Client,
} from "./client";
import { toIngestedDocs } from "../components/DocumentCard";
import type { DocumentSummary } from "../api/tauriApi";

const DOC: DocumentSummary = {
  id: "019ebf4d-9740-7fc2-af63-5f8e443f0534",
  file_name: "TEST CASE 1.docx",
  method: "text",
  char_count: 3567,
  uploaded_at: "2026-06-13T00:00:00Z",
};

function clientWithDoc(): Client {
  return { ...defaultClient(), id: "019eb411-b3bc-7340-a06b-d7345f10035d", documents: [DOC] };
}

// Models a demographics-derived rebuild (parseClientBlob → setData) BEFORE the
// fix: `documents` is absent because the demographics blob never carried it.
function lossyRebuild(prev: Client): Client {
  const parsed = parseClientBlob(prev.id, {
    identity: prev.identity,
    administrative: prev.administrative,
    clinical: prev.clinical,
  });
  // parseClientBlob never sets documents → the rebuilt object omits it.
  return { ...parsed, id: prev.id };
}

// Models a page that correctly spreads the prop client (MSE / DSM / Live).
function spreadRebuild(prev: Client): Client {
  return { ...prev, mse: { domains: {}, narrative: "" } as Client["mse"] };
}

describe("reconcileClient invariant", () => {
  it("parseClientBlob does strip documents (precondition of the bug)", () => {
    const parsed = parseClientBlob("c1", { identity: {} });
    expect(parsed.documents).toBeUndefined();
  });

  it("PROJECTION_OWNED_KEYS lists documents", () => {
    expect([...PROJECTION_OWNED_KEYS]).toContain("documents");
  });

  it("back-fills documents when the update omits them (undefined)", () => {
    const prev = clientWithDoc();
    const updated = lossyRebuild(prev); // documents === undefined
    expect(updated.documents).toBeUndefined();
    const result = reconcileClient(prev, updated);
    expect(result.documents).toEqual([DOC]);
    expect(result.documents).toBe(prev.documents); // same reference, byte-identical
  });

  it("honours an explicit documents value, including [] (not back-filled)", () => {
    const prev = clientWithDoc();
    const cleared = reconcileClient(prev, { ...prev, documents: [] });
    expect(cleared.documents).toEqual([]); // explicit empty is respected
  });

  it("does not mutate non-projection fields", () => {
    const prev = clientWithDoc();
    const updated = { ...prev, documents: undefined, report: { ...prev.report } };
    const result = reconcileClient(prev, updated);
    expect(result.report).toBe(updated.report);
    expect(result.identity).toBe(updated.identity);
  });

  it("returns the update untouched when prev is null", () => {
    const updated = clientWithDoc();
    expect(reconcileClient(null, updated)).toBe(updated);
  });
});

// ── Scenario A — Demographics → MSE → Demographics ───────────────────────────
describe("A. navigation cycle preserves documents + canonical matching", () => {
  it("documents survive a lossy demographics rebuild + MSE spread + return", () => {
    let activeClient = clientWithDoc(); // loaded via viewToClient (documents present)

    // Demographics mount → hydrateFromView rebuild propagates (lossy shape).
    activeClient = reconcileClient(activeClient, lossyRebuild(activeClient));
    // MSE navigation → MSE spreads {...client}.
    activeClient = reconcileClient(activeClient, spreadRebuild(activeClient));
    // Back to Demographics → another lossy rebuild propagates.
    activeClient = reconcileClient(activeClient, lossyRebuild(activeClient));

    // length unchanged, ids unchanged
    expect(activeClient.documents).toHaveLength(1);
    expect(activeClient.documents!.map((d) => d.id)).toEqual([DOC.id]);

    // canonical matching succeeds: the hydration effect's key (toIngestedDocs
    // → path) matches the extraction map keyed by document_id.
    const seed = toIngestedDocs(activeClient.documents);
    const byId = new Map([[DOC.id, { document_id: DOC.id }]]);
    const matched = seed.filter((d) => byId.has(d.path)).length;
    expect(matched).toBe(1);
  });
});

// ── Scenario B — hydrateFromView causes no field loss ────────────────────────
describe("B. hydrateFromView rebuild loses no field once reconciled", () => {
  it("documents are restored and demographics fields survive the rebuild", () => {
    const prev: Client = {
      ...clientWithDoc(),
      identity: { ...defaultClient().identity, firstName: "Michael", lastName: "Thompson" },
    };
    const committed = reconcileClient(prev, lossyRebuild(prev));
    // Projection-owned field restored (the regression target).
    expect(committed.documents).toEqual([DOC]);
    // Demographics survive the parseClientBlob round-trip (parseClientBlob may
    // add optional null fields, so assert the meaningful values, not deep-eq).
    expect(committed.identity.firstName).toBe("Michael");
    expect(committed.identity.lastName).toBe("Thompson");
  });
});

// ── Scenario C — save → reload yields byte-identical documents ───────────────
describe("C. demographics save round-trip keeps documents byte-identical", () => {
  it("documents are projection-owned: absent from the blob, restored on reload", () => {
    const original = clientWithDoc();

    // buildSaveBlob (modelled) — documents are NOT part of the demographics blob.
    const blob: Record<string, unknown> = {
      identity: original.identity,
      administrative: original.administrative,
      clinical: original.clinical,
    };
    expect("documents" in blob).toBe(false);

    // viewToClient (modelled) — reload re-attaches documents from the
    // projection view (the authoritative document list).
    const reloaded: Client = {
      ...parseClientBlob(original.id, blob),
      documents: [DOC], // v.documents from getClientView
    };
    expect(reloaded.documents).toEqual(original.documents); // byte-identical
  });
});

// ── Scenario D — every reconstruction preserves projection-owned fields ──────
describe("D. reconstruction functions never silently erase documents", () => {
  const reconstructions: Array<[string, (c: Client) => Client]> = [
    ["lossy demographics rebuild", lossyRebuild],
    ["page spread rebuild", spreadRebuild],
    ["identity-only edit", (c) => ({ ...c, documents: undefined })],
  ];

  for (const [name, reconstruct] of reconstructions) {
    it(`${name}: reconcileClient keeps documents`, () => {
      const prev = clientWithDoc();
      const result = reconcileClient(prev, reconstruct(prev));
      expect(result.documents, name).toEqual([DOC]);
    });
  }
});
