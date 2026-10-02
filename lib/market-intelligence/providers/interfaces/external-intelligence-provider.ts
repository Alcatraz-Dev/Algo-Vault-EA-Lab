/**
 * External Intelligence Provider Contracts (TradingView MCP phase)
 *
 * AlgoVault's own intelligence engines (Smart Money, backtesting, replay,
 * research) are NOT providers — they are the platform itself. This module
 * defines the contract that OPTIONAL EXTERNAL intelligence providers
 * (currently: TradingView MCP) implement so the Intelligence Engine can
 * consume their output as clearly-labelled external evidence.
 *
 * Design rules:
 *  • A provider is additive. AlgoVault must work fully with every provider
 *    disconnected (fail-closed design, PHASE 16).
 *  • Every capability maps to an explicit capability id; unsupported
 *    capabilities are reported as `supported: false` — never faked.
 *  • Providers never execute orders and are never latency-sensitive feeds.
 *  • Providers return normalized, provenance-stamped results, never raw
 *    provider payloads, so callers cannot accidentally leak upstream shapes
 *    (or credentials) into the UI.
 */

// ── Connection lifecycle ────────────────────────────────────────────────────

export type ProviderConnectionState =
    | "DISCONNECTED"
    | "CONNECTING"
    | "CONNECTED"
    | "TOKEN_EXPIRED"
    | "REAUTH_REQUIRED"
    | "ERROR"
    | "DISABLED";

export type ProviderId = "tradingview-mcp" | string;

export interface ProviderConnectionStatus {
    provider: ProviderId;
    state: ProviderConnectionState;
    /** True when the provider is enabled by feature flag / config. */
    enabled: boolean;
    /** True when the current user has completed the authorization flow. */
    authorized: boolean;
    /** Capability ids granted by the current authorization. */
    scopes: readonly string[];
    /** Human-readable explanation for non-CONNECTED states (no secrets). */
    message?: string;
    /** ms epoch of the last successful connection check; null if never. */
    lastCheckedAt?: number | null;
}

// ── Capabilities ────────────────────────────────────────────────────────────

export const EXTERNAL_CAPABILITIES = [
    "quote",
    "historical_data",
    "technical_snapshot",
    "screener",
    "news",
    "economic_calendar",
    "fundamentals",
    "filings",
    "watchlists",
    "alerts",
    "alert_history",
    "symbol_search",
    "forecasts",
    "financial_history",
    "earnings_calendar",
    "dividends_calendar",
    "economic_data",
] as const;

export type ExternalCapability = (typeof EXTERNAL_CAPABILITIES)[number];

export interface CapabilityDescriptor {
    id: ExternalCapability;
    label: string;
    supported: boolean;
    /** Provider tool ids backing the capability (informational). */
    tools: readonly string[];
    read: boolean;
}

// ── Provenance envelope (PHASE 4) ───────────────────────────────────────────

/**
 * SOURCE of an evidence item. ALGOVAULT items are produced by AlgoVault's own
 * deterministic engines; TRADINGVIEW items carry the external provider stamp.
 */
export type EvidenceSourceId = "ALGOVAULT" | "TRADINGVIEW" | "BROKER" | "OTHER_EXTERNAL";

export type EvidenceFreshness =
    | "realtime"
    | "fresh"
    | "delayed"
    | "stale"
    | "cached"
    | "historical"
    | "unknown";

export interface ExternalEvidenceProvenance {
    source: EvidenceSourceId;
    provider: ProviderId;
    /** ms epoch when the provider produced the underlying data. */
    sourceTimestamp: number | null;
    /** ms epoch when AlgoVault fetched it. */
    fetchedAt: number;
    /** True when the provider itself flagged the feed as delayed. */
    delayed: boolean;
    freshness: EvidenceFreshness;
    /** Cache state of THIS response (not the underlying market data). */
    cache: "hit" | "miss" | "bypassed";
    /** True when the value came from the cache and may not reflect live state. */
    stale?: boolean;
    /** Free-text qualification the provider attached (e.g. "15 min delayed"). */
    disclaimer?: string;
}

/** Standard error codes a provider call can fail with. */
export type ProviderErrorCode =
    | "DISABLED"
    | "NOT_CONNECTED"
    | "REAUTH_REQUIRED"
    | "TOKEN_EXPIRED"
    | "RATE_LIMITED"
    | "TIMEOUT"
    | "PROVIDER_OUTAGE"
    | "UNSUPPORTED_CAPABILITY"
    | "INVALID_REQUEST"
    | "NOT_FOUND"
    | "PERMISSION_DENIED"
    | "UNKNOWN_ERROR";

