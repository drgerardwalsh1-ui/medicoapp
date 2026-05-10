/**
 * Layout wrapper that puts a global Sidebar on the left and a contextual
 * TopBar above the page content. It WRAPS the existing pages — they keep
 * their own internal layouts and headers.
 *
 * Also: subscribes to the viewer's IANA timezone (spec Part 6) and renders
 * the global appointment-overrun banner above the main content (spec Part
 * 11). The banner is non-blocking — never modal — and clears when the
 * imminent-appointment window passes.
 */

import Sidebar from "./Sidebar";
import TopBar, { type TopBarProps } from "./TopBar";
import {
  useViewerTimeZone,
  useAppointmentAlerts,
  alertMessage,
  TimerBar,
  type Appointment,
} from "../time";

export type AppLayoutProps = {
  currentView: string;
  setView: (view: string) => void;
  topBarProps: TopBarProps;
  children: React.ReactNode;
  upcomingAppointments?: Appointment[];
};

export default function AppLayout({
  currentView,
  setView,
  topBarProps,
  children,
  upcomingAppointments,
}: AppLayoutProps) {
  // Spec Part 6: viewer-tz is dynamically derived; this hook subscribes once
  // at the layout level and pushes changes into the module-level getter.
  const viewerTz = useViewerTimeZone();
  const alert = useAppointmentAlerts(upcomingAppointments ?? []);

  return (
    <div className="flex h-screen">
      <Sidebar currentView={currentView} setView={setView} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar {...topBarProps} />
        <TimerBar />
        {alert && (
          <div
            role="status"
            className={[
              "px-4 py-2 text-sm border-b shrink-0",
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
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
