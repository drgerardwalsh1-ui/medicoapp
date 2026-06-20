// ── Phase 11 — Canonical report serialization (pure, deterministic) ────────────
// Maps a ClinicalReport (Phase 10) into a versioned, transport-ready export
// object plus a deterministic canonical string for hashing/verification.
//
// Strict boundary:
//   - imports only the ClinicalReport TYPE from Phase 10 (no engine, no bridge,
//     no semantics, no constraints, no temporal-module references)
//   - no inference, no recomputation, no summarisation, no defaults filled
//   - no mutation; structural mapping only
//   - the ONLY re-sort permitted is lexicographic ordering of differential
//     members (per spec rule 4)

import type { ClinicalReport } from "./clinicalReport";

// ── Export type ────────────────────────────────────────────────────────────────
export type ClinicalReportExportV1 = {
  readonly version: "1.0.0";
  readonly meta: { readonly snapshotHash: string; readonly generatedAt: string };
  readonly observations: readonly string[];
  readonly diagnoses: readonly DiagnosticExportEntry[];
  readonly differentials: readonly DifferentialExportEntry[];
  readonly temporal: readonly TemporalExportEntry[];
  readonly clinicianDecisions?: readonly ClinicianDecisionExportEntry[];
  // `replayHash` is optional and volatile: present only on snapshots that
  // were replayed (never invented on a fresh export), and treated as a
  // volatile path by the report diff. Mirrors AuditSection.replayHash.
  readonly audit: {
    readonly snapshotHash: string;
    readonly replayHash?: string;
    readonly generatedAt: string;
  };
};

export type DiagnosticExportEntry = {
  readonly id: string;
  readonly semanticState: string;
  readonly candidacyState: string;
  readonly temporalQualification?: string;
  readonly rationale?: string;
};

export type DifferentialExportEntry = {
  readonly groupId: string;
  readonly members: readonly string[]; // sorted lexicographically (only permitted re-sort)
  readonly resolved: false;
};

export type TemporalExportEntry = {
  readonly diagnosisId: string;
  readonly diagnosisName: string;
  readonly temporalState: string;
  readonly reason: string;
};

export type ClinicianDecisionExportEntry = {
  readonly diagnosisId: string;
  readonly diagnosisName: string;
  readonly conclusion: string;
  readonly overrideFromSystem: boolean;
  readonly rationale?: string;
};

// ── Canonical deterministic serializer (Phase 11 hardening) ────────────────────
// The ONLY source of string output for this layer. Cross-runtime stable:
//   - primitives use JSON.stringify (deterministic per ECMAScript spec)
//   - arrays preserve order, elements serialised recursively
//   - object keys sorted lexicographically at every level (no engine key-order
//     reliance)
//   - undefined fields are OMITTED (never stringified, never coerced to null)
// Used by stableClinicalReportString AND by per-observation serialisation —
// nothing in this module bypasses it.
export function canonicalStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") + "}";
  }
  return "null";
}

// ── serialize ──────────────────────────────────────────────────────────────────
export function serializeClinicalReport(report: ClinicalReport): ClinicalReportExportV1 {
  // 2. Observations — one canonical JSON string per observation (lossless,
  //    stable, parseable). Original Phase-10 chronological order preserved.
  const observations: string[] = report.observationsSection.observations.map((o) =>
    canonicalStringify({
      symptomId: o.symptomId,
      symptomName: o.symptomName,
      presence: o.presence,
      severity: o.severity,
      onsetDate: o.onsetDate,
      duration: o.duration,
      notes: o.notes,
    }),
  );

  // 3. Diagnostic section — only the fields listed in spec §3 (no name, no
  //    clinicianConclusion here — those live in their own sections).
  const diagnoses: DiagnosticExportEntry[] = report.diagnosticSummarySection.diagnoses.map(
    (d) => ({
      id: d.diagnosisId,
      semanticState: d.semanticState,
      candidacyState: d.candidacyState,
      temporalQualification: d.temporalQualification,
      rationale: d.rationale,
    }),
  );

  // 4. Differentials — members sorted lexicographically; resolved ALWAYS false.
  const differentials: DifferentialExportEntry[] = report.differentialSection.groups.map(
    (g) => ({
      groupId: g.groupId,
      members: [...g.diagnoses].sort(),
      resolved: false as const,
    }),
  );

  // 5. Temporal — verbatim, original order; no reason inference.
  const temporal: TemporalExportEntry[] = report.temporalSection.qualifications.map((q) => ({
    diagnosisId: q.diagnosisId,
    diagnosisName: q.diagnosisName,
    temporalState: q.temporalState,
    reason: q.reason,
  }));

  // 6. Clinician decisions — verbatim; missing stays undefined (no defaults).
  const conclusions = report.clinicianDecisionSection.conclusions;
  const clinicianDecisions: ClinicianDecisionExportEntry[] | undefined =
    conclusions.length === 0
      ? undefined
      : conclusions.map((c) => ({
          diagnosisId: c.diagnosisId,
          diagnosisName: c.diagnosisName,
          conclusion: c.conclusion,
          overrideFromSystem: c.overrideFromSystem,
          rationale: c.rationale,
        }));

  return {
    version: "1.0.0",
    meta: { snapshotHash: report.meta.snapshotHash, generatedAt: report.meta.generatedAt },
    observations,
    diagnoses,
    differentials,
    temporal,
    clinicianDecisions,
    audit: {
      snapshotHash: report.auditSection.snapshotHash,
      replayHash: report.auditSection.replayHash,
      generatedAt: report.auditSection.generatedAt,
    },
  };
}

// ── stable string (for hashing / transport / reproducibility) ──────────────────
export function stableClinicalReportString(exp: ClinicalReportExportV1): string {
  return canonicalStringify(exp);
}