export class ExternalProviderError extends Error {
    readonly code: ProviderErrorCode;
    readonly provider: ProviderId;
    readonly capability: ExternalCapability | null;
    readonly retryAfterMs: number | null;

    constructor(args: {
        code: ProviderErrorCode;
        provider: ProviderId;
        capability?: ExternalCapability | null;
        message: string;
        retryAfterMs?: number | null;
    }) {
        super(args.message);
        this.name = "ExternalProviderError";
        this.code = args.code;
        this.provider = args.provider;
        this.capability = args.capability ?? null;
        this.retryAfterMs = args.retryAfterMs ?? null;
    }
}

export function isExternalProviderError(err: unknown): err is ExternalProviderError {
    return err instanceof ExternalProviderError;
}

/** Normalize any thrown error into a safe `{ code, message }` pair (no secrets). */
export function toProviderErrorInfo(err: unknown): { code: ProviderErrorCode; message: string } {
    if (isExternalProviderError(err)) {
        return { code: err.code, message: err.message };
    }
    return {
        code: "UNKNOWN_ERROR",
        message: err instanceof Error ? err.message : "External provider request failed.",
    };
}

// ── Normalized result shapes ────────────────────────────────────────────────

export interface ExternalQuote {
    provenance: ExternalEvidenceProvenance;
    symbol: string;
    providerSymbol?: string;
    price: number | null;
    change: number | null;
    changePercent: number | null;
    bid?: number | null;
    ask?: number | null;
    open?: number | null;
    high?: number | null;
    low?: number | null;
    volume?: number | null;
    description?: string | null;
    exchange?: string | null;
}

export interface ExternalCandle {
    t: number; // unix seconds UTC
    o: number;
    h: number;
    l: number;
    c: number;
    v?: number;
}

export interface ExternalHistoricalData {
    provenance: ExternalEvidenceProvenance;
    symbol: string;
    interval: string;
    count: number;
    candles: ExternalCandle[];
    summaryOnly: boolean;
    aggregate?: Record<string, unknown> | null;
}

export interface ExternalTechnicalSnapshot {
    provenance: ExternalEvidenceProvenance;
    symbol: string;
    interval: string;
    /** Indicator readings as reported by the provider. */
    indicators: Record<string, number | string | null>;
    /** Provider-supplied aggregate recommendation if any (labelled as such). */
    recommendation?: { classification: string; label: string } | null;
    raw?: Record<string, unknown> | null;
}

export interface ExternalScreenerRow {
    symbol: string;
    values: Record<string, number | string | boolean | null>;
}

export interface ExternalScreenerResult {
    provenance: ExternalEvidenceProvenance;
    market: string;
    totalCount: number | null;
    rows: ExternalScreenerRow[];
    columns: readonly string[];
}

export interface ExternalNewsItem {
    provenance: ExternalEvidenceProvenance;
    id: string;
    title: string;
    provider?: string | null;
    publishedAt: number | null; // unix seconds
    link?: string | null;
    urgency?: number | null;
    relatedSymbols?: string[];
}

export type ExternalEconomicImportance = "all" | "medium" | "high";

export interface ExternalEconomicEvent {
    provenance: ExternalEvidenceProvenance;
    eventId?: string | null;
    title: string;
    country?: string | null;
    currency?: string | null;
    /**
     * Importance EXACTLY as classified by the provider. AlgoVault never
     * invents or regrades impact levels (PHASE 9).
     */
    importance: number | null;
    importanceLabel: string | null;
    eventTime: number | null; // unix seconds
    category?: string | null;
    actual?: string | number | null;
    forecast?: string | number | null;
    previous?: string | number | null;
}

export interface ExternalFundamentals {
    provenance: ExternalEvidenceProvenance;
    symbol: string;
    metrics: Record<string, number | string | null>;
    period?: string | null;
}

export interface ExternalFiling {
    provenance: ExternalEvidenceProvenance;
    id: string;
    title: string;
    category?: string | null;
    publishedAt: number | null; // unix seconds
    viewId?: string | null;
}

export interface ExternalWatchlist {
    provenance: ExternalEvidenceProvenance;
    id: string;
    name: string;
    symbolCount: number | null;
    symbols?: string[];
    active?: boolean;
}

export interface ExternalAlert {
    provenance: ExternalEvidenceProvenance;
    id: string;
    name?: string | null;
    symbol: string;
    active: boolean;
    conditionType?: string | null;
    threshold?: number | null;
    resolution?: string | null;
    createdAt?: number | null;
    lastFiredAt?: number | null;
}

export interface ExternalAlertHistoryEvent {
    provenance: ExternalEvidenceProvenance;
    alertId: string;
    symbol: string;
    firedAt: number | null;
    message?: string | null;
}

