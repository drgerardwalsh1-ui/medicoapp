import type { PIRSTableModel, PIRSResult } from "../types/types";
import {
  CLASS_MAX,
  CLASS_MIN,
  TREATMENT_EFFECT_TEXT,
  TREATMENT_MAX,
  TREATMENT_MIN,
  wpiFromMedianAndAggregate,
} from "../rules/pirsNswRules";

export type PIRSTable = {
name: string;
classes: number[];
preExisting: number; // 10–100
treatmentEffect: number; // 0–3
};

function clampClass(n: number) {
return Math.min(CLASS_MAX, Math.max(CLASS_MIN, Number(n) || CLASS_MIN));
}

function clampTreatment(n: number) {
return Math.min(TREATMENT_MAX, Math.max(TREATMENT_MIN, Number(n) || TREATMENT_MIN));
}

function sortNumbers(arr: number[]) {
return [...arr].sort((a, b) => a - b);
}

function calculateMedian(sorted: number[]) {
return Math.round((sorted[2] + sorted[3]) / 2);
}

function roundStandard(n: number) {
return Math.floor(n + 0.5); // ✅ 0.5 rounds up
}

function getTreatmentText(val: number) {
return TREATMENT_EFFECT_TEXT[val] ?? "";
}

export function calculatePIRS(table: PIRSTableModel): PIRSResult {
const classes = table.classes.map(clampClass);
const total = classes.reduce((a, b) => a + b, 0);
const sorted = sortNumbers(classes);
const median = calculateMedian(sorted);

const initWPI = wpiFromMedianAndAggregate(median, total);

const pre = Number(table.preExisting) || 0;
const treat = clampTreatment(table.treatmentEffect);

const deduction = initWPI * (pre / 100);
const preAdj = roundStandard(deduction);

const final = initWPI - preAdj + treat;

return {
classes,
total,
median,
initWPI,
preAdj,
preText: `${pre}% of ${initWPI}% = ${deduction} → ${preAdj}%`,
treat,
treatText: getTreatmentText(treat),
final
};
}

export function buildPIRSNarrative(report: any): string {
  const tables: PIRSTableModel[] = report.pirsTables || [];

  return tables
    .map((t) => {
      const r = calculatePIRS(t);

      const classes = r.classes.join(", ");
      const ascending = [...r.classes].sort((a, b) => a - b).join(", ");

      const treatText = (() => {
        switch (r.treat) {
          case 0: return "minimal or no";
          case 1: return "mild";
          case 2: return "moderate";
          case 3: return "good";
          default: return "an unspecified";
        }
      })();

      return (
        `PIRS classes were ${classes}. ` +
        `Thus, the aggregate was ${r.total}. ` +
        `In ascending order: ${ascending}. \n` +
        `The median was Class ${r.median}. ` +
        `The Initial WPI was ${r.initWPI}%. \n` +
        `${r.preAdj}% deduction for a pre-existing condition. ` +
        `${r.treat}% was added for ${treatText} treatment effect. \n` +
        `This gave the final Whole Person Impairment of ${r.final}%.`
      );
    })
    .join("\n\n");
}


