import { fetchJsonWithRetry } from "./normalizer";
import type { SupportedSymbol } from "./types";

const TRADINGVIEW_SCANNER_BASE = "https://scanner.tradingview.com";
const TRADINGVIEW_SCANNER_ENDPOINTS = ["/global/scan", "/cfd/scan"] as const;
const DEFAULT_RETRIES = 1;

const TRADINGVIEW_SYMBOL_CANDIDATES: Partial<Record<SupportedSymbol, readonly string[]>> = {
    EURUSD: ["OANDA:EURUSD", "FX_IDC:EURUSD", "FX:EURUSD"],
    GBPUSD: ["OANDA:GBPUSD", "FX_IDC:GBPUSD", "FX:GBPUSD"],
    USDJPY: ["OANDA:USDJPY", "FX_IDC:USDJPY", "FX:USDJPY"],
    USDCHF: ["OANDA:USDCHF", "FX_IDC:USDCHF", "FX:USDCHF"],
    AUDUSD: ["OANDA:AUDUSD", "FX_IDC:AUDUSD", "FX:AUDUSD"],
    NZDUSD: ["OANDA:NZDUSD", "FX_IDC:NZDUSD", "FX:NZDUSD"],
    USDCAD: ["OANDA:USDCAD", "FX_IDC:USDCAD", "FX:USDCAD"],
    EURGBP: ["OANDA:EURGBP", "FX_IDC:EURGBP", "FX:EURGBP"],
    EURJPY: ["OANDA:EURJPY", "FX_IDC:EURJPY", "FX:EURJPY"],
    GBPJPY: ["OANDA:GBPJPY", "FX_IDC:GBPJPY", "FX:GBPJPY"],
    AUDJPY: ["OANDA:AUDJPY", "FX_IDC:AUDJPY", "FX:AUDJPY"],
    EURCHF: ["OANDA:EURCHF", "FX_IDC:EURCHF", "FX:EURCHF"],
    XAUUSD: ["OANDA:XAUUSD", "FX_IDC:XAUUSD"],
    XAGUSD: ["OANDA:XAGUSD", "FX_IDC:XAGUSD"],
    US30: ["TVC:US30"],
    NAS100: ["TVC:NAS100"],
    SPX500: ["TVC:SPX500"],
    SPY: ["NASDAQ:SPY"],
    QQQ: ["NASDAQ:QQQ"],
    DXY: ["TVC:DXY", "ICEUS:DXY"],
    BTCUSD: ["COINBASE:BTCUSD", "BINANCE:BTCUSD"],
    ETHUSD: ["COINBASE:ETHUSD"],
    SOLUSD: ["COINBASE:SOLUSD"],
    XRPUSD: ["COINBASE:XRPUSD"],
    ADAUSD: ["COINBASE:ADAUSD"],
    DOGEUSD: ["COINBASE:DOGEUSD"],
    BNBUSD: ["BINANCE:BNBUSD"],
    LTCUSD: ["COINBASE:LTCUSD"],
    DOTUSD: ["COINBASE:DOTUSD"],
    AAPL: ["NASDAQ:AAPL"],
    TSLA: ["NASDAQ:TSLA"],
    MSFT: ["NASDAQ:MSFT"],
    NVDA: ["NASDAQ:NVDA"],
    AMZN: ["NASDAQ:AMZN"],
    META: ["NASDAQ:META"],
    GOOGL: ["NASDAQ:GOOGL"],
    AMD: ["NASDAQ:AMD"],
    NFLX: ["NASDAQ:NFLX"],
    COIN: ["NASDAQ:COIN"],
};

const SCANNER_COLUMNS = [
    "name",
    "full_name",
    "exchange",
    "close",
    "change",
    "change_abs",
    "change_percent",
    "update_mode",
    "last_price",
    "bid",
    "ask",
    "open",
    "high",
    "low",
    "volume",
    "relative_volume",
    "time",
    "datetime",
] as const;

type ScannerRow = {
    s?: string;
    d?: Array<string | number | null>;
};

type ScannerResponse = {
    totalCount?: number;
    data?: ScannerRow[];
};

export interface TradingViewLivePrice {
    symbol: string;
    price: number;
    bid?: number;
    ask?: number;
    change?: number;
    changePercent?: number;
    timestamp: number;
    sourceTimestamp?: number;
    exchange?: string;
    ticker?: string;
    updateMode?: string;
    provider: "tradingview" | "biquote";
}

type BiquoteBar = {
    openTime: string;
    close: number;
    isOpen?: boolean;
};

type BiquoteResponse = {
    bars?: BiquoteBar[];
};

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
    const parsed = finiteNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

function timestampFromValue(value: unknown): number | null {
    const parsed = finiteNumber(value);
    if (parsed === null || parsed <= 0) return null;
    return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
}

export function toTradingViewSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();
    if (normalized.includes(":")) return normalized;
    return TRADINGVIEW_SYMBOL_CANDIDATES[normalized as SupportedSymbol]?.[0] ?? normalized;
}

