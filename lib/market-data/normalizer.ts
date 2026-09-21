import { MarketCandle, Timeframe, TIMEFRAME_INTERVALS, SupportedSymbol } from "./types";

export type MarketDataProvider = "biquote";

const BIQUOTE_BASE = "https://biquote.io/api";
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJsonWithRetry<T>(url: string, init?: RequestInit, retries: number = DEFAULT_RETRIES): Promise<T | null> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal,
                cache: "no-store",
            });
            clearTimeout(timer);

            if (!response.ok) {
                lastError = new Error(`HTTP ${response.status}`);
                if (attempt < retries) await delay(150 * (attempt + 1));
                continue;
            }

            return (await response.json()) as T;
        } catch (error) {
            clearTimeout(timer);
            lastError = error;
            if (attempt < retries) await delay(150 * (attempt + 1));
        }
    }

    console.warn("[market-data] Request failed", { url, error: lastError });
    return null;
}

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBar(
    timestamp: number,
    open: unknown,
    high: unknown,
    low: unknown,
    close: unknown,
    volume?: unknown
): MarketCandle | null {
    const openPrice = finiteNumber(open);
    const highPrice = finiteNumber(high);
    const lowPrice = finiteNumber(low);
    const closePrice = finiteNumber(close);
    const volumeValue = finiteNumber(volume);

    if (
        !Number.isFinite(timestamp) ||
        openPrice === null ||
        highPrice === null ||
        lowPrice === null ||
        closePrice === null ||
        openPrice <= 0 ||
        highPrice < lowPrice ||
        closePrice < lowPrice ||
        closePrice > highPrice
    ) {
        return null;
    }

    return {
        timestamp,
        open: openPrice,
        high: highPrice,
        low: lowPrice,
        close: closePrice,
        volume: volumeValue ?? undefined,
    };
}

type BiquoteBar = {
    openTime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    tickVolume?: number;
    isOpen?: boolean;
};

export type { BiquoteBar };

type BiquoteResponse = { bars?: BiquoteBar[] };

export interface CandleFetchResult {
    candles: MarketCandle[];
    provider: MarketDataProvider | null;
}

function timeframeToLimit(tf: Timeframe): number {
    switch (tf) {
        case "M1": return 500;
        case "M3": return 500;
        case "M5": return 500;
        case "M15": return 400;
        case "M30": return 300;
        case "H1": return 200;
        case "H4": return 150;
        case "D1": return 120;
        default: return 200;
    }
}

async function fetchFromBiquote(
    symbol: SupportedSymbol,
    timeframe: Timeframe,
    limit: number
): Promise<MarketCandle[] | null> {
    const interval = TIMEFRAME_INTERVALS[timeframe];
    const params = new URLSearchParams({
        interval,
        limit: String(limit),
    });
    const data = await fetchJsonWithRetry<BiquoteResponse>(
        `${BIQUOTE_BASE}/${encodeURIComponent(symbol)}/ohlc?${params.toString()}`
    );
    if (!data?.bars?.length) return null;

    const candles = data.bars
        .map((bar) => normalizeBar(
            Date.parse(bar.openTime),
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume ?? bar.tickVolume
        ))
        .filter((candle): candle is MarketCandle => candle !== null)
        .sort((a, b) => a.timestamp - b.timestamp);

    return candles.length > 0 ? candles : null;
}

export async function fetchCandlesWithProvider(
    symbol: SupportedSymbol,
    timeframe: Timeframe,
    options?: { from?: number; to?: number }
): Promise<CandleFetchResult> {
    const limit = timeframeToLimit(timeframe);

    const biquoteCandles = await fetchFromBiquote(symbol, timeframe, limit);
    if (biquoteCandles?.length) {
        const candles = biquoteCandles.filter((candle) =>
            (!options?.from || candle.timestamp >= options.from) &&
            (!options?.to || candle.timestamp <= options.to)
        );
        return { candles, provider: "biquote" };
    }

    return { candles: [], provider: null };
}

export async function fetchCandles(
    symbol: SupportedSymbol,
    timeframe: Timeframe,
    options?: { from?: number; to?: number }
): Promise<MarketCandle[]> {
    return (await fetchCandlesWithProvider(symbol, timeframe, options)).candles;
}

export function normalizeCandles(raw: BiquoteBar[]): MarketCandle[] {
    return raw
        .map((bar) => normalizeBar(
            Date.parse(bar.openTime),
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume ?? bar.tickVolume
        ))
        .filter((candle): candle is MarketCandle => candle !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
}

export function getLastPrice(candles: MarketCandle[]): number {
    if (candles.length === 0) return 0;
    return candles[candles.length - 1].close;
}

export function getPriceChange(candles: MarketCandle[]): { change: number; changePercent: number } {
    if (candles.length < 2) return { change: 0, changePercent: 0 };
    const current = candles[candles.length - 1].close;
    const previous = candles[candles.length - 2].close;
    const change = current - previous;
    const changePercent = previous !== 0 ? (change / previous) * 100 : 0;
    return { change, changePercent };
}

export function getCandleRange(candles: MarketCandle[], lookback: number): { high: number; low: number } {
    const slice = candles.slice(-lookback);
    if (slice.length === 0) return { high: 0, low: 0 };
    return {
        high: Math.max(...slice.map((c) => c.high)),
        low: Math.min(...slice.map((c) => c.low)),
    };
}

export function getVolumeFromCandles(candles: MarketCandle[]): number[] {
    return candles.map((c) => c.volume || 0);
}
