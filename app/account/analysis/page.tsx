"use client";

import AccountShell from "@/components/account/AccountShell";
import AnalysisWorkspace from "@/components/analytics/AnalysisWorkspace";

export default function AccountAnalysisPage() {
    return (
        <AccountShell title="Market Analysis" subtitle="Structure · Liquidity · Volume · Regime — live from your connected accounts">
            <AnalysisWorkspace />
        </AccountShell>
    );
}
