// src/types/household.ts
// Single source of truth for household and relationship structured data.
// All relationship/support references across the app (including PIRS narrative
// generation) must originate from this model — no narrative duplication of
// structured fields is permitted.

import type { UUID } from "./client";

// ── Relationship status ───────────────────────────────────────────────────────
// Used for both pre- and post-injury status.
// NOTE: cohabitation is captured separately via CohabitationStatus.

export type RelationshipStatus =
  | "Single"
  | "Married"
  | "De facto"
  | "Separated"
  | "Divorced"
  | "Widowed"
  | "Other";

// ── Cohabitation status ───────────────────────────────────────────────────────
// Separate from RelationshipStatus — a couple can be married but live apart.

export type CohabitationStatus =
  | "Lives together full-time"
  | "Lives together part-time"
  | "Shared care arrangement"
  | "Lives separately"
  | "Temporarily cohabiting"
  | "Other";

// ── Relationship type (expanded) ──────────────────────────────────────────────
// Covers household members and extended family.

export type RelationshipType =
  // Partner
  | "Husband"
  | "Wife"
  | "De facto partner"
  | "Ex-partner"
  // Children
  | "Son"
  | "Daughter"
  | "Stepson"
  | "Stepdaughter"
  | "Adopted child"
  | "Foster child"
  // Parents
  | "Mother"
  | "Father"
  | "Stepmother"
  | "Stepfather"
  // Siblings
  | "Brother"
  | "Sister"
  | "Step-sibling"
  // Other
  | "Grandparent"
  | "Grandchild"
  | "Other relative"
  | "Friend"
  | "Flatmate"
  | "Carer (informal)"
  | "Carer (formal/paid)"
  | "Other";

// ── Living arrangement ────────────────────────────────────────────────────────

export type LivingArrangement =
  | "Lives with claimant full-time"
  | "Lives with claimant part-time"
  | "Does not live with claimant"
  | "Shared custody arrangement"
  | "Other";

// ── Support types (multi-select) ──────────────────────────────────────────────

export type HouseholdSupportType =
  | "Prompting"
  | "Physical assistance"
  | "Supervision"
  | "Transport"
  | "Household tasks"
  | "Emotional support"
  | "Financial support"
  | "Other";

// ── Frequency struct (aligns with existing unit/count system) ─────────────────

export type FrequencyUnit = "Day" | "Week" | "Fortnight" | "Month";

export type FrequencyStruct = {
  count?: string;          // "1" | "2–3" | "4–5" | custom string
  unit?: FrequencyUnit;
  specialCase?: "daily" | "never" | "other";
  customText?: string;     // only populated when specialCase === "other"
};

// ── Support block (reusable within member / partner) ─────────────────────────

export type SupportBlock = {
  supportType: HouseholdSupportType[];
  supportTypeOther?: string;    // required if "Other" is selected
  frequency?: FrequencyStruct;
  notes?: string;
};

// ── Partner details ───────────────────────────────────────────────────────────

export type PartnerDetails = {
  exists: boolean;
  relationshipType?: RelationshipStatus;
  relationshipTypeOther?: string;
  yearsTogether?: number | null;
  cohabitationStatus?: CohabitationStatus;
  cohabitationOther?: string;   // required if cohabitationStatus === "Other"
  providesSupport: boolean;
  support?: SupportBlock;
  notes?: string;
};

// ── Household member ──────────────────────────────────────────────────────────
// Each person in or connected to the household is an individually represented
// record. This is the authoritative source for all support and relationship
// references used in PIRS and report generation.

export type HouseholdMember = {
  id: UUID;
  relationshipToClaimant: RelationshipType;
  relationshipOther?: string;       // required if relationshipToClaimant === "Other"
  relationshipQualifier?: string;   // e.g. "eldest", "adult", "non-biological"
  age?: number | null;
  livesWithClaimant: LivingArrangement;
  livingArrangementOther?: string;  // required if livesWithClaimant === "Other"
  providesSupport: boolean;
  support?: SupportBlock;
};

// ── Extended family (light structure) ────────────────────────────────────────
// For family outside the household — kept intentionally simple.

export type ContactLevel = "none" | "limited" | "regular";
export type ParentsAlive = "yes" | "no" | "unknown";

export type ExtendedFamily = {
  parentsAlive?: ParentsAlive;
  siblingsCount?: number | null;
  contactLevel?: ContactLevel;
  providesSupport?: boolean;
};

