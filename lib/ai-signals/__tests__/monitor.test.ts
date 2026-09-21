// ─────────────────────────────────────────────────────────────────────────────
// Signal Monitor tests — fresh-market, deterministic outcome evaluation.
//
// Covers: entry trigger, TP1/TP2/SL from candle history, conservative same-bar
// SL-before-TP policy, expiration, stale / unavailable market data (honest
// pending state, never fabricated), wrong-symbol rejection, fresh-price
// persistence, freshness thresholds, and determinism.
//
// Run: npm run test:monitor
// ─────────────────────────────────────────────────────────────────────────────

import {
    monitorSignal,
    evaluateSignalAgainstCandles,
    marketDataFreshness,
    normalizeMonitorSymbol,
    normalizeMonitorTimeframe,
} from "../monitor";
import { AISignal, ConfidenceBreakdown } from "../types";
import { MarketCandle } from "@/lib/market-data/types";

const noNotify = async () => 0;

function mb(timestamp: number, open: number, high: number, low: number, close: number): MarketCandle {
    return { timestamp, open, high, low, close, volume: 100 };
}

function confidence(): ConfidenceBreakdown {
    const unit = { score: 50, max: 100, detail: "test" };
    return {
        trendAlignment: unit,
        marketStructure: unit,
        liquidity: unit,
        momentum: unit,
        volume: unit,
        orderFlow: unit,
        entryConfirmation: unit,
        total: 350,
    };
}

const NOW = 1_700_000_000_000;

function makeSignal(overrides: Partial<AISignal> = {}): AISignal {
    const base: AISignal = {
        id: "sig_test_1",
        symbol: "XAUUSD",
        direction: "BUY",
        timeframe: "M1",
        category: "forex",
        tier: "FREE",
        entry: 100,
        stopLoss: 95,
        tp1: 105,
        tp2: 110,
        tp3: 115,
        confidence: 70,
        strength: "GOOD",
        marketRegime: "TRENDING_BULLISH",
        riskReward: 2,
        status: "ACTIVE",
        result: "PENDING",
        resultR: 0,
        profitPoints: 0,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        analysis: {},
        confidenceBreakdown: confidence(),
        reasoning: "test",
        currentPrice: 100,
        distanceToEntry: 0,
        distanceToSL: 5,
        createdAt: NOW - 60 * 60 * 1000,
        updatedAt: NOW - 1000,
        expiresAt: NOW + 24 * 60 * 60 * 1000,
        engineVersion: "test",
        strategyVersion: "1",
        generatedBy: "test",
        lastCheckedAt: 0,
        followCount: 0,
        tradeCount: 0,
        suggestedRiskPercent: 1,
        pipValue: 10,
        contractSize: 100000,
        typicalSpread: 0.1,
        digits: 2,
        timeline: [],
    };
    return { ...base, ...overrides };
}

