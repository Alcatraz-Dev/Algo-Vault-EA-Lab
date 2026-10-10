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
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
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
import { PendingOrdersTable, PositionsTable, RecentTradesTable } from "@/components/performance-arena/PositionsTable";
import { GuardianPanel } from "@/components/performance-arena/GuardianPanel";
import { AttemptReport } from "@/components/performance-arena/AttemptReport";
import { useAuthToken } from "@/lib/scalping/client";
import { useLiveQuote } from "@/hooks/useLiveCandles";
import { ARENA_SYMBOLS, marketOfSymbol } from "@/lib/performance-arena/execution";
import { formatCents, priceMicrosToNumber } from "@/lib/performance-arena/money";
import { ARENA_DISCLAIMERS, isTerminalStatus } from "@/lib/performance-arena/types";
import type {
    ChallengeEvent,
    GuardianInsight,
    MarkedTrade,
    PerformanceReport,
} from "@/lib/performance-arena/types";
import type { PassRequirement } from "@/lib/performance-arena/settlement";
import type { ChallengeAttempt, ChallengeMetrics, ChallengePendingOrder, ChallengeTrade, VirtualAccount } from "@/lib/performance-arena/types";

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
    pendingOrders: ChallengePendingOrder[];
    updatedAt: number;
}

const navGroups: NavGroup[] = APP_NAV;
const POLL_MS = 10_000;
const CHART_INTERVAL_SECONDS: Record<string, number> = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400 };

const ARENA_INTERVAL_TO_TIMEFRAME: Record<string, "M1" | "M5" | "M15" | "M30" | "H1" | "H4"> = {
    "1m": "M1",
    "5m": "M5",
    "15m": "M15",
    "30m": "M30",
    "1h": "H1",
    "3m": "M5",
    "4h": "H4",
};
function intervalToTimeframe(interval: string) {
    return ARENA_INTERVAL_TO_TIMEFRAME[interval] ?? "M5";
}

