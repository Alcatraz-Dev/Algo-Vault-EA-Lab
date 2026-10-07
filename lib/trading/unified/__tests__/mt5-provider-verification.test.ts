/**
 * Provider-level verification-polling tests for the REAL `Mt5DemoProvider`.
 *
 * The service-level suite (`unified-trading.test.ts`) proves the pipeline with
 * a stub adapter. These tests go one layer deeper and exercise the actual
 * `execute()` → `awaitExecutionReport()` → `verifyInSyncedState()` path of the
 * production adapter, driven by:
 *
 *   • a controlled in-memory fake of the RTDB admin database (`ref().get()/
 *     .set()`) with per-path read counters — no Firebase account, and reads
 *     prove that verification POLLS instead of checking once;
 *   • a virtual clock whose injected `sleep` advances time instead of waiting,
 *     so no arbitrary wall-clock sleeps exist in this suite.
 *
 * The invariant under test: a provider-confirmed execution must NEVER be
 * classified as FAILED merely because the `trading_positions` mirror is
 * temporarily behind — and, symmetrically, a provider that never confirmed
 * must never be reported as SUCCEEDED.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import {
    Mt5DemoProvider,
    mt5DemoConfigFromEnv,
    type Mt5DemoProviderConfig,
} from "@/lib/trading/unified/mt5-demo-provider";
import { TradingProviderRegistry, type AdapterExecutionInput, type TradingResult } from "@/lib/trading/unified/adapter";
import { UnifiedTradingService, type ExecuteInput, type UnifiedExecutionOutcome } from "@/lib/trading/unified/service";
import type { TradingAccount, TradingExecutionRequest, TradingExecutionResult, TradingHistory } from "@/lib/trading/unified/domain";
import { createFakeStore } from "./fakes";

const T0 = 1_700_000_000_000;
const USER = "user-verify";
const ACCOUNT_ID = "gateway_777001";
const OTHER_ACCOUNT_ID = "gateway_999002";
const TICKET = "123456";
const OTHER_USER = "user-other";

// ─── Controlled fake RTDB admin database ─────────────────────────────────────

interface FakeSnapshot {
    exists(): boolean;
    val(): unknown;
}

/**
 * In-memory stand-in for the Firebase RTDB admin database.
 *
 * Implements exactly the surface `Mt5DemoProvider` consumes
 * (`ref(path).get()` / `ref(path).set()`), counts reads per path so a test can
 * prove polling happened, and exposes read/write hooks so a test can make the
 * position snapshot deterministically "arrive later" — the real-world race
 * between the EA's immediate execution report and its 30s snapshot cadence.
 */
function createFakeRtdb() {
    const data = new Map<string, unknown>();
    const reads = new Map<string, number>();
    const writes = new Map<string, number>();
    const readHooks = new Map<string, (readCount: number) => void>();
    const writeHooks = new Map<string, (value: unknown) => void>();

    const bump = (counts: Map<string, number>, key: string): number => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
    };

    return {
        ref(refPath: string) {
            return {
                async get(): Promise<FakeSnapshot> {
                    // Capture BEFORE the hook: a read hook may seed data that
                    // only the NEXT read observes (the delayed-snapshot race).
                    const captured = data.get(refPath) ?? null;
                    const readCount = bump(reads, refPath);
                    readHooks.get(refPath)?.(readCount);
                    return {
                        exists: () => captured !== null && captured !== undefined,
                        val: () => captured,
                    };
                },
                async set(value: unknown): Promise<unknown> {
                    data.set(refPath, value);
                    bump(writes, refPath);
                    writeHooks.get(refPath)?.(value);
                    return undefined;
                },
            };
        },
        seed(seedPath: string, value: unknown): void {
            data.set(seedPath, value);
        },
        onRead(readPath: string, hook: (readCount: number) => void): void {
            readHooks.set(readPath, hook);
        },
        onWrite(writePath: string, hook: (value: unknown) => void): void {
            writeHooks.set(writePath, hook);
        },
        readCount(countPath: string): number {
            return reads.get(countPath) ?? 0;
        },
        writeCount(writePath: string): number {
            return writes.get(writePath) ?? 0;
        },
    };
}

type FakeRtdb = ReturnType<typeof createFakeRtdb>;

// ─── Virtual clock (deterministic polling, no wall-clock sleeps) ─────────────

function createVirtualClock(startMs: number) {
    let now = startMs;
    return {
        now: () => now,
        sleep: async (ms: number): Promise<void> => {
            now += ms;
            await Promise.resolve();
        },
    };
}

type VirtualClock = ReturnType<typeof createVirtualClock>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const accountPath = (accountId: string = ACCOUNT_ID) => `trading_accounts/${USER}/${accountId}`;
const positionsPath = (accountId: string = ACCOUNT_ID) => `trading_positions/${USER}/${accountId}`;
const ordersPath = (accountId: string = ACCOUNT_ID) => `trading_orders/${USER}/${accountId}`;
const requestPath = (clientRequestId: string) => `trading_order_requests/${USER}/${clientRequestId}`;

function testConfig(clock: VirtualClock, overrides: Partial<Mt5DemoProviderConfig> = {}): Mt5DemoProviderConfig {
    return {
        heartbeatStaleMs: 90_000,
        heartbeatDegradedMs: 45_000,
        // Tiny but VIRTUAL: the injected sleep advances the clock, so these
        // values never cost wall-clock time while still exercising the real
        // deadline arithmetic of awaitExecutionReport()/verifyInSyncedState().
        executionTimeoutMs: 3_000,
        pollIntervalMs: 500,
        verificationTimeoutMs: 3_000,
        clock: clock.now,
        sleep: clock.sleep,
        ...overrides,
    };
}

/** Raw `trading_accounts/{uid}/{accountId}` record as the EA writes it. */
function seedGatewayAccount(db: FakeRtdb, clock: VirtualClock): void {
    db.seed(accountPath(), {
        environment: "DEMO",
        demo: true,
        mt5Account: "777001",
        broker: "DemoBroker",
        server: "DemoBroker-Demo",
        currency: "USD",
        leverage: 100,
        balance: 10_000,
        equity: 10_000,
        lastHeartbeatAt: clock.now(),
    });
}

