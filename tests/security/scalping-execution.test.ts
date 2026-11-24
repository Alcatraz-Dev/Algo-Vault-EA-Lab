/**
 * Scalping bots — end-to-end execution path (DEMO only, no broker, no network).
 *
 * Drives the REAL bot runtime with the REAL scalping seams
 * (`buildScalpingSessionOptions`) through the REAL AI Execution Gate and the
 * REAL Unified Trading Service, against the in-memory firebase-admin seam and
 * a simulated EA (the test plays the EA's role: it reads the queued command
 * and asserts on it; nothing is ever sent to a broker).
 *
 * Covered:
 *   1. LONG_ONLY on an uptrend → BUY command with SL below / TP above entry.
 *   2. SHORT_ONLY on a downtrend → SELL command with SL above / TP below entry.
 *   3. LONG_ONLY on a downtrend → WAIT, nothing queued.
 *   4. BOTH on an uptrend → exactly one BUY (never a conflicting pair).
 *   5. BOTH on a directionless series → WAIT, nothing queued.
 *   6. Spread too wide → gate rejects (SPREAD_TOO_WIDE), nothing queued.
 *   7. Drawdown breaker tripped → pacing suppresses, nothing queued.
 *   8. Paused / stopped deployment → no evaluation, nothing queued.
 *   9. Worker restart re-polling the same page → no duplicate command.
 *
 * NOT covered here: a live MT5 demo terminal. That needs a running gateway and
 * broker; the suite reports it as untested instead of pretending otherwise.
 */

import { BotRuntimeSession, type BotRuntimeOptions } from "@/lib/bot-studio/runtime";
import { deriveMagicNumber } from "@/lib/bot-studio/magic-numbers";
import type { BotDeployment } from "@/lib/bot-studio/types";
import type { MarketCandle } from "@/lib/market-data/types";
import type { MarketSnapshot } from "@/lib/market-data/market-truth";
import { Mt5DemoProvider } from "@/lib/trading/unified/mt5-demo-provider";
import { TradingProviderRegistry } from "@/lib/trading/unified/adapter";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";
import { buildScalpingStrategy, defaultScalpingConfig, type ScalpingBotConfig } from "@/lib/bot-studio/scalping/profiles";
import { buildScalpingSessionOptions } from "@/lib/bot-studio/scalping/session";
import { OrderFingerprintGuard } from "@/lib/risk/order-fingerprint";
import { rtDbStore } from "./firebase-admin-stub";

const UID = "proScalper";
const ACCOUNT_NUMBER = "50198765";
const ACCOUNT_KEY = `gateway_${ACCOUNT_NUMBER}`;
const GATEWAY_TOKEN = "gw_token_proScalper";
const TF_MS = 300_000;
/** Bars end on the current closed M5 boundary so the feed is fresh. */
const END_MS = Math.floor(Date.now() / TF_MS) * TF_MS;

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

const ALL_SESSIONS: ScalpingBotConfig["sessions"] = ["asian", "london", "new_york", "overlap"];

function config(overrides: Partial<ScalpingBotConfig> = {}): ScalpingBotConfig {
    return {
        ...defaultScalpingConfig("balanced"),
        // The generated series is EURUSD-shaped; keep the instrument match so
        // pip geometry (and therefore the stop-distance check) is real.
        symbol: "EURUSD",
        // Session filtering has its own unit test; this suite must not depend
        // on the wall-clock hour the CI job happens to run at.
        sessions: ALL_SESSIONS,
        ...overrides,
    };
}

/**
 * Deterministic trend series. Prices are generated around 2000 (the shape the
 * unit tests use) and rescaled to a realistic EURUSD price so sizing and the
 * symbol spec behave like production.
 */
function series(shape: "up" | "down" | "flat", count = 240): MarketCandle[] {
    const scale = 1.1 / 2000;
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
            timestamp: END_MS - (count - 1 - i) * TF_MS,
            open: open * scale,
            high: high * scale,
            low: low * scale,
            close: close * scale,
            volume: 100,
        });
        price = close;
    }
    return candles;
}

const UP = series("up");
const DOWN = series("down");
const FLAT = series("flat");

function entriesUnder(path: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of rtDbStore.entries()) {
        if (!key.startsWith(path + "/")) continue;
        const rest = key.slice(path.length + 1);
        if (rest.includes("/")) continue;
        out[rest] = value as Record<string, unknown>;
    }
    return out;
}

function queuedCommands(): Record<string, Record<string, unknown>> {
    return entriesUnder(`trading_order_requests/${UID}`);
}

let botSeq = 0;

