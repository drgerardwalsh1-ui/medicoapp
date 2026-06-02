import { useState } from "react";
import { formatFullName, type Client } from "../types/client";
import { validateClientName } from "../types/clientValidation";
import {
  formatTime24,
  getViewerTimeZone,
  isFutureInstant,
  compareInstants,
  viewerWeekStartDate,
  viewerPlainDate,
  addDaysToPlainDate,
} from "../time";
import { Temporal } from "@js-temporal/polyfill";

function nextAppointmentStart(client: Client): string | null {
  const appts = client.appointments;
  if (!Array.isArray(appts) || appts.length === 0) return null;
  const upcoming = appts
    .filter((a) => isFutureInstant(a.startUtc))
    .map((a) => a.startUtc)
    .sort(compareInstants);
  return upcoming[0] ?? null;
}

const SHORT_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatAppointmentDate(isoStart: string): string {
  try {
    const tz = getViewerTimeZone();
    const z = Temporal.Instant.from(isoStart).toZonedDateTimeISO(tz);
    const weekday = SHORT_WEEKDAYS[z.dayOfWeek - 1];
    const month = SHORT_MONTHS[z.month - 1];
    return `${weekday} ${z.day} ${month} ${formatTime24(isoStart, tz)}`;
  } catch {
    return isoStart;
  }
}

function nextAppointmentISO(client: Client): string | null {
  return nextAppointmentStart(client);
}

export default function Home({
  clients,
  setActiveClient,
  startCreate,
}: {
  clients: Client[];
  setActiveClient: (c: Client) => void;
  startCreate: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");

  // STRICT: a persisted client list must never render an entry without a
  // valid name. After the save-gate no NEW nameless client can exist;
  // this filter additionally suppresses any legacy phantom rows so
  // "Unnamed Client" can never appear in the quick-select or week lists.
  // (The rows still exist in the DB and remain recoverable via the
  // System page — they are only hidden from these persisted lists.)
  const namedClients = clients.filter((c) => validateClientName(c.identity).ok);

  const tz = getViewerTimeZone();
  const thisWeekStart = viewerWeekStartDate(
    Temporal.Now.instant().toString(),
    tz,
  );

  // Returns the earliest appointment start (ISO) for `c` within the
  // Monday-Sunday week at `offset` (-1, 0, 1) relative to the viewer's current
  // week, or null if none.
  function earliestInWeekOffset(c: Client, offset: number): string | null {
    const weekStart = addDaysToPlainDate(thisWeekStart, offset * 7);
    const weekEndExclusive = addDaysToPlainDate(weekStart, 7);
    const appts = c.appointments;
    if (!Array.isArray(appts) || appts.length === 0) return null;
    const inWeek = appts
      .filter((a) => {
        const d = viewerPlainDate(a.startUtc, tz);
        return d >= weekStart && d < weekEndExclusive;
      })
      .map((a) => a.startUtc)
      .sort(compareInstants);
    return inWeek[0] ?? null;
  }

  function clientsForWeekOffset(offset: number): Client[] {
    return namedClients
      .map((c) => ({ c, start: earliestInWeekOffset(c, offset) }))
      .filter((x): x is { c: Client; start: string } => x.start !== null)
      .sort((a, b) => compareInstants(a.start, b.start))
      .map((x) => x.c);
  }

  const lastWeekClients = clientsForWeekOffset(-1);
  const thisWeekClients = clientsForWeekOffset(0);
  const nextWeekClients = clientsForWeekOffset(1);

  function handleSelect(id: string) {
    if (!id) return;
    if (id === "NEW") { startCreate(); return; }
    const c = namedClients.find((cl) => cl.id === id);
    if (c) setActiveClient(c);
  }

  // namedClients guarantees a non-empty name, so formatFullName never
  // returns "". The fallback below is defensive only and deliberately
  // NOT the phantom "Unnamed Client" string.
  function clientDisplayName(c: Client): string {
    return formatFullName(c.identity) || "Client";
  }

  function ClientRow({ c }: { c: Client }) {
    const next = nextAppointmentISO(c);
    return (
      <div
        className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition"
        onClick={() => setActiveClient(c)}
      >
        <span className="text-sm font-medium text-slate-800">
          {clientDisplayName(c)}
        </span>
        {next && (
          <span className="text-xs text-slate-500">
            {formatAppointmentDate(next)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-6 text-slate-900">
        Medicolegal Assessment System
      </h1>

      {/* Quick select */}
      <div className="mb-6">
        <select
          className="w-full border border-slate-300 rounded-lg p-2 text-sm text-slate-700"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            handleSelect(e.target.value);
          }}
        >
          <option value="">— Select Client —</option>
          {namedClients.map((c) => (
            <option key={c.id as string} value={c.id as string}>
              {clientDisplayName(c)}
            </option>
          ))}
          <option value="NEW">+ Create New Client</option>
        </select>
      </div>

      {/* Create button */}
      <div className="mb-6">
        <button
          onClick={startCreate}
          className="btn-primary"
        >
          + New Client
        </button>
      </div>

      {/* Last week */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Last Week
        </h2>
        {lastWeekClients.length > 0 ? (
          <div className="space-y-2">
            {lastWeekClients.map((c) => (
              <ClientRow key={c.id as string} c={c} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No appointments last week</p>
        )}
      </div>

      {/* This week */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
          This Week
        </h2>
        {thisWeekClients.length > 0 ? (
          <div className="space-y-2">
            {thisWeekClients.map((c) => (
              <ClientRow key={c.id as string} c={c} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No appointments this week</p>
        )}
      </div>

      {/* Next week */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Next Week
        </h2>
        {nextWeekClients.length > 0 ? (
          <div className="space-y-2">
            {nextWeekClients.map((c) => (
              <ClientRow key={c.id as string} c={c} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No appointments next week</p>
        )}
      </div>

      {namedClients.length === 0 && (
        <div className="text-center text-slate-400 py-12">
          <p className="text-sm">No clients yet.</p>
          <p className="text-xs mt-1">
            Click <strong>+ New Client</strong> to get started.
          </p>
        </div>
      )}
    </div>
  );
}