/** Provider-neutral account snapshot carried on `AdapterExecutionInput`. */
function domainAccount(): TradingAccount {
    return {
        id: ACCOUNT_ID,
        userId: USER,
        provider: "MT5",
        environment: "DEMO",
        externalAccountId: "777001",
        brokerName: "DemoBroker",
        serverName: "DemoBroker-Demo",
        currency: "USD",
        leverage: 100,
        connection: "CONNECTED",
        providerStatus: "ONLINE",
        metrics: {
            balance: 10_000,
            equity: 10_000,
            margin: 0,
            freeMargin: 10_000,
            marginLevel: null,
            floatingPnl: 0,
            positionsCount: 0,
            ordersCount: 0,
            currency: "USD",
            updatedAt: T0,
        },
        connectedAt: T0,
        lastHeartbeatAt: T0,
        lastSyncAt: T0,
        connectionError: null,
        gatewayVersion: "1.3.0",
    };
}

function executionInput(
    overrides: Partial<TradingExecutionRequest> = {},
    volume: number = 0.01
): AdapterExecutionInput {
    const request: TradingExecutionRequest = {
        clientRequestId: "req-verify-0001",
        correlationId: "corr-verify-0001",
        userId: USER,
        accountId: ACCOUNT_ID,
        provider: "MT5",
        environment: "DEMO",
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume,
        kind: "MARKET",
        price: null,
        stopLoss: null,
        takeProfit: null,
        source: "test",
        timestamp: T0,
        ...overrides,
    };
    return { request, account: domainAccount(), volume };
}

/** One entry of `trading_positions/{uid}/{accountId}` as the EA snapshot writes it. */
function positionEntry(overrides: { ticket?: string; symbol?: string; volume?: number } = {}): Record<string, unknown> {
    const ticket = overrides.ticket ?? TICKET;
    return {
        [ticket]: {
            ticket: Number(ticket),
            symbol: overrides.symbol ?? "EURUSD",
            type: "BUY",
            volume: overrides.volume ?? 0.01,
            openPrice: 1.165,
            currentPrice: 1.165,
            openedAt: T0,
            magic: 42,
            comment: "unified",
        },
    };
}

interface EaReportSpec {
    ticket?: string;
    volume?: number;
    executionPrice?: number;
}

/**
 * Simulates the EA's answer on `/api/trading/gateway/execution`: the moment
 * the adapter enqueues the command, the EA reports the fill (ticket, volume,
 * price). Pass `false` to simulate a transport failure where the report never
 * arrives.
 */
function installEaReport(db: FakeRtdb, input: AdapterExecutionInput, spec: EaReportSpec = {}): void {
    const target = requestPath(input.request.clientRequestId);
    db.onWrite(target, (value) => {
        const command = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        db.seed(target, {
            ...command,
            status: "filled",
            mt5Ticket: Number(spec.ticket ?? TICKET),
            volume: spec.volume ?? input.volume ?? 0.01,
            executionPrice: spec.executionPrice ?? 1.165,
            executedAt: T0,
            errorMessage: null,
        });
    });
}

/**
 * `Mt5DemoProvider` with a deterministic execution counter.
 *
 * Execution-safety tests assert on this instead of HTTP responses: every
 * `execute()` call = one enqueued MT5 command = one provider execution.
 * No production behavior is changed — only the count is observed.
 */
class CountingMt5DemoProvider extends Mt5DemoProvider {
    executeCount = 0;

    async execute(input: AdapterExecutionInput): Promise<TradingResult<TradingExecutionResult>> {
        this.executeCount += 1;
        return super.execute(input);
    }
}

interface Scenario {
    db: FakeRtdb;
    clock: VirtualClock;
    provider: Mt5DemoProvider;
    input: AdapterExecutionInput;
}

interface ScenarioOptions {
    /** `false` = the EA execution report never arrives (transport failure). */
    eaReport?: false | EaReportSpec;
    verificationTimeoutMs?: number;
    input?: AdapterExecutionInput;
}

function scenario(options: ScenarioOptions = {}): Scenario {
    const clock = createVirtualClock(T0);
    const db = createFakeRtdb();
    seedGatewayAccount(db, clock);
    const input = options.input ?? executionInput();
    if (options.eaReport !== false) installEaReport(db, input, options.eaReport ?? {});
    const provider = new Mt5DemoProvider(
        testConfig(
            clock,
            options.verificationTimeoutMs !== undefined
                ? { verificationTimeoutMs: options.verificationTimeoutMs }
                : {}
        ),
        db
    );
    return { db, clock, provider, input };
}

/** Narrows a provider envelope; `null` makes every downstream check fail loudly. */
function valueOf(result: TradingResult<TradingExecutionResult>): TradingExecutionResult | null {
    return result.ok ? result.value : null;
}

// ─── Late-report reconciliation fixtures ─────────────────────────────────────────

interface GatewayReportPayload {
    status?: string;
    mt5Ticket?: string | number;
    executionPrice?: number;
    volume?: number;
    symbol?: string;
    errorCode?: number;
    errorMessage?: string | null;
    /**
     * `body.accountId` as the gateway route reads it. Used ONLY for the
     * per-account Execution-Log fallback — never written onto the command
     * record, exactly like the production route.
     */
    accountId?: string;
}

/**
 * Writes a command node AND the parent listing `getHistory()` reads. The fake
 * RTDB is a flat path map, while a real RTDB parent read sees its children —
 * this keeps the simulation faithful to production tree semantics.
 */
async function putRequestRecord(
    db: FakeRtdb,
    userId: string,
    clientRequestId: string,
    record: Record<string, unknown>
): Promise<void> {
    db.seed(`trading_order_requests/${userId}/${clientRequestId}`, record);
    const parentPath = `trading_order_requests/${userId}`;
    const parentSnap = await db.ref(parentPath).get();
    const siblings = (parentSnap.val() ?? null) as Record<string, unknown> | null;
    db.seed(parentPath, { ...(siblings ?? {}), [clientRequestId]: record });
}

/**
 * Mirrors ONE `POST /api/trading/gateway/execution` delivery (the T4 late
 * report): the route reads the originating command node and `.update()`s ONLY
 * the report fields — `accountId`/`action` stay whatever the enqueue wrote and
 * are NEVER created when the command never existed, so report identity can
 * never be re-bound. Also writes the two execution-log nodes the route
 * writes. `trading_positions` is never touched: reconciliation is
 * observational by construction.
 */
