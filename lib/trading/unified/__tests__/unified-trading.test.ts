import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { TradingProviderRegistry } from "@/lib/trading/unified/adapter";
import { MockTradingProvider } from "@/lib/trading/unified/mock-provider";
import { UnifiedTradingService } from "@/lib/trading/unified/service";
import { planPartialClose, proportionalProfit, roundVolume, VolumeError } from "@/lib/trading/unified/volume";
import { mapMt5Retcode, tradingError } from "@/lib/trading/unified/errors";
import { classifyMt5Environment } from "@/lib/trading/unified/mt5-demo-provider";
import type { TradingProviderAdapter, TradingResult } from "@/lib/trading/unified/adapter";
import type { TradingAccount } from "@/lib/trading/unified/domain";
import { hashRequest } from "@/lib/trading/unified/store";
import type { TradingExecutionResult, TradingPosition } from "@/lib/trading/unified/domain";
import type { AuditEventInput } from "./fakes";
import { createFakeStore } from "./fakes";

function withEnv<T>(name: string, value: string | undefined, run: () => T): T {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try {
        return run();
    } finally {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
    }
}

/** Reads a mock read without an unsafe cast at the call site. */
async function readPositions(
    provider: MockTradingProvider,
    userId: string,
    accountId: string
): Promise<TradingPosition[]> {
    const result = await provider.getPositions(userId, accountId);
    return result.ok ? result.value : [];
}

