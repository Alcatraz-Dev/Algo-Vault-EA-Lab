// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — External Intelligence Tools (TradingView MCP)
//
// Exposes TradingView MCP capabilities to the AlgoVault Agent through the
// existing controlled tool registry (defineTool + TOOL_DECLARATIONS + policy
// engine). Every tool:
//   • requires the agent permission "network_access" for external providers —
//     but TradingView tools are restricted further by the MCP permission
//     model (read-only capability flags; user's own connection only).
//   • enforces a timeout and returns a ToolResult (never throws).
//   • fails safe: TradingView problems degrade to an explicit unavailable
//     result; the agent never fabricates data.
//   • is audited via the existing agent event stream (emit) — no secrets.
//
// Writes (alerts/watchlist mutations) are NOT exposed — read-only first.
// ─────────────────────────────────────────────────────────────────────────────

import { defineTool } from "../core/types";
import type { ToolResult } from "../core/types";
import { tradingViewMCPProvider } from "@/lib/market-intelligence/providers/tradingview";
import { ExternalProviderError } from "@/lib/market-intelligence/providers/interfaces/external-intelligence-provider";
import { getTradingViewFlags } from "@/lib/market-intelligence/providers/tradingview/feature-flags";

const TOOL_TIMEOUT_HINT = "15s per call; provider rate limits apply (~60/min per user).";

function fail(code: string, message: string): ToolResult {
    return { ok: false, error: message, code };
}

function fromProviderError(err: unknown): ToolResult {
    if (err instanceof ExternalProviderError) {
        return fail(`tradingview_${err.code.toLowerCase()}`, err.message);
    }
    return fail("tradingview_unknown_error", err instanceof Error ? err.message : "TradingView MCP call failed.");
}

function requireEnabled(): ToolResult | null {
    const flags = getTradingViewFlags();
    if (!flags.master) {
        return fail("tradingview_disabled", "TradingView MCP integration is disabled (TRADINGVIEW_MCP_ENABLED).");
    }
    return null;
}

