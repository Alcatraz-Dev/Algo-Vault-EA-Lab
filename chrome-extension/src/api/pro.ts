/**
 * AlgoVault Pro Trading Intelligence — premium-extension API client.
 *
 * Every endpoint on this surface is server-side Pro gated. The extension
 * never relies on a client-supplied `isPro` flag — it asks the server
 * via `getProAccess()` and caches the answer. Even when the access call
 * fails, the cached value is preserved; on success the cache is refreshed.
 *
 * No TradingView credentials, server credentials or upstream MCP tokens
 * are exposed here — only normalised responses.
 */
import { getAuthToken } from "@/storage/storage";
import type {
    ProAccess,
    ProFeatureFlags,
    MCPContextResponse,
    SetupRadarSnapshot,
    SmartAlert,
    MTFResponse,
    GeneratedIndicator,
    GeneratedStrategy,
    PreTradeChecklistResponse,
    WhatAmIMissingResponse,
    SetupReplayResponse,
    StrategyHealthResponse,
    MarketRadarResponse,
    CopilotMemoryContext,
    EvidenceScoreBreakdown,
} from "@/types/pro";
import { getAlgoVaultUrl } from "@/config/environment";

const EXT_PREFIX = "[AlgoVault Pro]";

/* ── shared fetcher ─────────────────────────────────────────────────── */

async function baseHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
}