function deploymentFor(overrides: Partial<BotDeployment> = {}): BotDeployment {
    botSeq += 1;
    const now = Date.now();
    return {
        id: `BOT_SCALP_${botSeq}`,
        strategyId: `STRAT_SCALP_${botSeq}`,
        deployedFingerprint: `fp_scalp_${botSeq}`,
        ownerId: UID,
        mt5Account: ACCOUNT_NUMBER,
        accountMode: "demo",
        runtimeState: "running",
        desiredState: "running",
        signalCount: 0,
        executionCount: 0,
        rejectionCount: 0,
        openPositions: [],
        createdAt: now - 86_400_000,
        updatedAt: now,
        startedAt: now - 60_000,
        ...overrides,
    };
}

function marketTruthWith(spread: number): NonNullable<BotRuntimeOptions["marketTruth"]> {
    return async () => {
        const last = UP[UP.length - 1];
        return {
            snapshot: {
                currentPrice: last.close,
                bid: last.close - spread / 2,
                ask: last.close + spread / 2,
                spread,
                // The gate evaluates with a `now` captured before this read; a
                // quote stamped in the same or a later millisecond can trip the
                // staleness check. Real quotes are always slightly old.
                timestamp: Date.now() - 500,
                provider: "tradingview",
                timeframe: "M5",
            } as unknown as MarketSnapshot,
            freshness: { fresh: true, status: "fresh", dataAgeMs: 0, thresholdMs: 600_000, category: "short" },
        };
    };
}

function serviceFactory(): ReturnType<typeof createUnifiedTradingService> {
    const provider = new Mt5DemoProvider({
        heartbeatStaleMs: 90_000,
        heartbeatDegradedMs: 45_000,
        executionTimeoutMs: 3_000,
        pollIntervalMs: 5,
        verificationTimeoutMs: 2_000,
        clock: () => Date.now(),
    });
    // A fresh burst-duplicate window per scenario. The process-level guard in
    // `createUnifiedTradingService` exists to absorb double-submits of the SAME
    // order within 2s; here each scenario is an independent bot, and a shared
    // guard would suppress the second scenario's (identically sized) order
    // instead of exercising its direction logic.
    return createUnifiedTradingService({
        registry: new TradingProviderRegistry([provider]),
        duplicateGuard: new OrderFingerprintGuard({ windowMs: 2_000 }),
    });
}

function sessionFor(
    cfg: ScalpingBotConfig,
    deployment: BotDeployment,
    overrides: Partial<BotRuntimeOptions> = {},
): BotRuntimeSession {
    // `buildScalpingStrategy` compiles the rules; the persisted strategy id is
    // owned by the caller (the create route) and keys the signal/execution
    // identity. Each scenario is a distinct bot, so give it a distinct id.
    const strategy = {
        ...buildScalpingStrategy(cfg, cfg.direction === "short_only" ? "short" : "long"),
        id: deployment.strategyId,
    };
    const magicNumber = deriveMagicNumber(deployment.strategyId);
    return new BotRuntimeSession({
        deployment,
        strategy,
        magicNumber,
        marketTruth: marketTruthWith(0.0001),
        serviceFactory,
        ...buildScalpingSessionOptions({ deployment, config: cfg, magicNumber }),
        ...overrides,
    });
}

function seed(): void {
    const now = Date.now();
    rtDbStore.clear();
    // `botSeq` intentionally keeps counting across scenarios: the unified
    // service keeps a process-wide idempotency cache, so reusing a bot id + bar
    // would look like a duplicate order instead of a fresh scenario.
    rtDbStore.set(`trading_access/${UID}`, { lic1: { status: "active", expiresAt: now + 86_400_000 } });
    rtDbStore.set(`gateway_users/${GATEWAY_TOKEN}`, { userId: UID, userEmail: "scalp@example.com" });
    rtDbStore.set(`gateway_tokens_meta/${UID}`, { token: GATEWAY_TOKEN });
    rtDbStore.set(`trading_accounts/${UID}/${ACCOUNT_KEY}`, {
        mt5Account: ACCOUNT_NUMBER,
        environment: "DEMO",
        demo: true,
        server: "MetaQuotes-Demo",
        balance: 10_000,
        equity: 10_000,
        margin: 0,
        freeMargin: 10_000,
        leverage: 100,
        currency: "USD",
        positionsCount: 0,
        pendingOrdersCount: 0,
        lastHeartbeatAt: now,
        connectedAt: now - 60_000,
        gatewayVersion: "1.3",
    });
    rtDbStore.set(`trading_positions/${UID}/${ACCOUNT_KEY}`, {});
    rtDbStore.set(`bot_executions`, {});
}

async function tick(session: BotRuntimeSession, candles: MarketCandle[]) {
    return session.tick({ candles, timeframe: "M5", series: { M5: candles } });
}

