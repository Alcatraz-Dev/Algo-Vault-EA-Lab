import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getTradingViewStatusForUser } from "@/lib/market-intelligence/providers/tradingview/connection-service";
import { tradingViewMCPProvider } from "@/lib/market-intelligence/providers/tradingview/tradingview-mcp-provider";
import type { ExternalEconomicEvent } from "@/lib/market-intelligence/providers/interfaces/external-intelligence-provider";

export type EconomicNewsItem = {
    id: string;
    date: string;
    timeUtc: string;
    currency: string;
    flag: string;
    title: string;
    impact: "High" | "Medium" | "Low";
    forecast: string;
    previous: string;
    actual?: string;
    eaActionAdvice: "PAUSE EA" | "CAUTION" | "NORMAL";
};

export type CalendarSource = "platform" | "tradingview-mcp" | "none";

const FEED_URL = "https://n8n.w-v.co/webhook/forex-calendar";

export async function GET(req: Request) {
    let events: EconomicNewsItem[] = [];
    let source: CalendarSource = "none";

    // ── Primary: the platform feed ──────────────────────────────────────────
    try {
        const response = await fetch(FEED_URL, {
            next: { revalidate: 300 },
            // The feed host has been unreachable before; never let the panel
            // hang on a dead resolver.
            signal: AbortSignal.timeout(6_000),
        });

        if (response.ok) {
            const data: unknown = await response.json();
            events = Array.isArray(data)
                ? data.map((item, index): EconomicNewsItem => {
                    const row = item as Record<string, unknown>;
                    const impact = parseImpact(row.impact);
                    const currency = String(row.country || row.currency || "USD").toUpperCase();
                    return {
                        id: `calendar_${index}`,
                        date: String(row.date || ""),
                        timeUtc: String(row.time || ""),
                        currency,
                        flag: getCurrencyFlag(currency),
                        title: String(row.title || row.event || "Economic release"),
                        impact,
                        forecast: String(row.forecast || "—"),
                        previous: String(row.previous || "—"),
                        actual: row.actual ? String(row.actual) : undefined,
                        eaActionAdvice: impact === "High" ? "PAUSE EA" : impact === "Medium" ? "CAUTION" : "NORMAL",
                    };
                })
                : [];
            if (events.length > 0) source = "platform";
        }
    } catch (error) {
        console.warn("Calendar feed unavailable:", error);
    }

    // ── Fallback: TradingView MCP economic calendar (caller's connection) ───
    // Used only when the platform feed is empty/down. Requires an
    // authenticated caller with an authorized TradingView MCP connection;
    // otherwise the response stays honestly empty.
    if (events.length === 0) {
        const mcpEvents = await tradingViewCalendar(req).catch(() => null);
        if (mcpEvents && mcpEvents.length > 0) {
            events = mcpEvents;
            source = "tradingview-mcp";
        }
    }

    return NextResponse.json({ success: true, updatedAt: Date.now(), count: events.length, events, source });
}

/** Best-effort MCP calendar for the authenticated caller; null when not possible. */
async function tradingViewCalendar(req: Request): Promise<EconomicNewsItem[] | null> {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return null;

    let uid: string;
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        uid = decoded.uid;
    } catch {
        return null;
    }

    const status = await getTradingViewStatusForUser(uid).catch(() => null);
    if (status?.state !== "CONNECTED") return null;

    const now = Date.now();
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const rows = await tradingViewMCPProvider.getEconomicCalendar(uid, {
        countries: "US,EU,GB,JP,AU,CA,CH,NZ",
        currencies: "USD,EUR,GBP,JPY,AUD,CAD,CHF,NZD",
        dateFrom: iso(now - 24 * 3600 * 1000),
        dateTo: iso(now + 14 * 24 * 3600 * 1000),
    });

    return rows
        .map(toCalendarItem)
        .filter((x): x is EconomicNewsItem => x !== null);
}

/**
 * ExternalEconomicEvent → panel row. Importance comes from the provider's own
 * label; the numeric grade is only read when the provider sent no label, and
 * never re-grades an explicit one (PHASE 9).
 */
function toCalendarItem(event: ExternalEconomicEvent, index: number): EconomicNewsItem | null {
    if (!event.title) return null;
    const when = typeof event.eventTime === "number" && Number.isFinite(event.eventTime) ? new Date(event.eventTime * 1000) : null;
    if (!when) return null;

    const currency = (event.currency || currencyOfCountry(event.country) || "USD").toUpperCase();
    const impact = impactOf(event.importanceLabel, event.importance);
    return {
        id: event.eventId || `tv_calendar_${index}`,
        date: when.toISOString().slice(0, 10),
        timeUtc: when.toISOString().slice(11, 16),
        currency,
        flag: getCurrencyFlag(currency),
        title: event.title,
        impact,
        forecast: event.forecast === null || event.forecast === undefined ? "—" : String(event.forecast),
        previous: event.previous === null || event.previous === undefined ? "—" : String(event.previous),
        actual: event.actual === null || event.actual === undefined ? undefined : String(event.actual),
        eaActionAdvice: impact === "High" ? "PAUSE EA" : impact === "Medium" ? "CAUTION" : "NORMAL",
    };
}

function currencyOfCountry(country?: string | null): string | undefined {
    const map: Record<string, string> = {
        US: "USD", EU: "EUR", GB: "GBP", JP: "JPY", AU: "AUD",
        CA: "CAD", CH: "CHF", NZ: "NZD", DE: "EUR", FR: "EUR",
        IT: "EUR", ES: "EUR", NL: "EUR", CN: "CNY",
    };
    return country ? map[country.toUpperCase()] : undefined;
}

function impactOf(label: string | null, importance: number | null): "High" | "Medium" | "Low" {
    const l = (label || "").toLowerCase();
    if (l === "high") return "High";
    if (l === "medium" || l === "moderate") return "Medium";
    if (l === "low") return "Low";
    // Only when the provider sent no readable label: the registry grades
    // 1 = high, 0 = medium (see IMPORTANCE_LABELS in tool-mapping.ts).
    if (importance === 1) return "High";
    if (importance === 0) return "Medium";
    return "Low";
}

function getCurrencyFlag(currency: string) {
    const flags: Record<string, string> = { USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", AUD: "AU", CAD: "CA", CHF: "CH", NZD: "NZ" };
    return flags[currency] ? String.fromCodePoint(...[...flags[currency]].map((letter) => 127397 + letter.charCodeAt(0))) : "🌐";
}

function parseImpact(value: unknown): "High" | "Medium" | "Low" {
    const impact = String(value || "").toLowerCase();
    if (impact.includes("high") || impact.includes("red") || impact.includes("3")) return "High";
    if (impact.includes("medium") || impact.includes("orange") || impact.includes("2")) return "Medium";
    return "Low";
}
