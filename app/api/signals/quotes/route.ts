import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { fetchJsonWithRetry } from "@/lib/market-data/normalizer";

const BIQUOTE_BASE = "https://biquote.io/api";

interface BiquoteTickerItem {
    symbol: string;
    bid?: number;
    ask?: number;
    last?: number;
    price?: number;
    close?: number;
}

/**
 * GET /api/signals/quotes?symbols=XAUUSD,EURUSD,GBPUSD
 *
 * Returns a map of symbol → current bid price sourced from Biquote.
 * Used by the live price polling hook (useLivePrices) to keep signal
 * cards updated without a full market analytics round-trip.
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

        const symbols = symbolsParam
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
            .slice(0, 20); // hard cap

        if (symbols.length === 0) {
            return NextResponse.json({ prices: {} });
        }

        // Fetch each symbol from Biquote in parallel using the lightweight ticker endpoint.
        // Fall back gracefully: if one symbol fails its price is simply omitted.
        const results = await Promise.allSettled(
            symbols.map(async (symbol) => {
                const url = `${BIQUOTE_BASE}/tickers?symbol=${symbol}&limit=1`;
                const data = await fetchJsonWithRetry<BiquoteTickerItem[] | { tickers?: BiquoteTickerItem[] }>(url);

                let price: number | null = null;

                if (Array.isArray(data) && data.length > 0) {
                    const item = data[0] as BiquoteTickerItem;
                    price =
                        item.bid ??
                        item.ask ??
                        item.last ??
                        item.price ??
                        item.close ??
                        null;
                } else if (data && typeof data === "object" && "tickers" in data && Array.isArray(data.tickers) && data.tickers.length > 0) {
                    const item = data.tickers[0] as BiquoteTickerItem;
                    price =
                        item.bid ??
                        item.ask ??
                        item.last ??
                        item.price ??
                        item.close ??
                        null;
                }

                return { symbol, price };
            })
        );

        const prices: Record<string, number> = {};
        for (const result of results) {
            if (result.status === "fulfilled" && result.value.price != null && Number.isFinite(result.value.price)) {
                prices[result.value.symbol] = result.value.price;
            }
        }

        return NextResponse.json(
            { success: true, prices, timestamp: Date.now() },
            {
                headers: {
                    // Short cache to avoid hammering the upstream API
                    "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
                },
            }
        );
    } catch (err) {
        console.error("[signals/quotes] error:", err);
        return NextResponse.json({ error: "Failed to fetch quotes" }, { status: 500 });
    }
}
