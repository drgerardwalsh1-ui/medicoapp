// ── Inference-kernel extension — OverlayDelta (PURE STRUCTURAL DIFF) ────────────
//
// computeClinicalOverlayDelta(overlayA, overlayB) compares two ClinicalOverlay
// outputs and returns the structural difference between them. It sits AFTER
// runClinicalOverlay and BEFORE presentation.
//
// HARD CONSTRAINTS (enforced by construction):
//   • PURE — no mutation, no I/O, deterministic (outputs are key-sorted).
//   • DERIVED — introduces NO clinical ontology, NO diagnosis logic, NO inference.
//   • COMPOSITIONAL — reads ONLY fields already present on ClinicalOverlay.
//   • STRUCTURAL ONLY — every value emitted is either a verbatim echo of an
//     existing overlay value or a from/to pair of such values. No causation, no
//     attribution, no impairment, no interpretation, no meaning is assigned to a
//     difference. A "change" means "value X became value Y", nothing more.
//
// It imports exactly one type (ClinicalOverlay) and resolves every member shape
// by indexed access, so it cannot couple to engine internals, ingestion, UI,
// audit/replay, provenance, or epoch/crossSectionProjections.
//
// ── SNAPSHOT / EVENT AXIS INVARIANT (locked) ───────────────────────────────────
// This operator works ONLY on the SNAPSHOT axis. Two orthogonal axes exist:
//
//   EVENT axis  (source of truth, NOT seen here): E1, E2, E3… = injury events,
//     symptom observations, history inputs — many entries living inside one
//     DSMAssessmentData / the append-only event log. This module never touches it.
//
//   SNAPSHOT axis (derived, the ONLY thing here): T1, T2, T3… = successive FULL
//     recomputed ClinicalOverlay states. A ClinicalOverlay is a pure function of
//     DSMAssessmentData at event-sourced state N — NOT of a single injury, time
//     period, or episode.
//
// Consequences enforced by construction:
//   • Tn is a system-state index, NEVER an "injury n". There is NO 1:1 mapping
//     between injury events and snapshot index, and this code assumes none —
//     it keys purely on diagnosisId / criterionId / conflict id / episode id.
//   • Multiple injuries are INTRA-snapshot structure: they are interpreted within
//     a single overlay by evaluateTemporalGovernance / deriveEpisodes / overlay
//     construction. They are NOT inter-snapshot indexing. This operator does not
//     and must not reconstruct per-injury views from the snapshot pair.
//   • OverlayDelta is defined solely as OverlayDelta(T1, T2) over two full
//     ClinicalOverlay snapshots. Event-level objects are not accepted (they do
//     not satisfy the ClinicalOverlay type), so no event-level delta can occur.

import type { ClinicalOverlay } from "./clinicalBridge";

// ── Member shapes (indexed access — no extra imports) ──────────────────────────
type Candidacy = ClinicalOverlay["candidacies"][number];
type Suggestion = ClinicalOverlay["suggestions"][number];
type Conflict = ClinicalOverlay["conflicts"][number];
type Episode = ClinicalOverlay["episodes"][number];
type Summary = ClinicalOverlay["summaries"][number];
type Interpretation = ClinicalOverlay["states"][number];
type Temporal = ClinicalOverlay["temporalQualifications"][number];

type CandidacyState = Candidacy["state"];
type SemanticState = Interpretation["state"];
type SuggestionState = Suggestion["state"];
type EpisodeStatus = Episode["status"];
type TemporalStatus = Temporal["status"];

// ── Output shape ───────────────────────────────────────────────────────────────
export type Transition<T> = { readonly from: T | null; readonly to: T | null };

export type AddedDiagnosis = {
  readonly diagnosisId: string;
  readonly name: string;
  readonly candidacyState: CandidacyState;
  readonly semanticState: SemanticState | null;
};

export type RemovedDiagnosis = AddedDiagnosis;

export type ChangedDiagnosis = {
  readonly diagnosisId: string;
  readonly name: string;
  // present only when that facet actually moved.
  readonly candidacyState?: Transition<CandidacyState>;
  readonly semanticState?: Transition<SemanticState>;
};

export type CoverageChange = {
  readonly diagnosisId: string;
  readonly name: string;
  readonly coverage: Transition<number>;
  readonly metCriteria: Transition<number>;
  readonly totalCriteria: Transition<number>;
};

export type CriterionCoverageTransition = {
  readonly diagnosisId: string;
  readonly criterionId: string;
  readonly state: Transition<SuggestionState>;
};

export type TemporalTransition = {
  readonly diagnosisId: string;
  readonly status: Transition<TemporalStatus>;
};

export type EpisodeTransition = {
  readonly episodeId: string;
  readonly diagnosisId: string;
  readonly kind: "emerged" | "terminated" | "status_changed";
  readonly status: Transition<EpisodeStatus>;
};

export type ConflictStatusChange = {
  readonly id: string;
  readonly observationId: string;
  readonly status: Transition<Conflict["status"]>;
};

