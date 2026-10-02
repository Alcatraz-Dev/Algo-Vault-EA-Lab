/**
 * Multi-source intelligence service (PHASE 5/7 server core).
 *
 * Gathers AlgoVault-native context (existing deterministic analytics) plus
 * optional TradingView MCP external context, returning a structured payload
 * the AI Terminal can render and hand to the AI Router. Fail-closed: any
 * TradingView problem degrades to AlgoVault-only with an explicit status.
 */
import type { ExternalEvidenceProvenance, ExternalEconomicEvent, ExternalNewsItem, ExternalTechnicalSnapshot } from "../providers/interfaces/external-intelligence-provider";
import { ExternalProviderError } from "../providers/interfaces/external-intelligence-provider";
import { tradingViewMCPProvider } from "../providers/tradingview";
import { getTradingViewFlags } from "../providers/tradingview/feature-flags";
import {
    emptyExternalEvidenceSection,
    externalSectionFor,
    makeEvidenceItem,
    type ExternalEvidenceSection,
} from "../external-evidence";
import type { ExternalProviderErrorCode } from "./external-error-codes";

export type ExternalSectionState = ExternalEvidenceSection["state"];

export interface MultiSourceIntelligenceInput {
    uid: string;
    symbol: string;
    timeframe: string;
    includeTechnicals?: boolean;
    includeNews?: boolean;
    includeEconomicCalendar?: boolean;
    /** ISO currency matching the symbol (e.g. XAUUSD → USD) for the calendar filter. */
    currency?: string;
}

export interface MultiSourceIntelligenceResult {
    tradingview: {
        technicals: ExternalEvidenceSection;
        news: ExternalEvidenceSection;
        economicCalendar: ExternalEvidenceSection;
    };
    /** True when at least one TradingView section returned evidence. */
    anyExternalEvidence: boolean;
    /** AI prompt section describing external evidence (labelled). */
    aiEvidenceText: string;
    /** Limitations to attach to every AI answer using external evidence. */
    limitations: string[];
}

function mapCapabilityError(err: unknown): { state: ExternalSectionState; message: string } {
    if (err instanceof ExternalProviderError) {
        switch (err.code) {
            case "DISABLED":
                return { state: "DISABLED", message: err.message };
            case "NOT_CONNECTED":
                return { state: "NOT_CONNECTED", message: err.message };
            case "REAUTH_REQUIRED":
            case "TOKEN_EXPIRED":
                return { state: "REAUTH_REQUIRED", message: err.message };
            case "RATE_LIMITED":
                return { state: "RATE_LIMITED", message: err.message };
            default:
                return { state: "UNAVAILABLE", message: err.message };
        }
    }
    return { state: "UNAVAILABLE", message: err instanceof Error ? err.message : "TradingView context unavailable." };
}

export type { ExternalProviderErrorCode };

