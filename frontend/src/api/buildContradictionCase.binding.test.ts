import { describe, it, expect, vi, beforeAll } from "vitest";

// Make the module-level `isTauri` evaluate true at import time, then mock the
// real Tauri `invoke` so we can assert the exact command + argument mapping.
const invokeMock = vi.fn().mockResolvedValue("{}");
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeAll(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});

describe("buildContradictionCase IPC binding", () => {
  // 1. frontend_can_invoke_build_contradiction_case
  it("frontend_can_invoke_build_contradiction_case", async () => {
    // Import AFTER stubbing window so `isTauri` is true and `guarded` invokes.
    const { TauriAPI } = await import("./tauriApi");

    const clinicalEvents = [{ event_id: "e1" }];
    const participants = [{ participant_id: "p1" }];
    await TauriAPI.buildContradictionCase(clinicalEvents, [], [], participants);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0];
    // Correct backend command name.
    expect(cmd).toBe("build_contradiction_case");
    // camelCase argument keys matching the Rust `rename_all = "camelCase"` command.
    expect(args).toEqual({
      clinicalEvents,
      familyEvents: [],
      legalEvents: [],
      participants,
      cleanTexts: [],
    });
  });
});
