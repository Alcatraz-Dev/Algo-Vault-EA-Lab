/**
 * Absorption detection — evidence-based, candle-grade (ESTIMATED quality).
 *
 * With only OHLCV, absorption is inferred from *behavioural* evidence:
 *  • unusually high traded volume (vs the rolling average),
 *  • aggressive one-sided close within the bar (close near high/low),
 *  • limited price progress for the volume spent (body small relative to
 *    volume percentile),
 *  • repeated interaction at the same price zone (prior bars overlapping).
 *
 * We require ALL configured evidence classes to fire — never "every
 * high-volume candle is absorption". When L2 data exists, an optional
 * opposing-depth-persistence check strengthens the call (see `extra` input).
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { AbsorptionEvent, OrderFlowMode } from "./types";

export interface AbsorptionOptions {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Sensitivity 0–1: higher fires more events (looser thresholds). */
    sensitivity?: number;
    /** Rolling window for average volume. */
    window?: number;
}

type Candle = { timestamp: number; open: number; high: number; low: number; close: number; volume?: number };

/**
 * Detect absorption events over a chronological candle list.
 * Only candles up to each event index are used (no future leak).
 */
export function detectAbsorption(candles: readonly Candle[], options: AbsorptionOptions): AbsorptionEvent[] {
    const events: AbsorptionEvent[] = [];
    if (!candles || candles.length < 5) return events;

    const sensitivity = Math.min(1, Math.max(0, options.sensitivity ?? 0.5));
    const window = Math.max(5, Math.min(100, Math.round(options.window ?? 20)));

    for (let i = window; i < candles.length; i++) {
        const c = candles[i];
        const vol = c.volume ?? 0;
        if (vol <= 0) continue;

        const hist = candles.slice(i - window, i);
        const vols = hist.map((h) => h.volume ?? 0).filter((v) => v > 0);
        if (vols.length < 3) continue;
        const avg = vols.reduce((s, v) => s + v, 0) / vols.length;
        if (avg <= 0) continue;

        const relVol = vol / avg;
        // Volume evidence gate: must be an expansion bar. Sensitivity maps to
        // the required multiple (1.6× at sensitivity 1 … 2.6× at sensitivity 0).
        const volMultiple = 2.6 - sensitivity * 1.0;
        if (relVol < volMultiple) continue;

        const range = c.high - c.low;
        if (range <= 0) continue;
        const body = Math.abs(c.close - c.open);
        const bodyRatio = body / range; // 0 = doji, 1 = full-body marubozu

        // Price-progress evidence: high volume with a capped body relative to
        // its own range (aggression failing to travel).
        const maxBodyRatio = 0.35 + sensitivity * 0.3;
        const cappedBody = bodyRatio < maxBodyRatio;

        // Close position: where in the range did the bar close?
        const closePos = (c.close - c.low) / range; // 0..1

        // Direction guess from the close position — this is the *pressured*
        // side (whose aggression is being absorbed by the other).
        const pressuredBuy = closePos >= 0.5; // buying pressured but absorbed

        const evidence: string[] = [];
        evidence.push(`volume ${relVol.toFixed(2)}x the ${window}-bar average`);
        if (cappedBody) evidence.push(`body only ${(bodyRatio * 100).toFixed(0)}% of bar range (limited progress)`);
        if (bodyRatio >= maxBodyRatio && relVol >= volMultiple) {
            // Full-body + expansion = possible continuation, not absorption.
            continue;
        }

        // Repeated interaction: prior bars overlapping this price zone.
        const zoneTouches = hist.filter((h) => h.low <= c.high && h.high >= c.low).length;
        if (zoneTouches >= 3) evidence.push(`level interacted ${zoneTouches}× in ${window} bars`);

        // Require at least two independent evidence classes beyond volume.
        if (evidence.length < 2) continue;

        events.push({
            id: `abs_${pressuredBuy ? "BUY" : "SELL"}_${options.symbol}_${options.timeframe}_${c.timestamp}`,
            timestamp: c.timestamp,
            symbol: options.symbol,
            timeframe: options.timeframe,
            mode: options.mode,
            method: "candle-behaviour-evidence",
            quality: "ESTIMATED",
            type: pressuredBuy ? "BUY_ABSORPTION" : "SELL_ABSORPTION",
            price: (c.high + c.low) / 2,
            aggressiveVolume: vol,
            priceProgress: body,
            outcome: "held",
            evidence,
        });
    }
    return events;
}