export async function runMonitorTests(): Promise<boolean> {
    console.log("--- Signal Monitor Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    // 1. Entry trigger — candle pierces the entry level.
    {
        const candles = [
            mb(NOW - 60000, 100.5, 101, 99.9, 100.1),
            mb(NOW, 100.1, 100.8, 100, 100.5),
        ];
        const r = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        check(r.signal.activatedAt === NOW - 60000, "Entry trigger stamp recorded (activatedAt)");
        check(r.newEvents.some((e) => e.type === "ENTRY_TRIGGERED"), "Entry trigger event emitted once");
    }

    // 2. TP1 hit from candle history.
    {
        const candles = [
            mb(NOW - 90000, 100.5, 101, 99.9, 100.2),
            mb(NOW - 60000, 100.2, 106, 100, 105.8),
            mb(NOW, 105.8, 107, 105, 106),
        ];
        const r = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        check(r.signal.status === "TP1_HIT", "TP1 reached → status TP1_HIT");
        check(r.signal.tp1Hit === true, "tp1Hit flag persisted");
        check(r.newEvents.some((e) => e.type === "TP1_HIT"), "TP1_HIT event emitted");
    }

    // 3. SL hit from candle history.
    {
        const candles = [
            mb(NOW - 90000, 100.5, 101, 99.9, 100.2),
            mb(NOW - 60000, 100.2, 100.9, 94, 94.5),
            mb(NOW, 94.5, 95, 93.5, 94),
        ];
        const r = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        check(r.signal.status === "STOPPED", "Stop loss reached → status STOPPED");
        check(r.signal.completedAt === NOW - 60000, "completedAt = real SL-hit candle time");
        check(r.newEvents.some((e) => e.type === "SL_HIT"), "SL_HIT event emitted");
        check(r.signal.result === "LOSS", "Result resolved to LOSS deterministically");
    }

    // 4. TP1 → TP2 sequence.
    {
        const candles = [
            mb(NOW - 120000, 100.5, 101, 99.9, 100.2),
            mb(NOW - 60000, 100.2, 106, 100, 106),
            mb(NOW, 106, 112, 105.5, 111),
        ];
        const r = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        check(r.signal.status === "TP2_HIT", "TP2 reached after TP1 → status TP2_HIT");
        check(r.signal.tp2Hit === true && r.signal.tp1Hit === true, "TP1 + TP2 flags persisted");
    }

    // 5. Conservative same-bar policy — one candle touches SL AND TP1 → SL wins.
    {
        const candles = [
            mb(NOW - 60000, 100.5, 101, 99.9, 100.2),
            mb(NOW, 100.2, 106, 94, 95),
        ];
        const r = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        check(r.signal.status === "STOPPED", "Same-bar SL+TP ambiguity → SL (conservative, like Strategy Lab)");
        check(r.signal.tp1Hit === false, "No TP1 flag on ambiguous same-bar candle");
    }

    // 6. Expiration — never-traded setup expires.
    {
        const sig = makeSignal({ status: "READY", expiresAt: NOW - 1000 });
        const r = await monitorSignal(sig, undefined, noNotify);
        check(r.signal.status === "EXPIRED", "Untriggered setup past expiry → EXPIRED");
        check(r.newEvents.some((e) => e.type === "SIGNAL_EXPIRED"), "SIGNAL_EXPIRED event emitted");
    }

    // 7. Stale market data → honest pending state, no fabricated outcome.
    {
        const sig = makeSignal();
        const candles = [
            mb(NOW - 3600000, 100.5, 101, 99.9, 100.2),
        ];
        const r = await monitorSignal(sig, { candles, fresh: false, dataAgeMs: 3600000 }, noNotify);
        check(r.signal.status === "ACTIVE", "Stale data → status untouched (no fabricated outcome)");
        check(r.signal.tp1Hit === false, "Stale data → no TP flags set");
        check(r.newEvents.some((e) => e.type === "SIGNAL_STALE"), "Stale data → SIGNAL_STALE event");
    }

    // 8. Unavailable market data → honest pending state.
    {
        const sig = makeSignal();
        const r = await monitorSignal(sig, undefined, noNotify);
        check(r.signal.status === "ACTIVE", "No market data → status untouched");
        check(r.newEvents.some((e) => e.type === "SIGNAL_STALE"), "No market data → SIGNAL_STALE event");
        check(r.signal.tp1Hit === false && r.signal.status !== "STOPPED", "No market data → no outcome decided");
    }

    // 9. Fresh price persisted for the UI (but never used to decide outcomes).
    {
        const candles = [
            mb(NOW - 60000, 100.5, 101, 99.9, 100.2),
            mb(NOW, 100.2, 100.9, 100, 100.9),
        ];
        const r = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        check(r.signal.currentPrice === 100.9, "currentPrice refreshed from last close");
        check(r.signal.marketDataProvider === "fetchCandles", "Market provenance recorded");
    }

    // 10. Determinism — identical candles + signal → identical status every time.
    {
        const candles = [
            mb(NOW - 90000, 100.5, 101, 99.9, 100.2),
            mb(NOW - 60000, 100.2, 106, 100, 105.8),
            mb(NOW, 105.8, 107, 105, 106),
        ];
        const a = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        const b = await monitorSignal(makeSignal(), { candles, fresh: true }, noNotify);
        check(
            a.signal.status === b.signal.status
            && a.signal.tp1Hit === b.signal.tp1Hit
            && a.signal.resultR === b.signal.resultR,
            "Outcome evaluation is deterministic (AI never consulted)"
        );
    }

    // 11. Freshness thresholds.
    {
        const fresh = marketDataFreshness([mb(NOW - 60000, 1, 1, 1, 1)], "M1", NOW);
        check(fresh.fresh === true, "Recent M1 candle → fresh");
        const stale = marketDataFreshness([mb(NOW - 600000, 1, 1, 1, 1)], "M1", NOW);
        check(stale.fresh === false, "Old M1 candle → stale");
        const none = marketDataFreshness([], "M1", NOW);
        check(none.fresh === false, "No candles → not fresh");
    }

    // 12. Wrong-symbol prevention.
    check(normalizeMonitorSymbol("NOPE") === null, "Unknown symbol → null (no fetch, no outcome)");
    check(normalizeMonitorSymbol("INDEX:NAS100") === "NAS100", "Index-prefixed symbol normalized to supported symbol");
    check(normalizeMonitorTimeframe("H1") === "H1", "Valid timeframe normalized");
    check(normalizeMonitorTimeframe("GARBAGE") === null, "Unknown timeframe → null");

    // 13. evaluateSignalAgainstCandles never uses generation price as an outcome
    //     source — it only reads candle low/high from fresh data.
    {
        const evalResult = evaluateSignalAgainstCandles(makeSignal(), [mb(NOW - 60000, 110, 112, 108, 109)]);
        check(evalResult.lastClose === 109, "lastClose from candles, not signal.currentPrice");
        check(evalResult.tp1Hit === false, "No TP hit without an entry trigger in candle path");
    }

    console.log("--- Signal Monitor Tests Complete ---");
    return passed;
}