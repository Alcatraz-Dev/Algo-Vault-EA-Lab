/**
 * Timeout reconciliation (service level).
 *
 * Invariants under test:
 * - A provider timeout settles UNKNOWN (HTTP 504, code EXECUTION_TIMEOUT), never
 *   a confirmed failure and never a fill.
 * - An UNKNOWN request is reconciled against the authoritative history on every
 *   replay. Only a FILLED order WITH a broker ticket, or a REJECTED order, is
 *   evidence. An acknowledgment, a missing order, stale history, or truncated
 *   history is NOT evidence and leaves the outcome UNKNOWN.
 * - The provider is never called again for an UNKNOWN request (no resend).
 * - The original clientRequestId is preserved across every replay.
 *
 * Adapter, history, and store are scripted in memory. No network, no live MT5.
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { TradingProviderRegistry, type TradingProviderAdapter, type TradingResult } from "@/lib/trading/unified/adapter";
import { UnifiedTradingService, type ExecuteInput } from "@/lib/trading/unified/service";
import { tradingError } from "@/lib/trading/unified/errors";
import type {
    TradingAccount,
    TradingExecutionResult,
    TradingHistory,
    TradingOrder,
    TradingOrderState,
    TradingPosition,
} from "@/lib/trading/unified/domain";
import { createFakeStore } from "./fakes";

const NOW = 1_700_000_000_000;
const USER = "user-recon";
const ACCOUNT_ID = "gateway_777002";

const account: TradingAccount = {
    id: ACCOUNT_ID,
    userId: USER,
    provider: "MT5",
    environment: "DEMO",
    externalAccountId: "777002",
    brokerName: "Demo Broker",
    serverName: "Demo-Server",
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
        updatedAt: NOW,
    },
    connectedAt: NOW,
    lastHeartbeatAt: NOW,
    lastSyncAt: NOW,
    connectionError: null,
    gatewayVersion: "1.3.0",
} as TradingAccount;

function historyOrder(id: string, state: TradingOrderState, providerRef: string | null): TradingOrder {
    return {
        id,
        accountId: ACCOUNT_ID,
        provider: "MT5",
        symbol: "EURUSD",
        kind: "MARKET",
        side: "BUY",
        volume: 0.1,
        price: 1.1,
        stopLoss: null,
        takeProfit: null,
        state,
        createdAt: NOW,
        filledAt: state === "FILLED" ? NOW : null,
        magicNumber: null,
        comment: null,
        providerRef,
    };
}

type HistoryScript =
    | { kind: "ok"; orders: TradingOrder[]; truncated?: boolean }
    | { kind: "stale" };

/** Scripted provider: first execute times out; history answers follow the script. */
function createScriptedProvider() {
    const state = {
        executeCalls: 0,
        executeMode: "TIMEOUT" as "TIMEOUT" | "ACCEPTED",
        positions: [] as TradingPosition[],
        history: { kind: "ok", orders: [] } as HistoryScript,
    };
    const adapter: TradingProviderAdapter = {
        provider: "MT5",
        descriptor: {
            provider: "MT5",
            environments: ["DEMO"],
            available: true,
            operational: true,
            label: "MT5 reconciliation stub",
            note: null,
        },
        matchesAccountId: (accountId: string) => accountId.startsWith("gateway_"),
        healthCheck: async () => ({ ok: true, value: { status: "ONLINE" as const, checkedAt: NOW } }),
        getConnectionStatus: async () => ({ ok: false, error: tradingError("ACCOUNT_NOT_FOUND", "stub") }),
        getAccount: async (userId: string, accountId: string): Promise<TradingResult<TradingAccount>> =>
            userId === USER && accountId === ACCOUNT_ID
                ? { ok: true, value: account }
                : { ok: false, error: tradingError("ACCOUNT_NOT_FOUND", "Account is not registered for this user.") },
        getPositions: async () => ({ ok: true, value: state.positions }),
        getOrders: async () => ({ ok: true, value: [] }),
        getDeals: async () => ({ ok: true, value: [] }),
        getHistory: async (): Promise<TradingResult<TradingHistory>> => {
            if (state.history.kind === "stale") {
                return { ok: false, error: tradingError("PROVIDER_STALE", "The MetaTrader 5 gateway heartbeat is stale.") };
            }
            return {
                ok: true,
                value: { deals: [], orders: state.history.orders, truncated: state.history.truncated ?? false },
            };
        },
        getSymbols: async () => ({ ok: true, value: [] }),
        getQuote: async () => ({ ok: false, error: tradingError("UNSUPPORTED_OPERATION", "stub") }),
        getQuotes: async () => ({ ok: true, value: [] }),
        getCandles: async () => ({ ok: true, value: [] }),
        execute: async (input) => {
            state.executeCalls += 1;
            if (state.executeMode === "ACCEPTED") {
                // The command is durable and queued; no outcome is confirmed yet.
                return {
                    ok: true,
                    value: {
                        clientRequestId: input.request.clientRequestId,
                        correlationId: input.request.correlationId,
                        accountId: ACCOUNT_ID,
                        provider: "MT5",
                        environment: "DEMO",
                        executionType: input.request.executionType,
                        status: "ACCEPTED",
                        providerRef: null,
                        filledVolume: null,
                        filledPrice: null,
                        order: null,
                        position: null,
                        error: null,
                        duplicate: false,
                        createdAt: NOW,
                        completedAt: NOW,
                    } as TradingExecutionResult,
                };
            }
            // The broker never answered in time: the outcome is unknown.
            return { ok: false, error: tradingError("EXECUTION_TIMEOUT", "The provider did not confirm the execution in time.") };
        },
    };
    return { adapter, state };
}

