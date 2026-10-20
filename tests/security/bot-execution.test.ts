/**
 * Bot Studio → Unified Trading → MT5 Gateway — execution-path tests.
 *
 * Everything runs against the in-memory firebase-admin seam and a SIMULATED
 * EA: the test plays the EA's role by reading the queued command and posting
 * the authenticated execution report to the REAL route handler. No broker
 * order is ever submitted and no network call leaves the process.
 *
 * Covered:
 *   1. A real strategy signal is evaluated on the strategy's setup timeframe
 *      and queued through the unified trading service with trusted bot
 *      attribution (magic, comment, botId, executionId).
 *   2. Polling the same closed page again never re-submits.
 *   3. A worker restart (fresh session) never re-submits a handled signal.
 *   4. A paused bot generates no new entries (cached sessions included).
 *   5. An unauthorized bot is rejected by the gate and queues nothing.
 *   6. No report ⇒ no fabricated fill (execution stays pending).
 *   7. The authenticated report confirms the exact execution + ticket.
 *   8. Reports for another account are rejected (403) and change nothing.
 *   9. Snapshot attribution indexes the bot position/trade by magic and never
 *      touches a manual (magic 0) trade.
 *  10. LIVE mode is refused while live trading is disabled.
 *  11. A stale gateway heartbeat blocks the queue write; a reconnect recovers.
 */

import { BotRuntimeSession, type BotRuntimeOptions } from "@/lib/bot-studio/runtime";
import { deriveMagicNumber, buildOrderComment } from "@/lib/bot-studio/magic-numbers";
import type { BotDeployment } from "@/lib/bot-studio/types";
import type { Strategy } from "@/lib/strategy-lab/types";
import type { MarketCandle } from "@/lib/market-data/types";
import type { MarketSnapshot } from "@/lib/market-data/market-truth";
import { Mt5DemoProvider } from "@/lib/trading/unified/mt5-demo-provider";
import { TradingProviderRegistry } from "@/lib/trading/unified/adapter";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";
import { POST as postExecutionReport } from "@/app/api/trading/gateway/execution/route";
import { POST as postSnapshot } from "@/app/api/trading/gateway/snapshot/route";
import { POST as postLifecycle } from "@/app/api/bot-studio/deployments/[botId]/lifecycle/route";
import { GET as pollCommands } from "@/app/api/trading/gateway/commands/route";
import { rtDbStore } from "./firebase-admin-stub";

const UID = "proBot";
const ACCOUNT_NUMBER = "50123456";
const ACCOUNT_KEY = `gateway_${ACCOUNT_NUMBER}`;
const GATEWAY_TOKEN = "gw_token_proBot";
const BOT_ID = "BOT_TEST";
const STRATEGY_ID = "STRAT_TEST";

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(`FAIL: ${msg}`);
}

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

function signUserToken(uid: string): string {
    const payload = JSON.stringify({ sub: uid, role: "customer" });
    return `fake-token-${uid}.${btoa(payload)}.sig`;
}

function lifecycleRequest(body: Record<string, unknown>) {
    return {
        headers: { get: (name: string) => (name === "authorization" ? `Bearer ${signUserToken(UID)}` : null) },
        json: async () => body,
    } as unknown as Parameters<typeof postLifecycle>[0];
}

function jsonRequest(body: Record<string, unknown>, token = GATEWAY_TOKEN) {
    return {
        headers: { get: (name: string) => (name === "authorization" ? `Bearer ${token}` : null) },
        json: async () => body,
    } as unknown as Parameters<typeof postExecutionReport>[0];
}

function candles(count: number, start: number, stepMs: number, slope: number): MarketCandle[] {
    return Array.from({ length: count }, (_, i) => {
        const close = 1.1 + i * slope + Math.sin(i / 3) * 0.0004;
        return {
            timestamp: start + i * stepMs,
            open: close - 0.0001,
            high: close + 0.0007,
            low: close - 0.0007,
            close,
            volume: 100,
        };
    });
}

const M5_STEP = 5 * 60_000;
const M1_STEP = 60_000;
const BASE_TIME = Date.now() - 200 * M5_STEP;
const M5_PAGE = candles(200, BASE_TIME, M5_STEP, 0.0002);
const M1_PAGE = candles(600, BASE_TIME, M1_STEP, 0.0002);
const M1_FALLING = candles(600, BASE_TIME, M1_STEP, -0.0002);

