"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";

/**
 * AppSidebarLayout — canonical wrapper for route families that used to render
 * bare (tools, alerts, signals, …) so every non-marketing page carries the
 * same sidebar, density and badges as the /account pages.
 *
 * Usage: a `layout.tsx` in the route folder returns this wrapper.
 */
export default function AppSidebarLayout({ children }: { children: ReactNode }) {
    return (
        <AppShell navGroups={APP_NAV} padding={false}>
            {/*
             * Pages in these families were written as standalone full-viewport
             * screens (`min-h-screen` roots). Inside the shell the topbar eats
             * 3.5rem, so keep their vertical centring but subtract it — otherwise
             * every wrapped page scrolls an extra 56px.
             */}
            <div className="[&>.min-h-screen]:min-h-[calc(100vh-3.5rem)]">{children}</div>
        </AppShell>
    );
}
