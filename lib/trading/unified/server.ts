/**
 * Server-only composition root for the Unified Trading Service.
 *
 * Isolated in its own module so route handlers and tests can build the
 * registry without importing the admin SDK transitively. Never import this
 * from a client component.
 */

import "server-only";

import { TradingProviderRegistry } from "./adapter";
import { Mt5DemoProvider } from "./mt5-demo-provider";
import { UnifiedTradingService, type UnifiedTradingDeps } from "./service";
import { isMt5DemoEnabled } from "../feature-flags";
import { accountKey, buildControlRiskLimits, loadAccountRiskSnapshot } from "@/lib/risk/account-state";
import { OrderFingerprintGuard } from "@/lib/risk/order-fingerprint";
import { recordFillNotional, releaseNotional, reserveNotional } from "@/lib/risk/notional-ledger";

export interface ProviderCatalogEntry {
    provider: "MT5" | "MT4" | "CTRADER" | "ALGOVAULT_BROKER";
    label: string;
    environments: Array<"DEMO" | "LIVE">;
    /** Compiled in and registered. */
    enabled: boolean;
    /** Real, tested end-to-end execution path. */
    operational: boolean;
    status: "CONNECTED_CAPABLE" | "COMING_SOON";
    note: string;
}

/**
 * What the account-connection UI renders. Providers without an implemented
 * adapter are still listed so the roadmap is visible, but they can never be
 * selected or reported as connected.
 */
export function providerCatalog(): ProviderCatalogEntry[] {
    const mt5Enabled = isMt5DemoEnabled();
    return [
        {
            provider: "MT5",
            label: "MetaTrader 5",
            environments: ["DEMO"],
            enabled: mt5Enabled,
            operational: mt5Enabled,
            status: mt5Enabled ? "CONNECTED_CAPABLE" : "COMING_SOON",
            note: "Demo accounts only. Connects through the AlgoVault Trade Gateway EA.",
        },
        {
            provider: "MT4",
            label: "MetaTrader 4",
            environments: ["DEMO"],
            enabled: false,
            operational: false,
            status: "COMING_SOON",
            note: "Adapter contract prepared. Connector is NOT IMPLEMENTED.",
        },
        {
            provider: "CTRADER",
            label: "cTrader",
            environments: ["DEMO"],
            enabled: false,
            operational: false,
            status: "COMING_SOON",
            note: "Adapter contract prepared. Connector is NOT IMPLEMENTED.",
        },
        {
            provider: "ALGOVAULT_BROKER",
            label: "AlgoVault Brokerage",
            environments: ["DEMO", "LIVE"],
            enabled: false,
            operational: false,
            status: "COMING_SOON",
            note: "Future first-party execution venue. NOT IMPLEMENTED.",
        },
    ];
}

export function createTradingRegistry(): TradingProviderRegistry {
    const registry = new TradingProviderRegistry();
    if (isMt5DemoEnabled()) registry.register(new Mt5DemoProvider());
    return registry;
}

/**
 * Process-level duplicate window. `createUnifiedTradingService()` is called per
 * request, so the guard must not be constructed per call or its window would
 * reset on every invocation. Best-effort per instance (multi-instance deploys
 * still have the durable clientRequestId idempotency record).
 */
const ORDER_FINGERPRINT_GUARD = new OrderFingerprintGuard({ windowMs: 2_000, maxEntries: 500 });

export function createUnifiedTradingService(
    overrides: Partial<UnifiedTradingDeps> = {}
): UnifiedTradingService {
    return new UnifiedTradingService({
        registry: createTradingRegistry(),
        // Burst duplicate prevention: same economic order, different request id.
        duplicateGuard: ORDER_FINGERPRINT_GUARD,
        // Real account state for entries. If this read fails the service fails
        // closed — an unknown risk state must not silently become "safe".
        riskState: async (userId, accountId, symbol) => {
            const snapshot = await loadAccountRiskSnapshot(userId, accountId, symbol);
            return { limits: buildControlRiskLimits(snapshot), state: snapshot.account };
        },
        // Daily notional accounting. Only entries run through the risk engine
        // reach here; the ledger serializes concurrent reservations so two
        // submissions cannot jointly exceed the configured budget.
        notional: {
            reserve: ({ userId, accountId, reservationId, amount, limit }) =>
                reserveNotional({ userId, accountKey: accountKey(accountId), reservationId, amount, limit }),
            release: ({ userId, accountId, reservationId }) =>
                releaseNotional({ userId, accountKey: accountKey(accountId), reservationId }),
            recordFill: ({ userId, accountId, fill }) =>
                recordFillNotional({ userId, accountKey: accountKey(accountId), fill }),
        },
        ...overrides,
    });
}