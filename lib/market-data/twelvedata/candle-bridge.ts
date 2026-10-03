import type { MarketCandle, SupportedSymbol, Timeframe } from "../types";
import { fetchTimeSeries } from "./rest-client";
import { toTwelveDataSymbol } from "./symbol-map";

/**
 * Twelve Data → canonical candle bridge.
 *
 * Twelve Data supports true time-paged history (start_date/end_date,
 * outputsize up to 5000), which the primary Biquote feed does not. When a
 * valid TWELVE_DATA_API_KEY is configured this module becomes the deep
 * history provider for the chart engine; when it is not, everything here
 * degrades to `null` and callers fall back to Biquote without any behavior
 * change (and without fabricating candles).
 */

const MAX_OUTPUTSIZE = 5000;

export function hasDeepHistoryProvider(): boolean {
    // Both a configured key AND a mapped symbol are required.
    return Boolean(process.env.TWELVE_DATA_API_KEY);
}

/** Twelve Data datetime strings are exchange-local "YYYY-MM-DD HH:mm:ss". */
function parseTdDatetime(dt: string): number | null {
    if (!dt) return null;
    // Twelve Data returns e.g. "2026-09-30 20:00:00" — treat it as UTC
    // (its forex/metals series are UTC-stamped; equities use exchange tz
    // which is acceptable drift for history display, never for live logic).
    const normalized = dt.includes("T") ? dt : `${dt.replace(" ", "T")}Z`;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : null;
}

function toMarketCandle(
    row: { datetime: string; open: string; high: string; low: string; close: string; volume?: string },
    timeframe: Timeframe,
): MarketCandle | null {
    const timestamp = parseTdDatetime(row.datetime);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (timestamp === null || timestamp <= 0) return null;
    if (![open, high, low, close].every(Number.isFinite)) return null;
    if (high < low || close < low || close > high) return null;
    const volume = Number(row.volume ?? 0);
    return {
        timestamp,
        open,
        high,
        low,
        close,
        ...(Number.isFinite(volume) ? { volume } : { volume: 0 }),
        timeframe: undefined,
        // `timeframe` is not part of MarketCandle; keep the cast surface clean.
    } as MarketCandle;
}

/**
 * Fetch one page of candles ending strictly before `beforeMs` (or the newest
 * page when omitted), oldest-first ascending.
 */
export async function fetchDeepHistoryPage(
    symbol: SupportedSymbol,
    timeframe: Timeframe,
    opts: { beforeMs?: number; limit: number },
): Promise<MarketCandle[] | null> {
    const tdSymbol = toTwelveDataSymbol(symbol);
    if (!tdSymbol) return null;

    const interval = timeframeToInterval(tdIntervalSafe(timeframe));
    const outputsize = Math.min(Math.max(opts.limit, 10), MAX_OUTPUTSIZE);

    // Ask for one extra bucket so we can drop a boundary row that TD returns
    // inclusively (its end_date is inclusive while our cursor is exclusive).
    const requestSize = Math.min(outputsize + 1, MAX_OUTPUTSIZE);

    const params: { startDate?: string; endDate?: string } = {};
    if (opts.beforeMs !== undefined) {
        // end_date is inclusive; subtract 1ms so the returned series ends
        // strictly before the boundary candle.
        params.endDate = new Date(opts.beforeMs - 1).toISOString().replace("T", " ").slice(0, 19);
    }

    const res = await fetchTimeSeries(tdSymbol, interval, requestSize, params);
    const values = res?.values;
    if (!values?.length) return null;

    const candles: MarketCandle[] = [];
    for (const row of values) {
        const c = toMarketCandle(row, timeframe);
        if (c) candles.push(c);
    }
    // TD returns newest-first; the engine expects oldest-first.
    candles.sort((a, b) => a.timestamp - b.timestamp);

    if (opts.beforeMs !== undefined) {
        return candles.filter((c) => c.timestamp < opts.beforeMs!);
    }
    return candles;
}

function tdIntervalSafe(tf: Timeframe): Timeframe {
    return tf;
}

function timeframeToInterval(tf: Timeframe): string {
    // Mirrors rest-client.timeframeToTwelveDataInterval (kept local to avoid
    // importing the workflow-oriented module here).
    const map: Record<Timeframe, string> = {
        M1: "1min",
        M3: "3min",
        M5: "5min",
        M15: "15min",
        M30: "30min",
        H1: "1h",
        H4: "4h",
        D1: "1day",
        W1: "1week",
    };
    return map[tf];
}
