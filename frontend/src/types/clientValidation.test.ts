import { describe, it, expect } from "vitest";
import { validateClientName } from "./clientValidation";
import {
  isPersistedClientId,
  isDraftClientId,
  DRAFT_CLIENT_ID,
  defaultClient,
} from "./client";

describe("validateClientName", () => {
  describe("accepts", () => {
    it("single-character first name", () => {
      expect(validateClientName({ firstName: "A", lastName: "" }).ok).toBe(true);
    });

    it("single-character last name", () => {
      expect(validateClientName({ firstName: "", lastName: "J" }).ok).toBe(true);
    });

    it("two-character names", () => {
      expect(validateClientName({ firstName: "Li", lastName: "" }).ok).toBe(true);
    });

    it("first name only", () => {
      expect(validateClientName({ firstName: "Tommy", lastName: "" }).ok).toBe(true);
    });

    it("last name only", () => {
      expect(validateClientName({ firstName: "", lastName: "Tester" }).ok).toBe(true);
    });

    it("both names", () => {
      expect(validateClientName({ firstName: "Tommy", lastName: "Tester" }).ok).toBe(true);
    });
  });

  describe("rejects", () => {
    it("empty strings", () => {
      const r = validateClientName({ firstName: "", lastName: "" });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("at least one name field");
    });

    it("whitespace only", () => {
      expect(validateClientName({ firstName: "   ", lastName: "  " }).ok).toBe(false);
    });

    it("null + undefined", () => {
      expect(validateClientName({ firstName: null, lastName: undefined }).ok).toBe(false);
    });

    it("undefined + null", () => {
      expect(validateClientName({ firstName: undefined, lastName: null }).ok).toBe(false);
    });
  });
});

describe("isPersistedClientId", () => {
  it("accepts a real server-minted UUID", () => {
    expect(isPersistedClientId("019e7f00-1234-7890-abcd-deadbeefcafe")).toBe(true);
  });

  describe("rejects (NOT a real client identity)", () => {
    it("the draft sentinel", () => {
      expect(isPersistedClientId(DRAFT_CLIENT_ID)).toBe(false);
    });

    it("null", () => {
      expect(isPersistedClientId(null)).toBe(false);
    });

    it("undefined", () => {
      expect(isPersistedClientId(undefined)).toBe(false);
    });

    it("empty string", () => {
      expect(isPersistedClientId("")).toBe(false);
    });

    it("whitespace only", () => {
      expect(isPersistedClientId("   ")).toBe(false);
    });
  });
});

describe("isDraftClientId", () => {
  it("is true for the sentinel", () => {
    expect(isDraftClientId(DRAFT_CLIENT_ID)).toBe(true);
  });

  it("is false for a real id", () => {
    expect(isDraftClientId("019e7f00-1234-7890-abcd-deadbeefcafe")).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(isDraftClientId(null)).toBe(false);
    expect(isDraftClientId(undefined)).toBe(false);
  });
});

describe("defaultClient", () => {
  it("produces a DRAFT sentinel id, never a real UUID", () => {
    const c = defaultClient();
    expect(c.id).toBe(DRAFT_CLIENT_ID);
    expect(isPersistedClientId(c.id)).toBe(false);
    expect(isDraftClientId(c.id)).toBe(true);
  });

  it("does not mint a random UUID (two drafts share the sentinel)", () => {
    // Regression guard: the old defaultClient() called crypto.randomUUID()
    // which produced phantom-client identities. Two drafts must now share
    // the same non-identity sentinel.
    expect(defaultClient().id).toBe(defaultClient().id);
    expect(defaultClient().id).toBe(DRAFT_CLIENT_ID);
  });
});