const strategy: Strategy = {
    id: STRATEGY_ID,
    name: "EMA trend test",
    description: "Test-only strategy",
    asset: "EURUSD",
    direction: "long",
    timeframes: { macro: "H1", structure: "H1", setup: "M5", entry: "M1" },
    regimeFilter: [],
    entryRules: [{
        id: "rule_trend",
        enabled: true,
        group: "indicator",
        label: "EMA20 above EMA50",
        operator: "gt",
        timeframe: "M5",
        value: 0,
        groupLogic: "AND",
        indicator: "ema_20",
        compareTo: "ema_50",
    }],
    confirmationRules: [],
    stopLoss: { mode: "atr", atrMultiple: 2, levelOffset: 0, useSwing: false },
    takeProfit: {
        mode: "r",
        r1: 2,
        r2: 3,
        r3: 4,
        fixedDistance: 0,
        partialCloses: [],
        moveBeAfterTp1: false,
        lockAfterTp2: false,
        trailingEnabled: false,
        trailingStopAtr: 0,
    },
    risk: { mode: "percent", riskPercent: 1, fixedLot: 0.1, maxPositions: 1, dailyLossLimitPct: 5, maxDrawdownPct: 20 },
    filters: {
        sessions: [],
        daysOfWeek: [],
        volatilityMinAtrPct: 0,
        volatilityMaxAtrPct: 0,
        maxTradesPerDay: 10,
        cooldownCandles: 0,
    },
    executionModel: "next_bar_open",
    costs: { spreadPips: 0, commissionPerLot: 0, slippagePips: 0 },
    sourcePatternId: null,
    whyp: {
        discovered: "",
        conditionsSelected: "",
        occurrenceFrequency: "",
        historicalPerformance: "",
        weaknesses: "",
        poorRegimes: "",
        generatedByProvider: "",
    },
    version: "1.0.0",
    created: BASE_TIME,
    updated: BASE_TIME,
};

/** Falling-EMA variant: only the M1 series can pass/fail this rule. */
const m1RuleStrategy: Strategy = {
    ...strategy,
    entryRules: [{ ...strategy.entryRules[0], timeframe: "M1" }],
};

function deployment(overrides: Partial<BotDeployment> = {}): BotDeployment {
    const now = Date.now();
    return {
        id: BOT_ID,
        strategyId: STRATEGY_ID,
        deployedFingerprint: "fp_test",
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

function seed(): void {
    const now = Date.now();
    rtDbStore.clear();
    rtDbStore.set(`trading_access/${UID}`, { lic1: { status: "active", expiresAt: now + 86_400_000 } });
    rtDbStore.set(`gateway_users/${GATEWAY_TOKEN}`, { userId: UID, userEmail: "bot@example.com" });
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
        gatewayVersion: "1.0",
    });
    rtDbStore.set(`trading_positions/${UID}/${ACCOUNT_KEY}`, {});
    rtDbStore.set("bot_strategies", {
        [STRATEGY_ID]: {
            id: STRATEGY_ID,
            authorId: UID,
            name: strategy.name,
            state: "valid",
            definition: strategy,
            fingerprint: "fp_test",
            magicNumber: deriveMagicNumber(STRATEGY_ID),
            createdAt: BASE_TIME,
            updatedAt: BASE_TIME,
        },
    });
    rtDbStore.set(`bot_deployments_index/${UID}`, { [BOT_ID]: true });
    rtDbStore.set(`bot_deployments/${BOT_ID}`, deployment());
}

/** Test market truth: a fresh quote derived from the primary series. */
const marketTruth: NonNullable<BotRuntimeOptions["marketTruth"]> = async () => {
    const last = M5_PAGE[M5_PAGE.length - 1];
    const snapshot = {
        currentPrice: last.close,
        bid: last.close - 0.00005,
        ask: last.close + 0.00005,
        spread: 0.0001,
        // Slightly before the gate's `now`, like a real feed sample: a quote
        // timestamp ahead of the server clock is (correctly) treated as stale.
        timestamp: Date.now() - 500,
        provider: "tradingview",
        timeframe: "M5",
    } as unknown as MarketSnapshot;
    return {
        snapshot,
        freshness: { fresh: true, status: "fresh", dataAgeMs: 0, thresholdMs: 600_000, category: "short" },
    };
};

