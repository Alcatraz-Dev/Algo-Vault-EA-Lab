import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from "@/lib/market-data/types";
import { fetchTradingViewLivePrice, toTradingViewSymbol } from "@/lib/market-data/tradingview-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_SET = new Set<string>(SUPPORTED_SYMBOLS as readonly string[]);

/**
 * Normalise incoming symbol aliases to canonical SupportedSymbol names.
 * Signals (and old client code) may send "SP500", "GOLD", etc. This map lets
 * the server resolve a live price for them without requiring client changes.
 * The result is keyed by the ORIGINAL symbol so the client can match it back.
 */
const SYMBOL_ALIAS_MAP: Record<string, string> = {
    // Index aliases
    SP500: "SPX500", S500: "SPX500", US500: "SPX500",
    SPXUSD: "SPX500", SPX: "SPX500",
    DJIA: "US30", DOW: "US30", DOW30: "US30", DOWJONES: "US30",
    NDX: "NAS100", NAS: "NAS100", NASDAQ: "NAS100", NASDAQ100: "NAS100",
    // Commodity aliases
    GOLD: "XAUUSD", SILVER: "XAGUSD",
    // Crypto aliases
    BTCUSDT: "BTCUSD", ETHUSDT: "ETHUSD",
};

/**
 * GET /api/market/quotes?symbols=XAUUSD,EURUSD,BTCUSD
 *
 * Public live-price endpoint for chart tick polling. Resolves each symbol
 * through the TradingView scanner (real-time `close`). Per-symbol failures
 * are omitted, never faked.
 *
 * Accepts legacy/alias symbol names (SP500, GOLD, etc.) and normalises them
 * to canonical names before lookup, returning results keyed by the original
 * symbol so callers don't need to know about the mapping.
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
        symbols.map(async (rawSymbol) => {
            // Resolve alias → canonical, then verify it is in the supported set.
            const canonical = SYMBOL_ALIAS_MAP[rawSymbol] ?? rawSymbol;
            if (!SYMBOL_SET.has(canonical)) {
                return { symbol: rawSymbol, quote: null as null | { price: number; change?: number; changePercent?: number; timestamp: number; provider: string } };
            }
            const quote = await fetchTradingViewLivePrice(toTradingViewSymbol(canonical as SupportedSymbol));
            if (!quote) {
                return { symbol: rawSymbol, quote: null };
            }
            return {
                // Key by the ORIGINAL symbol the client sent so it can match
                // the result even when it used an alias.
                symbol: rawSymbol,
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
