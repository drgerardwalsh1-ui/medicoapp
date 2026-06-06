/**
 * documentExport — the SAFE "Copy All Data" pipeline for the Documents UI.
 *
 * Hard rules (see UI spec):
 *   - NEVER read the DOM / rendered <details>. Operate on the underlying model
 *     (`IngestedDoc[]`) only.
 *   - Output is INDEPENDENT of expand/collapse state — collapsed sections are
 *     always included.
 *   - Future-proof: every document's COMPLETE model is dumped as JSON at the
 *     end of its block, so any field added to the model later is exported with
 *     no change to this code (the human-readable summary is best-effort on top).
 *   - Size-aware delivery: small exports go to the clipboard; large exports (or
 *     a clipboard failure) fall back to a Blob download. No chunked clipboard.
 *
 * Pipeline:  docs[] → toExportModel(doc) → renderExportBundle(docs) → deliverExport()
 */

import type { IngestedDoc, ProcessedDocument } from "../components/DocumentCard";

// Fields deliberately excluded from the exported model. DENYLIST (not a
// whitelist) so that NEW model fields are exported automatically:
//   - ner / sci : transient, advisory spaCy/scispaCy candidates (debug only)
//   - text      : duplicated by canonical.raw_text / clean_text
const EXPORT_DENYLIST = new Set<keyof IngestedDoc>(["ner", "sci", "text"]);

export type ExportDoc = Omit<IngestedDoc, "ner" | "sci" | "text">;

/**
 * Project one document to its exportable model. Denylist-based: anything not
 * explicitly excluded survives, so future model fields appear automatically.
 */
export function toExportModel(doc: IngestedDoc): ExportDoc {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(doc) as (keyof IngestedDoc)[]) {
    if (EXPORT_DENYLIST.has(k)) continue;
    out[k] = doc[k];
  }
  return out as ExportDoc;
}

// ── Human-readable bundle ──────────────────────────────────────────────────

const RULE = "=".repeat(72);
const SUBRULE = "-".repeat(72);

function fmtList(label: string, values?: string[]): string | null {
  if (!values || values.length === 0) return null;
  return `${label} (${values.length}): ${values.join(", ")}`;
}

function fmtCanonicalSummary(canon: ProcessedDocument): string[] {
  const lines: string[] = [];

  // People & parties
  const p = canon.parties;
  if (p && (p.doctor || p.patient || p.organisation)) {
    const bits: string[] = [];
    if (p.doctor) bits.push(`Doctor: ${p.doctor}`);
    if (p.patient) bits.push(`Patient: ${p.patient}`);
    if (p.organisation) bits.push(`Organisation: ${p.organisation}`);
    lines.push(`Parties: ${bits.join(" | ")}`);
  }
  if (canon.people && canon.people.length) {
    lines.push(
      `People (${canon.people.length}): ` +
        canon.people.map((x) => `${x.name} [${x.role}]`).join(", "),
    );
  }

  // Condition mentions grouped by assertion status
  if (canon.condition_mentions && canon.condition_mentions.length) {
    const byStatus = new Map<string, string[]>();
    for (const m of canon.condition_mentions) {
      const arr = byStatus.get(m.status) ?? [];
      arr.push(m.term);
      byStatus.set(m.status, arr);
    }
    lines.push(`Condition mentions (${canon.condition_mentions.length}):`);
    for (const [status, terms] of byStatus) {
      lines.push(`  - ${status.replace("_", " ")}: ${terms.join(", ")}`);
    }
  }

  // Entity buckets
  const e = canon.entities;
  if (e) {
    const entityLines = [
      fmtList("Conditions", e.conditions),
      fmtList("Symptoms", e.symptoms),
      fmtList("Medications", e.medications),
      fmtList("Procedures", e.procedures),
      fmtList("Organisations", e.organisations),
    ].filter((x): x is string => x !== null);
    lines.push(...entityLines);
  }

  // Dates
  const dates = canon.dates_struct;
  if (dates && dates.length) {
    lines.push(
      `Dates (${dates.length}): ` +
        dates.map((d) => `${d.value} (${d.precision})`).join(", "),
    );
  }

  // Removed noise audit (text-cleaning exclusions). Surfaced ONLY from the
  // existing model field — no derivation. (Canonical UI name: "Removed noise
  // audit"; the full segments + reasons also ship in the model JSON dump.)
  const removed = canon.removed_lines;
  if (removed && removed.length) {
    lines.push(`Removed noise audit (${removed.length} excluded):`);
    for (const rl of removed) {
      lines.push(`  - [${rl.reason}] ${rl.line}`);
    }
  }

  return lines;
}

