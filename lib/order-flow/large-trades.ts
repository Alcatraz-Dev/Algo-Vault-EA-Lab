/**
 * Large trade detection — statistically significant trades relative to recent
 * activity. Requires the real trade tape; never derivable from candles.
 *
 * Threshold rules (any may fire; the event records which one):
 *  • absolute — size ≥ configured absolute threshold (when configured > 0),
 *  • percentile — size ≥ the P-th percentile of recent sizes,
 *  • rolling_multiple — size ≥ multiple × rolling average size.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { LargeTradeEvent, OrderFlowMode, OrderFlowTrade } from "./types";

export interface LargeTradeOptions {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    absoluteThreshold?: number;
    /** Percentile in (0.5, 1]. Default 0.98. */
    percentile?: number;
    /** Rolling-average multiple. Default 8. */
    rollingMultiple?: number;
    /** Rolling window (trade count). Default 200. */
    window?: number;
}

/** Nearest-rank percentile of a numeric array (deterministic). */
export function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx];
}

export function detectLargeTrades(trades: readonly OrderFlowTrade[], options: LargeTradeOptions): LargeTradeEvent[] {
    const events: LargeTradeEvent[] = [];
    if (!trades || trades.length === 0) return events;

    const abs = options.absoluteThreshold ?? 0;
    const p = Math.min(1, Math.max(0.5, options.percentile ?? 0.98));
    const mult = options.rollingMultiple ?? 8;
    const window = Math.max(20, Math.min(2000, Math.round(options.window ?? 200)));

    for (let i = 0; i < trades.length; i++) {
        const t = trades[i];
        const hist = trades.slice(Math.max(0, i - window), i).map((x) => x.size);
        const rules: Array<{ rule: "absolute" | "percentile" | "rolling_multiple"; value: number; threshold: number }> = [];

        if (abs > 0 && t.size >= abs) rules.push({ rule: "absolute", value: t.size, threshold: abs });
        if (hist.length >= 20) {
            const pctThreshold = percentile(hist, p);
            // Strictly greater: a trade at exactly the P98 of equal sizes is
            // not an outlier — this avoids firing on every uniform print.
            if (pctThreshold > 0 && t.size > pctThreshold) rules.push({ rule: "percentile", value: t.size, threshold: pctThreshold });
            const avg = hist.reduce((s, v) => s + v, 0) / hist.length;
            if (avg > 0 && t.size >= mult * avg) rules.push({ rule: "rolling_multiple", value: t.size, threshold: mult * avg });
        }
        if (rules.length === 0) continue;

        // Prefer the most specific rule for the event label.
        const chosen = rules.find((r) => r.rule === "absolute") ?? rules.find((r) => r.rule === "percentile") ?? rules[0];
        events.push({
            id: `large_${t.side.toUpperCase()}_${options.symbol}_${options.timeframe}_${t.timestamp}_${i}`,
            timestamp: t.timestamp,
            symbol: options.symbol,
            timeframe: options.timeframe,
            mode: options.mode,
            method: "trade-tape",
            quality: "HIGH",
            type: t.side === "buy" ? "LARGE_BUY" : "LARGE_SELL",
            price: t.price,
            size: t.size,
            thresholdRule: chosen.rule,
            thresholdValue: chosen.threshold,
        });
    }
    return events;
}
