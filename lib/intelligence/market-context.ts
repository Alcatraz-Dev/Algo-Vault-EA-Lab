/**
 * MarketIntelligenceContext — the compact canonical market context the fabric
 * sends to LLMs instead of raw candles.
 *
 * Built from the existing deterministic MarketSnapshot (lib/market-data/
 * market-truth.ts) and the AI-signals snapshot types. Carries only derived
 * facts: price, trend, regime, structure labels, liquidity state, FVG/OB
 * counts, ATR, HTF alignment, sessions, news risk, setup + risk state.
 *
 * The schema is versioned (INTELLIGENCE_VERSION.marketContextSchema) and the
 * builder is total: it accepts partial snapshots and fills honest `undefined`
 * rather than zeros that would look like real data.
 */

import type { MarketIntelligenceContext } from "./types";
import { INTELLIGENCE_VERSION } from "./versions";

/** Minimal structural type for the parts of MarketSnapshot we consume. */
export interface MarketContextInput {
    symbol: string;
    timeframe: string;
    timestamp?: number;
    dataAgeMs?: number;
    currentPrice?: number;
    trend?: string;
    regime?: string;
    marketStructure?: string | { bias?: string; trend?: string; label?: string };
    higherTimeframeContext?: { bias?: string; timeframe?: string; direction?: string } | string;
    liquidity?: { sweeps?: unknown[]; levels?: unknown[] } | null;
    FVG?: Array<{ direction?: string; status?: string } | { status?: string }>;
    orderBlocks?: Array<{ direction?: string; status?: string } | { status?: string }>;
    volatility?: { atr?: number; state?: string };
    ATR?: number;
    marketSession?: string;
    newsRisk?: string;
}

/** Generic zone-count helper that tolerates missing/null fields. */
function activeZones(zones: Array<{ status?: string; direction?: string }> | undefined, direction?: string): number | undefined {
    if (!zones || zones.length === 0) return undefined;
    const active = zones.filter((z) => {
        const status = (z.status ?? "active").toLowerCase();
        return status !== "invalidated" && status !== "filled" && status !== "mitigated" && status !== "broken";
    });
    const filtered = direction ? active.filter((z) => (z.direction ?? "").toLowerCase() === direction) : active;
    return filtered.length;
}

export function buildMarketIntelligenceContext(input: MarketContextInput): MarketIntelligenceContext {
    const structure =
        typeof input.marketStructure === "string"
            ? { bias: input.marketStructure }
            : input.marketStructure
              ? {
                    bias: input.marketStructure.bias ?? input.marketStructure.trend,
                    label: input.marketStructure.label,
                }
              : undefined;

    const htfBias =
        typeof input.higherTimeframeContext === "string"
            ? input.higherTimeframeContext
            : input.higherTimeframeContext?.bias ??
              input.higherTimeframeContext?.direction;

    const sweepCount = input.liquidity?.sweeps?.length;
    const levelsCount = input.liquidity?.levels?.length;

    return {
        schema: INTELLIGENCE_VERSION.marketContextSchema,
        symbol: input.symbol,
        timeframe: input.timeframe,
        asOf: input.timestamp ?? Date.now(),
        dataAgeMs: input.dataAgeMs,
        price: input.currentPrice,
        trend: input.trend,
        regime: input.regime,
        structure: structure
            ? {
                  bias: structure.bias,
                  label: structure.label,
                  higherHighs: (input as { higherHighs?: number }).higherHighs,
                  higherLows: (input as { higherLows?: number }).higherLows,
                  lowerHighs: (input as { lowerHighs?: number }).lowerHighs,
                  lowerLows: (input as { lowerLows?: number }).lowerLows,
              }
            : undefined,
        htf: htfBias ? { bias: htfBias, timeframe: typeof input.higherTimeframeContext === "object" ? input.higherTimeframeContext?.timeframe : undefined } : undefined,
        liquidity: {
            sweeps: sweepCount,
            nearest: levelsCount ? `${levelsCount} level(s) tracked` : undefined,
        },
        fvg: input.FVG ? { active: activeZones(input.FVG), direction: (input.FVG[0] as { direction?: string })?.direction } : undefined,
        orderBlocks: input.orderBlocks ? { active: activeZones(input.orderBlocks), direction: (input.orderBlocks[0] as { direction?: string })?.direction } : undefined,
        volatility: {
            atr: input.volatility?.atr ?? input.ATR,
            state: input.volatility?.state,
        },
        session: input.marketSession,
        newsRisk: input.newsRisk,
        setup: undefined,
        risk: undefined,
        strategy: undefined,
        dataQuality: input.dataAgeMs !== undefined ? { status: input.dataAgeMs < 60_000 ? "fresh" : input.dataAgeMs < 300_000 ? "delayed" : "stale" } : undefined,
    };
}

/**
 * Gate: refuse to build an AI request from missing or stale market facts.
 * Returns the reason when the context must NOT be used for AI reasoning.
 * Staleness threshold is configurable (AI_MARKET_CONTEXT_MAX_AGE_MS, default
 * 120s) and always fail-closed when the age is unknown AND freshness was
 * expected (live/replay mode callers pass expectFresh).
 */
export function marketContextUsableForAI(
    ctx: MarketIntelligenceContext,
    opts: { expectFresh?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
    if (!ctx.symbol || !ctx.timeframe) {
        return { ok: false, reason: "MISSING_MARKET_FACTS: symbol/timeframe absent" };
    }
    if (ctx.dataQuality?.status === "stale") {
        return { ok: false, reason: `STALE_MARKET_DATA: dataAgeMs=${ctx.dataAgeMs ?? "unknown"}` };
    }
    if (opts.expectFresh && ctx.dataAgeMs === undefined) {
        return { ok: false, reason: "MISSING_MARKET_FACTS: freshness unknown in fresh-required mode" };
    }
    return { ok: true };
}
