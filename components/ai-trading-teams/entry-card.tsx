"use client";

import Link from "next/link";
import { ArrowUpRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Contextual entry point into AI Trading Teams (spec §2).
 * Drop-in CTA used from AI Terminal, Scalping Terminal, Strategy Lab,
 * Market Intelligence and Dashboard.
 */
export function AITeamsEntryCard({
    context,
    className,
    compact = false,
}: {
    /** e.g. "AI Terminal", "Strategy Lab" — shown as the launch context. */
    context?: string;
    className?: string;
    compact?: boolean;
}) {
    return (
        <Link
            href="/account/ai-trading-teams"
            className={cn(
                "group relative block overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card p-4 transition-colors hover:border-primary/60",
                className,
            )}
        >
            <span
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
                aria-hidden="true"
            />
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <Users className="size-3.5" /> AI Trading Teams
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                        Convene your AI research desk
                    </p>
                    <p className="mt-0.5 text-micro leading-snug text-muted-foreground">
                        Regime · Smart Money · Technical · Quant · Risk · Contrarian — evidence-based collaboration
                        on top of {context ? `${context} ` : ""}the same AlgoVault intelligence.
                    </p>
                    {!compact ? (
                        <span className="mt-2 inline-flex items-center gap-1 text-micro font-medium text-primary">
                            Open workspace
                            <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </span>
                    ) : null}
                </div>
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                    <Users className="size-4" />
                </span>
            </div>
        </Link>
    );
}