export type RankingMovement = {
  readonly diagnosisId: string;
  readonly name: string;
  // rank = ordinal position in `summaries` (already sorted by coverage desc).
  readonly fromRank: number | null;
  readonly toRank: number | null;
  // positive = moved up the list (toward rank 0); null when entering/leaving.
  readonly delta: number | null;
};

export type OverlayDelta = {
  readonly added: readonly AddedDiagnosis[];
  readonly removed: readonly RemovedDiagnosis[];
  readonly changed: readonly ChangedDiagnosis[];
  readonly stable: readonly string[];
  readonly temporalTransitions: readonly TemporalTransition[];
  readonly episodeTransitions: readonly EpisodeTransition[];
  readonly coverageDelta: {
    readonly byDiagnosis: readonly CoverageChange[];
    readonly byCriterion: readonly CriterionCoverageTransition[];
  };
  readonly conflictDelta: {
    readonly new: readonly Conflict[];
    readonly resolved: readonly Conflict[];
    readonly statusChanged: readonly ConflictStatusChange[];
  };
  readonly rankingDelta: readonly RankingMovement[];
};

// ── Helpers (pure) ─────────────────────────────────────────────────────────────
function indexBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(key(it), it);
  return m;
}

function unionKeys(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])].sort();
}

function byDiagnosisId<T extends { diagnosisId: string }>(arr: T[]): T[] {
  return [...arr].sort((x, y) => x.diagnosisId.localeCompare(y.diagnosisId));
}

