import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { saveAs } from "file-saver";
import {
  buildTimelinePageModel,
  slugifyForFilename,
  type TimelinePageModel,
} from "./timelineFormatter";
import type { Client } from "../types/client";

// Deterministic structured PDF export for the Work Timeline.
//
// Architecture (spec Part 5):
//   - timelineFormatter.ts builds a TimelinePageModel from authoritative
//     workTimeline data (single source of truth, exact same input that
//     drives the on-screen list and totals).
//   - this file renders that page model into a PDF via jsPDF +
//     autoTable. No DOM scraping, no browser print emulation, no
//     React coupling.
//
// To add DOCX or another renderer, write a new file consuming the same
// TimelinePageModel — the data and the renderer stay decoupled.

const MARGIN_PT = 36;       // 0.5"
const HEADER_FONT_PT = 14;
const META_FONT_PT = 9;
const BODY_FONT_PT = 10;

function renderHeader(doc: jsPDF, model: TimelinePageModel): number {
  let y = MARGIN_PT;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(HEADER_FONT_PT);
  doc.text("Work Timeline", MARGIN_PT, y);
  y += HEADER_FONT_PT + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(META_FONT_PT);
  doc.setTextColor(60);

  const metaLines = [
    `Client: ${model.clientName}${model.referrerOrg ? `   ·   Referrer: ${model.referrerOrg}` : ""}`,
    `Timezone: ${model.viewerTimeZone}   ·   Events: ${model.totalEvents}   ·   Total: ${model.totalLabel}`,
    `Generated: ${model.generatedAtLocal} (${model.viewerTimeZone})`,
  ];
  for (const line of metaLines) {
    doc.text(line, MARGIN_PT, y);
    y += META_FONT_PT + 2;
  }
  doc.setTextColor(0);
  y += 6;
  // Divider line under the header block.
  doc.setDrawColor(180);
  doc.line(MARGIN_PT, y, doc.internal.pageSize.getWidth() - MARGIN_PT, y);
  y += 10;
  return y;
}

function renderDay(
  doc: jsPDF,
  startY: number,
  day: TimelinePageModel["days"][number]
): number {
  // Day heading row (kept compact so multiple days fit per page).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(BODY_FONT_PT + 1);
  doc.setTextColor(20);
  doc.text(day.dateKey, MARGIN_PT, startY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(META_FONT_PT);
  doc.setTextColor(80);
  doc.text(`Total: ${day.totalLabel}`, doc.internal.pageSize.getWidth() - MARGIN_PT, startY, { align: "right" });
  doc.setTextColor(0);

  // Build the rows.
  const tableHead = [["Time", "Duration", "Type", "Title", "Notes"]];
  const tableBody = day.rows.map((r) => {
    const timeCell = `${r.startLocal}–${r.endLocal}`;
    const typeCell = r.paused ? `${r.typeLabel} (paused)` : r.running ? `${r.typeLabel} (running)` : r.typeLabel;
    const provenancePrefix = r.provenance ? `[${r.provenance}] ` : "";
    return [timeCell, r.durationLabel, typeCell, r.title, `${provenancePrefix}${r.description}`];
  });

  autoTable(doc, {
    head: tableHead,
    body: tableBody,
    startY: startY + 6,
    margin: { left: MARGIN_PT, right: MARGIN_PT },
    styles: {
      fontSize: BODY_FONT_PT - 1,
      cellPadding: 4,
      lineColor: 230,
      lineWidth: 0.4,
      textColor: 30,
    },
    headStyles: {
      fillColor: [240, 240, 245],
      textColor: 40,
      fontStyle: "bold",
      lineColor: 180,
    },
    columnStyles: {
      0: { cellWidth: 70 },    // Time
      1: { cellWidth: 50 },    // Duration
      2: { cellWidth: 80 },    // Type
      3: { cellWidth: 110 },   // Title
      // Notes column flexes to fill the rest
    },
    // Keep each row together when paginating — splitting a row across
    // pages is the most common print-fidelity complaint.
    rowPageBreak: "avoid",
  });

  // jsPDF/autoTable mutates `lastAutoTable.finalY` on the doc.
  // Cast to access the runtime-attached property.
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
  return (finalY ?? startY) + 18;
}

/**
 * Render the timeline page model into a PDF. Pure function on the
 * model — does not read DOM, does not depend on React. Returns the
 * generated jsPDF document. Callers decide whether to .save() to disk,
 * embed into another PDF, etc.
 */
export function renderTimelinePdf(model: TimelinePageModel): jsPDF {
  // Letter portrait; jsPDF defaults to "a4" + "pt" units in many
  // setups but we set explicitly for determinism.
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = renderHeader(doc, model);

  if (model.days.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(BODY_FONT_PT);
    doc.setTextColor(120);
    doc.text("No timeline events recorded.", MARGIN_PT, y);
    return doc;
  }

  for (const day of model.days) {
    // Force a new page if there's no room for a day heading + a couple
    // of rows. autoTable also handles overflow page-breaks internally.
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y > pageHeight - 120) {
      doc.addPage();
      y = MARGIN_PT;
    }
    y = renderDay(doc, y, day);
  }

  // Footer: page number x of N (drawn AFTER all pages exist).
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(META_FONT_PT);
    doc.setTextColor(140);
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() - MARGIN_PT,
      doc.internal.pageSize.getHeight() - 20,
      { align: "right" }
    );
  }

  return doc;
}

/**
 * Build the page model from the authoritative client data and save a
 * PDF to disk via the standard browser-download flow. In Tauri this
 * lands in the user's default Downloads folder; in a plain browser it
 * triggers the system download dialog.
 *
 * The filename includes the client name and a short timestamp so
 * repeated exports don't collide.
 */
export async function exportTimelineToPdf(
  client: Client,
  viewerTz: string
): Promise<void> {
  const model = buildTimelinePageModel(client, viewerTz);
  const doc = renderTimelinePdf(model);
  const blob = doc.output("blob");
  const slug = slugifyForFilename(model.clientName);
  // Compact filename timestamp (yyyymmdd-hhmm) using the local
  // generation time we already computed.
  const stamp = model.generatedAtLocal.replace(/[^\d]/g, "").slice(0, 12);
  saveAs(blob, `work-timeline_${slug}_${stamp}.pdf`);
}
