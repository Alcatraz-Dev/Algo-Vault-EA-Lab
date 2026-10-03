/**
 * TradingViewMCPProvider — the official TradingView MCP server as an OPTIONAL
 * external intelligence provider (PHASE 2/3).
 *
 *  • Implements ExternalIntelligenceProvider; AlgoVault-native engines are NOT
 *    touched. TradingView data is never used for execution or scalping feeds.
 *  • Fail-closed: feature flags off, missing connection, expired token or
 *    unsupported tool → typed error, never a fabricated result.
 *  • Permission-checked per capability (PHASE 14); read-only.
 *  • Cached only for non-time-sensitive capability classes (PHASE 17).
 *  • Observability recorded for every upstream call (PHASE 18).
 */
import type {
    CapabilityDescriptor,
    ExternalAlert,
    ExternalAlertHistoryEvent,
    ExternalCapability,
    ExternalEconomicEvent,
    ExternalEvidenceProvenance,
    ExternalFiling,
    ExternalFundamentals,
    ExternalHistoricalData,
    ExternalIntelligenceProvider,
    ExternalNewsItem,
    ExternalQuote,
    ExternalScreenerResult,
    ExternalSymbolSearchResult,
    ExternalTechnicalSnapshot,
    ExternalWatchlist,
    GetConnectionStatusOptions,
    ProviderConnectionStatus,
} from "../interfaces/external-intelligence-provider";
import { ExternalProviderError, TRADINGVIEW_CAPABILITY_PERMISSIONS } from "../interfaces/external-intelligence-provider";
import { getTradingViewFlags } from "./feature-flags";
import { loadTokenBundle, getConnectionRecord } from "./connection-store";
import { callTool, listTools, McpTransportError } from "./mcp-client";
import {
    buildProvenance,
    describeFreshness,
} from "./provenance";
import { cacheKeyFor, getCached, setCached, defaultTtlFor, type CacheableCapability } from "./cache";
import { recordMcpCall } from "./observability";
import {
    CAPABILITY_TOOLS,
    describeCapabilities,
    normalizeAlerts,
    normalizeAlertHistory,
    normalizeEconomicCalendar,
    normalizeFilings,
    normalizeFundamentals,
    normalizeHistorical,
    normalizeNews,
    normalizeQuote,
    normalizeScreener,
    normalizeSymbolSearch,
    normalizeTechnicalSnapshot,
    normalizeWatchlists,
    parseToolPayload,
    providerTimestampFrom,
    unwrapData,
} from "./tool-mapping";
import { tryConsumeMcpBudget } from "./rate-limiter";
import type { OAuthTokenBundle } from "./connection-store";
import { isTokenEncryptionConfigured } from "./token-crypto";

const PROVIDER_ID = "tradingview-mcp";
const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

const READ_TOOLS_ONLY = true; // PHASE 10: read-only first. Writes are a future, confirmation-gated layer.

interface ResolvedConnection {
    userId: string;
    token: OAuthTokenBundle;
}

/** Guard chain applied before any upstream call. */
async function resolveConnection(userId: string, capability: ExternalCapability | null): Promise<ResolvedConnection> {
    const flags = getTradingViewFlags();
    if (!flags.master) {
        throw new ExternalProviderError({ code: "DISABLED", provider: PROVIDER_ID, capability, message: "TradingView MCP integration is disabled." });
    }
    if (!isTokenEncryptionConfigured()) {
        throw new ExternalProviderError({
            code: "DISABLED",
            provider: PROVIDER_ID,
            capability,
            message: "TradingView MCP token encryption is not configured on the server.",
        });
    }
    const bundle = await loadTokenBundle(userId);
    if (!bundle) {
        throw new ExternalProviderError({
            code: "NOT_CONNECTED",
            provider: PROVIDER_ID,
            capability,
            message: "TradingView is not connected for this account.",
        });
    }
    if (bundle.expiresAt <= Date.now() + 5_000) {
        // Token expired: surface REAUTH_REQUIRED to the caller/UI. (Refresh is
        // attempted opportunistically by the AI/route layer when a refresh
        // token exists; without one the user must reconnect.)
        throw new ExternalProviderError({
            code: "TOKEN_EXPIRED",
            provider: PROVIDER_ID,
            capability,
            message: "The TradingView authorization has expired. Please reconnect.",
        });
    }
    return { userId, token: bundle };
}

