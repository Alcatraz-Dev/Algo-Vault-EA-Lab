/**
 * Capability ↔ MCP tool mapping + response normalizers for the official
 * TradingView MCP server (verified against https://www.tradingview.com/mcp/docs).
 *
 * The toolset (beta) includes: watchlists (list/get/active), market data
 * (get_ohlcv, get_economic_data, get_economic_symbols), symbol search,
 * screener (get_symbol_data, run_screener, get_symbol_data_batch,
 * get_screener_columns, get_technicals_rating), news (get_news,
 * get_news_story), fundamentals (get_forecasts, get_financials,
 * get_financial_history), documents (get_documents, get_document_view),
 * calendars (get_earnings_calendar, get_economic_calendar,
 * get_dividends_calendar) and alerts (list/get/log + write tools).
 *
 * Only READ tools are mapped here. Write tools (create/update/delete alerts,
 * watchlist mutations) are deliberately NOT exposed yet (PHASE 10: read-only
 * first; writes later with explicit confirmation + audit).
 */
import type { ExternalCapability, CapabilityDescriptor } from "../interfaces/external-intelligence-provider";
import type { McpCallToolResult } from "./mcp-client";

// ── Capability → tool mapping ───────────────────────────────────────────────

export interface CapabilityToolMap {
    primary: string;
    /** Accepted alternates when the beta toolset renames/ships tools. */
    alternates?: readonly string[];
    read: boolean;
}

export const CAPABILITY_TOOLS: Record<ExternalCapability, CapabilityToolMap> = {
    quote: { primary: "get_symbol_data_batch", read: true },
    historical_data: { primary: "get_ohlcv", read: true },
    technical_snapshot: { primary: "get_technicals_rating", read: true },
    screener: { primary: "run_screener", read: true },
    news: { primary: "get_news", read: true },
    economic_calendar: { primary: "get_economic_calendar", read: true },
    fundamentals: { primary: "get_financials", read: true },
    filings: { primary: "get_documents", read: true },
    watchlists: { primary: "list_watchlists", alternates: ["get_active_watchlist"], read: true },
    alerts: { primary: "list_alerts", read: true },
    alert_history: { primary: "get_alerts_log", read: true },
    symbol_search: { primary: "search_symbols", read: true },
    forecasts: { primary: "get_forecasts", read: true },
    financial_history: { primary: "get_financial_history", read: true },
    earnings_calendar: { primary: "get_earnings_calendar", read: true },
    dividends_calendar: { primary: "get_dividends_calendar", read: true },
    economic_data: { primary: "get_economic_data", read: true },
};

/** Capabilities the current toolset does NOT provide (explicitly unsupported). */
export const UNSUPPORTED_CAPABILITIES: readonly ExternalCapability[] = [];

export function describeCapabilities(listedTools: string[] | null): CapabilityDescriptor[] {
    return (Object.keys(CAPABILITY_TOOLS) as ExternalCapability[]).map((id) => {
        const map = CAPABILITY_TOOLS[id];
        const tools = [map.primary, ...(map.alternates ?? [])];
        const supported = listedTools === null ? true : tools.some((t) => listedTools.includes(t));
        return { id, label: id.replace(/_/g, " "), supported, tools, read: map.read };
    });
}

// ── Raw MCP payload helpers ─────────────────────────────────────────────────

type Raw = unknown;

function asRecord(value: Raw): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Parse the tool text payload: structured content, or JSON within text. */
export function parseToolPayload(result: McpCallToolResult): Record<string, unknown> | unknown[] | null {
    if (result.structuredContent !== undefined) {
        const rec = asRecord(result.structuredContent);
        if (rec) return rec;
        if (Array.isArray(result.structuredContent)) return result.structuredContent;
    }
    const text = result.text?.trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) return parsed;
        return asRecord(parsed);
    } catch {
        return null;
    }
}

function num(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function toUnixSeconds(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        // Heuristic: seconds vs ms. TradingView uses unix seconds in news t.
        return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
    }
    return null;
}

/**
 * Extract the data record from common wrapper shapes: the record itself,
 * `{ data: … }`, `{ result: … }`, or an array payload (first element).
 */
