// ── Phase 19 — Clinical Prioritization Synthesis (pure, additive, UX-only) ─────
// Decides "which diagnoses should be foregrounded right now" WITHOUT changing
// truth. The engine, semantic interpretation, temporal governance, constraint
// layer, snapshot, and replay are NOT modified. Diagnoses are never hidden or
// removed — only reordered into foreground / secondary / background buckets
// for the clinician-facing UI. Forensic drawer keeps everything unchanged.
//
// Allowed inputs: ReportSnapshotV2 + ClinicalReplay (TYPES only). No engine,
// no bridge imports.

import type { ReportSnapshotV2 } from "./clinicalDecision";
import type { ClinicalReplay } from "./clinicalReplay";

export type DisplayPriority = "foreground" | "secondary" | "background";

export interface ClinicalPriorityView {
  readonly diagnosisId: string;
  readonly name: string;
  readonly semanticState: string;
  readonly temporalStatus?: string;
  readonly displayPriority: DisplayPriority;
  readonly displayReason: readonly string[];
  readonly suppressFromPrimaryList: boolean;
  readonly retainInDifferentials: boolean;
}

// ── Chronic-disorder registry (extend as new chronic diagnoses are added) ─────
const CHRONIC_DIAGNOSES: ReadonlySet<string> = new Set(["pdd"]);

// Matches the existing temporal-unmet wording from Phase 9 (no new logic).
const CHRONICITY_PATTERN =
  /chronicit(?:y|ies)|persistence|≥\s*2\s*-?\s*year|two[-\s]year|long[-\s]?standing/i;

function basePriorityFor(state: string): DisplayPriority {
  switch (state) {
    case "excluded":
      return "background";
    case "rule_out":
      return "secondary";
    case "differential_primary":
    case "likely":
    case "probable":
    case "possible":
      return "foreground";
    case "subthreshold":
    case "unlikely":
      return "background";
    default:
      return "background";
  }
}

const PRIORITY_RANK: Record<DisplayPriority, number> = {
  foreground: 0,
  secondary: 1,
  background: 2,
};

export function prioritizeClinicalDisplay(
  snapshot: ReportSnapshotV2,
  _replay?: ClinicalReplay,
): readonly ClinicalPriorityView[] {
  const temporalById = new Map(
    snapshot.temporalQualifications.map((t) => [t.diagnosisId, t]),
  );

  // ── Pass 1 — base priority + per-rule adjustments ────────────────────────────
  const items: ClinicalPriorityView[] = snapshot.semanticStates.map((s) => {
    const temporal = temporalById.get(s.diagnosisId);
    let priority = basePriorityFor(s.state);
    const reasons: string[] = [];

    // RULE 3 — rule_out never foreground.
    if (s.state === "rule_out") priority = "secondary";
    // RULE 4 — excluded always background.
    if (s.state === "excluded") priority = "background";

    // RULE 1 — chronic + temporally_unknown + chronicity unmet → demote.
    const isChronic = CHRONIC_DIAGNOSES.has(s.diagnosisId);
    const temporallyUnknown = temporal?.status === "temporally_unknown";
    const chronicityUnmet =
      temporal?.unmetRequirements?.some((r) => CHRONICITY_PATTERN.test(r)) ?? false;

    if (isChronic && temporallyUnknown && chronicityUnmet) {
      if (priority === "foreground") priority = "secondary";
      reasons.push("Chronicity/persistence not established — retained as secondary");
    }

    // RULE 2 — chronic + temporally_supported → annotate promotion eligibility.
    if (isChronic && temporal?.status === "temporally_supported") {
      reasons.push("Longitudinal support documented");
    }

    return {
      diagnosisId: s.diagnosisId,
      name: s.name,
      semanticState: s.state,
      temporalStatus:
        temporal && temporal.status !== "temporally_not_applicable"
          ? temporal.status
          : undefined,
      displayPriority: priority,
      displayReason: reasons,
      suppressFromPrimaryList: priority !== "foreground",
      // RULE 5 — differential preservation. Anything in a differential group is
      // retained; rule_out / non-excluded items are kept too so the clinician
      // can always see them in the differential drawer.
      retainInDifferentials: !!s.differentialGroup || s.state !== "excluded",
    };
  });

  const itemById = new Map(items.map((i) => [i.diagnosisId, i]));

  // ── Pass 2 — family-level acute promotion ──────────────────────────────────
  // If RULE 1 demoted a chronic diagnosis, promote acute alternatives in the
  // same differential family so the clinician sees an acute framing rather
  // than the chronic one dominating without longitudinal evidence.
  for (const s of snapshot.semanticStates) {
    if (!CHRONIC_DIAGNOSES.has(s.diagnosisId)) continue;
    if (!s.differentialGroup) continue;
    const chronicItem = itemById.get(s.diagnosisId);
    if (!chronicItem) continue;
    const wasDemotedByRule1 = chronicItem.displayReason.some((r) =>
      r.startsWith("Chronicity/persistence not established"),
    );
    if (!wasDemotedByRule1) continue;

    for (const other of snapshot.semanticStates) {
      if (other.diagnosisId === s.diagnosisId) continue;
      if (other.differentialGroup !== s.differentialGroup) continue;
      if (CHRONIC_DIAGNOSES.has(other.diagnosisId)) continue;
      if (other.state === "excluded" || other.state === "rule_out") continue;

      const otherItem = itemById.get(other.diagnosisId);
      if (!otherItem || otherItem.displayPriority === "foreground") continue;

      itemById.set(other.diagnosisId, {
        ...otherItem,
        displayPriority: "foreground",
        displayReason: [
          ...otherItem.displayReason,
          "Acute framing — longitudinal evidence pending for chronic alternative",
        ],
        suppressFromPrimaryList: false,
      });
    }
  }

  // ── Stable ordering — priority bucket, then diagnosisId ────────────────────
  return [...itemById.values()].sort((a, b) => {
    const r = PRIORITY_RANK[a.displayPriority] - PRIORITY_RANK[b.displayPriority];
    if (r !== 0) return r;
    return a.diagnosisId < b.diagnosisId ? -1 : a.diagnosisId > b.diagnosisId ? 1 : 0;
  });
}
