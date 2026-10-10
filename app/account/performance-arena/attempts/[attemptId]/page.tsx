"use client";

// /account/performance-arena/attempts/[attemptId]
// Challenge dashboard inside customer account area — live simulated-challenge experience built on
// the native AlgoVault chart. Every number is computed server-side; polls state and submits intent only.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { ArrowLeft, RefreshCw, Timer } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { auth } from "@/lib/firebase";
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
import { PerformancePanel } from "@/components/performance-arena/PerformancePanel";
import { PendingOrdersTable, PositionsTable, RecentTradesTable } from "@/components/performance-arena/PositionsTable";
import { GuardianPanel } from "@/components/performance-arena/GuardianPanel";
import { PartialCloseDialog } from "@/components/performance-arena/PartialCloseDialog";
import { AttemptReport } from "@/components/performance-arena/AttemptReport";
import { useAuthToken } from "@/lib/scalping/client";
import { useLiveQuote } from "@/hooks/useLiveCandles";
import { ARENA_SYMBOLS, marketOfSymbol } from "@/lib/performance-arena/execution";
import { formatCents, priceMicrosToNumber } from "@/lib/performance-arena/money";
import { ARENA_DISCLAIMERS, isTerminalStatus } from "@/lib/performance-arena/types";
import type { Timeframe } from "@/lib/market-data/types";
import type { ChartPendingOrderView, ChartPositionView, ChartTradeFill } from "@/components/pro-scalping-terminal/chart-settings";
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
  /** Every closed trade, oldest first — full-set statistics for the panel. */
  closedTrades: ChallengeTrade[];
  recentEvents: ChallengeEvent[];
  guardian: GuardianInsight[];
  requirements: PassRequirement[];
  report: PerformanceReport | null;
  quoteProvider: string | null;
  pendingOrders: ChallengePendingOrder[];
  updatedAt: number;
}

const POLL_MS = 10_000;

const ACCOUNT_ARENA_INTERVAL_TO_TIMEFRAME: Record<string, Timeframe> = {
    "1m": "M1",
    "5m": "M5",
    "15m": "M15",
    "30m": "M30",
    "1h": "H1",
    "3m": "M5",
    "4h": "H4",
};
const ARENA_TIMEFRAME_TO_INTERVAL: Partial<Record<Timeframe, string>> = {
    M1: "1m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
};
function accountIntervalToTimeframe(interval: string): Timeframe {
    return ACCOUNT_ARENA_INTERVAL_TO_TIMEFRAME[interval] ?? "M5";
}

