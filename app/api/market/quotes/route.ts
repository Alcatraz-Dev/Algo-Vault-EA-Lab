import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from "@/lib/market-data/types";
import { fetchTradingViewLivePrice, toTradingViewSymbol } from "@/lib/market-data/tradingview-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_SET = new Set<string>(SUPPORTED_SYMBOLS as readonly string[]);

/**
 * GET /api/market/quotes?symbols=XAUUSD,EURUSD,BTCUSD
 *
 * Public live-price endpoint for chart tick polling. Resolves each symbol
 * through the TradingView scanner (real-time `close`) and falls back to the
 * Biquote last-candle price. Per-symbol failures are omitted, never faked.
 */
export async function GET(request: NextRequest) {
    const raw = request.nextUrl.searchParams.get("symbols") ?? "";
    const symbols = Array.from(
        new Set(
            raw
                .split(",")
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean)
        )
    ).slice(0, 30);

    if (symbols.length === 0) {
        return NextResponse.json({ error: "symbols parameter required" }, { status: 400 });
    }

    const results = await Promise.allSettled(
        symbols.map(async (symbol) => {
            if (!SYMBOL_SET.has(symbol)) {
                return { symbol, quote: null as null | { price: number; change?: number; changePercent?: number; timestamp: number; provider: string } };
            }
            const quote = await fetchTradingViewLivePrice(toTradingViewSymbol(symbol));
            if (!quote) {
                return { symbol, quote: null };
            }
            return {
                symbol,
                quote: {
                    price: quote.price,
                    change: quote.change,
                    changePercent: quote.changePercent,
                    timestamp: quote.timestamp,
                    provider: quote.provider,
                },
            };
        })
    );

    const quotes: Record<string, { price: number; change?: number; changePercent?: number; timestamp: number; provider: string }> = {};
    for (const result of results) {
        if (result.status === "fulfilled" && result.value.quote) {
            quotes[result.value.symbol] = result.value.quote;
        }
    }

    return NextResponse.json(
        { success: true, quotes, timestamp: Date.now() },
        { headers: { "Cache-Control": "no-store" } }
    );
}
