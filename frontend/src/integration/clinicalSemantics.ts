// ── Phase 6 — Clinical State Semantics layer (pure, non-invasive) ──────────────
// Assigns each diagnosis a semantic state derived ONLY from existing signals:
//   - candidacy output (engine)         — never recomputed here
//   - constraint output (Phase 5)       — never re-evaluated here
//   - differential / conflict relationships
// It introduces NO scoring, NO thresholds, NO eligibility logic. It maps the
// categorical signals that already exist into clinical-meaning states, and it
// PRESERVES ambiguity: competing differentials are kept side by side, never
// collapsed to a single winner.

import type { CriterionSuggestion, DiagnosisCandidacy } from "../engine/recompute";
import type { ConstraintDecision } from "./clinicalConstraints";
import type { DiagnosisSummary } from "./clinicalBridge";

export type SemanticState =
  | "excluded" // constraint hard-gate / residual suppression (ineligible)
  | "rule_out" // constraint exclusivity / cause suppression (held pending differential)
  | "subthreshold" // eligible, partial evidence, below contributing
  | "unlikely" // below threshold but with faint supporting evidence
  | "possible" // contributing tier
  | "probable" // coverage at/over threshold but engine candidacy only approaching
  | "likely" // engine candidacy threshold met, no active competing differential
  | "differential_primary"; // ≥2 strong members of a differential — ambiguity preserved

export type DiagnosisInterpretation = {
  readonly diagnosisId: string;
  readonly name: string;
  readonly state: SemanticState;
  readonly differentialGroup?: string;
  readonly differentialBasis?: string;
  readonly reason?: string; // for excluded / rule_out
};

// ── Explicit differential relationships ────────────────────────────────────────
type DifferentialGroup = {
  readonly id: string;
  readonly members: readonly string[];
  readonly basis: string;
  // coElevation groups annotate when ≥2 members are surfaced together.
  // Aetiological groups (false) only annotate rule_out members in pass 1.
  readonly coElevation: boolean;
};

const DIFFERENTIAL_GROUPS: readonly DifferentialGroup[] = [
  { id: "trauma_acuity", members: ["ptsd", "asd"], basis: "symptom duration — PTSD (>1 month) vs ASD (≤1 month)", coElevation: true },
  { id: "mood_polarity", members: ["mdd", "pdd", "bd1", "bd2"], basis: "mood polarity / chronicity — unipolar vs bipolar vs persistent", coElevation: true },
  { id: "somatic_focus", members: ["ssd", "iad"], basis: "somatic symptom burden vs illness preoccupation", coElevation: true },
  { id: "substance_vs_primary", members: ["mdd", "pdd", "gad", "sad", "pan", "agor"], basis: "aetiology — substance-induced vs primary disorder", coElevation: false },
];

const STRONG: ReadonlySet<SemanticState> = new Set(["likely", "probable"]);
const SURFACED: ReadonlySet<SemanticState> = new Set([
  "likely",
  "probable",
  "possible",
  "subthreshold",
  "unlikely",
]);

function groupBasisFor(reason: string): { id: string; basis: string } | undefined {
  if (/bipolar/i.test(reason)) {
    const g = DIFFERENTIAL_GROUPS.find((x) => x.id === "mood_polarity")!;
    return { id: g.id, basis: g.basis };
  }
  if (/substance/i.test(reason)) {
    const g = DIFFERENTIAL_GROUPS.find((x) => x.id === "substance_vs_primary")!;
    return { id: g.id, basis: g.basis };
  }
  return undefined;
}

export type SemanticsInput = {
  readonly candidacies: readonly DiagnosisCandidacy[];
  readonly suggestions: readonly CriterionSuggestion[];
  readonly decisions: readonly ConstraintDecision[];
  readonly summaries: readonly DiagnosisSummary[];
  readonly diagnosisNames: Readonly<Record<string, string>>;
};

export function interpretSemanticStates(
  input: SemanticsInput,
): readonly DiagnosisInterpretation[] {
  const { candidacies, suggestions, decisions, summaries, diagnosisNames } = input;

  const decisionById = new Map(decisions.map((d) => [d.diagnosisId, d]));
  const summaryById = new Map(summaries.map((s) => [s.diagnosisId, s]));
  const supportingById = new Map<string, number>();
  for (const s of suggestions) {
    supportingById.set(
      s.diagnosisId,
      (supportingById.get(s.diagnosisId) ?? 0) + s.supporting.length,
    );
  }

  const name = (id: string) => diagnosisNames[id] ?? id;

  // ── Pass 1 — base state per surfaced diagnosis ───────────────────────────────
  const result: DiagnosisInterpretation[] = [];
  for (const c of candidacies) {
    const id = c.diagnosisId;
    const decision = decisionById.get(id);

    if (decision?.suppressed) {
      const reason = decision.reason ?? "";
      const ruleOut = /rule out/i.test(reason);
      const gb = ruleOut ? groupBasisFor(reason) : undefined;
      result.push({
        diagnosisId: id,
        name: name(id),
        state: ruleOut ? "rule_out" : "excluded",
        reason,
        differentialGroup: gb?.id,
        differentialBasis: gb?.basis,
      });
      continue;
    }

    const summary = summaryById.get(id);
    if (summary) {
      let state: SemanticState;
      if (c.state === "threshold_likely_met") state = "likely";
      else if (summary.tier === "likely") state = "probable";
      else if (summary.tier === "contributing") state = "possible";
      else state = "subthreshold";
      result.push({ diagnosisId: id, name: name(id), state });
      continue;
    }

    // Below threshold but eligible with faint supporting evidence → unlikely.
    if (c.state === "below_threshold" && (supportingById.get(id) ?? 0) > 0) {
      result.push({ diagnosisId: id, name: name(id), state: "unlikely" });
    }
  }

  // ── Pass 2 — differential relationships (preserve ambiguity) ─────────────────
  const stateById = new Map(result.map((r) => [r.diagnosisId, r]));
  for (const group of DIFFERENTIAL_GROUPS) {
    if (!group.coElevation) continue; // aetiological groups handled in pass 1
    const surfaced = group.members
      .map((m) => stateById.get(m))
      .filter((r): r is DiagnosisInterpretation => !!r && SURFACED.has(r.state));
    if (surfaced.length < 2) continue;

    const strong = surfaced.filter((r) => STRONG.has(r.state));
    for (const r of surfaced) {
      const idx = result.findIndex((x) => x.diagnosisId === r.diagnosisId);
      if (idx === -1) continue;
      // ≥2 strong contenders → mark each differential_primary (never collapse).
      const elevate = strong.length >= 2 && STRONG.has(r.state);
      result[idx] = {
        ...result[idx],
        state: elevate ? "differential_primary" : result[idx].state,
        differentialGroup: result[idx].differentialGroup ?? group.id,
        differentialBasis: result[idx].differentialBasis ?? group.basis,
      };
    }
  }

  // Stable display order by clinical weight.
  const ORDER: SemanticState[] = [
    "differential_primary",
    "likely",
    "probable",
    "possible",
    "subthreshold",
    "unlikely",
    "rule_out",
    "excluded",
  ];
  return [...result].sort(
    (a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state),
  );
}
