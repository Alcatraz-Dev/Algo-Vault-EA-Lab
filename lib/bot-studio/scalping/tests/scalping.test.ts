/**
 * Scalping bots — unit + integration tests (no network, no credentials).
 *
 * Covers:
 *   1. Config normalization / clamping / rejection (unsafe values, unknown input)
 *   2. Strategy compilation for LONG and SHORT (same profile, opposite rules)
 *   3. Directional decision policy (BOTH conflict, no setup, low confidence)
 *   4. Directional evaluation on real candle shapes (LONG, SHORT, WAIT, stale,
 *      insufficient data, stale-bar age, direction restriction)
 *   5. Pacing (trades/day, cooldown, positions, breaker, notional)
 *   6. Skills Registry methodology trace (active vs unavailable, no overclaim)
 *   7. Demo performance summary from persisted deals
 *   8. Gateway distributable (real .mq5, correct headers/version, no fake .ex5)
 *
 * What this does NOT cover: live MT5 demo execution. That requires a running
 * gateway + broker; the suite reports it as untested rather than assuming it.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { MarketCandle } from "@/lib/market-data/types";
import {
    buildScalpingStrategy,
    defaultScalpingConfig,
    normalizeScalpingConfig,
    SCALPING_LIMITS,
    type ScalpingBotConfig,
} from "../profiles";
import {
    evaluateDirectionalScalping,
    resolveDirectionalDecision,
    scoreSignalConfidence,
} from "../directional";
import { evaluateScalpingPacing, startOfUtcDay } from "../pacing";
import { scalpingMethodologyTrace, scalpingMethodologiesVerified } from "../methodologies";
import { summarizeDemoPerformance, type ClosedTradeRow } from "../report";
import { readGatewayDistributable, parseGatewayVersion, GATEWAY_SOURCE_PATH } from "@/lib/gateway-distribution";

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

function approx(actual: number, expected: number, tolerance: number, message: string): void {
    assert(
        Math.abs(actual - expected) <= tolerance,
        `${message} (expected ≈${expected}, got ${actual})`,
    );
}

const TF_MS = 300_000;

type Shape = "up" | "down" | "flat";

/**
 * Deterministic candle generator. `shape` sets a drift; a small alternating
 * wick keeps ATR non-zero so stops are computable. Timestamps end at `now`.
 */
function makeCandles(count: number, shape: Shape, now: number = Date.now(), tfMs = TF_MS): MarketCandle[] {
    const candles: MarketCandle[] = [];
    let price = 2000;
    for (let i = 0; i < count; i++) {
        const drift = shape === "up" ? 1.8 : shape === "down" ? -1.8 : 0;
        const wobble = Math.sin(i * 1.7) * 0.6;
        const open = price;
        const close = price + drift + wobble * 0.2;
        const high = Math.max(open, close) + 0.9 + Math.abs(wobble) * 0.3;
        const low = Math.min(open, close) - 0.9 - Math.abs(wobble) * 0.3;
        candles.push({
            timestamp: now - (count - 1 - i) * tfMs,
            open,
            high,
            low,
            close,
        });
        price = close;
    }
    return candles;
}

function withConfig(overrides: Partial<ScalpingBotConfig>): ScalpingBotConfig {
    const base = defaultScalpingConfig("balanced");
    return { ...base, ...overrides };
}