function assertPermission(userId: string, capability: ExternalCapability, granted: readonly string[]): void {
    const needed = TRADINGVIEW_CAPABILITY_PERMISSIONS[capability];
    if (!granted.includes(needed)) {
        throw new ExternalProviderError({
            code: "PERMISSION_DENIED",
            provider: PROVIDER_ID,
            capability,
            message: `TradingView permission "${needed}" has not been granted for this account.`,
        });
    }
    void userId;
}

async function guardRateLimit(userId: string, capability: ExternalCapability): Promise<void> {
    const decision = tryConsumeMcpBudget(userId);
    if (!decision.allowed) {
        recordMcpCall({ provider: PROVIDER_ID, tool: "rate-limiter", capability, userId, ok: false, code: "RATE_LIMITED" });
        throw new ExternalProviderError({
            code: "RATE_LIMITED",
            provider: PROVIDER_ID,
            capability,
            message: `TradingView MCP rate limit reached (${decision.scope}). Please retry shortly.`,
            retryAfterMs: decision.retryAfterMs,
        });
    }
}

function capabilityFlagEnabled(capability: ExternalCapability): boolean {
    const flags = getTradingViewFlags();
    switch (capability) {
        case "news":
            return flags.news;
        case "technical_snapshot":
        case "screener":
            return flags.technicals;
        case "economic_calendar":
            return flags.economicCalendar;
        case "fundamentals":
        case "filings":
        case "forecasts":
        case "financial_history":
        case "earnings_calendar":
        case "dividends_calendar":
        case "economic_data":
            return flags.fundamentals;
        case "watchlists":
            return flags.watchlists;
        case "alerts":
        case "alert_history":
            return flags.alerts;
        default:
            return true; // quote / historical_data / symbol_search follow the master flag
    }
}

function transportToProviderError(err: unknown, capability: ExternalCapability | null): ExternalProviderError {
    if (err instanceof ExternalProviderError) return err;
    if (err instanceof McpTransportError) {
        return new ExternalProviderError({
            code: err.code,
            provider: PROVIDER_ID,
            capability,
            message: err.message,
            retryAfterMs: err.retryAfterMs,
        });
    }
    return new ExternalProviderError({
        code: "UNKNOWN_ERROR",
        provider: PROVIDER_ID,
        capability,
        message: err instanceof Error ? err.message : "TradingView MCP request failed.",
    });
}

async function withCallContext<T>(
    userId: string,
    capability: ExternalCapability,
    fn: (ctx: { token: OAuthTokenBundle; timeoutMs: number }) => Promise<{ data: T; sourceTimestamp: number | null }>,
    options: { cache?: CacheableCapability; cacheArgs?: Record<string, unknown> } = {},
): Promise<{ data: T; provenance: ExternalEvidenceProvenance }> {
    const conn = await resolveConnection(userId, capability);
    assertPermission(userId, capability, conn.token.scope.length > 0 ? conn.token.scope : ["read"]);
    await guardRateLimit(userId, capability);

    if (!capabilityFlagEnabled(capability)) {
        throw new ExternalProviderError({
            code: "DISABLED",
            provider: PROVIDER_ID,
            capability,
            message: `TradingView capability "${capability}" is disabled by feature flag.`,
        });
    }

    // Cache lookup (hit short-circuits the upstream call).
    const cacheable = options.cache;
    const key = cacheable ? cacheKeyFor(cacheable, userId, options.cacheArgs) : null;
    if (cacheable && key) {
        const hit = getCached<T>(key);
        if (hit) {
            const provenance = buildProvenance({
                source: "TRADINGVIEW",
                provider: PROVIDER_ID,
                sourceTimestamp: hit.meta.sourceTimestamp,
                cache: "hit",
                staleAfterMs: defaultTtlFor(cacheable),
            });
            recordMcpCall({ provider: PROVIDER_ID, tool: CAPABILITY_TOOLS[capability].primary, capability, userId, ok: true, cache: "hit" });
            return { data: hit.data, provenance };
        }
    }

    const startedAt = Date.now();
    try {
        const { data, sourceTimestamp } = await fn({ token: conn.token, timeoutMs: DEFAULT_TOOL_TIMEOUT_MS });
        const durationMs = Date.now() - startedAt;
        if (cacheable && key) {
            setCached(key, { data, sourceTimestamp }, defaultTtlFor(cacheable), { sourceTimestamp });
        }
        recordMcpCall({ provider: PROVIDER_ID, tool: CAPABILITY_TOOLS[capability].primary, capability, userId, ok: true, durationMs, cache: "miss" });
        return {
            data,
            provenance: buildProvenance({
                source: "TRADINGVIEW",
                provider: PROVIDER_ID,
                sourceTimestamp,
                cache: "miss",
            }),
        };
    } catch (err) {
        const durationMs = Date.now() - startedAt;
        const perr = transportToProviderError(err, capability);
        recordMcpCall({
            provider: PROVIDER_ID,
            tool: CAPABILITY_TOOLS[capability].primary,
            capability,
            userId,
            ok: false,
            durationMs,
            code: perr.code,
        });
        throw perr;
    }
}

