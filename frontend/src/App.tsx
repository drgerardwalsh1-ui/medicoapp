import { useMemo, useState, useEffect } from "react";
import {
  PIC_SCHEMA,
  MOTOR_SCHEMA,
  HPL_OVERLAY,
  MEDILAW_OVERLAY,
  applyOverlay,
  evaluateSchema
} from "./schemas/reportSchema";
import { Field } from "./renderers/renderField";
import { buildPIRSNarrative } from "./engine/pirsEngine";
import { exportReportToDocx } from "./engine/exportDocx";
import PIRSTable from "./components/PIRSTable";

/* =========================
   TYPES
========================= */
type PIRSTableType = {
  name: string;
  classes: number[];
  preExisting: number;
  treatmentEffect: number;
};

export default function App({ client, goHome }: any) {

  const [report, setReport] = useState<Record<string, any>>(
    client?.report || {}
  );

  const [pirsTables, setPirsTables] = useState<PIRSTableType[]>(
    client?.report?.pirsTables || []
  );

  const [baseSchema, setBaseSchema] = useState(PIC_SCHEMA);
  const [overlay, setOverlay] = useState<any>(null);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);

  useEffect(() => {
    if (!client) return;

    client.report = {
      ...report,
      pirsTables
    };
  }, [report, pirsTables]);

  const schema = useMemo(() => {
    let merged = baseSchema;
    if (overlay) merged = applyOverlay(baseSchema, overlay);
    return evaluateSchema(merged, report);
  }, [baseSchema, overlay, report]);

  const activeSection = schema.sections?.[activeSectionIndex];

  function addPIRSTable(name: string) {
    const exists = pirsTables.some(t => t.name === name);

    if (
      (name === "Current PIRS" && exists) ||
      (name === "Pre-injury PIRS" && exists)
    ) return;

    setPirsTables((prev) => [
      ...prev,
      {
        name,
        classes: [1, 1, 1, 1, 1, 1],
        preExisting: 0,
        treatmentEffect: 0,
        reasons: Array(6).fill({ rationale: "", findings: "" })
      }
    ]);
  }

  return (
    <div className="h-screen flex bg-slate-100">

      {/* LEFT SIDEBAR */}
      <div className="w-64 bg-white border-r p-4 flex flex-col gap-3">
        <h1 className="text-lg font-semibold text-slate-900">
          Report Builder
        </h1>

        <div className="space-y-2">
          <button className="btn-secondary w-full" onClick={() => setBaseSchema(PIC_SCHEMA)}>PIC</button>
          <button className="btn-secondary w-full" onClick={() => setBaseSchema(MOTOR_SCHEMA)}>MOTOR</button>
        </div>

        <div className="pt-2 border-t space-y-2">
          <button className="btn-secondary w-full" onClick={() => setOverlay(HPL_OVERLAY)}>HPL Overlay</button>
          <button className="btn-secondary w-full" onClick={() => setOverlay(MEDILAW_OVERLAY)}>Medilaw Overlay</button>
          <button className="btn-secondary w-full" onClick={() => setOverlay(null)}>Clear Overlay</button>
        </div>

        <div className="mt-auto">
          <button
            className="btn-primary w-full"
            onClick={() => exportReportToDocx(client, schema.title)}
          >
            Export DOCX
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* HEADER */}
          <div className="flex justify-between items-center">
            <button
              onClick={goHome}
              className="text-sm text-slate-500 hover:text-slate-900"
            >
              ← Back
            </button>
            <div className="text-sm text-slate-500">
              {client?.name}
            </div>
          </div>

          {/* TITLE */}
          <div className="card">
            <h2 className="text-2xl font-semibold mb-4">
              {schema.title}
            </h2>

            {/* SECTION TABS */}
            <div className="flex flex-wrap gap-2">
              {schema.sections.map((section: any, index: number) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSectionIndex(index)}
                  className={`px-3 py-1 rounded-lg text-sm transition
                    ${index === activeSectionIndex
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 hover:bg-slate-200"}
                  `}
                >
                  {section.title}
                </button>
              ))}
            </div>
          </div>

          {/* CONTENT CARD */}
          <div className="card space-y-4">

            {/* NORMAL SECTION */}
            {activeSection && activeSection.id !== "pirs" && (
              <div className="space-y-4">
                {activeSection.fields.map((field: any) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    type={field.type}
                    value={report[field.key]}
                    onChange={(v) =>
                      setReport({
                        ...report,
                        [field.key]: v
                      })
                    }
                  />
                ))}
              </div>
            )}

            {/* PIRS SECTION */}
            {activeSection?.id === "pirs" && (
              <div className="space-y-6">

                {/* ACTIONS */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    className="btn-primary"
                    disabled={pirsTables.some(t => t.name === "Current PIRS")}
                    onClick={() => addPIRSTable("Current PIRS")}
                  >
                    + Current
                  </button>

                  <button
                    className="btn-secondary"
                    disabled={pirsTables.some(t => t.name === "Pre-injury PIRS")}
                    onClick={() => addPIRSTable("Pre-injury PIRS")}
                  >
                    + Pre-injury
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={() => addPIRSTable("Previous Assessor PIRS")}
                  >
                    + Previous Assessor
                  </button>
                </div>

                {/* TABLES */}
                <div className="space-y-4">
                  {pirsTables.map((t, i) => (
                    <div key={i} className="card card-hover">
                      <PIRSTable
                        table={t}
                        update={(updated) =>
                          setPirsTables((prev) =>
                            prev.map((x, idx) => (idx === i ? updated : x))
                          )
                        }
                      />
                    </div>
                  ))}
                </div>

                {/* NARRATIVE */}
                <div className="bg-slate-50 border rounded-xl p-4 text-sm whitespace-pre-wrap">
                  {buildPIRSNarrative({ pirsTables })}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-80 bg-white border-l p-4 flex flex-col">
        <h3 className="font-semibold mb-2 text-slate-900">
          PIRS Narrative
        </h3>

        <div className="text-sm whitespace-pre-wrap text-slate-600 overflow-y-auto">
          {buildPIRSNarrative({ pirsTables })}
        </div>
      </div>

    </div>
  );
}