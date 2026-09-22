import {
    currentPriceSanityCheck,
    validateTelegramSignalPrice,
} from "../price-sanity";
import { MarketSnapshot } from "../../market-data/market-truth";

const freshSnapshot: MarketSnapshot = {
    symbol: "XAUUSD",
    exchange: "Biquote",
    provider: "biquote",
    currentPrice: 4000.25,
    bid: 4000.10,
    ask: 4000.40,
    spread: 0.30,
    timestamp: Date.now(),
    serverTimestamp: Date.now(),
    dataAgeMs: 800,
    timeframe: "M5",
    marketSession: "new_york",
    marketStatus: "open",
    recentCandles: [],
    multiTimeframeCandles: { M1: [], M3: [], M5: [], M15: [], M30: [], H1: [], H4: [], D1: [] } as MarketSnapshot["multiTimeframeCandles"],
    trend: "bullish",
    marketStructure: "trending_bullish",
    supportResistance: { supports: [3950, 3900], resistances: [4050, 4100] },
    liquidity: { levels: [], sweeps: [] },
    volatility: { atr: 15, atrPercent: 0.375, state: "normal" },
    ATR: 15,
    volume: { current: 1000, average: 800, relative: 1.25 },
    VWAP: { value: 3995, distancePercent: 0.14 },
    FVG: [],
    orderBlocks: [],
    sweeps: [],
    regime: "trending_bullish",
    higherTimeframeContext: { htfBias: "bullish" },
    lowerTimeframeContext: {},
    freshnessStatus: "fresh",
    dataAgeCategory: "short",
};

const staleSnapshot: MarketSnapshot = {
    ...freshSnapshot,
    timestamp: Date.now() - 10 * 60 * 1000,
    dataAgeMs: 600000,
    freshnessStatus: "stale",
};

const unavailableSnapshot: MarketSnapshot = {
    ...freshSnapshot,
    currentPrice: 0,
    timestamp: 0,
    dataAgeMs: 0,
    freshnessStatus: "unavailable",
};

export function runPriceSanityTests(): boolean {
    console.log("--- Running Price Sanity Tests ---");
    let passed = true;

    // Test 1: Fresh market, valid reference
    const r1 = currentPriceSanityCheck(4000.00, freshSnapshot, "XAUUSD");
    if (!r1.passed || r1.action !== "PROCEED") {
        console.error("FAIL: Valid reference should pass");
        passed = false;
    } else {
        console.log("PASS: Valid reference matches fresh market");
    }

    // Test 2: XAUUSD stale context (2000 vs 4000+)
    const r2 = currentPriceSanityCheck(2000, freshSnapshot, "XAUUSD");
    if (r2.passed || r2.action !== "REJECT_REFRESH") {
        console.error("FAIL: Stale XAUUSD context should be rejected");
        passed = false;
    } else if (r2.priceDifferencePercent <= 15) {
        console.error("FAIL: Price difference should exceed 15%");
        passed = false;
    } else {
        console.log("PASS: XAUUSD stale context rejected (2000 vs 4000+)");
    }

    // Test 3: BTCUSD extreme mismatch
    const btcSnapshot: MarketSnapshot = {
        ...freshSnapshot,
        symbol: "BTCUSD",
        currentPrice: 66800,
        timestamp: Date.now(),
        dataAgeMs: 500,
    };
    const r3 = currentPriceSanityCheck(1000, btcSnapshot, "BTCUSD");
    if (r3.passed || r3.action !== "REJECT_REFRESH") {
        console.error("FAIL: BTCUSD extreme mismatch should be rejected");
        passed = false;
    } else {
        console.log("PASS: BTCUSD extreme mismatch rejected");
    }

    // Test 4: Zero reference price
    const r4 = currentPriceSanityCheck(0, freshSnapshot, "XAUUSD");
    if (r4.passed) {
        console.error("FAIL: Zero reference should fail");
        passed = false;
    } else {
        console.log("PASS: Zero reference price rejected");
    }

    // Test 5: Negative reference price
    const r5 = currentPriceSanityCheck(-100, freshSnapshot, "XAUUSD");
    if (r5.passed) {
        console.error("FAIL: Negative reference should fail");
        passed = false;
    } else {
        console.log("PASS: Negative reference price rejected");
    }

    // Test 6: EURUSD within threshold
    const eurSnapshot: MarketSnapshot = {
        ...freshSnapshot,
        symbol: "EURUSD",
        currentPrice: 1.0870,
        timestamp: Date.now(),
        dataAgeMs: 200,
    };
    const r6 = currentPriceSanityCheck(1.0865, eurSnapshot, "EURUSD");
    if (!r6.passed) {
        console.error("FAIL: EURUSD within threshold should pass");
        passed = false;
    } else {
        console.log("PASS: EURUSD within threshold passes");
    }

    // Test 7: Valid Telegram signal with fresh data
    const r7 = validateTelegramSignalPrice(4000, freshSnapshot, { fresh: true, status: "fresh", dataAgeMs: 800 });
    if (!r7.passed || r7.overallAction !== "PROCEED") {
        console.error("FAIL: Valid Telegram signal should pass");
        passed = false;
    } else {
        console.log("PASS: Valid Telegram signal with fresh data");
    }

    // Test 8: Stale Telegram signal
    const r8 = validateTelegramSignalPrice(2000, freshSnapshot, { fresh: false, status: "stale", dataAgeMs: 600000 });
    if (r8.passed || r8.overallAction !== "REJECT_STALE") {
        console.error("FAIL: Stale Telegram signal should be rejected");
        passed = false;
    } else {
        console.log("PASS: Stale Telegram signal rejected");
    }

    // Test 9: Telegram signal with obsolete price AND stale market
    const r9 = validateTelegramSignalPrice(2000, staleSnapshot, { fresh: false, status: "stale", dataAgeMs: 600000 });
    if (r9.passed || r9.overallAction !== "REJECT_STALE") {
        console.error("FAIL: Telegram with stale market should be rejected");
        passed = false;
    } else {
        console.log("PASS: Telegram signal with stale market rejected");
    }

    // Test 10: Fresh market but completely wrong signal price
    const r10 = validateTelegramSignalPrice(2000, freshSnapshot, { fresh: true, status: "fresh", dataAgeMs: 800 });
    if (r10.passed) {
        console.error("FAIL: Wrong price on fresh market should fail sanity");
        passed = false;
    } else {
        console.log("PASS: Telegram signal with wrong price fails price sanity");
    }

    // Test 11: Unavailable market data
    const r11 = currentPriceSanityCheck(100, unavailableSnapshot, "XAUUSD");
    if (r11.passed) {
        console.error("FAIL: Unavailable market should block signal");
        passed = false;
    } else {
        console.log("PASS: Unavailable market data blocks signal");
    }

    console.log("--- Price Sanity Tests Complete ---");
    return passed;
}