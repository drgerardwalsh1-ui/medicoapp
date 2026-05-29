// ── Mental State Examination narrative engine ─────────────────────────────────
// Deterministic prose assembly from structured MSE chip data + the linked
// Current Symptoms entity store. Rule-based only — no paraphrasing.
//
// Output is a structured, medico-legally formal narrative. Domains with no
// abnormal findings produce explicit "no abnormality" prose so the report
// reads completely even when the clinician changed nothing (the UI defaults
// every domain to a clinically normal state).

import type { AssessmentAttendees, AssessmentModality, MSEData } from "../types/client";
import type { SymptomEntity, MoodState } from "../types/dsm";
import { buildSubject, type NarrativeSubject } from "./narrativeEngine";
import { mseDomain } from "../data/mseDomains";
import { moodLabels } from "../data/moodState";

export interface MSENarrativeParams {
  gender?: string | null;
  assessmentDate?: string;
  modality?: AssessmentModality;
  attendees: AssessmentAttendees;
  mse: MSEData;
  symptoms: Record<string, SymptomEntity>;
  // Unified mood state shared with Current Symptoms.
  moodState?: MoodState;
  durationLabel?: string;
}

function chipsFor(mse: MSEData, domainId: string): string[] {
  return mse.domains?.[domainId]?.chips ?? [];
}

function notesFor(mse: MSEData, domainId: string): string {
  return (mse.domains?.[domainId]?.notes ?? "").trim();
}

function has(mse: MSEData, domainId: string, chipId: string): boolean {
  return chipsFor(mse, domainId).includes(chipId);
}

function present(symptoms: Record<string, SymptomEntity>, entityId: string): boolean {
  return symptoms?.[entityId]?.currentPresence === true;
}

