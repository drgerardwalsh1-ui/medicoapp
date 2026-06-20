// ── Capture-layer ReferenceEntity (v5, SHADOW MODE) ────────────────────────────
// A constrained, NON-INVASIVE capture-layer identity adapter. It exists ONLY to
// give interview references ("a thing the interview refers to") a stable capture
// identity so Claims/Findings can deduplicate and re-use the same referent.
//
// HARD INVARIANTS (enforced here):
//   • No clinical truth. A ReferenceEntity holds {id, kind, label, provenance}
//     and NOTHING else — no dates (beyond provenance), severity, diagnosis,
//     attribution, temporal logic, or extracted facts.
//   • Two separate id spaces. ReferenceEntityId is capture-layer, frontend-minted.
//     ClinicalEvent.event_id (backend, content-addressed) is NEVER mirrored or
//     reused as a capture id — it only appears inside a resolution record.
//   • Append-only. Every operation returns a NEW frozen log entry; nothing is
//     mutated, overwritten, or deleted.
//   • Best-effort resolution. RESOLVES_TO is optional (0..1), non-authoritative;
//     most interview references never resolve to a backend ClinicalEvent.
//   • SHADOW: this module imports NOTHING from engine/, rules/, integration/, or
//     the backend, and feeds NO reasoning system. It builds an identity graph
//     and influences no clinical outcome.
//
// It REPLACES only the v3/v4 prototype capture nodes EventNode / TreatmentNode /
// TimeAnchor. It touches no ClinicalEvent, no authored clinical model, no engine.

import type { HistoryCategory, TreatmentCategory } from "../types/history";

// Branding helper — mirrors the (non-exported) pattern in types/ontology.ts.
type Brand<T, B> = T & { readonly __brand: B };

/** Capture-layer identity. Frontend-minted. NEVER derived from a backend id. */
export type ReferenceEntityId = Brand<string, "ReferenceEntityId">;

/** Opaque view of a backend ClinicalEvent.event_id. Stored, never minted here. */
export type ClinicalEventIdRef = string;

// ── KindUnion — CLOSED union over EXISTING taxonomy labels only ────────────────
// No new ontology terms. Backend-sourced unions are mirrored as string literals
// (the backend has no TS type to import); their source of truth is cited.

/** Mirror of clinical_events.rs `EventType::as_str` (backend source of truth). */
export type ClinicalEventKind =
  | "diagnosis" | "symptom" | "medication_mention" | "procedure"
  | "investigation_mention" | "organisation" | "person" | "document_date";

/** Mirror of case_events.rs `LegalRole::as_str` (backend source of truth). */
export type LegalRoleKind =
  | "claimant" | "applicant" | "respondent" | "plaintiff" | "defendant" | "unknown";

/** The closed set of allowed kinds. LABEL ONLY — carries no semantics here. */
export type KindUnion = ClinicalEventKind | HistoryCategory | TreatmentCategory | LegalRoleKind;

// Concepts the spec names ("incident", "employment event", "time anchor") are NOT
// new kinds — they coerce to the nearest existing label. Pure label coercion; no
// reasoning, no ontology extension.
export const NEAREST_KIND: Readonly<Record<string, KindUnion>> = Object.freeze({
  incident: "trauma",            // HistoryCategory
  employment_event: "work",      // HistoryCategory
  time_anchor: "document_date",  // ClinicalEventKind
});

// ── ReferenceEntity — the identity handle (no clinical content) ────────────────
/** Mirrors the minimal {clinicianId, at} shape of types/observation.ts Provenance. */
export type CaptureProvenance = { readonly clinicianId: string; readonly at: string };

export type ReferenceEntity = {
  readonly id: ReferenceEntityId;
  readonly kind: KindUnion;
  readonly label: string;
  readonly provenance: CaptureProvenance;
};

