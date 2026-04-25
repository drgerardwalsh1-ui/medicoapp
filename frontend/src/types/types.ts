// src/types/types.ts

export type ReasonEntry = {
  rationale?: string;
  findings?: string;
};

export type PIRSResult = {
  classes: number[];
  total: number;
  median: number;
  initWPI: number;
  preAdj: number;
  preText: string;
  treat: number;
  treatText: string;
  final: number;
};

export type PIRSTableModel = {
  name: string;
  classes: number[];
  reasons?: ReasonEntry[];
  preExisting: number;      // 0–100
  treatmentEffect: number;  // 0–3
  assessorError?: string;

  // Previous Assessor comparison fields
  assessorClasses?: number[]; // 6 entries, 1–5
  assessorTotal?: number;
  assessorMedian?: number;
  assessorInitWPI?: number;
  assessorPreAdj?: number;
  assessorTreat?: number;
  assessorFinal?: number;
};
