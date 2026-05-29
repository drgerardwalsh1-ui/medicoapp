export type FieldType = "text" | "textarea" | "number";

export type FieldSchema = {
  key: string;
  label: string;
  type?: FieldType;
};

export type SectionSchema = {
  id: string;
  title: string;
  fields: any[];
};

export type ReportSchema = {
  id: string;
  title: string;
  sections: SectionSchema[];
};

/* -------------------------
   PIRS SECTION
------------------------- */
const PIRS_SECTION: SectionSchema = {
  id: "pirs",
  title: "PIRS Assessment",
  fields: [
    { key: "pirs_1", label: "1. Self Care and Personal Hygiene", type: "number" },
    { key: "pirs_2", label: "2. Social and Recreational Activities", type: "number" },
    { key: "pirs_3", label: "3. Travel", type: "number" },
    { key: "pirs_4", label: "4. Social Functioning", type: "number" },
    { key: "pirs_5", label: "5. Concentration, Persistence and Pace", type: "number" },
    { key: "pirs_6", label: "6. Adaptation", type: "number" },

    { key: "preExisting", label: "Pre-existing (%)", type: "number" },
    { key: "treatmentEffect", label: "Treatment Effect (0–3)", type: "number" }
  ]
};

/* -------------------------
   BASE PIC SCHEMA
------------------------- */
export const PIC_SCHEMA: ReportSchema = {
  id: "PIC",
  title: "Personal Injury Commission Report",
  sections: [
    
    {
      id: "history",
      title: "History of Injury",
      fields: [
        { key: "historyOfInjuryNarrative", label: "Claimant narrative of injury mechanism, event, and history", type: "textarea" }
      ]
    },
    {
      id: "symptoms",
      title: "Current Symptoms",
      fields: [
        { key: "currentSymptoms", label: "Symptoms", type: "textarea" },
        { key: "psychologicalSymptoms", label: "Psychological", type: "textarea" }
      ]
    },

    // ✅ PIRS properly included
    PIRS_SECTION,

    {
      id: "opinion",
      title: "Opinion",
      fields: [
        { key: "diagnosis", label: "Diagnosis", type: "textarea" },
        { key: "causation", label: "Causation", type: "textarea" }
      ]
    }
  ]
};

/* -------------------------
   MOTOR SCHEMA (minimal)
------------------------- */
export const MOTOR_SCHEMA: ReportSchema = {
  id: "MOTOR",
  title: "Motor Accident Report",
  sections: PIC_SCHEMA.sections
};

/* -------------------------
   OVERLAYS (optional)
------------------------- */
export const HPL_OVERLAY = {
  title: "HPL Medico-Legal Report"
};

export const MEDILAW_OVERLAY = {
  title: "Medilaw Report"
};

/* -------------------------
   HELPERS
------------------------- */
export function applyOverlay(base: ReportSchema, overlay: any): ReportSchema {
  return {
    ...base,
    ...overlay
  };
}

export function evaluateSchema(schema: any, report: any) {
  return {
    ...schema,
    sections: schema.sections.map((section: any) => ({
      ...section,
      fields: section.fields.filter((field: any) => {

        // Example conditional logic
        if (field.showIf) {
          const value = report[field.showIf.key]?.value;
          return value === field.showIf.equals;
        }

        return true;
      })
    }))
  };
}