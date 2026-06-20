// @vitest-environment jsdom
// ── Template store tests ────────────────────────────────────────────────────────
// Pins the clone-and-adjust library semantics: built-ins immutable, clones
// editable and persisted, storage failures degrade gracefully.

import { beforeEach, describe, expect, it } from "vitest";
import {
  cloneTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  saveTemplate,
} from "./templateStore";
import { BUILTIN_TEMPLATES } from "../data/interviewTemplates";

beforeEach(() => window.localStorage.clear());

describe("template store", () => {
  it("lists built-ins when no custom templates exist", () => {
    expect(listTemplates().map((t) => t.id)).toEqual(BUILTIN_TEMPLATES.map((t) => t.id));
  });

  it("clones a built-in into an editable, persisted copy", () => {
    const clone = cloneTemplate("builtin-mva-threshold-wpi")!;
    expect(clone.builtin).toBe(false);
    expect(clone.name).toBe("MVA — threshold & WPI (copy)");
    expect(clone.sections).toEqual(
      BUILTIN_TEMPLATES.find((t) => t.id === "builtin-mva-threshold-wpi")!.sections,
    );
    // Persisted: a fresh read sees it.
    expect(getTemplate(clone.id)).toBeDefined();
  });

  it("saves edits to a clone; refuses edits to built-ins", () => {
    const clone = cloneTemplate("builtin-wc")!;
    saveTemplate({ ...clone, name: "WC — my version" });
    expect(getTemplate(clone.id)!.name).toBe("WC — my version");

    const builtin = getTemplate("builtin-wc")!;
    saveTemplate({ ...builtin, name: "hacked" });
    expect(getTemplate("builtin-wc")!.name).toBe("Workers compensation");
  });

  it("deletes custom templates; built-ins are untouchable", () => {
    const clone = cloneTemplate("builtin-general")!;
    deleteTemplate(clone.id);
    expect(getTemplate(clone.id)).toBeUndefined();
    deleteTemplate("builtin-general");
    expect(getTemplate("builtin-general")).toBeDefined();
  });
});