async function testConfigValidation(): Promise<void> {
    console.log("• Config validation & clamping…");

    const clamped = normalizeScalpingConfig({
        symbol: "XAUUSD",
        preset: "active",
        direction: "both",
        riskPerTradePercent: 50,
        maxSpreadPips: 500,
        maxOpenPositions: 9,
        maxTradesPerDay: 9999,
        cooldownSeconds: 10_000_000,
        minSignalConfidence: 12,
        dailyNotionalBudget: -5,
    });

    // A negative budget is a structural error, not a value to guess.
    assert(clamped.errors.some((e) => e.includes("dailyNotionalBudget")), "negative budget must be an error");
    assert(clamped.config.riskPerTradePercent === SCALPING_LIMITS.maxRiskPerTradePercent, "risk clamped to ceiling");
    assert(clamped.config.maxSpreadPips === SCALPING_LIMITS.maxSpreadPips, "spread clamped to gate ceiling");
    assert(clamped.config.maxOpenPositions === 1, "positions clamped to platform policy");
    assert(clamped.config.maxTradesPerDay === 50, "trades/day clamped");
    assert(clamped.config.cooldownSeconds === 86_400, "cooldown clamped");
    assert(clamped.config.minSignalConfidence === 0.95, "confidence clamped");
    assert(clamped.warnings.length >= 2, "clamping must be reported as warnings");

    const unknown = normalizeScalpingConfig({
        symbol: "NOTREAL",
        preset: "ludicrous",
        direction: "sideways",
        timeframe: "H4",
        sessions: ["mars"],
    });
    assert(unknown.errors.length >= 4, `unknown structural input must error (got ${unknown.errors.length})`);

    const defaults = normalizeScalpingConfig({ symbol: "EURUSD", preset: "conservative" });
    assert(defaults.errors.length === 0, "valid input must produce no errors");
    assert(defaults.config.timeframe === "M15", "conservative preset timeframe");
    assert(defaults.config.sessions.length === 3, "conservative preset sessions");
    assert(defaults.config.requireStructureAlignment === true, "conservative requires structure");

    console.log("  ✓ Config clamping and rejection passed.");
}

async function testStrategyCompilation(): Promise<void> {
    console.log("• Strategy compilation (LONG / SHORT)…");
    const config = withConfig({});

    const long = buildScalpingStrategy(config, "long");
    const short = buildScalpingStrategy(config, "short");

    assert(long.direction === "long" && short.direction === "short", "direction must be explicit");
    assert(long.asset === config.symbol, "symbol propagated");

    const longEma = long.entryRules.find((r) => r.id === "scalp-ema-alignment");
    const shortEma = short.entryRules.find((r) => r.id === "scalp-ema-alignment");
    assert(longEma?.operator === "gt" && longEma.indicator === "ema_9", "long EMA rule is 9>21");
    assert(shortEma?.operator === "lt", "short EMA rule is 9<21");

    const longTrend = long.entryRules.find((r) => r.id === "scalp-trend");
    const shortTrend = short.entryRules.find((r) => r.id === "scalp-trend");
    assert(longTrend?.value === "bullish" && shortTrend?.value === "bearish", "trend rules mirror");

    assert(long.stopLoss.mode === "atr", "ATR stop mode");
    approx(long.stopLoss.atrMultiple, config.stopAtrMultiple, 0.0001, "stop ATR multiple");
    approx(long.takeProfit.r1, config.rewardRisk, 0.0001, "take profit R multiple");
    assert(long.risk.maxPositions === config.maxOpenPositions, "max positions propagated");
    assert(long.filters.sessions.join(",") === config.sessions.join(","), "sessions propagated");
    assert(long.risk.riskPercent === config.riskPerTradePercent, "risk percent propagated");

    console.log("  ✓ LONG and SHORT compile from the same profile.");
}

async function testDirectionResolution(): Promise<void> {
    console.log("• Directional decision policy…");

    const conflict = resolveDirectionalDecision({
        direction: "both",
        longFired: true,
        shortFired: true,
        longConfidence: 0.9,
        shortConfidence: 0.8,
        minConfidence: 0.5,
    });
    assert(conflict.decision === "WAIT" && conflict.reason === "conflicting_signals", "both sides → WAIT");

    const none = resolveDirectionalDecision({
        direction: "both",
        longFired: false,
        shortFired: false,
        longConfidence: 0,
        shortConfidence: 0,
        minConfidence: 0.5,
    });
    assert(none.decision === "WAIT" && none.reason === "no_setup", "neither side → WAIT");

    const weak = resolveDirectionalDecision({
        direction: "both",
        longFired: true,
        shortFired: false,
        longConfidence: 0.3,
        shortConfidence: 0,
        minConfidence: 0.55,
    });
    assert(weak.decision === "WAIT" && weak.reason === "low_confidence", "low confidence → WAIT");

    const enter = resolveDirectionalDecision({
        direction: "both",
        longFired: false,
        shortFired: true,
        longConfidence: 0,
        shortConfidence: 0.7,
        minConfidence: 0.55,
    });
    assert(enter.decision === "ENTER" && enter.direction === "short", "single qualifying side → ENTER short");

    console.log("  ✓ Conflict / no-setup / low-confidence policy passed.");
}

