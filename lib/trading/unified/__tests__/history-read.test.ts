/**
 * Unified Trading history READ-path tests (server).
 *
 * Focused suite for the read-only route the Chrome Extension's Execution
 * History migrated to: `GET /api/trading/history` →
 * `handleUnifiedHistoryRequest` → `UnifiedTradingService.getHistory()` +
 * `tradingExecutionResults`.
 *
 * The handler is exercised with injectable deps: a controlled in-memory fake
 * of the RTDB admin database (flat path map + tree-mirroring helpers, exactly
 * like the provider suite uses), the REAL `UnifiedTradingService` behind the
 * REAL `Mt5DemoProvider`, a virtual clock (no wall-clock sleeps, no fake
 * timers) and a substituted `authenticate`. No Firebase account, no network.
 *
 * Coverage (Unified History Read Migration, Phase 10):
 *   1. authenticated user can read own history
 *   2. unauthenticated request rejected
 *   3. another user's history inaccessible
 *   4. account isolation
 *   5. normal successful execution appears
 *   6. provider ticket appears
 *   7. actual execution price appears
 *   8. filled volume appears
 *   9. late EA report appears in history
 *  10. original timeout result remains immutable
 *  11. duplicate EA report does not create duplicate history
 *  12. replay does not create duplicate history
 *  13. multiple executions remain separate
 *  14. pending-sync representation is correct
 *
 * Plus route-contract source scans: authenticated, read-only, canonical
 * source, no raw command-queue access, no provider-specific logic.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import {
    buildUnifiedHistoryEntries,
    handleUnifiedHistoryRequest,
    type UnifiedHistoryEntry,
    type UnifiedHistoryRequestDeps,
} from "@/lib/trading/unified/history";
import {
    Mt5DemoProvider,
    type Mt5DemoProviderConfig,
} from "@/lib/trading/unified/mt5-demo-provider";
import { TradingProviderRegistry } from "@/lib/trading/unified/adapter";
import { UnifiedTradingService, type ExecuteInput } from "@/lib/trading/unified/service";
import type {
    TradingExecutionResult,
    TradingHistory,
    TradingOrder,
} from "@/lib/trading/unified/domain";
import { createFakeStore } from "./fakes";

const T0 = 1_700_000_000_000;
const USER = "user-hist";
const OTHER_USER = "user-other";
const ACCOUNT_ID = "gateway_777001";
const OTHER_ACCOUNT_ID = "gateway_999002";
const FOREIGN_ACCOUNT_ID = "gateway_555002";
const TICKET = "123456";

// ─── Controlled fake RTDB admin database ─────────────────────────────────────

interface FakeSnapshot {
    exists(): boolean;
    val(): unknown;
}

/**
 * In-memory stand-in for the Firebase RTDB admin database, implementing the
 * surface both the provider and the history read consume
 * (`ref(path).get()` / `ref(path).set()`), plus seeding helpers that keep the
 * flat map faithful to real RTDB tree semantics (a parent read sees its
 * children). `seed()` never counts as a write — read-only assertions compare
 * `totalWrites()` before and after a handler call.
 */
