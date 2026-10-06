import { fetchJsonWithRetry, logOncePerWindow } from "./normalizer";
import type { SupportedSymbol } from "./types";

/**
 * Biquote live-price symbol aliases — same as in normalizer.ts.
 * Verified live: SPX500 → US500 (bars), NAS100 → USTEC (bars).
 */
const BIQUOTE_LIVE_ALIAS: Record<string, string> = {
    SPX500: "US500",
    NAS100: "USTEC",
};

const TRADINGVIEW_SCANNER_BASE = "https://scanner.tradingview.com";
const TRADINGVIEW_SCANNER_ENDPOINTS = ["/global/scan", "/cfd/scan"] as const;
const DEFAULT_RETRIES = 1;
/** A Biquote M1 bar older than this is not treated as a live tick. */
const BIQUOTE_FRESH_MS = 120_000;

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

/**
 * Inverse of `toTradingViewSymbol`: strip an exchange/venue prefix (e.g.
 * "OANDA:XAUUSD" → "XAUUSD") so Biquote-style plain-symbol APIs can be
 * queried with a name they actually recognize. Only prefixes that Biquote
 * does not use are stripped — Biquote symbols are always plain ("XAUUSD",
 * "EURUSD", ...), so any "VENUE:SYMBOL" form is de-mapped.
 */
export function fromTradingViewSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();
    const idx = normalized.indexOf(":");
    return idx > 0 ? normalized.slice(idx + 1) : normalized;
}

function parseScannerRow(row: ScannerRow | undefined, symbol: string): TradingViewLivePrice | null {
    const values = row?.d;
    const close = positiveNumber(values?.[3]) ?? positiveNumber(values?.[8]);
    if (close === null) return null;

    const bid = positiveNumber(values?.[9]) ?? close;
    const ask = positiveNumber(values?.[10]) ?? close;
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
        // POST with a tickers+columns body is the scanner API contract for
        // every namespace; unauthenticated GET requests are rejected (403).
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
    // Translate canonical names to Biquote's own names (e.g. SPX500 → US500).
    const biquoteSymbol = BIQUOTE_LIVE_ALIAS[upper] ?? upper;
    const params = new URLSearchParams({ interval: "1m", limit: "2" });
    const data = await fetchJsonWithRetry<BiquoteResponse>(
        `https://biquote.io/api/${encodeURIComponent(biquoteSymbol)}/ohlc?${params.toString()}`,
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
    // Accept both plain symbols ("XAUUSD") and venue-qualified tickers
    // ("OANDA:XAUUSD"): the Biquote lookup always needs the plain form.
    const upper = fromTradingViewSymbol(symbol);

    // Prefer the Biquote forming candle when it is genuinely fresh: the
    // scanner's `close` can lag by minutes (it is not tick-level despite
    // update_mode "streaming"), while the M1 forming bar streams every few
    // seconds. Symbols Biquote does not cover (e.g. US equities) fall through
    // to the scanner below.
    const biquotePrice = await fetchBiquoteLivePrice(upper);
    if (biquotePrice && Date.now() - biquotePrice.timestamp < BIQUOTE_FRESH_MS) {
        return biquotePrice;
    }

    const scannerPrice = await fetchScannerLivePrice(upper);
    if (scannerPrice) return scannerPrice;

    if (!biquotePrice) {
        logOncePerWindow(
            `tv-scanner:${upper}`,
            `[fetchTradingViewLivePrice] No live price available for ${symbol}.`
        );
    }
    // A stale-but-real Biquote bar beats nothing.
    return biquotePrice;
}

class TradingViewLivePriceCache {
    private readonly cache = new Map<string, { price: TradingViewLivePrice; expiresAt: number }>();
    private readonly inFlight = new Map<string, Promise<TradingViewLivePrice | null>>();

    private static readonly TTL_MS = 5000;
    /**
     * How long past expiry a FAILED refresh may keep serving the last real
     * quote. Stale-but-real beats nothing: a provider blip must read as a
     * slightly old price, never as "no data" — otherwise every chart poller
     * loses its tick stream and the chart flaps between live and paused.
     */
    private static readonly STALE_SERVE_MS = 30_000;

    async get(
        symbol: string,
        opts?: boolean | { forceRefresh?: boolean; timeoutMs?: number },
    ): Promise<TradingViewLivePrice | null> {
        const forceRefresh = typeof opts === "boolean" ? opts : (opts?.forceRefresh ?? false);
        const timeoutMs = typeof opts === "object" ? opts.timeoutMs : undefined;
        const key = symbol.trim().toUpperCase();
        const now = Date.now();
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > now && !forceRefresh) {
            return cached.price;
        }

        const existing = this.inFlight.get(key);
        const request = existing ?? this.startFetch(key, symbol);
        if (!timeoutMs || timeoutMs <= 0) return request;

        // Deadline: callers that poll (chart ticks) must never inherit the
        // upstream worst case — 8 s timeouts × retries × two providers. After
        // `timeoutMs` we answer with the last real quote (or null) while the
        // fetch keeps running in the background and warms the cache for the
        // next poll.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<TradingViewLivePrice | null>((resolve) => {
            timer = setTimeout(() => {
                const latest = this.cache.get(key);
                const freshEnough =
                    latest !== undefined &&
                    Date.now() - latest.expiresAt <= TradingViewLivePriceCache.TTL_MS + TradingViewLivePriceCache.STALE_SERVE_MS;
                resolve(freshEnough ? latest.price : null);
            }, timeoutMs);
        });
        try {
            return await Promise.race([request, deadline]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    /** Fetch (or join an in-flight fetch) and store the outcome. */
    private startFetch(key: string, symbol: string): Promise<TradingViewLivePrice | null> {
        const request = fetchTradingViewLivePrice(symbol)
            .then((price) => {
                if (price) {
                    this.cache.set(key, {
                        price,
                        expiresAt: Date.now() + TradingViewLivePriceCache.TTL_MS,
                    });
                    return price;
                }
                // Refresh failed — serve the previous quote while it is still
                // plausibly recent instead of dropping the caller to null.
                const stale = this.cache.get(key);
                if (
                    stale !== undefined &&
                    Date.now() - stale.expiresAt <= TradingViewLivePriceCache.TTL_MS + TradingViewLivePriceCache.STALE_SERVE_MS
                ) {
                    return stale.price;
                }
                return null;
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
