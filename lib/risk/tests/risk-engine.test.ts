// ─────────────────────────────────────────────────────────────────────────────
// Canonical Risk Engine tests.
//
// Covers: valid orders, excessive / invalid volume, broker constraints, lot
// step, emergency stop (entries blocked, protective actions never blocked),
// daily loss, drawdown, max open positions, symbol exposure, cooldown, market
// entry policy, SL/TP geometry, risk-based sizing, pass-through when limits are
// unset, and determinism.
//
// Run: npm run test:risk
// ─────────────────────────────────────────────────────────────────────────────

import {
    evaluateOrder,
    normalizeVolume,
    sizePositionByRisk,
    brokerLimitsFromAccount,
    type OrderIntent,
    type RiskLimits,
    type AccountRiskState,
} from "../risk-engine";

export function runRiskEngineTests(): boolean {
    console.log("--- Risk Engine Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const NOW = 1_700_000_000_000;

    const entry: OrderIntent = {
        symbol: "XAUUSD",
        direction: "BUY",
        entryKind: "MARKET",
        price: 4000,
        volume: 0.5,
        sl: 3950,
        tp: 4050,
    };
    const saneLimits: RiskLimits = {
        minLot: 0.01,
        lotStep: 0.01,
        maxLot: 10,
        allowMarketEntries: true,
    };

    // 1. Valid order approved with resolved volume.
    const r1 = evaluateOrder(entry, saneLimits, {}, NOW);
    check(r1.approved && r1.code === "APPROVED" && r1.volume === 0.5, "Valid entry approved at resolved volume");

    // 2. Excessive volume rejected.
    const r2 = evaluateOrder({ ...entry, volume: 11 }, saneLimits, {}, NOW);
    check(!r2.approved && r2.code === "VOLUME_TOO_LARGE", "Excessive volume rejected (VOLUME_TOO_LARGE)");

    // 3. Volume below min rejected.
    const r3 = evaluateOrder({ ...entry, volume: 0.005 }, saneLimits, {}, NOW);
    check(!r3.approved && r3.code === "VOLUME_TOO_SMALL", "Volume below minimum rejected (VOLUME_TOO_SMALL)");

    // 4. Volume not aligned to lot step rejected.
    const r4 = evaluateOrder({ ...entry, volume: 0.015 }, saneLimits, {}, NOW);
    check(!r4.approved && r4.code === "LOT_STEP_MISMATCH", "Lot-step mismatch rejected (LOT_STEP_MISMATCH)");

    // 5. Invalid volume (zero / negative / non-finite).
    check(evaluateOrder({ ...entry, volume: 0 }, saneLimits, {}, NOW).code === "INVALID_VOLUME", "Zero volume rejected (INVALID_VOLUME)");
    check(evaluateOrder({ ...entry, volume: -1 }, saneLimits, {}, NOW).code === "INVALID_VOLUME", "Negative volume rejected (INVALID_VOLUME)");
    check(evaluateOrder({ ...entry, volume: Number.NaN }, saneLimits, {}, NOW).code === "INVALID_VOLUME", "NaN volume rejected (INVALID_VOLUME)");

    // 6. Emergency stop blocks entries but never protective actions.
    const r6a = evaluateOrder(entry, { ...saneLimits, emergencyStop: true }, {}, NOW);
    check(!r6a.approved && r6a.code === "EMERGENCY_STOP", "Emergency stop blocks new entries");
    const r6b = evaluateOrder({ ...entry, protective: true }, { ...saneLimits, emergencyStop: true }, {}, NOW);
    check(r6b.approved, "Emergency stop never blocks protective / management actions");

    // 7. Daily loss limit.
    check(
        evaluateOrder(entry, { ...saneLimits, maxDailyLossPercent: 5 }, { dailyLossPercent: 6 }, NOW).code === "DAILY_LOSS_LIMIT",
        "Daily loss limit reached → DAILY_LOSS_LIMIT"
    );
    check(
        evaluateOrder(entry, { ...saneLimits, maxDailyLossPercent: 5 }, { dailyLossPercent: 3 }, NOW).approved,
        "Daily loss below limit → approved"
    );

    // 8. Drawdown limit.
    check(
        evaluateOrder(entry, { ...saneLimits, maxDrawdownPercent: 20 }, { drawdownPercent: 21 }, NOW).code === "MAX_DRAWDOWN",
        "Drawdown limit reached → MAX_DRAWDOWN"
    );
    check(
        evaluateOrder(entry, { ...saneLimits, maxDrawdownPercent: 20 }, { drawdownPercent: 10 }, NOW).approved,
        "Drawdown below limit → approved"
    );

    // 9. Max open positions.
    check(
        evaluateOrder(entry, { ...saneLimits, maxOpenPositions: 3 }, { openPositionsCount: 3 }, NOW).code === "MAX_OPEN_POSITIONS",
        "Max open positions reached → MAX_OPEN_POSITIONS"
    );
    check(
        evaluateOrder(entry, { ...saneLimits, maxOpenPositions: 3 }, { openPositionsCount: 2 }, NOW).approved,
        "Open positions below max → approved"
    );

    // 10. Symbol exposure limit.
    const r10 = evaluateOrder(
        entry,
        { ...saneLimits, maxSymbolExposureLots: 1 },
        { symbolExposureLots: 0.8 },
        NOW
    );
    check(r10.code === "SYMBOL_EXPOSURE_LIMIT", "Symbol exposure limit reached → SYMBOL_EXPOSURE_LIMIT");
    check(
        evaluateOrder(entry, { ...saneLimits, maxSymbolExposureLots: 1 }, { symbolExposureLots: 0.2 }, NOW).approved,
        "Symbol exposure within limit → approved"
    );

    // 11. Cooldown.
    check(
        evaluateOrder(entry, { ...saneLimits, cooldownSeconds: 60 }, { lastTradeAt: NOW - 30_000 }, NOW).code === "COOLDOWN_ACTIVE",
        "Cooldown active → COOLDOWN_ACTIVE"
    );
    check(
        evaluateOrder(entry, { ...saneLimits, cooldownSeconds: 60 }, { lastTradeAt: NOW - 120_000 }, NOW).approved,
        "Cooldown elapsed → approved"
    );

    // 12. Market-entry policy.
    check(
        evaluateOrder(entry, { ...saneLimits, allowMarketEntries: false }, {}, NOW).code === "MARKET_ENTRY_DISABLED",
        "Market entries disabled → MARKET_ENTRY_DISABLED"
    );
    check(
        evaluateOrder({ ...entry, entryKind: "LIMIT" }, { ...saneLimits, allowMarketEntries: false }, {}, NOW).approved,
        "Limit entry allowed when market entries disabled"
    );

    // 13. SL geometry.
    check(
        evaluateOrder({ ...entry, sl: 4001 }, saneLimits, {}, NOW).code === "INVALID_SL",
        "BUY stop loss above entry → INVALID_SL"
    );
    const sell = { ...entry, direction: "SELL" as const, sl: 4001, tp: 3990 };
    check(
        evaluateOrder({ ...sell, sl: 3995 }, saneLimits, {}, NOW).code === "INVALID_SL",
        "SELL stop loss below entry → INVALID_SL"
    );
    check(evaluateOrder({ ...entry, sl: 3950 }, saneLimits, {}, NOW).approved, "Valid SL geometry → approved");

    // 14. TP geometry.
    check(
        evaluateOrder({ ...entry, tp: 3990 }, saneLimits, {}, NOW).code === "INVALID_TP",
        "BUY take profit below entry → INVALID_TP"
    );
    check(
        evaluateOrder({ ...sell, tp: 4005 }, saneLimits, {}, NOW).code === "INVALID_TP",
        "SELL take profit above entry → INVALID_TP"
    );
    check(evaluateOrder({ ...entry, tp: 4050 }, saneLimits, {}, NOW).approved, "Valid TP geometry → approved");

    // 15. Stop Loss required.
    check(
        evaluateOrder({ ...entry, sl: undefined }, { ...saneLimits, requireStopLoss: true }, {}, NOW).code === "SL_REQUIRED",
        "requireStopLoss with no SL → SL_REQUIRED"
    );

    // 16. Risk-based sizing: 1% of $10,000 with a 20-pip stop on EURUSD (contract 100k).
    const sized = evaluateOrder(
        { symbol: "EURUSD", direction: "BUY", entryKind: "LIMIT", price: 1.08, sl: 1.078, tp: 1.084, volume: undefined },
        { ...saneLimits, riskPercent: 1 },
        { balance: 10_000 },
        NOW
    );
    check(sized.approved && typeof sized.volume === "number" && Math.abs(sized.volume - 0.5) < 0.001, "Risk-based sizing computes correct lots (0.5)");

    // 17. Sizing without a stop → honest fallback to default lot, never a fake size.
    check(
        evaluateOrder({ ...entry, sl: undefined, volume: undefined }, { ...saneLimits, defaultLot: 0.01 }, {}, NOW).volume === 0.01,
        "No stop / no balance → falls back to default lot"
    );
    check(
        sizePositionByRisk({ ...entry, sl: undefined, volume: undefined }, { ...saneLimits, riskPercent: 1 }, { balance: 10_000 }) === undefined,
        "Sizing without SL distance returns undefined (no fabrication)"
    );

    // 18. Pass-through when no limits configured (orders route default behavior).
    check(evaluateOrder(entry, {}, {}, NOW).approved, "No limits configured → pass through approved");

    // 19. normalizeVolume: step + clamp semantics (copy-trading caps).
    check(normalizeVolume(0.073, { minLot: 0.01, lotStep: 0.01 }) === 0.07, "normalizeVolume rounds to lot step");
    check(normalizeVolume(0.5, { minLot: 0.01, lotStep: 0.01, maxLot: 0.1 }) === 0.1, "normalizeVolume clamps to maxLot");
    check(normalizeVolume(0.001, { minLot: 0.01, lotStep: 0.01 }) === 0.01, "normalizeVolume floors at min lot");

    // 20. Broker limits from an MT5-style account record.
    const broker = brokerLimitsFromAccount({ minLot: "0.01", maxLot: "50", lotStep: "0.01" });
    check(broker.minLot === 0.01 && broker.maxLot === 50 && broker.lotStep === 0.01, "brokerLimitsFromAccount parses fields");

    // 21. Determinism: identical inputs → identical decision.
    const d1 = evaluateOrder(entry, saneLimits, { balance: 5000 }, NOW);
    const d2 = evaluateOrder(entry, saneLimits, { balance: 5000 }, NOW);
    check(
        d1.approved === d2.approved && d1.code === d2.code && d1.volume === d2.volume,
        "Deterministic — identical inputs yield identical decision"
    );

    // 22. Symbol exposure uses the *final resolved* volume.
    const r22 = evaluateOrder(
        entry,
        { ...saneLimits, maxSymbolExposureLots: 0.6 },
        { symbolExposureLots: 0.2 },
        NOW
    );
    check(r22.code === "SYMBOL_EXPOSURE_LIMIT", "Exposure checked against final volume (0.2 + 0.5 > 0.6)");

    // 23. Unknown state passes through honestly (no fabricated account data).
    check(
        evaluateOrder(entry, { ...saneLimits, maxDailyLossPercent: 5 }, {}, NOW).approved,
        "Unknown daily-loss state → pass through (no invented number)"
    );

    console.log("--- Risk Engine Tests Complete ---");
    return passed;
}