import React, { useCallback, memo, useMemo } from "react";
import { calculatePIRS } from "../engine/pirsEngine";
import type { PIRSTableModel, PIRSResult } from "../types/types";

// ------------------------------------------------------------
// CONSTANTS
// ------------------------------------------------------------

const CATEGORY_NAMES = [
  "Self",
  "Recreational",
  "Travel",
  "Social Function",
  "Concentration",
  "Adaptation"
];

const IMPAIR_TEXT = [
  "no or minimal impairment",
  "mild impairment",
  "moderate impairment",
  "severe impairment",
  "total impairment"
];

export function getTreatmentEffectText(value: number): string {
  switch (value) {
    case 0: return "minimal or no";
    case 1: return "mild";
    case 2: return "moderate";
    case 3: return "good";
    default: return "an unspecified";
  }
}


// ------------------------------------------------------------
// CATEGORY ROW (for the editable category table above results)
// ------------------------------------------------------------

type CategoryRowProps = {
  index: number;
  categoryName: string;
  table: PIRSTableModel;
  update: (t: PIRSTableModel) => void;
  hideRationale: boolean;
  onCategoryFocus?: (index: number) => void;
};

const CategoryRow = memo(function CategoryRow({
  index,
  categoryName,
  table,
  update,
  hideRationale,
  onCategoryFocus,
}: CategoryRowProps) {
  const handleClassChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const updated = [...table.classes];
      updated[index] = Number(e.target.value);
      update({ ...table, classes: updated });
    },
    [table, update, index]
  );

  const handleRationaleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const reasons = [...(table.reasons || [])];
      reasons[index] = {
        ...(reasons[index] || {}),
        rationale: e.target.value
      };
      update({ ...table, reasons });
    },
    [table, update, index]
  );

  const handleFindingsChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const reasons = [...(table.reasons || [])];
      reasons[index] = {
        ...(reasons[index] || {}),
        findings: e.target.value
      };
      update({ ...table, reasons });
    },
    [table, update, index]
  );

  const classValue = table.classes[index];
  const impairmentText = IMPAIR_TEXT[(classValue || 1) - 1];

  return (
    <tr
      className="align-top"
      onFocusCapture={() => onCategoryFocus?.(index)}
      onClickCapture={() => onCategoryFocus?.(index)}
    >
  {/* CATEGORY COLUMN — small */}
  <td className="py-2 pr-4 w-1/6">
    {index + 1}. {categoryName}
  </td>

  {/* CLASS COLUMN — unchanged */}
  <td className="py-2 pr-4">
    <select
      value={classValue}
      onChange={handleClassChange}
      className="border p-1"
    >
      {[1, 2, 3, 4, 5].map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  </td>

  {/* RATIONALE COLUMN — unchanged width */}
  {!hideRationale && (
    <td className="py-2 pr-4 w-1/4">
      <textarea
        className="w-full border p-1 resize-none overflow-hidden"
        value={table.reasons?.[index]?.rationale || ""}
        onChange={(e) => {
          handleRationaleChange(e);
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        style={{ height: "auto" }}
      />
    </td>
  )}

  {/* FINDINGS COLUMN — largest */}
  <td className="py-2 pr-4 w-1/2">
    <textarea
      className="w-full border p-1 resize-none overflow-hidden"
      value={table.reasons?.[index]?.findings || ""}
      onChange={(e) => {
        handleFindingsChange(e);
        e.target.style.height = "auto";
        e.target.style.height = e.target.scrollHeight + "px";
      }}
      style={{ height: "auto" }}
    />
    <div className="text-xs text-gray-600 mt-1">{impairmentText}</div>
  </td>
</tr>

  );
});

// ------------------------------------------------------------
// PRE-EXISTING + TREATMENT EFFECT PANEL (editable inputs)
// ------------------------------------------------------------

type PreExistingPanelProps = {
  table: PIRSTableModel;
  update: (t: PIRSTableModel) => void;
};

const PreExistingPanel = memo(function PreExistingPanel({
  table,
  update
}: PreExistingPanelProps) {
  const handlePreExistingChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ ...table, preExisting: Number(e.target.value) });
    },
    [table, update]
  );

  const handleTreatmentChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      update({ ...table, treatmentEffect: Number(e.target.value) });
    },
    [table, update]
  );

  return (
    <div className="mt-4 grid grid-cols-2 gap-6">
      <div>
        <label className="block text-sm font-medium mb-1">
          Pre-existing (%)
        </label>
        <input
          type="number"
          min={0}
          max={100}
          value={table.preExisting}
          onChange={handlePreExistingChange}
          className="border p-1 w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Treatment Effect
        </label>
        <select
          value={table.treatmentEffect}
          onChange={handleTreatmentChange}
          className="border p-1 w-full"
        >
          {[0, 1, 2, 3].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
});

