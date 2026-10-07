import { NextRequest, NextResponse } from "next/server";
import { validateSymbol, validateTimeframe } from "@/lib/market-data/validation";
import {
    OHLC_MAX_LIMIT,
    clampOhlcLimit,
    fetchCandles,
    timeframeToLimit,
} from "@/lib/market-data/normalizer";
import { tradingViewLivePriceCache } from "@/lib/market-data/tradingview-live";
import { hasTwelveDataApiKey } from "@/lib/market-data/twelvedata/config";
import { fetchDeepHistoryPage } from "@/lib/market-data/twelvedata/candle-bridge";
import { SUPPORTED_SYMBOLS, type MarketCandle } from "@/lib/market-data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = OHLC_MAX_LIMIT;

/**
 * GET /api/analytics/ohlc — canonical chart history endpoint.
 *
 * Modes:
 *  default           → newest page (Biquote, shallow window capped by the
 *                      provider itself at ~300 bars)
 *  before=<ms>       → one page strictly older than the boundary (deep history
 *                      via Twelve Data when configured; otherwise an empty
 *                      success payload — the client treats that as the
 *                      provider's history boundary, never an error)
 *  from=&to=<ms>     → explicit range fill used by gap repair
 *
 * `limit=<n>`      → page size for any mode: validated, clamped to
 *                      [OHLC_MIN_LIMIT..OHLC_MAX_LIMIT] (2000) and honored
 *                      end-to-end (it reaches the provider). Absent or
 *                      unparsable → the timeframe-aware default. The
 *                      timeframe table never shrinks an explicit request.
 *
 * `hasDeepHistory` tells the client which of the first two modes can deliver
 * more data. No candles are ever synthesized: an empty page is an honest
 * empty page.
 */
export async function GET(request: NextRequest) {
    try {
        // ── alias normalisation ──────────────────────────────────────────────
        // Signals may be stored with legacy names (SP500, GOLD, BTCUSDT, etc.).
        // Resolve to the canonical SupportedSymbol before validation so every
        // consumer gets data without needing client-side mapping.
        const ALIASES: Record<string, string> = {
            SP500: "SPX500", S500: "SPX500", US500: "SPX500", SPXUSD: "SPX500", SPX: "SPX500",
            DJIA: "US30", DOW: "US30", DOW30: "US30", DOWJONES: "US30",
            NDX: "NAS100", NAS: "NAS100", NASDAQ: "NAS100", NASDAQ100: "NAS100",
            GOLD: "XAUUSD", SILVER: "XAGUSD",
            BTCUSDT: "BTCUSD", ETHUSDT: "ETHUSD",
        };
        const rawSymbol = (request.nextUrl.searchParams.get("symbol") || "XAUUSD").toUpperCase();
        const symbolParam = ALIASES[rawSymbol] ?? rawSymbol;
        const timeframeParam = request.nextUrl.searchParams.get("timeframe") || "H1";
        const beforeParam = request.nextUrl.searchParams.get("before");
        const fromParam = request.nextUrl.searchParams.get("from");
        const toParam = request.nextUrl.searchParams.get("to");

        const symbol = validateSymbol(symbolParam);
        const timeframe = validateTimeframe(timeframeParam);

        if (!symbol) {
            return NextResponse.json({ error: `Invalid symbol. Supported: ${SUPPORTED_SYMBOLS.join(", ")}` }, { status: 400 });
        }
        if (!timeframe) {
            return NextResponse.json({ error: "Invalid timeframe" }, { status: 400 });
        }

        // Explicit client limit: validated, clamped to the safe window, and
        // honored end-to-end (it reaches the provider below). Absent or
        // unparsable → the timeframe-aware default. The timeframe table can
        // never shrink an explicit request.
        const rawLimit = request.nextUrl.searchParams.get("limit");
        const limit = (rawLimit !== null ? clampOhlcLimit(rawLimit) : null)
            ?? timeframeToLimit(timeframe);
        const deepAvailable = hasTwelveDataApiKey();
        const pagingRequested = beforeParam !== null || fromParam !== null || toParam !== null;

        let candles: MarketCandle[] = [];

        if (pagingRequested && deepAvailable) {
            // Deep-history path (Twelve Data). Range fill wins over page-back.
            const fromMs = fromParam !== null ? Number(fromParam) : undefined;
            const toMs = toParam !== null ? Number(toParam) : undefined;
            if (fromMs !== undefined && toMs !== undefined && Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
                const before = toMs + 1;
                const page = await fetchDeepHistoryPage(symbol, timeframe, { beforeMs: before, limit });
                candles = (page ?? []).filter((c) => c.timestamp >= fromMs && c.timestamp <= toMs);
            } else if (beforeParam !== null && Number.isFinite(Number(beforeParam))) {
                const page = await fetchDeepHistoryPage(symbol, timeframe, { beforeMs: Number(beforeParam), limit });
                candles = page ?? [];
            }
        } else if (pagingRequested) {
            // Paging requested but no deep provider configured: report the
            // boundary honestly instead of returning duplicated shallow data.
            return NextResponse.json({
                success: true,
                symbol,
                timeframe,
                candles: [],
                candleCount: 0,
                hasDeepHistory: false,
                timestamp: Date.now(),
            });
        } else {
            candles = await fetchCandles(symbol, timeframe, { limit });
        }

        if (!pagingRequested && candles.length === 0) {
            return NextResponse.json({ error: "No candles available for this symbol/timeframe" }, { status: 502 });
        }

        // Newest-page responses keep the historical slice behavior; paged
        // responses are already sized by the provider bridge.
        const sliced = pagingRequested ? candles : candles.slice(-Math.min(MAX_LIMIT, limit));

        const lastCandle = sliced[sliced.length - 1];
        const prevCandle = sliced.length > 1 ? sliced[sliced.length - 2] : lastCandle;

        // Live quote for the forming bar — only resolved on newest-page
        // requests so history paging stays cheap.
        let price: number | null = null;
        let quoteTs: number | undefined;
        if (!pagingRequested) {
            // Shared cache + deadline: this endpoint is also what the chart's
            // gap repair and reload paths call, so a slow provider here must
            // not stall the whole history response.
            const livePrice = await tradingViewLivePriceCache.get(symbol, { timeoutMs: 3000 });
            price = livePrice?.price ?? null;
            quoteTs = livePrice?.timestamp;
        }
        const priceValue = price ?? lastCandle?.close ?? 0;
        const changeFromLive = lastCandle ? priceValue - (prevCandle?.close || 0) : 0;

        return NextResponse.json({
            success: true,
            symbol,
            timeframe,
            candles: sliced,
            quote: lastCandle && !pagingRequested ? {
                symbol,
                bid: priceValue,
                ask: priceValue,
                spread: 0,
                change: Number(changeFromLive.toFixed(5)),
                changePercent: Number((prevCandle?.close ? (changeFromLive / prevCandle.close) * 100 : 0).toFixed(3)),
                timestamp: quoteTs ?? lastCandle.timestamp,
            } : null,
            candleCount: sliced.length,
            hasDeepHistory: deepAvailable,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error("OHLC API error:", err);
        return NextResponse.json({ error: "Failed to fetch OHLC data" }, { status: 500 });
    }
}
