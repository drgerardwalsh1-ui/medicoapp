import type { Client } from "../types/client";
import { formatFullName, calcAge, calcAgeAtDate, calcYearsSince } from "../types/client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pronouns(gender: string) {
  const g = (gender || "").toLowerCase().trim();
  if (g === "male" || g === "man")
    return { sub: "He", obj: "him", pos: "His", posLc: "his" };
  if (g === "female" || g === "woman")
    return { sub: "She", obj: "her", pos: "Her", posLc: "her" };
  return { sub: "They", obj: "them", pos: "Their", posLc: "their" };
}

function formatDateAU(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateAssessmentText(client: Client): string {
  const identity = client.identity;
  const injury = client.clinical.injury;
  const checklist = client.assessmentChecklist;
  const admin = client.administrative;
  const p = pronouns(identity.gender ?? "");

  const fullName = formatFullName(identity) || "The claimant";

  const para: string[] = [];

  // ── Identity ──────────────────────────────────────────────────────────────
  {
    const age = identity.dateOfBirth ? calcAge(identity.dateOfBirth) : 0;
    const genderStr = identity.gender ? identity.gender.toLowerCase() : null;

    const descriptors: string[] = [];
    if (age) descriptors.push(`${age}-year-old`);
    if (genderStr) descriptors.push(genderStr);

    const article = descriptors.length ? "a " : "a claimant";
    const desc = descriptors.length ? descriptors.join(" ") : "";
    let s = `${fullName} is ${article}${desc}.`;

    if (admin.relationshipStatus) {
      s += ` ${p.sub} is ${admin.relationshipStatus}.`;
    }

    if (admin.occupation || admin.employer) {
      const occPhrase = admin.occupation
        ? `employed as ${startsWithVowel(admin.occupation) ? "an" : "a"} ${admin.occupation}`
        : "employed";
      const empPhrase = admin.employer ? ` at ${admin.employer}` : "";
      s += ` ${p.sub} is currently ${occPhrase}${empPhrase}.`;
    }

    para.push(s);
  }

  // ── Injury ────────────────────────────────────────────────────────────────
  if (injury?.dateOfInjury) {
    const injDate = formatDateAU(injury.dateOfInjury);
    const ageAtInj = identity.dateOfBirth
      ? calcAgeAtDate(identity.dateOfBirth, injury.dateOfInjury)
      : (injury.ageAtInjury ?? 0);
    const yrs = calcYearsSince(injury.dateOfInjury);

    const injTypeMap: Record<string, string> = {
      motor: "motor vehicle accident",
      workplace: "workplace injury",
      illness: "illness",
      other: injury.injuryTypeOther ?? "injury",
    };
    const typeStr = injTypeMap[injury.injuryType ?? ""] ?? "injury";
    const article = typeStr.match(/^[aeiou]/i) ? "an" : "a";

    let s = `${fullName} sustained ${article} ${typeStr} on ${injDate}`;
    if (ageAtInj) s += `, at the age of ${ageAtInj}`;
    s += `, approximately ${yrs} year${yrs !== 1 ? "s" : ""} ago.`;

    const insurerParts: string[] = [];
    if (injury.claimNumber) insurerParts.push(`claim number ${injury.claimNumber}`);
    if (injury.insurerName) {
      const ref = injury.insurerReference
        ? ` (reference: ${injury.insurerReference})`
        : "";
      insurerParts.push(`managed by ${injury.insurerName}${ref}`);
    }
    if (injury.insurerContactPerson)
      insurerParts.push(`insurer contact: ${injury.insurerContactPerson}`);

    if (insurerParts.length) {
      s += ` ${p.pos} ${insurerParts.join(", ")}.`;
    }

    para.push(s);
  }

  // ── Assessment conduct ────────────────────────────────────────────────────
  if (checklist.modality) {
    let s = `The assessment was conducted via ${checklist.modality}.`;

    if (checklist.consentGiven === true) {
      s += ` ${fullName} provided consent to the assessment.`;
    } else if (checklist.consentGiven === false) {
      s += ` Consent was not obtained prior to the assessment.`;
    }

    if (checklist.purposeExplained) {
      s += ` The purpose of the assessment was explained to ${p.obj}.`;
    }

    para.push(s);
  }

  // ── Attendees ─────────────────────────────────────────────────────────────
  const att = checklist.attendees;
  if (att) {
    if (att.attendedAlone !== false) {
      para.push(`${fullName} attended the assessment alone.`);
    } else if (att.supportPerson) {
      para.push(
        `${fullName} attended the assessment with a support person (${att.supportPerson}).`
      );
    } else {
      para.push(`${fullName} did not attend alone.`);
    }

    if (att.interpreterPresent) {
      const parts: string[] = [];
      if (att.interpreterName) parts.push(att.interpreterName);
      if (att.interpreterLanguage) parts.push(att.interpreterLanguage);
      if (att.interpreterNaati) parts.push(`NAATI: ${att.interpreterNaati}`);
      const detail = parts.length ? ` (${parts.join(", ")})` : "";
      para.push(`An interpreter was present during the assessment${detail}.`);
    }
  }

  // ── Technical issues ──────────────────────────────────────────────────────
  if (checklist.technicalIssues && checklist.technicalIssues !== "none") {
    const sev = cap(checklist.technicalIssues);
    let s = `${sev} technical issues were encountered during the assessment.`;
    if (checklist.technicalNotes) s += ` ${checklist.technicalNotes}`;
    para.push(s);
  }

  return para.join("\n\n");
}

function startsWithVowel(s: string): boolean {
  return /^[aeiou]/i.test(s);
}
