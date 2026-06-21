// Real IPC contract parity: assert that the field names produced by actual Rust
// serde serialization (tests/contracts/ipc.runtime-keys.json, emitted by
// `cargo run -p xtask -- generate-ipc` from real structural instances) match the
// fields declared in the specta-generated TypeScript (shared/ipc.generated.ts).
//
// No fabricated fixtures, no sample clinical data: keys come from real
// serialization; the TS comes from the Rust source of truth. A mismatch means
// the generated contract has drifted from runtime serialization.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const generatedTs = readFileSync(
  fileURLToPath(new URL("../../shared/ipc.generated.ts", import.meta.url)),
  "utf8",
);
const runtimeKeys: Record<string, string[]> = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./ipc.runtime-keys.json", import.meta.url)),
    "utf8",
  ),
);

/** Field names declared on an `export type X = { ... }` block in the generated TS. */
function tsFields(src: string, typeName: string): string[] {
  const m = src.match(new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`generated IPC is missing type ${typeName}`);
  const fields: string[] = [];
  for (const line of m[1].split("\n")) {
    // Field lines look like `name: type,` or `name?: type,` (optional from
    // `#[serde(default)]`). The `?` does not change the serialized key.
    const fm = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
    if (fm) fields.push(fm[1]);
  }
  return fields.sort();
}

describe("IPC contract: Rust serde ↔ generated TypeScript parity", () => {
  it("covers exactly the 8 structured IPC types", () => {
    expect(Object.keys(runtimeKeys).sort()).toEqual(
      [
        "ClientState",
        "ClientViewModel",
        "DocumentState",
        "DocumentSummary",
        "EventHistoryItem",
        "PIRSTableViewModel",
        "PersistConfirmation",
        "VersionDiff",
      ].sort(),
    );
  });

  for (const [type, rustKeys] of Object.entries(runtimeKeys)) {
    it(`${type}: TS fields equal real serde keys`, () => {
      expect(tsFields(generatedTs, type)).toEqual([...rustKeys].sort());
    });
  }
});
