import type { PIRSTableModel, PIRSResult } from "../types/types";

export type PIRSTable = {
name: string;
classes: number[];
preExisting: number; // 10–100
treatmentEffect: number; // 0–3
};

function clampClass(n: number) {
return Math.min(5, Math.max(1, Number(n) || 1));
}

function clampTreatment(n: number) {
return Math.min(3, Math.max(0, Number(n) || 0));
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
switch (val) {
case 0: return "minimal or no";
case 1: return "mild";
case 2: return "moderate";
case 3: return "good";
default: return "";
}
}

function initWPIFind(Class: number, Aggregate: number): number {
const tables: Record<number, number[]> = {
1: [0,0,1,1,2,2,2,3,3],
2: [-1,-1,-1,4,5,5,6,7,7,8,9,9,10,10],
3: [-1,-1,-1,-1,-1,-1,-1,11,13,15,17,19,22,24,26,28,30],
4: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,31,34,37,41,44,47,50,54,57,60],
5: [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,66,65,70,74,78,83,87,91,96,100]
};

const arr = tables[Class];
if (!arr) return 0;

const val = arr[Aggregate - 6];
return val === -1 || val === undefined ? 0 : val;
}

export function calculatePIRS(table: PIRSTableModel): PIRSResult {
const classes = table.classes.map(clampClass);
const total = classes.reduce((a, b) => a + b, 0);
const sorted = sortNumbers(classes);
const median = calculateMedian(sorted);

const initWPI = initWPIFind(median, total);

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


