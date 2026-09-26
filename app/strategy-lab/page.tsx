"use client";

import AccountShell from "@/components/account/AccountShell";
import { StrategyLabClient } from "@/components/strategy-lab/StrategyLabClient";

export default function StrategyLabPage() {
    return (
        <AccountShell
            title="AI Strategy Lab"
            subtitle="Analyze → Discover → Generate → Backtest → Optimize → Validate → Deploy"
        >
            <StrategyLabClient />
        </AccountShell>
    );
}
