// ── Layer 1 — WRITABLE (interview surface) ─────────────────────────────────────
// The ONLY write API exposed during the clinical interview. A clinician may
// select a symptom and set severity/frequency/duration/note. Nothing else here
// is reachable: no criteria, episodes, evidence, or attribution.

import type { ObservationId, SymptomTypeId, Frame } from "./ontology";

// ── Provenance — auto-stamped on every clinician write ─────────────────────────
// Traceability is harvested passively; the clinician is never asked to justify
// an entry. (Override reasons live on the review surface, not here.)
export type EntrySource =
  | "chip"
  | "toggle"
  | "severity"
  | "freq"
  | "duration"
  | "note"
  | "review_action";

export type Provenance = {
  readonly clinicianId: string;
  readonly at: string; // ISO, canonical UTC
  readonly entrySource: EntrySource;
};

// ── Presence — tri-state. "unknown" ≠ "absent". ───────────────────────────────
// "unknown" must propagate forward and reduce confidence; it is NEVER treated
// as absence by inference.
export type Presence = "present" | "absent" | "unknown";

export type SymptomSeverity = "" | "mild" | "moderate" | "severe";

// ── Observation — one clinical instance of a SymptomType, in one frame ─────────
export type Observation = {
  readonly id: ObservationId;
  readonly symptomTypeId: SymptomTypeId;
  readonly frame: Frame;
  presence: Presence;
  severity?: SymptomSeverity;
  frequencyCount?: string;
  frequencyUnit?: string;
  durationCount?: string;
  durationUnit?: string;
  onset?: string; // optional; powers temporal co-occurrence tests
  note?: string; // the only free text requested at interview
  tombstoned?: boolean; // deleted-but-retained for audit; excluded from recompute
  readonly provenance: Provenance;
};
