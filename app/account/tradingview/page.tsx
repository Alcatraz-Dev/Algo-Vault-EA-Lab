"use client";

import PineWorkspace from "@/components/tradingview/PineWorkspace";
import AccountShell from "@/components/account/AccountShell";
import { PageHeader } from "@/components/ui/page-header";

export default function AccountTradingViewPage() {
    return (
        <AccountShell title="Trading Studio" subtitle="Charts and Pine workspaces">
            <div className="mx-auto max-w-7xl space-y-6">
                <PageHeader
                    title="Trading Studio"
                    subtitle="Build a Pine script visually or write it directly. Use AI to auto-build strategies, fix errors, and analyze your code. Save your workspaces and download as .txt files."
                    className="border-b border-border pb-5"
                />
                <PineWorkspace scope="account" />
            </div>
        </AccountShell>
    );
}