export default function AccountChallengeDashboardPage() {
  const params = useParams<{ attemptId: string }>();
  const router = useRouter();
  const token = useAuthToken();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [state, setState] = useState<AttemptState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState("XAUUSD");
  const [chartInterval, setChartInterval] = useState("15m");
  // Wall clock in state: reading Date.now() during render makes the component
  // non-idempotent, and these panels poll, so quote freshness must be a pure
  // function of props + state.
  const [now, setNow] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<"positions" | "orders" | "history" | "guardian">("positions");
  const [cancelling, setCancelling] = useState(false);
  // Partial close is a dialog, not a single ambiguous percentage: the trader
  // picks VOLUME (% of size) or PROFIT (% of the open profit) and confirms a
  // server-priced plan.
  const [partialClose, setPartialClose] = useState<{ trade: MarkedTrade; mode: "VOLUME" | "PROFIT_PRESERVATION"; percent: number } | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        router.replace(`/login?redirect=/account/performance-arena/attempts/${params.attemptId}`);
      }
    });
    return () => unsub();
  }, [router, params.attemptId]);

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
    const kick = setTimeout(() => void load(), 0);
    return () => clearTimeout(kick);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // `percent` is what the chart's trade strip sends (25/50/75/100). Omit it for
  // a full close so the server keeps its own default.
  const onClosePosition = useCallback(
    async (tradeId: string, percent?: number): Promise<void> => {
      if (!token) return;
      const partial = percent !== undefined && percent < 100;
      const res = await fetch(`/api/performance-arena/attempts/${params.attemptId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "close",
          tradeId,
          ...(partial ? { percent } : {}),
          clientRequestId: `close_${tradeId}_${Date.now()}`,
        }),
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

  // Interval only — the first tick establishes the clock. Until then `now` is
  // null and quote freshness reads as indeterminate, never as a false "live".
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 2_000);
    return () => window.clearInterval(timer);
  }, []);

  // The chart owns the symbol and reports it back; the policy owns the allowed
  // list. FALL BACK during render instead of writing state from an effect, so a
  // policy change can never leave the chart and the ticket on different
  // instruments for a render (or forever, if the effect deps were wrong).
  const effectiveSymbol = symbols.length > 0 && !symbols.includes(chartSymbol) ? symbols[0] : chartSymbol;

  // ── Chart view models ────────────────────────────────────────────────
  // The chart draws entry/SL/TP levels itself from these views (with its own
  // trade strip and one-tap partial closes), so the page no longer hand-rolls
  // price lines and marker times.
  const chartPositions = useMemo<ChartPositionView[]>(() => (state?.openPositions ?? []).map(({ trade, markPriceMicros, unrealizedPnLCents }) => ({
    ticket: trade.tradeId,
    symbol: trade.symbol,
    side: trade.side === "long" ? "BUY" : "SELL",
    volume: trade.sizeCentiLots / 100,
    entry: priceMicrosToNumber(trade.entryPriceMicros),
    ...(markPriceMicros !== null ? { current: priceMicrosToNumber(markPriceMicros) } : {}),
    sl: trade.stopLossMicros !== null ? priceMicrosToNumber(trade.stopLossMicros) : null,
    tp: trade.takeProfitMicros !== null ? priceMicrosToNumber(trade.takeProfitMicros) : null,
    profit: unrealizedPnLCents / 100,
    openedAt: trade.entryAt,
  })), [state?.openPositions]);

  const chartPendingOrders = useMemo<ChartPendingOrderView[]>(() => (state?.pendingOrders ?? [])
    .filter((order) => order.status === "pending" || order.status === "processing")
    .map((order) => ({
      ticket: order.orderId,
      symbol: order.symbol,
      type: `${order.side === "long" ? "BUY" : "SELL"}_${order.orderType.toUpperCase()}` as ChartPendingOrderView["type"],
      volume: order.sizeCentiLots / 100,
      price: priceMicrosToNumber(order.entryPriceMicros),
      sl: order.stopLossMicros !== null ? priceMicrosToNumber(order.stopLossMicros) : null,
      tp: order.takeProfitMicros !== null ? priceMicrosToNumber(order.takeProfitMicros) : null,
      status: order.status,
    })), [state?.pendingOrders]);

  // Real fills only — an entry and, once closed, its exit. Times are the actual
  // server fill timestamps (no interval bucketing: markers must not be moved
  // onto bar boundaries or they land on the wrong candle).
  const chartTradeHistory = useMemo<ChartTradeFill[]>(() => (state?.recentTrades ?? []).flatMap((trade) => {
    const size = trade.sizeCentiLots / 100;
    const entry: ChartTradeFill = {
      id: `${trade.tradeId}:entry`,
      symbol: trade.symbol,
      time: trade.entryAt,
      price: priceMicrosToNumber(trade.entryPriceMicros),
      side: trade.side === "long" ? "buy" : "sell",
      kind: "entry",
      volume: size,
      label: `${trade.side === "long" ? "BUY" : "SELL"} ${size.toFixed(2)}`,
    };
    if (trade.exitPriceMicros === null || trade.closedAt === null) return [entry];
    const pnl = trade.realizedPnLCents ?? 0;
    const fullClose = trade.exitReason !== "partial_close";
    return [
      entry,
      {
        id: `${trade.tradeId}:exit`,
        symbol: trade.symbol,
        time: trade.closedAt,
        price: priceMicrosToNumber(trade.exitPriceMicros),
        side: "unknown" as const,
        kind: fullClose ? "exit" : "partial",
        volume: size,
        profit: pnl / 100,
        label: `${fullClose ? "Close" : "Partial"} · ${pnl >= 0 ? "+" : ""}${formatCents(pnl)}`,
      },
    ];
  }), [state?.recentTrades]);

  const liveQuoteState = useLiveQuote([effectiveSymbol], 2_000);
  const chartQuote = liveQuoteState.quotes[effectiveSymbol] ?? null;

  const modifyStops = useCallback(async (tradeId: string, stops: { stopLoss?: number | null; takeProfit?: number | null }) => {
    if (!token) throw new Error("Sign in required.");
    const res = await fetch(`/api/performance-arena/attempts/${params.attemptId}/orders`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "modifyStops", tradeId, stopLossProvided: stops.stopLoss !== undefined, takeProfitProvided: stops.takeProfit !== undefined, stopLoss: stops.stopLoss ?? null, takeProfit: stops.takeProfit ?? null }),
    });
    if (!res.ok) { const body = await res.json() as { error?: string }; throw new Error(body.error ?? "Could not update stop/target."); }
    await load();
  }, [token, params.attemptId, load]);

  const cancelPending = useCallback(async (orderId: string): Promise<void> => {
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

  if (user === undefined) return null;
  if (user === null) {
    return (
      <AccountShell title="Challenge Dashboard">
        <ArenaLoading label="Redirecting to login…" />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title={state ? `Challenge · ${state.attempt.definitionKey}` : "Challenge"}
      subtitle="Simulated environment — virtual capital, server-authoritative accounting."
      eyebrow={<SimulatedBadge />}
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
          {/* Header metrics */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
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

          {/* Progress bars + checklist */}
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

          {/* Equity curve, daily P&L and trade statistics. */}
          <div className="mb-3">
            <PerformancePanel metrics={state.metrics} closedTrades={state.closedTrades ?? []} />
          </div>

          {/* Report (settled) */}
          {state.report ? (
            <div className="mb-3">
              <AttemptReport report={state.report} />
            </div>
          ) : null}

          {/* Chart + trading */}
          <div className="mb-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
                <label className="sr-only" htmlFor="arena-chart-symbol">Chart symbol</label>
                <select id="arena-chart-symbol" value={effectiveSymbol} onChange={(event) => setChartSymbol(event.target.value)} className="max-w-44 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground">
                  {symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol} · {marketOfSymbol(symbol)}</option>)}
                </select>
                <div className="flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                  <span>{chartInterval.toUpperCase()} · Pro Terminal chart</span>
                  <span className="rounded border border-border px-2 py-1" title={chartQuote ? `Quote timestamp ${new Date(chartQuote.timestamp).toLocaleTimeString()}` : "No current quote"}>{chartQuote && now !== null && now - chartQuote.timestamp <= 60_000 ? chartQuote.price.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "Quote unavailable / stale"}</span>
                  <span aria-label="Chart marker legend" className="hidden sm:inline">Entry / SL / TP levels</span>
                </div>
              </div>
              {/* The shared Pro Terminal chart workspace gives this page
                  the same engine, drawing tools, layer picker, fullscreen
                  and per-symbol persistence as every other page. It owns the
                  symbol/timeframe state and reports changes back, so the order
                  ticket below always quotes the instrument on screen. */}
              <ProTerminalChartWorkspace
                initialSymbol={effectiveSymbol}
                initialTimeframe={accountIntervalToTimeframe(chartInterval)}
                onSymbolChange={setChartSymbol}
                onTimeframeChange={(tf) => setChartInterval(ARENA_TIMEFRAME_TO_INTERVAL[tf] ?? chartInterval)}
                token={token}
                positions={chartPositions}
                pendingOrders={chartPendingOrders}
                tradeHistory={chartTradeHistory}
                onClosePosition={(ticket, pct) => void onClosePosition(ticket, pct)}
                onCancelOrder={(ticket) => void cancelPending(ticket)}
                height={500}
                hideWatchlist
                storageScope={`account-arena-${state.attempt.id ?? "default"}`}
              />
            </div>

            <div className="space-y-3">
              <OrderTicket
                attemptId={state.attempt.id}
                symbols={symbols}
                disabled={!active}
                maxLots={policy.positionSizePolicy.maxSizeLots}
                policyStepLots={policy.positionSizePolicy.stepLots}
                selectedSymbol={effectiveSymbol}
                onSymbolChange={setChartSymbol}
                currentQuote={chartQuote}
                policy={policy}
                metrics={state.metrics}
                onPlaced={() => void load()}
              />
              <div className="hidden xl:block"><GuardianPanel attemptId={state.attempt.id} insights={state.guardian} onStateChange={() => void load()} /></div>
            </div>
          </div>

          {/* Compact bottom terminal: one active panel avoids stacking every data table on mobile. */}
          <section className="mb-3 min-w-0 overflow-hidden rounded-lg border border-border bg-card" aria-label="Trading activity">
            <div className="flex overflow-x-auto border-b border-border" role="tablist" aria-label="Trading activity panels">
              {(["positions", "orders", "history", "guardian"] as const).map((panel) => (
                <button key={panel} type="button" role="tab" aria-selected={activePanel === panel} onClick={() => setActivePanel(panel)} className={`shrink-0 px-4 py-3 text-xs font-medium capitalize ${activePanel === panel ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {panel}{panel === "positions" ? ` (${state.openPositions.length})` : panel === "orders" ? ` (${state.pendingOrders.filter((order) => order.status === "pending" || order.status === "processing").length})` : ""}
                </button>
              ))}
            </div>
            <div className="min-w-0 p-3 sm:p-4" role="tabpanel">
              {activePanel === "positions" ? <PositionsTable positions={state.openPositions} canClose={canManagePositions} canModifyStops={active} onClose={onClosePosition} onPartialClose={(marked, mode, pct) => setPartialClose({ trade: marked, mode, percent: pct })} onModifyStops={modifyStops} /> : null}
              {activePanel === "orders" ? <PendingOrdersTable orders={state.pendingOrders} canCancel={canCancelPendingOrders} onCancel={cancelPending} /> : null}
              {activePanel === "history" ? <RecentTradesTable trades={state.recentTrades} /> : null}
              {activePanel === "guardian" ? <GuardianPanel attemptId={state.attempt.id} insights={state.guardian} onStateChange={() => void load()} /> : null}
            </div>
          </section>

          <PartialCloseDialog
            key={`${partialClose?.trade.trade.tradeId ?? "none"}_${partialClose?.mode ?? "PROFIT_PRESERVATION"}_${partialClose?.percent ?? 50}`}
            trade={partialClose?.trade ?? null}
            attemptId={state.attempt.id}
            token={token}
            open={partialClose !== null}
            onOpenChange={(open) => { if (!open) setPartialClose(null); }}
            onClosed={() => void load()}
            initialMode={partialClose?.mode ?? "PROFIT_PRESERVATION"}
            initialPercent={partialClose?.percent ?? 50}
          />

          <ArenaDisclaimer>{ARENA_DISCLAIMERS.simulated} {ARENA_DISCLAIMERS.challengeScope}</ArenaDisclaimer>
        </>
      ) : null}
    </AccountShell>
  );
}
