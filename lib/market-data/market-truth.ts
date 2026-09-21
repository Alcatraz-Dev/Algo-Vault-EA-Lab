import { MarketCandle, MarketQuote, Timeframe, SupportedSymbol } from "./types";
import { fetchCandles } from "./normalizer";
import { fetchBiquoteLivePrice, tradingViewLivePriceCache } from "@/lib/market-data/tradingview-live";

export type DataProvider = "biquote" | "tradingview";

export interface MarketSnapshot {
    symbol: SupportedSymbol;
    exchange: string;
    provider: DataProvider;
    currentPrice: number;
    bid: number;
    ask: number;
    spread: number;
    timestamp: number;
    serverTimestamp: number;
    dataAgeMs: number;
    timeframe: Timeframe;
    marketSession: "asian" | "london" | "new_york" | "overlap" | "closed";
    marketStatus: "open" | "closed" | "pre_market" | "post_market";
    recentCandles: MarketCandle[];
    multiTimeframeCandles: Record<Timeframe, MarketCandle[]>;
    trend: "bullish" | "bearish" | "neutral";
    marketStructure: "trending_bullish" | "trending_bearish" | "ranging" | "breakout" | "reversal" | "high_volatility" | "low_volatility" | "uncertain";
    supportResistance: { supports: number[]; resistances: number[] };
    liquidity: { levels: Array<{ price: number; type: string; strength: number }>; sweeps: Array<{ side: string; level: number; timestamp: number }> };
    volatility: { atr: number; atrPercent: number; state: "low" | "normal" | "high" | "extreme" };
    ATR: number;
    volume: { current: number; average: number; relative: number };
    VWAP: { value: number; distancePercent: number };
    FVG: Array<{ direction: string; price: number; status: string }>;
    orderBlocks: Array<{ direction: string; price: number; status: string }>;
    sweeps: Array<{ side: string; level: number; timestamp: number }>;
    regime: string;
    higherTimeframeContext: Record<string, unknown>;
    lowerTimeframeContext: Record<string, unknown>;
    freshnessStatus: "fresh" | "stale" | "unavailable";
    dataAgeCategory: "tick" | "short" | "moderate" | "extended";
}

export interface FreshnessThresholds {
    tickPriceMs: number;
    m1Ms: number;
    m5Ms: number;
    m15Ms: number;
    m30Ms: number;
    h1Ms: number;
    h4Ms: number;
    d1Ms: number;
}

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
    tickPriceMs: 5000,
    m1Ms: 300000,
    m5Ms: 600000,
    m15Ms: 1800000,
    m30Ms: 1800000,
    h1Ms: 7200000,
    h4Ms: 28800000,
    d1Ms: 86400000,
};

export interface FreshnessResult {
    fresh: boolean;
    status: "fresh" | "stale" | "unavailable";
    dataAgeMs: number;
    thresholdMs: number;
    category: "tick" | "short" | "moderate" | "extended";
}

const SUPPORTED_SYMBOL_LIST: SupportedSymbol[] = [
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD",
    "US30", "NAS100", "SPX500", "BTCUSD", "ETHUSD",
];

function getTimeframeThreshold(tf: Timeframe): number {
    switch (tf) {
        case "M1": return DEFAULT_FRESHNESS_THRESHOLDS.m1Ms;
        case "M3": return DEFAULT_FRESHNESS_THRESHOLDS.m1Ms;
        case "M5": return DEFAULT_FRESHNESS_THRESHOLDS.m5Ms;
        case "M15": return DEFAULT_FRESHNESS_THRESHOLDS.m15Ms;
        case "M30": return DEFAULT_FRESHNESS_THRESHOLDS.m30Ms;
        case "H1": return DEFAULT_FRESHNESS_THRESHOLDS.h1Ms;
        case "H4": return DEFAULT_FRESHNESS_THRESHOLDS.h4Ms;
        case "D1": return DEFAULT_FRESHNESS_THRESHOLDS.d1Ms;
        default: return DEFAULT_FRESHNESS_THRESHOLDS.m5Ms;
    }
}

function getTimeframeCategory(tf: Timeframe): FreshnessResult["category"] {
    switch (tf) {
        case "M1": return "tick";
        case "M3": return "tick";
        case "M5": return "short";
        case "M15": return "short";
        case "M30": return "moderate";
        case "H1": return "moderate";
        case "H4": return "extended";
        case "D1": return "extended";
        default: return "moderate";
    }
}

type LiveQuoteResult = {
    quote: MarketQuote;
    provider: DataProvider;
};

