// ── Phase 12 — Cryptographic Clinical Audit (hardened, minimal) ────────────────
// Tamper-evident binding for ClinicalReportExportV1. Single HMAC-SHA256 token
// is BOTH the cryptographic digest AND the authentication token — there is no
// separate signing layer. Pure, deterministic, single-algorithm, schema-strict.
//
// Allowed imports only: node:crypto, the export type, and stableClinicalReportString.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClinicalReportExportV1 } from "./clinicalReportSerializer";
import { stableClinicalReportString } from "./clinicalReportSerializer";

// ── Configuration — secret injected via env, never hardcoded in logic ─────────
function resolveSecret(): string {
  try {
    if (typeof process !== "undefined" && process.env?.AUDIT_SECRET_KEY) {
      return process.env.AUDIT_SECRET_KEY;
    }
  } catch {
    /* fall through */
  }
  // Development fallback — replaced via env in production builds / audit tools.
  return "v1-default-development-key";
}

const AUDIT_SECRET_KEY: string = resolveSecret();
const KEY_ID = "v1-default" as const;
const ALGORITHM = "HMAC-SHA256" as const;

// ── Envelope (minimal — reportHash is digest + authentication token) ───────────
export type AuditEnvelopeV1 = {
  readonly reportHash: string;
  readonly algorithm: "HMAC-SHA256";
  readonly keyId: string;
  readonly createdAt: string;
};

// Strict schema — verify rejects any envelope carrying extra/legacy keys
// (e.g. a `signature` field from older snapshots). Forward-immutable.
const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "reportHash",
  "algorithm",
  "keyId",
  "createdAt",
]);

function isStrictlyValidEnvelope(env: unknown): env is AuditEnvelopeV1 {
  if (!env || typeof env !== "object" || Array.isArray(env)) return false;
  const e = env as Record<string, unknown>;
  for (const k of Object.keys(e)) if (!ENVELOPE_KEYS.has(k)) return false;
  if (typeof e.reportHash !== "string") return false;
  if (e.algorithm !== ALGORITHM) return false;
  if (typeof e.keyId !== "string") return false;
  if (typeof e.createdAt !== "string") return false;
  return true;
}

function hmacHex(input: string): string {
  return createHmac("sha256", AUDIT_SECRET_KEY).update(input, "utf8").digest("hex");
}

// ── generate — deterministic over the export bytes; createdAt is the only
//    runtime field and is NOT part of the hash input ─────────────────────────
export function generateAuditEnvelope(report: ClinicalReportExportV1): AuditEnvelopeV1 {
  return {
    reportHash: hmacHex(stableClinicalReportString(report)),
    algorithm: ALGORITHM,
    keyId: KEY_ID,
    createdAt: new Date().toISOString(),
  };
}

// ── verify — strict schema + timing-safe comparison against reportHash only ───
export function verifyAuditEnvelope(
  report: ClinicalReportExportV1,
  envelope: AuditEnvelopeV1,
): boolean {
  if (!isStrictlyValidEnvelope(envelope)) return false;
  const recomputed = hmacHex(stableClinicalReportString(report));
  if (recomputed.length !== envelope.reportHash.length) return false;
  const a = Buffer.from(recomputed, "hex");
  const b = Buffer.from(envelope.reportHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { KEY_ID as AUDIT_KEY_ID, ALGORITHM as AUDIT_ALGORITHM };
