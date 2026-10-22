/**
 * TERMINAL BOTS — route-level integration test.
 *
 * Run with:
 *     npm run test:terminal-bots-api
 *
 * The Terminal Bots panel is a projection of the Bot Studio routes. This suite
 * drives the REAL route handlers against the in-memory firebase-admin stub and
 * asserts the guarantees the panel depends on:
 *
 *   1. A Pro user only ever sees THEIR OWN deployments — and only their own
 *      deployments get a server-computed summary.
 *   2. The summary is recorded data, not invention: strategy name, symbol,
 *      timeframe, open positions, floating P/L, closed-trade performance and
 *      the last execution outcome.
 *   3. Eligibility is derived server-side, and each blocker reports its own
 *      reason (offline gateway, disabled live mode, changed strategy,
 *      deleted strategy).
 *   4. A peer's bot is invisible: detail and lifecycle answer 404, not 403 —
 *      the resource must not even be confirmed to exist.
 *   5. Pausing or stopping never closes open positions and never queues an
 *      order.
 *   6. A duplicate start changes nothing and submits nothing.
 *
 * No broker, no network, no credentials.
 */

import { GET as listDeployments } from "@/app/api/bot-studio/deployments/route";
import { GET as getDeploymentDetail } from "@/app/api/bot-studio/deployments/[botId]/route";
import { POST as postLifecycle } from "@/app/api/bot-studio/deployments/[botId]/lifecycle/route";
import { rtDbStore } from "./firebase-admin-stub";

/* ── harness ─────────────────────────────────────────────────────────────── */

let passed = 0;
const failures: string[] = [];

function section(title: string): void {
    console.log(`\n${title}`);
}

