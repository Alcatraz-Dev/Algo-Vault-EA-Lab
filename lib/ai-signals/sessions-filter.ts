import { MarketSessionName, SignalConfig } from "./types";
import { getCurrentSession, getSessionData, isMarketOpen } from "@/lib/analytics/sessions";
import { getSymbolSpec } from "./symbol-specs";
import { MarketCandle } from "@/lib/market-data/types";

export interface SessionFilterResult {
    allowed: boolean;
    currentSession: string;
    reason: string;
    sessionData?: {
        high: number;
        low: number;
        range: number;
        rangePosition: number;
    };
}

const DEFAULT_SESSIONS: MarketSessionName[] = ["london", "new_york", "overlap"];

/**
 * Whether scanning may run for a symbol right now.
 *
 * Crypto trades 24/7 and is always scannable. Everything else follows the
 * forex trading week (Sun 21:00 UTC → Fri 21:00 UTC). Importantly, the Asian
 * and Sydney sessions ARE valid trading time — they must not block scanning;
 * only a genuinely closed market does.
 */
export function isSymbolMarketOpen(symbol: string, now: Date = new Date()): boolean {
    const spec = getSymbolSpec(symbol);
    if (spec?.category === "crypto") return true;
    return isMarketOpen(now);
}

export function isSessionAllowed(
    now: Date,
    allowedSessions?: MarketSessionName[]
): SessionFilterResult {
    const sessions = allowedSessions || DEFAULT_SESSIONS;
    const { current: currentSession, name: sessionName } = getCurrentSession(now);

    if (currentSession === "closed") {
        return {
            allowed: false,
            currentSession: sessionName,
            reason: "Market is closed",
        };
    }
    if (sessions.length === 0) {
        return {
            allowed: true,
            currentSession: sessionName,
            reason: "All sessions allowed",
        };
    }

    const isAllowed = sessions.includes(currentSession as MarketSessionName);

    return {
        allowed: isAllowed,
        currentSession: sessionName,
        reason: isAllowed
            ? `Active in ${sessionName}`
            : `Session "${sessionName}" not in allowed: ${sessions.join(", ")}`,
    };
}

export function getSessionQuality(
    now: Date,
    candles: MarketCandle[],
    preferredSessions: MarketSessionName[]
): { quality: number; label: string } {
    const { current: currentSession } = getCurrentSession(now);
    const sessionData = getSessionData(candles, now);

    if (currentSession === "closed") {
        return { quality: 0, label: "Market Closed" };
    }

    const isPreferred = preferredSessions.includes(currentSession as MarketSessionName);

    if (!isPreferred) {
        return { quality: 30, label: "Off-Peak Session" };
    }

    if (currentSession === "overlap") {
        return { quality: 95, label: "London/NY Overlap — Peak" };
    }

    if (currentSession === "london") {
        return { quality: 85, label: "London Session — Active" };
    }

    if (currentSession === "new_york") {
        return { quality: 85, label: "New York Session — Active" };
    }

    if (currentSession === "asian") {
        return { quality: 60, label: "Asian Session — Lower Volume" };
    }

    return { quality: 50, label: "Unknown Session" };
}

export function getSessionLabel(session: string): string {
    switch (session) {
        case "asian": return "Asian";
        case "london": return "London";
        case "new_york": return "New York";
        case "overlap": return "London/NY Overlap";
        case "closed": return "Closed";
        default: return session;
    }
}