async function testDirectionalEvaluation(): Promise<void> {
    console.log("• Directional evaluation on candle data…");
    // 14:00 UTC sits inside the London/NY overlap, which the presets allow.
    // `now` is pinned to the last bar so the test never depends on wall-clock
    // session or staleness — those have their own explicit cases below.
    const pinned = new Date();
    const now = Date.UTC(pinned.getUTCFullYear(), pinned.getUTCMonth(), pinned.getUTCDate(), 14, 0, 0);

    const up = makeCandles(240, "up", now);
    const down = makeCandles(240, "down", now);

    const bothUp = evaluateDirectionalScalping(withConfig({ direction: "both" }), { M5: up }, undefined, { now });
    assert(bothUp.decision === "ENTER", `uptrend must produce an entry (got ${bothUp.decision}/${bothUp.reason})`);
    assert(bothUp.direction === "long", `uptrend entry must be long (got ${bothUp.direction})`);
    assert(bothUp.sides.long.fired && !bothUp.sides.short.fired, "uptrend: long fired, short did not");
    assert(bothUp.confidence >= 0.55, "confidence meets the balanced minimum");

    const bothDown = evaluateDirectionalScalping(withConfig({ direction: "both" }), { M5: down }, undefined, { now });
    assert(bothDown.decision === "ENTER" && bothDown.direction === "short", "downtrend must produce a short entry");
    assert(bothDown.sides.short.fired && !bothDown.sides.long.fired, "downtrend: short fired, long did not");

    // Direction restrictions
    const longOnlyOnDowntrend = evaluateDirectionalScalping(
        withConfig({ direction: "long_only" }),
        { M5: down },
        undefined,
        { now },
    );
    assert(longOnlyOnDowntrend.decision === "WAIT", "long_only must not short a downtrend");
    assert(longOnlyOnDowntrend.sides.short.evaluated === false, "forbidden side is not evaluated");

    const shortOnlyOnUptrend = evaluateDirectionalScalping(
        withConfig({ direction: "short_only" }),
        { M5: up },
        undefined,
        { now },
    );
    assert(shortOnlyOnUptrend.decision === "WAIT", "short_only must not long an uptrend");

    // Flat market: no trend, so neither side's trend rule can pass.
    const flat = makeCandles(240, "flat", now);
    const flatEval = evaluateDirectionalScalping(withConfig({ direction: "both" }), { M5: flat }, undefined, { now });
    assert(flatEval.decision === "WAIT", "flat market must WAIT");
    assert(flatEval.reason === "no_setup" || flatEval.reason === "low_confidence", `unexpected reason ${flatEval.reason}`);

    // Stale feed: newest bar is hours old relative to the evaluation clock.
    const stale = makeCandles(240, "up", now - 6 * 60 * 60 * 1000);
    const staleEval = evaluateDirectionalScalping(withConfig({ direction: "both" }), { M5: stale }, undefined, { now });
    assert(staleEval.decision === "WAIT" && staleEval.reason === "stale_data", "stale bars must WAIT");

    // Not enough history for indicator warm-up.
    const tiny = makeCandles(10, "up", now);
    const tinyEval = evaluateDirectionalScalping(withConfig({ direction: "both" }), { M5: tiny }, undefined, { now });
    assert(tinyEval.decision === "WAIT" && tinyEval.reason === "insufficient_data", "short history must WAIT");

    // No data at all.
    const none = evaluateDirectionalScalping(withConfig({ direction: "both" }), {}, undefined, { now });
    assert(none.decision === "WAIT" && none.reason === "no_data", "missing series must WAIT");

    // Confidence score is bounded (and 0 without a feature row).
    assert(bothUp.confidence >= 0 && bothUp.confidence <= 1, "confidence bounded to [0,1]");
    assert(scoreSignalConfidence(null, "long").score === 0, "missing features score 0, not a guess");

    console.log("  ✓ LONG / SHORT / WAIT / stale / insufficient data passed.");
}

