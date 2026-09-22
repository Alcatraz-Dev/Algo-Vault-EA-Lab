// ─────────────────────────────────────────────────────────────────────────────
// Signal Monitor tests — deterministic outcome evaluation against the stored
// market snapshot (signal.currentPrice). No fabricated outcomes: stale or
// unavailable data never trigger TP/SL logic, and everything is deterministic.
//
// Run: jiti lib/ai-signals/__tests__/run-ai-signals-tests.ts
// ─────────────────────────────────────────────────────────────────────────────

import { monitorSignal } from "../monitor";
import { AISignal, ConfidenceBreakdown } from "../types";

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

    // 1. Terminal states are left untouched (no re-evaluation).
    {
        for (const terminal of ["CANCELLED", "EXPIRED", "STOPPED", "COMPLETED"] as const) {
            const sig = makeSignal({ status: terminal, currentPrice: 200 });
            const r = await monitorSignal(sig);
            check(r.statusChanged === false && r.newEvents.length === 0, `${terminal} state is a no-op`);
        }
    }

    // 2. Expiration — never-traded setup expires.
    {
        const sig = makeSignal({ status: "READY", expiresAt: NOW - 1000 });
        const r = await monitorSignal(sig);
        check(r.signal.status === "EXPIRED", "Untriggered setup past expiry → EXPIRED");
        check(r.newEvents.some((e) => e.type === "SIGNAL_EXPIRED"), "SIGNAL_EXPIRED event emitted");
    }

    // 3. TP1 hit.
    {
        const r = await monitorSignal(makeSignal({ currentPrice: 105 }));
        check(r.signal.status === "TP1_HIT", "Price at TP1 → status TP1_HIT");
        check(r.signal.tp1Hit === true, "tp1Hit flag persisted");
        check(r.newEvents.some((e) => e.type === "TP1_HIT"), "TP1_HIT event emitted");
    }

    // 4. TP1 → TP2 sequence in a single evaluation pass.
    {
        const r = await monitorSignal(makeSignal({ currentPrice: 110 }));
        check(r.signal.status === "TP2_HIT", "Price at TP2 → status TP2_HIT");
        check(r.signal.tp1Hit === true && r.signal.tp2Hit === true, "TP1 + TP2 flags persisted");
    }

    // 5. TP3 is converted to RUNNER (trailing).
    {
        const r = await monitorSignal(makeSignal({ currentPrice: 115 }));
        check(r.signal.status === "RUNNER", "Price at TP3 → status RUNNER (trailing)");
        check(r.signal.tp3Hit === true, "tp3Hit flag persisted");
    }

    // 6. Stop loss hit resolves deterministically to a traded outcome.
    {
        const r = await monitorSignal(makeSignal({ currentPrice: 95 }));
        check(r.signal.status === "STOPPED", "Price at SL → status STOPPED");
        check(r.newEvents.some((e) => e.type === "SL_HIT"), "SL_HIT event emitted");
        check(r.signal.result === "LOSS" || r.signal.result === "BREAKEVEN", "Result resolved deterministically");
    }

    // 7. Fresh price below TP3/SL and above SL keeps the signal ACTIVE.
    {
        const r = await monitorSignal(makeSignal({ currentPrice: 102 }));
        check(r.signal.status === "ACTIVE" && r.signal.tp1Hit === false, "In-range price keeps signal ACTIVE");
    }

    // 8. Determinism — identical signal → identical status/flags every time.
    {
        const a = await monitorSignal(makeSignal({ currentPrice: 108 }));
        const b = await monitorSignal(makeSignal({ currentPrice: 108 }));
        check(
            a.signal.status === b.signal.status
            && a.signal.tp1Hit === b.signal.tp1Hit
            && a.signal.tp2Hit === b.signal.tp2Hit,
            "Outcome evaluation is deterministic (AI never consulted)"
        );
    }

    // 9. lastCheckedAt is refreshed on every evaluation.
    {
        const r = await monitorSignal(makeSignal());
        check(r.signal.lastCheckedAt >= NOW, "lastCheckedAt refreshed");
    }

    console.log("--- Signal Monitor Tests Complete ---");
    return passed;
}