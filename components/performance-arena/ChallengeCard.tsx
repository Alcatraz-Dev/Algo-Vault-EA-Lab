"use client";

// Challenge Catalog card — configuration-driven: every number shown comes
// from ChallengePolicy, never hard-coded in the card.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Coins, Flame, ShieldCheck, Sparkles, Target, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArenaDisclaimer, KV } from "./primitives";
import type { CatalogItem } from "@/lib/performance-arena/service";
import { ARENA_DISCLAIMERS } from "@/lib/performance-arena/types";

const TIER_LABEL: Record<string, string> = {
    starter: "Starter",
    standard: "Standard",
    pro: "Pro",
    elite: "Elite",
    custom: "Custom",
};

const ACCESS_LABEL: Record<string, string> = {
    free: "Free",
    pro: "Included with Pro",
    paid: "Paid challenge",
    credits: "AV Points",
};

export function ChallengeCard({ item, onJoined }: { item: CatalogItem; onJoined?: (attemptId: string) => void }) {
    const router = useRouter();
    const { definition, access } = item;
    const policy = definition.policy;
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const capital = `$${(policy.startingBalanceCents / 100).toLocaleString("en-US")} virtual`;

    const handleJoin = async () => {
        setJoining(true);
        setError(null);
        try {
            const token = await import("@/lib/firebase").then((m) => m.auth.currentUser?.getIdToken());
            if (!token) throw new Error("Sign in required.");

            // If it's a paid challenge and user is not allowed yet, launch checkout
            if (definition.access.model === "paid" && !access.allowed) {
                const res = await fetch("/api/performance-arena/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ definitionId: definition.id }),
                });
                const body = (await res.json()) as { checkoutUrl?: string; error?: string };
                if (!res.ok) throw new Error(body.error ?? "Failed to create checkout session.");
                if (body.checkoutUrl) {
                    window.location.href = body.checkoutUrl;
                    return;
                }
            }

            const res = await fetch("/api/performance-arena/attempts", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ definitionId: definition.id }),
            });
            const body = (await res.json()) as { attempt?: { id: string }; error?: string };
            if (!res.ok) throw new Error(body.error ?? "Could not join this challenge.");
            if (body.attempt?.id) {
                if (onJoined) onJoined(body.attempt.id);
                else router.push(`/account/performance-arena/attempts/${body.attempt.id}`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not join this challenge.");
        } finally {
            setJoining(false);
        }
    };

    const priceText = Number.isSafeInteger(definition.access.priceCents) && (definition.access.priceCents ?? 0) > 0
        ? new Intl.NumberFormat(undefined, { style: "currency", currency: definition.access.currency?.toUpperCase() ?? "USD" }).format((definition.access.priceCents ?? 0) / 100)
        : null;
    const purchaseUnavailable = definition.access.model === "paid" && (!priceText || access.reason === "Paid challenges are not available yet.");

    return (
        <div className="flex flex-col rounded-lg border border-border bg-card">
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{definition.name}</h3>
                        <Badge variant="secondary">{TIER_LABEL[definition.tier] ?? definition.tier}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{definition.summary}</p>
                </div>
                <div className="text-right">
                    <p className="font-mono text-lg font-semibold tabular-nums">{capital}</p>
                    <p className="text-micro text-muted-foreground">virtual capital</p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 p-4 text-xs">
                <KV label={<span className="flex items-center gap-1"><Target className="h-3 w-3" /> Profit target</span>} value={`${policy.profitTargetPct}%`} />
                <KV label={<span className="flex items-center gap-1"><Flame className="h-3 w-3" /> Max drawdown</span>} value={`${policy.maxDrawdownPct}%`} />
                <KV label="Daily loss limit" value={`${policy.dailyLossLimitPct}%`} />
                <KV label={<span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Min trading days</span>} value={policy.minTradingDays} />
                <KV label="Max duration" value={`${policy.maxCalendarDays} days`} />
                <KV label="Max positions" value={policy.maxConcurrentPositions} />
                <KV label="Max daily trades" value={policy.maxDailyTrades} />
                <KV label="Risk per trade" value={`≤ ${policy.maxRiskPerTradePct}%`} />
            </div>

            <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" /> Includes: Challenge Guardian, rule monitoring, performance report
                </p>
                <p className="flex items-center gap-1.5">
                    <TrendingUp className="h-3 w-3" /> Rewards on pass: AV Points, Pro days, AI credits, badges
                </p>
                <p className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3 w-3" /> Access: {ACCESS_LABEL[definition.access.model] ?? definition.access.model}
                    {definition.access.model === "paid" ? ` (${priceText})` : ""}
                    {definition.access.model === "credits" && definition.access.pricePoints ? ` (${definition.access.pricePoints} pts)` : ""}
                </p>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
                <Link href={`/account/performance-arena/challenges/${definition.id}`} className="text-xs text-primary hover:underline">
                    View details
                </Link>
                {item.activeAttemptId ? (
                    <Button size="sm" variant="secondary" onClick={() => router.push(`/account/performance-arena/attempts/${item.activeAttemptId}`)}>
                        Continue attempt
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        disabled={joining || purchaseUnavailable}
                        onClick={() => void handleJoin()}
                        variant={definition.access.model === "paid" && !access.allowed ? "default" : "default"}
                    >
                        <Coins className="h-3.5 w-3.5" />
                        {joining
                            ? "Processing…"
                            : access.allowed
                            ? "Join challenge"
                            : definition.access.model === "paid"
                            ? priceText ? `Buy Challenge (${priceText})` : "Price not configured"
                            : "Locked"}
                    </Button>
                )}
            </div>

            {!access.allowed && access.reason ? (
                <p className="border-t border-border px-4 py-2 text-micro text-warning">{access.reason}</p>
            ) : null}
            {error ? <p className="border-t border-border px-4 py-2 text-micro text-destructive">{error}</p> : null}
            <ArenaDisclaimer className="border-t border-border p-4">{ARENA_DISCLAIMERS.rewards}</ArenaDisclaimer>
        </div>
    );
}
