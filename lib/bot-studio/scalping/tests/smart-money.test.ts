/**
 * Smart Money direction read — deterministic unit tests.
 *
 * These tests exercise the canonical structure detector through the scalper
 * adapter. They do not claim profitability; they prove long/short routing and
 * the conservative neutral path.
 */

import type { MarketCandle } from "@/lib/market-data/types";
import { readSmartMoneyScalpDirection } from "../smart-money";

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

function pushCandle(
    candles: MarketCandle[],
    open: number,
    close: number,
    wick: number,
): void {
    candles.push({
        timestamp: 1_700_000_000_000 + candles.length * 60_000,
        open,
        high: Math.max(open, close) + wick,
        low: Math.min(open, close) - wick,
        close,
    });
}

/**
 * 150 bars of clean swing structure, followed by a one-way breakout. This
 * gives the canonical detector confirmed pivots and a fresh BOS.
 */
function makeCandles(
    shape: "up" | "down" | "flat",
): MarketCandle[] {
    const candles: MarketCandle[] = [];
    const period = 20;
    let previous = 2000;

    for (let i = 0; i < 150; i += 1) {
        const next = 2000 + Math.sin((i * Math.PI * 2) / period) * 8;
        pushCandle(candles, previous, next, 1.2);
        previous = next;
    }

    for (let i = 0; i < 10; i += 1) {
        const drift = shape === "up" ? 2.5 : shape === "down" ? -2.5 : 0;
        const close = previous + drift;
        pushCandle(candles, previous, close, 1);
        previous = close;
    }

    return candles;
}

function main(): void {
    console.log("• Smart Money direction read…");

    const insufficient = readSmartMoneyScalpDirection(
        makeCandles("up").slice(0, 8),
    );
    assert(
        insufficient.direction === "neutral" &&
            insufficient.reason.includes("enough closed M1"),
        "fewer than 12 candles must stay neutral",
    );

    const up = readSmartMoneyScalpDirection(makeCandles("up"));
    const down = readSmartMoneyScalpDirection(makeCandles("down"));
    const flat = readSmartMoneyScalpDirection(makeCandles("flat"));

    console.log("  up:", up.direction, up.lastBreakKind, up.structureBias);
    console.log("  down:", down.direction, down.lastBreakKind, down.structureBias);
    console.log("  flat:", flat.direction, flat.lastBreakKind, flat.structureBias);

    assert(
        up.direction === "long" && up.fresh,
        "an upward BOS must route a fresh long",
    );
    assert(
        down.direction === "short" && down.fresh,
        "a downward BOS must route a fresh short",
    );
    assert(
        flat.direction === "neutral" || flat.confidence <= 0.82,
        "a flat market must never be treated as a high-confidence setup",
    );
    assert(
        up.lastBreakKind === "bos" || up.lastBreakKind === "choch",
        "a directional read must be backed by a confirmed BOS/CHoCH",
    );

    console.log("PASS: Smart Money direction read");
}

main();