export interface ExternalSymbolSearchResult {
    provenance: ExternalEvidenceProvenance;
    query: string;
    results: Array<{
        symbol: string;
        description?: string | null;
        type?: string | null;
        exchange?: string | null;
    }>;
}

// ── Provider interface ──────────────────────────────────────────────────────

export interface GetConnectionStatusOptions {
    /** Force a live validation rather than using cached state. */
    refresh?: boolean;
    /** ms epoch used for token expiry math (injectable for tests). */
    now?: number;
}

/**
 * The contract every EXTERNAL intelligence provider implements. Methods that
 * the backing service does not support throw ExternalProviderError with
 * `UNSUPPORTED_CAPABILITY` (they are also reported unsupported by
 * `describeCapabilities` so UIs can hide them).
 */
export interface ExternalIntelligenceProvider {
    readonly id: ProviderId;
    readonly label: string;

    describeCapabilities(): readonly CapabilityDescriptor[];

    getConnectionStatus(userId: string, options?: GetConnectionStatusOptions): Promise<ProviderConnectionStatus>;

    getQuote(userId: string, symbol: string): Promise<ExternalQuote>;
    getHistoricalData(
        userId: string,
        symbol: string,
        options?: { interval?: string; count?: number; summaryOnly?: boolean },
    ): Promise<ExternalHistoricalData>;
    getTechnicalSnapshot(userId: string, symbol: string, interval?: string): Promise<ExternalTechnicalSnapshot>;
    runScreener(
        userId: string,
        options?: {
            market?: string;
            filters?: Record<string, unknown>;
            sortBy?: string;
            sortOrder?: "asc" | "desc";
            limit?: number;
            columns?: string[];
            filterPreset?: string;
            symbolTypes?: string[];
        },
    ): Promise<ExternalScreenerResult>;
    getNews(userId: string, symbol: string, options?: { limit?: number; lang?: string; offset?: number }): Promise<ExternalNewsItem[]>;
    getEconomicCalendar(
        userId: string,
        options?: {
            countries?: string;
            currencies?: string;
            category?: string;
            dateFrom?: string;
            dateTo?: string;
            minImportance?: -1 | 0 | 1;
        },
    ): Promise<ExternalEconomicEvent[]>;
    getFundamentals(userId: string, symbol: string): Promise<ExternalFundamentals>;
    getFilings(
        userId: string,
        symbol: string,
        options?: { category?: string; event?: string; limit?: number },
    ): Promise<ExternalFiling[]>;
    getWatchlists(userId: string): Promise<ExternalWatchlist[]>;
    getAlerts(userId: string, options?: { symbol?: string; active?: boolean }): Promise<ExternalAlert[]>;
    getAlertHistory(userId: string, options?: { days?: number; symbol?: string; limit?: number }): Promise<ExternalAlertHistoryEvent[]>;
    searchSymbols(userId: string, query: string, typeFilter?: string): Promise<ExternalSymbolSearchResult>;
}

// ── Permission model (PHASE 14) ─────────────────────────────────────────────

export const TRADINGVIEW_PERMISSIONS = [
    "read_market_data",
    "read_technicals",
    "read_news",
    "read_economic_calendar",
    "read_fundamentals",
    "read_watchlists",
    "read_alerts",
    // Future write permissions — declared, never granted by default:
    "write_watchlists",
    "write_alerts",
] as const;

export type TradingViewPermission = (typeof TRADINGVIEW_PERMISSIONS)[number];

/** Capabilities each read permission unlocks (single source of truth). */
export const TRADINGVIEW_CAPABILITY_PERMISSIONS: Record<ExternalCapability, TradingViewPermission> = {
    quote: "read_market_data",
    historical_data: "read_market_data",
    economic_data: "read_market_data",
    symbol_search: "read_market_data",
    technical_snapshot: "read_technicals",
    screener: "read_technicals",
    news: "read_news",
    economic_calendar: "read_economic_calendar",
    fundamentals: "read_fundamentals",
    forecasts: "read_fundamentals",
    financial_history: "read_fundamentals",
    filings: "read_fundamentals",
    earnings_calendar: "read_fundamentals",
    dividends_calendar: "read_fundamentals",
    watchlists: "read_watchlists",
    alerts: "read_alerts",
    alert_history: "read_alerts",
};

/** Default user grants: read-only. Writes require an explicit future opt-in. */
export const DEFAULT_TRADINGVIEW_PERMISSIONS: readonly TradingViewPermission[] = [
    "read_market_data",
    "read_technicals",
    "read_news",
    "read_economic_calendar",
    "read_fundamentals",
    "read_watchlists",
    "read_alerts",
];

export function isTradingViewPermission(value: string): value is TradingViewPermission {
    return (TRADINGVIEW_PERMISSIONS as readonly string[]).includes(value);
}
