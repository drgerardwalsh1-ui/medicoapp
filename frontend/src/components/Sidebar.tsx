/**
 * Global sidebar — high-level navigation only.
 * No routing library; uses callbacks supplied by the parent.
 *
 * Collapsible drawer: collapsed by default (narrow icon-only strip), toggled
 * via the header button. Collapse state is persisted to localStorage so it
 * survives the session, matching the existing `medico.*` flag convention.
 */

import { useEffect, useState, type ReactNode } from "react";

export type SidebarProps = {
  currentView: string;
  setView: (view: string) => void;
};

const STORAGE_KEY = "medico.sidebarCollapsed";

/** Shared 24×24 outline-icon wrapper (Tailwind-sized, currentColor stroke). */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type Item = { id: string; label: string; icon: ReactNode };

const ITEMS: Item[] = [
  {
    id: "home",
    label: "Home",
    icon: (
      <Svg>
        <path d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.5a.75.75 0 00.75.75h3.75v-6a.75.75 0 01.75-.75h3a.75.75 0 01.75.75v6h3.75a.75.75 0 00.75-.75V9.75" />
      </Svg>
    ),
  },
  {
    id: "client",
    label: "Client Profile",
    icon: (
      <Svg>
        <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </Svg>
    ),
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: (
      <Svg>
        <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0V11.25A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </Svg>
    ),
  },
  {
    id: "finance",
    label: "Finance",
    icon: (
      <Svg>
        <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </Svg>
    ),
  },
  {
    id: "system",
    label: "System",
    icon: (
      <Svg>
        <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.077-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </Svg>
    ),
  },
];

export default function Sidebar({ currentView, setView }: SidebarProps) {
  // Collapsed by default: when no preference is stored we start collapsed.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* localStorage unavailable — keep in-memory state only */
    }
  }, [collapsed]);

  return (
    <aside
      className={
        "bg-slate-900 text-white flex flex-col shrink-0 transition-[width] duration-200 ease-in-out " +
        (collapsed ? "w-14" : "w-56")
      }
    >
      <div className="flex items-center gap-2 px-3 py-4 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid place-items-center h-8 w-8 shrink-0 rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          <Svg>
            <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </Svg>
        </button>
        {!collapsed && (
          <h1 className="truncate text-base font-semibold tracking-tight">medicoapp</h1>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {ITEMS.map((it) => {
          const active =
            it.id === currentView ||
            // "Client Profile" lights up for any client-scoped view
            (it.id === "client" &&
              (currentView === "create" || currentView === "app"));
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setView(it.id)}
              aria-label={it.label}
              aria-current={active ? "page" : undefined}
              title={collapsed ? it.label : undefined}
              className={
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition " +
                (collapsed ? "justify-center " : "") +
                (active
                  ? "bg-slate-700 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white")
              }
            >
              {it.icon}
              {!collapsed && <span className="truncate">{it.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