async function fetchLiveQuote(
    symbol: SupportedSymbol,
    preferredProvider?: DataProvider
): Promise<LiveQuoteResult | null> {
    if (preferredProvider !== "biquote") {
        const livePrice = await tradingViewLivePriceCache.get(symbol);
        if (livePrice) {
            const bid = livePrice.bid ?? livePrice.price;
            const ask = livePrice.ask ?? livePrice.price;
            return {
                provider: livePrice.provider,
                quote: {
                    symbol,
                    bid,
                    ask,
                    spread: Math.max(0, ask - bid),
                    timestamp: livePrice.timestamp,
                    change: livePrice.change,
                    changePercent: livePrice.changePercent,
                },
            };
        }
    }

    const biquotePrice = await fetchBiquoteLivePrice(symbol);
    if (biquotePrice) {
        return {
            provider: "biquote",
            quote: {
                symbol,
                bid: biquotePrice.price,
                ask: biquotePrice.price,
                spread: 0,
                timestamp: biquotePrice.timestamp,
            },
        };
    }

    return null;
}

export async function fetchMarketSnapshot(
    symbol: string,
    timeframe: Timeframe = "M5",
    options?: { lookbackCandles?: number; provider?: DataProvider }
): Promise<MarketSnapshot | null> {
    const sym = symbol.toUpperCase() as SupportedSymbol;

    if (!SUPPORTED_SYMBOL_LIST.includes(sym)) {
        return null;
    }
    const [recentCandles, htfCandles] = await Promise.all([
        fetchCandles(sym, timeframe, { to: Date.now() }),
        fetchCandles(sym, getHigherTimeframe(timeframe)),
    ]);

    if (!recentCandles || recentCandles.length < 2) {
        return null;
    }

    const liveQuote = await fetchLiveQuote(sym, options?.provider ?? "tradingview");
    const quote = liveQuote?.quote ?? null;
    const now = Date.now();

    let currentPrice: number;
    let bid: number;
    let ask: number;
    let spread: number;
    let quoteTimestamp: number;
    let provider: DataProvider = liveQuote?.provider ?? "biquote";

    if (quote && (now - quote.timestamp) < DEFAULT_FRESHNESS_THRESHOLDS.m1Ms) {
        currentPrice = (quote.bid + quote.ask) / 2;
        bid = quote.bid;
        ask = quote.ask;
        spread = quote.spread;
        quoteTimestamp = quote.timestamp;
    } else if (quote) {
        currentPrice = (quote.bid + quote.ask) / 2;
        bid = quote.bid;
        ask = quote.ask;
        spread = quote.spread;
        quoteTimestamp = quote.timestamp;
    } else {
        const last = recentCandles[recentCandles.length - 1];
        const candleAgeMs = now - last.timestamp;
        const candleStaleThreshold = getTimeframeThreshold(timeframe) * 2;
        if (candleAgeMs > candleStaleThreshold) {
            return null;
        }
        currentPrice = last.close;
        bid = last.close;
        ask = last.close;
        spread = 0;
        quoteTimestamp = last.timestamp;
        provider = "biquote";
    }

    const dataAgeMs = now - quoteTimestamp;
    const thresholdMs = getTimeframeThreshold(timeframe);
    const category = getTimeframeCategory(timeframe);

    let freshnessStatus: FreshnessResult["status"];
    if (dataAgeMs > thresholdMs) {
        freshnessStatus = "stale";
    } else if (dataAgeMs > thresholdMs * 0.8) {
        freshnessStatus = "stale";
    } else {
        freshnessStatus = "fresh";
    }

    const exchange = provider === "tradingview" ? "TradingView" : "Biquote";

    const multiTimeframeCandles: Record<Timeframe, MarketCandle[]> = { M1: [], M3: [], M5: [], M15: [], M30: [], H1: [], H4: [], D1: [] };
    const mtfTimeframes: Timeframe[] = ["M1", "M5", "M15", "H1", "H4"];
    for (const tf of mtfTimeframes) {
        if (tf === timeframe) {
            multiTimeframeCandles[tf] = recentCandles;
        } else {
            try {
                const candles = await fetchCandles(sym, tf);
                multiTimeframeCandles[tf] = candles.slice(-50);
            } catch {
                multiTimeframeCandles[tf] = [];
            }
        }
    }

    const lastCandle = recentCandles[recentCandles.length - 1];
    const prevCandle = recentCandles.length >= 2 ? recentCandles[recentCandles.length - 2] : lastCandle;
    const trend: "bullish" | "bearish" | "neutral" = lastCandle.close > prevCandle.close ? "bullish" : lastCandle.close < prevCandle.close ? "bearish" : "neutral";

    const htfBias = htfCandles.length >= 10 ? (htfCandles[htfCandles.length - 1].close > htfCandles[0].close ? "bullish" : "bearish") : "neutral";

    const { atr, atrPercent, state: volState } = computeATR(recentCandles, 14);

    return {
        symbol: sym,
        exchange,
        provider,
        currentPrice,
        bid,
        ask,
        spread,
        timestamp: quoteTimestamp,
        serverTimestamp: now,
        dataAgeMs,
        timeframe,
        marketSession: "new_york",
        marketStatus: "open",
        recentCandles,
        multiTimeframeCandles,
        trend,
        marketStructure: "uncertain" as const,
        supportResistance: { supports: [], resistances: [] },
        liquidity: { levels: [], sweeps: [] },
        volatility: { atr, atrPercent, state: volState },
        ATR: atr,
        volume: { current: lastCandle.volume || 0, average: 0, relative: 1 },
        VWAP: { value: 0, distancePercent: 0 },
        FVG: [],
        orderBlocks: [],
        sweeps: [],
        regime: "neutral",
        higherTimeframeContext: { htfBias, htfCandles: htfCandles.slice(-20) },
        lowerTimeframeContext: {},
        freshnessStatus,
        dataAgeCategory: category,
    };
}