export function unwrapData(payload: Record<string, unknown> | unknown[] | null): Record<string, unknown> | unknown[] | null {
    if (Array.isArray(payload)) return payload;
    if (!payload) return null;
    for (const key of ["data", "result", "rows", "items", "bars", "events", "watchlists", "alerts"]) {
        const inner = (payload as Record<string, unknown>)[key];
        if (Array.isArray(inner) || asRecord(inner)) return inner as Record<string, unknown> | unknown[];
    }
    return payload;
}

// ── Capability normalizers (raw MCP → normalized provider shapes) ──────────

import type {
    ExternalAlert,
    ExternalAlertHistoryEvent,
    ExternalCandle,
    ExternalEconomicEvent,
    ExternalFiling,
    ExternalFundamentals,
    ExternalHistoricalData,
    ExternalNewsItem,
    ExternalQuote,
    ExternalScreenerResult,
    ExternalScreenerRow,
    ExternalSymbolSearchResult,
    ExternalTechnicalSnapshot,
    ExternalWatchlist,
} from "../interfaces/external-intelligence-provider";
import type { ExternalEvidenceProvenance } from "../interfaces/external-intelligence-provider";

function providerTimestampFrom(payload: Record<string, unknown> | null): number | null {
    if (!payload) return null;
    for (const key of ["time", "timestamp", "published", "datetime", "last_updated", "updatedAt", "eventTime"]) {
        const ts = toUnixSeconds(payload[key]);
        if (ts !== null) return ts * 1000;
    }
    return null;
}

/** Normalize OHLCV bars: {t,o,h,l,c,v} with tolerant key aliases. */
export function normalizeOhlcv(payload: Record<string, unknown> | unknown[] | null): ExternalCandle[] {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : asRecord(data) && Array.isArray((data as Record<string, unknown>).bars) ? ((data as Record<string, unknown>).bars as unknown[]) : [];
    const candles: ExternalCandle[] = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const t = toUnixSeconds(rec.t ?? rec.time ?? rec.timestamp ?? rec.datetime);
        const o = num(rec.o ?? rec.open);
        const h = num(rec.h ?? rec.high);
        const l = num(rec.l ?? rec.low);
        const c = num(rec.c ?? rec.close);
        if (t === null || o === null || h === null || l === null || c === null) continue;
        candles.push({ t, o, h, l, c, ...(num(rec.v ?? rec.volume) !== null ? { v: num(rec.v ?? rec.volume)! } : {}) });
    }
    return candles;
}

