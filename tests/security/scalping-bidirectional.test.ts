/**
 * Scalping bots — bidirectional execution path (DEMO only, simulated EA).
 *
 * Drives the REAL bot runtime, the REAL AI Execution Gate and the REAL Unified
 * Trading Service through the lane planner, against the in-memory
 * firebase-admin seam. No broker, no network.
 *
 * Covered:
 *   1. HEDGING: long only qualifies → one BUY.
 *   2. HEDGING: short only qualifies → one SELL.
 *   3. HEDGING: both qualify → two independent commands, distinct executions.
 *   4. NETTING: both qualify → neither is submitted (no silent reversal).
 *   5. NETTING: opposing entry while long exposure exists → blocked.
 *   6. UNKNOWN: both qualify → blocked (fail closed).
 *   7. Restart: re-polling the same bar cannot duplicate either lane's order.
 *   8. Single-direction bots keep their behavior (see scalping-execution.test).
 *
 * NOT covered here: closing one side while the other stays open (the runtime
 * submits entries; closes are broker/gateway actions), live MT5 execution, or
 * ledger concurrency (see lib/trading/unified/__tests__/accounting.test.ts).
 */

import { BotRuntimeSession, type BotRuntimeOptions } from "@/lib/bot-studio/runtime";
import { deriveMagicNumber } from "@/lib/bot-studio/magic-numbers";
import type { BotDeployment } from "@/lib/bot-studio/types";
import type { MarketCandle } from "@/lib/market-data/types";
import type { MarketSnapshot } from "@/lib/market-data/market-truth";
import type {
    DirectionalScalpingEvaluation,
    ScalpingSideEvaluation,
} from "@/lib/bot-studio/scalping/directional";
import { Mt5DemoProvider } from "@/lib/trading/unified/mt5-demo-provider";
import { TradingProviderRegistry } from "@/lib/trading/unified/adapter";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";
import {
    buildScalpingStrategy,
    defaultScalpingConfig,
    type ScalpingBotConfig,
} from "@/lib/bot-studio/scalping/profiles";
import { createScalpingPacingCheck } from "@/lib/bot-studio/scalping/pacing";
import { OrderFingerprintGuard } from "@/lib/risk/order-fingerprint";
import { rtDbStore } from "./firebase-admin-stub";

const UID = "proBidirectional";
const ACCOUNT_NUMBER = "50990001";
const ACCOUNT_KEY = `gateway_${ACCOUNT_NUMBER}`;
const GATEWAY_TOKEN = "gw_token_proBidirectional";
const TF_MS = 300_000;
const END_MS = Math.floor(Date.now() / TF_MS) * TF_MS;

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`FAIL: ${message}`);
}

function config(overrides: Partial<ScalpingBotConfig> = {}): ScalpingBotConfig {
    return {
        ...defaultScalpingConfig("balanced"),
        symbol: "EURUSD",
        sessions: ["asian", "london", "new_york", "overlap"],
        ...overrides,
    };
}

function candles(count = 240): MarketCandle[] {
    const scale = 1.1 / 2000;
    const out: MarketCandle[] = [];
    let price = 2000;
    for (let i = 0; i < count; i++) {
        const drift = 1.8;
        const wobble = Math.sin(i * 1.7) * 0.6;
        const open = price;
        const close = price + drift + wobble * 0.2;
        out.push({
            timestamp: END_MS - (count - 1 - i) * TF_MS,
            open: open * scale,
            high: (Math.max(open, close) + 0.9) * scale,
            low: (Math.min(open, close) - 0.9) * scale,
            close: close * scale,
            volume: 100,
        });
        price = close;
    }
    return out;
}

const BARS = candles();

function laneSide(side: "long" | "short", fired: boolean): ScalpingSideEvaluation {
    return {
        side,
        evaluated: true,
        fired,
        confidence: fired ? 0.9 : 0,
        blockedBy: fired ? null : "entry_rules",
        conditions: [],
        breakdown: [],
    };
}

function laneEvaluation(fired: { long: boolean; short: boolean }): DirectionalScalpingEvaluation {
    const decision = fired.long || fired.short;
    return {
        decision: decision ? "ENTER" : "WAIT",
        direction: fired.long ? "long" : fired.short ? "short" : null,
        reason: null,
        detail: "test fixture: independent lane evaluation",
        confidence: decision ? 0.9 : 0,
        atr: 0.0008,
        regime: "trending",
        session: "london",
        trend: "neutral",
        barTimestamp: 0,
        barAgeMs: 0,
        symbol: "EURUSD",
        timeframe: "M5",
        sides: {
            long: laneSide("long", fired.long),
            short: laneSide("short", fired.short),
        },
    };
}