/** Run the mapped tool and parse the payload. */
async function runTool(
    ctx: { token: OAuthTokenBundle; timeoutMs: number },
    capability: ExternalCapability,
    toolArgs: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown> | unknown[] | null; sourceTimestamp: number | null }> {
    const map = CAPABILITY_TOOLS[capability];
    const result = await callTool({ tool: map.primary, args: toolArgs, accessToken: ctx.token.accessToken, timeoutMs: ctx.timeoutMs });
    if (result.isError) {
        throw new McpTransportError(result.text?.slice(0, 300) || "TradingView tool reported an error.", "INVALID_REQUEST", null);
    }
    const payload = parseToolPayload(result);
    if (payload === null) {
        throw new McpTransportError(`TradingView tool "${map.primary}" returned an unreadable payload.`, "PROVIDER_OUTAGE", null);
    }
    const rec = Array.isArray(payload) ? null : (payload as Record<string, unknown>);
    return { payload, sourceTimestamp: providerTimestampFrom(rec ?? unwrapData(payload) as Record<string, unknown>) };
}

function asRecord(payload: Record<string, unknown> | unknown[] | null): Record<string, unknown> | null {
    return payload && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

export class TradingViewMCPProvider implements ExternalIntelligenceProvider {
    readonly id = PROVIDER_ID;
    readonly label = "TradingView MCP";

    /** Listed tool names (null = unknown; used for capability support). */
    private listedToolsCache: { names: string[] | null; at: number } | null = null;

    describeCapabilities(): CapabilityDescriptor[] {
        return describeCapabilities(this.listedToolsCache?.names ?? null);
    }

    /** Refresh the tool list so capability support reflects the live beta toolset. */
    async refreshToolList(userId: string): Promise<string[]> {
        const conn = await resolveConnection(userId, null);
        const tools = await listTools(conn.token.accessToken, DEFAULT_TOOL_TIMEOUT_MS);
        const names = tools.map((t) => t.name);
        this.listedToolsCache = { names, at: Date.now() };
        return names;
    }

    async getConnectionStatus(userId: string, options?: GetConnectionStatusOptions): Promise<ProviderConnectionStatus> {
        const flags = getTradingViewFlags();
        const record = await getConnectionRecord(userId);
        const now = options?.now ?? Date.now();

        if (!flags.master) {
            return {
                provider: PROVIDER_ID,
                state: "DISABLED",
                enabled: false,
                authorized: false,
                scopes: [],
                message: "TradingView MCP integration is disabled.",
                lastCheckedAt: now,
            };
        }
        if (!isTokenEncryptionConfigured()) {
            return {
                provider: PROVIDER_ID,
                state: "ERROR",
                enabled: true,
                authorized: false,
                scopes: [],
                message: "Server-side token encryption is not configured; TradingView cannot be connected.",
                lastCheckedAt: now,
            };
        }
        if (!record || !record.tokenEnvelope) {
            return {
                provider: PROVIDER_ID,
                state: record?.state === "DISCONNECTED" ? "DISCONNECTED" : "DISCONNECTED",
                enabled: true,
                authorized: false,
                scopes: record?.scope ?? [],
                message: "TradingView is not connected. Use Connect to authorize.",
                lastCheckedAt: now,
            };
        }
        if (record.state === "REAUTH_REQUIRED" || record.state === "ERROR") {
            return {
                provider: PROVIDER_ID,
                state: record.state,
                enabled: true,
                authorized: false,
                scopes: record.scope ?? [],
                message: record.lastError ?? "Reconnection required.",
                lastCheckedAt: now,
            };
        }
        const expired = typeof record.tokenExpiresAt === "number" && record.tokenExpiresAt <= now + 5_000;
        if (expired) {
            return {
                provider: PROVIDER_ID,
                state: "TOKEN_EXPIRED",
                enabled: true,
                authorized: true,
                scopes: record.scope ?? [],
                message: "The TradingView authorization has expired. Please reconnect.",
                lastCheckedAt: now,
            };
        }
        return {
            provider: PROVIDER_ID,
            state: "CONNECTED",
            enabled: true,
            authorized: true,
            scopes: record.scope ?? [],
            message: "Connected to TradingView MCP.",
            lastCheckedAt: now,
        };
    }

    async getQuote(userId: string, symbol: string): Promise<ExternalQuote> {
        const { data, provenance } = await withCallContext(userId, "quote", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "quote", { symbols: [symbol] });
            return { data: payload, sourceTimestamp };
        }, { cache: "technical_snapshot", cacheArgs: { quote: symbol } });
        return normalizeQuote(symbol, data, provenance);
    }

    async getHistoricalData(
        userId: string,
        symbol: string,
        options?: { interval?: string; count?: number; summaryOnly?: boolean },
    ): Promise<ExternalHistoricalData> {
        const interval = options?.interval ?? "1D";
        const count = Math.min(5000, Math.max(10, options?.count ?? 300));
        const summaryOnly = options?.summaryOnly ?? false;
        const { data, provenance } = await withCallContext(userId, "historical_data", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "historical_data", {
                symbol,
                interval,
                count,
                summary: summaryOnly,
            });
            return { data: payload, sourceTimestamp };
        });
        return normalizeHistorical(symbol, interval, summaryOnly, data, provenance);
    }

    async getTechnicalSnapshot(userId: string, symbol: string, interval = "1D"): Promise<ExternalTechnicalSnapshot> {
        const { data, provenance } = await withCallContext(userId, "technical_snapshot", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "technical_snapshot", { symbol, interval });
            return { data: payload, sourceTimestamp };
        }, { cache: "technical_snapshot", cacheArgs: { symbol, interval } });
        return normalizeTechnicalSnapshot(symbol, interval, data, provenance);
    }

    async runScreener(
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
    ): Promise<ExternalScreenerResult> {
        const market = options?.market ?? "america";
        const columns = options?.columns ?? ["name", "description", "close", "change", "volume"];
        const toolArgs: Record<string, unknown> = { market, columns };
        if (options?.filters) toolArgs.filters = options.filters;
        if (options?.sortBy) toolArgs.sort_by = options.sortBy;
        if (options?.sortOrder) toolArgs.sort_order = options.sortOrder;
        if (options?.limit) toolArgs.limit = Math.min(1000, options.limit);
        if (options?.filterPreset) toolArgs.filter_preset = options.filterPreset;
        if (options?.symbolTypes) toolArgs.symbol_types = options.symbolTypes;

        const { data, provenance } = await withCallContext(userId, "screener", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "screener", toolArgs);
            return { data: payload, sourceTimestamp };
        }, { cache: "screener", cacheArgs: toolArgs });
        return normalizeScreener(market, data, columns, provenance);
    }

    async getNews(userId: string, symbol: string, options?: { limit?: number; lang?: string; offset?: number }): Promise<ExternalNewsItem[]> {
        const limit = Math.min(200, Math.max(1, options?.limit ?? 25));
        const { data, provenance } = await withCallContext(userId, "news", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "news", {
                symbol,
                limit,
                ...(options?.lang ? { lang: options.lang } : {}),
                ...(options?.offset ? { offset: options.offset } : {}),
            });
            return { data: payload, sourceTimestamp };
        }, { cache: "news", cacheArgs: { symbol, limit, lang: options?.lang ?? "en" } });
        return normalizeNews(data, provenance);
    }

    async getEconomicCalendar(
        userId: string,
        options?: {
            countries?: string;
            currencies?: string;
            category?: string;
            dateFrom?: string;
            dateTo?: string;
            minImportance?: -1 | 0 | 1;
        },
    ): Promise<ExternalEconomicEvent[]> {
        const toolArgs: Record<string, unknown> = {
            ...(options?.countries ? { countries: options.countries } : { countries: "US" }),
            ...(options?.currencies ? { currencies: options.currencies } : {}),
            ...(options?.category ? { category: options.category } : {}),
            ...(options?.dateFrom ? { date_from: options.dateFrom } : {}),
            ...(options?.dateTo ? { date_to: options.dateTo } : {}),
            min_importance: options?.minImportance ?? -1,
        };
        const { data, provenance } = await withCallContext(userId, "economic_calendar", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "economic_calendar", toolArgs);
            return { data: payload, sourceTimestamp };
        }, { cache: "economic_calendar", cacheArgs: toolArgs });
        return normalizeEconomicCalendar(data, provenance);
    }

    async getFundamentals(userId: string, symbol: string): Promise<ExternalFundamentals> {
        const { data, provenance } = await withCallContext(userId, "fundamentals", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "fundamentals", { symbol });
            return { data: payload, sourceTimestamp };
        }, { cache: "fundamentals", cacheArgs: { symbol } });
        return normalizeFundamentals(symbol, data, provenance);
    }

    async getFilings(
        userId: string,
        symbol: string,
        options?: { category?: string; event?: string; limit?: number },
    ): Promise<ExternalFiling[]> {
        const { data, provenance } = await withCallContext(userId, "filings", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "filings", {
                symbol,
                ...(options?.category ? { category: options.category } : {}),
                ...(options?.event ? { event: options.event } : {}),
                limit: Math.min(50, Math.max(1, options?.limit ?? 20)),
            });
            return { data: payload, sourceTimestamp };
        }, { cache: "filings", cacheArgs: { symbol, category: options?.category ?? "all" } });
        return normalizeFilings(data, provenance);
    }

    async getWatchlists(userId: string): Promise<ExternalWatchlist[]> {
        const { data, provenance } = await withCallContext(userId, "watchlists", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "watchlists", {});
            return { data: payload, sourceTimestamp };
        }, { cache: "watchlists", cacheArgs: {} });
        return normalizeWatchlists(data, provenance);
    }

    async getAlerts(userId: string, options?: { symbol?: string; active?: boolean }): Promise<ExternalAlert[]> {
        const toolArgs: Record<string, unknown> = {};
        if (options?.symbol) toolArgs.symbol = options.symbol;
        if (typeof options?.active === "boolean") toolArgs.active = options.active;
        const { data, provenance } = await withCallContext(userId, "alerts", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "alerts", toolArgs);
            return { data: payload, sourceTimestamp };
        }, { cache: "alerts", cacheArgs: toolArgs });
        return normalizeAlerts(data, provenance);
    }

    async getAlertHistory(userId: string, options?: { days?: number; symbol?: string; limit?: number }): Promise<ExternalAlertHistoryEvent[]> {
        const toolArgs: Record<string, unknown> = {
            days: Math.min(90, Math.max(1, options?.days ?? 7)),
            limit: Math.min(2000, Math.max(1, options?.limit ?? 100)),
            ...(options?.symbol ? { symbol: options.symbol } : {}),
        };
        const { data, provenance } = await withCallContext(userId, "alert_history", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "alert_history", toolArgs);
            return { data: payload, sourceTimestamp };
        }, { cache: "alerts", cacheArgs: { history: toolArgs } });
        return normalizeAlertHistory(data, provenance);
    }

    async searchSymbols(userId: string, query: string, typeFilter?: string): Promise<ExternalSymbolSearchResult> {
        const { data, provenance } = await withCallContext(userId, "symbol_search", async (ctx) => {
            const { payload, sourceTimestamp } = await runTool(ctx, "symbol_search", {
                query,
                ...(typeFilter ? { type_filter: typeFilter } : {}),
            });
            return { data: payload, sourceTimestamp };
        });
        return normalizeSymbolSearch(query, data, provenance);
    }
}

/** Shared singleton (server-side only). */
export const tradingViewMCPProvider = new TradingViewMCPProvider();

export { READ_TOOLS_ONLY, describeFreshness };
