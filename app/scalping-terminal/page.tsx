"use client";

import { useMemo } from "react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { ScalpingTerminalClient } from "@/components/scalping/ScalpingTerminalClient";
import { Badge } from "@/components/ui/badge";

export default function ScalpingTerminalPage() {
    const navGroups: NavGroup[] = useMemo(
        () =>
            APP_NAV.map((group) => ({
                ...group,
                items: group.items.map((item) =>
                    item.href === "/scalping-terminal" ? { ...item, badge: "PRO" } : item
                ),
            })),
        []
    );

    return (
        <AppShell
            navGroups={navGroups}
            title="AI Scalping Terminal"
            subtitle="Live market radar, deterministic trade intelligence and a full audit trail of the agent pipeline. Every measurement names the engine that produced it."
            eyebrow={<Badge variant="outline">Pro</Badge>}
            maxWidth="max-w-[1800px]"
        >
            <ScalpingTerminalClient />
        </AppShell>
    );
}
