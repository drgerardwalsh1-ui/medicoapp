import { buildPIRSNarrative } from "./pirsEngine";

export function buildNarrative(report: any) {
  const safe = (v: any) =>
  v?.label ? String(v.label).trim() :
  v ? String(v).trim() :
  "";

  const history = [
    safe(report.historyOfInjury),
    safe(report.mechanismOfInjury)
  ].filter(Boolean).join("\n\n");

  const symptoms = [
    safe(report.currentSymptoms),
    safe(report.psychologicalSymptoms)
  ].filter(Boolean).join("\n\n");

  const examination = [
    safe(report.physicalExam),
    safe(report.mentalStateExam)
  ].filter(Boolean).join("\n\n");

  const opinion = [
    report.diagnosis && `Diagnosis: ${report.diagnosis}`,
    report.causation && `Causation: ${report.causation}`
  ].filter(Boolean).join("\n");

  const pirs = buildPIRSNarrative(report);

  return {
    history,
    symptoms,
    examination,
    opinion,
    pirs
  };
}

/* ✅ THIS FIXES YOUR ERROR */
export function buildDocument(report: any) {
  const n = buildNarrative(report);

  return `
HISTORY
${n.history}

SYMPTOMS
${n.symptoms}

EXAMINATION
${n.examination}

OPINION
${n.opinion}

${n.pirs}
  `.trim();
}