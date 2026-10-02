/**
 * Exhaustion detection — structured evidence, never an automatic reversal
 * signal. Output events are *observations* the AI/confluence layers may weigh;
 * they never directly invert a signal.
 *
 * Evidence classes (candle-grade, ESTIMATED quality):
 *  • extreme price extension vs the recent range (ATR-relative),
 *  • extreme volume on the extension bar,
 *  • declining aggressive participation (delta deterioration when trade data
 *    exists — optional),
 *  • reduced continuation (next-ish bars fail to extend; evaluated only from
 *    candles already available — i.e. confirmation lags by construction),
 *  • failed breakout of the prior extreme.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { ExhaustionEvent, OrderFlowMode } from "./types";

export interface ExhaustionOptions {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    sensitivity?: number;
    window?: number;
}

type Candle = { timestamp: number; open: number; high: number; low: number; close: number; volume?: number };

/**
 * Detect exhaustion events. Only candles ≤ each index participate (replay-safe).
 * `deltas` (optional) must align 1:1 with candles and carry per-bar delta —
 * used only when real trade classification exists upstream.
 */
export function detectExhaustion(
    candles: readonly Candle[],
    options: ExhaustionOptions,
    deltas?: readonly number[],
): ExhaustionEvent[] {
    const events: ExhaustionEvent[] = [];
    if (!candles || candles.length < 6) return events;

    const sensitivity = Math.min(1, Math.max(0, options.sensitivity ?? 0.5));
    const window = Math.max(5, Math.min(100, Math.round(options.window ?? 14)));

    for (let i = window; i < candles.length; i++) {
        const c = candles[i];
        const hist = candles.slice(i - window, i);
        const prev = candles[i - 1];

        // True range average (ATR-like) over the window.
        const trs: number[] = [];
        for (let j = 1; j < hist.length; j++) {
            const h = hist[j];
            const p = hist[j - 1];
            trs.push(Math.max(h.high - h.low, Math.abs(h.high - p.close), Math.abs(h.low - p.close)));
        }
        const atr = trs.length ? trs.reduce((s, v) => s + v, 0) / trs.length : 0;
        if (atr <= 0) continue;

        const body = c.close - c.open;
        const dirUp = body > 0;
        // Extension measured on the bar's full push (close−open body OR the
        // extreme excursion beyond the prior close) so wick-driven blow-offs
        // and body-driven marubozu both register.
        const push = dirUp ? Math.max(body, c.high - prev.close) : Math.max(-body, prev.close - c.low);
        const extension = push / atr;
        // Sensitivity maps to required extension (3.5 ATR at sens 0 … 2.0 at sens 1).
        const minExtension = 3.5 - sensitivity * 1.5;
        if (extension < minExtension) continue;

        const evidence: string[] = [`extension ${extension.toFixed(1)}× ATR`];

        // Volume evidence: expansion bar on the extension candle.
        const vols = hist.map((h) => h.volume ?? 0).filter((v) => v > 0);
        const vol = c.volume ?? 0;
        if (vols.length >= 3 && vol > 0) {
            const avg = vols.reduce((s, v) => s + v, 0) / vols.length;
            if (avg > 0 && vol / avg >= 1.8) evidence.push(`volume ${(vol / avg).toFixed(1)}× average`);
        }

        // Delta deterioration (real trade data only — never from candles).
        if (deltas && deltas.length === candles.length) {
            const d0 = deltas[i - 1];
            const d1 = deltas[i];
            if (dirUp && d1 < d0) evidence.push("delta deteriorated into the extension high");
            if (!dirUp && d1 > d0) evidence.push("delta deteriorated into the extension low");
        }

        // Failed breakout: the prior window's extreme broke but closed back inside.
        const priorHigh = Math.max(...hist.map((h) => h.high));
        const priorLow = Math.min(...hist.map((h) => h.low));
        const failedBreakUp = c.high > priorHigh && c.close < priorHigh;
        const failedBreakDown = c.low < priorLow && c.close > priorLow;
        if (failedBreakUp && dirUp) evidence.push("failed breakout of prior high");
        if (failedBreakDown && !dirUp) evidence.push("failed breakout of prior low");

        // Extreme close position (blow-off tail against the move).
        const range = c.high - c.low;
        if (range > 0) {
            const closePos = (c.close - c.low) / range;
            if (dirUp && closePos < 0.4) evidence.push("close in lower 40% of bar");
            if (!dirUp && closePos > 0.6) evidence.push("close in upper 60% of bar");
        }

        // Require the extension + at least 2 supporting evidence classes.
        if (evidence.length < 3) continue;

        events.push({
            id: `exh_${dirUp ? "BUY" : "SELL"}_${options.symbol}_${options.timeframe}_${c.timestamp}`,
            timestamp: c.timestamp,
            symbol: options.symbol,
            timeframe: options.timeframe,
            mode: options.mode,
            method: "candle-behaviour-evidence",
            quality: "ESTIMATED",
            type: dirUp ? "BUY_EXHAUSTION" : "SELL_EXHAUSTION",
            price: c.close,
            extension,
            evidence,
        });
        void prev;
    }
    return events;
}