async function deliverGatewayReport(
    db: FakeRtdb,
    clock: VirtualClock,
    userId: string,
    clientRequestId: string,
    payload: GatewayReportPayload = {}
): Promise<void> {
    const childPath = `trading_order_requests/${userId}/${clientRequestId}`;
    const childSnap = await db.ref(childPath).get();
    const existing = (childSnap.val() ?? null) as Record<string, unknown> | null;
    const now = clock.now();
    const status = payload.status ?? "filled";
    const merged: Record<string, unknown> = {
        ...(existing ?? {}),
        status,
        mt5Ticket: String(payload.mt5Ticket ?? ""),
        executionPrice: Number(payload.executionPrice ?? 0),
        volume: Number(payload.volume ?? 0),
        symbol: String(payload.symbol ?? ""),
        errorCode: Number(payload.errorCode ?? 0),
        errorMessage: String(payload.errorMessage ?? ""),
        executedAt: now,
        updatedAt: now,
    };
    await putRequestRecord(db, userId, clientRequestId, merged);

    const logEntry = {
        clientOrderId: clientRequestId,
        mt5Ticket: merged.mt5Ticket,
        status,
        executionPrice: merged.executionPrice,
        volume: merged.volume,
        symbol: merged.symbol,
        errorCode: merged.errorCode,
        errorMessage: merged.errorMessage,
        executedAt: now,
        createdAt: now,
    };
    await db.ref(`trading_execution_logs/${userId}/${clientRequestId}`).set(logEntry);
    // The route's account comes from the STORED command first; body.accountId
    // is only a fallback for an account-less record.
    const orderAccountId =
        String(merged.accountId ?? "").trim() || String(payload.accountId ?? "").trim();
    if (orderAccountId) {
        await db.ref(`trading_logs/${userId}/${orderAccountId}/${clientRequestId}`).set({
            ...logEntry,
            accountId: orderAccountId,
        });
    }
}

interface ReconciliationScenario {
    db: FakeRtdb;
    clock: VirtualClock;
    provider: CountingMt5DemoProvider;
    store: ReturnType<typeof createFakeStore>;
    service: UnifiedTradingService;
    input: ExecuteInput;
    requestPath: string;
    /** The T3 settlement: FAILED / EXECUTION_TIMEOUT / HTTP 504. */
    first: UnifiedExecutionOutcome;
}

/**
 * Full-stack T0–T3: the REAL `Mt5DemoProvider` behind the REAL
 * `UnifiedTradingService` on a fresh fake RTDB + virtual clock, with NO EA
 * report inside the waiting window — every reconciliation scenario starts
 * from the deterministic frozen timeout: FAILED / EXECUTION_TIMEOUT / 504,
 * exactly one provider execution, exactly one enqueued MT5 command. The
 * queued command is mirrored into the parent listing so `getHistory()` sees
 * what a real RTDB parent read would see.
 */
async function reconScenario(): Promise<ReconciliationScenario> {
    const clock = createVirtualClock(T0);
    const db = createFakeRtdb();
    seedGatewayAccount(db, clock);
    const provider = new CountingMt5DemoProvider(
        testConfig(clock, { executionTimeoutMs: 3_000 }),
        db
    );
    const store = createFakeStore();
    const service = new UnifiedTradingService({
        registry: new TradingProviderRegistry([provider]),
        idempotency: store.idempotency,
        persistResult: store.persistResult,
        persistAccount: store.persistAccount,
        audit: store.audit,
        entitlement: async () => true,
        now: clock.now,
    });
    const input: ExecuteInput = {
        userId: USER,
        accountId: ACCOUNT_ID,
        clientRequestId: "req-recon-0001",
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.01,
        source: "test",
    };
    const first = await service.execute({ ...input });
    const requestPath = `trading_order_requests/${input.userId}/${input.clientRequestId}`;
    const child = (await db.ref(requestPath).get()).val();
    if (child) {
        await putRequestRecord(db, input.userId, input.clientRequestId, child as Record<string, unknown>);
    }
    return { db, clock, provider, store, service, input, requestPath, first };
}

/**
 * Typed read of the service-level history pass-through.
 * `UnifiedTradingService.getHistory` has no explicit return type, so its
 * inferred union carries `unknown` from the `fail()` branches — this narrows
 * once, centrally, to the `TradingResult<TradingHistory>` the adapter
 * contract guarantees. A test-side typing adapter only; it never changes a
 * value.
 */
