/**
 * Feature flags for the TradingView MCP integration (PHASE 22).
 *
 * Fail-closed by default: the master flag must be explicitly enabled. When
 * disabled, no TradingView requests are made, no UI errors occur, and existing
 * AlgoVault behaviour is unchanged.
 *
 * All flags are server-side env reads (never NEXT_PUBLIC_*); the client learns
 * only the effective boolean state through authenticated API responses.
 */

const truthy = (value: string | undefined): boolean => {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
};

export interface TradingViewFeatureFlags {
    master: boolean;
    news: boolean;
    technicals: boolean;
    screener: boolean;
    economicCalendar: boolean;
    fundamentals: boolean;
    watchlists: boolean;
    alerts: boolean;
}

function readFlags(): TradingViewFeatureFlags {
    const master = truthy(process.env.TRADINGVIEW_MCP_ENABLED);
    return {
        master,
        news: master && truthy(process.env.TRADINGVIEW_MCP_NEWS ?? "1"),
        technicals: master && truthy(process.env.TRADINGVIEW_MCP_TECHNICALS ?? "1"),
        screener: master && truthy(process.env.TRADINGVIEW_MCP_SCREENER ?? "1"),
        economicCalendar: master && truthy(process.env.TRADINGVIEW_MCP_ECONOMIC_CALENDAR ?? "1"),
        fundamentals: master && truthy(process.env.TRADINGVIEW_MCP_FUNDAMENTALS ?? "1"),
        watchlists: master && truthy(process.env.TRADINGVIEW_MCP_WATCHLISTS ?? "1"),
        alerts: master && truthy(process.env.TRADINGVIEW_MCP_ALERTS ?? "1"),
    };
}

let cachedFlags: { value: TradingViewFeatureFlags; at: number } | null = null;
const FLAG_CACHE_MS = 5_000;

/** Effective flags (short TTL cache to keep hot paths cheap). */
export function getTradingViewFlags(): TradingViewFeatureFlags {
    const now = Date.now();
    if (!cachedFlags || now - cachedFlags.at > FLAG_CACHE_MS) {
        cachedFlags = { value: readFlags(), at: now };
    }
    return cachedFlags.value;
}

/** Test hook: drop the cached flag snapshot. */
export function resetTradingViewFlagsCache(): void {
    cachedFlags = null;
}

/** Client-safe projection (booleans only — no env var names or secrets). */
export function publicTradingViewFlags(): TradingViewFeatureFlags {
    return getTradingViewFlags();
}