async function baseUrl(): Promise<string> {
    return getAlgoVaultUrl();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
    const url = await baseUrl();
    const headers = await baseHeaders();
    console.log(`${EXT_PREFIX} POST ${url}${path}`);
    const res = await fetch(`${url}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `API error ${res.status}`);
    }
    return res.json();
}

async function getJson<T>(path: string): Promise<T> {
    const url = await baseUrl();
    const headers = await baseHeaders();
    console.log(`${EXT_PREFIX} GET ${url}${path}`);
    const res = await fetch(`${url}${path}`, { method: "GET", headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `API error ${res.status}`);
    }
    return res.json();
}

/* ── Pro entitlement (cached) ───────────────────────────────────────── */

const PRO_CACHE_KEY = "proAccessCache";
const PRO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FLAG_CACHE_KEY = "proFlagCache";
const FLAG_CACHE_TTL_MS = 60 * 1000; // 1 minute (flags change rarely)

interface ProCacheEntry {
    access: ProAccess;
    cachedAt: number;
}

interface FlagCacheEntry {
    flags: ProFeatureFlags;
    cachedAt: number;
}

async function readProCache(): Promise<ProAccess | null> {
    return new Promise((resolve) => {
        chrome.storage.local.get(PRO_CACHE_KEY, (result) => {
            const v = result[PRO_CACHE_KEY] as ProCacheEntry | undefined;
            if (!v) return resolve(null);
            if (Date.now() - v.cachedAt > PRO_CACHE_TTL_MS) return resolve(null);
            resolve(v.access);
        });
    });
}

async function writeProCache(access: ProAccess): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [PRO_CACHE_KEY]: { access, cachedAt: Date.now() } satisfies ProCacheEntry }, () => resolve());
    });
}

async function readFlagCache(): Promise<ProFeatureFlags | null> {
    return new Promise((resolve) => {
        chrome.storage.local.get(FLAG_CACHE_KEY, (result) => {
            const v = result[FLAG_CACHE_KEY] as FlagCacheEntry | undefined;
            if (!v) return resolve(null);
            if (Date.now() - v.cachedAt > FLAG_CACHE_TTL_MS) return resolve(null);
            resolve(v.flags);
        });
    });
}

async function writeFlagCache(flags: ProFeatureFlags): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [FLAG_CACHE_KEY]: { flags, cachedAt: Date.now() } satisfies FlagCacheEntry }, () => resolve());
    });
}

/**
 * Server-side Pro access check. Cached for 5 minutes so the popup doesn't
   hammer the endpoint on every view mount. On 401/403 the cache is dropped.
 */
export async function getProAccess(force = false): Promise<ProAccess> {
    if (!force) {
        const cached = await readProCache();
        if (cached) return cached;
    }
    try {
        const result = await getJson<ProAccess>("/api/extension/pro-access");
        await writeProCache(result);
        return result;
    } catch (err) {
        // On failure, clear the cache so a stale "granted" never lingers.
        return new Promise((resolve) => {
            chrome.storage.local.remove(PRO_CACHE_KEY, () => {
                resolve({
                    access: "denied",
                    reason: err instanceof Error ? err.message : "unknown",
                    timestamp: Date.now(),
                });
            });
        });
    }
}

/** Cheap helper for views that just need a boolean. */
export async function isPro(force = false): Promise<boolean> {
    const access = await getProAccess(force);
    return access.access === "granted";
}

export async function getProFeatureFlags(force = false): Promise<ProFeatureFlags> {
    if (!force) {
        const cached = await readFlagCache();
        if (cached) return cached;
    }
    try {
        const result = await getJson<{ success: boolean; flags: ProFeatureFlags }>("/api/extension/pro-feature-flag");
        await writeFlagCache(result.flags);
        return result.flags;
    } catch {
        return new Promise((resolve) => {
            chrome.storage.local.remove(FLAG_CACHE_KEY, () => {
                resolve({
                    tradingViewProExtension: false,
                    aiChartCopilot: false,
                    setupRadar: false,
                    smartAlerts: false,
                    aiIndicatorGenerator: false,
                    aiStrategyGenerator: false,
                    mtfIntelligence: false,
                    commandBar: false,
                    liveIntelligencePanel: false,
                    copilotMemory: false,
                    preTradeChecklist: false,
                    historicalReplay: false,
                    strategyHealth: false,
                    marketRadar: false,
                    visualStrategyBuilder: false,
                    researchPipeline: false,
                    aiOverlay: false,
                    proCommandCenter: false,
                    tradingViewExecutionBridge: false,
                });
            });
        });
    }
}

/* ── TradingView MCP context ────────────────────────────────────────── */

export async function fetchMCPContext(symbol: string, timeframe: string, exchange?: string | null): Promise<MCPContextResponse> {
    return postJson<MCPContextResponse>("/api/extension/mcp-context", {
        symbol,
        timeframe,
        exchange: exchange ?? null,
    });
}

/* ── Setup Radar ────────────────────────────────────────────────────── */

export interface SetupRadarRequest {
    symbol: string;
    timeframe: string;
    chartContext?: unknown;
    marketContext?: unknown;
}

export async function fetchSetupRadar(req: SetupRadarRequest): Promise<SetupRadarSnapshot> {
    return postJson<SetupRadarSnapshot>("/api/extension/setup-radar", req);
}

export async function dismissSetup(setupId: string): Promise<{ ok: boolean }> {
    return postJson<{ ok: boolean }>("/api/extension/setup-radar/dismiss", { id: setupId });
}

export async function backtestSetup(setupId: string, symbol: string, timeframe: string): Promise<{ backtestId: string | null; url: string }> {
    return postJson<{ backtestId: string | null; url: string }>("/api/extension/setup-radar/backtest", {
        id: setupId,
        symbol,
        timeframe,
    });
}

/* ── Smart Alerts ───────────────────────────────────────────────────── */

export async function fetchSmartAlerts(symbol: string, timeframe: string, sinceMs?: number): Promise<SmartAlert[]> {
    return postJson<{ alerts: SmartAlert[] }>("/api/extension/smart-alerts", {
        symbol,
        timeframe,
        sinceMs: sinceMs ?? null,
    }).then((r) => r.alerts);
}

export async function markAlertRead(alertId: string): Promise<{ ok: boolean }> {
    return postJson<{ ok: boolean }>("/api/extension/smart-alerts/ack", { id: alertId });
}

/* ── Multi-Timeframe Intelligence ───────────────────────────────────── */

export async function fetchMTFIntelligence(symbol: string, baseTimeframe: string): Promise<MTFResponse> {
    return postJson<MTFResponse>("/api/extension/mtf", { symbol, baseTimeframe });
}

/* ── AI Indicator Generator ─────────────────────────────────────────── */

export interface IndicatorRequest {
    description: string;
    symbolScope: string;
    timeframe: string;
}

export interface IndicatorResponse {
    indicator: GeneratedIndicator;
}

export async function generateIndicator(req: IndicatorRequest): Promise<GeneratedIndicator> {
    const result = await postJson<IndicatorResponse>("/api/extension/ai-indicator", req);
    return result.indicator;
}

export async function listIndicators(): Promise<GeneratedIndicator[]> {
    return getJson<{ indicators: GeneratedIndicator[] }>("/api/extension/ai-indicator").then((r) => r.indicators);
}

export async function archiveIndicator(indicatorId: string): Promise<{ ok: boolean }> {
    return postJson<{ ok: boolean }>("/api/extension/ai-indicator/archive", { id: indicatorId });
}

/* ── AI Strategy Generator ──────────────────────────────────────────── */

export interface StrategyRequest {
    description: string;
    symbolScope: string;
    timeframe: string;
}

export async function generateStrategy(req: StrategyRequest): Promise<GeneratedStrategy> {
    const result = await postJson<{ strategy: GeneratedStrategy }>("/api/extension/ai-strategy", req);
    return result.strategy;
}

export async function handoffStrategyToBacktest(strategyId: string, symbol: string, timeframe: string): Promise<{ backtestId: string | null; url: string }> {
    return postJson<{ backtestId: string | null; url: string }>("/api/extension/ai-strategy/backtest", {
        id: strategyId,
        symbol,
        timeframe,
    });
}

export async function listStrategies(): Promise<GeneratedStrategy[]> {
    return getJson<{ strategies: GeneratedStrategy[] }>("/api/extension/ai-strategy").then((r) => r.strategies);
}

/* ── Pre-Trade Checklist ─────────────────────────────────────────────── */

export async function fetchPreTradeChecklist(symbol: string, timeframe: string): Promise<PreTradeChecklistResponse> {
    return postJson<PreTradeChecklistResponse>("/api/extension/pretrade-checklist", { symbol, timeframe });
}

/* ── What Am I Missing? ──────────────────────────────────────────────── */

export async function fetchWhatAmIMissing(symbol: string, timeframe: string): Promise<WhatAmIMissingResponse> {
    return postJson<WhatAmIMissingResponse>("/api/extension/what-am-i-missing", { symbol, timeframe });
}

/* ── Historical Setup Replay ─────────────────────────────────────────── */

export async function fetchSetupReplay(symbol: string, timeframe: string): Promise<SetupReplayResponse> {
    return postJson<SetupReplayResponse>("/api/extension/setup-replay", { symbol, timeframe });
}

/* ── Strategy Health Monitor ─────────────────────────────────────────── */

export async function fetchStrategyHealth(symbol: string, timeframe: string): Promise<StrategyHealthResponse> {
    return postJson<StrategyHealthResponse>("/api/extension/strategy-health", { symbol, timeframe });
}

/* ── Market Radar ────────────────────────────────────────────────────── */

export async function fetchMarketRadar(symbols: string[], timeframe: string): Promise<MarketRadarResponse> {
    return postJson<MarketRadarResponse>("/api/extension/market-radar", { symbols, timeframe });
}

/* ── Copilot Intelligence Memory ─────────────────────────────────────── */

export async function fetchCopilotMemory(symbol: string, timeframe: string): Promise<CopilotMemoryContext> {
    const res = await postJson<{ memoryContext: CopilotMemoryContext }>("/api/extension/copilot-memory", { symbol, timeframe });
    return res.memoryContext;
}

/* ── Evidence Score ──────────────────────────────────────────────────── */

export async function fetchEvidenceScore(symbol: string, timeframe: string): Promise<EvidenceScoreBreakdown> {
    return postJson<EvidenceScoreBreakdown>("/api/extension/evidence-score", { symbol, timeframe });
}