export function normalizeHistorical(
    symbol: string,
    interval: string,
    summaryOnly: boolean,
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalHistoricalData {
    const candles = normalizeOhlcv(payload);
    const rec = asRecord(unwrapData(payload));
    const aggregate = rec && !Array.isArray(rec) ? (rec.aggregate as Record<string, unknown> | undefined) ?? null : null;
    return {
        provenance,
        symbol,
        interval,
        count: candles.length,
        candles: summaryOnly ? [] : candles,
        summaryOnly,
        aggregate: aggregate ?? (summaryOnly ? (rec as Record<string, unknown> | null) : null),
    };
}

export function normalizeQuote(
    symbol: string,
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalQuote {
    const rec = (Array.isArray(payload) ? asRecord(payload[0]) : asRecord(unwrapData(payload))) ?? {};
    const price = num(rec.close ?? rec.price ?? rec.last_price ?? rec.last);
    return {
        provenance,
        symbol,
        providerSymbol: str(rec.symbol ?? rec.full_name ?? rec.ticker) ?? undefined,
        price,
        change: num(rec.change_abs ?? rec.change),
        changePercent: num(rec.change_percent ?? rec.changePercent),
        bid: num(rec.bid),
        ask: num(rec.ask),
        open: num(rec.open),
        high: num(rec.high),
        low: num(rec.low),
        volume: num(rec.volume),
        description: str(rec.description ?? rec.name),
        exchange: str(rec.exchange),
    };
}

export function normalizeTechnicalSnapshot(
    symbol: string,
    interval: string,
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalTechnicalSnapshot {
    const rec = (Array.isArray(payload) ? asRecord(payload[0]) : asRecord(unwrapData(payload))) ?? {};
    const indicators: Record<string, number | string | null> = {};
    const recommendation = asRecord(rec.recommendation) ?? null;
    for (const [k, v] of Object.entries(rec)) {
        if (k === "recommendation") continue;
        if (typeof v === "number" || typeof v === "string" || v === null) indicators[k] = v as number | string | null;
    }
    return {
        provenance,
        symbol,
        interval,
        indicators,
        recommendation: recommendation
            ? { classification: str(recommendation.classification) ?? "unknown", label: str(recommendation.label) ?? "" }
            : null,
        raw: rec,
    };
}

export function normalizeScreener(
    market: string,
    payload: Record<string, unknown> | unknown[] | null,
    columns: string[],
    provenance: ExternalEvidenceProvenance,
): ExternalScreenerResult {
    const rec = asRecord(payload);
    const rowsRaw = Array.isArray(payload) ? payload : Array.isArray(rec?.data) ? (rec!.data as unknown[]) : Array.isArray(rec?.rows) ? (rec!.rows as unknown[]) : [];
    const rows: ExternalScreenerRow[] = [];
    for (const row of rowsRaw) {
        const r = asRecord(row);
        if (!r) continue;
        const symbol = str(r.symbol ?? r.s ?? r.ticker ?? r.name) ?? "";
        if (!symbol) continue;
        const values: Record<string, number | string | boolean | null> = {};
        for (const [k, v] of Object.entries(r)) {
            if (k === "symbol" || k === "s" || k === "ticker") continue;
            if (typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v === null) values[k] = v;
        }
        rows.push({ symbol, values });
    }
    return {
        provenance,
        market,
        totalCount: rec && num(rec.totalCount) !== null ? num(rec.totalCount) : rows.length,
        rows,
        columns,
    };
}

export function normalizeNews(
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalNewsItem[] {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : asRecord(data) && Array.isArray((data as Record<string, unknown>).news) ? ((data as Record<string, unknown>).news as unknown[]) : [];
    const items: ExternalNewsItem[] = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const id = str(rec.id ?? rec.storyPath);
        const title = str(rec.title ?? rec.headline);
        if (!id || !title) continue;
        items.push({
            provenance,
            id,
            title,
            provider: str(rec.provider),
            publishedAt: toUnixSeconds(rec.published ?? rec.publishedAt ?? rec.time),
            link: str(rec.link),
            urgency: num(rec.urgency),
            relatedSymbols: Array.isArray(rec.relatedSymbols)
                ? (rec.relatedSymbols as unknown[]).map((s) => (typeof s === "string" ? s : str(asRecord(s)?.symbol) ?? "")).filter(Boolean)
                : undefined,
        });
    }
    return items;
}

const IMPORTANCE_LABELS: Record<number, string> = {
    [-1]: "all",
    0: "medium",
    1: "high",
};

export function normalizeEconomicCalendar(
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalEconomicEvent[] {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : asRecord(data) && Array.isArray((data as Record<string, unknown>).events) ? ((data as Record<string, unknown>).events as unknown[]) : [];
    const events: ExternalEconomicEvent[] = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const title = str(rec.title ?? rec.event ?? rec.name);
        if (!title) continue;
        const importance = num(rec.importance);
        events.push({
            provenance,
            eventId: str(rec.id),
            title,
            country: str(rec.country ?? rec.region),
            currency: str(rec.currency),
            importance,
            importanceLabel: importance !== null ? (IMPORTANCE_LABELS[importance] ?? str(rec.importanceLabel) ?? null) : null,
            eventTime: toUnixSeconds(rec.time ?? rec.eventTime ?? rec.date),
            category: str(rec.category),
            actual: (typeof rec.actual === "string" || typeof rec.actual === "number" ? rec.actual : null) ?? null,
            forecast: (typeof rec.forecast === "string" || typeof rec.forecast === "number" ? rec.forecast : null) ?? null,
            previous: (typeof rec.previous === "string" || typeof rec.previous === "number" ? rec.previous : null) ?? null,
        });
    }
    return events;
}

export function normalizeFundamentals(
    symbol: string,
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalFundamentals {
    const rec = (Array.isArray(payload) ? asRecord(payload[0]) : asRecord(unwrapData(payload))) ?? {};
    const metrics: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(rec)) {
        if (typeof v === "number" || typeof v === "string" || v === null) metrics[k] = v;
    }
    return { provenance, symbol, metrics, period: str(rec.period) };
}

export function normalizeFilings(
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalFiling[] {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : asRecord(data) && Array.isArray((data as Record<string, unknown>).documents) ? ((data as Record<string, unknown>).documents as unknown[]) : [];
    const filings: ExternalFiling[] = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const id = str(rec.id ?? rec.documentId);
        const title = str(rec.title ?? rec.name);
        if (!id || !title) continue;
        filings.push({
            provenance,
            id,
            title,
            category: str(rec.category),
            publishedAt: toUnixSeconds(rec.published ?? rec.date ?? rec.timestamp),
            viewId: str(rec.viewId ?? (Array.isArray(rec.views) && asRecord(rec.views[0]) ? str(asRecord(rec.views[0])!.id) : null)),
        });
    }
    return filings;
}

export function normalizeWatchlists(
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalWatchlist[] {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : [];
    const lists: ExternalWatchlist[] = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const id = str(rec.id ?? rec.watchlistId);
        if (!id) continue;
        const symbols = Array.isArray(rec.symbols)
            ? (rec.symbols as unknown[]).map((s) => (typeof s === "string" ? s : str(asRecord(s)?.symbol) ?? "")).filter(Boolean)
            : undefined;
        lists.push({
            provenance,
            id,
            name: str(rec.name) ?? id,
            symbolCount: num(rec.symbolCount ?? rec.count) ?? (symbols ? symbols.length : null),
            ...(symbols ? { symbols } : {}),
            active: typeof rec.active === "boolean" ? rec.active : undefined,
        });
    }
    return lists;
}

export function normalizeAlerts(
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalAlert[] {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : asRecord(data) && Array.isArray((data as Record<string, unknown>).alerts) ? ((data as Record<string, unknown>).alerts as unknown[]) : [];
    const alerts: ExternalAlert[] = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const idRaw = rec.alert_id ?? rec.id;
        const symbol = str(rec.symbol ?? rec.ticker);
        if (idRaw === undefined || idRaw === null || !symbol) continue;
        alerts.push({
            provenance,
            id: String(idRaw),
            name: str(rec.name),
            symbol,
            active: typeof rec.active === "boolean" ? rec.active : true,
            conditionType: str(rec.condition_type ?? rec.conditionType),
            threshold: num(rec.threshold ?? rec.price),
            resolution: str(rec.resolution),
            createdAt: toUnixSeconds(rec.created ?? rec.createdAt),
            lastFiredAt: toUnixSeconds(rec.last_fired ?? rec.lastFiredAt),
        });
    }
    return alerts;
}

export function normalizeAlertHistory(
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalAlertHistoryEvent[] {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : [];
    const events: ExternalAlertHistoryEvent[] = [];
    for (const row of rows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const alertIdRaw = rec.alert_id ?? rec.alertId ?? rec.id;
        if (alertIdRaw === undefined || alertIdRaw === null) continue;
        events.push({
            provenance,
            alertId: String(alertIdRaw),
            symbol: str(rec.symbol) ?? "",
            firedAt: toUnixSeconds(rec.time ?? rec.firedAt ?? rec.timestamp),
            message: str(rec.message),
        });
    }
    return events;
}

export function normalizeSymbolSearch(
    query: string,
    payload: Record<string, unknown> | unknown[] | null,
    provenance: ExternalEvidenceProvenance,
): ExternalSymbolSearchResult {
    const data = unwrapData(payload);
    const rows = Array.isArray(data) ? data : asRecord(data) && Array.isArray((data as Record<string, unknown>).symbols) ? ((data as Record<string, unknown>).symbols as unknown[]) : [];
    return {
        provenance,
        query,
        results: rows
            .map((row) => {
                const rec = asRecord(row);
                if (!rec) return null;
                const symbol = str(rec.symbol ?? rec.full_name);
                if (!symbol) return null;
                return {
                    symbol,
                    description: str(rec.description),
                    type: str(rec.type),
                    exchange: str(rec.exchange),
                };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
    };
}

export { providerTimestampFrom };
