// ── Canonical concept registry — the cross-sectional sync backbone ────────────
// One entry per symptom entity, composed at module load from the existing
// frozen data sources:
//   • SYMPTOM_DOMAINS        → Current Symptoms domain placement + label
//   • SYMPTOM_DSM_MAPPING    → DSM-5 criterion evidence targets
//   • MSE_DOMAINS            → MSE domains linked to this entity
//   • SYMPTOM_PIRS_MAPPING   → PIRS category worksheets this entity informs
//
// This module derives; it never redefines. Each source remains the single
// owner of its mapping. validateConceptRegistry() is run by tests so a typo
// in any mapping (an id that exists nowhere) fails the build rather than
// silently dropping a projection.

import { DSM5_DIAGNOSES } from "../data/dsm5";
import { MSE_DOMAINS } from "../data/mseDomains";
import { SYMPTOM_PIRS_MAPPING, type PIRSCategoryName } from "../data/pirsMapping";
import {
  SYMPTOM_DOMAINS,
  SYMPTOM_DSM_MAPPING,
  type DSMCriterionRef,
} from "../data/symptomDomains";

export type ConceptProjection = {
  readonly symptomTypeId: string;
  readonly label: string;
  // Surfaces this concept projects into. Empty array = not surfaced there.
  readonly currentSymptomsDomainIds: readonly string[];
  readonly mseDomainIds: readonly string[];
  readonly dsmCriteria: readonly DSMCriterionRef[];
  readonly pirsCategories: readonly PIRSCategoryName[];
};

// Every symptomEntityId known anywhere in the frozen data (DSM definitions
// walk recursively so nested criterion/symptom structures are covered).
function collectEntityIds(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectEntityIds(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "symptomEntityId" && typeof v === "string") out.add(v);
      else collectEntityIds(v, out);
    }
  }
}

export function knownEntityIds(): Set<string> {
  const ids = new Set<string>();
  collectEntityIds(DSM5_DIAGNOSES, ids);
  collectEntityIds(SYMPTOM_DOMAINS, ids);
  return ids;
}

function humanise(id: string): string {
  return id.replace(/_/g, " ");
}

export function buildConceptRegistry(): Map<string, ConceptProjection> {
  const ids = knownEntityIds();
  for (const id of Object.keys(SYMPTOM_DSM_MAPPING)) ids.add(id);
  for (const id of Object.keys(SYMPTOM_PIRS_MAPPING)) ids.add(id);
  for (const d of MSE_DOMAINS) for (const id of d.linkedEntities ?? []) ids.add(id);

  const labels = new Map<string, string>();
  const symptomDomainsOf = new Map<string, string[]>();
  for (const domain of SYMPTOM_DOMAINS) {
    for (const s of domain.symptoms) {
      if (!labels.has(s.symptomEntityId)) labels.set(s.symptomEntityId, s.label);
      const list = symptomDomainsOf.get(s.symptomEntityId) ?? [];
      if (!list.includes(domain.id)) list.push(domain.id);
      symptomDomainsOf.set(s.symptomEntityId, list);
    }
  }

  const mseDomainsOf = new Map<string, string[]>();
  for (const domain of MSE_DOMAINS) {
    for (const id of domain.linkedEntities ?? []) {
      const list = mseDomainsOf.get(id) ?? [];
      if (!list.includes(domain.id)) list.push(domain.id);
      mseDomainsOf.set(id, list);
    }
  }

  const registry = new Map<string, ConceptProjection>();
  for (const id of [...ids].sort()) {
    registry.set(id, {
      symptomTypeId: id,
      label: labels.get(id) ?? humanise(id),
      currentSymptomsDomainIds: symptomDomainsOf.get(id) ?? [],
      mseDomainIds: mseDomainsOf.get(id) ?? [],
      dsmCriteria: SYMPTOM_DSM_MAPPING[id] ?? [],
      pirsCategories: SYMPTOM_PIRS_MAPPING[id] ?? [],
    });
  }
  return registry;
}

export const CONCEPT_REGISTRY: ReadonlyMap<string, ConceptProjection> =
  buildConceptRegistry();

// Returns a list of problems (empty = valid). Tests assert emptiness so any
// mapping referencing an unknown entity id fails CI.
export function validateConceptRegistry(): string[] {
  const problems: string[] = [];
  const known = knownEntityIds();

  for (const id of Object.keys(SYMPTOM_PIRS_MAPPING)) {
    if (!known.has(id)) problems.push(`SYMPTOM_PIRS_MAPPING references unknown entity "${id}"`);
    if (SYMPTOM_PIRS_MAPPING[id].length === 0)
      problems.push(`SYMPTOM_PIRS_MAPPING entry "${id}" maps to no categories`);
  }
  for (const id of Object.keys(SYMPTOM_DSM_MAPPING)) {
    if (!known.has(id)) problems.push(`SYMPTOM_DSM_MAPPING references unknown entity "${id}"`);
  }
  for (const domain of MSE_DOMAINS) {
    for (const id of domain.linkedEntities ?? []) {
      if (!known.has(id))
        problems.push(`MSE domain "${domain.id}" links unknown entity "${id}"`);
    }
  }
  return problems;
}