// ------------------------------------------------------------
// NARRATIVE GENERATOR (Previous Assessor only)
// ------------------------------------------------------------

function generateAssessorNarrative(
  result: PIRSResult,
  table: PIRSTableModel
): string {
  const lines: string[] = [];

  // Treat undefined assessor values as "same as ours"
  const assessorClasses = table.assessorClasses ?? result.classes;
  const assessorTotal =
    table.assessorTotal === undefined ? result.total : table.assessorTotal;
  const assessorMedian =
    table.assessorMedian === undefined ? result.median : table.assessorMedian;
  const assessorInitWPI =
    table.assessorInitWPI === undefined
      ? result.initWPI
      : table.assessorInitWPI;
  const assessorPreAdj =
    table.assessorPreAdj === undefined ? result.preAdj : table.assessorPreAdj;
  const assessorTreat =
    table.assessorTreat === undefined ? result.treat : table.assessorTreat;
  const assessorFinal =
    table.assessorFinal === undefined ? result.final : table.assessorFinal;

  const classesDiffer =
    assessorClasses.length === result.classes.length &&
    assessorClasses.some((v, i) => v !== result.classes[i]);

  if (classesDiffer) {
    lines.push(
      `The assessor incorrectly recorded the class values as ${assessorClasses.join(
        ", "
      )}, whereas the correct classes are ${result.classes.join(", ")}.`
    );
  }

  if (assessorTotal !== result.total) {
    lines.push(
      `The assessor incorrectly calculated the total class score as ${assessorTotal}, whereas the correct total is ${result.total}.`
    );
  }

  if (assessorMedian !== result.median) {
    lines.push(
      `This error incorrectly altered the median class from ${result.median} to ${assessorMedian}.`
    );
  }

  if (assessorInitWPI !== result.initWPI) {
    lines.push(
      `The assessor incorrectly calculated the Initial WPI as ${assessorInitWPI}%, whereas the correct Initial WPI is ${result.initWPI}%.`
    );
  }

  if (assessorPreAdj !== result.preAdj) {
    lines.push(
      `The assessor incorrectly applied a pre-existing deduction of ${assessorPreAdj}%, instead of the correct ${result.preAdj}%.`
    );
  }

  if (assessorTreat !== result.treat) {
    lines.push(
      `The assessor incorrectly applied a treatment effect of ${assessorTreat}, whereas the correct value is ${result.treat}.`
    );
  }

  if (assessorFinal !== result.final) {
    lines.push(
      `The assessor incorrectly calculated the Final WPI as ${assessorFinal}%, instead of the correct ${result.final}%.`
    );
  }

  return lines.join(" ");
}
// ------------------------------------------------------------
// TWO-COLUMN TABLE (Current PIRS & Pre-injury PIRS)
// ------------------------------------------------------------

type TwoColumnTableProps = {
  table: PIRSTableModel;
  result: PIRSResult;
  update: (t: PIRSTableModel) => void;
  isPreInjury: boolean;
};

