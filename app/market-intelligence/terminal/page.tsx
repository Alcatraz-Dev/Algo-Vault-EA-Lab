"use client";

import { AppShell } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { ToolBadge } from "@/components/tools/tier-ui";
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function MarketIntelligenceTerminalPage() {
    return (
        <AppShell
            navGroups={APP_NAV}
            title="Market Intelligence — Terminal"
            subtitle="Professional chart workspace · Smart Money · Indicators · Sessions"
            eyebrow={
                <div className="flex items-center gap-2">
                    <ToolBadge kind="pro" size="sm" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Pro workspace</span>
                </div>
            }
            maxWidth="max-w-[1900px]"
        >
            <div className="mb-4 flex items-center gap-2">
                <Link
                    href="/market-intelligence"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="size-3.5" />
                    Market Intelligence
                </Link>
                <span className="text-xs text-muted-foreground/50">/</span>
                <span className="text-xs font-medium text-foreground">Terminal</span>
            </div>

            <ProTerminalChartWorkspace
                initialSymbol="XAUUSD"
                initialTimeframe="M5"
                height={580}
                storageScope="market-intelligence-terminal"
            />
        </AppShell>
    );
}