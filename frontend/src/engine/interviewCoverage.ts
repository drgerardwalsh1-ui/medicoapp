// ── Interview coverage — what's been asked, what remains ──────────────────────
// Pure computation: template + observation log → per-section coverage. This
// is the "at a glance" the Word template used to provide: every probe is
// PRESENT / DENIED / NOT YET ASKED, and untouched probes are visible holes,
// because in medicolegal work an undocumented negative is a defect in the
// report.
//
// Coverage of symptom sections is DERIVED from the canonical observation log
// (never tracked separately — capturing a fact anywhere, including via the
// omnibox, ticks the right probe automatically). Narrative/MSE/PIRS sections
// are conversation-covered: their tick is a clinician action recorded as an
// observation-free section mark passed in by the page.

import type { Observation } from "../types/observation";
import type {
  InterviewSection,
  InterviewTemplate,
} from "../types/interviewTemplate";
import { SYMPTOM_DOMAINS } from "../data/symptomDomains";

export type ProbeState = "present" | "absent" | "not_asked";

export type ProbeCoverage = {
  readonly symptomTypeId: string;
  readonly label: string;
  readonly state: ProbeState;
};

export type SectionCoverage = {
  readonly section: InterviewSection;
  readonly probes: readonly ProbeCoverage[]; // symptomDomain sections only
  readonly touched: number;
  readonly total: number;
  readonly complete: boolean;
};

export function domainProbes(
  section: InterviewSection,
): { symptomTypeId: string; label: string }[] {
  if (section.kind !== "symptomDomain" || !section.domainId) return [];
  const domain = SYMPTOM_DOMAINS.find((d) => d.id === section.domainId);
  if (!domain) return [];
  const wanted = section.probeIds ? new Set(section.probeIds) : null;
  const seen = new Set<string>();
  const probes: { symptomTypeId: string; label: string }[] = [];
  for (const s of domain.symptoms) {
    if (seen.has(s.symptomEntityId)) continue;
    if (wanted && !wanted.has(s.symptomEntityId)) continue;
    seen.add(s.symptomEntityId);
    probes.push({ symptomTypeId: s.symptomEntityId, label: s.label });
  }
  return probes;
}

// Latest non-tombstoned subjective observation per concept decides the
// probe state (append-only log: last entry per id wins, tombstone clears).
// Across multiple chains for one concept (shouldn't arise — the UI amends a
// single chain — but historical data may contain them), the LAST live chain
// in log order wins: the most recent clinician statement is the truth.
export function probeStates(
  observations: readonly Observation[],
): Map<string, ProbeState> {
  const latestById = new Map<string, Observation>();
  for (const o of observations) latestById.set(o.id as string, o);
  const states = new Map<string, ProbeState>();
  for (const o of latestById.values()) {
    if (o.tombstoned || o.frame !== "subjective") continue;
    if (o.presence === "present" || o.presence === "absent")
      states.set(o.symptomTypeId as string, o.presence);
  }
  return states;
}

/**
 * Coverage for every template section. `manualTicks` carries the
 * conversation-covered sections (narrative / MSE / PIRS) the clinician has
 * marked done.
 */
export function computeCoverage(
  template: InterviewTemplate,
  observations: readonly Observation[],
  manualTicks: ReadonlySet<string>,
): SectionCoverage[] {
  const states = probeStates(observations);
  return template.sections.map((section) => {
    if (section.kind === "symptomDomain") {
      const probes = domainProbes(section).map((p) => ({
        ...p,
        state: states.get(p.symptomTypeId) ?? ("not_asked" as ProbeState),
      }));
      const touched = probes.filter((p) => p.state !== "not_asked").length;
      return {
        section,
        probes,
        touched,
        total: probes.length,
        complete: probes.length > 0 && touched === probes.length,
      };
    }
    const done = manualTicks.has(section.id);
    return {
      section,
      probes: [],
      touched: done ? 1 : 0,
      total: 1,
      complete: done,
    };
  });
}

/** Items still uncovered — the end-of-interview audit. De-duplicated:
 *  domains with per-substance entity variants share labels. */
export function uncoveredItems(coverage: readonly SectionCoverage[]): string[] {
  const out = new Set<string>();
  for (const c of coverage) {
    if (c.section.kind === "symptomDomain") {
      for (const p of c.probes)
        if (p.state === "not_asked") out.add(`${c.section.title}: ${p.label}`);
    } else if (!c.complete) {
      out.add(c.section.title);
    }
  }
  return [...out];
}
