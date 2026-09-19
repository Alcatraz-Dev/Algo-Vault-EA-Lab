"use client";

import AccountShell from "@/components/account/AccountShell";
import { StrategyLabClient } from "@/components/strategy-lab/StrategyLabClient";

export default function StrategyLabPage() {
    return (
        <AccountShell title="AI Strategy Lab" subtitle="Historical analysis, pattern discovery, AI strategy generation, backtesting, validation and deployment.">
            <div data-guide="page-header">
                <StrategyLabClient />
            </div>
            <div data-guide="stats" className="mt-6">
                <StrategyLabClient />
            </div>
            <div data-guide="actions" className="mt-6">
                <StrategyLabClient />
            </div>
        </AccountShell>
    );
}