// Join with commas and a trailing "and".
function listJoin(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

// Labels for a domain's selected chips, in domain-definition order.
function selectedLabels(mse: MSEData, domainId: string): string[] {
  const def = mseDomain(domainId);
  if (!def) return [];
  const sel = new Set(chipsFor(mse, domainId));
  return def.chips.filter((c) => sel.has(c.id)).map((c) => c.label);
}

function appendNote(paragraph: string, note: string): string {
  if (!note) return paragraph;
  return `${paragraph} ${note}`;
}

// ── Domain paragraph builders ─────────────────────────────────────────────────

function appearanceP(mse: MSEData): string {
  const labels = selectedLabels(mse, "appearance");
  let ageClause = "appeared their stated age";
  if (labels.includes("appeared older than stated age")) ageClause = "appeared older than their stated age";
  else if (labels.includes("appeared younger than stated age")) ageClause = "appeared younger than their stated age";
  const groomingAbnormal = labels.filter(
    (l) => !l.startsWith("appeared "),
  );
  let grooming = "was well groomed";
  if (groomingAbnormal.length) grooming = `was ${listJoin(groomingAbnormal)}`;
  let p = `The Claimant ${ageClause} and ${grooming}.`;
  return appendNote(p, notesFor(mse, "appearance"));
}

function behaviourP(s: NarrativeSubject, mse: MSEData, modality?: AssessmentModality): string {
  const labels = selectedLabels(mse, "behaviour");
  const was = s.isPlural ? "were" : "was";
  let psychomotor = "There was no psychomotor disturbance";
  if (labels.includes("psychomotor agitation")) psychomotor = "There was psychomotor agitation";
  else if (labels.includes("psychomotor retardation")) psychomotor = "There was psychomotor retardation";

  const demeanourAbnormal = labels.filter((l) =>
    ["agitated", "distressed", "restless", "uncooperative", "guarded"].includes(l),
  );
  const demeanour =
    demeanourAbnormal.length > 0
      ? `${s.pronoun} ${was} ${listJoin(demeanourAbnormal)}`
      : `${s.pronoun} ${was} relaxed in ${s.possessive} chair`;

  let eye = "There was good eye contact";
  if (labels.includes("no eye contact")) eye = "There was no eye contact";
  else if (labels.includes("poor eye contact")) eye = "There was poor eye contact";
  if (modality === "videoconference" && !labels.includes("no eye contact")) {
    eye += " with the videoconference camera";
  }

  let p = `${psychomotor}, and ${demeanour}. ${eye}.`;
  return appendNote(p, notesFor(mse, "behaviour"));
}

function speechP(s: NarrativeSubject, mse: MSEData): string {
  const labels = selectedLabels(mse, "speech");
  const was = s.isPlural ? "were" : "was";
  const spontaneity = labels.includes("not spontaneous") ? "not spontaneous" : "spontaneous";
  let volume = "normal in volume";
  if (labels.includes("increased volume")) volume = "increased in volume";
  else if (labels.includes("low volume")) volume = "low in volume";
  let rate = "normal rate";
  if (labels.includes("slow rate")) rate = "slow rate";
  else if (labels.includes("rapid rate")) rate = "rapid rate";

  const qualifiers = labels.filter((l) =>
    ["monotone", "pressured", "slowed", "impoverished"].includes(l),
  );
  const qualifierClause = qualifiers.length ? ` Speech ${was} ${listJoin(qualifiers)}.` : "";

  let p = `Speech ${was} ${spontaneity} and ${volume}, with ${rate}, rhythm, and prosody.${qualifierClause}`;
  return appendNote(p, notesFor(mse, "speech"));
}

function moodP(s: NarrativeSubject, moodState?: MoodState): string {
  const descriptors = moodLabels(moodState?.descriptors ?? []);
  const mood = descriptors.length ? listJoin(descriptors) : "euthymic";
  const p = `${s.noun} described ${s.possessive} mood as ${mood}.`;
  return appendNote(p, (moodState?.notes ?? "").trim());
}

function affectP(s: NarrativeSubject, mse: MSEData): string {
  const labels = selectedLabels(mse, "affect");
  const was = s.isPlural ? "were" : "was";
  let range = "normal range";
  if (labels.includes("restricted range")) range = "restricted range";
  else if (labels.includes("flat")) range = "flat range";
  else if (labels.includes("blunted")) range = "blunted range";

  const quality = labels.filter((l) =>
    ["labile", "incongruent", "tearful", "irritable"].includes(l),
  );
  let qualityClause = "warm, reactive, and appropriate";
  if (quality.length) qualityClause = listJoin(quality);

  let p = `${s.possessive.charAt(0).toUpperCase()}${s.possessive.slice(1)} affect ${was} ${qualityClause}, with ${range}.`;
  return appendNote(p, notesFor(mse, "affect"));
}

function thoughtFormP(s: NarrativeSubject, mse: MSEData, symptoms: Record<string, SymptomEntity>): string {
  const labels = selectedLabels(mse, "thoughtForm");
  const was = s.isPlural ? "were" : "was";
  const disorganised = present(symptoms, "disorganised_thinking");
  const abnormal = [...labels];
  let p: string;
  if (disorganised || abnormal.length) {
    const features = abnormal.length ? listJoin(abnormal) : "disorganised";
    p = `Thought form ${was} illogical, with ${features} noted.`;
  } else {
    p = `Thought form ${was} logical with no formal thought disorder noted.`;
  }
  return appendNote(p, notesFor(mse, "thoughtForm"));
}

function thoughtContentP(
  s: NarrativeSubject,
  mse: MSEData,
  symptoms: Record<string, SymptomEntity>,
): string {
  const labels = selectedLabels(mse, "thoughtContent");
  const did = s.isPlural ? "did" : "did";
  const sentences: string[] = [
    "The main themes related to the effects of the subject injury on " + s.possessive + " life.",
  ];

  const negThemes: string[] = [];
  if (present(symptoms, "worthlessness_guilt")) negThemes.push("guilt and worthlessness");
  if (present(symptoms, "hopelessness")) negThemes.push("hopelessness");
  if (present(symptoms, "low_self_esteem")) negThemes.push("low self-esteem");
  if (labels.includes("negative thoughts")) negThemes.push("negative thoughts");
  for (const l of labels) {
    if (["preoccupations", "ruminations", "overvalued ideas", "paranoid ideation"].includes(l)) {
      negThemes.push(l);
    }
  }
  if (negThemes.length) {
    sentences.push(`${s.noun} described ${listJoin(negThemes)}.`);
  } else {
    sentences.push(`${s.noun} ${did} not describe negative thoughts.`);
  }

  if (labels.includes("delusions")) {
    sentences.push("There were delusions noted.");
  } else {
    sentences.push("There were no delusions noted.");
  }

  let p = sentences.join(" ");
  return appendNote(p, notesFor(mse, "thoughtContent"));
}

function riskP(s: NarrativeSubject, mse: MSEData, symptoms: Record<string, SymptomEntity>): string {
  const sentences: string[] = [];
  if (present(symptoms, "suicidal_ideation")) {
    sentences.push(`${s.noun} described suicidal thoughts.`);
  } else {
    sentences.push(`${s.noun} denied suicidal thoughts.`);
  }
  if (has(mse, "risk", "homicidal")) {
    sentences.push(`${s.noun} described homicidal thoughts.`);
  } else {
    sentences.push(`${s.noun} denied homicidal thoughts.`);
  }
  if (present(symptoms, "self_harm")) {
    sentences.push("There was a history of self-harm.");
  }
  let p = sentences.join(" ");
  return appendNote(p, notesFor(mse, "risk"));
}

function perceptionsP(s: NarrativeSubject, mse: MSEData, symptoms: Record<string, SymptomEntity>): string {
  const labels = selectedLabels(mse, "perceptions");
  const abnormal = present(symptoms, "hallucinations") || labels.length > 0;
  let p: string;
  if (abnormal) {
    const features = labels.length ? listJoin(labels) : "perceptual abnormality";
    p = `${s.noun} described ${features}.`;
  } else {
    p = `There was no perceptual abnormality described, and ${s.pronoun} did not appear to respond to abnormal internal stimuli.`;
  }
  return appendNote(p, notesFor(mse, "perceptions"));
}

function cognitionP(
  s: NarrativeSubject,
  mse: MSEData,
  attendees: AssessmentAttendees,
  durationLabel?: string,
): string {
  const labels = selectedLabels(mse, "cognition");
  const sentences: string[] = [];

  sentences.push(
    labels.includes("formal cognitive testing performed")
      ? "Formal cognitive testing was performed."
      : "Formal cognitive testing was not performed.",
  );

  // Attendance.
  let attendance = "attended alone";
  if (!attendees.attendedAlone) {
    const who =
      attendees.supportPersonRelation
        ? `with ${s.possessive} ${attendees.supportPersonRelation}`
        : attendees.supportPerson
          ? `with ${attendees.supportPerson}`
          : "with a support person";
    attendance = who;
  }
  sentences.push(`The Claimant ${attendance} and attended at the correct time.`);

  // Interpreter — only mentioned when present.
  if (attendees.interpreterPresent) {
    if (attendees.interpreterCoverage === "partial") {
      const reason = (attendees.interpreterPartialReason ?? "").trim();
      sentences.push(
        `An interpreter was present for part of the assessment${reason ? ` (${reason})` : ""}.`,
      );
    } else {
      sentences.push("An interpreter was present for the entire assessment.");
    }
  }

  // History quality.
  const hq = mse.historyQuality || "good";
  sentences.push(`A ${hq} history was obtained.`);

  // Duration coping + concentration.
  const coping = mse.durationCoping || "well";
  const conc = mse.concentrationDifficulty || "no";
  const concClause =
    conc === "no" || conc === "none"
      ? "no difficulty sustaining concentration"
      : `${conc} difficulty sustaining concentration`;
  const durClause = durationLabel ? ` over the ${durationLabel} assessment` : "";
  sentences.push(
    `${s.noun} managed the assessment duration ${coping}${durClause} and had ${concClause}.`,
  );

  let p = sentences.join(" ");
  return appendNote(p, notesFor(mse, "cognition"));
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface MSENarrativeBlock {
  heading: string;
  body: string;
}

export function generateMSEBlocks(params: MSENarrativeParams): MSENarrativeBlock[] {
  const s = buildSubject(params.gender);
  const { mse, symptoms, attendees, modality, durationLabel, moodState } = params;
  return [
    { heading: "Appearance", body: appearanceP(mse) },
    { heading: "Behaviour", body: behaviourP(s, mse, modality) },
    { heading: "Speech", body: speechP(s, mse) },
    { heading: "Mood", body: moodP(s, moodState) },
    { heading: "Affect", body: affectP(s, mse) },
    { heading: "Thought form", body: thoughtFormP(s, mse, symptoms) },
    { heading: "Thought content", body: thoughtContentP(s, mse, symptoms) },
    { heading: "Risk", body: riskP(s, mse, symptoms) },
    { heading: "Perceptions", body: perceptionsP(s, mse, symptoms) },
    { heading: "Cognition", body: cognitionP(s, mse, attendees, durationLabel) },
  ];
}

// Full plain-text narrative — the editable default shown on the MSE page and
// emitted into the report.
export function generateMSENarrative(params: MSENarrativeParams): string {
  const dateClause = params.assessmentDate
    ? ` as at ${params.assessmentDate}`
    : "";
  const lines: string[] = [
    "CLINICAL EXAMINATION",
    "",
    `Mental State on Examination${dateClause}:`,
    "",
  ];
  for (const block of generateMSEBlocks(params)) {
    lines.push(`${block.heading}:`);
    lines.push(block.body);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
