import "./index.css";
import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import Home from "./pages/Home";
import ClientHome from "./pages/ClientHome";
import App from "./App";
import CalendarView from "./calendar/CalendarView";
import SystemPage from "./pages/SystemPage";
import { TauriAPI, isTauri, type ClientViewModel } from "./api/tauriApi";
import AppLayout from "./components/AppLayout";
import type { TopBarProps } from "./components/TopBar";
import {
  buildClientName,
  mergeBlob,
  type Appointment,
} from "./types/client";

type Client = Record<string, unknown>;
type View = "home" | "client" | "app" | "create" | "calendar" | "finance" | "system";

// Adapt a ClientViewModel from the projection into the in-memory client shape.
function viewToClient(v: ClientViewModel): Client {
  const blob = mergeBlob(v.demographics);
  return {
    id: v.id,
    name: v.name || buildClientName(blob.demographics) || "Unnamed Client",
    ...blob,
    documents: v.documents ?? [],
  };
}

function Root() {
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [view, setView] = useState<View>("home");

  // Bridge from the global TopBar Save button to ClientHome's handleSave.
  const saveHandlerRef = useRef<(() => void) | null>(null);
  const registerSaveHandler = (fn: (() => void) | null) => {
    saveHandlerRef.current = fn;
  };

  // Bridge from TopBar Version History button.
  const vhHandlerRef = useRef<(() => void) | null>(null);
  const registerVersionHistoryHandler = (fn: (() => void) | null) => {
    vhHandlerRef.current = fn;
  };

  async function refreshFromProjection() {
    try {
      const views = await TauriAPI.listClients();
      setClients(views.map(viewToClient));
    } catch (err) {
      console.warn("[main] listClients failed, keeping current state:", err);
    }
  }

  // Initial load.
  useEffect(() => {
    if (isTauri) refreshFromProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh projection when navigating to Home or Calendar.
  useEffect(() => {
    if (isTauri && (view === "home" || view === "calendar")) refreshFromProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function handleClientSave(updated: Client) {
    const blob = mergeBlob(updated);
    const name =
      (updated.name as string) ||
      buildClientName(blob.demographics) ||
      "Unnamed Client";
    const merged: Client = { ...updated, name };
    setClients((prev) => {
      const exists = prev.some((c) => c.id === merged.id);
      return exists
        ? prev.map((c) => (c.id === merged.id ? merged : c))
        : [...prev, merged];
    });
    setActiveClient(merged);
  }

  function handleReset() {
    setClients([]);
    setActiveClient(null);
    setView("home");
  }

  function navigate(target: string) {
    if (target === "client") {
      setView(activeClient ? "client" : "home");
      return;
    }
    if (
      target === "home" ||
      target === "calendar" ||
      target === "finance" ||
      target === "system"
    ) {
      setView(target as View);
    }
  }

  function pageContent() {
    if (view === "home") {
      return (
        <Home
          clients={clients}
          setActiveClient={(c: Client) => {
            setActiveClient(c);
            setView("client");
          }}
          startCreate={() => setView("create")}
        />
      );
    }
    if (view === "create") {
      return (
        <ClientHome
          key="new"
          client={null}
          isNew={true}
          onSave={handleClientSave}
          onCancel={() => setView("home")}
          registerSaveHandler={registerSaveHandler}
          registerVersionHistoryHandler={registerVersionHistoryHandler}
        />
      );
    }
    if (view === "client") {
      if (!activeClient) {
        return (
          <div className="p-8 text-slate-600">
            Select a client from{" "}
            <button className="underline" onClick={() => setView("home")}>
              Home
            </button>
            .
          </div>
        );
      }
      return (
        <ClientHome
          key={activeClient.id as string}
          client={activeClient}
          isNew={false}
          onSave={handleClientSave}
          onCancel={() => setView("home")}
          openReport={() => setView("app")}
          registerSaveHandler={registerSaveHandler}
          registerVersionHistoryHandler={registerVersionHistoryHandler}
        />
      );
    }
    if (view === "calendar") {
      return (
        <CalendarView
          clients={clients}
          onNavigate={(clientId: string) => {
            const found = clients.find((c) => c.id === clientId);
            if (found) {
              setActiveClient(found);
              setView("client");
            }
          }}
          onUpdateClient={(updated: Client) => {
            const appointments = updated.appointments as Appointment[];
            handleClientSave({ ...updated, appointments });
          }}
        />
      );
    }
    if (view === "finance") {
      return (
        <div className="p-8 text-slate-600">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Finance</h2>
          <p className="text-sm">Coming soon.</p>
        </div>
      );
    }
    if (view === "system") {
      return <SystemPage onReset={handleReset} />;
    }
    if (view === "app") {
      return (
        <App
          client={activeClient}
          goHome={() => setView("client")}
          onSave={handleClientSave}
        />
      );
    }
    return null;
  }

  function topBarProps(): TopBarProps {
    if (view === "home") return { title: "Home" };
    if (view === "create") {
      return {
        title: "New Client",
        onBack: () => setView("home"),
        showSave: true,
        onSave: () => saveHandlerRef.current?.(),
      };
    }
    if (view === "client") {
      return {
        title: (activeClient?.name as string) || "Client Profile",
        onBack: () => setView("home"),
        showSave: !!activeClient,
        onSave: () => saveHandlerRef.current?.(),
        showVersionHistory: !!activeClient,
        onShowVersionHistory: () => vhHandlerRef.current?.(),
      };
    }
    if (view === "calendar") return { title: "Calendar" };
    if (view === "finance") return { title: "Finance" };
    if (view === "system")  return { title: "System" };
    if (view === "app") {
      return {
        title: "Report Builder",
        onBack: () => setView(activeClient ? "client" : "home"),
      };
    }
    return { title: "" };
  }

  return (
    <AppLayout currentView={view} setView={navigate} topBarProps={topBarProps()}>
      {pageContent()}
    </AppLayout>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);
