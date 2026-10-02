/**
 * Tick classifier — fills the gap between "no side data" and "true aggressor
 * classification".
 *
 * When a provider supplies trades (price/size/time) but no side, the classical
 * tick rule / quote test labels each trade as buy- or sell-side. Results are
 * PARTIAL quality: they are real trade data with a documented, imperfect
 * classification method — never presented as true aggressor data, and never
 * fabricated from candles.
 */

import type { OrderFlowTrade } from "./types";

export type TradeClassificationMethod = "aggressor" | "tick_rule" | "quote_test" | "unclassified";

export interface ClassifiedTrade extends OrderFlowTrade {
    method: TradeClassificationMethod;
    confidence: number; // 0–1
}

/**
 * Classify trades with the tick rule: price up-tick → buy, down-tick → sell,
 * unchanged → inherit previous classification (classic zero-tick rule).
 * Confidence decays with consecutive zero-ticks.
 */
export function classifyByTickRule(trades: OrderFlowTrade[]): ClassifiedTrade[] {
    const out: ClassifiedTrade[] = [];
    let lastPrice: number | null = null;
    let lastSide: "buy" | "sell" | null = null;
    let zeroTicks = 0;

    for (const t of trades) {
        if (lastPrice === null) {
            out.push({ ...t, side: "buy", method: "unclassified", confidence: 0 });
            lastPrice = t.price;
            continue;
        }
        if (t.price > lastPrice) {
            out.push({ ...t, side: "buy", method: "tick_rule", confidence: 1 });
            lastSide = "buy";
            zeroTicks = 0;
        } else if (t.price < lastPrice) {
            out.push({ ...t, side: "sell", method: "tick_rule", confidence: 1 });
            lastSide = "sell";
            zeroTicks = 0;
        } else {
            // Zero tick — inherit previous side, decaying confidence.
            zeroTicks += 1;
            if (lastSide !== null) {
                out.push({ ...t, side: lastSide, method: "tick_rule", confidence: Math.max(0.2, 1 - 0.2 * zeroTicks) });
            } else {
                out.push({ ...t, side: "buy", method: "unclassified", confidence: 0 });
            }
        }
        lastPrice = t.price;
    }
    return out;
}

/**
 * Classify using best bid/ask at trade time (quote test / Lee–Ready style):
 * price above mid → buy, below mid → sell, at mid → tick-rule fallback.
 * `quotes` must be sorted by timestamp.
 */
export function classifyByQuoteTest(
    trades: OrderFlowTrade[],
    quotes: Array<{ timestamp: number; bid: number; ask: number }>,
): ClassifiedTrade[] {
    const out: ClassifiedTrade[] = [];
    if (quotes.length === 0) return classifyByTickRule(trades);

    let qIdx = 0;
    let lastPrice: number | null = null;
    let lastSide: "buy" | "sell" | null = null;

    for (const t of trades) {
        // Advance to the latest quote at or before the trade.
        while (qIdx < quotes.length - 1 && quotes[qIdx + 1].timestamp <= t.timestamp) qIdx += 1;
        const q = quotes[qIdx];
        if (!q || q.timestamp > t.timestamp || q.ask <= q.bid) {
            // No usable quote → tick-rule fallback for this trade.
            if (lastPrice !== null) {
                if (t.price > lastPrice) lastSide = "buy";
                else if (t.price < lastPrice) lastSide = "sell";
            }
            if (lastSide) out.push({ ...t, side: lastSide, method: "quote_test", confidence: 0.5 });
            else out.push({ ...t, side: "buy", method: "unclassified", confidence: 0 });
            lastPrice = t.price;
            continue;
        }
        const mid = (q.bid + q.ask) / 2;
        if (t.price > mid) {
            out.push({ ...t, side: "buy", method: "quote_test", confidence: 0.9 });
            lastSide = "buy";
        } else if (t.price < mid) {
            out.push({ ...t, side: "sell", method: "quote_test", confidence: 0.9 });
            lastSide = "sell";
        } else {
            // At mid — tick rule fallback.
            if (lastPrice !== null) {
                if (t.price > lastPrice) lastSide = "buy";
                else if (t.price < lastPrice) lastSide = "sell";
            }
            out.push({ ...t, ...(lastSide ? { side: lastSide, method: "quote_test", confidence: 0.6 } : { side: "buy", method: "unclassified", confidence: 0 }) });
        }
        lastPrice = t.price;
    }
    return out;
}

/** Aggregate classification quality for a batch. */
export function classificationQuality(trades: ClassifiedTrade[]): "HIGH" | "PARTIAL" | "UNAVAILABLE" {
    if (trades.length === 0) return "UNAVAILABLE";
    const withSide = trades.filter((t) => t.method !== "unclassified" && t.side !== undefined);
    const ratio = withSide.length / trades.length;
    if (trades.every((t) => t.method === "aggressor")) return "HIGH";
    if (ratio >= 0.5) return "PARTIAL";
    return "PARTIAL";
}
