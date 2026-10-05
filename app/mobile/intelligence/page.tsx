"use client";

/**
 * Mobile Intelligence hub.
 *
 * A genuine index, not a duplicate dashboard: each destination states what it is
 * for and shows how many items are actually waiting. Counts come from the same
 * command-centre payload the home screen uses, so they cannot disagree with it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { INTELLIGENCE_DESTINATIONS } from "@/lib/mobile/navigation";
import { useWorkspaceSync } from "@/hooks/use-cross-device-sync";

interface Counts {
    setups: number | null;
    alerts: number | null;
    research: number | null;
    strategies: number | null;
    journal: number | null;
    risk: string | null;
}

export default function IntelligenceHub() {
    const { signedIn } = useWorkspaceSync();
    const [counts, setCounts] = useState<Counts | null>(null);

    useEffect(() => {
        if (!signedIn) return;
        let cancelled = false;
        void (async () => {
            try {
                const { auth } = await import("@/lib/firebase");
                const token = await auth.currentUser?.getIdToken();
                if (!token || cancelled) return;
                const response = await fetch("/api/mobile/command-center", {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                if (!response.ok || cancelled) return;
                const payload = (await response.json()) as {
                    setups?: unknown[];
                    alerts?: Array<{ triggered: boolean }>;
                    riskStatus?: string;
                };
                setCounts({
                    setups: payload.setups?.length ?? 0,
                    alerts: payload.alerts?.filter((a) => !a.triggered).length ?? 0,
                    // Not yet sourced from a dedicated endpoint on this surface —
                    // reported as unknown rather than as zero, which would be a lie.
                    research: null,
                    strategies: null,
                    journal: null,
                    risk: payload.riskStatus ?? null,
                });
            } catch {
                // Leave counts null: "—" is honest, a fabricated zero is not.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [signedIn]);

    return (
        <div className="space-y-4 p-4 pb-8">
            <header>
                <h1 className="text-lg font-semibold">Intelligence</h1>
                <p className="text-xs text-muted-foreground">
                    Every surface here reads the same engines as the desktop.
                </p>
            </header>

            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {INTELLIGENCE_DESTINATIONS.map((destination) => {
                    const Icon = destination.icon;
                    const count = counts?.[destination.id as keyof Counts];
                    return (
                        <li key={destination.id}>
                            <Link
                                href={destination.href}
                                className="flex items-center gap-3 px-3 py-3 active:bg-muted/60"
                            >
                                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{destination.label}</span>
                                        {destination.pro && (
                                            <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                                                PRO
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">{destination.purpose}</p>
                                </div>
                                {count !== undefined && count !== null && (
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {typeof count === "number" ? count : count}
                                    </span>
                                )}
                                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