function createHarness() {
    const store = createFakeStore();
    const provider = createScriptedProvider();
    const service = new UnifiedTradingService({
        registry: new TradingProviderRegistry([provider.adapter]),
        idempotency: store.idempotency,
        persistResult: store.persistResult,
        resolveUnknown: store.resolveUnknown,
        targetLocks: store.targetLocks,
        persistAccount: store.persistAccount,
        audit: store.audit,
        entitlement: async () => true,
        now: () => NOW,
    });
    return { store, provider, service };
}

function orderInput(clientRequestId: string): ExecuteInput {
    return {
        userId: USER,
        accountId: ACCOUNT_ID,
        clientRequestId,
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.1,
    };
}

function openPosition(id: string): TradingPosition {
    return {
        id,
        accountId: ACCOUNT_ID,
        provider: "MT5",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.2,
        entryPrice: 1.1,
        currentPrice: 1.1,
        stopLoss: null,
        takeProfit: null,
        profit: 0,
        swap: 0,
        commission: 0,
        openedAt: NOW,
        magicNumber: null,
        comment: null,
        providerRef: id,
    };
}

export async function runReconciliationTests(): Promise<boolean> {
    const s = createSuite("reconciliation");

    // ── Timeout → UNKNOWN ────────────────────────────────────────────────────
    {
        const { store, provider, service } = createHarness();
        const first = await service.execute(orderInput("req-recon-timeout"));

        s.section("Timeout settles UNKNOWN, never FAILED or a fill");
        s.check(first.result.status === "UNKNOWN", "a provider timeout is an UNKNOWN outcome");
        s.check(first.httpStatus === 504, "the UNKNOWN outcome keeps HTTP 504");
        s.check(first.result.error?.code === "EXECUTION_TIMEOUT", "the original timeout reason (EXECUTION_TIMEOUT) is preserved");
        s.check(first.result.clientRequestId === "req-recon-timeout", "the original clientRequestId is preserved on the outcome");
        s.check(first.result.status !== "SUCCEEDED" && first.result.providerRef === null, "an UNKNOWN outcome claims no fill and no ticket");
        s.check(provider.state.executeCalls === 1, "exactly one provider dispatch for the timed-out request");
        s.check(
            store.auditLog().some((e) => e.action === "EXECUTION_UNKNOWN" && e.clientRequestId === "req-recon-timeout"),
            "the timeout is audited as EXECUTION_UNKNOWN"
        );
    }

    // ── Timeout → confirmed fill ─────────────────────────────────────────────
    {
        const { store, provider, service } = createHarness();
        await service.execute(orderInput("req-recon-fill"));
        provider.state.history = { kind: "ok", orders: [historyOrder("req-recon-fill", "FILLED", "TICKET-7001")] };

        s.section("Timeout followed by a confirmed fill");
        const replay = await service.execute(orderInput("req-recon-fill"));
        s.check(replay.result.status === "SUCCEEDED", "a FILLED order with a broker ticket resolves the UNKNOWN to SUCCEEDED");
        s.check(replay.result.providerRef === "TICKET-7001", "the resolved outcome carries the broker ticket");
        s.check(replay.httpStatus === 200, "the resolved outcome is HTTP 200");
        s.check(replay.result.duplicate === true, "the resolution is reported as a replay, not a new execution");
        s.check(provider.state.executeCalls === 1, "resolving a fill never dispatches the order again");
        s.check(
            store.resultLog().filter((r) => r.clientRequestId === "req-recon-fill").length === 1,
            "one canonical result per request after resolution"
        );
        s.check(
            store.resultLog().some((r) => r.clientRequestId === "req-recon-fill" && r.status === "SUCCEEDED"),
            "the resolved SUCCEEDED state is persisted"
        );

        const again = await service.execute(orderInput("req-recon-fill"));
        s.check(again.result.status === "SUCCEEDED" && again.httpStatus === 200, "a settled fill stays SUCCEEDED on later replays");
        s.check(provider.state.executeCalls === 1, "later replays of a settled fill still never dispatch");
    }

    // ── Timeout → confirmed rejection ────────────────────────────────────────
    {
        const { provider, service } = createHarness();
        await service.execute(orderInput("req-recon-reject"));
        provider.state.history = { kind: "ok", orders: [historyOrder("req-recon-reject", "REJECTED", null)] };

        s.section("Timeout followed by a confirmed rejection");
        const replay = await service.execute(orderInput("req-recon-reject"));
        s.check(replay.result.status === "REJECTED", "a REJECTED history order resolves the UNKNOWN to REJECTED");
        s.check(replay.result.error?.code === "ORDER_REJECTED", "a confirmed rejection carries ORDER_REJECTED");
        s.check(replay.httpStatus === 200, "a settled rejection is replayed with the existing 200 terminal-replay status, not an unknown 504");
        s.check(replay.result.duplicate === true, "the confirmed rejection is reported as a replay of the original request");
        s.check(provider.state.executeCalls === 1, "a confirmed rejection is never resent");
    }

    // ── Delayed acknowledgment is not proof ──────────────────────────────────
    {
        const { provider, service } = createHarness();
        await service.execute(orderInput("req-recon-ack"));
        provider.state.history = { kind: "ok", orders: [historyOrder("req-recon-ack", "SUBMITTED", null)] };

        s.section("Delayed acknowledgment does not resolve the outcome");
        const replay = await service.execute(orderInput("req-recon-ack"));
        s.check(replay.result.status === "UNKNOWN", "an acknowledged-only order stays UNKNOWN");
        s.check(replay.httpStatus === 504, "the unresolved outcome remains HTTP 504");
        s.check(provider.state.executeCalls === 1, "an acknowledgment never causes a resend");
    }

    // ── Lost acknowledgment after execution ──────────────────────────────────
    {
        const { provider, service } = createHarness();
        await service.execute(orderInput("req-recon-lost"));
        // The order filled on the broker, but the report never reached us: no ticket.
        provider.state.history = { kind: "ok", orders: [historyOrder("req-recon-lost", "FILLED", null)] };

        s.section("Lost acknowledgment after execution");
        const replay = await service.execute(orderInput("req-recon-lost"));
        s.check(replay.result.status === "UNKNOWN", "a FILLED order without a broker ticket is not resolved to SUCCEEDED");
        s.check(replay.result.providerRef === null, "no ticket is fabricated for a lost acknowledgment");
        s.check(provider.state.executeCalls === 1, "a lost acknowledgment never causes a resend");
    }

    // ── Incomplete and stale reconciliation data ─────────────────────────────
    {
        const { provider, service } = createHarness();
        await service.execute(orderInput("req-recon-stale"));
        provider.state.history = { kind: "stale" };

        s.section("Stale gateway data is never evidence");
        const staleReplay = await service.execute(orderInput("req-recon-stale"));
        s.check(staleReplay.result.status === "UNKNOWN" && staleReplay.httpStatus === 504, "stale history keeps the outcome UNKNOWN");
        s.check(provider.state.executeCalls === 1, "stale history never causes a resend");

        s.section("Absence is not proof when history is incomplete");
        await service.execute(orderInput("req-recon-trunc"));
        provider.state.history = { kind: "ok", orders: [], truncated: true };
        const truncatedReplay = await service.execute(orderInput("req-recon-trunc"));
        s.check(truncatedReplay.result.status === "UNKNOWN", "a missing order in truncated history stays UNKNOWN");
        s.check(truncatedReplay.result.status !== "REJECTED", "a missing order is never inferred as rejected");
        s.check(provider.state.executeCalls === 2, "truncated history never causes a resend");
    }

    // ── Reconnection and status recovery ─────────────────────────────────────
    {
        const { provider, service } = createHarness();
        await service.execute(orderInput("req-recon-recover"));
        provider.state.history = { kind: "stale" };
        const offline = await service.execute(orderInput("req-recon-recover"));
        s.check(offline.result.status === "UNKNOWN", "while the gateway is offline the outcome stays UNKNOWN");

        provider.state.history = { kind: "ok", orders: [historyOrder("req-recon-recover", "FILLED", "TICKET-7100")] };
        const recovered = await service.execute(orderInput("req-recon-recover"));
        s.check(recovered.result.status === "SUCCEEDED", "after reconnection the next replay resolves the fill");
        s.check(recovered.result.providerRef === "TICKET-7100", "recovery reports the broker ticket from history");
        s.check(provider.state.executeCalls === 1, "recovery reconciles without ever resending the order");
    }

    // ── Duplicate attempts while UNKNOWN ─────────────────────────────────────
    {
        const { store, provider, service } = createHarness();
        await service.execute(orderInput("req-recon-dup"));
        for (let i = 0; i < 3; i += 1) {
            const attempt = await service.execute(orderInput("req-recon-dup"));
            s.check(attempt.result.status === "UNKNOWN" && attempt.result.duplicate === true, `duplicate attempt ${i + 1} replays the UNKNOWN outcome`);
        }
        s.section("Duplicate attempts while the outcome is UNKNOWN");
        s.check(provider.state.executeCalls === 1, "repeated attempts while UNKNOWN never reach the provider");
        s.check(
            store.resultLog().filter((r) => r.clientRequestId === "req-recon-dup").length === 1,
            "repeated attempts never create a second canonical result"
        );
    }

    // ── Different payload under the same key is still rejected ───────────────
    {
        const { provider, service } = createHarness();
        await service.execute(orderInput("req-recon-conflict"));
        const conflicting = await service.execute({ ...orderInput("req-recon-conflict"), volume: 0.2 });
        s.section("Key reuse with a different payload");
        s.check(conflicting.result.error?.code === "DUPLICATE_REQUEST", "a different payload under the same key is rejected");
        s.check(provider.state.executeCalls === 1, "a conflicting payload never dispatches a second order");
    }

    // ── Backward compatibility of the timeout representation ─────────────────
    {
        const { service } = createHarness();
        const outcome = await service.execute(orderInput("req-recon-compat"));
        s.section("Backward compatibility for existing API consumers");
        s.check(outcome.httpStatus === 504, "existing clients still see HTTP 504 for a timeout");
        s.check(outcome.result.error?.code === "EXECUTION_TIMEOUT", "existing clients still key on the EXECUTION_TIMEOUT code");
        s.check(outcome.result.executionType === "PLACE_ORDER", "the execution type is preserved on the outcome");
    }

    // ── Management actions: one outstanding outcome per position ─────────────
    {
        const { provider, service } = createHarness();
        provider.state.positions = [openPosition("POS-901")];
        const closeInput = (clientRequestId: string): ExecuteInput => ({
            userId: USER,
            accountId: ACCOUNT_ID,
            clientRequestId,
            executionType: "CLOSE_POSITION",
            positionId: "POS-901",
        });
        const first = await service.execute(closeInput("req-close-1"));
        s.section("Close and modify share one outcome lock per position");
        s.check(first.result.status === "UNKNOWN", "the first close times out as UNKNOWN");

        const second = await service.execute(closeInput("req-close-2"));
        s.check(second.result.error?.code === "DUPLICATE_REQUEST", "a second close with a new request id is refused while the first is UNKNOWN");
        s.check(second.httpStatus === 409, "the target-lock refusal is HTTP 409 DUPLICATE_REQUEST");
        s.check(second.result.status === "REJECTED", "the refused close settles REJECTED because it was never sent");

        const modify = await service.execute({
            ...closeInput("req-modify-1"),
            executionType: "MODIFY_POSITION",
            stopLoss: 1.09,
        });
        s.check(modify.result.error?.code === "DUPLICATE_REQUEST" && modify.httpStatus === 409, "a modify on the same position is refused with HTTP 409 DUPLICATE_REQUEST while the close is UNKNOWN");
        s.check(provider.state.executeCalls === 1, "only the first management action reaches the provider");

        const replay = await service.execute(closeInput("req-close-1"));
        s.check(replay.result.status === "UNKNOWN" && replay.result.duplicate === true, "replaying the original close keeps its UNKNOWN outcome");
        s.check(provider.state.executeCalls === 1, "replaying the original close never resends it");

        const entry = await service.execute(orderInput("req-entry-while-locked"));
        s.check(entry.result.error?.code !== "DUPLICATE_REQUEST", "new entries are not blocked by a position lock");
        s.check(provider.state.executeCalls === 2, "the entry is dispatched normally");
    }

    // ── Queued (ACCEPTED) close is unresolved and keeps the position locked ──
    {
        const { store, provider, service } = createHarness();
        provider.state.positions = [openPosition("POS-905")];
        provider.state.executeMode = "ACCEPTED";
        const closeInput = (clientRequestId: string): ExecuteInput => ({
            userId: USER,
            accountId: ACCOUNT_ID,
            clientRequestId,
            executionType: "CLOSE_POSITION",
            positionId: "POS-905",
        });
        const queued = await service.execute(closeInput("req-queued-close"));
        s.section("A queued (ACCEPTED) close is unresolved and blocks duplicates");
        s.check(queued.result.status === "ACCEPTED" && queued.httpStatus === 202, "the queued close is ACCEPTED (202), not settled");
        s.check(provider.state.executeCalls === 1, "the queued close was dispatched once");

        const duplicate = await service.execute(closeInput("req-queued-close-2"));
        s.check(duplicate.result.error?.code === "DUPLICATE_REQUEST", "a second close with a new request id is refused while the queued close is unresolved");
        s.check(provider.state.executeCalls === 1, "the duplicate close is never dispatched");

        const replay = await service.execute(closeInput("req-queued-close"));
        s.check(
            replay.result.status === "ACCEPTED" && replay.httpStatus === 202 && replay.result.duplicate === true,
            "replaying the queued close returns the still-pending ACCEPTED (202), not a settled outcome"
        );
        s.check(provider.state.executeCalls === 1, "replaying the queued close never dispatches it again");

        // A definitive terminal result releases the lock for the next close.
        await store.persistResult(USER, {
            ...queued.result,
            status: "SUCCEEDED",
            error: null,
            completedAt: Date.now(),
        });
        const settledReplay = await service.execute(closeInput("req-queued-close"));
        s.check(settledReplay.result.status === "SUCCEEDED" && settledReplay.httpStatus === 200, "the replay reports the confirmed terminal result");
        const afterSettle = await service.execute(closeInput("req-after-settle"));
        s.check(afterSettle.result.error?.code !== "DUPLICATE_REQUEST", "a confirmed terminal result releases the position lock");
        s.check(provider.state.executeCalls === 2, "the next close is dispatched only after the terminal result");
    }

    // ── Stale lock: a settled owner whose release was lost ───────────────────
    {
        const { store, provider, service } = createHarness();
        provider.state.positions = [openPosition("POS-903")];
        await store.targetLocks.claim(USER, ACCOUNT_ID, "POS-903", "req-stale-owner");
        await store.persistResult(USER, {
            clientRequestId: "req-stale-owner",
            correlationId: "corr-stale",
            accountId: ACCOUNT_ID,
            provider: "MT5",
            environment: "DEMO",
            executionType: "CLOSE_POSITION",
            status: "FAILED",
            providerRef: null,
            filledVolume: null,
            filledPrice: null,
            order: null,
            position: null,
            error: tradingError("INVALID_REQUEST", "stub"),
            duplicate: false,
            createdAt: NOW,
            completedAt: NOW,
        } as TradingExecutionResult);
        const next = await service.execute({
            userId: USER,
            accountId: ACCOUNT_ID,
            clientRequestId: "req-after-stale",
            executionType: "CLOSE_POSITION",
            positionId: "POS-903",
        });
        s.section("A settled owner never blocks the position");
        s.check(provider.state.executeCalls === 1 && next.result.error?.code !== "DUPLICATE_REQUEST", "a stale lock from a settled owner is freed and the close is dispatched");
    }

    return s.finish();
}
