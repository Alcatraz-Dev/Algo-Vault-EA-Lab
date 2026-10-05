/**
 * The one interface every execution connector implements.
 *
 * The Pro Terminal, AI surfaces, signals, bots, workflows and the future
 * TradingView extension talk ONLY to this surface. Which broker is behind it
 * is never visible above this line.
 *
 * An adapter translates provider shapes into the neutral domain types AND
 * translates provider failures into `TradingError`. It must never synthesize
 * account state it did not receive from the provider.
 */

import type {
    TradingAccount,
    TradingCandle,
    TradingConnection,
    TradingDeal,
    TradingEnvironment,
    TradingError,
    TradingExecutionRequest,
    TradingExecutionResult,
    TradingHistory,
    TradingOrder,
    TradingPosition,
    TradingProvider,
    TradingProviderStatus,
    TradingQuote,
    TradingSymbol,
} from "./domain";

/** Result envelope: every adapter call either yields a value or a normalized error. */
export type TradingResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: TradingError };

export interface TradingProviderDescriptor {
    provider: TradingProvider;
    /** Environments this adapter may serve. LIVE is never served in this phase. */
    environments: TradingEnvironment[];
    /** True when the adapter is compiled in and reachable in this deployment. */
    available: boolean;
    /** True when the provider has a real, tested end-to-end path. */
    operational: boolean;
    label: string;
    note: string | null;
}

export interface TradingProviderAdapter {
    readonly provider: TradingProvider;
    readonly descriptor: TradingProviderDescriptor;

    /**
     * Whether this adapter owns an account id from the given namespace.
     *
     * Resolution is by ACCOUNT ID NAMESPACE, never by a client-supplied
     * provider name, so a caller cannot route an MT5 account to another
     * adapter. Test doubles own every namespace they are seeded with.
     */
    matchesAccountId(accountId: string): boolean;

    /** Provider health independent of any user account. */
    healthCheck(): Promise<TradingResult<{ status: TradingProviderStatus; checkedAt: number }>>;

    /** Account-level connection state for a specific user account. */
    getConnectionStatus(userId: string, accountId: string): Promise<TradingResult<TradingConnection>>;

    getAccount(userId: string, accountId: string): Promise<TradingResult<TradingAccount>>;

    getPositions(userId: string, accountId: string): Promise<TradingResult<TradingPosition[]>>;

    getOrders(userId: string, accountId: string): Promise<TradingResult<TradingOrder[]>>;

    getDeals(userId: string, accountId: string, since?: number): Promise<TradingResult<TradingDeal[]>>;

    getHistory(userId: string, accountId: string, since?: number): Promise<TradingResult<TradingHistory>>;

    getSymbols(userId: string, accountId: string): Promise<TradingResult<TradingSymbol[]>>;

    getQuote(userId: string, accountId: string, symbol: string): Promise<TradingResult<TradingQuote>>;

    getQuotes(userId: string, accountId: string, symbols: string[]): Promise<TradingResult<TradingQuote[]>>;

    getCandles(
        userId: string,
        accountId: string,
        symbol: string,
        timeframe: string
    ): Promise<TradingResult<TradingCandle[]>>;

    /**
     * Submit one execution. The returned result MUST be verified against the
     * provider (ticket/position actually exists) before it reports success;
     * an adapter that cannot verify must return `EXECUTION_TIMEOUT` or
     * `UNKNOWN_PROVIDER_ERROR`, never a fabricated fill.
     *
     * The service has already authenticated the caller, proved ownership,
     * checked the feature flags, validated the environment, run the risk
     * engine and claimed the idempotency key before this is called.
     */
    execute(input: AdapterExecutionInput): Promise<TradingResult<TradingExecutionResult>>;
}

/** Everything an adapter needs, already validated by the unified service. */
export interface AdapterExecutionInput {
    request: TradingExecutionRequest;
    /** Provider-neutral account snapshot used for this execution. */
    account: TradingAccount;
    /** Resolved position for MODIFY / CLOSE / PARTIAL_CLOSE. */
    position?: TradingPosition | null;
    /** Resolved order for CANCEL. */
    order?: TradingOrder | null;
    /**
     * Lots. For entries this is the risk-approved volume; for PARTIAL_CLOSE it
     * is the provider-rounded close volume computed by the service. Never a
     * P/L amount.
     */
    volume?: number | null;
}

/**
 * Provider registry.
 *
 * Resolution is deliberately explicit: an unregistered provider is an
 * `PROVIDER_NOT_CONFIGURED` error, never a silent fallback to a working
 * provider. This is what keeps "the terminal does not know it is MT5" honest.
 */
export class TradingProviderRegistry {
    private readonly adapters = new Map<TradingProvider, TradingProviderAdapter>();

    constructor(adapters: TradingProviderAdapter[] = []) {
        for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
    }

    register(adapter: TradingProviderAdapter): void {
        this.adapters.set(adapter.provider, adapter);
    }

    has(provider: TradingProvider): boolean {
        return this.adapters.has(provider);
    }

    get(provider: TradingProvider): TradingProviderAdapter | null {
        return this.adapters.get(provider) ?? null;
    }

    /** Resolves the adapter that owns an account id namespace. */
    resolveForAccount(accountId: string): TradingProviderAdapter | null {
        for (const adapter of this.adapters.values()) {
            if (adapter.matchesAccountId(accountId)) return adapter;
        }
        return null;
    }

    list(): TradingProviderDescriptor[] {
        return [...this.adapters.values()].map((adapter) => adapter.descriptor);
    }
}