function marketTruthWith(spread: number): NonNullable<BotRuntimeOptions["marketTruth"]> {
    return async () => {
        const last = BARS[BARS.length - 1];
        return {
            snapshot: {
                currentPrice: last.close,
                bid: last.close - spread / 2,
                ask: last.close + spread / 2,
                spread,
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
    return createUnifiedTradingService({
        registry: new TradingProviderRegistry([provider]),
        duplicateGuard: new OrderFingerprintGuard({ windowMs: 2_000 }),
    });
}

function queuedCommands(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of rtDbStore.entries()) {
        const prefix = `trading_order_requests/${UID}/`;
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue;
        out[rest] = value as Record<string, unknown>;
    }
    return out;
}

function deploymentState(botId: string): Record<string, unknown> | undefined {
    return rtDbStore.get(`bot_deployments/${botId}`) as Record<string, unknown> | undefined;
}

function executionsUnder(botId: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of rtDbStore.entries()) {
        const prefix = `bot_executions/${botId}/`;
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue;
        out[rest] = value;
    }
    return out;
}

function laneState(botId: string): { long?: { status?: string; blockedReason?: string | null }; short?: { status?: string; blockedReason?: string | null }; positionMode?: string } | undefined {
    return deploymentState(botId)?.lanes as
        | { long?: { status?: string; blockedReason?: string | null }; short?: { status?: string; blockedReason?: string | null }; positionMode?: string }
        | undefined;
}

let botSeq = 0;

function deploymentFor(overrides: Partial<BotDeployment> = {}): BotDeployment {
    botSeq += 1;
    const now = Date.now();
    return {
        id: `BOT_BIDIR_${botSeq}`,
        strategyId: `STRAT_BIDIR_${botSeq}`,
        deployedFingerprint: `fp_bidir_${botSeq}`,
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

/** marginMode: 2 hedging, 0 netting, undefined = never reported. */
function seed(marginMode: number | undefined, positions: Record<string, unknown> = {}): void {
    const now = Date.now();
    rtDbStore.clear();
    rtDbStore.set(`trading_access/${UID}`, { lic1: { status: "active", expiresAt: now + 86_400_000 } });
    rtDbStore.set(`gateway_users/${GATEWAY_TOKEN}`, { userId: UID, userEmail: "bidir@example.com" });
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
        gatewayVersion: "1.4",
        ...(marginMode === undefined
            ? {}
            : { positionMode: normalizeForSeed(marginMode), positionModeReportedAt: now }),
    });
    rtDbStore.set(`trading_positions/${UID}/${ACCOUNT_KEY}`, positions);
    rtDbStore.set("bot_executions", {});
}

function normalizeForSeed(marginMode: number): string {
    return marginMode === 2 ? "HEDGING" : marginMode === 0 ? "NETTING" : "EXCHANGE";
}

function sessionFor(
    cfg: ScalpingBotConfig,
    deployment: BotDeployment,
    fired: { long: boolean; short: boolean },
): BotRuntimeSession {
    const strategy = { ...buildScalpingStrategy(cfg, "long"), id: deployment.strategyId };
    const magicNumber = deriveMagicNumber(deployment.strategyId);
    return new BotRuntimeSession({
        deployment,
        strategy,
        magicNumber,
        marketTruth: marketTruthWith(0.0001),
        serviceFactory,
        laneConfig: cfg,
        laneEvaluator: () => laneEvaluation(fired),
        preSignalCheck: createScalpingPacingCheck({ deployment, config: cfg, magicNumber }),
    });
}

async function tick(session: BotRuntimeSession) {
    return session.tick({ candles: BARS, timeframe: "M5", series: { M5: BARS } });
}

async function run(): Promise<void> {
    console.log("Running bidirectional scalping execution tests (DEMO, simulated EA)...\n");

    // ── 1. HEDGING: long only ──────────────────────────────────────────────
    seed(2);
    const longOnlyDep = deploymentFor();
    const longOnly = sessionFor(config(), longOnlyDep, { long: true, short: false });
    await longOnly.initialize();
    const longOnlyTick = await tick(longOnly);
    assert(longOnlyTick.gateApproved === true, "HEDGING long-only lane must pass the gate");
    let commands = Object.values(queuedCommands());
    assert(commands.length === 1, `exactly one command expected (got ${commands.length})`);
    assert(commands[0].action === "BUY", `expected BUY (got ${String(commands[0].action)})`);
    console.log("  ✓ HEDGING: a qualifying long lane submits exactly one BUY.");

    // ── 2. HEDGING: short only ─────────────────────────────────────────────
    seed(2);
    const shortOnlyDep = deploymentFor();
    const shortOnly = sessionFor(config(), shortOnlyDep, { long: false, short: true });
    await shortOnly.initialize();
    const shortOnlyTick = await tick(shortOnly);
    assert(shortOnlyTick.gateApproved === true, "HEDGING short-only lane must pass the gate");
    commands = Object.values(queuedCommands());
    assert(commands.length === 1, `exactly one command expected (got ${commands.length})`);
    assert(commands[0].action === "SELL", `expected SELL (got ${String(commands[0].action)})`);
    console.log("  ✓ HEDGING: a qualifying short lane submits exactly one SELL.");

    // ── 3. HEDGING: both lanes ─────────────────────────────────────────────
    seed(2);
    const bothDep = deploymentFor();
    const both = sessionFor(config(), bothDep, { long: true, short: true });
    await both.initialize();
    const bothTick = await tick(both);
    assert(bothTick.gateApproved === true, "both lanes must reach the execution pipeline");
    commands = Object.values(queuedCommands());
    assert(commands.length === 2, `both qualifying lanes must queue two commands (got ${commands.length})`);
    const actions = commands.map((c) => String(c.action)).sort();
    assert(actions[0] === "BUY" && actions[1] === "SELL", `expected BUY + SELL (got ${actions.join(",")})`);
    const executions = Object.keys(executionsUnder(bothDep.id));
    assert(executions.length === 2, `each lane must persist its own execution (got ${executions.length})`);
    assert(new Set(commands.map((c) => String(c.clientRequestId))).size === 2, "client request ids must be distinct");
    const persistedLanes = laneState(bothDep.id);
    assert(persistedLanes?.long !== undefined && persistedLanes?.short !== undefined, "both lane states must persist");
    console.log("  ✓ HEDGING: both lanes submit independently, with distinct executions.");

    // ── 4. NETTING: both lanes must be blocked ─────────────────────────────
    seed(0);
    const nettingDep = deploymentFor();
    const netting = sessionFor(config(), nettingDep, { long: true, short: true });
    await netting.initialize();
    const nettingTick = await tick(netting);
    assert(nettingTick.signalGenerated === false, "a netting conflict must not submit a signal");
    assert(nettingTick.waited === true, "a netting conflict must report WAIT");
    assert(Object.keys(queuedCommands()).length === 0, "no command may be queued on a netting conflict");
    const nettingLanes = laneState(nettingDep.id);
    assert(nettingLanes?.long?.blockedReason === "netting_blocked", "long lane must record the netting block");
    assert(nettingLanes?.short?.blockedReason === "netting_blocked", "short lane must record the netting block");
    console.log("  ✓ NETTING: simultaneous opposing entries are blocked with an explicit reason.");

    // ── 5. NETTING: opposing entry against open long exposure ──────────────
    seed(0, {
        "700001": {
            ticket: "700001",
            symbol: "EURUSD",
            type: "BUY",
            volume: 0.1,
            magic: 0,
            openPrice: 1.1,
        },
    });
    const againstDep = deploymentFor();
    const against = sessionFor(config(), againstDep, { long: false, short: true });
    await against.initialize();
    const againstTick = await tick(against);
    assert(againstTick.signalGenerated === false, "a netting account must not hedge an open long");
    assert(Object.keys(queuedCommands()).length === 0, "no reversing order may be queued");
    assert(
        laneState(againstDep.id)?.short?.blockedReason === "netting_blocked",
        "the short lane must explain the netting block",
    );
    console.log("  ✓ NETTING: an opposing entry against open exposure is blocked, never reversed.");

    // ── 6. UNKNOWN: both lanes blocked ─────────────────────────────────────
    seed(undefined);
    const unknownDep = deploymentFor();
    const unknown = sessionFor(config(), unknownDep, { long: true, short: true });
    await unknown.initialize();
    const unknownTick = await tick(unknown);
    assert(unknownTick.signalGenerated === false, "an unreported position mode must not trade a hedge");
    assert(Object.keys(queuedCommands()).length === 0, "no command may be queued when the mode is unknown");
    assert(
        laneState(unknownDep.id)?.long?.blockedReason === "unknown_position_mode",
        "the block reason must say the position mode is unknown",
    );
    console.log("  ✓ UNKNOWN: unreported accounting fails closed for both lanes.");

    // ── 7. Restart: no duplicate orders ────────────────────────────────────
    seed(2);
    const restartDep = deploymentFor();
    const restartCfg = config();
    const first = sessionFor(restartCfg, restartDep, { long: true, short: true });
    await first.initialize();
    const firstTick = await tick(first);
    assert(firstTick.gateApproved === true, "the first tick must submit both lanes");
    const firstCount = Object.keys(queuedCommands()).length;
    assert(firstCount === 2, `two commands expected before restart (got ${firstCount})`);

    const restarted = sessionFor(restartCfg, restartDep, { long: true, short: true });
    await restarted.initialize();
    const replay = await tick(restarted);
    assert(replay.signalGenerated === false, "a restarted worker must not re-emit the handled bar");
    assert(
        Object.keys(queuedCommands()).length === firstCount,
        "a restart must not queue duplicates for either lane",
    );
    console.log("  ✓ Restart: deterministic lane ids prevent duplicate orders.");

    console.log("\nAll bidirectional scalping execution tests passed.");
    console.log("NOT tested here: closing one side while the other stays open, ledger concurrency, live MT5.\n");
}

await run();
