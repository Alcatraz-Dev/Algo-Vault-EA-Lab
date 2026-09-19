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
    return timeMinutes >= startMinutes && timeMinutes < endMinutes;
}

export function getCurrentSession(now: Date = new Date()): { current: MarketSession; name: string } {
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