async function historyOf(
    service: UnifiedTradingService,
    userId: string,
    accountId: string
): Promise<TradingResult<TradingHistory>> {
    const result = await service.getHistory(userId, accountId);
    if (!result.ok) return result;
    return { ok: true, value: result.value as TradingHistory };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

export async function runMt5ProviderVerificationTests(): Promise<boolean> {
    const s = createSuite("mt5-provider-verification");

    s.section("Delayed snapshot (T0 report → T1 miss → T2 hit): polling, not single-shot");
    const delayed = scenario();
    const pPath = positionsPath();
    // T0: the EA confirms ticket 123456 / 0.01 / 1.16500 (via the report hook),
    // but trading_positions does not contain the position yet.
    // T1: the FIRST verification read misses; the hook then lets the snapshot
    // land so the NEXT read observes it.
    delayed.db.onRead(pPath, (readCount) => {
        if (readCount === 1) delayed.db.seed(pPath, positionEntry());
    });
    const delayedOutcome = await delayed.provider.execute(delayed.input);
    const delayedResult = valueOf(delayedOutcome);
    s.check(delayedOutcome.ok, "the provider returns an execution envelope");
    s.check(delayedResult?.status === "SUCCEEDED", "a provider-confirmed fill whose snapshot arrives on the next poll is SUCCEEDED");
    s.check(delayedResult?.status !== "FAILED", "a delayed mirror is NEVER classified as FAILED");
    s.check(delayedResult?.providerRef === TICKET, "the verified provider reference is the reported ticket 123456");
    s.check(
        delayedResult?.position?.symbol === "EURUSD" && delayedResult?.position?.volume === 0.01,
        "the verified position carries the executed symbol and volume (EURUSD 0.01)"
    );
    s.check(delayed.db.readCount(pPath) >= 2, `verifyInSyncedState polled the mirror (reads=${delayed.db.readCount(pPath)} >= 2)`);
    s.check(delayed.db.readCount(pPath) === 2, "exactly two reads: one miss, one hit — polling stops as soon as the mirror syncs");
    s.check(delayed.db.readCount(ordersPath()) === delayed.db.readCount(pPath), "orders are checked alongside positions on every attempt");

    s.section("Immediate sync: the position is already visible");
    const immediate = scenario();
    immediate.db.seed(pPath, positionEntry());
    const immediateOutcome = await immediate.provider.execute(immediate.input);
    const immediateResult = valueOf(immediateOutcome);
    s.check(immediateOutcome.ok && immediateResult?.status === "SUCCEEDED", "a position already present on the first verification attempt succeeds");
    s.check(immediate.db.readCount(pPath) === 1, "no unnecessary polling when synchronization is already available (reads = 1)");
    s.check(immediate.clock.now() === T0, "the verification window is not consumed when sync is immediate");

    s.section("Verification timeout: the position NEVER appears");
    // UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS overridden to a tiny TEST value;
    // the production default (12000) is asserted separately below and is not
    // reduced anywhere.
    const timeout = scenario({ verificationTimeoutMs: 3_000 });
    const timeoutOutcome = await timeout.provider.execute(timeout.input);
    const timeoutResult = valueOf(timeoutOutcome);
    s.check(timeoutOutcome.ok && timeoutResult?.status === "EXECUTED_PENDING_SYNC", "a provider-confirmed fill that never syncs times out as EXECUTED_PENDING_SYNC");
    s.check(timeoutResult?.status !== "FAILED", "verification timeout on a confirmed execution is NOT FAILED");
    s.check(timeoutResult?.status !== "SUCCEEDED" && timeoutResult?.position === null, "a genuinely unverified sync is never converted into a fake success");
    s.check(timeoutResult?.error?.code === "EXECUTION_TIMEOUT", "the timeout is surfaced as EXECUTION_TIMEOUT with a sync explanation");
    s.check(
        timeoutResult?.providerRef === TICKET && timeoutResult?.filledVolume === 0.01 && timeoutResult?.filledPrice === 1.165,
        "observability: ticket, filled volume and filled price survive the timeout"
    );
    s.check(
        typeof timeoutResult?.createdAt === "number" && typeof timeoutResult?.completedAt === "number" && timeoutResult?.accountId === ACCOUNT_ID,
        "observability: account and timestamps are retained for debugging"
    );
    s.check(timeout.db.readCount(pPath) >= 2, `the loop polled repeatedly until the deadline (reads=${timeout.db.readCount(pPath)} >= 2)`);

    s.section("Wrong ticket: an unrelated position never satisfies verification");
    const wrongTicket = scenario();
    wrongTicket.db.seed(pPath, positionEntry({ ticket: "999999" }));
    const wrongTicketOutcome = await wrongTicket.provider.execute(wrongTicket.input);
    const wrongTicketResult = valueOf(wrongTicketOutcome);
    s.check(wrongTicketOutcome.ok && wrongTicketResult?.status === "EXECUTED_PENDING_SYNC", "ticket 999999 never verifies ticket 123456 — polling continues until timeout");
    s.check(wrongTicketResult?.position === null && wrongTicketResult?.providerRef === TICKET, "the unrelated position is never returned as the executed trade");
    s.check(wrongTicket.db.readCount(pPath) >= 2, "verification kept polling instead of accepting the first unrelated position");

    s.section("Wrong account: verification is scoped to the target trading account");
    const wrongAccount = scenario();
    // The SAME ticket exists — but under a different account id.
    wrongAccount.db.seed(positionsPath(OTHER_ACCOUNT_ID), positionEntry());
    const wrongAccountOutcome = await wrongAccount.provider.execute(wrongAccount.input);
    const wrongAccountResult = valueOf(wrongAccountOutcome);
    s.check(wrongAccountOutcome.ok && wrongAccountResult?.status === "EXECUTED_PENDING_SYNC", "a matching ticket under another account does not verify");
    s.check(wrongAccountResult?.position === null, "the cross-account position is not accepted as the executed trade");
    s.check(wrongAccount.db.readCount(positionsPath(OTHER_ACCOUNT_ID)) === 0, "verification never reads outside the target account namespace");

    s.section("Symbol / volume consistency (per the existing provider contract)");
    const consistent = scenario({ input: executionInput({}, 0.2), eaReport: { volume: 0.2, executionPrice: 1.165 } });
    consistent.db.seed(pPath, positionEntry({ volume: 0.2 }));
    const consistentOutcome = await consistent.provider.execute(consistent.input);
    const consistentResult = valueOf(consistentOutcome);
    s.check(consistentOutcome.ok && consistentResult?.status === "SUCCEEDED", "matching ticket + symbol + volume verifies as SUCCEEDED");
    s.check(
        consistentResult?.position?.symbol === "EURUSD" && consistentResult?.position?.volume === 0.2 && consistentResult?.filledVolume === 0.2,
        "the verified position is consistent with the execution (EURUSD 0.20 in, EURUSD 0.20 out)"
    );
    // Pins the CURRENT production contract: verification matches by TICKET
    // identity (MT5 tickets are unique per account). An exact-volume
    // comparison is NOT part of the provider contract today, and this suite
    // deliberately does not invent stricter semantics — if the contract ever
    // gains one, this check is where it becomes visible.
    const ticketScoped = scenario({ eaReport: { volume: 0.2 } });
    ticketScoped.db.seed(pPath, positionEntry({ volume: 0.1 }));
    const ticketScopedOutcome = await ticketScoped.provider.execute(ticketScoped.input);
    s.check(
        valueOf(ticketScopedOutcome)?.status === "SUCCEEDED",
        "existing contract: verification is ticket-scoped (no exact-volume comparison is part of it)"
    );

    s.section("Transport failure: no provider confirmation stays FAILED");
    const transport = scenario({ eaReport: false });
    const transportOutcome = await transport.provider.execute(transport.input);
    const transportResult = valueOf(transportOutcome);
    const transportRequestPath = requestPath(transport.input.request.clientRequestId);
    s.check(transportOutcome.ok && transportResult?.status === "FAILED", "a missing EA execution report is FAILED — the provider never confirmed");
    s.check(transportResult?.providerRef === null, "no ticket is invented without provider confirmation");
    s.check(
        transportResult?.status !== "SUCCEEDED" && transportResult?.status !== "EXECUTED_PENDING_SYNC",
        "provider-missing confirmation is distinguished from provider-confirmed-but-mirror-late"
    );
    s.check(transportResult?.error?.code === "EXECUTION_TIMEOUT", "the failure is reported as EXECUTION_TIMEOUT");
    s.check(transport.db.readCount(transportRequestPath) >= 2, "the execution-report poll loop actually polled before timing out");
    s.check(transport.db.writeCount(transportRequestPath) === 1, "the command was enqueued exactly once");

    s.section("Late EA report — T0 submit → T3 window expires → T4 report arrives late");
    // The report is intentionally delayed PAST the execution waiting window:
    // no onWrite hook fires during execute(), so awaitExecutionReport polls
    // until the (virtual) deadline and returns null.
    const late = scenario({ eaReport: false });
    const lateRequestPath = requestPath(late.input.request.clientRequestId);
    // T0–T2: command queued once; the report poll loop runs inside the window.
    const lateOutcome = await late.provider.execute(late.input);
    const lateResult = valueOf(lateOutcome);
    // T3: the configured waiting boundary is reached with no confirmation.
    s.check(lateOutcome.ok && lateResult?.status === "FAILED", "T3: at the waiting-window boundary the provider had not confirmed — FAILED, per the existing production contract");
    s.check(lateResult?.error?.code === "EXECUTION_TIMEOUT", "the boundary expiry is surfaced as EXECUTION_TIMEOUT");
    s.check(lateResult?.providerRef === null, "no ticket is invented before provider confirmation");
    s.check(
        lateResult?.status !== "EXECUTED_PENDING_SYNC" && lateResult?.status !== "ACCEPTED" && lateResult?.status !== "SUCCEEDED",
        "an unconfirmed window is NOT EXECUTED_PENDING_SYNC/ACCEPTED/SUCCEEDED — those require provider confirmation"
    );
    s.check(late.db.writeCount(lateRequestPath) === 1, "exactly ONE MT5 command was enqueued (T0)");
    const readsAtSettle = late.db.readCount(lateRequestPath);

    // T4: the EA execution report arrives LATE — ticket, execution price,
    // volume and provider reference — written on top of the queued command,
    // exactly as /api/trading/gateway/execution would after the deadline.
    const queued = await late.db.ref(lateRequestPath).get();
    const lateReport = {
        ...(queued.val() as Record<string, unknown>),
        status: "filled",
        mt5Ticket: Number(TICKET),
        volume: 0.01,
        executionPrice: 1.165,
        providerRef: TICKET,
        executedAt: late.clock.now(),
        errorMessage: null,
    };
    late.db.seed(lateRequestPath, lateReport);
    late.db.seed(`trading_order_requests/${USER}`, { [late.input.request.clientRequestId]: lateReport });
    late.db.seed(pPath, positionEntry());

    s.check(
        late.db.readCount(lateRequestPath) === readsAtSettle + 1,
        "the late report wakes nothing: the only new command read is the test's own inspection — no watcher re-polls after settlement"
    );
    s.check(late.db.writeCount(lateRequestPath) === 1, "the late report never triggers a second command enqueue");
    const lateHistory = await late.provider.getHistory(USER, ACCOUNT_ID);
    s.check(
        lateHistory.ok && lateHistory.value.orders.some((o) => o.providerRef === TICKET && o.state === "FILLED" && o.volume === 0.01 && o.price === 1.165),
        "the late report is handled consistently: it surfaces as a FILLED order (ticket, volume, price) in the existing execution history"
    );
    const latePositions = await late.provider.getPositions(USER, ACCOUNT_ID);
    s.check(latePositions.ok && latePositions.value.length === 1, "the late report resolves to exactly ONE position — never a duplicate");

    s.section("Late report + client retries — one execution, one command, one canonical result");
    // Full-stack: the REAL Mt5DemoProvider behind the REAL UnifiedTradingService
    // (fake RTDB + virtual clock + fake idempotency store mirroring the RTDB
    // transaction shape). The client submits, the EA report never arrives in
    // time, then the client retries the SAME clientOrderId while the late
    // report lands — the scenario that must never double-execute.
    const svcClock = createVirtualClock(T0);
    const svcDb = createFakeRtdb();
    seedGatewayAccount(svcDb, svcClock);
    const svcProvider = new CountingMt5DemoProvider(
        testConfig(svcClock, { executionTimeoutMs: 3_000 }),
        svcDb
    );
    const svcStore = createFakeStore();
    const svcService = new UnifiedTradingService({
        registry: new TradingProviderRegistry([svcProvider]),
        idempotency: svcStore.idempotency,
        persistResult: svcStore.persistResult,
        persistAccount: svcStore.persistAccount,
        audit: svcStore.audit,
        entitlement: async () => true,
        now: svcClock.now,
    });
    const svcKey = "req-late-report-0001";
    const svcInput: ExecuteInput = {
        userId: USER,
        accountId: ACCOUNT_ID,
        clientRequestId: svcKey,
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.01,
    };
    const svcRequestPath = requestPath(svcKey);

    // T0–T3: no EA report inside the window → the service settles FAILED.
    const first = await svcService.execute({ ...svcInput });
    s.check(
        first.result.status === "FAILED" && first.httpStatus === 504 && first.result.error?.code === "EXECUTION_TIMEOUT",
        "T3: an unconfirmed waiting window settles as FAILED / EXECUTION_TIMEOUT / 504 — the existing production contract"
    );
    s.check(first.result.providerRef === null, "no provider reference exists before the provider confirms");
    s.check(svcProvider.executeCount === 1, "T0–T3: providerExecutionCount = 1 (one command, one execution attempt)");
    s.check(svcDb.writeCount(svcRequestPath) === 1, "T0–T3: exactly one MT5 command was enqueued");

    // T4: the late report (ticket + execution price + volume + provider ref)
    // arrives, and the broker snapshot shows the position.
    const svcQueued = await svcDb.ref(svcRequestPath).get();
    const svcLateReport = {
        ...(svcQueued.val() as Record<string, unknown>),
        status: "filled",
        mt5Ticket: Number(TICKET),
        volume: 0.01,
        executionPrice: 1.165,
        providerRef: TICKET,
        executedAt: svcClock.now(),
        errorMessage: null,
    };
    svcDb.seed(svcRequestPath, svcLateReport);
    svcDb.seed(`trading_order_requests/${USER}`, { [svcKey]: svcLateReport });
    svcDb.seed(positionsPath(), positionEntry());

    // The client retries the SAME clientOrderId — 5 concurrent retries.
    const retries = await Promise.all(
        Array.from({ length: 5 }, () => svcService.execute({ ...svcInput }))
    );
    s.check(
        retries.every((r) => r.result.duplicate === true && r.result.status === "FAILED" && r.httpStatus === 200),
        "every retry replays the SAME canonical result (FAILED + duplicate marker) — a late report never revises a settled result"
    );
    s.check(
        retries.every(
            (r) =>
                r.result.clientRequestId === svcKey &&
                r.result.providerRef === first.result.providerRef &&
                r.result.error?.code === first.result.error?.code
        ),
        "all retries converge on one canonical result: same key, same state, no fabricated ticket"
    );
    s.check(
        svcProvider.executeCount === 1,
        "providerExecutionCount = 1 — a late EA report must never cause a second provider execution"
    );
    s.check(svcDb.writeCount(svcRequestPath) === 1, "no duplicate MT5 command after the late report and the retries");
    s.check(
        svcStore.resultLog().filter((r) => r.clientRequestId === svcKey).length === 1,
        "one canonical execution result is persisted"
    );
    const svcPositions = await svcProvider.getPositions(USER, ACCOUNT_ID);
    s.check(
        svcPositions.ok && svcPositions.value.length === 1 && svcPositions.value[0]?.providerRef === TICKET,
        "no duplicate position: the snapshot holds exactly the one late-reported trade (ticket 123456)"
    );
    const svcAudits = svcStore.auditLog().filter((e) => e.clientRequestId === svcKey);
    s.check(svcAudits.filter((e) => e.action === "EXECUTION_ACCEPTED").length === 1, "one EXECUTION_ACCEPTED — the idempotency key was claimed once");
    s.check(svcAudits.filter((e) => e.action === "EXECUTION_FAILED").length === 1, "one EXECUTION_FAILED — one settlement");
    s.check(svcAudits.filter((e) => e.action === "EXECUTION_DUPLICATE").length === 5, "each of the 5 late retries is audited as EXECUTION_DUPLICATE");

    // ── Late-report reconciliation (the T4 contract) ─────────────────────────
    // A late EA report is pure reconciliation: the canonical result settled at
    // T3 stays FAILED / EXECUTION_TIMEOUT forever, the report only enriches the
    // command node that getHistory() derives FILLED orders from, and nothing
    // ever executes, enqueues or writes a position.

    s.section("TEST 1 — Late report after timeout: FAILED stays canonical, getHistory exposes the fill");
    const t1 = await reconScenario();
    s.check(
        t1.first.result.status === "FAILED" &&
            t1.first.httpStatus === 504 &&
            t1.first.result.error?.code === "EXECUTION_TIMEOUT",
        "T3: the execution settles FAILED / EXECUTION_TIMEOUT / 504 — the frozen contract"
    );
    s.check(t1.first.result.providerRef === null, "no provider reference is invented before provider confirmation");
    s.check(
        t1.provider.executeCount === 1 && t1.db.writeCount(t1.requestPath) === 1,
        "T0–T3: exactly one provider execution and one enqueued MT5 command"
    );
    const t1Before = await historyOf(t1.service, USER, ACCOUNT_ID);
    s.check(
        t1Before.ok && t1Before.value.orders.length === 0,
        "before the late report, the queued command is not a fill in getHistory"
    );

    await deliverGatewayReport(t1.db, t1.clock, USER, t1.input.clientRequestId, {
        mt5Ticket: TICKET,
        executionPrice: 1.165,
        volume: 0.01,
        symbol: "EURUSD",
    });
    t1.db.seed(positionsPath(), positionEntry());

    const t1Results = t1.store
        .resultLog()
        .filter((r) => r.clientRequestId === t1.input.clientRequestId);
    s.check(
        t1Results.length === 1 &&
            t1Results[0]?.status === "FAILED" &&
            t1Results[0]?.error?.code === "EXECUTION_TIMEOUT" &&
            t1Results[0]?.providerRef === null,
        "T4: the canonical result is immutable — still FAILED / EXECUTION_TIMEOUT with providerRef null"
    );
    s.check(
        t1.provider.executeCount === 1 && t1.db.writeCount(t1.requestPath) === 1,
        "the late report causes no second provider execution and no second MT5 command"
    );
    const t1History = await historyOf(t1.service, USER, ACCOUNT_ID);
    const t1Fill = t1History.ok
        ? t1History.value.orders.find((o) => o.providerRef === TICKET) ?? null
        : null;
    s.check(
        t1Fill !== null && t1Fill.state === "FILLED",
        "the actual fill becomes visible through getHistory as a FILLED order"
    );
    s.check(
        t1Fill !== null &&
            t1Fill.id === t1.input.clientRequestId &&
            t1Fill.volume === 0.01 &&
            t1Fill.price === 1.165 &&
            t1Fill.symbol === "EURUSD",
        "the reconciled fill carries the late ticket, volume and execution price, keyed by the original clientRequestId"
    );
    s.check(
        t1Results[0]?.status === "FAILED" && t1Fill?.state === "FILLED",
        "the client can tell both outcomes apart: request timed out, provider trade filled — one clientRequestId"
    );
    const t1Positions = await t1.provider.getPositions(USER, ACCOUNT_ID);
    s.check(t1Positions.ok && t1Positions.value.length === 1, "exactly one position — reconciliation never duplicates it");
    s.check(
        t1.db.writeCount(positionsPath()) === 0,
        "reconciliation is observational: it never writes to trading_positions"
    );

    s.section("TEST 2 — Replay after the late report: one canonical result, history keeps the fill");
    const t2 = await reconScenario();
    s.check(t2.first.result.status === "FAILED", "T3: the original settles FAILED");
    await deliverGatewayReport(t2.db, t2.clock, USER, t2.input.clientRequestId, {
        mt5Ticket: TICKET,
        executionPrice: 1.165,
        volume: 0.01,
        symbol: "EURUSD",
    });
    t2.db.seed(positionsPath(), positionEntry());
    const t2Replays = await Promise.all(
        Array.from({ length: 3 }, () => t2.service.execute({ ...t2.input }))
    );
    s.check(
        t2Replays.every((r) => r.result.duplicate === true && r.result.status === "FAILED" && r.httpStatus === 200),
        "every identical replay returns the canonical FAILED result with the duplicate marker (HTTP 200)"
    );
    s.check(
        t2.provider.executeCount === 1 && t2.db.writeCount(t2.requestPath) === 1,
        "no second provider execution and no second command from any replay"
    );
    s.check(
        t2.store.resultLog().filter((r) => r.clientRequestId === t2.input.clientRequestId).length === 1,
        "exactly one canonical execution result is persisted"
    );
    const t2History = await historyOf(t2.service, USER, ACCOUNT_ID);
    s.check(
        t2History.ok &&
            t2History.value.orders.filter((o) => o.providerRef === TICKET && o.state === "FILLED").length === 1,
        "history still exposes exactly one reconciled fill after the replays"
    );
    s.check(
        t2History.ok && new Set(t2History.value.orders.map((o) => o.providerRef)).size === 1,
        "exactly one provider ticket in history"
    );
    const t2Positions = await t2.provider.getPositions(USER, ACCOUNT_ID);
    s.check(t2Positions.ok && t2Positions.value.length === 1, "exactly one position after the replays");
    const t2Audits = t2.store.auditLog().filter((e) => e.clientRequestId === t2.input.clientRequestId);
    s.check(
        t2Audits.filter((e) => e.action === "EXECUTION_DUPLICATE").length === 3,
        "each replay is audited as EXECUTION_DUPLICATE"
    );

    s.section("TEST 3 — Conflicting replay after the late report stays rejected");
    const t3 = await reconScenario();
    await deliverGatewayReport(t3.db, t3.clock, USER, t3.input.clientRequestId, {
        mt5Ticket: TICKET,
        executionPrice: 1.165,
        volume: 0.01,
        symbol: "EURUSD",
    });
    t3.db.seed(positionsPath(), positionEntry());
    const t3Conflict = await t3.service.execute({ ...t3.input, side: "SELL" });
    s.check(
        t3Conflict.result.error?.code === "DUPLICATE_REQUEST" && t3Conflict.httpStatus === 409,
        "the same clientOrderId with BUY → SELL is rejected as an idempotency conflict (409)"
    );
    s.check(
        t3.provider.executeCount === 1 && t3.db.writeCount(t3.requestPath) === 1,
        "the conflicting replay never reaches the provider"
    );
    const t3Results = t3.store
        .resultLog()
        .filter((r) => r.clientRequestId === t3.input.clientRequestId);
    s.check(
        t3Results.length === 1 &&
            t3Results[0]?.status === "FAILED" &&
            t3Results[0]?.error?.code === "EXECUTION_TIMEOUT",
        "the canonical execution result remains the original FAILED / EXECUTION_TIMEOUT"
    );
    const t3History = await historyOf(t3.service, USER, ACCOUNT_ID);
    const t3Fill = t3History.ok
        ? t3History.value.orders.find((o) => o.providerRef === TICKET) ?? null
        : null;
    s.check(
        t3Fill !== null && t3Fill.state === "FILLED" && t3Fill.side === "BUY",
        "the reconciled original fill remains intact (still the BUY fill)"
    );
    const t3Positions = await t3.provider.getPositions(USER, ACCOUNT_ID);
    s.check(
        t3Positions.ok && t3Positions.value.length === 1 && t3Positions.value[0]?.side === "BUY",
        "only the original position exists — the SELL conflict executed nothing"
    );

    s.section("TEST 4 — Wrong-user late report: never attached across users");
    const t4 = await reconScenario();
    const t4ChildPath = `trading_order_requests/${USER}/${t4.input.clientRequestId}`;
    // The report is delivered under USER B's gateway namespace (misdelivery):
    // B has no command with this clientOrderId, so the record lands without
    // any accountId binding — identity is never invented to make it fit.
    await deliverGatewayReport(t4.db, t4.clock, OTHER_USER, t4.input.clientRequestId, {
        mt5Ticket: TICKET,
        executionPrice: 1.165,
        volume: 0.01,
        symbol: "EURUSD",
    });
    const t4UserAHistory = await historyOf(t4.service, USER, ACCOUNT_ID);
    s.check(
        t4UserAHistory.ok && t4UserAHistory.value.orders.length === 0,
        "the misdelivered report never surfaces in user A's history"
    );
    const t4UserBHistory = await historyOf(t4.service, OTHER_USER, ACCOUNT_ID);
    s.check(
        t4UserBHistory.ok && t4UserBHistory.value.orders.length === 0,
        "nor can it attach to user B — with no accountId binding it reconciles nowhere"
    );
    const t4UserBPositions = await t4.provider.getPositions(OTHER_USER, ACCOUNT_ID);
    s.check(t4UserBPositions.ok && t4UserBPositions.value.length === 0, "no cross-user position appears for user B");
    const t4ChildSnap = await t4.db.ref(t4ChildPath).get();
    const t4Child = (t4ChildSnap.val() ?? null) as Record<string, unknown> | null;
    s.check(
        t4Child !== null && String(t4Child.status) === "queued" && !("mt5Ticket" in t4Child),
        "user A's command record was not mutated by the wrong-user report"
    );
    const t4BCidPath = `trading_order_requests/${OTHER_USER}/${t4.input.clientRequestId}`;
    const t4BCidSnap = await t4.db.ref(t4BCidPath).get();
    const t4BCid = (t4BCidSnap.val() ?? null) as Record<string, unknown> | null;
    s.check(
        t4BCid !== null && String(t4BCid.accountId ?? "") === "",
        "the wrong-user record carries no accountId — identity is never manufactured"
    );
    const t4Results = t4.store
        .resultLog()
        .filter((r) => r.clientRequestId === t4.input.clientRequestId);
    s.check(
        t4Results.length === 1 && t4Results[0]?.status === "FAILED" && t4Results[0]?.providerRef === null,
        "user A's canonical result stays FAILED with no fabricated ticket"
    );
    s.check(
        t4.provider.executeCount === 1 && t4.db.writeCount(t4ChildPath) === 1,
        "one provider execution and one command — the misdelivery changes nothing"
    );

    s.section("TEST 5 — Wrong-account late report: the command's account wins, the wrong account stays empty");
    const t5 = await reconScenario();
    await deliverGatewayReport(t5.db, t5.clock, USER, t5.input.clientRequestId, {
        mt5Ticket: TICKET,
        executionPrice: 1.165,
        volume: 0.01,
        symbol: "EURUSD",
        // A hostile/buggy body claim — the route never rebinds the stored
        // command's accountId, so it must not reconcile into this account.
        accountId: OTHER_ACCOUNT_ID,
    });
    t5.db.seed(positionsPath(), positionEntry());
    const t5WrongHistory = await historyOf(t5.service, USER, OTHER_ACCOUNT_ID);
    s.check(
        t5WrongHistory.ok && t5WrongHistory.value.orders.length === 0,
        "no false fill appears in the wrong account's history"
    );
    const t5WrongPositions = await t5.provider.getPositions(USER, OTHER_ACCOUNT_ID);
    s.check(
        t5WrongPositions.ok && t5WrongPositions.value.length === 0,
        "no false position appears in the wrong account"
    );
    const t5RightHistory = await historyOf(t5.service, USER, ACCOUNT_ID);
    s.check(
        t5RightHistory.ok &&
            t5RightHistory.value.orders.some((o) => o.providerRef === TICKET && o.state === "FILLED"),
        "the fill appears only under the account the original command was enqueued for"
    );
    const t5ChildSnap = await t5.db.ref(t5.requestPath).get();
    const t5Child = (t5ChildSnap.val() ?? null) as Record<string, unknown> | null;
    s.check(
        t5Child !== null && String(t5Child.accountId ?? "") === ACCOUNT_ID,
        "the command record's accountId is never rebound by the report body"
    );
    const t5WrongLog = await t5.db
        .ref(`trading_logs/${USER}/${OTHER_ACCOUNT_ID}/${t5.input.clientRequestId}`)
        .get();
    s.check(!t5WrongLog.exists(), "the Execution Log entry never lands under the wrong account either");
    s.check(t5.provider.executeCount === 1, "one provider execution throughout");

    s.section("TEST 6 — Duplicate late report: idempotent reconciliation");
    const t6 = await reconScenario();
    const t6Report = { mt5Ticket: TICKET, executionPrice: 1.165, volume: 0.01, symbol: "EURUSD" };
    await deliverGatewayReport(t6.db, t6.clock, USER, t6.input.clientRequestId, t6Report);
    // The EA re-POSTs the same report (retry / reconnect) — same payload.
    await deliverGatewayReport(t6.db, t6.clock, USER, t6.input.clientRequestId, t6Report);
    t6.db.seed(positionsPath(), positionEntry());
    const t6History = await historyOf(t6.service, USER, ACCOUNT_ID);
    s.check(
        t6History.ok &&
            t6History.value.orders.filter((o) => o.id === t6.input.clientRequestId).length === 1,
        "delivering the same report twice yields ONE history entry for the request"
    );
    s.check(
        t6History.ok &&
            t6History.value.orders.filter((o) => o.providerRef === TICKET && o.state === "FILLED").length === 1,
        "one reconciled fill, one provider ticket — reconciliation is idempotent"
    );
    const t6Positions = await t6.provider.getPositions(USER, ACCOUNT_ID);
    s.check(t6Positions.ok && t6Positions.value.length === 1, "still exactly one position after the duplicate report");
    s.check(
        t6.provider.executeCount === 1 && t6.db.writeCount(t6.requestPath) === 1,
        "no second execution and no second command from the duplicate report"
    );
    const t6Results = t6.store
        .resultLog()
        .filter((r) => r.clientRequestId === t6.input.clientRequestId);
    s.check(
        t6Results.length === 1 && t6Results[0]?.status === "FAILED",
        "the canonical result is still the single FAILED record"
    );
    const t6Replay = await t6.service.execute({ ...t6.input });
    s.check(
        t6Replay.result.duplicate === true && t6.provider.executeCount === 1,
        "a replay after both reports still executes nothing"
    );

    s.section("TEST 7 — Insufficient identity: an ambiguous report is never guessed into a fill");
    const t7 = await reconScenario();
    // A report for a clientOrderId that was never queued — with a symbol,
    // volume and price matching the timed-out request exactly. The command
    // record does not exist, so no accountId identity exists to bind to.
    const t7GhostCid = "req-recon-ghost";
    await deliverGatewayReport(t7.db, t7.clock, USER, t7GhostCid, {
        mt5Ticket: "999001",
        executionPrice: 1.165,
        volume: 0.01,
        symbol: "EURUSD",
    });
    const t7History = await historyOf(t7.service, USER, ACCOUNT_ID);
    s.check(
        t7History.ok && t7History.value.orders.length === 0,
        "a report without an originating command never becomes a fill — matching by symbol alone is forbidden"
    );
    s.check(
        t7History.ok && t7History.value.orders.every((o) => o.providerRef !== "999001"),
        "the phantom ticket 999001 appears in no account history"
    );
    const t7OtherHistory = await historyOf(t7.service, USER, OTHER_ACCOUNT_ID);
    s.check(
        t7OtherHistory.ok && t7OtherHistory.value.orders.length === 0,
        "the ambiguous report stays unreconciled under every account"
    );
    const t7GhostSnap = await t7.db.ref(`trading_order_requests/${USER}/${t7GhostCid}`).get();
    const t7Ghost = (t7GhostSnap.val() ?? null) as Record<string, unknown> | null;
    s.check(
        t7Ghost !== null && String(t7Ghost.accountId ?? "") === "",
        "the phantom record carries no accountId — identity is never invented to make it fit"
    );
    const t7Log = await t7.db
        .ref(`trading_logs/${USER}/${ACCOUNT_ID}/${t7GhostCid}`)
        .get();
    s.check(!t7Log.exists(), "no Execution Log fill is written under any account for the phantom report");
    const t7Results = t7.store
        .resultLog()
        .filter((r) => r.clientRequestId === t7.input.clientRequestId);
    s.check(
        t7Results.length === 1 &&
            t7Results[0]?.status === "FAILED" &&
            t7Results[0]?.error?.code === "EXECUTION_TIMEOUT",
        "the real timed-out request stays unreconciled — FAILED / EXECUTION_TIMEOUT, never guessed into success"
    );
    const t7Positions = await t7.provider.getPositions(USER, ACCOUNT_ID);
    s.check(
        t7Positions.ok && t7Positions.value.length === 0,
        "no position is manufactured for either record"
    );
    s.check(
        t7.provider.executeCount === 1 && t7.db.writeCount(t7.requestPath) === 1,
        "no execution and no command were produced by the ambiguous report"
    );

    s.section("Configuration: three distinct knobs, loaded and documented");
    const mapped = mt5DemoConfigFromEnv({
        NODE_ENV: "test",
        UNIFIED_TRADING_EXECUTION_TIMEOUT_MS: "111",
        UNIFIED_TRADING_EXECUTION_POLL_MS: "33",
        UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS: "777",
    });
    s.check(
        mapped.executionTimeoutMs === 111 && mapped.pollIntervalMs === 33 && mapped.verificationTimeoutMs === 777,
        "each env var loads into its own field — execution timeout, poll interval and verification timeout are not conflated"
    );
    const defaults = mt5DemoConfigFromEnv({ NODE_ENV: "test" });
    s.check(
        defaults.executionTimeoutMs === 20_000 && defaults.pollIntervalMs === 750 && defaults.verificationTimeoutMs === 12_000,
        "production defaults remain sensible and unchanged (20000 / 750 / 12000)"
    );
    s.check(defaults.executionTimeoutMs !== defaults.verificationTimeoutMs, "execution-report wait and post-fill verification wait remain distinct concepts");
    const invalid = mt5DemoConfigFromEnv({
        NODE_ENV: "test",
        UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS: "soon",
        UNIFIED_TRADING_EXECUTION_TIMEOUT_MS: "-1",
    });
    s.check(
        invalid.verificationTimeoutMs === 12_000 && invalid.executionTimeoutMs === 20_000,
        "invalid values fall back to the production defaults instead of disabling verification"
    );

    const envExample = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    const archDoc = readFileSync(path.join(process.cwd(), "docs/architecture/UNIFIED_TRADING.md"), "utf8");
    s.check(
        envExample.includes("UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS") &&
            envExample.includes("UNIFIED_TRADING_EXECUTION_TIMEOUT_MS") &&
            envExample.includes("UNIFIED_TRADING_EXECUTION_POLL_MS"),
        ".env.example documents all three execution/verification knobs"
    );
    s.check(
        archDoc.includes("UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS") && archDoc.includes("EXECUTED_PENDING_SYNC"),
        "the architecture doc documents the verification timeout and the pending-sync outcome"
    );

    return s.finish();
}