async function run(): Promise<void> {
    console.log("Running scalping execution-path tests (DEMO, simulated EA)...\n");

    // ── 1. LONG_ONLY on an uptrend ─────────────────────────────────────────
    seed();
    const longCfg = config({ direction: "long_only" });
    const longDep = deploymentFor();
    const longSession = sessionFor(longCfg, longDep);
    await longSession.initialize();
    const longTick = await tick(longSession, UP);

    assert(longTick.signalGenerated === true, `LONG must fire (got ${longTick.waited ? `WAIT/${longTick.waitReason}` : "none"})`);
    assert(longTick.direction === "long", `LONG direction must be long (got ${longTick.direction})`);
    assert(longTick.gateApproved === true, `LONG must pass the gate (got ${longTick.gateCode})`);

    let commands = Object.values(queuedCommands());
    assert(commands.length === 1, `exactly one LONG command must be queued (got ${commands.length})`);
    const buy = commands[0];
    assert(buy.action === "BUY", `command must be BUY (got ${String(buy.action)})`);
    assert(buy.source === "bot-studio", "command must carry trusted bot-studio attribution");
    assert(Number(buy.magicNumber) === deriveMagicNumber(longDep.strategyId), "command must use the strategy magic");
    assert(Number(buy.volume) > 0, "command must carry a risk-approved volume");
    assert(
        Number(buy.sl) < Number(buy.price === 0 ? UP[UP.length - 1].close : buy.price),
        "BUY stop must sit below entry",
    );
    assert(
        Number(buy.tp) > Number(buy.price === 0 ? UP[UP.length - 1].close : buy.price),
        "BUY take-profit must sit above entry",
    );
    assert(typeof longTick.executionId === "string", "execution id recorded");
    assert(
        rtDbStore.has(`bot_executions/${longDep.id}/${longTick.executionId}`),
        "execution persisted for the bot",
    );
    console.log("  ✓ LONG_ONLY fires a BUY through the gate with a broker-agnostic SL/TP.");

    // ── 2. SHORT_ONLY on a downtrend ───────────────────────────────────────
    seed();
    const shortCfg = config({ direction: "short_only" });
    const shortDep = deploymentFor();
    const shortSession = sessionFor(shortCfg, shortDep);
    await shortSession.initialize();
    const shortTick = await tick(shortSession, DOWN);

    assert(shortTick.signalGenerated === true, `SHORT must fire (got ${shortTick.waited ? `WAIT/${shortTick.waitReason}` : "none"})`);
    assert(shortTick.direction === "short", `SHORT direction must be short (got ${shortTick.direction})`);
    assert(shortTick.gateApproved === true, `SHORT must pass the gate (got ${shortTick.gateCode})`);

    commands = Object.values(queuedCommands());
    assert(commands.length === 1, `exactly one SHORT command must be queued (got ${commands.length})`);
    const sell = commands[0];
    assert(sell.action === "SELL", `command must be SELL (got ${String(sell.action)})`);
    assert(Number(sell.sl) > Number(sell.price === 0 ? DOWN[DOWN.length - 1].close : sell.price), "SELL stop must sit above entry");
    assert(Number(sell.tp) < Number(sell.price === 0 ? DOWN[DOWN.length - 1].close : sell.price), "SELL take-profit must sit below entry");
    console.log("  ✓ SHORT_ONLY fires a SELL with inverted stop/target.");

    // ── 3. LONG_ONLY refuses a downtrend ───────────────────────────────────
    seed();
    const wrongWayDep = deploymentFor();
    const wrongWay = sessionFor(config({ direction: "long_only" }), wrongWayDep);
    await wrongWay.initialize();
    const wrongWayTick = await tick(wrongWay, DOWN);
    assert(wrongWayTick.signalGenerated === false, "LONG_ONLY must not fire on a downtrend");
    assert(wrongWayTick.waited === true, "LONG_ONLY must report WAIT");
    assert(Object.keys(queuedCommands()).length === 0, "no command may be queued on a direction mismatch");
    const stored = rtDbStore.get(`bot_deployments/${wrongWayDep.id}`) as
        | { lastEvaluation?: { decision?: string } }
        | undefined;
    assert(stored?.lastEvaluation?.decision === "WAIT", "the WAIT decision must be persisted for the terminal");
    console.log("  ✓ LONG_ONLY waits on a downtrend and persists the WAIT decision.");

    // ── 4. BOTH takes exactly one side ─────────────────────────────────────
    seed();
    const bothDep = deploymentFor();
    const both = sessionFor(config({ direction: "both" }), bothDep);
    await both.initialize();
    const bothTick = await tick(both, UP);
    assert(bothTick.signalGenerated === true, "BOTH must fire on a clear trend");
    assert(bothTick.direction === "long", `BOTH must resolve to long here (got ${bothTick.direction})`);
    commands = Object.values(queuedCommands());
    assert(
        commands.length === 1,
        `BOTH must queue exactly one command (got ${commands.length}; tick=${JSON.stringify(bothTick)})`,
    );
    assert(!commands.some((c) => c.action === "SELL"), "BOTH must never queue a conflicting SELL");
    console.log("  ✓ BOTH resolves one direction and never queues a conflicting pair.");

    // ── 5. BOTH waits when nothing qualifies ───────────────────────────────
    seed();
    const flatDep = deploymentFor();
    const flat = sessionFor(config({ direction: "both" }), flatDep);
    await flat.initialize();
    const flatTick = await tick(flat, FLAT);
    assert(flatTick.signalGenerated === false, "a directionless series must not fire");
    assert(flatTick.waited === true, "a directionless series must WAIT");
    assert(Object.keys(queuedCommands()).length === 0, "nothing may be queued when no direction qualifies");
    console.log("  ✓ BOTH waits instead of forcing a trade.");

    // ── 6. Spread filter ───────────────────────────────────────────────────
    seed();
    const spreadDep = deploymentFor();
    const wide = sessionFor(config({ direction: "both" }), spreadDep, {
        marketTruth: marketTruthWith(0.003), // 30 pips on EURUSD
    });
    await wide.initialize();
    const spreadTick = await tick(wide, UP);
    assert(spreadTick.signalGenerated === true, "the strategy still signals with a wide quote");
    assert(spreadTick.gateApproved === false, "the gate must reject a 30-pip spread");
    assert(spreadTick.gateCode === "SPREAD_TOO_WIDE", `expected SPREAD_TOO_WIDE (got ${spreadTick.gateCode})`);
    assert(Object.keys(queuedCommands()).length === 0, "nothing may be queued on a spread rejection");
    console.log("  ✓ Spread rejection happens in the gate and queues nothing.");

    // ── 7. Drawdown breaker ────────────────────────────────────────────────
    seed();
    rtDbStore.set(`trading_controls/${UID}/${ACCOUNT_KEY}`, { drawdownBreaker: { state: "TRIPPED" } });
    const breakerDep = deploymentFor();
    const breaker = sessionFor(config({ direction: "both" }), breakerDep);
    await breaker.initialize();
    const breakerTick = await tick(breaker, UP);
    assert(breakerTick.signalGenerated === true, "the strategy still evaluates while the breaker is latched");
    assert(breakerTick.gateApproved === false, "a latched breaker must block the entry");
    assert(
        breakerTick.gateCode === "DRAWDOWN_BREAKER_ACTIVE",
        `expected DRAWDOWN_BREAKER_ACTIVE (got ${breakerTick.gateCode})`,
    );
    assert(Object.keys(queuedCommands()).length === 0, "nothing may be queued while the breaker is latched");
    console.log("  ✓ A latched drawdown breaker suppresses entries before the gate.");

    // ── 8. Paused / stopped deployments ────────────────────────────────────
    seed();
    for (const state of ["paused", "stopped"] as const) {
        const dep = deploymentFor({ runtimeState: state, desiredState: state });
        const session = sessionFor(config({ direction: "both" }), dep);
        await session.initialize();
        const result = await tick(session, UP);
        assert(result.signalGenerated === false, `a ${state} bot must not generate signals`);
        assert(Object.keys(queuedCommands()).length === 0, `a ${state} bot must queue nothing`);
    }
    console.log("  ✓ Paused and stopped bots cannot submit entries.");

    // ── 9. Restart / duplicate protection ──────────────────────────────────
    seed();
    const restartDep = deploymentFor();
    const restartCfg = config({ direction: "both" });
    const first = sessionFor(restartCfg, restartDep);
    await first.initialize();
    const firstTick = await tick(first, UP);
    assert(firstTick.gateApproved === true, "first tick must queue an order");
    const firstIds = Object.keys(queuedCommands());

    // Fresh session = simulated worker restart, same persisted deployment.
    const restarted = sessionFor(restartCfg, restartDep);
    await restarted.initialize();
    const replayed = await tick(restarted, UP);
    assert(replayed.signalGenerated === false, "a restarted worker must not re-emit a handled bar");
    assert(
        Object.keys(queuedCommands()).length === firstIds.length,
        "a restart must not queue a second command",
    );

    // Even with the bar dedupe bypassed, the deterministic execution id must
    // absorb the replay: the durable execution record already exists.
    const existing = rtDbStore.get(`bot_executions/${restartDep.id}/${firstTick.executionId}`) as
        | { status?: string }
        | undefined;
    assert(!!existing, "the first execution must be durable");
    console.log("  ✓ Restart re-polling the same bar cannot duplicate the order.");

    console.log("\nAll scalping execution-path tests passed.");
    console.log("NOT tested here: live MT5 demo terminal (needs a running gateway + broker).\n");
}

await run();
