import React from "react";
import DesktopChrome from "./DesktopChrome";
import DesktopNav from "./DesktopNav";

/**
 * DesktopLayout — Electron-only application frame.
 *
 *   ┌──────┬───────────────────────────────────────────┐
 *   │      │  DesktopChrome (draggable strip, 44px)    │
 *   │ Nav  ├───────────────────────────────────────────┤
 *   │ 80px │                                           │
 *   │      │  Page content (independently scrollable)  │
 *   │      │                                           │
 *   └──────┴───────────────────────────────────────────┘
 *
 * The container is `h-dvh overflow-hidden` so both the rail and the page
 * region are bounded to the viewport. Account navigation gets its own
 * contained scroller; page content scrolls independently. Background and
 * foreground colours read from CSS variables so light/dark flips from the
 * page flow through automatically.
 */
export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground antialiased">
      <DesktopNav />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <DesktopChrome />
        <section data-desktop-content="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background p-6 [scrollbar-width:thin]">
          {children}
        </section>
      </main>
    </div>
  );
}