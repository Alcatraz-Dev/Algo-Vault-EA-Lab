/**
 * Backtest analytics (Phase 4).
 *
 * Every number derives from executed trades or the equity curve. Anything
 * that cannot be computed reliably returns null / is flagged INSUFFICIENT_DATA
 * instead of being fabricated.
 *
 * Added on top of the existing Strategy Lab `computeMetrics` (which stays the
 * canonical source for core trade statistics): MAE/MFE, session/regime/time
 * segmentation, drawdown period attribution, daily/monthly P&L, payoff,
 * Sortino and Calmar.
 */

import type { MarketCandle } from "@/lib/market-data/types";
import type { BacktestTrade, EquityPoint } from "@/lib/strategy-lab/types";

export const INSUFFICIENT_DATA = "INSUFFICIENT_DATA";

// ─────────────────────────────────────────────────────────────────────────────
// MAE / MFE
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeExcursion {
    tradeId: string;
    /** Max adverse excursion in price units (favorable for the position). */
    mae: number;
    mfe: number;
    /** Excursions normalized by the initial stop distance (R multiples). */
    maeR: number | null;
    mfeR: number | null;
}

/**
 * Compute MAE/MFE per trade from the OHLC bars between entry and exit.
 * Deterministic and causal — uses only bars the trade actually lived through.
 */
export function computeExcursions(
    trades: BacktestTrade[],
    candles: MarketCandle[]
): TradeExcursion[] {
    return trades.map((t) => {
        let mae = 0;
        let mfe = 0;
        const start = Math.max(0, t.openBarIndex);
        const end = Math.min(candles.length - 1, t.closeBarIndex);
        const isLong = t.direction === "BUY";
        for (let i = start; i <= end; i++) {
            const c = candles[i];
            if (!c) continue;
            const adverse = isLong ? t.entry - c.low : c.high - t.entry;
            const favorable = isLong ? c.high - t.entry : t.entry - c.low;
            mae = Math.max(mae, adverse);
            mfe = Math.max(mfe, favorable);
        }
        const stopDistance = Math.abs(t.entry - t.sl);
        return {
            tradeId: t.id,
            mae: round(mae),
            mfe: round(mfe),
            maeR: stopDistance > 0 ? round(mae / stopDistance) : null,
            mfeR: stopDistance > 0 ? round(mfe / stopDistance) : null,
        };
    });
}

export interface ExcursionSummary {
    avgMae: number | null;
    avgMfe: number | null;
    avgMaeR: number | null;
    avgMfeR: number | null;
    worstMae: number | null;
    bestMfe: number | null;
    status: "ok" | typeof INSUFFICIENT_DATA;
}

export function summarizeExcursions(excursions: TradeExcursion[]): ExcursionSummary {
    if (excursions.length === 0) {
        return { avgMae: null, avgMfe: null, avgMaeR: null, avgMfeR: null, worstMae: null, bestMfe: null, status: INSUFFICIENT_DATA };
    }
    const withR = excursions.filter((e) => e.maeR !== null && e.mfeR !== null);
    return {
        avgMae: round(avg(excursions.map((e) => e.mae))),
        avgMfe: round(avg(excursions.map((e) => e.mfe))),
        avgMaeR: withR.length > 0 ? round(avg(withR.map((e) => e.maeR as number))) : null,
        avgMfeR: withR.length > 0 ? round(avg(withR.map((e) => e.mfeR as number))) : null,
        worstMae: round(Math.max(...excursions.map((e) => e.mae))),
        bestMfe: round(Math.max(...excursions.map((e) => e.mfe))),
        status: "ok",
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Segmentation (session / regime / hour / day of week)
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupPerformance {
    key: string;
    trades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    netProfit: number;
    profitFactor: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    maxDrawdownPct: number | null;
    status: "ok" | typeof INSUFFICIENT_DATA;
}

/** Group trades by an arbitrary key and compute performance per group. */
export function segmentPerformance(
    trades: BacktestTrade[],
    keyOf: (t: BacktestTrade) => string
): GroupPerformance[] {
    const groups = new Map<string, BacktestTrade[]>();
    for (const t of trades) {
        const key = keyOf(t);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(t);
    }

    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => {
        const wins = list.filter((t) => t.pnlGross > 0);
        const losses = list.filter((t) => t.pnlGross < 0);
        const grossProfit = sum(wins.map((t) => t.pnlGross));
        const grossLoss = Math.abs(sum(losses.map((t) => t.pnlGross)));
        const net = sum(list.map((t) => t.pnlGross));
        return {
            key,
            trades: list.length,
            winningTrades: wins.length,
            losingTrades: losses.length,
            winRate: list.length > 0 ? round((wins.length / list.length) * 100) : 0,
            netProfit: round(net),
            profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
            avgWin: wins.length > 0 ? round(avg(wins.map((t) => t.pnlGross))) : null,
            avgLoss: losses.length > 0 ? round(avg(losses.map((t) => t.pnlGross))) : null,
            maxDrawdownPct: groupMaxDrawdownPct(list),
            status: list.length >= 1 ? "ok" : INSUFFICIENT_DATA,
        };
    });
}

/**
 * Max closed-trade equity decline inside a group (approximation documented:
 * computed from the group's own trade P&L sequence, not the full equity curve).
 */
function groupMaxDrawdownPct(list: BacktestTrade[]): number | null {
    let equity = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of list) {
        equity += t.pnlGross;
        peak = Math.max(peak, equity);
        maxDd = Math.max(maxDd, peak - equity);
    }
    return peak > 0 ? round((maxDd / peak) * 100) : maxDd > 0 ? null : 0;
}

