"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import {
    AITeamsWorkspace,
    INITIAL_HEADER_INFO,
    teamsEyebrow,
    teamsSubtitle,
    type AITeamsHeaderInfo,
} from "@/components/ai-trading-teams/teams-workspace";

export default function AITradingTeamsPage() {
    const [info, setInfo] = useState<AITeamsHeaderInfo>(INITIAL_HEADER_INFO);

    const navGroups = useMemo(
        () =>
            APP_NAV.map((group) => ({
                ...group,
                items: group.items.map((item) =>
                    item.href === "/ai-trading-teams" && !info.isPro ? { ...item, badge: "PRO" } : item,
                ),
            })),
        [info.isPro],
    );

    return (
        <AppShell
            navGroups={navGroups}
            title="AI Trading Teams"
            subtitle={teamsSubtitle(info)}
            eyebrow={teamsEyebrow(info)}
            maxWidth="max-w-[1500px]"
        >
            <AITeamsWorkspace onHeaderInfo={setInfo} />
        </AppShell>
    );
}
