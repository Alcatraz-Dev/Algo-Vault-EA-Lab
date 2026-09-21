import { SupportedSymbol } from "@/lib/market-data/types";
import { fetchJsonWithRetry } from "@/lib/market-data/normalizer";

export interface MarketContextResult {
    symbol: string;
    currentPrice: number;
    change: number;
    changePercent: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    timestamp: number;
    source: "realmarket";
}

const REALMARKET_BASE = "https://api.realmarketapi.com";

export async function getMarketContext(
    symbol: SupportedSymbol
): Promise<MarketContextResult | null> {
    const apiKey = process.env.REALMARKET_API_KEY;
    if (!apiKey) return null;

    const data = await fetchJsonWithRetry<{
        symbolCode?: string;
        price?: number;
        bid?: number;
        ask?: number;
        change?: number;
        changePercent?: number;
        high24h?: number;
        low24h?: number;
        volume24h?: number;
        timestamp?: number;
        datetime?: string;
    }>(
        `${REALMARKET_BASE}/price?symbolCode=${encodeURIComponent(symbol)}`,
        {
            headers: { "x-api-key": apiKey },
        }
    );

    if (!data || data.price == null) return null;

    const price = data.price;
    const timestamp = data.timestamp
        ? (data.timestamp > 1_000_000_000 ? data.timestamp : data.timestamp * 1000)
        : Date.now();

    return {
        symbol: symbol,
        currentPrice: price,
        change: data.change ?? 0,
        changePercent: data.changePercent ?? 0,
        high24h: data.high24h ?? price,
        low24h: data.low24h ?? price,
        volume24h: data.volume24h ?? 0,
        timestamp,
        source: "realmarket",
    };
}