// ── The operator ───────────────────────────────────────────────────────────────
// overlayA = snapshot Tᵢ, overlayB = snapshot Tⱼ (full recomputed ClinicalOverlay
// states; each may already contain multiple injury events internally). These are
// SNAPSHOT-axis indices, not injury indices — see the axis invariant above.
export function computeClinicalOverlayDelta(
  overlayA: ClinicalOverlay,
  overlayB: ClinicalOverlay,
): OverlayDelta {
  // Merged display-name lookup (structural; both overlays already carry it).
  const names: Record<string, string> = { ...overlayA.diagnosisNames, ...overlayB.diagnosisNames };
  const nameOf = (id: string) => names[id] ?? id;

  // Index every overlay facet by its natural key.
  const candA = indexBy(overlayA.candidacies, (c) => c.diagnosisId);
  const candB = indexBy(overlayB.candidacies, (c) => c.diagnosisId);
  const semA = indexBy(overlayA.states, (s) => s.diagnosisId);
  const semB = indexBy(overlayB.states, (s) => s.diagnosisId);
  const sugA = indexBy(overlayA.suggestions, (s) => `${s.diagnosisId} ${s.criterionId}`);
  const sugB = indexBy(overlayB.suggestions, (s) => `${s.diagnosisId} ${s.criterionId}`);
  const sumA = indexBy(overlayA.summaries, (s) => s.diagnosisId);
  const sumB = indexBy(overlayB.summaries, (s) => s.diagnosisId);
  const tmpA = indexBy(overlayA.temporalQualifications, (t) => t.diagnosisId);
  const tmpB = indexBy(overlayB.temporalQualifications, (t) => t.diagnosisId);
  const epiA = indexBy(overlayA.episodes, (e) => e.id);
  const epiB = indexBy(overlayB.episodes, (e) => e.id);
  const cfA = indexBy(overlayA.conflicts, (c) => c.id);
  const cfB = indexBy(overlayB.conflicts, (c) => c.id);

  // ── Diagnosis presence/state (added / removed / changed / stable) ─────────────
  const added: AddedDiagnosis[] = [];
  const removed: RemovedDiagnosis[] = [];
  const changed: ChangedDiagnosis[] = [];
  const stable: string[] = [];

  for (const id of unionKeys(candA, candB)) {
    const a = candA.get(id);
    const b = candB.get(id);
    const semStateA = semA.get(id)?.state ?? null;
    const semStateB = semB.get(id)?.state ?? null;

    if (!a && b) {
      added.push({ diagnosisId: id, name: nameOf(id), candidacyState: b.state, semanticState: semStateB });
      continue;
    }
    if (a && !b) {
      removed.push({ diagnosisId: id, name: nameOf(id), candidacyState: a.state, semanticState: semStateA });
      continue;
    }
    if (a && b) {
      const candacyMoved = a.state !== b.state;
      const semMoved = semStateA !== semStateB;
      if (!candacyMoved && !semMoved) {
        stable.push(id);
      } else {
        changed.push({
          diagnosisId: id,
          name: nameOf(id),
          ...(candacyMoved ? { candidacyState: { from: a.state, to: b.state } } : {}),
          ...(semMoved ? { semanticState: { from: semStateA, to: semStateB } } : {}),
        });
      }
    }
  }

  // ── Coverage delta (summary-level numbers + criterion-level state) ────────────
  const coverageByDiagnosis: CoverageChange[] = [];
  for (const id of unionKeys(sumA, sumB)) {
    const a: Summary | undefined = sumA.get(id);
    const b: Summary | undefined = sumB.get(id);
    const covMoved = (a?.coverage ?? null) !== (b?.coverage ?? null);
    const metMoved = (a?.metCriteria ?? null) !== (b?.metCriteria ?? null);
    const totMoved = (a?.totalCriteria ?? null) !== (b?.totalCriteria ?? null);
    if (covMoved || metMoved || totMoved) {
      coverageByDiagnosis.push({
        diagnosisId: id,
        name: nameOf(id),
        coverage: { from: a?.coverage ?? null, to: b?.coverage ?? null },
        metCriteria: { from: a?.metCriteria ?? null, to: b?.metCriteria ?? null },
        totalCriteria: { from: a?.totalCriteria ?? null, to: b?.totalCriteria ?? null },
      });
    }
  }

  const coverageByCriterion: CriterionCoverageTransition[] = [];
  for (const key of unionKeys(sugA, sugB)) {
    const a = sugA.get(key);
    const b = sugB.get(key);
    const stateA = a?.state ?? null;
    const stateB = b?.state ?? null;
    if (stateA !== stateB) {
      const [diagnosisId, criterionId] = key.split(" ");
      coverageByCriterion.push({ diagnosisId, criterionId, state: { from: stateA, to: stateB } });
    }
  }
  coverageByCriterion.sort(
    (x, y) =>
      x.diagnosisId.localeCompare(y.diagnosisId) || x.criterionId.localeCompare(y.criterionId),
  );

  // ── Temporal transitions ──────────────────────────────────────────────────────
  const temporalTransitions: TemporalTransition[] = [];
  for (const id of unionKeys(tmpA, tmpB)) {
    const statusA = tmpA.get(id)?.status ?? null;
    const statusB = tmpB.get(id)?.status ?? null;
    if (statusA !== statusB) {
      temporalTransitions.push({ diagnosisId: id, status: { from: statusA, to: statusB } });
    }
  }

  // ── Episode transitions ───────────────────────────────────────────────────────
  const episodeTransitions: EpisodeTransition[] = [];
  for (const id of unionKeys(epiA, epiB)) {
    const a: Episode | undefined = epiA.get(id);
    const b: Episode | undefined = epiB.get(id);
    if (!a && b) {
      episodeTransitions.push({ episodeId: id, diagnosisId: b.diagnosisId, kind: "emerged", status: { from: null, to: b.status } });
    } else if (a && !b) {
      episodeTransitions.push({ episodeId: id, diagnosisId: a.diagnosisId, kind: "terminated", status: { from: a.status, to: null } });
    } else if (a && b && a.status !== b.status) {
      episodeTransitions.push({ episodeId: id, diagnosisId: b.diagnosisId, kind: "status_changed", status: { from: a.status, to: b.status } });
    }
  }
  episodeTransitions.sort((x, y) => x.episodeId.localeCompare(y.episodeId));

  // ── Conflict delta ────────────────────────────────────────────────────────────
  const conflictNew: Conflict[] = [];
  const conflictResolved: Conflict[] = [];
  const conflictStatusChanged: ConflictStatusChange[] = [];
  for (const id of unionKeys(cfA, cfB)) {
    const a = cfA.get(id);
    const b = cfB.get(id);
    if (!a && b) conflictNew.push(b);
    else if (a && !b) conflictResolved.push(a);
    else if (a && b && a.status !== b.status) {
      conflictStatusChanged.push({ id, observationId: b.observationId, status: { from: a.status, to: b.status } });
    }
  }
  conflictNew.sort((x, y) => x.id.localeCompare(y.id));
  conflictResolved.sort((x, y) => x.id.localeCompare(y.id));
  conflictStatusChanged.sort((x, y) => x.id.localeCompare(y.id));

  // ── Ranking delta (ordinal position in `summaries`; coverage-desc order) ───────
  const rankA = new Map<string, number>();
  overlayA.summaries.forEach((s, i) => rankA.set(s.diagnosisId, i));
  const rankB = new Map<string, number>();
  overlayB.summaries.forEach((s, i) => rankB.set(s.diagnosisId, i));

  const rankingDelta: RankingMovement[] = [];
  for (const id of unionKeys(rankA, rankB)) {
    const fromRank = rankA.has(id) ? rankA.get(id)! : null;
    const toRank = rankB.has(id) ? rankB.get(id)! : null;
    if (fromRank !== toRank) {
      rankingDelta.push({
        diagnosisId: id,
        name: nameOf(id),
        fromRank,
        toRank,
        delta: fromRank !== null && toRank !== null ? fromRank - toRank : null,
      });
    }
  }
  rankingDelta.sort((x, y) => x.diagnosisId.localeCompare(y.diagnosisId));

  return {
    added: byDiagnosisId(added),
    removed: byDiagnosisId(removed),
    changed: byDiagnosisId(changed),
    stable: [...stable].sort(),
    temporalTransitions: byDiagnosisId(temporalTransitions),
    episodeTransitions,
    coverageDelta: { byDiagnosis: byDiagnosisId(coverageByDiagnosis), byCriterion: coverageByCriterion },
    conflictDelta: { new: conflictNew, resolved: conflictResolved, statusChanged: conflictStatusChanged },
    rankingDelta,
  };
}
