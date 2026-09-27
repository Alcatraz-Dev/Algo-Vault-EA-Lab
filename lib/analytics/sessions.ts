import { MarketSession, MarketCandle } from "../market-data/types";

type SessionConfig = {
    name: string;
    key: MarketSession;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
};

const SESSIONS: SessionConfig[] = [
    { name: "Asian", key: "asian", startHour: 0, startMinute: 0, endHour: 8, endMinute: 0 },
    { name: "London", key: "london", startHour: 7, startMinute: 0, endHour: 16, endMinute: 0 },
    { name: "New York", key: "new_york", startHour: 12, startMinute: 0, endHour: 21, endMinute: 0 },
    { name: "London/NY Overlap", key: "overlap", startHour: 12, startMinute: 0, endHour: 16, endMinute: 0 },
    // Sydney/Australia session (21:00 UTC open = 5pm ET forex open). Checked
    // last so it only fills the 21:00–24:00 UTC window the other sessions do
    // not cover — without it the market reports "closed" while forex and
    // metals are actually trading.
    { name: "Sydney", key: "asian", startHour: 21, startMinute: 0, endHour: 7, endMinute: 0 },
];

function getTimeInUTC(date: Date): { hour: number; minute: number } {
    return {
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
    };
}

function isTimeInRange(hour: number, minute: number, startHour: number, startMinute: number, endHour: number, endMinute: number): boolean {
    const timeMinutes = hour * 60 + minute;
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    // Support windows that wrap midnight (e.g. Sydney 21:00 → 07:00).
    if (startMinutes <= endMinutes) {
        return timeMinutes >= startMinutes && timeMinutes < endMinutes;
    }
    return timeMinutes >= startMinutes || timeMinutes < endMinutes;
}

/**
 * Whether the forex/CFD market is actually open: the trading week runs from
 * Sunday 21:00 UTC (5pm ET) to Friday 21:00 UTC. Crypto trades through the
 * weekend, but this flag reflects the forex/metals/indices session used by
 * the session engine.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
    const day = now.getUTCDay(); // 0 = Sunday
    const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
    if (day === 6) return false; // Saturday
    if (day === 0) return hours >= 21; // Sunday until 21:00 UTC
    if (day === 5) return hours < 21; // Friday after 21:00 UTC
    return true;
}

export function getCurrentSession(now: Date = new Date()): { current: MarketSession; name: string } {
    // Outside the Sun 21:00 → Fri 21:00 UTC trading week the market is
    // genuinely closed — never report a session name.
    if (!isMarketOpen(now)) {
        return { current: "closed", name: "Closed" };
    }

    const { hour, minute } = getTimeInUTC(now);

    for (const session of SESSIONS) {
        if (isTimeInRange(hour, minute, session.startHour, session.startMinute, session.endHour, session.endMinute)) {
            return { current: session.key, name: session.name };
        }
    }

    return { current: "closed", name: "Closed" };
}

export function getSessionData(candles: MarketCandle[], now: Date = new Date()): {
    current: MarketSession;
    name: string;
    startTime: number;
    endTime: number;
    high: number;
    low: number;
    range: number;
} {
    const { current, name } = getCurrentSession(now);

    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const sessionStartMs = todayStart.getTime();

    const sessionCandles = candles.filter((c) => c.timestamp >= sessionStartMs);

    if (sessionCandles.length === 0) {
        return {
            current,
            name,
            startTime: sessionStartMs,
            endTime: sessionStartMs + 24 * 60 * 60 * 1000,
            high: 0,
            low: 0,
            range: 0,
        };
    }

    const high = Math.max(...sessionCandles.map((c) => c.high));
    const low = Math.min(...sessionCandles.map((c) => c.low));

    return {
        current,
        name,
        startTime: sessionStartMs,
        endTime: sessionStartMs + 24 * 60 * 60 * 1000,
        high,
        low,
        range: high - low,
    };
}

export function getSessionMarkers(candles: MarketCandle[]): { timestamp: number; session: string; type: "open" | "close" }[] {
    const markers: { timestamp: number; session: string; type: "open" | "close" }[] = [];

    const sessionDates = new Map<string, Set<string>>();

    for (const candle of candles) {
        const date = new Date(candle.timestamp);
        const dateStr = date.toISOString().split("T")[0];
        const { hour } = getTimeInUTC(date);

        for (const session of SESSIONS) {
            const key = `${dateStr}_${session.key}`;
            if (!sessionDates.has(key)) {
                sessionDates.set(key, new Set());
            }

            if (hour === session.startHour && !sessionDates.get(key)!.has("open")) {
                sessionDates.get(key)!.add("open");
                markers.push({
                    timestamp: candle.timestamp,
                    session: session.name,
                    type: "open",
                });
            }

            if (hour === session.endHour - 1 && !sessionDates.get(key)!.has("close")) {
                sessionDates.get(key)!.add("close");
                markers.push({
                    timestamp: candle.timestamp,
                    session: session.name,
                    type: "close",
                });
            }
        }
    }

    return markers;
}
