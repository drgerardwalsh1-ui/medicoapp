// ── Context rail — live cross-sectional feedback during interview ─────────────
// Renders the payoff of the canonical fact store: as facts are captured once,
// the rail shows them landing on every surface — DSM criterion evidence
// tallies, PIRS category evidence (pre/post), MSE discrepancies, and facts
// needing epoch verification. Read-only projection of the observation log;
// nothing here asserts criteria or classes (clinician judgement only).

import { useMemo } from "react";
import type { Observation } from "../types/observation";
import {
  projectDSMEvidence,
  projectMSE,
  projectPIRSEvidence,
} from "../engine/crossSectionProjections";
import { DSM5_DIAGNOSES } from "../data/dsm5";

const DIAGNOSIS_NAME = new Map(DSM5_DIAGNOSES.map((d) => [d.id, d.abbreviation || d.name]));
const DIAGNOSIS_CRITERIA_COUNT = new Map(
  DSM5_DIAGNOSES.map((d) => [d.id, d.criteria.length]),
);

type Props = {
  observations: readonly Observation[];
  referenceInjuryDate?: string;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-b border-slate-200">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

export default function ContextRail({ observations, referenceInjuryDate }: Props) {
  const dsm = useMemo(
    () => projectDSMEvidence(observations, referenceInjuryDate),
    [observations, referenceInjuryDate],
  );
  const pirs = useMemo(
    () => projectPIRSEvidence(observations, referenceInjuryDate),
    [observations, referenceInjuryDate],
  );
  const mse = useMemo(
    () => projectMSE(observations, referenceInjuryDate),
    [observations, referenceInjuryDate],
  );

  // Distinct criteria per diagnosis with ≥1 present supporting fact.
  const dsmTally = useMemo(() => {
    const byDx = new Map<string, Set<string>>();
    for (const e of dsm) {
      if (!e.facts.some((f) => f.presence === "present")) continue;
      const set = byDx.get(e.diagnosisId) ?? new Set<string>();
      set.add(e.criterionId);
      byDx.set(e.diagnosisId, set);
    }
    return [...byDx.entries()]
      .map(([diagnosisId, criteria]) => ({
        diagnosisId,
        name: DIAGNOSIS_NAME.get(diagnosisId) ?? diagnosisId,
        withEvidence: criteria.size,
        total: DIAGNOSIS_CRITERIA_COUNT.get(diagnosisId) ?? 0,
      }))
      .sort((a, b) => b.withEvidence - a.withEvidence)
      .slice(0, 6);
  }, [dsm]);

  const discrepancies = useMemo(
    () =>
      mse.flatMap((d) => d.items.filter((i) => i.discrepancy).map((i) => i.label)),
    [mse],
  );

  const unclassified = useMemo(
    () => [
      ...new Set(
        pirs.flatMap((c) => c.unclassified.map((f) => f.label)),
      ),
    ],
    [pirs],
  );

  return (
    <aside
      className="w-60 shrink-0 border-l border-slate-200 bg-white overflow-y-auto text-xs"
      data-testid="context-rail"
    >
      <Section title="DSM evidence (candidate only)">
        {dsmTally.length === 0 ? (
          <div className="text-slate-400">No criterion evidence yet</div>
        ) : (
          dsmTally.map((d) => (
            <div key={d.diagnosisId} className="flex justify-between py-0.5">
              <span className="text-slate-700">{d.name}</span>
              <span className="text-slate-500 tabular-nums">
                {d.withEvidence}/{d.total} criteria
              </span>
            </div>
          ))
        )}
      </Section>

      <Section title="PIRS evidence (clinician rates class)">
        {pirs.map((c) => {
          const post = c.postInjury.length;
          const pre = c.preInjury.length;
          if (post + pre + c.unclassified.length === 0) {
            return (
              <div key={c.category} className="flex justify-between py-0.5 text-slate-300">
                <span>{c.category}</span>
                <span>—</span>
              </div>
            );
          }
          return (
            <div key={c.category} className="flex justify-between py-0.5">
              <span className="text-slate-700">{c.category}</span>
              <span className="tabular-nums">
                <span className="text-violet-700">{post} post</span>
                {pre > 0 && <span className="text-slate-500"> · {pre} pre</span>}
              </span>
            </div>
          );
        })}
      </Section>

      <Section title="Reported vs observed">
        {discrepancies.length === 0 ? (
          <div className="text-slate-400">No discrepancies</div>
        ) : (
          discrepancies.map((label) => (
            <div key={label} className="text-amber-700 py-0.5">
              ⚠ {label}
            </div>
          ))
        )}
      </Section>

      <Section title="Verify timing at interview">
        {unclassified.length === 0 ? (
          <div className="text-slate-400">All facts epoch-classified</div>
        ) : (
          unclassified.map((label) => (
            <div key={label} className="text-amber-700 py-0.5">
              ? {label} — onset vs injury date unclear
            </div>
          ))
        )}
      </Section>
    </aside>
  );
}