async function testPacing(): Promise<void> {
    console.log("• Trade pacing…");
    const now = Date.now();
    const config = withConfig({
        maxTradesPerDay: 3,
        cooldownSeconds: 60,
        maxOpenPositions: 1,
        dailyNotionalBudget: 50_000,
    });

    const base = {
        now,
        tradesToday: 0,
        lastEntryAt: null,
        openPositions: 0,
        dailyNotionalUsed: 0,
        dailyNotionalIncomplete: false,
        drawdownBreakerActive: false,
    };

    assert(evaluateScalpingPacing(config, base).code === "OK", "clean state passes");

    assert(
        evaluateScalpingPacing(config, { ...base, drawdownBreakerActive: true }).code === "DRAWDOWN_BREAKER_ACTIVE",
        "latched breaker blocks entries",
    );
    assert(
        evaluateScalpingPacing(config, { ...base, openPositions: 1 }).code === "MAX_POSITIONS",
        "position cap blocks entries",
    );
    assert(
        evaluateScalpingPacing(config, { ...base, tradesToday: 3 }).code === "MAX_TRADES_PER_DAY",
        "daily trade cap blocks entries",
    );
    assert(
        evaluateScalpingPacing(config, { ...base, lastEntryAt: now - 10_000 }).code === "COOLDOWN_ACTIVE",
        "cooldown blocks entries",
    );
    assert(
        evaluateScalpingPacing(config, { ...base, dailyNotionalUsed: null }).code === "DAILY_NOTIONAL_UNKNOWN",
        "unknown notional fails closed",
    );
    assert(
        evaluateScalpingPacing(config, { ...base, dailyNotionalIncomplete: true }).code === "DAILY_NOTIONAL_UNKNOWN",
        "incomplete ledger fails closed",
    );
    assert(
        evaluateScalpingPacing(config, { ...base, dailyNotionalUsed: 50_000 }).code === "DAILY_NOTIONAL_BUDGET",
        "bot notional cap blocks entries",
    );
    // A null bot budget means the account limit governs — pacing stays OK.
    assert(
        evaluateScalpingPacing({ ...config, dailyNotionalBudget: null }, { ...base, dailyNotionalUsed: null }).code === "OK",
        "no bot budget means no bot-level notional check",
    );

    const start = startOfUtcDay(now);
    const d = new Date(start);
    assert(d.getUTCHours() === 0 && d.getUTCMinutes() === 0, "UTC day boundary is midnight UTC");

    console.log("  ✓ Pacing caps, breaker, cooldown and notional passed.");
}

async function testMethodologyTrace(): Promise<void> {
    console.log("• Skills Registry methodology trace…");
    const trace = scalpingMethodologyTrace();

    const riskEngine = trace.find((t) => t.skillId === "risk.engine");
    assert(riskEngine?.status === "active", "risk.engine must be active");
    assert(riskEngine!.implementation.includes("risk-engine"), "trace names the real implementation");

    const orderFingerprint = trace.find((t) => t.skillId === "execution.order-fingerprint");
    assert(orderFingerprint?.status === "active", "order fingerprint must be active");

    const pbo = trace.find((t) => t.skillId === "validation.pbo-cscv");
    assert(pbo?.status === "available", "PBO is registered but not applied by the bot");

    const structure = trace.find((t) => t.skillId === "methodology.market-structure");
    assert(structure?.status === "unavailable", "unregistered methodology must be reported unavailable");

    assert(scalpingMethodologiesVerified(), "every consumed skill must be registered and enabled");

    console.log("  ✓ Methodology trace is honest (active / available / unavailable).");
}