export async function validateMarketFreshness(
    snapshot: MarketSnapshot,
    timeframe: Timeframe
): Promise<FreshnessResult> {
    const thresholdMs = getTimeframeThreshold(timeframe);
    const category = getTimeframeCategory(timeframe);

    if (snapshot.dataAgeMs === 0 && snapshot.currentPrice === 0) {
        return { fresh: false, status: "unavailable", dataAgeMs: 0, thresholdMs, category };
    }

    if (snapshot.dataAgeMs > thresholdMs) {
        return { fresh: false, status: "stale", dataAgeMs: snapshot.dataAgeMs, thresholdMs, category };
    }

    if (snapshot.freshnessStatus === "stale") {
        return { fresh: false, status: "stale", dataAgeMs: snapshot.dataAgeMs, thresholdMs, category };
    }

    return { fresh: true, status: "fresh", dataAgeMs: snapshot.dataAgeMs, thresholdMs, category };
}

function getHigherTimeframe(tf: Timeframe): Timeframe {
    const hierarchy: Record<Timeframe, Timeframe> = {
        M1: "M5", M3: "M5", M5: "H1", M15: "H1", M30: "H1",
        H1: "H4", H4: "D1", D1: "D1",
    };
    return hierarchy[tf] || "H1";
}

function computeATR(candles: MarketCandle[], period: number): { atr: number; atrPercent: number; state: "low" | "normal" | "high" | "extreme" } {
    if (candles.length < period + 1) return { atr: 0, atrPercent: 0, state: "normal" };

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        trueRanges.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
    }

    const recent = trueRanges.slice(-period);
    const atr = recent.reduce((a, b) => a + b, 0) / recent.length;
    const lastClose = candles[candles.length - 1].close;
    const atrPercent = lastClose > 0 ? (atr / lastClose) * 100 : 0;

    let state: "low" | "normal" | "high" | "extreme" = "normal";
    if (atrPercent < 0.1) state = "low";
    else if (atrPercent < 0.3) state = "normal";
    else if (atrPercent < 0.6) state = "high";
    else state = "extreme";

    return { atr, atrPercent, state };
}

export async function getMarketTruth(
    symbol: string,
    timeframe: Timeframe = "M5"
): Promise<{ snapshot: MarketSnapshot; freshness: FreshnessResult } | null> {
    const snapshot = await fetchMarketSnapshot(symbol, timeframe);
    if (!snapshot) return null;

    const freshness = await validateMarketFreshness(snapshot, timeframe);
    return { snapshot, freshness };
}

export type MarketDataListener = (snapshot: MarketSnapshot | null) => void;

type MarketStreamEntry = {
    listeners: Set<MarketDataListener>;
    timer: ReturnType<typeof setInterval>;
    inFlight: boolean;
};

/** Shared polling stream for client consumers of canonical market truth. */
class MarketDataStream {
    private readonly entries = new Map<string, MarketStreamEntry>();

    subscribe(
        symbol: string,
        timeframe: Timeframe,
        listener: MarketDataListener,
        options: { intervalMs?: number } = {}
    ): () => void {
        const normalizedSymbol = symbol.toUpperCase();
        const key = `${normalizedSymbol}:${timeframe}`;
        let entry = this.entries.get(key);

        if (!entry) {
            const listeners = new Set<MarketDataListener>();
            entry = {
                listeners,
                inFlight: false,
                timer: setInterval(() => {
                    void this.refresh(normalizedSymbol, timeframe, key);
                }, options.intervalMs ?? 30_000),
            };
            this.entries.set(key, entry);
            void this.refresh(normalizedSymbol, timeframe, key);
        }

        entry.listeners.add(listener);

        return () => {
            const current = this.entries.get(key);
            if (!current) return;
            current.listeners.delete(listener);
            if (current.listeners.size === 0) {
                clearInterval(current.timer);
                this.entries.delete(key);
            }
        };
    }

    private async refresh(symbol: string, timeframe: Timeframe, key: string): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry || entry.inFlight) return;
        entry.inFlight = true;

        try {
            const result = await getMarketTruth(symbol, timeframe);
            const current = this.entries.get(key);
            if (!current) return;
            current.listeners.forEach((listener) => listener(result?.snapshot ?? null));
        } finally {
            const current = this.entries.get(key);
            if (current) current.inFlight = false;
        }
    }
}

export const marketDataStream = new MarketDataStream();

export { SUPPORTED_SYMBOL_LIST };