// ── Resolution record — the ONLY cross-layer link (mirrors participant_resolution.rs) ──
export type ResolutionStatus = "unresolved" | "confirmed" | "superseded";
export type ResolutionRecord = {
  readonly refId: ReferenceEntityId;
  readonly eventId: ClinicalEventIdRef;   // backend ClinicalEvent.event_id (opaque)
  readonly resolvedBy: string;
  readonly at: string;
  readonly status: ResolutionStatus;
};

export type AttachTarget = { readonly kind: "claim" | "finding"; readonly id: string };

// ── Append-only operation log (SHADOW: in-memory only) ─────────────────────────
export type RefOp =
  | { readonly op: "CreateReference"; readonly ref: ReferenceEntity }
  | { readonly op: "ResolveReference"; readonly refId: ReferenceEntityId; readonly eventId: ClinicalEventIdRef; readonly resolvedBy: string; readonly at: string }
  | { readonly op: "MergeReferences"; readonly survivorId: ReferenceEntityId; readonly mergedIds: readonly ReferenceEntityId[]; readonly by: string; readonly at: string }
  | { readonly op: "SplitReference"; readonly sourceId: ReferenceEntityId; readonly created: readonly ReferenceEntity[]; readonly by: string; readonly at: string }
  | { readonly op: "AttachReference"; readonly refId: ReferenceEntityId; readonly target: AttachTarget; readonly by: string; readonly at: string };

export type RefEvent = { readonly seq: number; readonly recordedAt: string; readonly op: RefOp };
export type ReferenceLog = readonly RefEvent[];

/** This module is shadow-only and must never feed reasoning. */
export const SHADOW_MODE = true as const;

let __counter = 0;
/** Capture-layer mint. NEVER derived from a backend event_id (separate id spaces). */
export function newReferenceEntityId(): ReferenceEntityId {
  const rand = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID() : `${Date.now()}-${++__counter}`;
  return (`ref:${rand}`) as ReferenceEntityId;
}

// Defensive: blocks truth-layer creep. Rejects any key beyond the allowed set —
// loudly, so misuse (e.g. a stray `severity`/`date`) fails fast rather than being
// silently dropped.
function assertOnlyKeys(obj: object, allowed: readonly string[], ctx: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) {
    throw new Error(`${ctx} must carry no clinical content; offending keys: ${extra.join(", ")}`);
  }
}

function append(log: ReferenceLog, op: RefOp): ReferenceLog {
  const event: RefEvent = Object.freeze({ seq: log.length, recordedAt: new Date().toISOString(), op });
  return Object.freeze([...log, event]);
}

// ── Operations — pure, append-only (return a NEW log; never mutate) ────────────
export function createReference(
  log: ReferenceLog,
  input: { kind: KindUnion; label: string; provenance: CaptureProvenance; id?: ReferenceEntityId },
): { log: ReferenceLog; id: ReferenceEntityId } {
  assertOnlyKeys(input, ["id", "kind", "label", "provenance"], "ReferenceEntity input");
  const id = input.id ?? newReferenceEntityId();
  const ref: ReferenceEntity = Object.freeze({ id, kind: input.kind, label: input.label, provenance: input.provenance });
  return { log: append(log, { op: "CreateReference", ref }), id };
}

export function resolveReference(
  log: ReferenceLog,
  input: { refId: ReferenceEntityId; eventId: ClinicalEventIdRef; resolvedBy: string; at: string },
): ReferenceLog {
  return append(log, { op: "ResolveReference", ...input });
}

export function mergeReferences(
  log: ReferenceLog,
  input: { survivorId: ReferenceEntityId; mergedIds: readonly ReferenceEntityId[]; by: string; at: string },
): ReferenceLog {
  return append(log, { op: "MergeReferences", ...input });
}

