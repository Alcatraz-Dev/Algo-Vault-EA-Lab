/**
 * External evidence adapter for the Intelligence Layer (PHASE 4/5).
 *
 * Extends the existing intelligence context (lib/market-intelligence/ai/
 * intelligence-layer.ts) with clearly-separated external evidence sections.
 * AlgoVault-native evidence and TradingView evidence are NEVER merged into a
 * single undifferentiated list — provenance is preserved on every item, so
 * the UI and the AI can always explain where an observation came from.
 */
import type {
    ExternalCapability,
    ExternalEvidenceProvenance,
} from "./providers/interfaces/external-intelligence-provider";
import { describeFreshness } from "./providers/tradingview/provenance";

export interface ExternalEvidenceItem {
    capability: ExternalCapability;
    label: string;
    value: string;
    provenance: ExternalEvidenceProvenance;
    /** Machine-readable freshness for UI chips. */
    freshnessLabel: string;
}

export interface ExternalEvidenceSection {
    available: boolean;
    state: "CONNECTED" | "NOT_CONNECTED" | "DISABLED" | "UNAVAILABLE" | "RATE_LIMITED" | "REAUTH_REQUIRED" | "ERROR";
    message?: string;
    items: ExternalEvidenceItem[];
    limitations: string[];
}

const CAPABILITY_LABELS: Record<ExternalCapability, string> = {
    quote: "Quote",
    historical_data: "Historical data",
    technical_snapshot: "Technical snapshot",
    screener: "Screener",
    news: "News",
    economic_calendar: "Economic calendar",
    fundamentals: "Fundamentals",
    filings: "Filings",
    watchlists: "Watchlists",
    alerts: "Alerts",
    alert_history: "Alert history",
    symbol_search: "Symbol search",
    forecasts: "Analyst forecasts",
    financial_history: "Financial history",
    earnings_calendar: "Earnings calendar",
    dividends_calendar: "Dividends calendar",
    economic_data: "Economic data",
};

export function emptyExternalEvidenceSection(state: ExternalEvidenceSection["state"], message?: string): ExternalEvidenceSection {
    return {
        available: false,
        state,
        ...(message ? { message } : {}),
        items: [],
        limitations: [],
    };
}

export const TRADINGVIEW_LIMITATIONS = [
    "TradingView MCP data may be delayed and is not intended for latency-sensitive execution.",
    "TradingView evidence is external context only; AlgoVault deterministic engines remain the source of structure/liquidity/FVG/OB analysis.",
    "Provider classifications (e.g. news urgency, economic importance) are preserved as supplied — AlgoVault does not regrade them.",
] as const;

export function externalSectionFor(
    state: ExternalEvidenceSection["state"],
    message: string | undefined,
    items: ExternalEvidenceItem[],
): ExternalEvidenceSection {
    return {
        available: items.length > 0,
        state,
        ...(message ? { message } : {}),
        items,
        limitations: [...TRADINGVIEW_LIMITATIONS],
    };
}

export function makeEvidenceItem(
    capability: ExternalCapability,
    label: string,
    value: string,
    provenance: ExternalEvidenceProvenance,
): ExternalEvidenceItem {
    return {
        capability,
        label,
        value,
        provenance,
        freshnessLabel: describeFreshness(provenance),
    };
}

export { CAPABILITY_LABELS };