export function bySession(trades: BacktestTrade[]): GroupPerformance[] {
    return segmentPerformance(trades, (t) => t.session || "unknown");
}

export function byRegime(trades: BacktestTrade[]): GroupPerformance[] {
    return segmentPerformance(trades, (t) => t.regime || "unknown");
}

export function byHourOfDay(trades: BacktestTrade[]): GroupPerformance[] {
    return segmentPerformance(trades, (t) => `${new Date(t.closedAt).getUTCHours()} UTC`);
}

export function byDayOfWeek(trades: BacktestTrade[]): GroupPerformance[] {
    return segmentPerformance(trades, (t) => {
        const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return names[new Date(t.closedAt).getUTCDay()];
    });
}

export function byDirection(trades: BacktestTrade[]): GroupPerformance[] {
    return segmentPerformance(trades, (t) => t.direction);
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawdown analytics with trade attribution
// ─────────────────────────────────────────────────────────────────────────────

export interface DrawdownPeriod {
    start: number;
    end: number;
    startEquity: number;
    troughEquity: number;
    troughIndex: number;
    depthAbs: number;
    depthPct: number;
    durationBars: number;
    recovered: boolean;
    /** Trades whose P&L happened inside this period (click-to-inspect). */
    tradeIds: string[];
}

/** Underwater periods of the equity curve with the trades responsible. */
export function drawdownPeriods(equity: EquityPoint[], trades: BacktestTrade[]): DrawdownPeriod[] {
    const periods: DrawdownPeriod[] = [];
    let peak = equity.length > 0 ? equity[0].equity : 0;
    let peakIdx = 0;
    let inDrawdown = false;
    let trough = peak;
    let troughIdx = 0;

    for (let i = 0; i < equity.length; i++) {
        const e = equity[i];
        if (e.equity >= peak) {
            if (inDrawdown) {
                periods.push(makePeriod(peakIdx, troughIdx, i - 1, peak, trough, equity, trades, true));
                inDrawdown = false;
            }
            peak = e.equity;
            peakIdx = i;
        } else {
            if (!inDrawdown) {
                inDrawdown = true;
                trough = e.equity;
                troughIdx = i;
            } else if (e.equity < trough) {
                trough = e.equity;
                troughIdx = i;
            }
        }
    }
    if (inDrawdown) {
        periods.push(makePeriod(peakIdx, troughIdx, equity.length - 1, peak, trough, equity, trades, false));
    }

    return periods.sort((a, b) => b.depthPct - a.depthPct);
}

function makePeriod(
    peakIdx: number,
    troughIdx: number,
    endIdx: number,
    peak: number,
    trough: number,
    equity: EquityPoint[],
    trades: BacktestTrade[],
    recovered: boolean
): DrawdownPeriod {
    const startTime = equity[peakIdx]?.time ?? 0;
    const endTime = equity[endIdx]?.time ?? startTime;
    const depthAbs = round(peak - trough);
    const tradeIds = trades
        .filter((t) => t.closedAt >= startTime && t.closedAt <= endTime)
        .map((t) => t.id);
    return {
        start: peakIdx,
        end: endIdx,
        startEquity: peak,
        troughEquity: trough,
        troughIndex: troughIdx,
        depthAbs,
        depthPct: peak > 0 ? round((depthAbs / peak) * 100) : 0,
        durationBars: endIdx - peakIdx,
        recovered,
        tradeIds,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily / monthly P&L
// ─────────────────────────────────────────────────────────────────────────────

export interface PnlBucket {
    key: string; // YYYY-MM-DD or YYYY-MM
    net: number;
    trades: number;
    wins: number;
}

export function dailyPnl(trades: BacktestTrade[]): PnlBucket[] {
    return bucket(trades, (t) => new Date(t.closedAt).toISOString().split("T")[0]);
}

export function monthlyPnl(trades: BacktestTrade[]): PnlBucket[] {
    return bucket(trades, (t) => new Date(t.closedAt).toISOString().slice(0, 7));
}

function bucket(trades: BacktestTrade[], keyOf: (t: BacktestTrade) => string): PnlBucket[] {
    const map = new Map<string, { net: number; trades: number; wins: number }>();
    for (const t of trades) {
        const k = keyOf(t);
        const cur = map.get(k) ?? { net: 0, trades: 0, wins: 0 };
        cur.net += t.pnlGross;
        cur.trades += 1;
        if (t.pnlGross > 0) cur.wins += 1;
        map.set(k, cur);
    }
    return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => ({ key, net: round(v.net), trades: v.trades, wins: v.wins }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Advanced metrics (null when not meaningful)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdvancedMetrics {
    /** Average win ÷ average loss. null without both sides. */
    payoffRatio: number | null;
    /** Downside-deviation-based annualized ratio on trade returns. */
    sortino: number | null;
    /** CAGR ÷ max drawdown. null without a multi-period equity curve. */
    calmar: number | null;
    avgDurationMs: number | null;
    status: "ok" | typeof INSUFFICIENT_DATA;
}

export function computeAdvancedMetrics(
    trades: BacktestTrade[],
    equity: EquityPoint[],
    initialBalance: number
): AdvancedMetrics {
    if (trades.length === 0) {
        return { payoffRatio: null, sortino: null, calmar: null, avgDurationMs: null, status: INSUFFICIENT_DATA };
    }
    const wins = trades.filter((t) => t.pnlGross > 0).map((t) => t.pnlGross);
    const losses = trades.filter((t) => t.pnlGross < 0).map((t) => t.pnlGross);
    const avgWin = wins.length > 0 ? avg(wins) : null;
    const avgLoss = losses.length > 0 ? Math.abs(avg(losses)) : null;
    const payoffRatio = avgWin !== null && avgLoss !== null && avgLoss > 0 ? round(avgWin / avgLoss) : null;

    let sortino: number | null = null;
    if (trades.length >= 5) {
        const returns = trades.map((t) => t.pnlGross / initialBalance);
        const mean = avg(returns);
        const downside = returns.filter((r) => r < 0);
        if (downside.length > 0) {
            const downsideDev = Math.sqrt(avg(downside.map((r) => r * r)));
            if (downsideDev > 0) sortino = round((mean / downsideDev) * Math.sqrt(returns.length));
        }
    }

    let calmar: number | null = null;
    if (equity.length >= 2 && initialBalance > 0) {
        const first = equity[0].equity;
        const last = equity[equity.length - 1].equity;
        const days = (equity[equity.length - 1].time - equity[0].time) / 86_400_000;
        const maxDd = Math.max(...equity.map((e) => e.drawdownPct));
        if (days > 0 && maxDd > 0 && first > 0) {
            const growth = Math.pow(last / first, 365 / days) - 1;
            calmar = round(growth / (maxDd / 100));
        }
    }

    return {
        payoffRatio,
        sortino,
        calmar,
        avgDurationMs: round(avg(trades.map((t) => t.durationMs))),
        status: "ok",
    };
}

// ─────────────────────────────────────────────────────────────────────────────

function sum(v: number[]): number {
    return v.reduce((a, b) => a + b, 0);
}
function avg(v: number[]): number {
    return v.length > 0 ? sum(v) / v.length : 0;
}
function round(v: number): number {
    return Number.isFinite(v) ? Number(v.toFixed(4)) : 0;
}
