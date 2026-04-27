/**
 * Global sidebar — high-level navigation only.
 * No routing library; uses callbacks supplied by the parent.
 */

export type SidebarProps = {
  currentView: string;
  setView: (view: string) => void;
};

type Item = { id: string; label: string };

const ITEMS: Item[] = [
  { id: "home",     label: "Home" },
  { id: "client",   label: "Client Profile" },
  { id: "calendar", label: "Calendar" },
  { id: "finance",  label: "Finance" },
  { id: "system",   label: "System" },
];

export default function Sidebar({ currentView, setView }: SidebarProps) {
  return (
    <aside className="w-56 bg-slate-900 text-white flex flex-col">
      <div className="px-4 py-5 border-b border-slate-800">
        <h1 className="text-base font-semibold tracking-tight">medicoapp</h1>
      </div>

      <nav className="flex-1 p-3 space-y-1">
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
              className={
                "w-full text-left px-3 py-2 rounded-md text-sm transition " +
                (active
                  ? "bg-slate-700 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white")
              }
            >
              {it.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