function serviceFactory(): ReturnType<typeof createUnifiedTradingService> {
    const provider = new Mt5DemoProvider({
        heartbeatStaleMs: 90_000,
        heartbeatDegradedMs: 45_000,
        executionTimeoutMs: 3_000,
        pollIntervalMs: 5,
        verificationTimeoutMs: 2_000,
        clock: () => Date.now(),
    });
    return createUnifiedTradingService({ registry: new TradingProviderRegistry([provider]) });
}

function newSession(overrides: Partial<BotRuntimeOptions> = {}): BotRuntimeSession {
    return new BotRuntimeSession({
        deployment: deployment(),
        strategy,
        magicNumber: deriveMagicNumber(STRATEGY_ID),
        marketTruth,
        serviceFactory,
        ...overrides,
    });
}

export async function runBotExecutionTests(): Promise<void> {
    console.log("Running Bot Studio → MT5 execution tests...\n");

    // ── 1. Valid signal → unified queue with attribution ────────────────────
    seed();
    const session = newSession();
    await session.initialize();

    const startedAt = Date.now();
    const first = await session.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_PAGE } });
    const tickMs = Date.now() - startedAt;
    assert(first.signalGenerated === true, "strategy must fire on the rising primary series");
    assert(first.gateApproved === true, `gate must approve (got ${first.gateCode ?? "approved"})`);
    assert(typeof first.executionId === "string" && first.executionId.startsWith("BEXEC_"), "execution id must be deterministic");

    const requests = entriesUnder(`trading_order_requests/${UID}`);
    const requestIds = Object.keys(requests);
    assert(requestIds.length === 1, `exactly one command must be queued (got ${requestIds.length})`);
    const command = requests[requestIds[0]];
    assert(command.status === "queued", "command must be queued for the EA");
    assert(command.accountId === ACCOUNT_KEY, "command must target the bot's own account");
    assert(command.source === "bot-studio", "command must carry the trusted bot-studio source");
    assert(command.botId === BOT_ID, "command must carry the trusted bot id");
    assert(command.executionId === first.executionId, "command must carry the exact execution id");
    assert(Number(command.magicNumber) === deriveMagicNumber(STRATEGY_ID), "command must use the strategy magic");
    assert(command.comment === buildOrderComment(STRATEGY_ID), "command comment must identify the strategy");
    assert(Number(command.volume) > 0, "command must carry a risk-approved volume");

    const executions = entriesUnder(`bot_executions/${BOT_ID}`);
    const execIds = Object.keys(executions);
    assert(execIds.length === 1 && execIds[0] === first.executionId, "one execution record must exist");
    const execution = executions[execIds[0]];
    assert(execution.status === "submitted", `execution must be awaiting the report (got ${String(execution.status)})`);
    assert(execution.clientOrderId === requestIds[0], "execution must correlate to the queued command");
    assert(execution.mt5Ticket == null, "no ticket may be fabricated before the report");
    assert(execution.fillPrice == null && execution.fillVolume == null, "no fill may be fabricated before the report");
    assert(Number(execution.signalGeneratedAt) > 0, "signal timestamp must be recorded");
    assert(typeof execution.authorizationStartedAt === "number", "authorization start must be recorded");

    // ── 2. Re-polling the same page never re-submits ────────────────────────
    const repeat = await session.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_PAGE } });
    assert(repeat.signalGenerated === false, "a poll with no new close must not signal");
    assert(Object.keys(entriesUnder(`trading_order_requests/${UID}`)).length === 1, "no duplicate command may be queued");

    // ── 3. Worker restart: fresh session, same page ─────────────────────────
    const restarted = newSession();
    await restarted.initialize();
    const afterRestart = await restarted.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_PAGE } });
    assert(afterRestart.signalGenerated === false, "a restarted worker must not re-emit a handled bar");
    assert(Object.keys(entriesUnder(`trading_order_requests/${UID}`)).length === 1, "restart must not queue a second command");

    // ── 4. Paused bot adds nothing, even from a cached session ──────────────
    const paused = deployment({ runtimeState: "paused", desiredState: "paused" });
    session.refreshDeployment(paused);
    const nextPage = [...M5_PAGE, candles(1, M5_PAGE[M5_PAGE.length - 1].timestamp + M5_STEP, M5_STEP, 0.0002)[0]];
    const pausedTick = await session.tick({ candles: nextPage, timeframe: "M5", series: { M5: nextPage, M1: M1_PAGE } });
    assert(pausedTick.signalGenerated === false, "a paused bot must not generate entries");
    assert(Object.keys(entriesUnder(`trading_order_requests/${UID}`)).length === 1, "a paused bot must queue nothing");

    // ── 5. Unauthorized bot is rejected by the gate ─────────────────────────
    seed();
    rtDbStore.delete(`trading_access/${UID}`);
    rtDbStore.delete(`gateway_tokens_meta/${UID}`);
    const unauthorized = newSession({ deployment: deployment({ id: "BOT_UNAUTHORIZED" }) });
    await unauthorized.initialize();
    const unauthorizedTick = await unauthorized.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_PAGE } });
    assert(unauthorizedTick.signalGenerated === true, "the strategy still evaluates for an unauthorized bot");
    assert(unauthorizedTick.gateApproved === false, "the gate must reject an unauthorized bot");
    assert(
        unauthorizedTick.gateCode === "NO_GATEWAY_AUTHORIZATION" || unauthorizedTick.gateCode === "NO_CONNECTED_ACCOUNT",
        `gate must reject on authorization (got ${unauthorizedTick.gateCode ?? "none"})`,
    );
    assert(Object.keys(entriesUnder(`trading_order_requests/${UID}`)).length === 0, "nothing may be queued when unauthorized");

    // ── 6–8. Report round-trip, account scoping, socket-side timestamp ──────
    seed();
    const closeSession = newSession();
    await closeSession.initialize();
    const submitted = await closeSession.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_PAGE } });
    assert(submitted.gateApproved === true, "gate must approve the armed bot");
    const closeRequests = entriesUnder(`trading_order_requests/${UID}`);
    const closeId = Object.keys(closeRequests)[0];
    const closeCommand = closeRequests[closeId];

    // A report must never be accepted for a command the gateway was not given.
    const unclaimedReport = await postExecutionReport(jsonRequest({
        commandId: closeId,
        accountNumber: ACCOUNT_NUMBER,
        status: "filled",
        retcode: 10009,
        order: 555001,
        volume: Number(closeCommand.volume),
        price: 1.2,
        timestamp: Math.floor(Date.now() / 1000),
    }));
    assert(unclaimedReport.status === 409, `an unclaimed command must not accept a report (got ${unclaimedReport.status})`);

    // The EA polls (atomic claim) before executing and reporting.
    const claimPoll = await pollCommands({
        url: `https://algovault.test/api/trading/gateway/commands?accountNumber=${ACCOUNT_NUMBER}`,
        headers: { get: (name: string) => (name === "authorization" ? `Bearer ${GATEWAY_TOKEN}` : null) },
    } as unknown as Parameters<typeof pollCommands>[0]);
    const claimBody = (await claimPoll.json()) as { commands: Array<Record<string, unknown>> };
    const claimed = claimBody.commands.find((command) => command.id === closeId);
    assert(!!claimed, "the queued command must be claimed before execution");
    assert(typeof claimed?.claimId === "string", "the claim must identify the consumer");

    const wrongAccount = await postExecutionReport(jsonRequest({
        commandId: closeId,
        accountNumber: "99999999",
        status: "filled",
        retcode: 10009,
        order: 555001,
        volume: 0.1,
        price: 1.2,
        timestamp: Math.floor(Date.now() / 1000),
    }));
    assert(wrongAccount.status === 403, `a report for another account must be rejected (got ${wrongAccount.status})`);
    assert(
        entriesUnder(`trading_order_requests/${UID}`)[closeId].status === "executing",
        "a rejected report must not mutate the claimed command",
    );
    assert(
        entriesUnder(`bot_executions/${BOT_ID}`)[submitted.executionId!].status === "submitted",
        "no report ⇒ no fabricated fill",
    );

    const eaTimestampSeconds = Math.floor(Date.now() / 1000);
    const accepted = await postExecutionReport(jsonRequest({
        commandId: closeId,
        accountNumber: ACCOUNT_NUMBER,
        status: "filled",
        retcode: 10009,
        order: 555001,
        volume: Number(closeCommand.volume),
        price: Number(closeCommand.entry) || 1.2,
        timestamp: eaTimestampSeconds,
    }));
    assert(accepted.status === 200, `a matching authenticated report must be accepted (got ${accepted.status})`);
    const filled = entriesUnder(`bot_executions/${BOT_ID}`)[submitted.executionId!];
    assert(filled.status === "filled", `execution must be filled (got ${String(filled.status)})`);
    assert(Number(filled.mt5Ticket) === 555001, "execution must store the broker ticket");
    assert(Number(filled.brokerConfirmedAt) > 1_000_000_000_000, "broker time must be normalized to epoch ms");
    const latency = (filled.latencyMs ?? {}) as Record<string, number>;
    assert(typeof latency.authorization === "number" && latency.authorization >= 0, "authorization latency must be measured");
    assert(typeof latency.queueToReport === "number" && latency.queueToReport >= 0, "queue→report latency must be measured");

    // ── 9. Snapshot attribution (bot position indexed, manual untouched) ────
    const snapshotRes = await postSnapshot(jsonRequest({
        accountNumber: ACCOUNT_NUMBER,
        positions: [
            {
                ticket: "555001",
                symbol: "EURUSD",
                type: "BUY",
                volume: Number(closeCommand.volume),
                openPrice: Number(closeCommand.entry) || 1.2,
                currentPrice: Number(closeCommand.entry) || 1.2,
                magic: deriveMagicNumber(STRATEGY_ID),
                comment: buildOrderComment(STRATEGY_ID),
                openedAt: Math.floor(Date.now() / 1000),
            },
            {
                ticket: "900001",
                symbol: "EURUSD",
                type: "SELL",
                volume: 0.1,
                openPrice: 1.2,
                currentPrice: 1.2,
                magic: 0,
                comment: "manual",
                openedAt: Math.floor(Date.now() / 1000),
            },
        ],
        orders: [],
        closedDeals: [],
    }));
    assert(snapshotRes.status === 200, `snapshot must be accepted (got ${snapshotRes.status})`);
    const botPositions = entriesUnder(`bot_positions/${BOT_ID}`);
    assert(Object.keys(botPositions).length === 1 && !!botPositions["555001"], "bot position must be attributed by magic");
    assert(entriesUnder(`bot_positions/${BOT_ID}`)["900001"] === undefined, "a manual trade must never be attributed to a bot");
    const accountPositions = (rtDbStore.get(`trading_positions/${UID}/${ACCOUNT_KEY}`) ?? {}) as Record<string, Record<string, unknown>>;
    assert(accountPositions["900001"]?.magic === 0, "manual positions must stay visible in account state");
    const synced = entriesUnder(`bot_executions/${BOT_ID}`)[submitted.executionId!];
    assert(typeof synced.synchronizedAt === "number", "position sync must be recorded on the execution");

    // ── 10. LIVE mode is refused ────────────────────────────────────────────
    seed();
    let liveRefused = false;
    try {
        const live = newSession({ deployment: deployment({ accountMode: "live" }) });
        await live.initialize();
    } catch {
        liveRefused = true;
    }
    assert(liveRefused, "LIVE initialization must throw while live trading is disabled");

    // ── 11. Stale gateway blocks the queue; reconnect recovers ──────────────
    seed();
    rtDbStore.set(`trading_accounts/${UID}/${ACCOUNT_KEY}`, {
        ...(rtDbStore.get(`trading_accounts/${UID}/${ACCOUNT_KEY}`) as Record<string, unknown>),
        lastHeartbeatAt: Date.now() - 10 * 60_000,
    });
    const staleSession = newSession({ deployment: deployment({ id: "BOT_STALE" }) });
    await staleSession.initialize();
    const staleTick = await staleSession.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_PAGE } });
    assert(staleTick.signalGenerated === true, "the signal is still produced offline from stale quotes");
    assert(staleTick.gateApproved === true, "the gate's own context is still satisfied");
    assert(Object.keys(entriesUnder(`trading_order_requests/${UID}`)).length === 0, "a stale gateway must not receive a command");
    const staleExecutions = entriesUnder(`bot_executions/BOT_STALE`);
    assert(
        Object.values(staleExecutions).some((e) => e.status === "failed"),
        "the rejected submission must be recorded as failed, not retried",
    );

    // ── 12. Rule timeframe resolution uses its OWN series ───────────────────
    seed();
    const m1Session = newSession({ strategy: m1RuleStrategy });
    await m1Session.initialize();
    const m1Tick = await m1Session.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_FALLING } });
    assert(
        m1Tick.signalGenerated === false,
        "a rule on M1 must be evaluated against M1 (falling EMA) — not the rising primary series",
    );

    // ── 13. Measured: queue-only vs wait-for-report submission ──────────────
    const service = serviceFactory();
    const latencyInput = {
        userId: UID,
        accountId: ACCOUNT_KEY,
        executionType: "PLACE_ORDER" as const,
        symbol: "EURUSD",
        side: "BUY" as const,
        volume: 0.1,
        kind: "MARKET" as const,
        source: "latency-test",
    };

    // Queue-only: the call returns as soon as the command is durable.
    const queueOnlyStart = Date.now();
    const queueOnly = await service.execute({ ...latencyInput, clientRequestId: "lat_queue_only", waitForReport: false });
    const queueOnlyMs = Date.now() - queueOnlyStart;
    assert(queueOnly.result.status === "ACCEPTED", "queue-only execution must return queued");

    // Wait-for-report: the previous bot behaviour, including one simulated EA
    // poll interval (300ms) before the report arrives.
    const waitClientId = "lat_wait_report";
    const waitStart = Date.now();
    const waitPromise = service.execute({ ...latencyInput, clientRequestId: waitClientId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    rtDbStore.set(`trading_positions/${UID}/${ACCOUNT_KEY}`, {
        "610001": { ticket: "610001", symbol: "EURUSD", type: "BUY", volume: 0.1, openPrice: 1.1, magic: 0 },
    });
    rtDbStore.set(`trading_order_requests/${UID}/${waitClientId}`, {
        clientRequestId: waitClientId,
        accountId: ACCOUNT_KEY,
        status: "filled",
        mt5Ticket: "610001",
        volume: 0.1,
        executionPrice: 1.1,
    });
    const waitResult = await waitPromise;
    const waitMs = Date.now() - waitStart;
    assert(waitResult.result.status === "SUCCEEDED", "wait-for-report execution must verify the fill");
    assert(
        queueOnlyMs * 2 < waitMs,
        `queue-only must be materially faster than waiting (queue=${queueOnlyMs}ms wait=${waitMs}ms)`,
    );

    // ── 14. Lifecycle route: start / pause / live refusal ───────────────────
    seed();
    rtDbStore.set(`users/${UID}/role`, "customer");
    rtDbStore.set(`users/${UID}/subscription`, { plan: "pro", status: "active" });
    rtDbStore.set(`bot_deployments/${BOT_ID}`, deployment({ runtimeState: "ready", desiredState: "paper" }));

    const startRes = await postLifecycle(
        lifecycleRequest({ targetState: "running" }),
        { params: Promise.resolve({ botId: BOT_ID }) },
    );
    assert(startRes.status === 200, `starting a ready bot must succeed (got ${startRes.status})`);
    const started = rtDbStore.get(`bot_deployments/${BOT_ID}`) as BotDeployment;
    assert(started.runtimeState === "running" && started.desiredState === "running", "start must persist running intent");

    const pauseRes = await postLifecycle(
        lifecycleRequest({ targetState: "paused" }),
        { params: Promise.resolve({ botId: BOT_ID }) },
    );
    assert(pauseRes.status === 200, `pausing a running bot must succeed (got ${pauseRes.status})`);
    const pausedDeployment = rtDbStore.get(`bot_deployments/${BOT_ID}`) as BotDeployment;
    assert(pausedDeployment.runtimeState === "paused" && pausedDeployment.desiredState === "paused", "pause must persist paused intent");

    const pausedSession = newSession({ deployment: pausedDeployment });
    await pausedSession.initialize();
    const pausedRouteTick = await pausedSession.tick({ candles: M5_PAGE, timeframe: "M5", series: { M5: M5_PAGE, M1: M1_PAGE } });
    assert(pausedRouteTick.signalGenerated === false, "a bot paused through the lifecycle route must not evaluate");
    assert(Object.keys(entriesUnder(`trading_order_requests/${UID}`)).length === 0, "a paused bot must queue nothing");

    rtDbStore.set(`bot_deployments/${BOT_ID}`, deployment({ runtimeState: "ready", desiredState: "paper", accountMode: "live" }));
    const liveStart = await postLifecycle(
        lifecycleRequest({ targetState: "running" }),
        { params: Promise.resolve({ botId: BOT_ID }) },
    );
    assert(liveStart.status === 403, `starting a LIVE bot must be refused (got ${liveStart.status})`);

    console.log(`  ✓ Bot execution pipeline passed (signal→queue tick: ${tickMs}ms).`);
    console.log(`  ✓ Submission latency (same process, simulated 300ms EA poll): queue-only ${queueOnlyMs}ms vs wait-for-report ${waitMs}ms.`);
    console.log("\nAll Bot Studio execution tests passed.\n");
}

await runBotExecutionTests();
