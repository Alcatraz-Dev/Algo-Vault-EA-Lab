"use client";

import { useMemo } from "react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { ScalpingTerminalClient } from "@/components/scalping/ScalpingTerminalClient";
import { AITeamsEntryCard } from "@/components/ai-trading-teams/entry-card";
import { ToolBadge } from "@/components/tools/tier-ui";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function ScalpingTerminalPage() {
    const navGroups: NavGroup[] = useMemo(
        () =>
            APP_NAV.map((group) => ({
                ...group,
                items: group.items.map((item) =>
                    item.href === "/scalping-terminal" ? { ...item, badge: "LITE" } : item,
                ),
            })),
        [],
    );

    return (
        <AppShell
            navGroups={navGroups}
            title="AI Scalping Terminal (Lite)"
            subtitle="Live market radar, deterministic trade intelligence and an audit-trail engine feed. This is the free path."
            eyebrow={
                <div className="flex items-center gap-2">
                    <ToolBadge kind="lite" size="sm" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Lite · live signals + engine feed
                    </span>
                </div>
            }
            maxWidth="max-w-[1800px]"
        >
            <div className="mb-4 rounded-2xl border border-border/30 bg-card/70 p-4 backdrop-blur-xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <ToolBadge kind="free" size="sm" />
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Free forever
                            </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-foreground">
                            The Free AI Scalping Terminal gives you the live radar, qualifying signals
                            and the deterministic engine feed. Everything you see here is real —
                            nothing is placeholder.
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Upgrade to Pro to add the full chart workspace, Smart Money / FVG / order
                            block overlays, historical replay, order flow, the intelligence fabric
                            (decision state) and a trade journal tied to every logged signal.
                        </p>
                    </div>
                    <Link
                        href="/account/scalping-terminal"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                    >
                        Open Pro Terminal <ArrowRight className="size-3" />
                    </Link>
                </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,420px)]">
                <AITeamsEntryCard context="Free AI Scalping Terminal" />
            </div>
            <ScalpingTerminalClient />
        </AppShell>
    );
}