async function testDemoPerformance(): Promise<void> {
    console.log("• Demo performance summary…");
    const startedAt = Date.UTC(2026, 10, 20);
    const magic = 123_456_789;

    const deals: ClosedTradeRow[] = [
        { ticket: "1", symbol: "XAUUSD", type: "BUY", volume: 0.1, profit: 55, swap: -1, openedAt: startedAt + 1000, closedAt: startedAt + 5000, magic: String(magic) },
        { ticket: "2", symbol: "XAUUSD", type: "SELL", volume: 0.1, profit: -30, swap: 0, openedAt: startedAt + 2000, closedAt: startedAt + 6000, magic: String(magic) },
        { ticket: "3", symbol: "XAUUSD", type: "BUY", volume: 0.1, profit: 20, swap: 0, openedAt: startedAt + 3000, closedAt: startedAt + 7000, magic: String(magic) },
        // Not this bot: different magic.
        { ticket: "4", symbol: "XAUUSD", type: "BUY", volume: 0.1, profit: 999, swap: 0, openedAt: startedAt + 3000, closedAt: startedAt + 7000, magic: "42" },
        // Before the bot started.
        { ticket: "5", symbol: "XAUUSD", type: "BUY", volume: 0.1, profit: 500, swap: 0, openedAt: startedAt - 10_000, closedAt: startedAt + 1000, magic: String(magic) },
    ];

    const summary = summarizeDemoPerformance(deals, magic, startedAt, { count: 2, unrealizedPnl: 12.5 });
    assert(summary.available, "summary available with owned deals");
    assert(summary.closedTrades === 3, `only owned deals count (got ${summary.closedTrades})`);
    assert(summary.wins === 2 && summary.losses === 1, "win/loss classification");
    approx(summary.realizedPnl, 55 - 1 - 30 + 20, 0.0001, "realized P&L includes swap");
    approx(summary.winRate ?? 0, 2 / 3, 0.0001, "win rate");
    assert(summary.openPositions === 2 && summary.unrealizedPnl === 12.5, "open positions/unrealized");
    assert(summary.maxClosedDrawdown === 30, `closed drawdown (expected 30, got ${summary.maxClosedDrawdown})`);

    const empty = summarizeDemoPerformance([], magic, null, { count: 0, unrealizedPnl: 0 });
    assert(!empty.available && empty.winRate === null, "no deals → unavailable, not a fake 0%");

    console.log("  ✓ Demo performance excludes foreign magic and pre-start deals.");
}

async function testGatewayDistributable(): Promise<void> {
    console.log("• Gateway distributable…");
    const artifact = await readGatewayDistributable();

    assert(artifact.kind === "source", "the distributable is the .mq5 source, not a fake .ex5");
    assert(artifact.filename === "AlgoVaultTradeGateway.mq5", "download filename");
    assert(artifact.contentType === "application/octet-stream", "binary content type forces download");
    assert(artifact.contentLength > 1000, "file has content");
    assert(artifact.body.byteLength === artifact.contentLength, "declared length matches body");
    assert(/^\d+\.\d+/.test(artifact.version), `version parsed from #property (got ${artifact.version})`);

    const text = Buffer.from(artifact.body).toString("utf8");
    assert(text.includes("#property strict"), "served file is an MQL5 expert");
    assert(text.includes("GatewayToken"), "served file is the Gateway EA");
    assert(text.includes("PlatformURL"), "served file carries the platform URL input");

    assert(parseGatewayVersion('no version here') === null, "missing #property version returns null");

    // Honesty check: no compiled .ex5 may be shipped from the MQL5 source dir.
    const dir = path.dirname(path.resolve(process.cwd(), GATEWAY_SOURCE_PATH));
    const files = await readdir(dir);
    assert(!files.some((f) => f.endsWith(".ex5")), "no compiled .ex5 is shipped (none is claimed)");

    console.log("  ✓ Gateway download resolves a real, buildable .mq5 artifact.");
}

async function run(): Promise<void> {
    console.log("Scalping bots — test suite\n");
    await testConfigValidation();
    await testStrategyCompilation();
    await testDirectionResolution();
    await testDirectionalEvaluation();
    await testPacing();
    await testMethodologyTrace();
    await testDemoPerformance();
    await testGatewayDistributable();
    console.log("\nAll scalping tests passed.");
    console.log("NOT tested here: live MT5 demo execution (needs a running gateway + broker).");
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
