import { useMemo } from "react";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import {
  PIC_SCHEMA,
  MOTOR_SCHEMA,
  HPL_OVERLAY,
  MEDILAW_OVERLAY,
  applyOverlay,
} from "../schemas/reportSchema";
import type { ReportSchema } from "../schemas/reportSchema";
import type { Client } from "../types/client";
import VersionHistoryModal from "./VersionHistoryModal";
import { TimerBar, type TimerBarProps } from "../time";

// Spec Part 9–13, Part 22. The single owner of client-area chrome.
// Sits between AppLayout (sidebar/topbar/timer/alert) and the per-tab body.
// Renders ONLY:
//   - the client tabs row
//   - the (single) version history modal
// Body content is supplied via `children` so each page is body-only.

export type ClientTabId =
  | "demographics"
  | "dsm"
  | "timeline"
  | string; // schema section ids — narrowed by clientTabs()

export type ClientTab = {
  id: ClientTabId;
  label: string;
  disabledForNewClient: boolean;
};

// Derive the schema from the client's referrer org. Mirrors the logic that
// previously lived inline in App.tsx:212-220 — extracted so ClientLayout
// (the new tab owner) and any consumer can share it without duplication.
export function deriveSchema(client: Client | null): ReportSchema {
  const org = (client?.administrative?.referrer?.org ?? "") as string;
  const base = org === "PIC Motor" ? MOTOR_SCHEMA : PIC_SCHEMA;
  let overlay: { title: string } | null = null;
  if (org === "HPL") overlay = HPL_OVERLAY;
  if (org === "Medilaw") overlay = MEDILAW_OVERLAY;
  return overlay ? applyOverlay(base, overlay) : base;
}

// Tab order:
//   Demographics → History of Injury → Background History → Current Symptoms →
//   DSM Assessment → PIRS Assessment → Opinion → Work Timeline
// History of Injury is the schema-driven "history" section (free-text narrative
// of mechanism / event). Background History is the structured clinical-entity
// editor — its tab id is "backgroundHistory" to avoid collision with the
// schema section id (the previous "history" id collided and lit both tabs
// simultaneously).
export function clientTabs(client: Client | null): ClientTab[] {
  const schema = deriveSchema(client);
  const schemaTabs = schema.sections.map((s) => ({
    id: s.id as ClientTabId,
    label: s.title,
    disabledForNewClient: true,
  }));

  const historyIdx = schemaTabs.findIndex((t) => t.id === "history");
  const symptomsIdx = schemaTabs.findIndex((t) => t.id === "symptoms");

  const backgroundHistoryTab: ClientTab = {
    id: "backgroundHistory",
    label: "Background History",
    disabledForNewClient: true,
  };
  const dsmTab: ClientTab = { id: "dsm", label: "DSM Assessment", disabledForNewClient: true };
  const mseTab: ClientTab = { id: "mse", label: "MSE", disabledForNewClient: true };
  // Live Assessment — the keyboard-first interview workspace (PRD Phase 2).
  // Sits directly after Demographics: it is the hub during the interview;
  // section tabs remain the structured review/editing surfaces.
  const liveTab: ClientTab = { id: "live", label: "Live Assessment", disabledForNewClient: true };

  // Splice schema tabs around our inserted tabs:
  //   [..before history+1] (= Demographics through "History of Injury")
  //   → Background History
  //   → [..through symptoms]
  //   → DSM
  //   → MSE
  //   → [remaining schema (pirs, opinion, …)]
  //   → Work Timeline
  const beforeBackground = historyIdx >= 0 ? schemaTabs.slice(0, historyIdx + 1) : schemaTabs;
  const betweenBackgroundAndDsm =
    historyIdx >= 0 && symptomsIdx >= 0
      ? schemaTabs.slice(historyIdx + 1, symptomsIdx + 1)
      : [];
  const afterDsm = symptomsIdx >= 0 ? schemaTabs.slice(symptomsIdx + 1) : [];

  return [
    { id: "demographics", label: "Demographics", disabledForNewClient: false },
    liveTab,
    ...beforeBackground,
    backgroundHistoryTab,
    ...betweenBackgroundAndDsm,
    dsmTab,
    mseTab,
    ...afterDsm,
    { id: "timeline", label: "Work Timeline", disabledForNewClient: true },
  ];
}

export type ClientLayoutProps = {
  client: Client | null;
  isNew: boolean;
  activeTab: ClientTabId;
  onTabChange: (tab: ClientTabId) => void;
  versionHistoryOpen: boolean;
  onVersionHistoryClose: () => void;
  onClientRestored?: () => void;
  /**
   * Timer props — TimerBar lives here (NOT in AppLayout) because
   * timers are client-scoped lifecycle state. The bar is only mounted
   * when a client (real or draft) is active; navigating to Home or
   * Calendar unmounts both the client and the bar. The exclusive-
   * context invariant in main.tsx#switchActiveClient guarantees no
   * timer can outlive a change of activeClient.
   */
  timerProps: TimerBarProps;
  /**
   * Stable key identifying the current client+tab scrollable view.
   * When the user switches tabs or clients and comes back, the scroll
   * position previously seen under this key is restored. Typically
   * `client:<clientId>:<tabId>` or `client:new:<draftId>:demographics`.
   */
  scrollKey?: string;
  children: React.ReactNode;
};

export default function ClientLayout({
  client,
  isNew,
  activeTab,
  onTabChange,
  versionHistoryOpen,
  onVersionHistoryClose,
  onClientRestored,
  timerProps,
  scrollKey,
  children,
}: ClientLayoutProps) {
  const tabs = useMemo(() => clientTabs(client), [client?.administrative?.referrer?.org]);
  const scrollRef = useScrollRestoration<HTMLDivElement>(scrollKey);

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* TimerBar — client-scoped chrome. Mounted here (not in
          AppLayout) so the timer UI is visible only inside a client
          context; navigation away from the client unmounts it. */}
      <TimerBar {...timerProps} />

      {/* Tabs row — the only OTHER client-specific chrome row.
          Identity, save, and version history live in TopBar
          (AppLayout) so every tab gets the identical upper structure
          (spec Part 11, Part 22). */}
      <div
        className="client-tabs sticky top-0 z-10 bg-white border-b border-slate-200 px-4 flex gap-0.5 items-end h-9 shrink-0"
        data-testid="client-tabs"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const disabled = isNew && tab.disabledForNewClient;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={disabled ? undefined : () => onTabChange(tab.id)}
              disabled={disabled}
              aria-current={isActive ? "page" : undefined}
              className={[
                "px-3 h-8 text-xs font-medium rounded-t border-t border-x transition select-none",
                isActive
                  ? "bg-slate-100 border-slate-200 text-violet-700"
                  : "border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50",
                disabled ? "opacity-40 cursor-not-allowed hover:text-slate-400 hover:bg-transparent" : "",
              ].join(" ")}
              title={disabled ? "Save the new client first" : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Body — page-specific content. Pages NEVER render their own back
          button, save, or tab pills; that's a centralization invariant
          (spec Part 13, Part 22). */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>

      <VersionHistoryModal
        open={versionHistoryOpen}
        client={client}
        onClose={onVersionHistoryClose}
        onRestored={onClientRestored}
      />
    </div>
  );
}
