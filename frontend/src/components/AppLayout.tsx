/**
 * Layout wrapper that puts a global Sidebar on the left and a contextual
 * TopBar above the page content. Owns ONLY the truly application-wide
 * chrome: sidebar, top bar, and the appointment-overrun alert.
 *
 * The TimerBar lives in ClientLayout, NOT here — timers are client-scoped
 * lifecycle state. Mounting the TimerBar at the AppLayout level would
 * imply the timer outlives the client context (it doesn't, per the
 * exclusive-context invariant in main.tsx#switchActiveClient).
 */

import Sidebar from "./Sidebar";
import TopBar, { type TopBarProps } from "./TopBar";
import {
  useViewerTimeZone,
  useAppointmentAlerts,
  alertMessage,
  type Appointment,
} from "../time";
import { useScrollRestoration } from "../hooks/useScrollRestoration";

export type AppLayoutProps = {
  currentView: string;
  setView: (view: string) => void;
  topBarProps: TopBarProps;
  children: React.ReactNode;
  upcomingAppointments?: Appointment[];
  /**
   * Stable key identifying the current scrollable view. When the user
   * navigates away and back, the scroll position previously seen under
   * this key is restored. Typically `app:<view>`.
   */
  scrollKey?: string;
};

export default function AppLayout({
  currentView,
  setView,
  topBarProps,
  children,
  upcomingAppointments,
  scrollKey,
}: AppLayoutProps) {
  // Spec Part 6: viewer-tz is dynamically derived; this hook subscribes once
  // at the layout level and pushes changes into the module-level getter.
  const viewerTz = useViewerTimeZone();
  const alert = useAppointmentAlerts(upcomingAppointments ?? []);
  const scrollRef = useScrollRestoration<HTMLElement>(scrollKey);

  return (
    <div className="flex h-screen">
      <Sidebar currentView={currentView} setView={setView} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar {...topBarProps} />
        {alert && (
          <div
            role="status"
            className={[
              "alert-bar px-4 py-2 text-sm border-b shrink-0",
              alert.kind === "overrun"
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : alert.kind === "pre5"
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-violet-50 border-violet-200 text-violet-800",
            ].join(" ")}
          >
            {alertMessage(alert, viewerTz)}
          </div>
        )}
        <main ref={scrollRef} className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
