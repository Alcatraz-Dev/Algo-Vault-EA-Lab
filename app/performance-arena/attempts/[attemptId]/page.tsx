"use client";

// Challenge dashboard — live simulated-challenge experience built on the
// native AlgoVault chart. Every number on this page is computed server-side;
// the page polls the read-only state endpoint and submits intent only.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw, Timer } from "lucide-react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import TradingChart from "@/components/tradingview/TradingChart";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import {
    ArenaDisclaimer,
    ArenaError,
    ArenaLoading,
    ChallengeStatusBadge,
    LimitBar,
    Money,
    RuleEventList,
    SimulatedBadge,
} from "@/components/performance-arena/primitives";
import { OrderTicket } from "@/components/performance-arena/OrderTicket";
import { PositionsTable, RecentTradesTable } from "@/components/performance-arena/PositionsTable";
import { GuardianPanel } from "@/components/performance-arena/GuardianPanel";
import { AttemptReport } from "@/components/performance-arena/AttemptReport";
import { useAuthToken } from "@/lib/scalping/client";
import { formatCents } from "@/lib/performance-arena/money";
import { ARENA_DISCLAIMERS, isTerminalStatus } from "@/lib/performance-arena/types";
import type {
    ChallengeEvent,
    GuardianInsight,
    MarkedTrade,
    PerformanceReport,
} from "@/lib/performance-arena/types";
import type { PassRequirement } from "@/lib/performance-arena/settlement";
import type { ChallengeAttempt, ChallengeMetrics, ChallengeTrade, VirtualAccount } from "@/lib/performance-arena/types";

interface AttemptState {
    attempt: ChallengeAttempt;
    account: VirtualAccount;
    metrics: ChallengeMetrics;
    openPositions: MarkedTrade[];
    recentTrades: ChallengeTrade[];
    recentEvents: ChallengeEvent[];
    guardian: GuardianInsight[];
    requirements: PassRequirement[];
    report: PerformanceReport | null;
    quoteProvider: string | null;
    updatedAt: number;
}

const navGroups: NavGroup[] = APP_NAV;
const POLL_MS = 10_000;

