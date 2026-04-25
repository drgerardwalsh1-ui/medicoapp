import { useState } from "react";

export default function Home({
  clients,
  setActiveClient,
  startCreate,
  mode,
  setMode
}: any) {

  const [selectedId, setSelectedId] = useState("");

  const now = new Date();

  function weekDiff(dateStr: string) {
    if (!dateStr) return 999;
    const d = new Date(dateStr);
    return Math.ceil((d.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000));
  }

  const upcoming = clients
    .filter((c: any) => weekDiff(c?.appointment?.date) <= 1)
    .sort((a: any, b: any) =>
      new Date(a?.appointment?.date || 0).getTime() -
      new Date(b?.appointment?.date || 0).getTime()
    );

  const nextWeek = clients
    .filter((c: any) => weekDiff(c?.appointment?.date) === 2)
    .sort((a: any, b: any) =>
      new Date(a?.appointment?.date || 0).getTime() -
      new Date(b?.appointment?.date || 0).getTime()
    );

  function handleSelect(id: string) {
    if (!id) return;

    if (id === "NEW") {
      startCreate();
      return;
    }

    const client = clients.find((c: any) => c.id === id);
    if (client) setActiveClient(client);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">

      <h1 className="text-xl font-bold mb-4">
        Medico-Legal System
      </h1>

      {/* MODE */}
      <div className="mb-4">
        <label className="mr-2">Mode:</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="border p-1"
        >
          <option value="test">Test</option>
          <option value="live">Live</option>
        </select>
      </div>

      {/* DROPDOWN (RESTORED) */}
      <div className="mb-6">
        <select
          className="w-full border p-2"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            handleSelect(e.target.value);
          }}
        >
          <option value="">-- Select Client --</option>

          {clients.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name || `${c.demographics?.forename || ""} ${c.demographics?.surname || ""}`.trim() || "Unnamed Client"}
            </option>
          ))}

          <option value="NEW">+ Create New Client</option>
        </select>
      </div>

      {/* GROUPED LIST */}
      <h2 className="font-bold">This Week</h2>
      {upcoming.map((c: any) => (
        <div
          key={c.id}
          className="p-2 border cursor-pointer"
          onClick={() => setActiveClient(c)}
        >
          {c.name || `${c.demographics?.forename || ""} ${c.demographics?.surname || ""}`.trim() || "Unnamed Client"} — {c?.appointment?.date}
        </div>
      ))}

      <h2 className="font-bold mt-4">Next Week</h2>
      {nextWeek.map((c: any) => (
        <div
          key={c.id}
          className="p-2 border cursor-pointer"
          onClick={() => setActiveClient(c)}
        >
          {c.name || `${c.demographics?.forename || ""} ${c.demographics?.surname || ""}`.trim() || "Unnamed Client"} — {c?.appointment?.date}
        </div>
      ))}

    </div>
  );
}