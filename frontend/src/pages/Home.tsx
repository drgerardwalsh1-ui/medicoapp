import { useState } from "react";

type Client = Record<string, unknown>;

function nextAppointmentStart(client: Client): number {
  const appts = client.appointments as Array<{ start: string }> | undefined;
  if (!Array.isArray(appts) || appts.length === 0) return Infinity;
  const now = Date.now();
  const upcoming = appts
    .map((a) => new Date(a.start).getTime())
    .filter((t) => t >= now)
    .sort((a, b) => a - b);
  return upcoming[0] ?? Infinity;
}

function formatAppointmentDate(isoStart: string): string {
  try {
    return new Date(isoStart).toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoStart;
  }
}

function nextAppointmentISO(client: Client): string | null {
  const appts = client.appointments as Array<{ start: string }> | undefined;
  if (!Array.isArray(appts) || appts.length === 0) return null;
  const now = Date.now();
  const upcoming = appts
    .filter((a) => new Date(a.start).getTime() >= now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return upcoming[0]?.start ?? null;
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
  const sorted = [...clients].sort(
    (a, b) => nextAppointmentStart(a) - nextAppointmentStart(b)
  );

  const now = Date.now();
  const msInDay = 24 * 60 * 60 * 1000;

  const thisWeek = sorted.filter((c) => {
    const t = nextAppointmentStart(c);
    return t !== Infinity && t - now <= 7 * msInDay;
  });

  const nextWeek = sorted.filter((c) => {
    const t = nextAppointmentStart(c);
    return t !== Infinity && t - now > 7 * msInDay && t - now <= 14 * msInDay;
  });

  function handleSelect(id: string) {
    if (!id) return;
    if (id === "NEW") { startCreate(); return; }
    const c = clients.find((cl) => cl.id === id);
    if (c) setActiveClient(c);
  }

  function clientDisplayName(c: Client): string {
    return (c.name as string) || "Unnamed Client";
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