const TwoColumnTable = memo(function TwoColumnTable({
  table,
  result,
  update,
  isPreInjury
}: TwoColumnTableProps) {
  const classesString = result.classes.join(", ");
  const ascendingString = [...result.classes].sort((a, b) => a - b).join(", ");

  const handlePreExistingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    update({ ...table, preExisting: Number(e.target.value) });
  };

  const handleTreatmentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    update({ ...table, treatmentEffect: Number(e.target.value) });
  };

  const treatText = getTreatmentEffectText(table.treatmentEffect);


  return (
    <>
      <table className="w-full text-sm mt-6">
        <thead>
          <tr>
            <th className="text-left font-bold pb-2">Metric</th>
            <th className="text-left font-bold pb-2">Our Calculation</th>
          </tr>
        </thead>

        <tbody className="align-top">
          <tr>
            <td className="py-2 pr-6">Classes</td>
            <td className="py-2">{classesString}</td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Ascending Classes</td>
            <td className="py-2">{ascendingString}</td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Total</td>
            <td className="py-2">{result.total}</td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Median</td>
            <td className="py-2">{result.median}</td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Initial WPI</td>
            <td className="py-2">{result.initWPI}%</td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Pre-existing deduction</td>
            <td className="py-2">
              {!isPreInjury ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={table.preExisting}
                  onChange={handlePreExistingChange}
                  className="border p-1 w-24"
                />
              ) : (
                `${result.preAdj}%`
              )}
            </td>
          </tr>

          {/* FIXED ROW */}
          <tr>
            <td className="py-2 pr-6">Treatment effect</td>
            <td className="py-2">
              {!isPreInjury ? (
                <div className="flex items-center gap-3">
                  <select
                    value={table.treatmentEffect}
                    onChange={handleTreatmentChange}
                    className="border p-1 w-24"
                  >
                    {[0, 1, 2, 3].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  <span className="text-gray-600 text-sm">({treatText})</span>
                </div>
              ) : (
                `${result.treat} (${treatText})`
              )}
            </td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Final WPI</td>
            <td className="py-2">{result.final}%</td>
          </tr>
        </tbody>
      </table>

      {/* OPTIONAL IMAGE BELOW TABLE */}
      <img
        src="/images/pirscalctble.png"
        alt="PIRS calculation table"
        className="mt-4 w-full"
      />
    </>
  );
});


// ------------------------------------------------------------
// THREE-COLUMN COMPARISON TABLE (Previous Assessor PIRS)
// ------------------------------------------------------------

type ThreeColumnTableProps = {
  table: PIRSTableModel;
  result: PIRSResult;
  update: (t: PIRSTableModel) => void;
};

const ThreeColumnTable = memo(function ThreeColumnTable({
  table,
  result,
  update
}: ThreeColumnTableProps) {
  // Our values
  const classesString = result.classes.join(", ");
  const ascendingString = [...result.classes].sort((a, b) => a - b).join(", ");

  // Assessor values (mirror ours until edited)
  const assessorClasses = table.assessorClasses ?? result.classes;
  const assessorTotal =
    table.assessorTotal === undefined ? result.total : table.assessorTotal;
  const assessorMedian =
    table.assessorMedian === undefined ? result.median : table.assessorMedian;
  const assessorInitWPI =
    table.assessorInitWPI === undefined
      ? result.initWPI
      : table.assessorInitWPI;
  const assessorPreAdj =
    table.assessorPreAdj === undefined ? result.preAdj : table.assessorPreAdj;
  const assessorTreat =
    table.assessorTreat === undefined ? result.treat : table.assessorTreat;
  const assessorFinal =
    table.assessorFinal === undefined ? result.final : table.assessorFinal;

  // Handlers
  const handleAssessorClassChange =
    (index: number) => (e: React.ChangeEvent<HTMLSelectElement>) => {
      const base = table.assessorClasses ?? result.classes;
      const updated = [...base];
      updated[index] = Number(e.target.value);
      update({ ...table, assessorClasses: updated });
    };

  const handleAssessorNumber =
    (field: keyof PIRSTableModel) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value === "" ? undefined : Number(e.target.value);
      update({ ...table, [field]: value });
    };

  const narrative = generateAssessorNarrative(result, table);

  return (
    <>
      <table className="w-full text-sm mt-6">
        <thead>
          <tr>
            <th className="text-left font-bold pb-2">Metric</th>
            <th className="text-left font-bold pb-2">Our Calculation</th>
            <th className="text-left font-bold pb-2">Previous Assessor</th>
          </tr>
        </thead>

        <tbody className="align-top">
          <tr>
            <td className="py-2 pr-6">Classes</td>
            <td className="py-2">{classesString}</td>
            <td className="py-2">
              {assessorClasses.map((c, i) => (
                <select
                  key={i}
                  value={c}
                  onChange={handleAssessorClassChange(i)}
                  className="border p-1 mr-1 mb-1"
                >
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ))}
            </td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Ascending Classes</td>
            <td className="py-2">{ascendingString}</td>
            <td className="py-2">{ascendingString}</td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Total</td>
            <td className="py-2">{result.total}</td>
            <td className="py-2">
              <input
                type="number"
                value={assessorTotal}
                onChange={handleAssessorNumber("assessorTotal")}
                className="border p-1 w-24"
              />
            </td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Median</td>
            <td className="py-2">{result.median}</td>
            <td className="py-2">
              <input
                type="number"
                value={assessorMedian}
                onChange={handleAssessorNumber("assessorMedian")}
                className="border p-1 w-24"
              />
            </td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Initial WPI</td>
            <td className="py-2">{result.initWPI}%</td>
            <td className="py-2">
              <input
                type="number"
                value={assessorInitWPI}
                onChange={handleAssessorNumber("assessorInitWPI")}
                className="border p-1 w-24"
              />
            </td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Pre-existing deduction</td>
            <td className="py-2">{result.preAdj}%</td>
            <td className="py-2">
              <input
                type="number"
                value={assessorPreAdj}
                onChange={handleAssessorNumber("assessorPreAdj")}
                className="border p-1 w-24"
              />
            </td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Treatment effect</td>
            <td className="py-2">{result.treat}</td>
            <td className="py-2">
              <input
                type="number"
                value={assessorTreat}
                onChange={handleAssessorNumber("assessorTreat")}
                className="border p-1 w-24"
              />
            </td>
          </tr>

          <tr>
            <td className="py-2 pr-6">Final WPI</td>
            <td className="py-2">{result.final}%</td>
            <td className="py-2">
              <input
                type="number"
                value={assessorFinal}
                onChange={handleAssessorNumber("assessorFinal")}
                className="border p-1 w-24"
              />
            </td>
          </tr>
        </tbody>
      </table>

      {/* Narrative */}
      {narrative && (
        <div className="mt-4 p-3 bg-yellow-50 text-sm rounded">
          <div className="font-semibold mb-1">Assessor Comparison</div>
          <div className="whitespace-pre-line">{narrative}</div>
        </div>
      )}
    </>
  );
});