function cap(value: string | null | undefined, max = 240): string {
    if (!value) return "";
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

function summarizeTechnicals(snapshot: ExternalTechnicalSnapshot): string {
    const entries = Object.entries(snapshot.indicators).slice(0, 12);
    const indicatorLines = entries.map(([k, v]) => `${k}=${v === null ? "n/a" : String(v)}`);
    const rec = snapshot.recommendation ? ` | provider rating: ${snapshot.recommendation.classification}` : "";
    return indicatorLines.length > 0 ? `${indicatorLines.join(", ")}${rec}` : "no indicator readings returned";
}

function summarizeNews(items: ExternalNewsItem[], max = 5): string {
    return items
        .slice(0, max)
        .map((n) => {
            const when = n.publishedAt ? new Date(n.publishedAt * 1000).toISOString().slice(0, 16) : "unknown time";
            const urgency = typeof n.urgency === "number" ? ` [urgency ${n.urgency}]` : "";
            return `- (${when}${urgency}) ${cap(n.title)}`;
        })
        .join("\n");
}

function summarizeEconomicEvents(events: ExternalEconomicEvent[], max = 6): string {
    return events
        .slice(0, max)
        .map((e) => {
            const when = e.eventTime ? new Date(e.eventTime * 1000).toISOString().slice(0, 16) : "unknown time";
            const importance = e.importanceLabel ?? (e.importance !== null ? String(e.importance) : "unclassified");
            return `- (${when}) [${importance}] ${e.currency ?? e.country ?? ""} ${cap(e.title)}`.trim();
        })
        .join("\n");
}

export async function gatherMultiSourceIntelligence(input: MultiSourceIntelligenceInput): Promise<MultiSourceIntelligenceResult> {
    const flags = getTradingViewFlags();
    const uid = input.uid;
    const symbol = input.symbol.toUpperCase();
    const limitations = [
        "TradingView MCP data may be delayed and is not intended for latency-sensitive execution.",
        "AI interpretation must cite the evidence sections above; do not invent prices, levels or classifications.",
    ];

    if (!flags.master) {
        const disabled = emptyExternalEvidenceSection("DISABLED", "TradingView MCP integration is disabled.");
        return {
            tradingview: { technicals: disabled, news: disabled, economicCalendar: disabled },
            anyExternalEvidence: false,
            aiEvidenceText: "TRADINGVIEW EVIDENCE: integration disabled — analysis uses AlgoVault evidence only.",
            limitations,
        };
    }

    // ── Technical snapshot ──────────────────────────────────────────────────
    let technicals: ExternalEvidenceSection = emptyExternalEvidenceSection("NOT_CONNECTED", "TradingView is not connected.");
    if (input.includeTechnicals !== false) {
        try {
            const snapshot = await tradingViewMCPProvider.getTechnicalSnapshot(uid, symbol, mapTimeframe(input.timeframe));
            technicals = externalSectionFor("CONNECTED", undefined, [
                makeEvidenceItem("technical_snapshot", `Technical snapshot (${symbol} ${snapshot.interval})`, summarizeTechnicals(snapshot), snapshot.provenance),
            ]);
        } catch (err) {
            const mapped = mapCapabilityError(err);
            technicals = emptyExternalEvidenceSection(mapped.state, mapped.message);
        }
    }

    // ── News ────────────────────────────────────────────────────────────────
    let news: ExternalEvidenceSection = emptyExternalEvidenceSection("NOT_CONNECTED", "TradingView is not connected.");
    if (input.includeNews && flags.news) {
        try {
            const items = await tradingViewMCPProvider.getNews(uid, symbol, { limit: 5 });
            news = externalSectionFor(
                "CONNECTED",
                undefined,
                items.length > 0
                    ? [makeEvidenceItem("news", `Latest news (${symbol})`, summarizeNews(items), items[0].provenance)]
                    : [],
            );
        } catch (err) {
            const mapped = mapCapabilityError(err);
            news = emptyExternalEvidenceSection(mapped.state, mapped.message);
        }
    }

    // ── Economic calendar ───────────────────────────────────────────────────
    let economicCalendar: ExternalEvidenceSection = emptyExternalEvidenceSection("NOT_CONNECTED", "TradingView is not connected.");
    if (input.includeEconomicCalendar && flags.economicCalendar) {
        try {
            const events = await tradingViewMCPProvider.getEconomicCalendar(uid, {
                countries: "US,EU,GB,JP,CN",
                ...(input.currency ? { currencies: input.currency } : {}),
                minImportance: 0 as -1 | 0 | 1,
            });
            economicCalendar = externalSectionFor(
                "CONNECTED",
                undefined,
                events.length > 0
                    ? [makeEvidenceItem("economic_calendar", "Upcoming macro events", summarizeEconomicEvents(events), events[0].provenance)]
                    : [],
            );
        } catch (err) {
            const mapped = mapCapabilityError(err);
            economicCalendar = emptyExternalEvidenceSection(mapped.state, mapped.message);
        }
    }

    const anyExternalEvidence = [technicals, news, economicCalendar].some((s) => s.available);

    const lines: string[] = ["TRADINGVIEW EVIDENCE (external provider — may be delayed; context only):"];
    if (technicals.available) {
        const item = technicals.items[0];
        lines.push(`- TECHNICALS [TradingView, ${item.freshnessLabel}]: ${item.value}`);
    } else {
        lines.push(`- TECHNICALS: unavailable (${technicals.state})`);
    }
    if (news.available && news.items[0]) {
        lines.push(`- NEWS [TradingView, ${news.items[0].freshnessLabel}]:\n${news.items[0].value}`);
    } else {
        lines.push(`- NEWS: unavailable (${news.state})`);
    }
    if (economicCalendar.available && economicCalendar.items[0]) {
        lines.push(`- ECONOMIC CALENDAR [TradingView, ${economicCalendar.items[0].freshnessLabel}]:\n${economicCalendar.items[0].value}`);
    } else {
        lines.push(`- ECONOMIC CALENDAR: unavailable (${economicCalendar.state})`);
    }

    return {
        tradingview: { technicals, news, economicCalendar },
        anyExternalEvidence,
        aiEvidenceText: lines.join("\n"),
        limitations: [...limitations, ...(technicals.available || news.available || economicCalendar.available ? [] : ["TradingView context was unavailable; the analysis below is AlgoVault-only."])],
    };
}

/** TradingView interval → MCP interval token (docs: 1m 5m 15m 30m 1h 2h 4h 1D 1W 1M). */
export function mapTimeframe(timeframe: string): string {
    const tf = timeframe.toUpperCase();
    if (["M1", "M3"].includes(tf)) return "1m";
    if (tf === "M5") return "5m";
    if (tf === "M15") return "15m";
    if (tf === "M30") return "30m";
    if (tf === "H1") return "1h";
    if (tf === "H4") return "4h";
    if (tf === "D1") return "1D";
    if (tf === "W1") return "1W";
    return "1D";
}
