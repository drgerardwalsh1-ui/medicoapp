/**
 * Layout wrapper that puts a global Sidebar on the left and a contextual
 * TopBar above the page content. It WRAPS the existing pages — they keep
 * their own internal layouts and headers.
 */

import Sidebar from "./Sidebar";
import TopBar, { type TopBarProps } from "./TopBar";

export type AppLayoutProps = {
  currentView: string;
  setView: (view: string) => void;
  topBarProps: TopBarProps;
  children: React.ReactNode;
};

export default function AppLayout({
  currentView,
  setView,
  topBarProps,
  children,
}: AppLayoutProps) {
  return (
    <div className="flex h-screen">
      <Sidebar currentView={currentView} setView={setView} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar {...topBarProps} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