function check(condition: boolean, message: string): void {
    if (condition) {
        passed += 1;
        console.log(`  ✓ ${message}`);
    } else {
        failures.push(message);
        console.log(`  ✗ ${message}`);
    }
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

const UID = "proUser";
const PEER = "otherProUser";
const ADMIN = "superAdmin";
const BOT_ID = "BOT_MINE";
const PEER_BOT_ID = "BOT_THEIRS";
const LIVE_BOT_ID = "BOT_LIVE";
const STRATEGY_ID = "STRAT_MINE";
const ACCOUNT = "50123456";
const ACCOUNT_KEY = `gateway_${ACCOUNT}`;
const GATEWAY_TOKEN = "gw_token_proUser";

/** The terminal-facing summary shape the listing route returns. */
interface TerminalSummary {
    strategyName: string | null;
    symbol: string | null;
    timeframe: string | null;
    openPositions: number;
    floatingPnl: number;
    performance: {
        totalPnl: number;
        winRate: number;
        totalTrades: number;
        openTrades: number;
    } | null;
    lastExecutionAt: number | null;
    lastExecutionStatus: string | null;
    eligibility: { eligible: boolean; code: string; reason: string | null };
}

interface ListPayload {
    deployments: Array<{ id: string; ownerId: string }>;
    summaries: Record<string, TerminalSummary>;
}

/** Sign a fake token for the given uid (the stub decodes the middle segment). */
function signToken(uid: string): string {
    const payload = JSON.stringify({ sub: uid, role: uid === ADMIN ? "admin" : "customer" });
    return "fake-token-" + uid + "." + btoa(payload) + ".sig";
}

/** Minimal NextRequest-shaped object (routes only read the auth header/body). */
function request(uid: string | null, body?: unknown) {
    return {
        headers: {
            get: (name: string) =>
                name === "authorization" && uid ? "Bearer " + signToken(uid) : null,
        },
        json: async () => body ?? {},
    } as unknown as Parameters<typeof listDeployments>[0];
}

function lifecycleRequest(uid: string, targetState: string) {
    return request(uid, { targetState }) as unknown as Parameters<typeof postLifecycle>[0];
}

function detailContext(botId: string) {
    return { params: Promise.resolve({ botId }) };
}

interface SeedOptions {
    /** Skip the gateway heartbeat so the account counts as offline. */
    gatewayOffline?: boolean;
    /** Strategy fingerprint differs from the deployed one (drift). */
    driftedStrategy?: boolean;
    /** Do not seed the strategy record at all. */
    missingStrategy?: boolean;
}

function seedRtdb(options: SeedOptions = {}): void {
    rtDbStore.clear();
    const now = Date.now();

    // Users — the guards read `users/{uid}` as a subtree.
    rtDbStore.set(`users/${UID}/role`, "customer");
    rtDbStore.set(`users/${UID}/subscription`, { plan: "pro", status: "active" });
    rtDbStore.set(`users/${PEER}/role`, "customer");
    rtDbStore.set(`users/${PEER}/subscription`, { plan: "pro", status: "active" });
    rtDbStore.set(`users/${ADMIN}/role`, "admin");

    // The strategy the deployment runs.
    if (!options.missingStrategy) {
        rtDbStore.set(`bot_strategies/${STRATEGY_ID}`, {
            id: STRATEGY_ID,
            authorId: UID,
            name: "Gold Momentum",
            state: "valid",
            fingerprint: "fp_1",
            magicNumber: 4242,
            definition: {
                asset: "XAUUSD",
                timeframes: { macro: "H4", structure: "H1", setup: "M15", entry: "M5" },
            },
            createdAt: now,
            updatedAt: now,
        });
    }

    // Deployments — one per owner, plus a live one.
    rtDbStore.set(`bot_deployments/${BOT_ID}`, {
        id: BOT_ID,
        strategyId: STRATEGY_ID,
        deployedFingerprint: options.driftedStrategy ? "fp_old" : "fp_1",
        ownerId: UID,
        mt5Account: ACCOUNT,
        accountMode: "demo",
        runtimeState: "running",
        desiredState: "running",
        signalCount: 5,
        executionCount: 2,
        rejectionCount: 0,
        openPositions: ["TICKET_1"],
        createdAt: now - 10_000,
        updatedAt: now,
    });
    rtDbStore.set(`bot_deployments/${PEER_BOT_ID}`, {
        id: PEER_BOT_ID,
        strategyId: "STRAT_THEIRS",
        deployedFingerprint: "fp_peer",
        ownerId: PEER,
        mt5Account: "50199999",
        accountMode: "demo",
        runtimeState: "running",
        desiredState: "running",
        signalCount: 1,
        executionCount: 1,
        rejectionCount: 0,
        openPositions: [],
        createdAt: now - 10_000,
        updatedAt: now,
    });
    rtDbStore.set(`bot_deployments/${LIVE_BOT_ID}`, {
        id: LIVE_BOT_ID,
        strategyId: STRATEGY_ID,
        deployedFingerprint: "fp_1",
        ownerId: UID,
        mt5Account: ACCOUNT,
        accountMode: "live",
        runtimeState: "stopped",
        desiredState: "stopped",
        signalCount: 0,
        executionCount: 0,
        rejectionCount: 0,
        openPositions: [],
        createdAt: now - 10_000,
        updatedAt: now,
    });

    // Gateway identity + heartbeat for the owner.
    rtDbStore.set(`gateway_tokens_meta/${UID}`, { token: GATEWAY_TOKEN, createdAt: now });
    rtDbStore.set(`gateway_users/${GATEWAY_TOKEN}`, { userId: UID, createdAt: now });
    if (!options.gatewayOffline) {
        rtDbStore.set(`trading_accounts/${UID}/${ACCOUNT_KEY}`, {
            status: "connected",
            lastHeartbeatAt: now,
            balance: 1000,
            equity: 1012.5,
        });
    }

    // Open positions indexed from the account snapshot by magic number.
    rtDbStore.set(`bot_positions/${BOT_ID}/TICKET_1`, {
        ticket: "TICKET_1",
        symbol: "XAUUSD",
        type: "BUY",
        volume: 0.1,
        openPrice: 2000,
        currentPrice: 2010,
        profit: 12.5,
        swap: 0,
        magic: "4242",
        openedAt: now - 60_000,
    });

    // Closed trades.
    rtDbStore.set(`bot_trades/${BOT_ID}/TRADE_1`, {
        profit: 25,
        commission: -1,
        swap: 0,
        closedAt: now - 120_000,
        openedAt: now - 3_600_000,
    });
    rtDbStore.set(`bot_trades/${BOT_ID}/TRADE_2`, {
        profit: -5,
        commission: 0,
        swap: 0,
        closedAt: now - 60_000,
        openedAt: now - 7_200_000,
    });

    // Execution attempts — newest last so ordering is observable.
    rtDbStore.set(`bot_executions/${BOT_ID}/EXEC_OLD`, {
        id: "EXEC_OLD",
        botId: BOT_ID,
        status: "rejected_by_broker",
        symbol: "XAUUSD",
        direction: "BUY",
        createdAt: now - 300_000,
        updatedAt: now - 300_000,
    });
    rtDbStore.set(`bot_executions/${BOT_ID}/EXEC_NEW`, {
        id: "EXEC_NEW",
        botId: BOT_ID,
        status: "filled",
        symbol: "XAUUSD",
        direction: "BUY",
        mt5Ticket: "TICKET_1",
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
    });
}

/** How many execution records a bot has. */
function executionCount(botId: string): number {
    const raw = rtDbStore.get(`bot_executions/${botId}`);
    return raw && typeof raw === "object" ? Object.keys(raw as Record<string, unknown>).length : 0;
}

/** How many order requests the runtime queued for a user. */
function queuedOrders(userId: string): number {
    const raw = rtDbStore.get(`trading_order_requests/${userId}`);
    return raw && typeof raw === "object" ? Object.keys(raw as Record<string, unknown>).length : 0;
}

/* ── 1. listing is owner-scoped ──────────────────────────────────────────── */

async function testOwnerScopedListing(): Promise<void> {
    section("Terminal bots — a Pro user only sees their own bots");
    seedRtdb();

    const res = await listDeployments(request(UID));
    check(res.status === 200, `the owner's listing succeeds (got ${res.status})`);
    const body = (await res.json()) as ListPayload;

    const ids = body.deployments.map((d) => d.id).sort();
    check(
        ids.length === 2 && ids.includes(BOT_ID) && ids.includes(LIVE_BOT_ID),
        `the owner sees exactly their own two bots (saw ${JSON.stringify(ids)})`,
    );
    check(
        body.deployments.every((d) => d.ownerId === UID),
        "no foreign deployment leaks into the listing",
    );
    check(
        body.summaries[PEER_BOT_ID] === undefined,
        "a peer's bot never gets a summary in the owner's listing",
    );
    check(
        body.summaries[BOT_ID] !== undefined,
        "the owner's own bot does get a server-computed summary",
    );

    const peerRes = await listDeployments(request(PEER));
    const peerBody = (await peerRes.json()) as ListPayload;
    check(
        peerBody.deployments.length === 1 && peerBody.deployments[0].id === PEER_BOT_ID,
        "a peer Pro user sees only their own bot",
    );

    const adminRes = await listDeployments(request(ADMIN));
    const adminBody = (await adminRes.json()) as ListPayload;
    check(
        adminBody.deployments.length === 3,
        `an admin sees every deployment (saw ${adminBody.deployments.length})`,
    );
    check(
        Object.keys(adminBody.summaries).length === 0,
        "an admin gets no summary for somebody else's bot — eligibility depends on that owner's gateway",
    );
}

/* ── 2. the summary is real recorded data ────────────────────────────────── */

async function testSummaryAccuracy(): Promise<void> {
    section("Terminal bots — the summary mirrors the recorded data");
    seedRtdb();

    const res = await listDeployments(request(UID));
    const body = (await res.json()) as ListPayload;
    const summary = body.summaries[BOT_ID];

    check(summary.strategyName === "Gold Momentum", "the strategy name comes from the strategy record");
    check(summary.symbol === "XAUUSD", "the symbol comes from the strategy definition");
    check(summary.timeframe === "M15", "the timeframe comes from the strategy hierarchy");
    check(summary.openPositions === 1, "the open position count comes from the indexed positions");
    check(summary.floatingPnl === 12.5, "floating P/L is the sum of the open positions");
    check(summary.performance !== null, "performance is present when trades were recorded");
    check(summary.performance?.totalTrades === 2, "closed trades are counted");
    check(summary.performance?.winRate === 50, "the win rate is computed from the closed trades");
    check(
        summary.performance?.totalPnl === 31.5,
        `total P/L is realised + floating (got ${summary.performance?.totalPnl})`,
    );
    check(summary.performance?.openTrades === 1, "open trades mirror the open positions");
    check(summary.lastExecutionStatus === "filled", "the newest execution outcome is the last one recorded");
    check(
        typeof summary.lastExecutionAt === "number",
        "the last execution carries the timestamp the panel ages against",
    );
}

/* ── 3. eligibility is derived server-side ──────────────────────────────── */

async function testEligibility(): Promise<void> {
    section("Terminal bots — a start is only offered when it can actually execute");

    seedRtdb({ gatewayOffline: true });
    let res = await listDeployments(request(UID));
    let body = (await res.json()) as ListPayload;
    check(
        body.summaries[BOT_ID].eligibility.code === "gateway_offline",
        `an offline gateway blocks the start (got ${body.summaries[BOT_ID].eligibility.code})`,
    );
    check(
        body.summaries[BOT_ID].eligibility.eligible === false &&
            body.summaries[BOT_ID].eligibility.reason !== null,
        "the blocked start explains itself",
    );

    seedRtdb();
    res = await listDeployments(request(UID));
    body = (await res.json()) as ListPayload;
    check(
        body.summaries[BOT_ID].eligibility.code === "eligible" &&
            body.summaries[BOT_ID].eligibility.eligible === true,
        "a connected gateway with a matching strategy is eligible",
    );
    check(
        body.summaries[LIVE_BOT_ID].eligibility.code === "live_disabled",
        "a live deployment is blocked while live trading is disabled",
    );

    seedRtdb({ driftedStrategy: true });
    res = await listDeployments(request(UID));
    body = (await res.json()) as ListPayload;
    check(
        body.summaries[BOT_ID].eligibility.code === "strategy_changed",
        "a strategy edited since deployment must be re-deployed before it can trade",
    );

    seedRtdb({ missingStrategy: true });
    res = await listDeployments(request(UID));
    body = (await res.json()) as ListPayload;
    check(
        body.summaries[BOT_ID].eligibility.code === "no_strategy",
        "a bot whose strategy is gone cannot be started",
    );
}

/* ── 4. a peer's bot is invisible ────────────────────────────────────────── */

async function testPeerInvisibility(): Promise<void> {
    section("Terminal bots — a peer's bot does not exist as far as the owner is concerned");
    seedRtdb();

    const detailRes = await getDeploymentDetail(request(UID), detailContext(PEER_BOT_ID));
    check(detailRes.status === 404, `reading a peer's bot is 404, not 403 (got ${detailRes.status})`);

    const lifecycleRes = await postLifecycle(
        lifecycleRequest(UID, "paused"),
        detailContext(PEER_BOT_ID)
    );
    check(lifecycleRes.status === 404, `pausing a peer's bot is 404 (got ${lifecycleRes.status})`);

    const peer = rtDbStore.get(`bot_deployments/${PEER_BOT_ID}`) as { runtimeState: string };
    check(peer.runtimeState === "running", "the peer's bot is untouched by the attempt");
}

/* ── 5. lifecycle: pause and stop never close positions ─────────────────── */

async function testLifecycle(): Promise<void> {
    section("Terminal bots — pausing and stopping halt entries, they do not close positions");
    seedRtdb();

    const pauseRes = await postLifecycle(lifecycleRequest(UID, "paused"), detailContext(BOT_ID));
    check(pauseRes.status === 200, `pausing a running bot succeeds (got ${pauseRes.status})`);
    const paused = rtDbStore.get(`bot_deployments/${BOT_ID}`) as {
        runtimeState: string;
        desiredState: string;
    };
    check(paused.runtimeState === "paused" && paused.desiredState === "paused", "the pause intent is persisted");

    const position = rtDbStore.get(`bot_positions/${BOT_ID}/TICKET_1`) as { ticket: string };
    check(position !== undefined && position.ticket === "TICKET_1", "pausing leaves the open position open");
    check(queuedOrders(UID) === 0, "pausing queues no order");

    const stopRes = await postLifecycle(lifecycleRequest(UID, "stopped"), detailContext(BOT_ID));
    check(stopRes.status === 200, `stopping a paused bot succeeds (got ${stopRes.status})`);
    const stopped = rtDbStore.get(`bot_deployments/${BOT_ID}`) as {
        runtimeState: string;
        desiredState: string;
    };
    check(stopped.runtimeState === "stopped" && stopped.desiredState === "stopped", "the stop intent is persisted");
    check(
        rtDbStore.get(`bot_positions/${BOT_ID}/TICKET_1`) !== undefined,
        "stopping leaves the open position open — the account still manages it",
    );
    check(queuedOrders(UID) === 0, "stopping queues no order");

    const startRes = await postLifecycle(lifecycleRequest(UID, "running"), detailContext(BOT_ID));
    check(startRes.status === 200, `restarting a stopped bot succeeds (got ${startRes.status})`);
    const restarted = rtDbStore.get(`bot_deployments/${BOT_ID}`) as {
        runtimeState: string;
        desiredState: string;
        startedAt?: number;
    };
    check(
        restarted.runtimeState === "running" && restarted.desiredState === "running",
        "the start intent is persisted",
    );
    check(typeof restarted.startedAt === "number", "the start is timestamped");

    const invalidRes = await postLifecycle(lifecycleRequest(UID, "ready"), detailContext(BOT_ID));
    check(invalidRes.status === 400, `an unreachable target state is refused (got ${invalidRes.status})`);
    const afterInvalid = rtDbStore.get(`bot_deployments/${BOT_ID}`) as { runtimeState: string };
    check(afterInvalid.runtimeState === "running", "a refused transition leaves the state untouched");

    const liveRes = await postLifecycle(lifecycleRequest(UID, "running"), detailContext(LIVE_BOT_ID));
    check(liveRes.status === 403, `starting a LIVE bot is refused (got ${liveRes.status})`);
    const live = rtDbStore.get(`bot_deployments/${LIVE_BOT_ID}`) as { runtimeState: string };
    check(live.runtimeState === "stopped", "the refused live bot stays stopped");
}

/* ── 6. a duplicate start submits nothing ────────────────────────────────── */

async function testDuplicateStart(): Promise<void> {
    section("Terminal bots — a duplicate start is idempotent");
    seedRtdb();

    const before = executionCount(BOT_ID);
    const res = await postLifecycle(lifecycleRequest(UID, "running"), detailContext(BOT_ID));
    check(res.status === 200, `a duplicate start on a running bot is accepted as a no-op (got ${res.status})`);

    const after = rtDbStore.get(`bot_deployments/${BOT_ID}`) as { runtimeState: string };
    check(after.runtimeState === "running", "the state is unchanged by the duplicate start");
    check(executionCount(BOT_ID) === before, "the duplicate start creates no execution record");
    check(queuedOrders(UID) === 0, "the duplicate start queues no order");
}

/* ── 7. the detail route answers with recorded positions/executions ───────── */

async function testDetailRoute(): Promise<void> {
    section("Terminal bots — the detail route returns the recorded positions and executions");
    seedRtdb();

    const res = await getDeploymentDetail(request(UID), detailContext(BOT_ID));
    check(res.status === 200, `the owner can read their own bot (got ${res.status})`);
    const body = (await res.json()) as {
        ok: boolean;
        deployment: { id: string };
        positions: Array<{ ticket: string; profit: number; type: string }>;
        executions: Array<{ id: string; status: string }>;
    };

    check(body.ok === true && body.deployment.id === BOT_ID, "the detail payload carries the deployment");
    check(body.positions.length === 1, "the open position is returned");
    check(body.positions[0].ticket === "TICKET_1", "the position is the one the gateway indexed");
    check(body.positions[0].profit === 12.5, "the position carries its live profit");
    check(body.positions[0].type === "BUY", "the position side is normalised");
    check(body.executions.length === 2, "both execution attempts are returned");
    check(
        body.executions[0].id === "EXEC_NEW" && body.executions[0].status === "filled",
        "executions are newest first",
    );

    const missingRes = await getDeploymentDetail(request(UID), detailContext("BOT_DOES_NOT_EXIST"));
    check(missingRes.status === 404, `an unknown bot is 404 (got ${missingRes.status})`);
}

/* ── run ─────────────────────────────────────────────────────────────────── */

export async function runTerminalBotsTests(): Promise<void> {
    console.log("Running Terminal bots route tests...\n");
    await testOwnerScopedListing();
    await testSummaryAccuracy();
    await testEligibility();
    await testPeerInvisibility();
    await testLifecycle();
    await testDuplicateStart();
    await testDetailRoute();

    console.log(`\n${"─".repeat(50)}`);
    console.log(`terminal bots api tests: ${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
        for (const f of failures) console.log(`  ✗ ${f}`);
        process.exit(1);
    }
    console.log("ALL TERMINAL BOTS API TESTS PASSED");
}

await runTerminalBotsTests();