export default function ChallengeDashboardPage() {
    const params = useParams<{ attemptId: string }>();
    const token = useAuthToken();
    const [state, setState] = useState<AttemptState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chartSymbol, setChartSymbol] = useState("XAUUSD");
    const [chartInterval, setChartInterval] = useState("15m");
    const [activePanel, setActivePanel] = useState<"positions" | "orders" | "history" | "guardian">("positions");
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

    const active = state?.attempt.status === "ACTIVE";
    const canCancelChallenge = state ? !isTerminalStatus(state.attempt.status) : false;
    const canManagePositions = active || (state?.attempt.status === "PAUSED" && state.attempt.settleBlockedReason !== "STALE_MARKET_DATA");
    const canCancelPendingOrders = state?.attempt.status === "ACTIVE" || state?.attempt.status === "PAUSED";
    const policy = state?.attempt.policy;

    const symbols = useMemo(() => {
        if (!policy) return ["XAUUSD", "EURUSD"];
        const allowed = policy.allowedSymbols === "all" ? ARENA_SYMBOLS : policy.allowedSymbols;
        return allowed.filter((symbol) => {
            const market = marketOfSymbol(symbol);
            return ARENA_SYMBOLS.includes(symbol.toUpperCase()) && market !== null && policy.allowedMarkets.includes(market);
        }).slice(0, 40);
    }, [policy]);

    useEffect(() => {
        if (symbols.length > 0 && !symbols.includes(chartSymbol)) setChartSymbol(symbols[0]);
    }, [symbols, chartSymbol]);

    const chartPositions = useMemo(() => state?.openPositions
        .filter((position) => position.trade.symbol === chartSymbol) ?? [], [state?.openPositions, chartSymbol]);

    const chartPriceLines = useMemo(() => [
        ...chartPositions.flatMap(({ trade }) => [
            { id: `${trade.tradeId}:entry`, price: priceMicrosToNumber(trade.entryPriceMicros), color: "#38bdf8", title: `${trade.side === "long" ? "BUY" : "SELL"} entry` },
            ...(trade.stopLossMicros !== null ? [{ id: `${trade.tradeId}:stop`, price: priceMicrosToNumber(trade.stopLossMicros), color: "#f87171", title: "Stop loss" }] : []),
            ...(trade.takeProfitMicros !== null ? [{ id: `${trade.tradeId}:target`, price: priceMicrosToNumber(trade.takeProfitMicros), color: "#4ade80", title: "Take profit" }] : []),
        ]),
        ...(state?.pendingOrders ?? [])
            .filter((order) => order.symbol === chartSymbol && (order.status === "pending" || order.status === "processing"))
            .map((order) => ({
                id: `${order.orderId}:entry`, price: priceMicrosToNumber(order.entryPriceMicros),
                color: order.side === "long" ? "#34d399" : "#fb7185",
                title: `${order.side === "long" ? "BUY" : "SELL"} ${order.orderType}`,
            })),
    ], [chartPositions, state?.pendingOrders, chartSymbol]);

    const chartTradeMarkers = useMemo(() => state?.recentTrades
        .filter((trade) => trade.symbol === chartSymbol)
        .flatMap((trade) => [
            { id: `${trade.tradeId}:entry`, time: Math.floor(trade.entryAt / (CHART_INTERVAL_SECONDS[chartInterval] * 1000)) * CHART_INTERVAL_SECONDS[chartInterval], price: priceMicrosToNumber(trade.entryPriceMicros), side: trade.side, label: `${trade.side === "long" ? "BUY" : "SELL"} entry` },
            ...(trade.closedAt !== null && trade.exitPriceMicros !== null ? [{ id: `${trade.tradeId}:exit`, time: Math.floor(trade.closedAt / (CHART_INTERVAL_SECONDS[chartInterval] * 1000)) * CHART_INTERVAL_SECONDS[chartInterval], price: priceMicrosToNumber(trade.exitPriceMicros), side: trade.side === "long" ? "short" as const : "long" as const, label: `Close ${trade.side === "long" ? "BUY" : "SELL"} · ${trade.realizedPnLCents !== null && trade.realizedPnLCents >= 0 ? "+" : ""}${formatCents(trade.realizedPnLCents ?? 0)}` }] : []),
        ]) ?? [], [state?.recentTrades, chartSymbol, chartInterval]);

    const liveQuoteState = useLiveQuote([chartSymbol], 2_000);
    const chartQuote = liveQuoteState.quotes[chartSymbol] ?? null;

    const modifyStops = useCallback(async (tradeId: string, stops: { stopLoss?: number | null; takeProfit?: number | null }) => {
        if (!token) throw new Error("Sign in required.");
        const res = await fetch(`/api/performance-arena/attempts/${params.attemptId}/orders`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: "modifyStops", tradeId, stopLossProvided: stops.stopLoss !== undefined, takeProfitProvided: stops.takeProfit !== undefined, stopLoss: stops.stopLoss ?? null, takeProfit: stops.takeProfit ?? null }),
        });
        if (!res.ok) { const body = await res.json() as { error?: string }; throw new Error(body.error ?? "Could not update stop/target."); }
        await load();
    }, [token, params.attemptId, load]);

    const cancelPending = useCallback(async (orderId: string) => {
        if (!token) return;
        const res = await fetch(`/api/performance-arena/attempts/${params.attemptId}/orders`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: "cancelPending", orderId }),
        });
        if (!res.ok) { const body = await res.json() as { error?: string }; setError(body.error ?? "Could not cancel pending order."); }
        await load();
    }, [token, params.attemptId, load]);

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
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="outline" size="xs" onClick={() => void load()}>
                        <RefreshCw className="h-3 w-3" /> Refresh
                    </Button>
                    {canCancelChallenge ? (
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
                                <span className="text-micro text-muted-foreground">quotes: {state.quoteProvider}</span>
                            ) : null}
                        </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{Math.floor(state.metrics.timeRemainingMs / 86_400_000)}d {Math.floor((state.metrics.timeRemainingMs % 86_400_000) / 3_600_000)}h remaining</span>
                            <span className="rounded border border-border px-2 py-1">{state.metrics.dataQuality === "fresh" ? "Quote state: fresh" : "Quote state: stale / limited"}</span>
                        </div>
                    </div>

                    <div className="mb-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
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
                    <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                                            <span className={`h-2 w-2 rounded-full ${req.met ? "bg-positive" : "bg-warning"}`} />
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
                    <div className="mb-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
                        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
                                <label className="sr-only" htmlFor="arena-chart-symbol">Chart symbol</label>
                                <select id="arena-chart-symbol" value={chartSymbol} onChange={(event) => setChartSymbol(event.target.value)} className="max-w-44 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground">
                                    {symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol} · {marketOfSymbol(symbol)}</option>)}
                                </select>
                                <div className="flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                                    <span>{chartInterval.toUpperCase()} · Pro Terminal chart</span>
                                    <span className="rounded border border-border px-2 py-1" title={chartQuote ? `Quote timestamp ${new Date(chartQuote.timestamp).toLocaleTimeString()}` : "No current quote"}>{chartQuote && Date.now() - chartQuote.timestamp <= 60_000 ? chartQuote.price.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "Quote unavailable / stale"}</span>
                                    <span aria-label="Chart marker legend" className="hidden sm:inline">Entry / SL / TP levels</span>
                                </div>
                            </div>
                            {/* The shared Pro Terminal chart workspace gives this
                                page the same engine, drawing tools, layer
                                picker, fullscreen and per-symbol persistence
                                that every other page uses. */}
                            <ProTerminalChartWorkspace
                                initialSymbol={chartSymbol}
                                initialTimeframe={intervalToTimeframe(chartInterval)}
                                chartLevels={(chartPriceLines ?? []).map((line) => ({
                                    kind: line.id.includes(":stop") ? "sl" : line.id.includes(":target") ? "tp" : "entry",
                                    label: line.title,
                                    price: line.price,
                                }))}
                                height={500}
                                hideWatchlist
                                storageScope={`arena-${state.attempt.id ?? "default"}`}
                            />
                        </div>

                        <div className="space-y-3">
                            <OrderTicket
                                attemptId={state.attempt.id}
                                symbols={symbols}
                                disabled={!active}
                                maxLots={policy.positionSizePolicy.maxSizeLots}
                                policyStepLots={policy.positionSizePolicy.stepLots}
                                selectedSymbol={chartSymbol}
                                onSymbolChange={setChartSymbol}
                                currentQuote={chartQuote}
                                onPlaced={() => void load()}
                            />
                            <div className="hidden xl:block"><GuardianPanel attemptId={state.attempt.id} insights={state.guardian} onStateChange={() => void load()} /></div>
                        </div>
                    </div>

                    {/* Bottom terminal panels */}
                    <section className="mb-3 min-w-0 overflow-hidden rounded-lg border border-border bg-card" aria-label="Trading activity">
                        <div className="flex overflow-x-auto border-b border-border" role="tablist" aria-label="Trading activity panels">
                            {(["positions", "orders", "history", "guardian"] as const).map((panel) => (
                                <button key={panel} type="button" role="tab" aria-selected={activePanel === panel} onClick={() => setActivePanel(panel)} className={`shrink-0 px-4 py-3 text-xs font-medium capitalize ${activePanel === panel ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                                    {panel}{panel === "positions" ? ` (${state.openPositions.length})` : panel === "orders" ? ` (${state.pendingOrders.filter((order) => order.status === "pending" || order.status === "processing").length})` : ""}
                                </button>
                            ))}
                        </div>
                        <div className="min-w-0 p-3 sm:p-4" role="tabpanel">
                            {activePanel === "positions" ? <PositionsTable positions={state.openPositions} canClose={canManagePositions} canModifyStops={active} onClose={onClosePosition} onModifyStops={modifyStops} /> : null}
                            {activePanel === "orders" ? <PendingOrdersTable orders={state.pendingOrders} canCancel={canCancelPendingOrders} onCancel={cancelPending} /> : null}
                            {activePanel === "history" ? <RecentTradesTable trades={state.recentTrades} /> : null}
                            {activePanel === "guardian" ? <GuardianPanel attemptId={state.attempt.id} insights={state.guardian} onStateChange={() => void load()} /> : null}
                        </div>
                    </section>

                    <ArenaDisclaimer>{ARENA_DISCLAIMERS.simulated} {ARENA_DISCLAIMERS.challengeScope}</ArenaDisclaimer>
                </>
            ) : null}
        </AppShell>
    );
}
