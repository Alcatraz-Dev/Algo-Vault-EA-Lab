/**
 * Options provider + GEX wiring — standalone test suite (repo convention: jiti).
 *
 *     JITI_TSCONFIG_PATHS=1 npx jiti tests/order-flow/options-provider.test.ts
 *
 * Covers: OCC + Deribit symbol/expiry parsing, chain normalization through the
 * fail-closed validator, per-symbol capability resolution (GEX symbols vs
 * candle-only), the real-chain context integration (gex HIGH, facts,
 * limitations) and honest unavailability (forex, errored upstream).
 */

import { parseOccSymbol, parseDeribitInstrument, deribitExpiryMs, occExpiryMs } from "../../lib/order-flow/options-internal";
import { GEX_SUPPORTED_SYMBOLS, featureAvailabilityForSymbol, OptionsCapableProvider } from "../../lib/order-flow/options-types";
import { buildOrderFlowContext } from "../../lib/order-flow/context-builder";
import { computeGex, gexLevels } from "../../lib/order-flow/gex";
import type { MarketCandle, Timeframe } from "../../lib/market-data/types";
import type { OptionQuote } from "../../lib/order-flow/types";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
}

function assert(condition: unknown, message = "assertion failed"): void {
    if (!condition) throw new Error(message);
}
function assertEqual(actual: unknown, expected: unknown, message = ""): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`);
}
function approx(actual: number, expected: number, eps = 1e-9, msg = ""): void {
    if (!(Math.abs(actual - expected) <= eps)) throw new Error(`${msg} expected ≈${expected}, got ${actual}`);
}

console.log("Symbology parsing");
check("OCC symbol parses root, expiry, type, strike", () => {
    const p = parseOccSymbol("SPX261218P06900000");
    assert(p !== null);
    assertEqual(p!.root, "SPX");
    assertEqual(p!.expiryYymmdd, "261218");
    assertEqual(p!.type, "put");
    approx(p!.strike, 6900);
    assertEqual(parseOccSymbol("NVDA260930C00100000")!.strike, 100);
    assertEqual(parseOccSymbol("garbage"), null);
    assertEqual(parseOccSymbol("SPX261218X06900000"), null);
});
check("Deribit instrument parses coin, expiry, strike, type", () => {
    const p = parseDeribitInstrument("BTC-28NOV26-74000-C");
    assert(p !== null);
    assertEqual(p!.type, "call");
    assertEqual(p!.strike, 74000);
    assertEqual(parseDeribitInstrument("ETH-25DEC26-95000-P")!.type, "put");
    assertEqual(parseDeribitInstrument("BTC-PERPETUAL"), null);
});
check("expiry parsers produce future-safe UTC timestamps", () => {
    const d = deribitExpiryMs("28NOV26");
    assert(d !== null && d > Date.UTC(2026, 0, 1), "deribit expiry in 2026");
    assertEqual(new Date(d!).getUTCHours(), 8, "deribit settles 08:00 UTC");
    const o = occExpiryMs("261218");
    assert(o !== null && o > Date.UTC(2026, 0, 1), "OCC expiry in 2026");
});

console.log("Per-symbol capabilities");
check("GEX symbol set covers crypto + US listed underlyings, not forex/metals", () => {
    assert(GEX_SUPPORTED_SYMBOLS.has("BTCUSD"));
    assert(GEX_SUPPORTED_SYMBOLS.has("SPX500"));
    assert(GEX_SUPPORTED_SYMBOLS.has("NVDA"));
    assert(!GEX_SUPPORTED_SYMBOLS.has("XAUUSD"));
    assert(!GEX_SUPPORTED_SYMBOLS.has("EURUSD"));
});
check("featureAvailabilityForSymbol: gex ESTIMATED→HIGH-capable for covered symbols", () => {
    const gexSym = featureAvailabilityForSymbol("NVDA");
    assert(gexSym.gexCapable, "NVDA gex-capable");
    assertEqual(gexSym.features.gex.quality, "HIGH", "declared options class");
    const fx = featureAvailabilityForSymbol("EURUSD");
    assert(!fx.gexCapable);
    assertEqual(fx.features.gex.quality, "UNAVAILABLE");
});
check("OptionsCapableProvider: throws for unwired symbols, resolves for wired ones", async () => {
    const provider = new OptionsCapableProvider(async (symbol) => {
        if (symbol.toUpperCase() === "NVDA") {
            return {
                available: true,
                quotes: [{ strike: 100, expiration: Date.now() + 86_400_000, type: "call" as const, openInterest: 10, impliedVolatility: 0.4, underlyingPrice: 100 }],
                rejected: 0,
                spot: 100,
                source: "cboe:NVDA",
                contractMultiplier: 100,
            };
        }
        return { available: false, quotes: [], rejected: 0, spot: null, source: null, error: "no-options-source" };
    });
    const caps = provider.describeCapabilities();
    assertEqual(caps.options, true);
    await provider.getOptionChain("NVDA").then((q) => assertEqual(q.length, 1));
    let threw = false;
    try {
        await provider.getOptionChain("EURUSD");
    } catch {
        threw = true;
    }
    assert(threw, "unwired symbol must throw, never return a fabricated chain");
});

console.log("Real-chain context integration");
const TF: Timeframe = "H1";
function candles(n: number): MarketCandle[] {
    return Array.from({ length: n }, (_, i) => ({
        timestamp: Date.UTC(2026, 9, 1, 0, 0) + i * 3_600_000,
        open: 100 + i * 0.1,
        high: 101 + i * 0.1,
        low: 99 + i * 0.1,
        close: 100.5 + i * 0.1,
        volume: 100,
    }));
}
function chain(spot: number): OptionQuote[] {
    const quotes: OptionQuote[] = [];
    const expiry = Date.UTC(2026, 11, 18, 21, 0, 0, 0);
    for (let k = -4; k <= 4; k++) {
        const strike = spot + k * 5;
        quotes.push({ strike, expiration: expiry, type: "call", openInterest: 500 + k * 10, impliedVolatility: 0.3, underlyingPrice: spot });
        quotes.push({ strike, expiration: expiry, type: "put", openInterest: 400 - k * 10, impliedVolatility: 0.3, underlyingPrice: spot });
    }
    return quotes;
}

check("context with a real chain: gex available + HIGH, walls and flip reported", () => {
    const spot = 100.5;
    const ctx = buildOrderFlowContext({
        symbol: "NVDA",
        timeframe: TF,
        mode: "live",
        asOf: Date.UTC(2026, 9, 2, 0, 0),
        candles: candles(24),
        options: chain(spot),
        capabilities: { candles: true, trades: false, bidAskClassification: false, bidAskQuotes: false, level2: false, historicalLevel2: false, options: true, openInterest: true, impliedVolatility: true },
    });
    assert(ctx.gex.available, "gex available from real chain");
    assert(ctx.gex.netGex !== null, "netGex present");
    assertEqual(ctx.gex.method, "black-scholes-gex");
    assert(ctx.gex.callWalls.length > 0, "call walls present");
    assert(ctx.gex.putWalls.length > 0, "put walls present");
    assert(ctx.limitations.every((l) => !l.toLowerCase().includes("gex")), "no GEX limitation when the chain is real");
});
check("candle-only context keeps GEX unavailable with the limitation stated", () => {
    const ctx = buildOrderFlowContext({
        symbol: "NVDA",
        timeframe: TF,
        mode: "live",
        asOf: Date.UTC(2026, 9, 2, 0, 0),
        candles: candles(24),
    });
    assertEqual(ctx.gex.available, false);
    assert(ctx.limitations.some((l) => l.toLowerCase().includes("gex")), "GEX limitation stated");
});

console.log("Chart-level extraction");
check("gexLevels extracts walls + flip from a computed result", () => {
    const gex = computeGex(chain(100.5), { underlying: "NVDA", mode: "live" }, Date.UTC(2026, 9, 2, 0, 0));
    assertEqual(gex.dataQuality, "HIGH");
    const levels = gexLevels(gex);
    assert(levels.some((l) => l.kind === "call_wall"));
    assert(levels.some((l) => l.kind === "put_wall"));
    assert(levels.every((l) => Number.isFinite(l.price) && l.price > 0));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
