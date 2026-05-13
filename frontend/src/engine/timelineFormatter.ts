import { Temporal } from "@js-temporal/polyfill";
import {
  activeWorkMs,
  formatDateISO,
  formatTime24,
  durationLabel,
  type WorkTimelineEvent,
  type WorkTimelineEventType,
} from "../time";
import { formatFullName, type Client } from "../types/client";

// Pure data → "page model" transform for timeline exports. Decoupled
// from React entirely (no JSX, no DOM) so the same input feeds:
//   - PDF export (engine/exportTimelinePdf.ts)
//   - DOCX export (future)
//   - any other structured renderer
//
// All calculations route through the authoritative `activeWorkMs`
// helper — paused time is excluded from reported durations, exactly
// matching the on-screen list view and the running totals.

export type TimelinePageRow = {
  startUtc: string;
  startLocal: string;        // "HH:MM" in viewer tz
  endLocal: string;          // "HH:MM" or "—"
  durationLabel: string;     // human-readable, pause-excluded
  type: WorkTimelineEventType;
  typeLabel: string;
  title: string;
  description: string;
  provenance: string;        // "auto" / "manual" / "auto, edited"
  running: boolean;          // event still open
  paused: boolean;
};

export type TimelinePageDay = {
  dateKey: string;            // ISO yyyy-mm-dd in viewer tz
  rows: TimelinePageRow[];
  totalMinutes: number;       // sum of active work minutes for the day
  totalLabel: string;
};

export type TimelinePageModel = {
  title: string;
  clientName: string;
  referrerOrg: string | null;
  viewerTimeZone: string;
  generatedAtUtc: string;
  generatedAtLocal: string;   // formatted for the header line
  totalEvents: number;
  totalMinutes: number;
  totalLabel: string;
  days: TimelinePageDay[];
};

function typeLabel(t: WorkTimelineEventType): string {
  switch (t) {
    case "prereading":     return "Pre-reading";
    case "assessment":     return "Assessment";
    case "reportWriting":  return "Report writing";
    case "admin":          return "Admin";
    case "travel":         return "Travel";
    case "break":          return "Break";
    case "interruption":   return "Interruption";
    case "technicalDelay": return "Technical delay";
    case "note":           return "Note";
    case "custom":         return "Activity";
  }
}

function provenanceLabel(e: WorkTimelineEvent): string {
  const parts: string[] = [];
  if (e.createdAutomatically) parts.push("auto");
  else parts.push("manual");
  if (e.manuallyEdited) parts.push("edited");
  return parts.join(", ");
}

/**
 * Build the page model from a client + viewer timezone. Pure function:
 * no side effects, no React, no DOM. The output is what every renderer
 * (PDF, DOCX, ...) consumes.
 */
export function buildTimelinePageModel(
  client: Client,
  viewerTz: string
): TimelinePageModel {
  const timeline = client.workTimeline ?? [];
  const nowMs = Temporal.Now.instant().epochMilliseconds;
  const generatedAtUtc = Temporal.Now.instant().toString();
  let generatedAtLocal = generatedAtUtc;
  try {
    const z = Temporal.Instant.from(generatedAtUtc).toZonedDateTimeISO(viewerTz);
    const pad = (n: number) => String(n).padStart(2, "0");
    generatedAtLocal = `${z.year}-${pad(z.month)}-${pad(z.day)} ${pad(z.hour)}:${pad(z.minute)}`;
  } catch {
    /* keep raw UTC fallback */
  }

  // Group by viewer-tz date so the printed ledger reads naturally.
  const groups = new Map<string, WorkTimelineEvent[]>();
  for (const e of timeline) {
    try {
      const dateKey = formatDateISO(e.startedAtUtc, viewerTz);
      const list = groups.get(dateKey) ?? [];
      list.push(e);
      groups.set(dateKey, list);
    } catch {
      // Skip events with invalid instants — they shouldn't exist
      // (parseClientBlob filters them) but defensive.
    }
  }

  const days: TimelinePageDay[] = [...groups.keys()]
    .sort()
    .map((dateKey) => {
      const events = (groups.get(dateKey) ?? []).slice().sort((a, b) =>
        a.startedAtUtc.localeCompare(b.startedAtUtc)
      );
      const rows: TimelinePageRow[] = events.map((e) => {
        const startLocal = (() => {
          try { return formatTime24(e.startedAtUtc, viewerTz); }
          catch { return "—"; }
        })();
        const endLocal = e.endedAtUtc
          ? (() => {
              try { return formatTime24(e.endedAtUtc, viewerTz); }
              catch { return "—"; }
            })()
          : "—";
        const workMs = activeWorkMs(e, nowMs);
        return {
          startUtc: e.startedAtUtc,
          startLocal,
          endLocal,
          durationLabel: workMs > 0 ? durationLabel(Math.round(workMs / 60_000)) : "—",
          type: e.type,
          typeLabel: typeLabel(e.type),
          title: e.title,
          description: e.description ?? "",
          provenance: provenanceLabel(e),
          running: e.endedAtUtc === null,
          paused: e.endedAtUtc === null && !!e.pausedAtUtc,
        };
      });
      const totalMinutes = events.reduce(
        (sum, e) => sum + Math.round(activeWorkMs(e, nowMs) / 60_000),
        0
      );
      return {
        dateKey,
        rows,
        totalMinutes,
        totalLabel: durationLabel(totalMinutes),
      };
    });

  const totalMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);

  return {
    title: "Work Timeline",
    clientName: formatFullName(client.identity) || "(unnamed)",
    referrerOrg: client.administrative?.referrer?.org ?? null,
    viewerTimeZone: viewerTz,
    generatedAtUtc,
    generatedAtLocal,
    totalEvents: timeline.length,
    totalMinutes,
    totalLabel: durationLabel(totalMinutes),
    days,
  };
}

/**
 * Slugify a name for filename-safe usage. Lowercase, alphanumerics +
 * hyphens, no slashes. Used by exporters when constructing default
 * filenames.
 */
export function slugifyForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "client";
}