function strArg(args: Record<string, unknown>, key: string): string | null {
    const v = args[key];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export const tradingviewStatusTool = defineTool(
    {
        id: "tradingview.status",
        description:
            "Check the caller's TradingView MCP connection status and supported capabilities. Read-only, no market data returned.",
        category: "context",
        argsHint: "{} — no arguments",
    },
    async (args, ctx) => {
        const disabled = requireEnabled();
        if (disabled) return disabled;
        try {
            const status = await tradingViewMCPProvider.getConnectionStatus(ctx.uid);
            const capabilities = tradingViewMCPProvider.describeCapabilities().filter((c) => c.supported);
            return {
                ok: true,
                output: `TradingView MCP: ${status.state}${status.message ? ` (${status.message})` : ""}. Supported capabilities: ${capabilities.map((c) => c.id).join(", ") || "none"}.`,
                data: { state: status.state, scopes: status.scopes, capabilities: capabilities.map((c) => c.id) },
            };
        } catch (err) {
            return fromProviderError(err);
        }
    },
);

export const tradingviewTechnicalsTool = defineTool(
    {
        id: "tradingview.technicals",
        description: `Fetch a TradingView technical indicator snapshot (RSI, MACD, ADX, MAs, rating aggregates) for one symbol. ${TOOL_TIMEOUT_HINT}`,
        category: "context",
        argsHint: '{ "symbol": "NASDAQ:AAPL", "interval": "1D" } — interval: 1m|5m|15m|30m|1h|2h|4h|1D|1W|1M',
    },
    async (args, ctx) => {
        const disabled = requireEnabled();
        if (disabled) return disabled;
        const symbol = strArg(args, "symbol");
        if (!symbol) return fail("invalid_args", 'symbol is required, e.g. "NASDAQ:AAPL".');
        const interval = strArg(args, "interval") ?? "1D";
        try {
            const snap = await tradingViewMCPProvider.getTechnicalSnapshot(ctx.uid, symbol, interval);
            const top = Object.entries(snap.indicators).slice(0, 14);
            const lines = [
                `TradingView technicals for ${symbol} (${interval}) [${snap.provenance.freshness}${snap.provenance.delayed ? ", delayed" : ""}]:`,
                ...top.map(([k, v]) => `- ${k}: ${v ?? "n/a"}`),
                snap.recommendation ? `- provider rating: ${snap.recommendation.classification}` : "",
            ].filter(Boolean);
            return { ok: true, output: lines.join("\n"), data: { indicators: snap.indicators, recommendation: snap.recommendation, provenance: snap.provenance } };
        } catch (err) {
            return fromProviderError(err);
        }
    },
);

export const tradingviewNewsTool = defineTool(
    {
        id: "tradingview.news",
        description: `Fetch recent TradingView news headlines for one symbol. ${TOOL_TIMEOUT_HINT}`,
        category: "context",
        argsHint: '{ "symbol": "NASDAQ:AAPL", "limit": 5 }',
    },
    async (args, ctx) => {
        const disabled = requireEnabled();
        if (disabled) return disabled;
        const symbol = strArg(args, "symbol");
        if (!symbol) return fail("invalid_args", "symbol is required.");
        const limit = Math.min(20, Math.max(1, typeof args.limit === "number" ? args.limit : 5));
        try {
            const items = await tradingViewMCPProvider.getNews(ctx.uid, symbol, { limit });
            if (items.length === 0) {
                return { ok: true, output: `No recent TradingView headlines for ${symbol}.`, data: { items: [] } };
            }
            const lines = items.map((n) => {
                const when = n.publishedAt ? new Date(n.publishedAt * 1000).toISOString().slice(0, 16) : "?";
                return `- (${when}${n.urgency != null ? `, urgency ${n.urgency}` : ""}) ${n.title}`;
            });
            return { ok: true, output: `TradingView news for ${symbol} [${items[0].provenance.freshness}]:\n${lines.join("\n")}`, data: { items } };
        } catch (err) {
            return fromProviderError(err);
        }
    },
);

export const tradingviewEconomicCalendarTool = defineTool(
    {
        id: "tradingview.economic_calendar",
        description: `Fetch upcoming TradingView economic calendar events (macro releases) with provider-supplied importance. ${TOOL_TIMEOUT_HINT}`,
        category: "context",
        argsHint: '{ "countries": "US,EU", "minImportance": 0 } — minImportance: -1 all | 0 medium+ | 1 high only',
    },
    async (args, ctx) => {
        const disabled = requireEnabled();
        if (disabled) return disabled;
        try {
            const events = await tradingViewMCPProvider.getEconomicCalendar(ctx.uid, {
                countries: strArg(args, "countries") ?? "US,EU,GB,JP,CN",
                minImportance: (typeof args.minImportance === "number" ? Math.trunc(args.minImportance) : 0) as -1 | 0 | 1,
            });
            if (events.length === 0) {
                return { ok: true, output: "No upcoming economic events in the window.", data: { events: [] } };
            }
            const lines = events.slice(0, 10).map((e) => {
                const when = e.eventTime ? new Date(e.eventTime * 1000).toISOString().slice(0, 16) : "?";
                const imp = e.importanceLabel ?? "unclassified";
                return `- (${when}) [${imp}] ${e.currency ?? e.country ?? ""} ${e.title}`.trim();
            });
            return { ok: true, output: `Upcoming macro events [${events[0].provenance.freshness}]:\n${lines.join("\n")}`, data: { events } };
        } catch (err) {
            return fromProviderError(err);
        }
    },
);

export const tradingviewScreenerTool = defineTool(
    {
        id: "tradingview.screener",
        description: `Run the TradingView screener to discover candidate instruments. Candidates are research inputs for AlgoVault Intelligence — never signals. ${TOOL_TIMEOUT_HINT}`,
        category: "context",
        argsHint: '{ "market": "america", "limit": 10, "filterPreset": "oversold_health" } — presets: pullback_with_reversal, breakout_with_volume, oversold_health, earnings_runup, relative_strength, new_highs',
    },
    async (args, ctx) => {
        const flags = getTradingViewFlags();
        if (!flags.master || !flags.screener) {
            return fail("tradingview_disabled", "TradingView screener is disabled by feature flag.");
        }
        try {
            const { discoverScreenerCandidates } = await import("@/lib/market-intelligence/research/tradingview-research");
            const outcome = await discoverScreenerCandidates(ctx.uid, {
                market: strArg(args, "market") ?? "america",
                limit: typeof args.limit === "number" ? args.limit : 10,
                filterPreset: strArg(args, "filterPreset") ?? undefined,
            });
            if (!outcome.result) {
                return fail(`tradingview_${outcome.state.toLowerCase()}`, outcome.message ?? "Screener unavailable.");
            }
            const lines = [
                `Screener (${outcome.result.market}) returned ${outcome.result.rows.length} candidates [${outcome.result.provenance.freshness}]:`,
                ...outcome.candidates.map((s) => `- ${s}`),
                "",
                "Note: candidates are research inputs; run AlgoVault Smart Money / MTF / liquidity analysis before any conclusion. Never auto-convert to signals.",
            ];
            return { ok: true, output: lines.join("\n"), data: { candidates: outcome.candidates, provenance: outcome.result.provenance } };
        } catch (err) {
            return fromProviderError(err);
        }
    },
);

export const tradingviewWatchlistsTool = defineTool(
    {
        id: "tradingview.watchlists",
        description: "List the caller's TradingView watchlists (read-only). Requires the user's own connected TradingView account.",
        category: "context",
        argsHint: "{} — no arguments",
    },
    async (_args, ctx) => {
        const flags = getTradingViewFlags();
        if (!flags.master || !flags.watchlists) {
            return fail("tradingview_disabled", "TradingView watchlists are disabled by feature flag.");
        }
        try {
            const lists = await tradingViewMCPProvider.getWatchlists(ctx.uid);
            if (lists.length === 0) return { ok: true, output: "No TradingView watchlists found.", data: { lists: [] } };
            const lines = lists.map((w) => `- ${w.name} (${w.id}): ${w.symbolCount ?? "?"} symbols`);
            return { ok: true, output: `Watchlists [${lists[0].provenance.freshness}]:\n${lines.join("\n")}`, data: { lists } };
        } catch (err) {
            return fromProviderError(err);
        }
    },
);

export const tradingviewAlertsTool = defineTool(
    {
        id: "tradingview.alerts",
        description: "List the caller's TradingView alerts and recent fire history (read-only). Creating or modifying alerts is not exposed to the agent.",
        category: "context",
        argsHint: '{ "includeHistory": true, "days": 7 }',
    },
    async (args, ctx) => {
        const flags = getTradingViewFlags();
        if (!flags.master || !flags.alerts) {
            return fail("tradingview_disabled", "TradingView alerts are disabled by feature flag.");
        }
        try {
            const alerts = await tradingViewMCPProvider.getAlerts(ctx.uid);
            const lines = alerts.length > 0
                ? alerts.slice(0, 15).map((a) => `- #${a.id} ${a.symbol} ${a.active ? "active" : "paused"}${a.threshold != null ? ` @ ${a.threshold}` : ""}`)
                : ["No TradingView alerts configured."];
            let output = `Alerts [${alerts[0]?.provenance.freshness ?? "n/a"}]:\n${lines.join("\n")}`;
            if (args.includeHistory) {
                const days = Math.min(30, Math.max(1, typeof args.days === "number" ? args.days : 7));
                const history = await tradingViewMCPProvider.getAlertHistory(ctx.uid, { days, limit: 20 });
                if (history.length > 0) {
                    output += `\n\nRecent fires (${days}d):\n${history.map((h) => `- #${h.alertId} ${h.symbol} @ ${h.firedAt ? new Date(h.firedAt * 1000).toISOString().slice(0, 16) : "?"}`).join("\n")}`;
                }
            }
            return { ok: true, output, data: { alerts } };
        } catch (err) {
            return fromProviderError(err);
        }
    },
);

export const TRADINGVIEW_AGENT_TOOLS = [
    tradingviewStatusTool,
    tradingviewTechnicalsTool,
    tradingviewNewsTool,
    tradingviewEconomicCalendarTool,
    tradingviewScreenerTool,
    tradingviewWatchlistsTool,
    tradingviewAlertsTool,
];
