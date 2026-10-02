import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { fetchGexChain } from "@/lib/order-flow/options-provider";
import { featureAvailabilityForSymbol, CRYPTO_GEX_SYMBOLS } from "@/lib/order-flow/options-types";
import { validateSymbol } from "@/lib/market-data/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/order-flow/options?symbol=NVDA — real options chain for the GEX
 * engine, normalized into validated `OptionQuote` records.
 *
 * Per-symbol sources (public, key-less):
 *  • BTCUSD/ETHUSD → Deribit (mark IV + OI in coins; multiplier 1).
 *  • SPX500/NAS100/US30 + ETFs/equities → CBOE delayed quotes (~15 min).
 *  • Forex/metals → no listed options source; `available: false`, GEX stays
 *    explicitly UNAVAILABLE for those symbols. Nothing is fabricated.
 *
 * Responses are cached per symbol for 90 s: every terminal/user polls the
 * same upstream, so this protects the shared IP budget while staying fresh
 * enough for intraday gamma levels. Failures degrade to
 * `available: false` + error rather than a fabricated chain.
 */

const CACHE_TTL_MS = 90_000;
const cache = new Map<string, { at: number; payload: unknown }>();

export async function GET(request: NextRequest) {
    // Auth (same Bearer + adminAuth pattern as /api/order-flow/settings).
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        await adminAuth.verifyIdToken(token);
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const symbol = validateSymbol(request.nextUrl.searchParams.get("symbol") ?? "");
    if (!symbol) {
        return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    }

    const now = Date.now();
    const cached = cache.get(symbol);
    if (cached && now - cached.at < CACHE_TTL_MS) {
        return NextResponse.json(cached.payload);
    }

    const result = await fetchGexChain(symbol);
    const { features } = featureAvailabilityForSymbol(symbol);
    const usable = result.available && result.quotes.length > 0;

    const payload = {
        success: usable,
        symbol,
        available: result.available,
        source: result.source,
        spot: result.spot,
        quoteCount: result.quotes.length,
        rejected: result.rejected,
        contractMultiplier: CRYPTO_GEX_SYMBOLS.has(symbol) ? 1 : undefined,
        error: usable ? null : result.error ?? "no-options-data",
        fetchedAt: now,
        quotes: usable ? result.quotes : [],
        featureAvailability: features,
    };

    // Cache even unusable responses (short-TTL negative caching) so an outage
    // doesn't turn every user request into a fresh upstream attempt.
    cache.set(symbol, { at: now, payload });

    return NextResponse.json(payload, { status: 200 });
}