// ------------------------------------------------------------
// MAIN COMPONENT EXPORT
// ------------------------------------------------------------

export default function PIRSTable({
  table,
  update,
  onCategoryFocus,
}: {
  table: PIRSTableModel;
  update: (t: PIRSTableModel) => void;
  onCategoryFocus?: (index: number) => void;
}) {
  const result = useMemo(() => calculatePIRS(table), [table]);

  const isPreInjury = table.name.includes("Pre-injury");
  const isPrevious = table.name.includes("Previous Assessor");

  const hideRationale =
    table.name.includes("Pre-injury") ||
    table.name.includes("Previous Assessor");

  return (
    <div className="p-4 mb-10 bg-white rounded">
      <h3 className="font-bold text-lg mb-4">{table.name}</h3>

      {/* Category table */}
      <table className="w-full text-sm table-fixed">
  <colgroup>
    <col className="w-1/6" />   {/* Category */}
    <col className="w-1/12" />  {/* Class */}
    {!hideRationale && <col className="w-1/4" />}  {/* Rationale */}
    <col className="w-1/2" />   {/* Findings */}
  </colgroup>

        <thead>
          <tr>
            <th className="text-left font-bold pb-2">Category</th>
            <th className="text-left font-bold pb-2">Class</th>
            {!hideRationale && (
              <th className="text-left font-bold pb-2">Rationale</th>
            )}
            <th className="text-left font-bold pb-2">Findings</th>
          </tr>
        </thead>

        <tbody>
          {CATEGORY_NAMES.map((cat, i) => (
            <CategoryRow
              key={i}
              index={i}
              categoryName={cat}
              table={table}
              update={update}
              hideRationale={hideRationale}
              onCategoryFocus={onCategoryFocus}
            />
          ))}
        </tbody>
      </table>

      {/* Pre-existing + Treatment Effect */}
      {!isPreInjury && !isPrevious && (
        <PreExistingPanel table={table} update={update} />
      )}

      {/* Results tables */}
      {!isPrevious && (
        <TwoColumnTable
          table={table}
          result={result}
          update={update}
          isPreInjury={isPreInjury}
        />
      )}

      {isPrevious && (
        <ThreeColumnTable table={table} result={result} update={update} />
      )}
    </div>
  );
}