function parseScannerRow(row: ScannerRow | undefined, symbol: string): TradingViewLivePrice | null {
    const values = row?.d;
    const close = positiveNumber(values?.[3]) ?? positiveNumber(values?.[8]);
    if (close === null) return null;

    const bid = positiveNumber(values?.[9]) ?? close;
    const ask = positiveNumber(values?.[10]) ?? close;
    const price = bid !== null && ask !== null ? (bid + ask) / 2 : close;
    const exchange = typeof values?.[2] === "string" ? values[2] : undefined;
    const updateMode = typeof values?.[7] === "string" ? values[7] : undefined;
    const sourceTimestamp = timestampFromValue(values?.[16]) ?? timestampFromValue(values?.[17]) ?? Date.now();
    const timestamp = updateMode === "streaming" ? Date.now() : sourceTimestamp;
    const change = finiteNumber(values?.[5]) ?? finiteNumber(values?.[4]) ?? undefined;
    const changePercent = finiteNumber(values?.[6]) ?? finiteNumber(values?.[4]) ?? undefined;

    return {
        symbol: symbol.toUpperCase(),
        price: close,
        bid,
        ask,
        change,
        changePercent,
        timestamp,
        sourceTimestamp,
        exchange,
        ticker: row?.s,
        updateMode,
        provider: "tradingview",
    };
}

async function fetchScannerLivePrice(symbol: string): Promise<TradingViewLivePrice | null> {
    const upper = symbol.trim().toUpperCase();
    const candidates = TRADINGVIEW_SYMBOL_CANDIDATES[upper as SupportedSymbol] ?? [toTradingViewSymbol(upper)];
    const uniqueCandidates = Array.from(new Set(candidates));

    for (const endpoint of TRADINGVIEW_SCANNER_ENDPOINTS) {
        const body = {
            symbols: {
                query: { types: [] },
                tickers: uniqueCandidates,
            },
            options: { lang: "en" },
            columns: SCANNER_COLUMNS,
            range: [0, 5],
        };

        const data = await fetchJsonWithRetry<ScannerResponse>(
            `${TRADINGVIEW_SCANNER_BASE}${endpoint}`,
            {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            },
            DEFAULT_RETRIES
        );

        const row = data?.data?.find((item) =>
            uniqueCandidates.some((candidate) => item.s?.toUpperCase() === candidate.toUpperCase())
        ) ?? data?.data?.[0];
        const price = parseScannerRow(row, upper);
        if (price) return price;
    }

    return null;
}

export async function fetchBiquoteLivePrice(symbol: string): Promise<TradingViewLivePrice | null> {
    const upper = symbol.trim().toUpperCase();
    const params = new URLSearchParams({ interval: "1m", limit: "2" });
    const data = await fetchJsonWithRetry<BiquoteResponse>(
        `https://biquote.io/api/${encodeURIComponent(upper)}/ohlc?${params.toString()}`,
        undefined,
        DEFAULT_RETRIES
    );
    if (!data?.bars?.length) return null;

    const latest = data.bars.reduce<{ bar: BiquoteBar; timestamp: number } | null>((latest, bar) => {
        const timestamp = Date.parse(bar.openTime);
        if (!Number.isFinite(timestamp) || !(bar.isOpen || bar.close > 0)) return latest;
        return !latest || timestamp > latest.timestamp
            ? { bar, timestamp }
            : latest;
    }, null);

    if (!latest || !latest.bar.close || latest.bar.close <= 0) return null;

    return {
        symbol: upper,
        price: latest.bar.close,
        timestamp: Number.isFinite(latest.timestamp) ? latest.timestamp : Date.now(),
        provider: "biquote",
    };
}

export async function fetchTradingViewLivePrice(
    symbol: string
): Promise<TradingViewLivePrice | null> {
    const upper = symbol.trim().toUpperCase();
    const scannerPrice = await fetchScannerLivePrice(upper);
    if (scannerPrice) return scannerPrice;

    console.warn(
        `[fetchTradingViewLivePrice] TradingView scanner unavailable for ${symbol}; falling back to Biquote.`
    );
    return fetchBiquoteLivePrice(upper);
}

class TradingViewLivePriceCache {
    private readonly cache = new Map<string, { price: TradingViewLivePrice; expiresAt: number }>();
    private readonly inFlight = new Map<string, Promise<TradingViewLivePrice | null>>();

    private static readonly TTL_MS = 5000;

    async get(symbol: string, forceRefresh = false): Promise<TradingViewLivePrice | null> {
        const key = symbol.trim().toUpperCase();
        const now = Date.now();
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > now && !forceRefresh) {
            return cached.price;
        }

        const existing = this.inFlight.get(key);
        if (existing) return existing;

        const request = fetchTradingViewLivePrice(symbol)
            .then((price) => {
                if (price) {
                    this.cache.set(key, {
                        price,
                        expiresAt: Date.now() + TradingViewLivePriceCache.TTL_MS,
                    });
                }
                return price;
            })
            .finally(() => {
                this.inFlight.delete(key);
            });

        this.inFlight.set(key, request);
        return request;
    }

    clear(symbol?: string): void {
        if (!symbol) {
            this.cache.clear();
            return;
        }
        this.cache.delete(symbol.trim().toUpperCase());
    }
}

export const tradingViewLivePriceCache = new TradingViewLivePriceCache();
