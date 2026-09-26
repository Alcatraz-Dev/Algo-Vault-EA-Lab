"use client";

import { useMemo } from "react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { AdvancedAnalysisClient } from "@/components/analysis/advanced/AdvancedAnalysisClient";
import { Badge } from "@/components/ui/badge";

export default function AdvancedAnalysisPage() {
    const navGroups: NavGroup[] = useMemo(
        () =>
            APP_NAV.map((group) => ({
                ...group,
                items: group.items.map((item) =>
                    item.href === "/advanced-analysis" ? { ...item, badge: "PRO" } : item
                ),
            })),
        []
    );

    return (
        <AppShell
            navGroups={navGroups}
            title="Advanced Analysis"
            subtitle="Market structure, the multi-timeframe ladder, regime classification and the evidence behind every number — measured from real candles and attributed to the engine that produced it."
            eyebrow={<Badge variant="outline">Pro</Badge>}
            maxWidth="max-w-[1800px]"
        >
            <AdvancedAnalysisClient />
        </AppShell>
    );
}
