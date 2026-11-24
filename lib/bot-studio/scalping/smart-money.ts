/**
 * Smart Money direction for the XAUUSD M1 scalper.
 *
 * The bot does not run its own structure math. It consumes the canonical
 * `detectSmartMoney` engine and turns its confirmed BOS / CHoCH breaks into a
 * single directional read:
 *
 *   bullish break → LONG
 *   bearish break → SHORT
 *   no confirmed break → neutral (wait)
 *
 * Confidence is a deterministic signal-quality score, not a probability of
 * profit. A break that agrees with the last-five-break structure bias scores
 * higher than a break fighting that bias.
 */

import type { MarketCandle } from "@/lib/market-data/types";
import { detectSmartMoney } from "@/lib/market-core/smart-money/engine";
import type { SmartMoneyObject } from "@/lib/market-core/types";

export type SmartMoneySide = "long" | "short" | "neutral";

export interface SmartMoneyScalpRead {
    /** Trade side implied by the latest confirmed structure break. */
    direction: SmartMoneySide;
    /** Canonical structure bias over the last five confirmed breaks. */
    structureBias: "bullish" | "bearish" | "neutral";
    /** Latest confirmed break kind, if one exists in the snapshot. */
    lastBreakKind: "bos" | "choch" | null;
    lastBreakDirection: "bullish" | "bearish" | "neutral" | null;
    /** Candle index distance from the newest bar to the break confirmation. */
    barsSinceBreak: number | null;
    /** True when the break is recent enough to act on. */
    fresh: boolean;
    /** 0–1 deterministic confidence in the directional read. */
    confidence: number;
    barTimestamp: number;
    reason: string;
}

export interface SmartMoneyScalpOptions {
    /** A break older than this many M1 bars is no longer an entry trigger. */
    maxBreakAgeBars?: number;
    /** Pivot lookback passed to the canonical detector (default 3). */
    lookback?: number;
}

function neutralRead(
    candles: readonly MarketCandle[],
    reason: string,
): SmartMoneyScalpRead {
    return {
        direction: "neutral",
        structureBias: "neutral",
        lastBreakKind: null,
        lastBreakDirection: null,
        barsSinceBreak: null,
        fresh: false,
        confidence: 0,
        barTimestamp: candles[candles.length - 1]?.timestamp ?? 0,
        reason,
    };
}

export function readSmartMoneyScalpDirection(
    candles: readonly MarketCandle[],
    options: SmartMoneyScalpOptions = {},
): SmartMoneyScalpRead {
    if (candles.length < 12) {
        return neutralRead(
            candles,
            "Waiting for enough closed M1 candles to map market structure.",
        );
    }

    const detection = detectSmartMoney(candles, {
        symbol: "XAUUSD",
        timeframe: "M1",
        lookback: options.lookback ?? 3,
    });

    const breaks = detection.objects
        .filter(
            (object): object is SmartMoneyObject & { kind: "bos" | "choch" } =>
                (object.kind === "bos" || object.kind === "choch") &&
                object.status !== "developing" &&
                object.direction !== "neutral",
        )
        .sort((a, b) => a.confirmationAt - b.confirmationAt);

    const structureBias = detection.structure.bias;
    const lastBreak = breaks[breaks.length - 1] ?? null;

    if (!lastBreak) {
        const direction: SmartMoneySide =
            structureBias === "bullish"
                ? "long"
                : structureBias === "bearish"
                  ? "short"
                  : "neutral";
        return {
            direction,
            structureBias,
            lastBreakKind: null,
            lastBreakDirection: null,
            barsSinceBreak: null,
            fresh: false,
            confidence: direction === "neutral" ? 0 : 0.45,
            barTimestamp: candles[candles.length - 1]?.timestamp ?? 0,
            reason:
                direction === "neutral"
                    ? "No confirmed BOS or CHoCH yet — the bot stays flat."
                    : `Structure bias is ${structureBias}, but no fresh break confirms an entry.`,
        };
    }

    const lastIndex = candles.length - 1;
    const confirmationIndex = lastBreak.confirmationAtIndex;
    const barsSinceBreak =
        typeof confirmationIndex === "number"
            ? Math.max(0, lastIndex - confirmationIndex)
            : null;
    const maxBreakAgeBars = options.maxBreakAgeBars ?? 15;
    const fresh = barsSinceBreak !== null && barsSinceBreak <= maxBreakAgeBars;
    const direction: SmartMoneySide =
        lastBreak.direction === "bullish" ? "long" : "short";
    const aligned = structureBias === lastBreak.direction;
    const confidence = aligned ? 0.82 : 0.6;
    const breakLabel = lastBreak.kind === "choch" ? "CHoCH" : "BOS";

    return {
        direction,
        structureBias,
        lastBreakKind: lastBreak.kind,
        lastBreakDirection: lastBreak.direction,
        barsSinceBreak,
        fresh,
        confidence,
        barTimestamp: candles[lastIndex]?.timestamp ?? 0,
        reason: fresh
            ? `${breakLabel} ${lastBreak.direction} confirmed ${barsSinceBreak} bar${barsSinceBreak === 1 ? "" : "s"} ago — ${direction.toUpperCase()} setup.`
            : `Last ${breakLabel} ${lastBreak.direction} is stale (${barsSinceBreak ?? "?"} bars old) — waiting for a fresh break.`,
    };
}
