"use client";

// Performance panel — equity curve + daily P&L + trade statistics.
//
// Everything plotted is a server-computed snapshot: `metrics.equityCurve`
// (persisted server-side, appended on each state read), the closed-trade list
// and the canonical metrics. This component only shapes and renders. It
// derives nothing that affects an order.
//
// Why daily P&L matters here specifically: prop evaluation is a function of
// *daily* loss, not total drawdown. A trader who is up overall but has already
// blown the daily allowance is failed. A single cumulative equity line hides
// exactly that, so the per-day bars are the primary readout here, not a
// secondary one.

import { useMemo } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { formatCents } from "@/lib/performance-arena/money";
import type { ChallengeMetrics, ChallengeTrade } from "@/lib/performance-arena/types";
import { KV } from "@/components/performance-arena/primitives";

export function PerformancePanel({
    metrics,
    closedTrades,
    className,
}: {
    metrics: ChallengeMetrics;
    closedTrades: ChallengeTrade[];
    className?: string;
}) {
    const curve = useMemo(() => {
        const points = metrics.equityCurve ?? [];
        // Anchor the line at the starting balance so a challenge with no
        // history yet still draws a flat line from day one instead of an empty
        // box. A chart that appears to start mid-flight is misleading.
        const first = points[0];
        const baseline = first && first.t > metrics.asOf ? first : { t: first?.t ?? metrics.asOf, equityCents: metrics.startingBalanceCents };
        return points.length > 0 && points[0].t <= baseline.t ? points : [baseline, ...points];
    }, [metrics.equityCurve, metrics.startingBalanceCents, metrics.asOf]);

    const daily = useMemo(() => buildDailyPnl(metrics, closedTrades), [metrics, closedTrades]);

    const stats = useMemo(() => tradeStats(closedTrades), [closedTrades]);

    const hasCurve = curve.length > 1;
    const hasDaily = daily.length > 0;

    return (
        <section className={className} aria-label="Performance">
            <div className="grid gap-3 lg:grid-cols-3">
                {/* ── Equity curve ─────────────────────────────────────── */}
                <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-sm font-semibold">Equity curve</h3>
                        <span className="font-mono text-xs text-muted-foreground">
                            {formatCents(metrics.equityCents)} now · {metrics.totalReturnPct >= 0 ? "+" : ""}
                            {metrics.totalReturnPct.toFixed(2)}% · peak {formatCents(metrics.peakEquityCents)}
                        </span>
                    </div>
                    {hasCurve ? (
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={curve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="t"
                                    type="number"
                                    domain={["dataMin", "dataMax"]}
                                    tickFormatter={(v) => new Date(Number(v)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                    stroke="var(--muted-foreground)"
                                    fontSize={10}
                                    minTickGap={24}
                                />
                                <YAxis
                                    type="number"
                                    domain={["auto", "auto"]}
                                    tickFormatter={(v) => `$${(Number(v) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                                    stroke="var(--muted-foreground)"
                                    fontSize={10}
                                    width={56}
                                />
                                <Tooltip
                                    content={<EquityTooltip />}
                                    labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                                />
                                {/* The starting balance is the pass/fail line:
                                    above it the target is in reach, below it the
                                    drawdown clock is already running. */}
                                <ReferenceLine
                                    y={metrics.startingBalanceCents}
                                    stroke="var(--muted-foreground)"
                                    strokeDasharray="4 4"
                                    label={{ value: "start", position: "insideTopRight", fontSize: 9, fill: "var(--muted-foreground)" }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="equityCents"
                                    stroke="var(--chart-1)"
                                    strokeWidth={1.5}
                                    dot={false}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="py-10 text-center text-xs text-muted-foreground">
                            Equity history builds as the challenge is monitored. Place a trade to start the curve.
                        </p>
                    )}
                </div>

                {/* ── Daily P&L ────────────────────────────────────────── */}
                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-sm font-semibold">Daily P&amp;L</h3>
                        <span className="font-mono text-xs text-muted-foreground">
                            {metrics.dailyLossUsedPct > 0
                                ? `${metrics.dailyLossUsedPct.toFixed(0)}% of daily loss limit used`
                                : "no daily loss yet"}
                        </span>
                    </div>
                    {hasDaily ? (
                        <ResponsiveContainer width="100%" height={140}>
                            <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="dayKey"
                                    tickFormatter={(v) => String(v).slice(5)}
                                    stroke="var(--muted-foreground)"
                                    fontSize={10}
                                    minTickGap={8}
                                />
                                <YAxis
                                    type="number"
                                    tickFormatter={(v) => `$${(Number(v) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                                    stroke="var(--muted-foreground)"
                                    fontSize={10}
                                    width={52}
                                />
                                <Tooltip content={<DailyTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                                {/* Zero is the daily-loss line: a bar below it is
                                    drawn against the allowance, not the balance. */}
                                <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                                <Bar dataKey="pnlCents" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                                    {daily.map((d) => (
                                        <Cell key={d.dayKey} fill={d.pnlCents >= 0 ? "var(--chart-1)" : "var(--destructive)"} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="py-8 text-center text-xs text-muted-foreground">No closed trades yet.</p>
                    )}
                    <p className="mt-2 text-micro text-muted-foreground">
                        Day P&amp;L is measured against that day&apos;s opening equity — the base the daily loss rule uses.
                    </p>
                </div>

                {/* ── Trade statistics ─────────────────────────────────── */}
                <div className="rounded-lg border border-border bg-card p-4 lg:col-span-3">
                    <h3 className="mb-2 text-sm font-semibold">Trade statistics</h3>
                    {stats.closed === 0 ? (
                        <p className="text-xs text-muted-foreground">Statistics appear after the first closed trade.</p>
                    ) : (
                        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                                <KV label="Closed trades" value={stats.closed} />
                                <KV label="Wins / losses" value={`${stats.wins} / ${stats.losses}`} />
                                <KV label="Win rate" value={`${stats.winRatePct.toFixed(1)}%`} />
                            </div>
                            <div>
                                <KV label="Profit factor" value={stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)} />
                                <KV label="Expectancy" value={formatCents(stats.expectancyCents)} />
                                <KV label="Total fees" value={formatCents(stats.feesCents)} />
                            </div>
                            <div>
                                <KV label="Best trade" value={<span className="text-positive">{formatCents(stats.bestCents)}</span>} />
                                <KV label="Worst trade" value={<span className="text-negative">{formatCents(stats.worstCents)}</span>} />
                                <KV label="Avg win / loss" value={`${formatCents(stats.avgWinCents)} / ${formatCents(stats.avgLossCents)}`} />
                            </div>
                            <div>
                                <KV label="Longest win streak" value={stats.longestWinStreak} />
                                <KV label="Longest loss streak" value={stats.longestLossStreak} />
                                <KV label="Max drawdown" value={`${metrics.currentDrawdownPct.toFixed(2)}%`} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

// ── Daily P&L ─────────────────────────────────────────────────────────────

/**
 * Per-UTC-day realized P&L, newest last.
 *
 * Derived from closed trades (their realized P&L, which is already net of
 * spread/slippage/commission server-side), grouped by the day the trade CLOSED
 * — the day the loss actually hit the account. Days with no close still appear
 * as zero when an equity-curve point covers them, so an unprofitable quiet day
 * is visible instead of vanishing from the chart.
 */
function buildDailyPnl(metrics: ChallengeMetrics, closedTrades: ChallengeTrade[]): Array<{ dayKey: string; pnlCents: number }> {
    const byDay = new Map<string, number>();
    for (const trade of closedTrades) {
        if (trade.closedAt === null || trade.realizedPnLCents === null) continue;
        const key = dayKeyOf(trade.closedAt);
        byDay.set(key, (byDay.get(key) ?? 0) + trade.realizedPnLCents);
    }
    // Include every day the account was open, so flat days are not skipped.
    for (const point of metrics.equityCurve ?? []) byDay.set(dayKeyOf(point.t), byDay.get(dayKeyOf(point.t)) ?? 0);
    byDay.set(dayKeyOf(metrics.asOf), byDay.get(dayKeyOf(metrics.asOf)) ?? 0);

    return Array.from(byDay.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([dayKey, pnlCents]) => ({ dayKey, pnlCents }));
}

function dayKeyOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

// ── Trade statistics ──────────────────────────────────────────────────────

interface TradeStats {
    closed: number;
    wins: number;
    losses: number;
    winRatePct: number;
    /** Gross profit ÷ gross loss; null when there are no losses to divide by. */
    profitFactor: number | null;
    expectancyCents: number;
    feesCents: number;
    bestCents: number;
    worstCents: number;
    avgWinCents: number;
    avgLossCents: number;
    longestWinStreak: number;
    longestLossStreak: number;
}

/**
 * Performance statistics over CLOSED trades only. Open positions are excluded
 * on purpose: an unrealised number is not a result, and letting it float into
 * a win-rate figure makes the statistic move without any trade happening.
 */
function tradeStats(closedTrades: ChallengeTrade[]): TradeStats {
    const closed = closedTrades
        .filter((trade) => trade.status === "closed" && trade.realizedPnLCents !== null)
        .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));

    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let fees = 0;
    let best = 0;
    let worst = 0;
    let winStreak = 0;
    let lossStreak = 0;
    let longestWin = 0;
    let longestLoss = 0;

    for (const trade of closed) {
        const pnl = trade.realizedPnLCents ?? 0;
        fees += trade.costs.spreadCostCents + trade.costs.slippageCostCents + trade.costs.commissionCents;
        if (pnl > 0) {
            wins += 1;
            grossProfit += pnl;
            best = Math.max(best, pnl);
            winStreak += 1;
            lossStreak = 0;
        } else if (pnl < 0) {
            losses += 1;
            grossLoss += -pnl;
            worst = Math.min(worst, pnl);
            lossStreak += 1;
            winStreak = 0;
        } else {
            winStreak = 0;
            lossStreak = 0;
        }
        longestWin = Math.max(longestWin, winStreak);
        longestLoss = Math.max(longestLoss, lossStreak);
    }

    const count = closed.length;
    return {
        closed: count,
        wins,
        losses,
        winRatePct: count > 0 ? (wins / count) * 100 : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
        expectancyCents: count > 0 ? Math.round((grossProfit - grossLoss) / count) : 0,
        feesCents: fees,
        bestCents: best,
        worstCents: worst,
        avgWinCents: wins > 0 ? Math.round(grossProfit / wins) : 0,
        avgLossCents: losses > 0 ? Math.round(grossLoss / losses) : 0,
        longestWinStreak: longestWin,
        longestLossStreak: longestLoss,
    };
}

// ── Tooltips ──────────────────────────────────────────────────────────────

function EquityTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: number }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
            <p className="font-mono tabular-nums text-foreground">{formatCents(Number(payload[0].value ?? 0))}</p>
            {label ? <p className="text-micro text-muted-foreground">{new Date(Number(label)).toLocaleString()}</p> : null}
        </div>
    );
}

function DailyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
    if (!active || !payload?.length) return null;
    const value = Number(payload[0].value ?? 0);
    return (
        <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
            <p className={value >= 0 ? "font-mono tabular-nums text-positive" : "font-mono tabular-nums text-negative"}>
                {value > 0 ? "+" : ""}
                {formatCents(value)}
            </p>
            {label ? <p className="text-micro text-muted-foreground">{label}</p> : null}
        </div>
    );
}
