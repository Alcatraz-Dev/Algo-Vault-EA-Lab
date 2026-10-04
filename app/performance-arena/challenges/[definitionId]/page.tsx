"use client";

// Challenge detail — full policy breakdown, reward policy and join action.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Coins, Flame, Target } from "lucide-react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArenaDisclaimer, ArenaError, ArenaLoading, KV, SimulatedBadge } from "@/components/performance-arena/primitives";
import { CompatibilityPanel } from "@/components/performance-arena/CompatibilityPanel";
import { useAuthToken } from "@/lib/scalping/client";
import type { ChallengeDefinition } from "@/lib/performance-arena/types";
import { ARENA_DISCLAIMERS } from "@/lib/performance-arena/types";

interface Detail {
    definition: ChallengeDefinition;
    access: { allowed: boolean; reason?: string };
    activeAttemptId: string | null;
}

const navGroups: NavGroup[] = APP_NAV;

export default function ChallengeDetailPage() {
    const params = useParams<{ definitionId: string }>();
    const router = useRouter();
    const token = useAuthToken();
    const [detail, setDetail] = useState<Detail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [joining, setJoining] = useState(false);

    const load = useCallback(async () => {
        if (!token) return;
        setError(null);
        try {
            const res = await fetch("/api/performance-arena/catalog", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            const body = (await res.json()) as { items?: Array<{ definition: ChallengeDefinition; access: { allowed: boolean; reason?: string }; activeAttemptId: string | null }> };
            if (!res.ok) throw new Error(body ? (body as unknown as { error?: string }).error ?? "Failed to load" : "Failed to load");
            const match = (body.items ?? []).find((i) => i.definition.id === params.definitionId);
            if (!match) throw new Error("Challenge not found.");
            setDetail(match);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load the challenge.");
        }
    }, [token, params.definitionId]);

    useEffect(() => {
        // Defer past the effect tick (react-hooks/set-state-in-effect).
        const kick = setTimeout(() => void load(), 0);
        return () => clearTimeout(kick);
    }, [load]);

    const join = async () => {
        if (!token || !detail) return;
        setJoining(true);
        setError(null);
        try {
            if (detail.definition.access.model === "paid" && !detail.access.allowed) {
                const res = await fetch("/api/performance-arena/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ definitionId: detail.definition.id }),
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
                body: JSON.stringify({ definitionId: detail.definition.id }),
            });
            const body = (await res.json()) as { attempt?: { id: string }; error?: string };
            if (!res.ok) throw new Error(body.error ?? "Could not join.");
            if (body.attempt?.id) router.push(`/account/performance-arena/attempts/${body.attempt.id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not join.");
        } finally {
            setJoining(false);
        }
    };

    const priceText = detail && Number.isSafeInteger(detail.definition.access.priceCents) && (detail.definition.access.priceCents ?? 0) > 0
        ? new Intl.NumberFormat(undefined, { style: "currency", currency: detail.definition.access.currency?.toUpperCase() ?? "USD" }).format((detail.definition.access.priceCents ?? 0) / 100)
        : null;
    const purchaseUnavailable = detail?.definition.access.model === "paid" && (!priceText || detail.access.reason === "Paid challenges are not available yet.");

    return (
        <AppShell navGroups={navGroups} title="Challenge details" eyebrow={<SimulatedBadge />} maxWidth="max-w-5xl">
            <Link href="/account/performance-arena" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3 w-3" /> Back to catalog
            </Link>

            {error ? <ArenaError message={error} onRetry={() => void load()} /> : null}
            {!detail && !error ? <ArenaLoading label="Loading challenge…" /> : null}

            {detail ? (
                <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-card p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-semibold">{detail.definition.name}</h2>
                                    <Badge variant="secondary">{detail.definition.tier}</Badge>
                                </div>
                                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{detail.definition.summary}</p>
                            </div>
                            <div className="text-right">
                                <p className="font-mono text-2xl font-semibold">
                                    ${(detail.definition.policy.startingBalanceCents / 100).toLocaleString("en-US")}
                                </p>
                                <p className="text-xs text-muted-foreground">virtual starting capital</p>
                            </div>
                        </div>

                        <div className="mt-4 grid gap-x-8 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
                            <KV label={<span className="flex items-center gap-1"><Target className="h-3 w-3" /> Profit target</span>} value={`${detail.definition.policy.profitTargetPct}%`} />
                            <KV label={<span className="flex items-center gap-1"><Flame className="h-3 w-3" /> Max drawdown</span>} value={`${detail.definition.policy.maxDrawdownPct}% (${detail.definition.policy.maxDrawdownMode})`} />
                            <KV label="Daily loss limit" value={`${detail.definition.policy.dailyLossLimitPct}% (${detail.definition.policy.dailyLossBase.replace("_", " ")})`} />
                            <KV label={<span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Min trading days</span>} value={detail.definition.policy.minTradingDays} />
                            <KV label="Max trading days" value={detail.definition.policy.maxTradingDays} />
                            <KV label="Max duration" value={`${detail.definition.policy.maxCalendarDays} calendar days`} />
                            <KV label="Allowed markets" value={detail.definition.policy.allowedMarkets.join(", ")} />
                            <KV label="Allowed sessions" value={detail.definition.policy.allowedSessions === "all" ? "All sessions" : detail.definition.policy.allowedSessions.join(", ")} />
                            <KV label="Weekend trading" value={detail.definition.policy.weekendTrading} />
                            <KV label="Max concurrent positions" value={detail.definition.policy.maxConcurrentPositions} />
                            <KV label="Max daily trades" value={detail.definition.policy.maxDailyTrades} />
                            <KV label="Risk per trade" value={`≤ ${detail.definition.policy.maxRiskPerTradePct}% of equity`} />
                            <KV label="Leverage policy" value={`≤ ${detail.definition.policy.leveragePolicy.maxLeverageRatio}× equity`} />
                            <KV label="Consistency" value={detail.definition.policy.consistency.required ? `≤ ${detail.definition.policy.consistency.maxSingleDayPnlSharePct}% from one day` : "Advisory"} />
                            <KV label="Cost model" value={`$${(detail.definition.policy.costModel.commissionPerLotCents / 100).toFixed(2)}/lot · ${detail.definition.policy.costModel.slippagePips} pip slippage`} />
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                            <div className="space-y-1 text-xs text-muted-foreground">
                                <p className="flex items-center gap-1.5">
                                    <Coins className="h-3 w-3" /> Rewards: AV Points, Pro days, AI credits, research runs, badges (configurable, non-cash)
                                </p>
                                <p>Access: {detail.definition.access.model}{detail.definition.access.model === "paid" ? ` (${priceText})` : ""}{detail.definition.access.pricePoints ? ` — ${detail.definition.access.pricePoints} AV Points` : ""}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {detail.activeAttemptId ? (
                                    <Button onClick={() => router.push(`/account/performance-arena/attempts/${detail.activeAttemptId}`)}>Continue attempt</Button>
                                ) : (
                                    <Button disabled={joining || purchaseUnavailable} onClick={() => void join()}>
                                        {joining
                                            ? "Processing…"
                                            : detail.access.allowed
                                            ? "Join challenge"
                                            : detail.definition.access.model === "paid"
                                            ? priceText ? `Buy Challenge (${priceText})` : "Price not configured"
                                            : "Locked"}
                                    </Button>
                                )}
                            </div>
                        </div>
                        {!detail.access.allowed && detail.access.reason ? (
                            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{detail.access.reason}</p>
                        ) : null}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <CompatibilityPanel definitionId={detail.definition.id} />
                        <div className="rounded-lg border border-border bg-card p-4">
                            <h3 className="mb-2 text-sm font-semibold">How it works</h3>
                            <ol className="space-y-1.5 text-xs text-muted-foreground">
                                <li>1. Join → a virtual account is created with the configured starting balance.</li>
                                <li>2. Trade simulated positions at server-resolved live quotes (spread, slippage and commission applied).</li>
                                <li>3. Rules are monitored continuously — warnings before breaches, fail-closed on stale data.</li>
                                <li>4. Reach the target with the minimum trading days and close positions to pass.</li>
                                <li>5. Receive non-cash rewards and a professional performance report.</li>
                            </ol>
                            <div className="mt-3 space-y-1 border-t border-border pt-3">
                                <ArenaDisclaimer>{ARENA_DISCLAIMERS.simulated}</ArenaDisclaimer>
                                <ArenaDisclaimer>{ARENA_DISCLAIMERS.noGuarantees}</ArenaDisclaimer>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </AppShell>
    );
}
