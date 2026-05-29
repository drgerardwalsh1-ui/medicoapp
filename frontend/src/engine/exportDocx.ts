import { saveAs } from "file-saver";
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } from "docx";
import { buildDocument } from "./documentEngine";
import { formatFullName, type Client } from "../types/client";
import {
  buildSubject,
  generateHistoryNarrative,
  generateTreatmentNarrative,
} from "./narrativeEngine";
import { formatPartialDate, formatDateISO } from "../time/format";
import { durationMinutes } from "../time/duration";
import { getViewerTimeZone } from "../time/zones";
import { MEDICATION_CLASS_LABELS } from "../data/medications";
import type { TreatmentEntry } from "../types/history";
import { defaultMSEData, defaultAttendees } from "../types/client";
import { generateMSEBlocks } from "./mseNarrative";
import { Temporal } from "@js-temporal/polyfill";

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function heading3(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3 });
}

function humanDuration(mins: number): string {
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function para(text: string): Paragraph {
  return new Paragraph({ text });
}

function rowCells(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map(
      (c) => new TableCell({ children: [new Paragraph({ children: [new TextRun(c)] })] })
    ),
  });
}

function treatmentTable(treatments: TreatmentEntry[], medsOnly: boolean): Table {
  const headers = medsOnly
    ? ["Medication", "Class", "Dose", "Status", "Commenced", "Ceased", "Benefit"]
    : ["Treatment", "Provider", "Status", "Commenced", "Ceased", "Benefit"];
  const rows: TableRow[] = [rowCells(headers)];
  for (const t of treatments) {
    if (medsOnly) {
      const dose = t.dose?.value != null ? `${t.dose.value}${t.dose.unit ?? "mg"}` : "";
      rows.push(rowCells([
        t.name,
        t.drugClass ? MEDICATION_CLASS_LABELS[t.drugClass] : "",
        dose,
        t.current ? "Current" : "Past",
        formatPartialDate(t.commenced),
        formatPartialDate(t.ceased),
        t.perceivedBenefit ?? "",
      ]));
    } else {
      rows.push(rowCells([
        t.name,
        t.providerName ?? "",
        t.current ? "Current" : "Past",
        formatPartialDate(t.commenced),
        formatPartialDate(t.ceased),
        t.perceivedBenefit ?? "",
      ]));
    }
  }
  return new Table({ rows });
}

export async function exportReportToDocx(client: Client, _title: string) {
  const report = client.report ?? {};
  const identity = client.identity;
  const inj = client.clinical?.injury;

  const name = formatFullName(identity);
  const header = [
    `Name: ${name}`,
    `DOB: ${identity?.dateOfBirth ?? ""}`,
    `Claim: ${inj?.claimNumber ?? ""}`,
    `Insurer: ${inj?.insurerName ?? ""}`,
  ].join("\n");

  const reportText = header + "\n\n" + buildDocument(report.fields ?? {});
  const reportParagraphs = reportText.split("\n").map((line) => new Paragraph({ text: line }));

  // ── Psychiatric history + treatment sections (deterministic narrative) ──
  const children: (Paragraph | Table)[] = [...reportParagraphs];
  const history = client.psychiatricHistory;
  if (history) {
    const subj = buildSubject(identity?.gender);

    const hist = generateHistoryNarrative(history, subj);
    if (hist) {
      children.push(heading("Psychiatric History"));
      children.push(para(hist));
    }

    const txNarr = generateTreatmentNarrative(history.treatmentHistory, subj);
    if (txNarr) {
      children.push(heading("Treatment"));
      children.push(para(txNarr));
    }

    const meds = history.treatmentHistory.treatments.filter((t) => t.category === "medication");
    if (meds.length) {
      children.push(heading("Medications"));
      children.push(treatmentTable(meds, true));
    }

    const therapies = history.treatmentHistory.treatments.filter((t) => t.category !== "medication");
    if (therapies.length) {
      children.push(heading("Therapies and Other Treatments"));
      children.push(treatmentTable(therapies, false));
    }
  }

  // ── Mental State Examination ──
  {
    const viewerTz = getViewerTimeZone();
    const appts = client.appointments ?? [];
    let appt = appts[0] ?? null;
    try {
      const today = Temporal.Now.plainDateISO(viewerTz);
      const todays = appts.find((a) => {
        const tz = a.appointmentTimeZone || viewerTz;
        return Temporal.Instant.from(a.startUtc)
          .toZonedDateTimeISO(tz)
          .toPlainDate()
          .equals(today);
      });
      if (todays) appt = todays;
    } catch {
      /* keep first appointment */
    }
    const assessmentDate = appt
      ? formatDateISO(appt.startUtc, appt.appointmentTimeZone || viewerTz)
      : "";
    const durationLabel = appt
      ? humanDuration(durationMinutes(appt.startUtc, appt.endUtc))
      : "";

    const mse = client.mse;
    children.push(heading("Clinical Examination"));
    children.push(
      para(
        `Mental State on Examination${assessmentDate ? ` as at ${assessmentDate}` : ""}:`,
      ),
    );

    if (mse?.narrativeEdited && mse.narrative) {
      for (const line of mse.narrative.split("\n")) children.push(para(line));
    } else {
      const blocks = generateMSEBlocks({
        gender: identity?.gender,
        assessmentDate,
        modality: client.assessmentChecklist?.modality,
        attendees: client.assessmentChecklist?.attendees ?? defaultAttendees(),
        mse: mse ?? defaultMSEData(),
        symptoms: client.dsmAssessment?.symptoms ?? {},
        moodState: client.dsmAssessment?.moodState,
        durationLabel,
      });
      for (const block of blocks) {
        children.push(heading3(block.heading));
        children.push(para(block.body));
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const slug = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "client";
  saveAs(blob, `${slug}.docx`);
}
