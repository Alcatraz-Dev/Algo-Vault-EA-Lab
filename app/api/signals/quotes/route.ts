import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { tradingViewLivePriceCache } from "@/lib/market-data/tradingview-live";
import type { TradingViewLivePrice } from "@/lib/market-data/tradingview-live";

const MAX_SYMBOLS = 20;

/**
 * GET /api/signals/quotes?symbols=XAUUSD,EURUSD,GBPUSD
 *
 * Authenticated live-price endpoint used by the signals pages (useLivePrices
 * hook) to keep signal cards, live panels, and the SL→TP tracks moving.
 *
 * Each symbol is resolved through the shared market-data resolver:
 *   1. Biquote forming M1 candle when it is genuinely fresh (< 2 min old) —
 *      this is the same tick-level feed the OHLC charts use;
 *   2. TradingView scanner close as fallback (US equities, indices, any
 *      symbol Biquote does not cover).
 *
 * A 5 s server-side cache + in-flight dedupe means 10 clients polling the
 * same symbol share one upstream call. Per-symbol failures are omitted,
 * never faked.
 */
export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const symbolsParam = request.nextUrl.searchParams.get("symbols");
        if (!symbolsParam) {
            return NextResponse.json({ error: "symbols parameter required" }, { status: 400 });
        }

        const symbols = Array.from(
            new Set(
                symbolsParam
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean)
            )
        ).slice(0, MAX_SYMBOLS);

        if (symbols.length === 0) {
            return NextResponse.json({ success: true, prices: {}, quotes: {}, timestamp: Date.now() });
        }

        const results = await Promise.allSettled(
            symbols.map(async (symbol) => ({
                symbol,
                quote: await tradingViewLivePriceCache.get(symbol),
            }))
        );

        const prices: Record<string, number> = {};
        const quotes: Record<
            string,
            Pick<TradingViewLivePrice, "price" | "change" | "changePercent" | "timestamp" | "provider">
        > = {};
        let oldestTimestamp = Number.POSITIVE_INFINITY;

        for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const { symbol, quote } = result.value;
            if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) continue;

            prices[symbol] = quote.price;
            quotes[symbol] = {
                price: quote.price,
                change: quote.change,
                changePercent: quote.changePercent,
                timestamp: quote.timestamp,
                provider: quote.provider,
            };
            if (quote.timestamp > 0) oldestTimestamp = Math.min(oldestTimestamp, quote.timestamp);
        }

        return NextResponse.json(
            {
                success: true,
                prices,
                quotes,
                timestamp: Date.now(),
                quoteTimestamp: Number.isFinite(oldestTimestamp) ? oldestTimestamp : Date.now(),
            },
            {
                headers: {
                    // Clients poll this route directly; the freshness contract
                    // is owned by the server cache, not HTTP caching.
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (err) {
        console.error("[signals/quotes] error:", err);
        return NextResponse.json({ error: "Failed to fetch quotes" }, { status: 500 });
    }
}
