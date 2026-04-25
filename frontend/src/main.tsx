import "./index.css"
import { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import Home from "./pages/Home";
import ClientHome from "./pages/ClientHome";
import App from "./App";
import { BASE_TEST_CLIENTS } from "./data/testClients";
import { TauriAPI, isTauri, type ClientViewModel } from "./api/tauriApi";

type Client = any;

// Convert a backend `ClientViewModel` (whose `demographics` holds the full
// nested blob `{demographics, referrer, appointment}`) into the in-memory
// client shape that Home + ClientHome already consume. This is the single
// adapter — every other read in Live mode goes through it.
function viewToClient(v: ClientViewModel): Client {
  const blob: any = v.demographics ?? {};
  const demographics =
    (blob && typeof blob === "object" && (blob as any).demographics) || {};
  const referrer =
    (blob && typeof blob === "object" && (blob as any).referrer) || {};
  const appointment =
    (blob && typeof blob === "object" && (blob as any).appointment) || {};
  return {
    id: v.id,
    name:
      v.name ||
      `${(demographics.forename || "").toString().trim()} ${(demographics.surname || "").toString().trim()}`.trim() ||
      "Unnamed Client",
    demographics,
    referrer,
    appointment,
    documents: v.documents ?? [],
    report: {},
  };
}

function Root() {
  const [mode, setMode] = useState<"test" | "live">("test");
  const [clients, setClients] = useState<Client[]>(
    JSON.parse(JSON.stringify(BASE_TEST_CLIENTS))
  );

  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [view, setView] = useState<"home" | "client" | "app" | "create">("home");

  // Source of truth per mode:
  //   test → BASE_TEST_CLIENTS (in-memory fixtures)
  //   live → projection.db via TauriAPI.listClients (SQLite)
  //          (localStorage retained only as a browser-mode fallback)
  async function refreshFromProjection() {
    try {
      const views = await TauriAPI.listClients();
      setClients(views.map(viewToClient));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[main] listClients failed, keeping current state:", err);
    }
  }

  useEffect(() => {
    if (mode === "test") {
      setClients(JSON.parse(JSON.stringify(BASE_TEST_CLIENTS)));
      return;
    }
    if (isTauri) {
      refreshFromProjection();
    } else {
      const saved = localStorage.getItem("clients");
      setClients(saved ? JSON.parse(saved) : []);
    }
  }, [mode]);

  useEffect(() => {
    // localStorage is now only a no-Tauri convenience cache. In Live mode
    // under Tauri the projection is canonical.
    if (mode === "live" && !isTauri) {
      localStorage.setItem("clients", JSON.stringify(clients));
    }
  }, [clients, mode]);

  // Re-pull from the projection whenever the user returns to Home so any
  // edits made in ClientHome show up in the dropdown immediately.
  useEffect(() => {
    if (mode === "live" && isTauri && view === "home") {
      refreshFromProjection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode]);

  // Compute a display name from whichever shape the demographics blob
  // happens to be in (flat or nested under `demographics`). Mirrors the
  // fallback the backend projection applies on hydration.
  function deriveName(c: any): string {
    const explicit = (c?.name || "").toString().trim();
    if (explicit) return explicit;
    const blob = c?.demographics || {};
    const flatF = (blob.forename || "").toString().trim();
    const flatS = (blob.surname || "").toString().trim();
    if (flatF || flatS) return `${flatF} ${flatS}`.trim();
    const nested = blob.demographics || {};
    const nF = (nested.forename || "").toString().trim();
    const nS = (nested.surname || "").toString().trim();
    if (nF || nS) return `${nF} ${nS}`.trim();
    return "Unnamed Client";
  }

  // Upsert: ClientHome calls `onSave(updated)` with the canonical id
  // (the backend UUIDv7 once a projection record exists). We store that
  // verbatim so the Home dropdown and subsequent `getClientView` lookups
  // find the same row that backend SQL holds.
  function handleClientSave(updated: Client) {
    const merged = { ...updated, name: deriveName(updated) };
    setClients(prev => {
      const exists = prev.some(c => c.id === merged.id);
      return exists
        ? prev.map(c => (c.id === merged.id ? merged : c))
        : [...prev, merged];
    });
    setActiveClient(merged);
  }


  if (view === "home") {
    return (
      <Home
        clients={clients}
        setActiveClient={(c: Client) => {
          setActiveClient(c);
          setView("client");
        }}
        startCreate={() => setView("create")}
        mode={mode}
        setMode={setMode}
      />
    );
  }

  if (view === "create") {
    return (
      <ClientHome
        client={null}
        isNew={true}
        onSave={handleClientSave}
        onCancel={() => setView("home")}
        mode={mode}
      />
    );
  }

  if (view === "client" && activeClient) {
    return (
      <ClientHome
        client={activeClient}
        isNew={false}
        onSave={handleClientSave}
        onCancel={() => setView("home")}
        openReport={() => setView("app")}
        mode={mode}
      />
    );
  }

  return (
    <App
      client={activeClient}
      goHome={() => setView("client")}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);