"use client";

import PineWorkspace from "@/components/tradingview/PineWorkspace";
import AccountShell from "@/components/account/AccountShell";

export default function AccountTradingViewPage() {
    return (
        <AccountShell title="Trading Studio" subtitle="Charts and Pine workspaces">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="flex items-start justify-between flex-wrap gap-4 border-b border-border pb-5" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Trading Studio</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Build a Pine script visually or write it directly. Use AI to auto-build strategies, fix errors, and analyze your code. Save your workspaces and download as .txt files.
                        </p>
                    </div>
                </div>
                <PineWorkspace scope="account" />
            </div>
        </AccountShell>
    );
}