/**
 * Build the primary, human-readable medico-legal export bundle.
 *
 * Per document: header → extracted summary sections → extracted text →
 * complete structured model as JSON (the future-proof completeness guarantee).
 */
export function renderExportBundle(
  docs: IngestedDoc[],
  /**
   * Optional STEP-6 observability root (deterministic, backend-composed). When
   * supplied, it is appended verbatim as a top-level `step6` JSON block — the
   * export payload is EXTENDED, never restructured.
   */
  step6?: unknown,
): string {
  const now = new Date().toISOString();
  const out: string[] = [];

  out.push("MEDICO-LEGAL DOCUMENT EXPORT");
  out.push(`Generated: ${now}`);
  out.push(`Documents: ${docs.length}`);
  out.push(RULE);
  out.push("");

  docs.forEach((doc, i) => {
    const model = toExportModel(doc);
    const canon = (doc.canonical as ProcessedDocument | undefined) ?? undefined;

    out.push(`DOCUMENT ${i + 1}: ${doc.fileName}`);
    out.push(`ID: ${doc.documentId ?? "(not persisted)"}`);
    out.push(`Method: ${doc.method} | Chars: ${doc.charCount}`);
    out.push(SUBRULE);

    if (doc.error) {
      out.push(`ERROR: ${doc.error}`);
    }

    if (canon) {
      const summary = fmtCanonicalSummary(canon);
      if (summary.length) out.push(...summary);
      else out.push("(no extracted summary fields)");

      const text = canon.clean_text ?? canon.raw_text;
      if (text) {
        out.push("");
        out.push("Extracted text:");
        out.push(text);
      }
    } else {
      out.push("(no extraction content loaded for this document)");
    }

    // Future-proof completeness: dump the WHOLE model. Any new field added to
    // the document model later is exported here with no code change.
    out.push("");
    out.push("Structured analysis (JSON):");
    out.push(safeJson(model));

    out.push("");
    out.push(RULE);
    out.push("");
  });

  // Top-level `step6` payload — appended, never restructuring the doc export.
  if (step6 !== undefined && step6 !== null) {
    out.push("STEP 6 OBSERVABILITY (JSON):");
    out.push(safeJson(step6));
    out.push("");
    out.push(RULE);
    out.push("");
  }

  return out.join("\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "/* model not serialisable */";
  }
}

// ── Size-aware delivery ────────────────────────────────────────────────────

/** Clipboard ceiling. Above this we always download instead of copying. */
export const CLIPBOARD_BYTE_LIMIT = 2 * 1024 * 1024; // ~2 MB

export type DeliveryResult =
  | { mode: "clipboard"; bytes: number }
  | { mode: "download"; bytes: number; filename: string };

/**
 * Deliver an export string. Small payloads → clipboard; large payloads (or a
 * clipboard write failure, e.g. no permission / unavailable API) → file
 * download via Blob + object URL. Never attempts chunked clipboard writes.
 */
export async function deliverExport(
  text: string,
  filename: string,
): Promise<DeliveryResult> {
  const bytes = new Blob([text]).size;

  const clipboardOk =
    bytes < CLIPBOARD_BYTE_LIMIT &&
    typeof navigator !== "undefined" &&
    !!navigator.clipboard?.writeText;

  if (clipboardOk) {
    try {
      await navigator.clipboard.writeText(text);
      return { mode: "clipboard", bytes };
    } catch {
      // Fall through to download on any clipboard failure.
    }
  }

  downloadBlob(text, filename);
  return { mode: "download", bytes, filename };
}

function downloadBlob(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Top-level convenience used by the toolbar: render the model-driven bundle for
 * `docs` and deliver it size-aware. Generated ON DEMAND (never memoised).
 */
export async function copyAllDocuments(
  docs: IngestedDoc[],
  opts?: { filenamePrefix?: string; step6?: unknown },
): Promise<DeliveryResult> {
  const bundle = renderExportBundle(docs, opts?.step6);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${opts?.filenamePrefix ?? "documents"}-export-${stamp}.txt`;
  return deliverExport(bundle, filename);
}
