/**
 * TradingView research adapter (PHASE 7).
 *
 * Adds external research context to the existing Market Intelligence research
 * workflows. AlgoVault's deterministic backtesting engine (next_bar_open, OOS,
 * walk-forward, Monte Carlo, replay) is NEVER replaced or influenced by
 * TradingView data — this module produces research CONTEXT only.
 */
import { tradingViewMCPProvider } from "../providers/tradingview";
import { getTradingViewFlags } from "../providers/tradingview/feature-flags";
import { ExternalProviderError } from "../providers/interfaces/external-intelligence-provider";
import type {
    ExternalEconomicEvent,
    ExternalEvidenceProvenance,
    ExternalNewsItem,
    ExternalScreenerResult,
    ExternalTechnicalSnapshot,
} from "../providers/interfaces/external-intelligence-provider";

export type ResearchContextKind =
    | "historical_context"
    | "cross_asset"
    | "news_context"
    | "economic_calendar"
    | "screener_candidates"
    | "fundamentals"
    | "alert_postmortem";

export interface TradingViewResearchSection {
    kind: ResearchContextKind;
    available: boolean;
    state: string;
    message?: string;
    provenance?: ExternalEvidenceProvenance;
    summary: string;
}

export interface TradingViewResearchContext {
    available: boolean;
    sections: TradingViewResearchSection[];
    limitations: string[];
}

const LIMITATIONS = [
    "TradingView research context is external and may be delayed.",
    "AlgoVault backtesting (next_bar_open execution, no future leakage, OOS, walk-forward, Monte Carlo, replay) is deterministic and unaffected by TradingView data.",
] as const;

function errorState(err: unknown): { state: string; message: string } {
    if (err instanceof ExternalProviderError) {
        return { state: err.code, message: err.message };
    }
    return { state: "UNAVAILABLE", message: err instanceof Error ? err.message : "TradingView research context unavailable." };
}

function cap(value: string | null | undefined, max = 200): string {
    if (!value) return "";
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Build research context for a symbol. Each section degrades independently.
 */
export async function buildTradingViewResearchContext(
    uid: string,
    symbol: string,
    options: {
        includeTechnicals?: boolean;
        includeNews?: boolean;
        includeEconomicCalendar?: boolean;
        includeFundamentals?: boolean;
        interval?: string;
    } = {},
): Promise<TradingViewResearchContext> {
    const flags = getTradingViewFlags();
    const sections: TradingViewResearchSection[] = [];

    if (!flags.master) {
        return {
            available: false,
            sections: [],
            limitations: ["TradingView MCP integration is disabled."],
        };
    }

    const sym = symbol.toUpperCase();

    if (options.includeTechnicals !== false) {
        try {
            const snap: ExternalTechnicalSnapshot = await tradingViewMCPProvider.getTechnicalSnapshot(
                uid,
                sym,
                options.interval ?? "1D",
            );
            const top = Object.entries(snap.indicators).slice(0, 8);
            sections.push({
                kind: "historical_context",
                available: true,
                state: "CONNECTED",
                provenance: snap.provenance,
                summary: `Technicals: ${top.map(([k, v]) => `${k}=${v ?? "n/a"}`).join(", ") || "no readings"}`,
            });
        } catch (err) {
            const e = errorState(err);
            sections.push({ kind: "historical_context", available: false, state: e.state, message: e.message, summary: "" });
        }
    }

    if (options.includeNews !== false) {
        try {
            const items: ExternalNewsItem[] = await tradingViewMCPProvider.getNews(uid, sym, { limit: 5 });
            sections.push({
                kind: "news_context",
                available: items.length > 0,
                state: items.length > 0 ? "CONNECTED" : "EMPTY",
                provenance: items[0]?.provenance,
                summary: items.map((n) => `- ${cap(n.title)}`).join("\n") || "No recent headlines.",
            });
        } catch (err) {
            const e = errorState(err);
            sections.push({ kind: "news_context", available: false, state: e.state, message: e.message, summary: "" });
        }
    }

    if (options.includeEconomicCalendar !== false) {
        try {
            const events: ExternalEconomicEvent[] = await tradingViewMCPProvider.getEconomicCalendar(uid, {
                countries: "US,EU,GB,JP,CN",
                minImportance: 0 as -1 | 0 | 1,
            });
            sections.push({
                kind: "economic_calendar",
                available: events.length > 0,
                state: events.length > 0 ? "CONNECTED" : "EMPTY",
                provenance: events[0]?.provenance,
                summary:
                    events
                        .slice(0, 6)
                        .map((e) => {
                            const when = e.eventTime ? new Date(e.eventTime * 1000).toISOString().slice(0, 16) : "?";
                            const imp = e.importanceLabel ?? "unclassified";
                            return `- (${when}) [${imp}] ${e.currency ?? ""} ${cap(e.title)}`.trim();
                        })
                        .join("\n") || "No upcoming macro events in window.",
            });
        } catch (err) {
            const e = errorState(err);
            sections.push({ kind: "economic_calendar", available: false, state: e.state, message: e.message, summary: "" });
        }
    }

    if (options.includeFundamentals) {
        try {
            const fund = await tradingViewMCPProvider.getFundamentals(uid, sym);
            const entries = Object.entries(fund.metrics).slice(0, 8);
            sections.push({
                kind: "fundamentals",
                available: entries.length > 0,
                state: entries.length > 0 ? "CONNECTED" : "EMPTY",
                provenance: fund.provenance,
                summary: entries.map(([k, v]) => `${k}=${v ?? "n/a"}`).join(", ") || "No fundamental metrics.",
            });
        } catch (err) {
            const e = errorState(err);
            sections.push({ kind: "fundamentals", available: false, state: e.state, message: e.message, summary: "" });
        }
    }

    return {
        available: sections.some((s) => s.available),
        sections,
        limitations: [...LIMITATIONS],
    };
}

/**
 * Screener candidate discovery (PHASE 8): run the TradingView screener and
 * return candidate symbols for AlgoVault Intelligence analysis. Results are
 * research candidates only — never auto-converted into signals.
 */
export async function discoverScreenerCandidates(
    uid: string,
    options: {
        market?: string;
        filters?: Record<string, unknown>;
        filterPreset?: string;
        limit?: number;
        sortBy?: string;
        sortOrder?: "asc" | "desc";
    } = {},
): Promise<{ candidates: string[]; result: ExternalScreenerResult | null; state: string; message?: string }> {
    const flags = getTradingViewFlags();
    if (!flags.master || !flags.screener) {
        return { candidates: [], result: null, state: "DISABLED", message: "TradingView screener is disabled." };
    }
    try {
        const result = await tradingViewMCPProvider.runScreener(uid, {
            market: options.market ?? "america",
            ...(options.filters ? { filters: options.filters } : {}),
            ...(options.filterPreset ? { filterPreset: options.filterPreset } : {}),
            limit: Math.min(100, options.limit ?? 25),
            ...(options.sortBy ? { sortBy: options.sortBy } : {}),
            ...(options.sortOrder ? { sortOrder: options.sortOrder } : {}),
        });
        return {
            candidates: result.rows.map((r) => r.symbol).filter(Boolean),
            result,
            state: "CONNECTED",
        };
    } catch (err) {
        const e = errorState(err);
        return { candidates: [], result: null, state: e.state, message: e.message };
    }
}
