import { NextResponse } from "next/server";

export type AiSignal = {
    id: string;
    symbol: string;
    name: string;
    category: "Forex" | "Commodities" | "Crypto";
    direction: "BUY" | "SELL";
    timeframe: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3: number;
    riskRewardRatio: string;
    aiConfidence: number;
    status: "Active" | "Hit TP1" | "Hit TP2" | "Closed";
    confluences: string[];
    summary: string;
    timestamp: number;
    source?: "multi_market";
};

type Market = {
    slug?: string;
    symbol: string;
    label: string;
    category: AiSignal["category"];
};

type OhlcBar = { openTime: string; open: number; high: number; low: number; close: number; isOpen?: boolean };
type OhlcResponse = { bars?: OhlcBar[] };
type XoomarSignal = { asset?: { slug?: string }; composite?: number | null; news?: { articleCount?: number | null } };

const markets: Market[] = [
    { slug: "eurusd", symbol: "EURUSD", label: "Euro vs US Dollar", category: "Forex" },
    { slug: "gbpusd", symbol: "GBPUSD", label: "British Pound vs US Dollar", category: "Forex" },
    { slug: "usdjpy", symbol: "USDJPY", label: "US Dollar vs Japanese Yen", category: "Forex" },
    { slug: "gold", symbol: "XAUUSD", label: "Gold vs US Dollar", category: "Commodities" },
    { slug: "btc", symbol: "BTCUSD", label: "Bitcoin vs US Dollar", category: "Crypto" },
    { slug: "eth", symbol: "ETHUSD", label: "Ethereum vs US Dollar", category: "Crypto" },
    { slug: "sol", symbol: "SOLUSD", label: "Solana vs US Dollar", category: "Crypto" },
];

function ema(values: number[], period: number) {
    const multiplier = 2 / (period + 1);
    return values.slice(1).reduce((current, value) => value * multiplier + current * (1 - multiplier), values[0] || 0);
}

function rsi(values: number[], period = 14) {
    const points = values.slice(-period - 1);
    let gains = 0;
    let losses = 0;
    for (let index = 1; index < points.length; index += 1) {
        const change = points[index] - points[index - 1];
        gains += Math.max(change, 0);
        losses += Math.max(-change, 0);
    }
    if (!losses) return 100;
    return 100 - 100 / (1 + gains / losses);
}

function atr(bars: OhlcBar[], period = 14) {
    const recent = bars.slice(-period - 1);
    const ranges = recent.slice(1).map((bar, index) => {
        const previousClose = recent[index].close;
        return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
    });
    return ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1);
}

function roundPrice(value: number) {
    if (value >= 1000) return Number(value.toFixed(2));
    if (value >= 10) return Number(value.toFixed(3));
    if (value >= 1) return Number(value.toFixed(5));
    return Number(value.toFixed(6));
}

async function createSignal(market: Market, sentiment?: XoomarSignal): Promise<AiSignal | null> {
    const response = await fetch(`https://biquote.io/api/${market.symbol}/ohlc?interval=1h&limit=80`, { next: { revalidate: 60 } });
    if (!response.ok) return null;

    const data = await response.json() as OhlcResponse;
    const bars = (data.bars || []).sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime));
    if (bars.length < 55) return null;

    const closes = bars.map((bar) => Number(bar.close));
    const entryPrice = closes.at(-1) || 0;
    const fast = ema(closes.slice(-30), 20);
    const slow = ema(closes.slice(-60), 50);
    const momentum = rsi(closes);
    const composite = Number(sentiment?.composite || 0);
    const trendScore = ((fast - slow) / entryPrice) * 1_000;
    const direction: "BUY" | "SELL" = trendScore + composite >= 0 ? "BUY" : "SELL";
    const risk = Math.max(atr(bars), entryPrice * (market.category === "Crypto" ? 0.004 : 0.0015));
    const sign = direction === "BUY" ? 1 : -1;
    const price = (multiple: number) => roundPrice(entryPrice + sign * risk * multiple);
    const confidence = Math.min(92, Math.max(55, Math.round(56 + Math.min(Math.abs(trendScore) * 10, 16) + Math.abs(composite) * 20)));
    const sentimentLine = sentiment ? `Xoomar sentiment: ${composite >= 0 ? "+" : ""}${composite.toFixed(2)}` : "Live price, trend, and volatility analysis";

    return {
        id: `market_${market.symbol.toLowerCase()}`,
        symbol: market.symbol.replace(/(USD|JPY)$/, "/$1"),
        name: market.label,
        category: market.category,
        direction,
        timeframe: "H1",
        entryPrice: roundPrice(entryPrice),
        stopLoss: price(-1),
        takeProfit1: price(1),
        takeProfit2: price(2),
        takeProfit3: price(3),
        riskRewardRatio: "1:3",
        aiConfidence: confidence,
        status: "Active",
        confluences: [
            `EMA 20 ${fast >= slow ? "above" : "below"} EMA 50`,
            `RSI 14: ${momentum.toFixed(1)}`,
            sentimentLine,
            sentiment?.news?.articleCount ? `${sentiment.news.articleCount} news items analysed` : "Biquote live MT5 market data",
        ],
        summary: `${direction === "BUY" ? "Bullish" : "Bearish"} H1 setup built from live market structure, momentum, ATR risk sizing, and available market sentiment.`,
        source: "multi_market",
        timestamp: Date.now(),
    };
}

export async function GET() {
    try {
        const xoomarResponse = await fetch("https://xoomar.com/api/markets/signals", { next: { revalidate: 300 } });

        const xoomarPayload = xoomarResponse.ok ? await xoomarResponse.json() as { data?: XoomarSignal[] } : { data: [] };
        const sentimentBySlug = new Map((xoomarPayload.data || []).map((signal) => [signal.asset?.slug, signal]));
        const generated = (await Promise.all(markets.map((market) => createSignal(market, sentimentBySlug.get(market.slug))))).filter((signal): signal is AiSignal => Boolean(signal));

        return NextResponse.json({
            success: true,
            provider: "Biquote market data + Xoomar sentiment",
            updatedAt: Date.now(),
            refreshSeconds: 60,
            signals: generated,
        });
    } catch (error) {
        console.error("SIGNALS API ERROR:", error);
        return NextResponse.json({ success: false, error: "Failed to load the free signal feed." }, { status: 500 });
    }
}
