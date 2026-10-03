"use client";

import AccountShell from "@/components/account/AccountShell";
import { StrategyLabClient } from "@/components/strategy-lab/StrategyLabClient";
import { AITeamsEntryCard } from "@/components/ai-trading-teams/entry-card";

export default function StrategyLabPage() {
    return (
        <AccountShell
            title="AI Strategy Lab"
            subtitle="Analyze → Discover → Generate → Backtest → Optimize → Validate → Deploy"
        >
            <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,420px)]">
                <AITeamsEntryCard context="Strategy Lab" />
            </div>
            <StrategyLabClient />
        </AccountShell>
    );
}
