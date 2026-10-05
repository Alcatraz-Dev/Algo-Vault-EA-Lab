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

    s.section("Market order end-to-end against the mock provider");
    const placed = await service.execute({ ...base, executionType: "PLACE_ORDER", symbol: "EURUSD", side: "BUY", volume: 0.1, stopLoss: 1.09, takeProfit: 1.12 });
    s.check(placed.result.status === "SUCCEEDED" && placed.result.position !== null, "market buy produces a provider position");
    s.check(placed.result.providerRef !== null && placed.result.filledVolume === 0.1, "provider reference and filled volume are reported");
    const positionId = placed.result.position?.id ?? "";
    s.check(store.resultLog().length === 1 && store.resultLog()[0].status === "SUCCEEDED", "the execution result is persisted");

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