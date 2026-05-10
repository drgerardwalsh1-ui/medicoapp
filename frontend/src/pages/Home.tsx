import { useState } from "react";
import { formatFullName, type Client } from "../types/client";
import {
  formatTime24,
  getViewerTimeZone,
  isFutureInstant,
  compareInstants,
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

function compareNext(a: Client, b: Client): number {
  const sa = nextAppointmentStart(a);
  const sb = nextAppointmentStart(b);
  if (sa === null && sb === null) return 0;
  if (sa === null) return 1;
  if (sb === null) return -1;
  return compareInstants(sa, sb);
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

  // Sort: clients with upcoming appointments first (soonest first), then the rest.
  const sorted = [...clients].sort(compareNext);

  const nowMs = Temporal.Now.instant().epochMilliseconds;
  const msInDay = 24 * 60 * 60 * 1000;

  function msUntilNext(c: Client): number {
    const iso = nextAppointmentStart(c);
    if (iso === null) return Infinity;
    return Temporal.Instant.from(iso).epochMilliseconds - nowMs;
  }

  const thisWeek = sorted.filter((c) => {
    const t = msUntilNext(c);
    return t !== Infinity && t <= 7 * msInDay;
  });

  const nextWeek = sorted.filter((c) => {
    const t = msUntilNext(c);
    return t !== Infinity && t > 7 * msInDay && t <= 14 * msInDay;
  });

  function handleSelect(id: string) {
    if (!id) return;
    if (id === "NEW") { startCreate(); return; }
    const c = clients.find((cl) => cl.id === id);
    if (c) setActiveClient(c);
  }

  function clientDisplayName(c: Client): string {
    return formatFullName(c.identity) || "Unnamed Client";
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
          {clients.map((c) => (
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

      {/* This week */}
      {thisWeek.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
            This Week
          </h2>
          <div className="space-y-2">
            {thisWeek.map((c) => (
              <ClientRow key={c.id as string} c={c} />
            ))}
          </div>
        </div>
      )}

      {/* Next week */}
      {nextWeek.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Next Week
          </h2>
          <div className="space-y-2">
            {nextWeek.map((c) => (
              <ClientRow key={c.id as string} c={c} />
            ))}
          </div>
        </div>
      )}

      {/* All clients */}
      {clients.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
            All Clients
          </h2>
          <div className="space-y-2">
            {sorted.map((c) => (
              <ClientRow key={c.id as string} c={c} />
            ))}
          </div>
        </div>
      )}

      {clients.length === 0 && (
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