export default function ChallengeDashboardPage() {
    const params = useParams<{ attemptId: string }>();
    const token = useAuthToken();
    const [state, setState] = useState<AttemptState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chartSymbol, setChartSymbol] = useState("XAUUSD");
    const [cancelling, setCancelling] = useState(false);

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`/api/performance-arena/attempts/${params.attemptId}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            const body = (await res.json()) as AttemptState & { error?: string };
            if (!res.ok) throw new Error(body.error ?? "Failed to load the challenge.");
            setState(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load the challenge.");
        }
    }, [token, params.attemptId]);

    useEffect(() => {
        // Defer past the effect tick — state updates never run synchronously
        // inside the effect (react-hooks/set-state-in-effect).
        const kick = setTimeout(() => void load(), 0);
        return () => clearTimeout(kick);
    }, [load]);

    useEffect(() => {
        const timer = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(timer);
    }, [load]);

    const onClosePosition = useCallback(
        async (tradeId: string) => {
            if (!token) return;
            const res = await fetch(`/api/performance-arena/attempts/${params.attemptId}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: "close", tradeId, clientRequestId: `close_${tradeId}_${Date.now()}` }),
            });
            if (!res.ok) {
                const body = (await res.json()) as { error?: string };
                setError(body.error ?? "Close failed.");
            }
            await load();
        },
        [token, params.attemptId, load]
    );

    const cancel = async () => {
        if (!token) return;
        setCancelling(true);
        try {
            const res = await fetch(`/api/performance-arena/attempts/${params.attemptId}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ reason: "Cancelled from dashboard." }),
            });
            if (!res.ok) {
                const body = (await res.json()) as { error?: string };
                setError(body.error ?? "Cancel failed.");
            }
            await load();
        } finally {
            setCancelling(false);
        }
    };

    const active = state ? !isTerminalStatus(state.attempt.status) : false;
    const policy = state?.attempt.policy;

    const symbols = useMemo(() => {
        if (!policy) return ["XAUUSD", "EURUSD"];
        const base =
            policy.allowedSymbols === "all"
                ? ["XAUUSD", "EURUSD", "GBPUSD", "NAS100", "BTCUSD"]
                : policy.allowedSymbols.slice(0, 20);
        return base.length > 0 ? base : ["EURUSD"];
    }, [policy]);

    const ruleFeed = useMemo(() => {
        if (!state) return [];
        return state.recentEvents
            .filter((e) => e.type === "RULE_WARNING" || e.type === "RULE_BREACH" || e.type === "ORDER_REJECTED" || e.type === "SETTLEMENT")
            .map((e) => ({
                eventId: e.eventId,
                type: e.type,
                severity: e.severity,
                message: e.message,
                timestamp: e.timestamp,
            }));
    }, [state]);

    return (
        <AppShell
            navGroups={navGroups}
            title={state ? `Challenge · ${state.attempt.definitionKey}` : "Challenge"}
            subtitle="Simulated environment — virtual capital, server-authoritative accounting."
            eyebrow={<SimulatedBadge />}
            maxWidth="max-w-[1700px]"
            headerActions={
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="xs" onClick={() => void load()}>
                        <RefreshCw className="h-3 w-3" /> Refresh
                    </Button>
                    {active ? (
                        <Button variant="destructive" size="xs" disabled={cancelling} onClick={() => void cancel()}>
                            {cancelling ? "Cancelling…" : "Cancel challenge"}
                        </Button>
                    ) : null}
                </div>
            }
        >
            <Link href="/account/performance-arena" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3 w-3" /> Performance Arena
            </Link>

            {error ? <div className="mb-3"><ArenaError message={error} onRetry={() => void load()} /></div> : null}
            {!state && !error ? <ArenaLoading label="Loading challenge…" /> : null}

            {state && policy ? (
                <>
                    {/* ── Header metrics ─────────────────────────────────── */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <ChallengeStatusBadge status={state.attempt.status} />
                            <span className="font-mono text-xs text-muted-foreground">
                                Started {new Date(state.attempt.startedAt).toLocaleDateString()} · expires{" "}
                                {new Date(state.attempt.expiresAt).toLocaleDateString()}
                            </span>
                            {state.quoteProvider ? (
                                <span className="text-[11px] text-muted-foreground">quotes: {state.quoteProvider}</span>
                            ) : null}
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Timer className="h-3 w-3" />
                            {Math.floor(state.metrics.timeRemainingMs / 86_400_000)}d{" "}
                            {Math.floor((state.metrics.timeRemainingMs % 86_400_000) / 3_600_000)}h remaining
                        </span>
                    </div>

                    <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                        <MetricCard label="Equity (virtual)" value={formatCents(state.metrics.equityCents)} footnote={`start ${formatCents(state.metrics.startingBalanceCents)}`} />
                        <MetricCard
                            label="Total PnL"
                            value={<Money cents={state.metrics.totalPnLCents} signed />}
                            delta={`${state.metrics.totalReturnPct >= 0 ? "+" : ""}${state.metrics.totalReturnPct.toFixed(2)}%`}
                            deltaTone={state.metrics.totalReturnPct >= 0 ? "up" : "down"}
                            footnote={`target ${policy.profitTargetPct}%`}
                        />
                        <MetricCard
                            label="Drawdown"
                            value={`${state.metrics.currentDrawdownPct.toFixed(2)}%`}
                            delta={`${state.metrics.drawdownUsedPct.toFixed(0)}% of ${policy.maxDrawdownPct}%`}
                            deltaTone={state.metrics.drawdownUsedPct >= 80 ? "warning" : "neutral"}
                        />
                        <MetricCard
                            label="Daily loss"
                            value={<Money cents={Math.min(0, state.metrics.dailyPnLCcents)} signed />}
                            delta={`${state.metrics.dailyLossUsedPct.toFixed(0)}% of ${policy.dailyLossLimitPct}%`}
                            deltaTone={state.metrics.dailyLossUsedPct >= 80 ? "warning" : "neutral"}
                        />
                        <MetricCard
                            label="Trading days"
                            value={`${state.metrics.tradingDays}/${policy.minTradingDays}`}
                            footnote={`max ${policy.maxTradingDays}`}
                        />
                        <MetricCard
                            label="Open positions"
                            value={state.metrics.openPositions}
                            footnote={`exposure ${formatCents(state.metrics.openExposureCents)}`}
                        />
                    </div>

                    {/* ── Progress bars + checklist ──────────────────────── */}
                    <div className="mb-3 grid gap-3 lg:grid-cols-3">
                        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                            <LimitBar label="Profit target" usedPct={state.metrics.targetProgressPct} tone="positive" detail={`${formatCents(state.metrics.equityCents)} / ${formatCents(state.metrics.targetCents)}`} invert />
                            <LimitBar label="Daily loss allowance" usedPct={state.metrics.dailyLossUsedPct} tone="warning" detail={`remaining ${formatCents(state.metrics.remainingDailyLossCents)}`} />
                            <LimitBar label="Max drawdown allowance" usedPct={state.metrics.drawdownUsedPct} tone="negative" detail={`limit ${policy.maxDrawdownPct}% ${policy.maxDrawdownMode}`} />
                        </div>

                        <div className="rounded-lg border border-border bg-card p-4">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">Path to passing</p>
                            <ul className="space-y-1.5 text-xs">
                                {state.requirements.map((req) => (
                                    <li key={req.key} className="flex items-start justify-between gap-2">
                                        <span className="flex items-center gap-1.5">
                                            <span className={`h-2 w-2 rounded-full ${req.met ? "bg-emerald-500" : "bg-amber-500"}`} />
                                            {req.label}
                                        </span>
                                        <span className="text-right text-muted-foreground">{req.detail}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-4">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">Recent rule events</p>
                            <div className="max-h-44 overflow-y-auto">
                                <RuleEventList events={ruleFeed} />
                            </div>
                        </div>
                    </div>

                    {/* ── Report (settled) ───────────────────────────────── */}
                    {state.report ? (
                        <div className="mb-3">
                            <AttemptReport report={state.report} />
                        </div>
                    ) : null}

                    {/* ── Chart + trading ────────────────────────────────── */}
                    <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
                        <div className="rounded-lg border border-border bg-card">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
                                <div className="flex flex-wrap gap-1">
                                    {symbols.map((symbol) => (
                                        <button
                                            key={symbol}
                                            type="button"
                                            onClick={() => setChartSymbol(symbol)}
                                            className={`rounded-md px-2 py-1 font-mono text-xs ${
                                                chartSymbol === symbol ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {symbol}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[11px] text-muted-foreground">Native AlgoVault chart · entry/exit markers via trade history</span>
                            </div>
                            <TradingChart symbol={chartSymbol} interval="15m" height={430} />
                            <div className="border-t border-border px-4 py-2">
                                <p className="mb-1 text-[11px] text-muted-foreground">Recent trades (entry/exit)</p>
                                <RecentTradesTable trades={state.recentTrades} />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <OrderTicket
                                attemptId={state.attempt.id}
                                symbols={symbols}
                                disabled={!active}
                                maxLots={policy.positionSizePolicy.maxSizeLots}
                                onPlaced={() => void load()}
                            />
                            <GuardianPanel attemptId={state.attempt.id} insights={state.guardian} onStateChange={() => void load()} />
                        </div>
                    </div>

                    {/* ── Positions ──────────────────────────────────────── */}
                    <div className="mb-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Open positions</p>
                        <PositionsTable positions={state.openPositions} canClose={active} onClose={onClosePosition} />
                    </div>

                    <ArenaDisclaimer>{ARENA_DISCLAIMERS.simulated} {ARENA_DISCLAIMERS.challengeScope}</ArenaDisclaimer>
                </>
            ) : null}
        </AppShell>
    );
}
