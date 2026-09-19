"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PineWorkspace from "@/components/tradingview/PineWorkspace";
import AccountShell from "@/components/account/AccountShell";

export default function AccountTradingViewPage() {
    return (
        <AccountShell title="Trading Studio" subtitle="Charts and Pine workspaces">
            <div className="mx-auto max-w-7xl" data-guide="page-header">
                <Link href="/account" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft size={16} />Back to account</Link>
                <div className="mt-8 border-b border-border pb-6">
                    <p className="text-xs font-medium uppercase tracking-widest text-foreground/60">Trading workspace</p>
                    <h1 className="mt-2 text-3xl font-semibold text-foreground">Trading Studio</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Build a Pine script visually or write it directly. Use AI to auto-build strategies, fix errors, and analyze your code. Save your workspaces and download as .txt files.</p>
                </div>
                <div className="mt-6"><PineWorkspace scope="account" /></div>
            </div>
        </AccountShell>
    );
}
