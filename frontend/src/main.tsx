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
  formatFullName,
  parseClientBlob,
  type Client,
  type Appointment,
} from "./types/client";

type View = "home" | "client" | "app" | "create" | "calendar" | "finance" | "system";

function viewToClient(v: ClientViewModel): Client {
  return parseClientBlob(v.id, v.demographics);
}

function Root() {
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [view, setView] = useState<View>("home");
  const [reportSectionIndex, setReportSectionIndex] = useState(0);

  const saveHandlerRef = useRef<(() => void) | null>(null);
  const registerSaveHandler = (fn: (() => void) | null) => {
    saveHandlerRef.current = fn;
  };

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

  useEffect(() => {
    if (isTauri) refreshFromProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isTauri && (view === "home" || view === "calendar")) refreshFromProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function handleClientSave(updated: Client) {
    setClients((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      return exists
        ? prev.map((c) => (c.id === updated.id ? updated : c))
        : [...prev, updated];
    });
    setActiveClient(updated);
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
          key={activeClient.id}
          client={activeClient}
          isNew={false}
          onSave={handleClientSave}
          onCancel={() => setView("home")}
          openReport={(sectionIndex?: number) => {
            setReportSectionIndex(sectionIndex ?? 0);
            setView("app");
          }}
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
          initialSectionIndex={reportSectionIndex}
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
        title: formatFullName(activeClient?.identity) || "Client Profile",
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