// ── Root structure ────────────────────────────────────────────────────────────
// Stored as Client.householdRelationships.
// householdMembers is the canonical array — all relationship data derives here.

export type HouseholdRelationships = {
  relationshipAtInjury?: RelationshipStatus;
  relationshipAtInjuryOther?: string;
  currentRelationship?: RelationshipStatus;
  currentRelationshipOther?: string;
  partnerDetails?: PartnerDetails;
  householdMembers: HouseholdMember[];
  extendedFamily?: ExtendedFamily;
};

// ── Default factory ───────────────────────────────────────────────────────────

export function defaultHouseholdRelationships(): HouseholdRelationships {
  return {
    householdMembers: [],
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────
// Used by UI components and narrative engine for consistent labelling.

export const RELATIONSHIP_STATUS_OPTIONS: RelationshipStatus[] = [
  "Single", "Married", "De facto", "Separated", "Divorced", "Widowed", "Other",
];

export const COHABITATION_STATUS_OPTIONS: CohabitationStatus[] = [
  "Lives together full-time",
  "Lives together part-time",
  "Shared care arrangement",
  "Lives separately",
  "Temporarily cohabiting",
  "Other",
];

export const RELATIONSHIP_TYPE_GROUPS: Array<{
  group: string;
  types: RelationshipType[];
}> = [
  { group: "Partner",   types: ["Husband", "Wife", "De facto partner", "Ex-partner"] },
  { group: "Children",  types: ["Son", "Daughter", "Stepson", "Stepdaughter", "Adopted child", "Foster child"] },
  { group: "Parents",   types: ["Mother", "Father", "Stepmother", "Stepfather"] },
  { group: "Siblings",  types: ["Brother", "Sister", "Step-sibling"] },
  { group: "Other",     types: ["Grandparent", "Grandchild", "Other relative", "Friend", "Flatmate", "Carer (informal)", "Carer (formal/paid)", "Other"] },
];

export const LIVING_ARRANGEMENT_OPTIONS: LivingArrangement[] = [
  "Lives with claimant full-time",
  "Lives with claimant part-time",
  "Does not live with claimant",
  "Shared custody arrangement",
  "Other",
];

export const HOUSEHOLD_SUPPORT_TYPE_OPTIONS: HouseholdSupportType[] = [
  "Prompting",
  "Physical assistance",
  "Supervision",
  "Transport",
  "Household tasks",
  "Emotional support",
  "Financial support",
  "Other",
];

// ── Type guards ───────────────────────────────────────────────────────────────

export function isPartnerType(rel: RelationshipType): boolean {
  return rel === "Husband" || rel === "Wife" || rel === "De facto partner" || rel === "Ex-partner";
}

export function isChildType(rel: RelationshipType): boolean {
  return rel === "Son" ||  rel === "Daughter" ||  rel === "Stepson" ||  rel === "Stepdaughter" || rel === "Adopted child" || rel === "Foster child";
}

export function isParentType(rel: RelationshipType): boolean {
  return rel === "Mother" || rel === "Father" || rel === "Stepmother" || rel === "Stepfather";
}

export function isCarer(rel: RelationshipType): boolean {
  return rel === "Carer (informal)" || rel === "Carer (formal/paid)";
}

export function requiresFreeText(rel: RelationshipType): boolean {
  return rel === "Other";
}

export function livesWithClaimant(member: HouseholdMember): boolean {
  return (
    member.livesWithClaimant === "Lives with claimant full-time" ||
    member.livesWithClaimant === "Lives with claimant part-time" ||
    member.livesWithClaimant === "Shared custody arrangement"
  );
}

// ── Narrative helpers ─────────────────────────────────────────────────────────
// Produce the possessive label used by the sentence engine.
// e.g. membersWhoSupport(hr, "his") → ["his partner", "his daughter"]

export function membersWhoSupport(
  hr: HouseholdRelationships,
  possessive: string
): string[] {
  const result: string[] = [];
  if (hr.partnerDetails?.exists && hr.partnerDetails.providesSupport) {
    result.push(`${possessive} partner`);
  }
  for (const m of hr.householdMembers) {
    if (!m.providesSupport) continue;
    const label = m.relationshipOther ?? m.relationshipToClaimant.toLowerCase();
    result.push(`${possessive} ${label}`);
  }
  return result;
}