export function splitReference(
  log: ReferenceLog,
  input: { sourceId: ReferenceEntityId; created: ReadonlyArray<{ kind: KindUnion; label: string; provenance: CaptureProvenance }>; by: string; at: string },
): { log: ReferenceLog; ids: ReferenceEntityId[] } {
  const created = input.created.map((c) => {
    assertOnlyKeys(c, ["kind", "label", "provenance"], "ReferenceEntity input");
    return Object.freeze({ id: newReferenceEntityId(), kind: c.kind, label: c.label, provenance: c.provenance });
  });
  const log2 = append(log, { op: "SplitReference", sourceId: input.sourceId, created, by: input.by, at: input.at });
  return { log: log2, ids: created.map((r) => r.id) };
}

export function attachReference(
  log: ReferenceLog,
  input: { refId: ReferenceEntityId; target: AttachTarget; by: string; at: string },
): ReferenceLog {
  return append(log, { op: "AttachReference", ...input });
}

// ── Projection — derive current identity graph from the append-only log ────────
export type ReferenceView = {
  readonly ref: ReferenceEntity;
  readonly mergedInto?: ReferenceEntityId;
  readonly attachments: readonly AttachTarget[];
  readonly resolution?: ResolutionRecord;          // current (latest) resolution, if any
  readonly resolutionHistory: readonly ResolutionRecord[]; // all, superseded retained
  readonly resolutionConflict: boolean;            // merge surfaced conflicting resolutions (NOT adjudicated)
};
export type ReferenceProjection = { readonly entities: ReadonlyMap<ReferenceEntityId, ReferenceView> };

export function project(log: ReferenceLog): ReferenceProjection {
  type Mut = {
    ref: ReferenceEntity; mergedInto?: ReferenceEntityId; attachments: AttachTarget[];
    resolutions: ResolutionRecord[]; resolutionConflict: boolean;
  };
  const m = new Map<ReferenceEntityId, Mut>();

  for (const e of log) {
    const op = e.op;
    if (op.op === "CreateReference") {
      if (!m.has(op.ref.id)) m.set(op.ref.id, { ref: op.ref, attachments: [], resolutions: [], resolutionConflict: false });
    } else if (op.op === "SplitReference") {
      for (const r of op.created) if (!m.has(r.id)) m.set(r.id, { ref: r, attachments: [], resolutions: [], resolutionConflict: false });
      // source is RETAINED (append-only); membership/lineage stays derivable from the log.
    } else if (op.op === "ResolveReference") {
      const cur = m.get(op.refId); if (!cur) continue;
      // prior resolutions become "superseded"; latest is "confirmed". Nothing deleted.
      cur.resolutions = cur.resolutions.map((r) => ({ ...r, status: "superseded" as const }));
      cur.resolutions.push({ refId: op.refId, eventId: op.eventId, resolvedBy: op.resolvedBy, at: op.at, status: "confirmed" });
    } else if (op.op === "MergeReferences") {
      const survivor = m.get(op.survivorId); if (!survivor) continue;
      for (const mid of op.mergedIds) {
        const merged = m.get(mid); if (!merged) continue;
        merged.mergedInto = op.survivorId;                       // both retained
        survivor.attachments.push(...merged.attachments);
        // conflicting resolutions are FLAGGED, never adjudicated here (defer to the
        // existing backend contradiction system — no reasoning in the capture layer).
        const survEvent = survivor.resolutions.find((r) => r.status === "confirmed")?.eventId;
        const mergEvent = merged.resolutions.find((r) => r.status === "confirmed")?.eventId;
        if (survEvent && mergEvent && survEvent !== mergEvent) survivor.resolutionConflict = true;
      }
    } else if (op.op === "AttachReference") {
      const cur = m.get(op.refId); if (!cur) continue;
      cur.attachments.push(op.target);
    }
  }

  const out = new Map<ReferenceEntityId, ReferenceView>();
  for (const [id, v] of m) {
    out.set(id, Object.freeze({
      ref: v.ref, mergedInto: v.mergedInto, attachments: Object.freeze([...v.attachments]),
      resolution: v.resolutions.find((r) => r.status === "confirmed"),
      resolutionHistory: Object.freeze([...v.resolutions]), resolutionConflict: v.resolutionConflict,
    }));
  }
  return { entities: out };
}