function createFakeRtdb() {
    const data = new Map<string, unknown>();
    const reads = new Map<string, number>();
    const writes = new Map<string, number>();
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
                    const captured = data.get(refPath) ?? null;
                    bump(reads, refPath);
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
        /** Counter-free read for fixtures (does not pollute read assertions). */
        readSync(readPath: string): unknown {
            return data.get(readPath) ?? null;
        },
        onWrite(writePath: string, hook: (value: unknown) => void): void {
            writeHooks.set(writePath, hook);
        },
        readCount(readPath: string): number {
            return reads.get(readPath) ?? 0;
        },
        totalReads(): number {
            let total = 0;
            for (const count of reads.values()) total += count;
            return total;
        },
        totalWrites(): number {
            let total = 0;
            for (const count of writes.values()) total += count;
            return total;
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

function testConfig(clock: VirtualClock): Mt5DemoProviderConfig {
    return {
        heartbeatStaleMs: 90_000,
        heartbeatDegradedMs: 45_000,
        // Tiny but VIRTUAL: the injected sleep advances the clock, so these
        // values never cost wall-clock time while exercising the real deadline
        // arithmetic of awaitExecutionReport()/verifyInSyncedState().
        executionTimeoutMs: 3_000,
        pollIntervalMs: 500,
        verificationTimeoutMs: 3_000,
        clock: clock.now,
        sleep: clock.sleep,
    };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Raw `trading_accounts/{uid}/{accountId}` record as the EA writes it. */
function seedGatewayAccount(
    db: FakeRtdb,
    clock: VirtualClock,
    accountId: string = ACCOUNT_ID,
    userId: string = USER
): void {
    db.seed(`trading_accounts/${userId}/${accountId}`, {
        environment: "DEMO",
        demo: true,
        mt5Account: accountId.replace("gateway_", ""),
        broker: "DemoBroker",
        server: "DemoBroker-Demo",
        currency: "USD",
        leverage: 100,
        balance: 10_000,
        equity: 10_000,
        lastHeartbeatAt: clock.now(),
    });
}

/**
 * Writes a command node AND the parent listing `getHistory()` reads. The fake
 * RTDB is a flat path map, while a real RTDB parent read sees its children —
 * this keeps the simulation faithful to production tree semantics.
 */
function putRequestRecord(
    db: FakeRtdb,
    userId: string,
    clientRequestId: string,
    record: Record<string, unknown>
): void {
    db.seed(`trading_order_requests/${userId}/${clientRequestId}`, record);
    const parentPath = `trading_order_requests/${userId}`;
    const siblings = db.readSync(parentPath);
    const base =
        siblings && typeof siblings === "object"
            ? (siblings as Record<string, unknown>)
            : {};
    db.seed(parentPath, { ...base, [clientRequestId]: record });
}

/**
 * Mirrors what `saveExecutionResult` persists at
 * `tradingExecutionResults/{uid}/{clientRequestId}` — one immutable canonical
 * result per execution, keyed by clientRequestId (parent listing shape).
 */
function putResult(db: FakeRtdb, userId: string, result: TradingExecutionResult): void {
    const parentPath = `tradingExecutionResults/${userId}`;
    const siblings = db.readSync(parentPath);
    const base =
        siblings && typeof siblings === "object"
            ? (siblings as Record<string, unknown>)
            : {};
    db.seed(parentPath, { ...base, [result.clientRequestId]: result });
}

/** Canonical execution result exactly as `persistResult` writes it. */
function canonicalResult(
    overrides: Partial<TradingExecutionResult> & { clientRequestId: string }
): TradingExecutionResult {
    return {
        correlationId: `corr-${overrides.clientRequestId}`,
        accountId: ACCOUNT_ID,
        provider: "MT5",
        environment: "DEMO",
        executionType: "PLACE_ORDER",
        status: "SUCCEEDED",
        providerRef: null,
        filledVolume: null,
        filledPrice: null,
        order: null,
        position: null,
        error: null,
        duplicate: false,
        createdAt: T0,
        completedAt: T0 + 100,
        ...overrides,
    };
}

/** One entry of `trading_positions/{uid}/{accountId}` as the EA snapshot writes it. */
function positionEntry(ticket: string = TICKET): Record<string, unknown> {
    return {
        [ticket]: {
            ticket: Number(ticket),
            symbol: "EURUSD",
            type: "BUY",
            volume: 0.01,
            openPrice: 1.165,
            currentPrice: 1.165,
            openedAt: T0,
            magic: 42,
            comment: "unified",
        },
    };
}

/**
 * Simulates the EA's answer on `/api/trading/gateway/execution`: the moment
 * the adapter enqueues the command, the EA reports the fill (ticket, volume,
 * execution price) on the SAME command node.
 */
function installEaReport(
    db: FakeRtdb,
    clock: VirtualClock,
    clientRequestId: string,
    spec: { ticket?: string; volume?: number; executionPrice?: number } = {}
): void {
    const childPath = `trading_order_requests/${USER}/${clientRequestId}`;
    db.onWrite(childPath, (value) => {
        const command =
            value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        db.seed(childPath, {
            ...command,
            status: "filled",
            mt5Ticket: Number(spec.ticket ?? TICKET),
            volume: spec.volume ?? 0.01,
            executionPrice: spec.executionPrice ?? 1.165,
            executedAt: clock.now(),
            errorCode: 0,
            errorMessage: null,
        });
    });
}

/** Counts provider executions — proves a replay never re-executes. */
class CountingMt5DemoProvider extends Mt5DemoProvider {
    executeCount = 0;

    async execute(...parameters: Parameters<Mt5DemoProvider["execute"]>) {
        this.executeCount += 1;
        return super.execute(...parameters);
    }
}

// ─── Stack: REAL service + REAL provider on the fake RTDB ────────────────────

interface HistoryStack {
    db: FakeRtdb;
    clock: VirtualClock;
    provider: CountingMt5DemoProvider;
    service: UnifiedTradingService;
}

function createStack(): HistoryStack {
    const clock = createVirtualClock(T0);
    const db = createFakeRtdb();
    seedGatewayAccount(db, clock);
    const provider = new CountingMt5DemoProvider(testConfig(clock), db);
    const store = createFakeStore();
    const service = new UnifiedTradingService({
        registry: new TradingProviderRegistry([provider]),
        idempotency: store.idempotency,
        persistResult: async (userId, result) => {
            await store.persistResult(userId, result);
            // Mirror the RTDB tree shape `saveExecutionResult` writes so the
            // read path sees exactly what production persists.
            putResult(db, userId, result);
        },
        persistAccount: store.persistAccount,
        audit: store.audit,
        entitlement: async () => true,
        now: clock.now,
    });
    return { db, clock, provider, service };
}

interface ObservedCall {
    userId?: string;
    accountId?: string;
}

function makeDeps(
    stack: HistoryStack,
    uid: string | null,
    observed: ObservedCall = {}
): UnifiedHistoryRequestDeps {
    return {
        database: stack.db,
        authenticate: async () => (uid ? { uid } : null),
        getHistory: async (userId, accountId, since) => {
            observed.userId = userId;
            observed.accountId = accountId;
            const result = await stack.service.getHistory(userId, accountId, since);
            if (!result.ok) return result;
            return { ok: true, value: result.value as TradingHistory };
        },
    };
}

function historyRequest(query = `?accountId=${ACCOUNT_ID}`): NextRequest {
    return new NextRequest(`http://localhost/api/trading/history${query}`);
}

interface HistoryBody {
    success: boolean;
    accountId?: string;
    entries?: UnifiedHistoryEntry[];
    truncated?: boolean;
    error?: unknown;
}

async function bodyOf(response: NextResponse): Promise<HistoryBody> {
    return (await response.json()) as HistoryBody;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

export async function runHistoryReadTests(): Promise<boolean> {
    const s = createSuite("unified-history-read");

    // ── 2: unauthenticated ───────────────────────────────────────────────────
    s.section("[2] unauthenticated request rejected before any data access");
    const anon = createStack();
    const anonResponse = await handleUnifiedHistoryRequest(
        historyRequest(),
        makeDeps(anon, null)
    );
    const anonBody = await bodyOf(anonResponse);
    s.check(anonResponse.status === 401, "2. unauthenticated request rejected (401)");
    s.check(anonBody.success === false, "2. the refusal is a structured { success: false } envelope");
    s.check(anon.db.totalReads() === 0, "2. the rejection touches no data (zero RTDB reads)");

    // ── route contract (source scans) ────────────────────────────────────────
    s.section("route contract: authenticated, read-only, canonical source");
    const root = process.cwd();
    const routeSrc = readFileSync(
        path.join(root, "app/api/trading/history/route.ts"),
        "utf8"
    );
    const historySrc = readFileSync(
        path.join(root, "lib/trading/unified/history.ts"),
        "utf8"
    );
    s.check(routeSrc.includes("authenticate("), "the route requires Firebase authentication");
    s.check(routeSrc.includes('runtime = "nodejs"'), "the route runs on the nodejs runtime");
    s.check(
        !routeSrc.includes("export async function POST"),
        "the route exposes no write method (GET/OPTIONS only)"
    );
    s.check(
        routeSrc.includes("createUnifiedTradingService"),
        "the route reads through the canonical UnifiedTradingService"
    );
    s.check(!routeSrc.includes("MT5"), "the route contains no provider-specific logic");
    s.check(historySrc.includes("token.uid"), "the userId comes from the verified token, never the query");
    s.check(historySrc.includes("accountOwnedBy("), "account ownership is enforced server-side");
    for (const forbidden of [
        ".update(",
        ".remove(",
        "claimExecutionRequest",
        "saveExecutionResult",
        "appendAuditEvent",
        "trading_order_requests",
        "adminDatabase",
        ".execute(",
    ]) {
        s.check(
            !historySrc.includes(forbidden),
            `the read model never touches "${forbidden}" (read-only, no raw queue)`
        );
    }

    // ── 1 + 5/6/7/8/12: authenticated own history (full stack) ───────────────
    s.section("[1][5][6][7][8][12] authenticated read of own history");
    const own = createStack();
    const ownCid = "hist-ok-0001";
    own.db.seed(`trading_positions/${USER}/${ACCOUNT_ID}`, positionEntry());
    installEaReport(own.db, own.clock, ownCid);
    const executeInput: ExecuteInput = {
        userId: USER,
        accountId: ACCOUNT_ID,
        clientRequestId: ownCid,
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.01,
        source: "test",
    };
    const outcome = await own.service.execute(executeInput);
    s.check(
        outcome.result.status === "SUCCEEDED",
        "fixture: the full-stack execution settles SUCCEEDED"
    );
    const ownChild = own.db.readSync(
        `trading_order_requests/${USER}/${ownCid}`
    ) as Record<string, unknown>;
    putRequestRecord(own.db, USER, ownCid, ownChild);

    // Replay the SAME clientRequestId — idempotency must return the stored
    // result without a second execution or a second command node.
    const replay = await own.service.execute(executeInput);
    s.check(replay.result.duplicate === true, "fixture: the replay returns the stored result");
    s.check(own.provider.executeCount === 1, "fixture: the replay never re-executes (count = 1)");

    const observed: ObservedCall = {};
    const ownResponse = await handleUnifiedHistoryRequest(
        historyRequest(),
        makeDeps(own, USER, observed)
    );
    const ownBody = await bodyOf(ownResponse);
    const ownEntries = ownBody.entries ?? [];
    s.check(
        ownResponse.status === 200 && ownBody.success === true,
        "1. authenticated user can read own history (200, success envelope)"
    );
    s.check(observed.userId === USER, "1. identity comes from the verified token, not the query");
    s.check(ownBody.accountId === ACCOUNT_ID, "1. the response names the requested account");
    s.check(ownBody.truncated === false, "1. the response reports the provider truncation flag");
    s.check(ownEntries.length === 1, "12. a replayed execution appears exactly once in history");
    const ownEntry = ownEntries[0];
    s.check(
        ownEntry?.clientRequestId === ownCid && ownEntry?.state === "FILLED",
        "5. a normal successful execution appears (state FILLED)"
    );
    s.check(ownEntry?.result === "SUCCEEDED", "5. the canonical execution result accompanies the fill");
    s.check(ownEntry?.providerRef === TICKET, "6. the provider ticket appears");
    s.check(ownEntry?.price === 1.165, "7. the actual execution price appears");
    s.check(
        ownEntry?.filledVolume === 0.01 && ownEntry?.volume === 0.01,
        "8. the filled volume appears"
    );
    s.check(
        ownEntry?.symbol === "EURUSD" &&
            ownEntry?.side === "BUY" &&
            ownEntry?.kind === "MARKET" &&
            ownEntry?.executionType === "PLACE_ORDER",
        "5. symbol, side, order kind and execution type appear"
    );
    s.check(
        ownEntry?.accountId === ACCOUNT_ID &&
            typeof ownEntry?.createdAt === "number" &&
            typeof ownEntry?.executedAt === "number",
        "5. account and created/executed timestamps appear"
    );
    s.check(ownEntry?.errorMessage === null, "a fill carries no failure reason");

    // ── 4: account isolation (same user, multiple accounts) ──────────────────
    s.section("[4] account isolation within one user");
    const iso = createStack();
    seedGatewayAccount(iso.db, iso.clock, OTHER_ACCOUNT_ID);
    putRequestRecord(iso.db, USER, "iso-a1", {
        accountId: ACCOUNT_ID,
        symbol: "EURUSD",
        action: "BUY",
        volume: 0.01,
        price: 1.1,
        status: "filled",
        mt5Ticket: "111111",
        executionPrice: 1.101,
        createdAt: T0 - 1_000,
        executedAt: T0 - 500,
    });
    putRequestRecord(iso.db, USER, "iso-a2", {
        accountId: OTHER_ACCOUNT_ID,
        symbol: "XAUUSD",
        action: "SELL",
        volume: 0.1,
        price: 2_000,
        status: "filled",
        mt5Ticket: "222222",
        executionPrice: 2_001,
        createdAt: T0 - 2_000,
        executedAt: T0 - 1_500,
    });
    const isoA1 = await bodyOf(
        await handleUnifiedHistoryRequest(historyRequest(), makeDeps(iso, USER))
    );
    const isoA1Entries = isoA1.entries ?? [];
    s.check(
        isoA1Entries.length === 1 && isoA1Entries[0]?.clientRequestId === "iso-a1",
        "4. the first account sees only its own execution"
    );
    const isoA2 = await bodyOf(
        await handleUnifiedHistoryRequest(
            historyRequest(`?accountId=${OTHER_ACCOUNT_ID}`),
            makeDeps(iso, USER)
        )
    );
    const isoA2Entries = isoA2.entries ?? [];
    s.check(
        isoA2Entries.length === 1 &&
            isoA2Entries[0]?.clientRequestId === "iso-a2" &&
            isoA2Entries[0]?.symbol === "XAUUSD",
        "4. the second account sees only its own execution"
    );

    // ── 3: another user's history inaccessible ───────────────────────────────
    s.section("[3] another user's history is inaccessible");
    const cross = createStack();
    seedGatewayAccount(cross.db, cross.clock, FOREIGN_ACCOUNT_ID, OTHER_USER);
    putRequestRecord(cross.db, OTHER_USER, "b-exec-1", {
        accountId: FOREIGN_ACCOUNT_ID,
        symbol: "EURUSD",
        action: "BUY",
        volume: 0.02,
        price: 1.2,
        status: "filled",
        mt5Ticket: "333333",
        executionPrice: 1.201,
        createdAt: T0 - 3_000,
        executedAt: T0 - 2_500,
    });
    putResult(
        cross.db,
        OTHER_USER,
        canonicalResult({ clientRequestId: "b-exec-1", accountId: FOREIGN_ACCOUNT_ID })
    );
    const foreign = await handleUnifiedHistoryRequest(
        historyRequest(`?accountId=${FOREIGN_ACCOUNT_ID}`),
        makeDeps(cross, USER)
    );
    s.check(foreign.status === 404, "3. an account the caller does not own is refused (404)");
    s.check(
        cross.db.readCount(`trading_order_requests/${OTHER_USER}`) === 0,
        "3. the other user's command nodes are never read"
    );
    s.check(
        cross.db.readCount(`tradingExecutionResults/${OTHER_USER}`) === 0,
        "3. the other user's execution results are never read"
    );
    // Belt and braces: even when the caller OWNS the accountId, rows stored
    // under another user's namespace can never surface.
    seedGatewayAccount(cross.db, cross.clock, "gateway_111003", USER);
    putRequestRecord(cross.db, OTHER_USER, "b-exec-2", {
        accountId: "gateway_111003",
        symbol: "EURUSD",
        action: "BUY",
        volume: 0.01,
        status: "filled",
        mt5Ticket: "444444",
        executionPrice: 1.3,
        createdAt: T0 - 4_000,
        executedAt: T0 - 3_500,
    });
    const scoped = await bodyOf(
        await handleUnifiedHistoryRequest(
            historyRequest("?accountId=gateway_111003"),
            makeDeps(cross, USER)
        )
    );
    s.check(
        scoped.success === true && (scoped.entries ?? []).length === 0,
        "3. rows living in another user's namespace never surface in an owned account"
    );
    s.check(
        cross.db.readCount(`trading_order_requests/${OTHER_USER}`) === 0,
        "3. the other user's namespace stays unread even for an owned accountId"
    );

    // ── 9 + 10: late EA report after a timeout ───────────────────────────────
    s.section("[9][10] late EA report: the fill appears, the timeout stays immutable");
    const late = createStack();
    const lateCid = "late-0001";
    const lateResultPath = `tradingExecutionResults/${USER}`;
    putResult(
        late.db,
        USER,
        canonicalResult({
            clientRequestId: lateCid,
            status: "FAILED",
            providerRef: null,
            error: {
                code: "EXECUTION_TIMEOUT",
                message: "The MetaTrader 5 gateway did not confirm the execution in time.",
                retryable: true,
                at: T0 + 3_000,
            },
        })
    );
    putRequestRecord(late.db, USER, lateCid, {
        accountId: ACCOUNT_ID,
        symbol: "EURUSD",
        action: "BUY",
        volume: 0.01,
        price: 0,
        sl: null,
        tp: null,
        source: "unified",
        status: "queued",
        createdAt: T0,
        updatedAt: T0,
    });
    const canonicalBefore = JSON.stringify(late.db.readSync(lateResultPath));
    const writesBefore = late.db.totalWrites();

    const pre = await bodyOf(
        await handleUnifiedHistoryRequest(historyRequest(), makeDeps(late, USER))
    );
    s.check(
        (pre.entries ?? []).length === 0,
        "9. before the report, a still-queued request is not execution history (preserved behavior)"
    );

    // T4: the EA execution report lands LATE on the SAME command node —
    // exactly what POST /api/trading/gateway/execution does with .update().
    const queued = late.db.readSync(
        `trading_order_requests/${USER}/${lateCid}`
    ) as Record<string, unknown>;
    putRequestRecord(late.db, USER, lateCid, {
        ...queued,
        status: "filled",
        mt5Ticket: Number(TICKET),
        executionPrice: 1.165,
        volume: 0.01,
        executedAt: T0 + 9_000,
        errorCode: 0,
        errorMessage: "",
    });
    const post = await bodyOf(
        await handleUnifiedHistoryRequest(historyRequest(), makeDeps(late, USER))
    );
    const postEntries = post.entries ?? [];
    s.check(postEntries.length === 1, "9. the late EA report appears as exactly one history entry");
    const lateEntry = postEntries[0];
    s.check(
        lateEntry?.state === "FILLED" && lateEntry?.providerRef === TICKET,
        "9. the actual fill is visible (FILLED + provider ticket) after the late report"
    );
    s.check(
        lateEntry?.result === "FAILED",
        "9. the canonical FAILED result stays exposed alongside the fill (two truths)"
    );
    s.check(
        lateEntry?.price === 1.165 &&
            lateEntry?.filledVolume === 0.01 &&
            lateEntry?.executedAt === T0 + 9_000,
        "9. the fill carries actual execution price, filled volume and executed time"
    );
    s.check(
        lateEntry?.errorMessage === null,
        "a reconciled FILLED row never renders the original timeout as its failure reason"
    );
    const canonicalAfter = JSON.stringify(late.db.readSync(lateResultPath));
    s.check(
        canonicalAfter === canonicalBefore,
        "10. reading history never mutates the canonical FAILED / EXECUTION_TIMEOUT result"
    );
    s.check(
        late.db.totalWrites() === writesBefore,
        "10. the read path performs zero RTDB writes"
    );

    // ── 11: duplicate EA report ──────────────────────────────────────────────
    s.section("[11] duplicate EA report does not create duplicate history");
    const merged = late.db.readSync(
        `trading_order_requests/${USER}/${lateCid}`
    ) as Record<string, unknown>;
    putRequestRecord(late.db, USER, lateCid, { ...merged }); // re-deliver the identical report
    const dup = await bodyOf(
        await handleUnifiedHistoryRequest(historyRequest(), makeDeps(late, USER))
    );
    s.check(
        (dup.entries ?? []).length === 1,
        "11. a duplicate EA report leaves exactly one history entry"
    );
    const duplicateOrder: TradingOrder = {
        id: "dup-unit-1",
        accountId: ACCOUNT_ID,
        provider: "MT5",
        symbol: "EURUSD",
        kind: "MARKET",
        side: "BUY",
        volume: 0.01,
        price: 1.165,
        stopLoss: null,
        takeProfit: null,
        state: "FILLED",
        createdAt: T0,
        filledAt: T0,
        magicNumber: null,
        comment: null,
        providerRef: TICKET,
    };
    const deduped = buildUnifiedHistoryEntries(
        { deals: [], orders: [duplicateOrder, { ...duplicateOrder }], truncated: false },
        []
    );
    s.check(
        deduped.length === 1,
        "11. two source rows for one clientRequestId collapse to a single entry"
    );

    // ── 13: multiple executions remain separate ──────────────────────────────
    s.section("[13] multiple executions remain separate");
    const multi = createStack();
    putRequestRecord(multi.db, USER, "multi-1", {
        accountId: ACCOUNT_ID,
        symbol: "EURUSD",
        action: "BUY",
        volume: 0.01,
        price: 0,
        status: "filled",
        mt5Ticket: "555551",
        executionPrice: 1.101,
        createdAt: T0 - 1_000,
        executedAt: T0 - 900,
    });
    putRequestRecord(multi.db, USER, "multi-2", {
        accountId: ACCOUNT_ID,
        symbol: "EURUSD",
        action: "BUY",
        volume: 0.02,
        price: 0,
        status: "filled",
        mt5Ticket: "555552",
        executionPrice: 1.102,
        createdAt: T0 - 2_000,
        executedAt: T0 - 1_800,
    });
    putResult(
        multi.db,
        USER,
        canonicalResult({
            clientRequestId: "multi-1",
            providerRef: "555551",
            filledVolume: 0.01,
            filledPrice: 1.101,
        })
    );
    putResult(
        multi.db,
        USER,
        canonicalResult({
            clientRequestId: "multi-2",
            providerRef: "555552",
            filledVolume: 0.02,
            filledPrice: 1.102,
        })
    );
    const multiBody = await bodyOf(
        await handleUnifiedHistoryRequest(historyRequest(), makeDeps(multi, USER))
    );
    const multiEntries = multiBody.entries ?? [];
    s.check(
        multiEntries.length === 2,
        "13. two executions for the same symbol stay two history entries"
    );
    s.check(
        multiEntries[0]?.clientRequestId !== multiEntries[1]?.clientRequestId,
        "13. entries are keyed by distinct clientRequestIds (never symbol+timestamp)"
    );
    s.check(
        multiEntries[0]?.clientRequestId === "multi-1" &&
            multiEntries[1]?.clientRequestId === "multi-2",
        "13. entries keep the newest-first ordering of the canonical history"
    );

    // ── 14: pending-sync representation ──────────────────────────────────────
    s.section("[14] pending-sync representation");
    const pending = createStack();
    putRequestRecord(pending.db, USER, "psync-1", {
        accountId: ACCOUNT_ID,
        symbol: "EURUSD",
        action: "BUY",
        volume: 0.02,
        price: 0,
        status: "filled",
        mt5Ticket: Number(TICKET),
        executionPrice: 1.165,
        createdAt: T0,
        executedAt: T0 + 500,
    });
    putResult(
        pending.db,
        USER,
        canonicalResult({
            clientRequestId: "psync-1",
            status: "EXECUTED_PENDING_SYNC",
            providerRef: TICKET,
            filledVolume: 0.02,
            filledPrice: 1.165,
            error: {
                code: "EXECUTION_TIMEOUT",
                message:
                    "Executed on the broker but the account snapshot has not synced yet. The position will appear shortly.",
                retryable: true,
                at: T0 + 500,
            },
        })
    );
    const pendingBody = await bodyOf(
        await handleUnifiedHistoryRequest(historyRequest(), makeDeps(pending, USER))
    );
    const pendingEntry = (pendingBody.entries ?? [])[0];
    s.check(
        pendingEntry?.state === "FILLED" && pendingEntry?.result === "EXECUTED_PENDING_SYNC",
        "14. pending-sync is an executed fill carrying the canonical EXECUTED_PENDING_SYNC result"
    );
    s.check(
        pendingEntry?.state !== "REJECTED" && pendingEntry?.result !== "FAILED",
        "14. pending-sync is never represented as failed or rejected"
    );
    s.check(
        pendingEntry?.providerRef === TICKET &&
            pendingEntry?.filledVolume === 0.02 &&
            pendingEntry?.errorMessage === null,
        "14. pending-sync exposes ticket and filled volume without a failure reason"
    );

    // ── rejected executions: failure reason ──────────────────────────────────
    s.section("rejected execution: reason and provider-side rejection");
    const rejected = createStack();
    putRequestRecord(rejected.db, USER, "rej-1", {
        accountId: ACCOUNT_ID,
        symbol: "EURUSD",
        action: "SELL",
        volume: 0.1,
        price: 1.105,
        status: "rejected",
        mt5Ticket: "777001",
        errorMessage: "Invalid volume",
        errorCode: 10014,
        createdAt: T0 - 5_000,
        executedAt: T0 - 4_000,
    });
    putResult(
        rejected.db,
        USER,
        canonicalResult({
            clientRequestId: "rej-1",
            status: "REJECTED",
            providerRef: "777001",
            error: {
                code: "INVALID_VOLUME",
                message: "Invalid volume",
                retryable: false,
                at: T0 - 4_000,
            },
        })
    );
    const rejectedBody = await bodyOf(
        await handleUnifiedHistoryRequest(historyRequest(), makeDeps(rejected, USER))
    );
    const rejectedEntry = (rejectedBody.entries ?? [])[0];
    s.check(
        rejectedEntry?.state === "REJECTED" && rejectedEntry?.result === "REJECTED",
        "a rejected execution appears with its provider-side rejection state"
    );
    s.check(
        rejectedEntry?.errorMessage === "Invalid volume",
        "the failure reason from the canonical result appears"
    );

    // ── query validation ─────────────────────────────────────────────────────
    s.section("query validation");
    const validation = createStack();
    const missingAccount = await handleUnifiedHistoryRequest(
        historyRequest(""),
        makeDeps(validation, USER)
    );
    s.check(missingAccount.status === 400, "a missing accountId is refused (400)");
    const structuralAccount = await handleUnifiedHistoryRequest(
        historyRequest("?accountId=../../other"),
        makeDeps(validation, USER)
    );
    s.check(
        structuralAccount.status === 400,
        "an accountId with RTDB-structural characters is refused (400)"
    );
    const badSince = await handleUnifiedHistoryRequest(
        historyRequest(`?accountId=${ACCOUNT_ID}&since=abc`),
        makeDeps(validation, USER)
    );
    s.check(badSince.status === 400, "a non-numeric since is refused (400)");
    const withSince = await handleUnifiedHistoryRequest(
        historyRequest(`?accountId=${ACCOUNT_ID}&since=0`),
        makeDeps(validation, USER)
    );
    s.check(withSince.status === 200, "a valid since is accepted (200)");

    return s.finish();
}