export async function runUnifiedTradingTests(): Promise<boolean> {
    const s = createSuite("unified-trading-service");
    const now = 1_700_000_000_000;

    const provider = new MockTradingProvider({ clock: () => now, userId: "user-1" });
    const store = createFakeStore();
    const registry = new TradingProviderRegistry([provider]);
    const shared = {
        idempotency: store.idempotency,
        persistResult: store.persistResult,
        persistAccount: store.persistAccount,
        audit: store.audit,
        // Licensed by default; the license-gate section injects a denying
        // probe to prove the gate is enforced server-side.
        entitlement: async () => true,
        now: () => now,
    };
    const service = new UnifiedTradingService({ registry, ...shared });
    /**
     * Exercises the MT5 flag path without touching RTDB: a stub adapter that
     * owns the `gateway_` namespace and reports no registered account.
     */
    const mt5Stub: TradingProviderAdapter = {
        provider: "MT5",
        descriptor: {
            provider: "MT5",
            environments: ["DEMO"],
            available: true,
            operational: false,
            label: "MT5 stub",
            note: null,
        },
        matchesAccountId: (accountId: string) => accountId.startsWith("gateway_"),
        healthCheck: async () => ({ ok: true, value: { status: "ONLINE" as const, checkedAt: now } }),
        getConnectionStatus: async () => ({ ok: false, error: tradingError("ACCOUNT_NOT_FOUND", "stub") }),
        getAccount: async (): Promise<TradingResult<TradingAccount>> => ({
            ok: false,
            error: tradingError("ACCOUNT_NOT_FOUND", "Account is not registered for this user."),
        }),
        getPositions: async () => ({ ok: true, value: [] }),
        getOrders: async () => ({ ok: true, value: [] }),
        getDeals: async () => ({ ok: true, value: [] }),
        getHistory: async () => ({ ok: true, value: { deals: [], orders: [], truncated: false } }),
        getSymbols: async () => ({ ok: true, value: [] }),
        getQuote: async () => ({ ok: false, error: tradingError("UNSUPPORTED_OPERATION", "stub") }),
        getQuotes: async () => ({ ok: true, value: [] }),
        getCandles: async () => ({ ok: true, value: [] }),
        execute: async () => ({ ok: false, error: tradingError("PROVIDER_NOT_CONFIGURED", "stub") }),
    };
    const mt5Service = new UnifiedTradingService({
        registry: new TradingProviderRegistry([mt5Stub]),
        ...shared,
    });

    /**
     * MT5 adapter stub that owns the `gateway_` namespace and reports a healthy
     * DEMO account. Its `execute` reproduces the verification race: the broker
     * confirms the fill (ticket + price) before the synced position mirror
     * exists. The service must surface EXECUTED_PENDING_SYNC, never FAILED.
     */
    const syncStore = createFakeStore();
    let syncMode: "PENDING_SYNC" | "TRANSPORT_FAIL" = "PENDING_SYNC";
    const syncAccount: TradingAccount = {
        id: "gateway_777001",
        userId: "user-sync",
        provider: "MT5",
        environment: "DEMO",
        externalAccountId: "777001",
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
            updatedAt: now,
        },
        connectedAt: now,
        lastHeartbeatAt: now,
        lastSyncAt: now,
        connectionError: null,
        gatewayVersion: "1.3.0",
    };
    /** Counts real provider executions — proves idempotency never re-executes. */
    let syncExecuteCalls = 0;
    const syncStub: TradingProviderAdapter = {
        provider: "MT5",
        descriptor: {
            provider: "MT5",
            environments: ["DEMO"],
            available: true,
            operational: true,
            label: "MT5 pending-sync stub",
            note: null,
        },
        matchesAccountId: (accountId: string) => accountId.startsWith("gateway_"),
        healthCheck: async () => ({ ok: true, value: { status: "ONLINE" as const, checkedAt: now } }),
        getConnectionStatus: async () => ({ ok: false, error: tradingError("ACCOUNT_NOT_FOUND", "stub") }),
        getAccount: async (userId: string, accountId: string): Promise<TradingResult<TradingAccount>> =>
            userId === "user-sync" && accountId === "gateway_777001"
                ? { ok: true, value: syncAccount }
                : { ok: false, error: tradingError("ACCOUNT_NOT_FOUND", "Account is not registered for this user.") },
        getPositions: async () => ({ ok: true, value: [] }),
        getOrders: async () => ({ ok: true, value: [] }),
        getDeals: async () => ({ ok: true, value: [] }),
        getHistory: async () => ({ ok: true, value: { deals: [], orders: [], truncated: false } }),
        getSymbols: async () => ({ ok: true, value: [] }),
        getQuote: async () => ({ ok: false, error: tradingError("UNSUPPORTED_OPERATION", "stub") }),
        getQuotes: async () => ({ ok: true, value: [] }),
        getCandles: async () => ({ ok: true, value: [] }),
        execute: async ({ request }) => {
            syncExecuteCalls += 1;
            if (syncMode === "TRANSPORT_FAIL") {
                return { ok: false, error: tradingError("PROVIDER_UNAVAILABLE", "Gateway link dropped before dispatch.") };
            }
            return {
                ok: true,
                value: {
                    clientRequestId: request.clientRequestId,
                    correlationId: request.correlationId,
                    accountId: request.accountId,
                    provider: "MT5" as const,
                    environment: request.environment,
                    executionType: request.executionType,
                    status: "EXECUTED_PENDING_SYNC" as const,
                    providerRef: "TICKET-9001",
                    filledVolume: request.volume ?? null,
                    filledPrice: 1.10123,
                    order: null,
                    position: null,
                    error: tradingError(
                        "EXECUTION_TIMEOUT",
                        "Executed on the broker but the account snapshot has not synced yet. The position will appear shortly."
                    ),
                    duplicate: false,
                    createdAt: now,
                    completedAt: now,
                },
            };
        },
    };
    const syncService = new UnifiedTradingService({
        registry: new TradingProviderRegistry([syncStub]),
        idempotency: syncStore.idempotency,
        persistResult: syncStore.persistResult,
        persistAccount: syncStore.persistAccount,
        audit: syncStore.audit,
        entitlement: async () => true,
        now: () => now,
    });

    const base = {
        userId: "user-1",
        accountId: "mock-account",
        clientRequestId: "req-0001",
    };

    s.section("Provider registry is explicit — no silent fallback");
    s.check(registry.has("MT5" as never) === false, "MT5 is absent until an adapter is registered");
    const missing = service.listProviders();
    s.check(missing.length === 1 && missing[0].operational === false, "mock provider is listed as non-operational");
    const unregistered = new UnifiedTradingService({ registry: new TradingProviderRegistry(), ...{} });
    const unknownProvider = await unregistered.getAccount("user-1", "mock-account");
    s.check(!unknownProvider.ok && unknownProvider.error.code === "PROVIDER_NOT_CONFIGURED", "unregistered provider fails closed");

    s.section("Demo-only enforcement (server-side, not client-supplied)");
    const liveClient = await service.execute({ ...base, executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, environment: "LIVE" });
    s.check(liveClient.result.error?.code === "LIVE_EXECUTION_DISABLED" && liveClient.httpStatus === 403, "a client-sent environment=LIVE is rejected");
    s.check(store.auditLog().some((e) => e.errorCode === "LIVE_EXECUTION_DISABLED"), "the rejection is audited");
    provider.grantAccount("user-live", "live-account", "LIVE", 10_000);
    const liveAccount = await service.execute({ userId: "user-live", accountId: "live-account", clientRequestId: "req-live-account", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 });
    s.check(liveAccount.result.error?.code === "LIVE_EXECUTION_DISABLED" && liveAccount.httpStatus === 403, "an account classified LIVE is refused even without a client environment hint");
    s.check(!store.resultLog().some((r) => r.clientRequestId === "req-live-account"), "no LIVE order was ever sent to the provider");

    const noEnvFlag = await withEnv("MT5_DEMO_ENABLED", "false", () =>
        mt5Service.execute({ ...base, clientRequestId: "req-flag", accountId: "gateway_900001", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 })
    );
    s.check(noEnvFlag.result.error?.code === "PROVIDER_UNAVAILABLE", "MT5_DEMO_ENABLED=false blocks MT5 execution");
    const mt5ReachesProvider = await withEnv("MT5_DEMO_ENABLED", "true", () =>
        mt5Service.execute({ ...base, clientRequestId: "req-flag-2", accountId: "gateway_900001", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 })
    );
    s.check(
        mt5ReachesProvider.result.error?.code === "ACCOUNT_NOT_FOUND" || mt5ReachesProvider.result.error?.code === "ACCOUNT_NOT_CONNECTED",
        "with the flag on, an unregistered MT5 account fails at ownership, not at the flag"
    );
    const tradingOff = await withEnv("UNIFIED_TRADING_ENABLED", "false", () =>
        service.execute({ ...base, clientRequestId: "req-off", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 })
    );
    s.check(tradingOff.result.error?.code === "TRADING_DISABLED", "UNIFIED_TRADING_ENABLED=false blocks execution");

    s.section("Authentication and account ownership");
    const unauthenticated = await service.execute({ ...base, userId: "", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 });
    s.check(unauthenticated.result.error?.code === "PERMISSION_DENIED", "missing user id is denied");
    const notOwned = await service.getAccount("intruder", "mock-account");
    s.check(!notOwned.ok && notOwned.error.code === "ACCOUNT_NOT_FOUND", "another user's account id is not readable");

    s.section("Trading-access license gate (server-side entitlement)");
    const unlicensedService = new UnifiedTradingService({
        registry,
        ...shared,
        entitlement: async () => false,
    });
    const unlicensed = await unlicensedService.execute({ ...base, clientRequestId: "req-unlicensed", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 });
    s.check(unlicensed.result.error?.code === "PERMISSION_DENIED" && unlicensed.httpStatus === 403, "an unlicensed user is denied execution");
    s.check(
        store.auditLog().some((e) => e.action === "CONNECTION_REJECTED" && e.errorCode === "PERMISSION_DENIED"),
        "the denial is audited as CONNECTION_REJECTED"
    );
    s.check(!store.resultLog().some((r) => r.clientRequestId === "req-unlicensed"), "a denied request never reaches the provider or persists a result");

    s.section("Market order end-to-end against the mock provider");
    const placed = await service.execute({ ...base, executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, stopLoss: 1.09, takeProfit: 1.12 });
    s.check(placed.result.status === "SUCCEEDED" && placed.result.position !== null, "market buy produces a provider position");
    s.check(placed.result.providerRef !== null && placed.result.filledVolume === 0.1, "provider reference and filled volume are reported");
    const positionId = placed.result.position?.id ?? "";
    s.check(store.resultLog().length === 1 && store.resultLog()[0].status === "SUCCEEDED", "the execution result is persisted");

    const sellFixture = "sell-account";
    provider.grantAccount("user-sell", sellFixture, "DEMO", 10_000);
    const sellPlaced = await service.execute({
        userId: "user-sell",
        accountId: sellFixture,
        clientRequestId: "req-sell",
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "SELL",
        volume: 0.1,
    });
    s.check(sellPlaced.result.status === "SUCCEEDED" && sellPlaced.result.position?.side === "SELL", "a sell market order produces a SELL position");
    s.check(sellPlaced.result.filledVolume === 0.1, "the sell reports its filled volume");

    s.section("Idempotency — a duplicate request never creates a second trade");
    const duplicate = await service.execute({ ...base, executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, stopLoss: 1.09, takeProfit: 1.12 });
    s.check(duplicate.result.duplicate === true && duplicate.result.status === "SUCCEEDED", "the original result is replayed");
    s.check(duplicate.result.providerRef === placed.result.providerRef, "the replay carries the original provider reference");
    s.check((await readPositions(provider, "user-1", "mock-account")).length === 1, "no second position was created");
    const conflict = await service.execute({ ...base, executionType: "PLACE_ORDER", symbol: "EURUSD", side: "SELL", volume: 0.1 });
    s.check(conflict.result.error?.code === "DUPLICATE_REQUEST", "reusing a key with a different payload is rejected");
    const inflight = await service.execute({ ...base, clientRequestId: "req-inflight", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, stopLoss: 1.09 });
    s.check(inflight.result.status === "SUCCEEDED", "a distinct request executes normally");
    s.check(inflight.result.providerRef !== placed.result.providerRef, "a distinct request produces its own trade");
    store.markInFlight("user-1", "req-pending");
    const inflightDup = await service.execute({ ...base, clientRequestId: "req-pending", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 });
    s.check(inflightDup.result.error?.code === "DUPLICATE_REQUEST", "an in-flight duplicate is refused, not re-sent");
    s.check(hashRequest({ userId: "a", accountId: "b", provider: "MT5", environment: "DEMO", executionType: "PLACE_ORDER", symbol: "X" }) !== hashRequest({ userId: "a", accountId: "b", provider: "MT5", environment: "DEMO", executionType: "PLACE_ORDER", symbol: "Y" }), "payload differences change the request hash");

    s.section("Position and order retrieval");
    const positions = await service.getPositions("user-1", "mock-account");
    s.check(
        positions.ok && positions.value.length === 2 && positions.value.every((p) => p.symbol === "EURUSD"),
        "both legitimate positions are readable; duplicates and conflicts created none"
    );
    const account = await service.getAccount("user-1", "mock-account");
    s.check(account.ok && account.value.metrics.balance !== null && account.value.environment === "DEMO", "account metrics and environment are normalized");
    s.check(store.accountLog().some((a) => a.providerStatus === "ONLINE"), "the unified account projection is written");

    s.section("Modify SL/TP");
    const secondPositionId = inflight.result.position?.id ?? "";
    const modified = await service.execute({ ...base, clientRequestId: "req-modify", executionType: "MODIFY_POSITION", positionId, stopLoss: 1.095, takeProfit: 1.13 });
    s.check(modified.result.status === "SUCCEEDED" && modified.result.position?.stopLoss === 1.095, "SL/TP modification is applied");
    const missingPosition = await service.execute({ ...base, clientRequestId: "req-missing", executionType: "MODIFY_POSITION", positionId: "does-not-exist", stopLoss: 1 });
    s.check(missingPosition.result.error?.code === "ACCOUNT_NOT_FOUND", "an unknown position fails closed");

    s.section("Partial close on a profitable position (volume, not P/L)");
    // Deterministic fixture: 1.00 lot, +100 floating.
    const fixtureAccount = "partial-account";
    provider.grantAccount("user-partial", fixtureAccount, "DEMO", 10_000);
    const seeded = provider.seedPosition({
        accountId: fixtureAccount,
        symbol: "EURUSD",
        side: "BUY",
        volume: 1,
        entryPrice: 1.1,
        currentPrice: 1.11,
        stopLoss: null,
        takeProfit: null,
        profit: 100,
        swap: 0,
        commission: 0,
        openedAt: now,
        magicNumber: 0,
        comment: null,
    });
    const partial = await service.execute({
        userId: "user-partial",
        accountId: fixtureAccount,
        clientRequestId: "req-partial-30",
        executionType: "PARTIAL_CLOSE",
        positionId: seeded.id,
        percentage: 30,
    });
    s.check(partial.result.status === "SUCCEEDED" && partial.result.filledVolume === 0.3, "30% of 1.00 lot closes 0.30 lot");
    const remaining = await readPositions(provider, "user-partial", fixtureAccount);
    s.check(remaining.length === 1, "the position remains open");
    s.check(remaining[0]?.volume === 0.7, "0.70 lot remains open");
    s.check(remaining[0]?.profit === 70, "the remainder keeps 70% of the floating P/L (+70)");
    const closeDeal = provider.dealList().filter((d) => d.comment?.includes("partial close")).at(-1);
    s.check(closeDeal?.volume === 0.3 && closeDeal?.profit === 30, "the realized deal is the closed portion (+30), never a synthetic loss");
    s.check(closeDeal?.profit !== -70 && closeDeal?.profit !== 100 - 30, "no artificial negative trade is created");

    // Percentage is % of CURRENT POSITION VOLUME — never of profit or balance.
    const halfAccount = "half-account";
    provider.grantAccount("user-half", halfAccount, "DEMO", 10_000);
    const halfSeeded = provider.seedPosition({
        accountId: halfAccount,
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.2,
        entryPrice: 1.1,
        currentPrice: 1.105,
        stopLoss: null,
        takeProfit: null,
        profit: 50,
        swap: 0,
        commission: 0,
        openedAt: now,
        magicNumber: 0,
        comment: null,
    });
    const half = await service.execute({
        userId: "user-half",
        accountId: halfAccount,
        clientRequestId: "req-partial-50-of-020",
        executionType: "PARTIAL_CLOSE",
        positionId: halfSeeded.id,
        percentage: 50,
    });
    s.check(half.result.status === "SUCCEEDED" && half.result.filledVolume === 0.1, "50% of a 0.20 lot position closes exactly 0.10 lot");
    const halfRemaining = await readPositions(provider, "user-half", halfAccount);
    s.check(halfRemaining.length === 1 && halfRemaining[0]?.volume === 0.1, "0.10 lot remains open");

    const zeroPct = await service.execute({ userId: "user-half", accountId: halfAccount, clientRequestId: "req-pct-zero", executionType: "PARTIAL_CLOSE", positionId: halfSeeded.id, percentage: 0 });
    s.check(zeroPct.result.status === "REJECTED" && zeroPct.result.error?.code === "INVALID_VOLUME", "a 0% partial close is rejected");
    const overPct = await service.execute({ userId: "user-half", accountId: halfAccount, clientRequestId: "req-pct-over", executionType: "PARTIAL_CLOSE", positionId: halfSeeded.id, percentage: 150 });
    s.check(overPct.result.status === "REJECTED" && overPct.result.error?.code === "INVALID_VOLUME", "a percentage above 100 is rejected");
    const missingPct = await service.execute({ userId: "user-half", accountId: halfAccount, clientRequestId: "req-pct-missing", executionType: "PARTIAL_CLOSE", positionId: halfSeeded.id });
    s.check(missingPct.result.status === "REJECTED" && missingPct.result.error?.code === "INVALID_REQUEST", "a partial close without a percentage is rejected");

    s.section("Partial close volume rounding and edge cases");
    const plan = planPartialClose({ openVolume: 0.37, percentage: 33, spec: { symbol: "X", minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, digits: 5 } });
    s.check(plan.closeVolume === 0.12 && plan.remainingVolume === 0.25, "0.37 lot at 33% closes 0.12 and leaves 0.25 (rounded down)");
    const tooSmall = planPartialClose({ openVolume: 0.02, percentage: 10, spec: { symbol: "X", minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, digits: 5 } });
    s.check(tooSmall.closesFully === true && tooSmall.closeVolume === 0.02, "a close below min volume settles into a full close instead of leaving a stub");
    const full = planPartialClose({ openVolume: 1, percentage: 100, spec: { symbol: "X", minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, digits: 5 } });
    s.check(full.remainingVolume === 0 && full.appliedPercentage === 100, "100% is a full close");
    let threw = false;
    try {
        planPartialClose({ openVolume: 1, percentage: 0 });
    } catch (error) {
        threw = error instanceof VolumeError && error.code === "INVALID_VOLUME";
    }
    s.check(threw, "a zero percentage is rejected");
    threw = false;
    try {
        planPartialClose({ openVolume: 1, percentage: 120 });
    } catch (error) {
        threw = error instanceof VolumeError;
    }
    s.check(threw, "a percentage above 100 is rejected");
    s.check(roundVolume(0.1234, { lotStep: 0.01 }) === 0.12, "volume rounds onto the provider lot step");
    s.check(proportionalProfit(100, 1, 0.3) === 30, "proportional P/L reporting matches the closed slice");

    s.section("Full close and pending-order cancel");
    const closed = await service.execute({ ...base, clientRequestId: "req-close", executionType: "CLOSE_POSITION", positionId });
    s.check(closed.result.status === "SUCCEEDED", "a position can be fully closed");
    const closedSecond = await service.execute({ ...base, clientRequestId: "req-close-2", executionType: "CLOSE_POSITION", positionId: secondPositionId });
    s.check(closedSecond.result.status === "SUCCEEDED", "the second position can be fully closed");
    const openAfterClose = await readPositions(provider, "user-1", "mock-account");
    s.check(openAfterClose.length === 0, "no position remains after full closes");

    const limit = await service.execute({ ...base, clientRequestId: "req-limit", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, kind: "LIMIT", price: 1.08 });
    s.check(limit.result.status === "SUCCEEDED" && limit.result.order?.state === "PENDING", "a pending limit order is created");
    const orderId = limit.result.order?.id ?? "";
    const cancelled = await service.execute({ ...base, clientRequestId: "req-cancel", executionType: "CANCEL_ORDER", orderId });
    s.check(cancelled.result.status === "SUCCEEDED" && cancelled.result.order?.state === "CANCELLED", "a pending order can be cancelled");

    s.section("Risk engine rejects invalid entries");
    const noSymbol = await service.execute({ ...base, clientRequestId: "req-nosymbol", executionType: "PLACE_ORDER", side: "BUY", volume: 0.1 });
    s.check(noSymbol.result.error?.code === "INVALID_REQUEST", "a missing symbol is rejected");
    const badVolume = await service.execute({ ...base, clientRequestId: "req-badvol", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0 });
    s.check(badVolume.result.error?.code === "INVALID_VOLUME", "a zero volume is rejected");
    const wrongSideSl = await service.execute({ ...base, clientRequestId: "req-sl-side", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, price: 1.1, stopLoss: 1.2 });
    s.check(wrongSideSl.result.error?.code === "RISK_REJECTED", "a stop loss on the wrong side of entry is risk-rejected");
    const providerReject = await service.execute({ ...base, clientRequestId: "req-unknown-symbol", executionType: "PLACE_ORDER", symbol: "NOPE", side: "BUY", volume: 0.1 });
    s.check(providerReject.result.status === "REJECTED" && providerReject.result.error?.code === "INVALID_SYMBOL", "an unavailable symbol is rejected by the provider");

    s.section("Stale and offline providers fail closed");
    provider.heartbeatAgeMs = 200_000;
    const stale = await service.execute({ ...base, clientRequestId: "req-stale", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, stopLoss: 1.09 });
    s.check(stale.result.error?.code === "PROVIDER_STALE" && stale.httpStatus === 409, "a stale heartbeat blocks execution");
    provider.heartbeatAgeMs = 0;
    provider.connectionOverride = "OFFLINE";
    const offline = await service.execute({ ...base, clientRequestId: "req-offline", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 });
    s.check(offline.result.error?.code === "ACCOUNT_NOT_CONNECTED", "a disconnected account blocks execution");
    s.check((await readPositions(provider, "user-1", "mock-account")).length === 0, "no trade was created while the provider was down");
    provider.connectionOverride = "ONLINE";

    s.section("Provider errors normalize; nothing is fabricated");
    provider.failNext(tradingError("INSUFFICIENT_MARGIN", "Not enough money."));
    const margin = await service.execute({ ...base, clientRequestId: "req-margin", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 });
    s.check(margin.result.status === "REJECTED" && margin.result.error?.code === "INSUFFICIENT_MARGIN", "a provider rejection is surfaced, never a fake fill");
    s.check(margin.result.position === null && margin.result.providerRef === null, "no position or ticket is invented on rejection");
    provider.failNext(tradingError("PROVIDER_UNAVAILABLE", "down"));
    const down = await service.execute({ ...base, clientRequestId: "req-down", executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1 });
    s.check(down.result.status === "REJECTED", "an unavailable provider never reports success");

    s.section("MT5 environment classification is conservative");
    s.check(classifyMt5Environment({ server: "ICMarketsSC-Demo" }) === "DEMO", "a demo server name classifies as DEMO");
    s.check(classifyMt5Environment({ server: "ICMarketsSC-Live" }) === "LIVE", "anything else classifies as LIVE");
    s.check(classifyMt5Environment({}) === "LIVE", "an unclassified account defaults to LIVE (fail closed)");
    s.check(mapMt5Retcode(10020) === "INSUFFICIENT_MARGIN", "TRADE_RETCODE_NO_MONEY maps to INSUFFICIENT_MARGIN");
    s.check(mapMt5Retcode(10019) === "MARKET_CLOSED", "TRADE_RETCODE_MARKET_CLOSED maps to MARKET_CLOSED");
    s.check(mapMt5Retcode(99999) === "UNKNOWN_PROVIDER_ERROR", "an unknown retcode collapses to UNKNOWN_PROVIDER_ERROR");

    s.section("Provider-confirmed fill before the snapshot syncs (the race fix)");
    const pending = await syncService.execute({
        userId: "user-sync",
        accountId: "gateway_777001",
        clientRequestId: "req-pending-sync",
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.1,
    });
    s.check(pending.result.status === "EXECUTED_PENDING_SYNC" && pending.httpStatus === 200, "a confirmed fill with a late snapshot is an outcome (200), never FAILED");
    s.check(pending.result.providerRef === "TICKET-9001" && pending.result.filledVolume === 0.1, "the broker ticket and filled volume are still reported");
    s.check(pending.result.error?.code === "EXECUTION_TIMEOUT", "the pending-sync outcome explains the sync delay without losing the fill");
    s.check(
        syncStore.auditLog().some((e) => e.action === "EXECUTION_PENDING_SYNC" && e.providerRef === "TICKET-9001"),
        "the pending-sync outcome is audited with the provider reference"
    );
    s.check(syncStore.resultLog().some((r) => r.status === "EXECUTED_PENDING_SYNC"), "the pending-sync result is persisted for reconciliation");
    s.check(syncExecuteCalls === 1, "exactly one provider execution for the pending-sync request");

    // Full lifecycle + observability: provider confirmed → position not yet
    // synced → PENDING_SYNC → HTTP 200 → audit → persisted result.
    const pendingLifecycle = syncStore.auditLog().filter((e) => e.clientRequestId === "req-pending-sync");
    s.check(
        pendingLifecycle[0]?.action === "EXECUTION_ACCEPTED" && pendingLifecycle[1]?.action === "EXECUTION_PENDING_SYNC",
        "the audit records the full lifecycle: EXECUTION_ACCEPTED → EXECUTION_PENDING_SYNC"
    );
    const pendingEvent = pendingLifecycle.find((e) => e.action === "EXECUTION_PENDING_SYNC");
    s.check(
        pendingEvent?.providerRef === "TICKET-9001" &&
            pendingEvent?.symbol === "EURUSD" &&
            pendingEvent?.volume === 0.1 &&
            pendingEvent?.accountId === "gateway_777001" &&
            pendingEvent?.environment === "DEMO",
        "the audit event retains ticket, account, symbol, volume and environment for debugging"
    );
    s.check(typeof pendingEvent?.timestamp === "number", "the pending-sync audit event is timestamped");
    const persistedPending = syncStore.resultLog().find((r) => r.clientRequestId === "req-pending-sync");
    s.check(
        persistedPending?.providerRef === "TICKET-9001" && persistedPending?.filledVolume === 0.1 && persistedPending?.filledPrice === 1.10123,
        "the persisted result keeps providerRef, filled volume and filled price"
    );
    s.check(
        persistedPending?.accountId === "gateway_777001" &&
            persistedPending?.environment === "DEMO" &&
            typeof persistedPending?.createdAt === "number" &&
            typeof persistedPending?.completedAt === "number",
        "the persisted result is scoped to the account and DEMO environment and is timestamped"
    );
    s.check(
        !/(authorization|private_key|firebase_private|bearer\s)/i.test(JSON.stringify(syncStore.auditLog())),
        "no credentials or auth headers are ever logged for pending-sync executions"
    );

    const replayPending = await syncService.execute({
        userId: "user-sync",
        accountId: "gateway_777001",
        clientRequestId: "req-pending-sync",
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.1,
    });
    s.check(replayPending.result.duplicate === true && replayPending.result.status === "EXECUTED_PENDING_SYNC", "replaying the key returns the same confirmed outcome, never a second trade");
    s.check(replayPending.httpStatus === 200, "the replayed pending-sync result is also HTTP 200");
    s.check(
        replayPending.result.providerRef === "TICKET-9001" && replayPending.result.filledVolume === 0.1,
        "the replay carries the original ticket and filled volume"
    );
    s.check(syncExecuteCalls === 1, "a delayed snapshot + replay still yields ONE provider execution — never a double trade");

    syncMode = "TRANSPORT_FAIL";
    const transportFail = await syncService.execute({
        userId: "user-sync",
        accountId: "gateway_777001",
        clientRequestId: "req-transport-fail",
        executionType: "PLACE_ORDER",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.1,
    });
    s.check(transportFail.result.status === "FAILED" && transportFail.httpStatus === 503, "a transport failure is still FAILED with a non-2xx status");
    s.check(
        transportFail.result.providerRef === null && transportFail.result.status !== "SUCCEEDED",
        "an unconfirmed execution never claims a fill or a ticket — distinct from EXECUTED_PENDING_SYNC"
    );
    s.check(
        syncStore.auditLog().some((e) => e.action === "EXECUTION_FAILED" && e.clientRequestId === "req-transport-fail"),
        "a transport failure is audited as EXECUTION_FAILED"
    );
    syncMode = "PENDING_SYNC";

    s.section("Audit trail covers every outcome without secrets");
    const events: AuditEventInput[] = store.auditLog();
    s.check(events.some((e) => e.action === "EXECUTION_SUCCEEDED"), "successful executions are audited");
    s.check(events.some((e) => e.action === "EXECUTION_DUPLICATE"), "duplicate requests are audited");
    s.check(events.some((e) => e.action === "CONNECTION_REJECTED"), "connection rejections are audited");
    s.check(events.every((e) => !("token" in e) && !("password" in e)), "no credential fields are ever written to the audit log");
    s.check(events.every((e) => typeof e.timestamp === "number"), "audit events are timestamped");

    s.section("Persisted results round-trip");
    const persisted = store.resultLog().at(-1);
    s.check(Boolean(persisted) && typeof (persisted as TradingExecutionResult).clientRequestId === "string", "results carry the client request id for reconciliation");

    return s.finish();
}