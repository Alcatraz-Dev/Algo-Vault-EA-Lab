/**
 * AlgoVault advanced analysis — structure, multi-timeframe, regime, evidence.
 *
 * Pure aggregation over candles that the API layer has already fetched. It
 * performs no I/O, so it is directly unit-testable and safe to call from a
 * route handler without another round of provider traffic.
 *
 * Every field is a `Sourced<T>`. Nothing here invents a value: when an engine
 * cannot answer for a timeframe (for example M3, which the biquote feed does
 * not serve) the result is `unavailable` with a reason, and the UI renders
 * "Data unavailable".
 */

import type {
    LiquidityLevel,
    LiquiditySweep,
    MarketCandle,
    MarketRegime,
    MarketStructureEvent,
    Timeframe,
    Zone,
} from "@/lib/market-data/types";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP, getVWAPPosition } from "@/lib/analytics/vwap";
import { detectFairValueGaps, detectOrderBlocks } from "@/lib/analytics/zones";
import { scoreAllZones } from "@/lib/analytics/zones/zone-scoring";
import { computeIndicatorSnapshot } from "@/lib/analytics/indicators";
import {
    type MetricSource,
    type Sourced,
    sourced,
    sourcedArray,
    sourcedNumber,
    unavailable,
} from "@/lib/ai/provenance";
import { type Bias, type EvidenceItem, MIN_BARS } from "@/lib/ai/agents/pipeline";

/** The ladder required by the advanced analysis workspace. */
export const ANALYSIS_LADDER: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4"];

export type CandleBundle = Partial<Record<Timeframe, MarketCandle[]>>;

// ── A. Market structure ─────────────────────────────────────────────────────

export type PriceLevel = {
    price: number;
    touches: number;
    strength: number;
    lastTouch: number;
    kind: "support" | "resistance";
};

export type ReversalSetup = {
    detected: boolean;
    /** Structure bias before the most recent break of character. */
    priorBias: Bias;
    /** Structure bias after it. */
    currentBias: Bias;
    breakTimestamp: number;
    breakPrice: number;
    barsSince: number;
};

export type MarketStructureAnalysis = {
    trend: Sourced<Bias>;
    structureEvents: Sourced<MarketStructureEvent[]>;
    bosEvents: MarketStructureEvent[];
    chochEvents: MarketStructureEvent[];
    swingHighs: MarketStructureEvent[];
    swingLows: MarketStructureEvent[];
    lastEvent: MarketStructureEvent | null;
    support: Sourced<PriceLevel[]>;
    resistance: Sourced<PriceLevel[]>;
    liquidityLevels: Sourced<LiquidityLevel[]>;
    liquiditySweeps: Sourced<LiquiditySweep[]>;
    fairValueGaps: Sourced<Zone[]>;
    orderBlocks: Sourced<Zone[]>;
    /** Derived from real BOS/CHOCH sequence — never asserted without events. */
    reversalSetup: Sourced<ReversalSetup>;
    vwap: Sourced<number>;
    vwapPosition: Sourced<"above" | "below" | "at">;
};

// ── B. Multi-timeframe ──────────────────────────────────────────────────────

export type TimeframeAnalysis = {
    timeframe: Timeframe;
    bars: number;
    dataAsOf: number | null;
    available: boolean;
    reason?: string;
    trend: Sourced<Bias>;
    momentum: Sourced<Bias>;
    volatilityState: Sourced<"low" | "normal" | "high" | "extreme">;
    atrPercent: Sourced<number>;
    structure: Sourced<Bias>;
    regime: Sourced<MarketRegime>;
    /** "aligned" when this timeframe agrees with the ladder majority. */
    alignment: Sourced<"aligned" | "conflicting" | "neutral">;
    vwapPosition: Sourced<"above" | "below" | "at">;
};

export type MultiTimeframeAnalysis = {
    timeframes: TimeframeAnalysis[];
    availableCount: number;
    requestedCount: number;
    dominantBias: Sourced<Bias>;
    alignedCount: number;
    conflictingCount: number;
    alignmentRatio: Sourced<number>;
    summary: Sourced<string>;
};

// ── C. Market regime ────────────────────────────────────────────────────────

export type RegimeAnalysis = {
    regime: Sourced<MarketRegime>;
    label: Sourced<string>;
    confidence: Sourced<number>;
    /** Free-text factors produced by the existing regime classifier. */
    classifierFactors: string[];
    evidence: EvidenceItem[];
    reversal: Sourced<ReversalSetup>;
};

// ── D. AI evidence ──────────────────────────────────────────────────────────

export type EvidenceSection = {
    id: "structure" | "momentum" | "liquidity" | "volatility" | "mtfAlignment";
    label: string;
    /** 0..1, or null when the section could not be measured. */
    score: number | null;
    detail: string;
    metrics: Array<{ label: string; value: number | null; unit: string }>;
    source: MetricSource;
};

export type AdvancedAnalysisResult = {
    symbol: string;
    asOf: number;
    primaryTimeframe: Timeframe;
    structure: MarketStructureAnalysis;
    multiTimeframe: MultiTimeframeAnalysis;
    regime: RegimeAnalysis;
    evidence: EvidenceSection[];
    /** Zones with real scores, ready for chart overlay. */
    scoredZones: Array<{ zone: Zone; score: number; reasons: string[] }>;
};

// ── helpers ─────────────────────────────────────────────────────────────────

function tfAsOf(candles: MarketCandle[] | undefined): number | null {
    if (!candles || candles.length === 0) return null;
    return candles[candles.length - 1].timestamp;
}

function lastPrice(candles: MarketCandle[] | undefined): number | null {
    if (!candles || candles.length === 0) return null;
    return candles[candles.length - 1].close;
}

const PRICE_REQUIRED = "VWAP position requires a last price.";

/**
 * Cluster swing points into support / resistance bands.
 *
 * Tolerance is a fraction of the symbol's own range over the analysed window,
 * so the same rule works for EURUSD and for NAS100 without a per-symbol table.
 * Every returned level is derived from a counted number of real swings.
 */
export function clusterSwingLevels(
    swings: MarketStructureEvent[],
    reference: number,
    range: number,
    kind: "support" | "resistance",
    toleranceRatio = 0.0015
): PriceLevel[] {
    if (swings.length === 0 || range <= 0) return [];
    const tolerance = range * toleranceRatio;
    const points = swings
        .filter((s) =>
            kind === "support" ? s.price < reference : s.price > reference
        )
        .map((s) => ({ price: s.price, timestamp: s.timestamp }))
        .sort((a, b) => a.price - b.price);

    const clusters: Array<{ sum: number; count: number; lastTouch: number; prices: number[] }> = [];
    for (const p of points) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(p.price - last.sum / last.count) <= tolerance) {
            last.sum += p.price;
            last.count += 1;
            last.prices.push(p.price);
            last.lastTouch = Math.max(last.lastTouch, p.timestamp);
        } else {
            clusters.push({ sum: p.price, count: 1, lastTouch: p.timestamp, prices: [p.price] });
        }
    }

    return clusters
        .map((c) => {
            const price = c.sum / c.count;
            return {
                price,
                touches: c.count,
                // Strength is purely a function of touch count; documented so the
                // UI never implies a model score where none exists.
                strength: c.count,
                lastTouch: c.lastTouch,
                kind,
            };
        })
        .sort((a, b) => (kind === "support" ? a.price - b.price : b.price - a.price));
}

/**
 * A reversal is reported only when a real break of character actually flipped
 * the prevailing structure bias. No events ⇒ unavailable, never "no reversal
 * detected as a confident negative".
 */
/**
 * Derive a reversal from the real BOS/CHOCH sequence.
 *
 * A reversal requires at least two breaks of character with a *change* in the
 * overall structure bias. Anything less is not a reversal, so `null` is returned
 * — the callers surface that as an unavailable state rather than assuming one.
 */
export function deriveReversalSetup(
    events: MarketStructureEvent[],
    candles: MarketCandle[]
): ReversalSetup | null {
    const breaks = events.filter((e) => e.type === "BOS" || e.type === "CHOCH");
    if (breaks.length < 2) return null;

    const lookback = 5;
    const window = breaks.slice(-lookback);
    if (window.length < 2) return null;

    const before = breaks.slice(-lookback - 1, -1);
    const priorBias = (getOverallStructureBias(before) as Bias) ?? "neutral";
    const currentBias = getOverallStructureBias(window) as Bias;

    if (priorBias === "neutral" || currentBias === "neutral") return null;
    if (priorBias === currentBias) return null;

    const last = breaks[breaks.length - 1];
    const barsSince = candles.filter((c) => c.timestamp >= last.timestamp).length;

    return {
        detected: true,
        priorBias,
        currentBias,
        breakTimestamp: last.timestamp,
        breakPrice: last.price,
        barsSince,
    };
}

// ── A. structure ────────────────────────────────────────────────────────────

export function analyseStructure(
    candles: MarketCandle[] | undefined,
    timeframe: Timeframe
): MarketStructureAnalysis {
    const dataAsOf = tfAsOf(candles);
    const price = lastPrice(candles);
    const src = { id: "analytics.market-structure" as const };

    if (!candles || candles.length < MIN_BARS) {
        const reason = `Needs at least ${MIN_BARS} bars; received ${candles?.length ?? 0}.`;
        return {
            trend: unavailable<Bias>(src.id, reason, dataAsOf),
            structureEvents: unavailable<MarketStructureEvent[]>(src.id, reason, dataAsOf),
            bosEvents: [],
            chochEvents: [],
            swingHighs: [],
            swingLows: [],
            lastEvent: null,
            support: unavailable<PriceLevel[]>(src.id, reason, dataAsOf),
            resistance: unavailable<PriceLevel[]>(src.id, reason, dataAsOf),
            liquidityLevels: unavailable<LiquidityLevel[]>("analytics.liquidity", reason, dataAsOf),
            liquiditySweeps: unavailable<LiquiditySweep[]>("analytics.liquidity", reason, dataAsOf),
            fairValueGaps: unavailable<Zone[]>("analytics.zones", reason, dataAsOf),
            orderBlocks: unavailable<Zone[]>("analytics.zones", reason, dataAsOf),
            reversalSetup: unavailable<ReversalSetup>("analytics.market-structure", reason, dataAsOf),
            vwap: unavailable<number>("analytics.vwap", reason, dataAsOf),
            vwapPosition: unavailable<"above" | "below" | "at">("analytics.vwap", reason, dataAsOf),
        };
    }

    const events = detectStructure(candles, timeframe);
    const swings = events.filter((e) => e.type === "swing_high" || e.type === "swing_low");
    const swingHighs = events.filter((e) => e.type === "swing_high");
    const swingLows = events.filter((e) => e.type === "swing_low");
    const bos = events.filter((e) => e.type === "BOS");
    const choch = events.filter((e) => e.type === "CHOCH");
    const breaks = [...bos, ...choch].sort((a, b) => a.timestamp - b.timestamp);
    const lastEvent = breaks.length > 0 ? breaks[breaks.length - 1] : null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const range = Math.max(...highs) - Math.min(...lows);

    const { levels, sweeps } = detectLiquidity(candles, timeframe);
    const fvgs = detectFairValueGaps(candles, timeframe);
    const obs = detectOrderBlocks(candles, timeframe);
    const vwapData = calculateVWAP(candles, "session");
    const position = price === null ? null : getVWAPPosition(price, vwapData);
    const reversal = deriveReversalSetup(events, candles);

    const support = price === null ? [] : clusterSwingLevels(swings, price, range, "support");
    const resistance = price === null ? [] : clusterSwingLevels(swings, price, range, "resistance");

    return {
        trend: sourced(getOverallStructureBias(breaks) as Bias, src.id, dataAsOf),
        structureEvents: sourcedArray(events, src.id, dataAsOf),
        bosEvents: bos,
        chochEvents: choch,
        swingHighs,
        swingLows,
        lastEvent,
        support: sourcedArray(support, "analytics.market-structure", dataAsOf),
        resistance: sourcedArray(resistance, "analytics.market-structure", dataAsOf),
        liquidityLevels: sourcedArray(levels, "analytics.liquidity", dataAsOf),
        liquiditySweeps: sourcedArray(sweeps, "analytics.liquidity", dataAsOf),
        fairValueGaps: sourcedArray(fvgs, "analytics.zones", dataAsOf),
        orderBlocks: sourcedArray(obs, "analytics.zones", dataAsOf),
        reversalSetup:
            reversal === null
                ? unavailable<ReversalSetup>(
                      "analytics.market-structure",
                      "No break of character flipped the prevailing structure bias in the analysed window.",
                      dataAsOf
                  )
                : sourced(reversal, "analytics.market-structure", dataAsOf),
        vwap: sourcedNumber(vwapData.vwap, "analytics.vwap", dataAsOf),
        vwapPosition:
            position === null
                ? unavailable<"above" | "below" | "at">("analytics.vwap", PRICE_REQUIRED, dataAsOf)
                : sourced(position, "analytics.vwap", dataAsOf),
    };
}

// ── B. multi-timeframe ──────────────────────────────────────────────────────

export function analyseTimeframe(
    timeframe: Timeframe,
    candles: MarketCandle[] | undefined,
    dominantBias: Bias | null
): TimeframeAnalysis {
    const dataAsOf = tfAsOf(candles);
    const price = lastPrice(candles);

    if (!candles || candles.length === 0) {
        return {
            timeframe,
            bars: 0,
            dataAsOf: null,
            available: false,
            reason: "No candles returned for this timeframe by the market data provider.",
            trend: unavailable<Bias>("analytics.market-structure", "No candles.", dataAsOf),
            momentum: unavailable<Bias>("analytics.indicators", "No candles.", dataAsOf),
            volatilityState: unavailable<"low" | "normal" | "high" | "extreme">(
                "analytics.volatility",
                "No candles.",
                dataAsOf
            ),
            atrPercent: unavailable<number>("analytics.volatility", "No candles.", dataAsOf),
            structure: unavailable<Bias>("analytics.market-structure", "No candles.", dataAsOf),
            regime: unavailable<MarketRegime>("analytics.market-regime", "No candles.", dataAsOf),
            alignment: unavailable<"aligned" | "conflicting" | "neutral">(
                "analytics.multi-timeframe",
                "No candles.",
                dataAsOf
            ),
            vwapPosition: unavailable<"above" | "below" | "at">("analytics.vwap", "No candles.", dataAsOf),
        };
    }

    if (candles.length < MIN_BARS) {
        const reason = `Needs at least ${MIN_BARS} bars; received ${candles.length}.`;
        return {
            timeframe,
            bars: candles.length,
            dataAsOf,
            available: false,
            reason,
            trend: unavailable<Bias>("analytics.market-structure", reason, dataAsOf),
            momentum: unavailable<Bias>("analytics.indicators", reason, dataAsOf),
            volatilityState: unavailable<"low" | "normal" | "high" | "extreme">(
                "analytics.volatility",
                reason,
                dataAsOf
            ),
            atrPercent: unavailable<number>("analytics.volatility", reason, dataAsOf),
            structure: unavailable<Bias>("analytics.market-structure", reason, dataAsOf),
            regime: unavailable<MarketRegime>("analytics.market-regime", reason, dataAsOf),
            alignment: unavailable<"aligned" | "conflicting" | "neutral">(
                "analytics.multi-timeframe",
                reason,
                dataAsOf
            ),
            vwapPosition: unavailable<"above" | "below" | "at">("analytics.vwap", reason, dataAsOf),
        };
    }

    const structureEvents = detectStructure(candles, timeframe);
    const breaks = structureEvents.filter((e) => e.type === "BOS" || e.type === "CHOCH");
    const structureBias = getOverallStructureBias(breaks) as Bias;

    const snap = computeIndicatorSnapshot(candles);
    const momentumBias: Bias =
        snap.supertrendDirection !== "neutral"
            ? snap.supertrendDirection
            : snap.ema20 !== null && snap.ema50 !== null
              ? snap.ema20 > snap.ema50
                  ? "bullish"
                  : "bearish"
              : "neutral";

    const vol = analyzeVolatility(candles, 14);
    const regime = detectRegime(candles, timeframe);
    const vwapData = calculateVWAP(candles, "session");
    const position = price === null ? null : getVWAPPosition(price, vwapData);

    // Trend for the ladder: structure bias wins, momentum breaks ties.
    const trend: Bias =
        structureBias !== "neutral" ? structureBias : momentumBias;

    const alignment: "aligned" | "conflicting" | "neutral" =
        dominantBias === null || trend === "neutral" || dominantBias === "neutral"
            ? "neutral"
            : trend === dominantBias
              ? "aligned"
              : "conflicting";

    return {
        timeframe,
        bars: candles.length,
        dataAsOf,
        available: true,
        trend: sourced(trend, "analytics.market-structure", dataAsOf),
        momentum: sourced(momentumBias, "analytics.indicators", dataAsOf),
        volatilityState: sourced(vol.state, "analytics.volatility", dataAsOf),
        atrPercent: sourcedNumber(vol.atrPercent, "analytics.volatility", dataAsOf),
        structure: sourced(structureBias, "analytics.market-structure", dataAsOf),
        regime: sourced(regime.regime, "analytics.market-regime", dataAsOf),
        alignment: sourced(alignment, "analytics.multi-timeframe", dataAsOf),
        vwapPosition:
            position === null
                ? unavailable<"above" | "below" | "at">("analytics.vwap", PRICE_REQUIRED, dataAsOf)
                : sourced(position, "analytics.vwap", dataAsOf),
    };
}

export function analyseMultiTimeframe(
    bundle: CandleBundle,
    ladder: Timeframe[] = ANALYSIS_LADDER
): MultiTimeframeAnalysis {
    // First pass: per-timeframe readings with no majority to align against.
    const first = ladder.map((tf) => analyseTimeframe(tf, bundle[tf], null));

    const measured = first.filter((t) => t.trend.status === "available");
    const votes: Bias[] = measured
        .map((t) => t.trend.value)
        .filter((v): v is Bias => v !== null);

    const bull = votes.filter((v) => v === "bullish").length;
    const bear = votes.filter((v) => v === "bearish").length;
    const dominantBias: Bias | null =
        votes.length === 0 ? null : bull === bear ? "neutral" : bull > bear ? "bullish" : "bearish";

    // Second pass: alignment resolved against the majority.
    const timeframes = ladder.map((tf) => analyseTimeframe(tf, bundle[tf], dominantBias));
    const aligned = timeframes.filter((t) => t.alignment.value === "aligned").length;
    const conflicting = timeframes.filter((t) => t.alignment.value === "conflicting").length;

    const dominantSource: Sourced<Bias> =
        dominantBias === null
            ? unavailable<Bias>(
                  "analytics.multi-timeframe",
                  "No timeframe in the ladder produced a usable structure bias.",
                  null
              )
            : sourced(dominantBias, "analytics.multi-timeframe", null);

    const alignmentRatio = measured.length > 0 ? aligned / measured.length : null;

    const summary =
        dominantBias === null
            ? unavailable<string>(
                  "analytics.multi-timeframe",
                  "No timeframe in the ladder produced a usable structure bias.",
                  null
              )
            : sourced(
                  `${aligned} of ${measured.length} measured timeframes align with a ${dominantBias} dominant bias; ${conflicting} conflict.`,
                  "analytics.multi-timeframe",
                  null
              );

    return {
        timeframes,
        availableCount: measured.length,
        requestedCount: ladder.length,
        dominantBias: dominantSource,
        alignedCount: aligned,
        conflictingCount: conflicting,
        alignmentRatio: sourcedNumber(
            alignmentRatio,
            "analytics.multi-timeframe",
            null,
            "No timeframe produced a usable bias."
        ),
        summary,
    };
}

// ── C. regime ───────────────────────────────────────────────────────────────

const REGIME_LABELS: Record<MarketRegime, string> = {
    trending_bullish: "TRENDING",
    trending_bearish: "TRENDING",
    ranging: "RANGING",
    breakout: "BREAKOUT",
    high_volatility: "HIGH VOLATILITY",
    low_volatility: "LOW VOLATILITY",
    transitional: "TRANSITIONAL",
};

export function analyseRegime(
    candles: MarketCandle[] | undefined,
    timeframe: Timeframe,
    reversalSetup: ReversalSetup | null
): RegimeAnalysis {
    const dataAsOf = tfAsOf(candles);

    if (!candles || candles.length < MIN_BARS) {
        const reason = `Needs at least ${MIN_BARS} bars; received ${candles?.length ?? 0}.`;
        return {
            regime: unavailable<MarketRegime>("analytics.market-regime", reason, dataAsOf),
            label: unavailable<string>("analytics.market-regime", reason, dataAsOf),
            confidence: unavailable<number>("analytics.market-regime", reason, dataAsOf),
            classifierFactors: [],
            evidence: [],
            reversal: unavailable<ReversalSetup>("analytics.market-regime", reason, dataAsOf),
        };
    }

    const regime = detectRegime(candles, timeframe);
    const vol = analyzeVolatility(candles, 14);
    const volume = analyzeVolume(candles);
    const vwapData = calculateVWAP(candles, "session");
    const price = lastPrice(candles);

    const evidence: EvidenceItem[] = [
        {
            id: "regime",
            label: "Regime classifier score",
            value: regime.confidence,
            unit: "0-100",
            detail: regime.factors.join(" · ") || "No classifier factors reported.",
            source: { id: "analytics.market-regime", label: "Regime classifier", kind: "analytics", asOf: dataAsOf },
        },
        {
            id: "atr",
            label: "ATR(14)",
            value: vol.atr,
            unit: "price",
            detail: `ATR is ${vol.atrPercent?.toFixed(4) ?? "n/a"}% of price — state ${vol.state}.`,
            source: { id: "analytics.volatility", label: "Volatility engine (ATR)", kind: "analytics", asOf: dataAsOf },
        },
        {
            id: "volume",
            label: "Relative volume",
            value: volume.relativeVolume,
            unit: "× average",
            detail: `Tick-volume state: ${volume.state}.`,
            source: { id: "analytics.volume", label: "Volume engine (tick volume)", kind: "analytics", asOf: dataAsOf },
        },
        {
            id: "vwap",
            label: "VWAP distance",
            value: vwapData.distancePercent,
            unit: "%",
            detail:
                price === null
                    ? "No last price."
                    : `Price is ${vwapData.distancePercent.toFixed(3)}% from session VWAP.`,
            source: { id: "analytics.vwap", label: "VWAP engine", kind: "analytics", asOf: dataAsOf },
        },
        {
            id: "reversal",
            label: "Break of character",
            value: reversalSetup ? reversalSetup.barsSince : null,
            unit: "bars since",
            detail: reversalSetup
                ? `Structure flipped ${reversalSetup.priorBias} → ${reversalSetup.currentBias}.`
                : "No structure bias flip in the analysed window.",
            source: { id: "analytics.market-structure", label: "Structure engine (BOS / CHOCH / swings)", kind: "analytics", asOf: dataAsOf },
        },
    ];

    return {
        regime: sourced(regime.regime, "analytics.market-regime", dataAsOf),
        label: sourced(REGIME_LABELS[regime.regime], "analytics.market-regime", dataAsOf),
        confidence: sourcedNumber(regime.confidence, "analytics.market-regime", dataAsOf),
        classifierFactors: regime.factors,
        evidence,
        reversal:
            reversalSetup === null
                ? unavailable<ReversalSetup>(
                      "analytics.market-structure",
                      "No break of character flipped the prevailing structure bias.",
                      dataAsOf
                  )
                : sourced(reversalSetup, "analytics.market-structure", dataAsOf),
    };
}

// ── D. evidence ─────────────────────────────────────────────────────────────

function scoreToEvidence(
    id: EvidenceSection["id"],
    label: string,
    bullish: number,
    bearish: number,
    detail: string,
    metrics: EvidenceSection["metrics"],
    source: MetricSource
): EvidenceSection {
    const bullWeight = bullish;
    const bearWeight = bearish;
    const total = bullWeight + bearWeight;
    return {
        id,
        label,
        score: total > 0 ? Math.max(bullWeight, bearWeight) / total : null,
        detail,
        metrics,
        source,
    };
}

export function buildEvidence(
    structure: MarketStructureAnalysis,
    mtf: MultiTimeframeAnalysis,
    candles: MarketCandle[] | undefined,
    timeframe: Timeframe,
    finalConfidence: Sourced<number> | null
): EvidenceSection[] {
    const dataAsOf = tfAsOf(candles);
    const price = lastPrice(candles);
    const snap =
        candles && candles.length >= MIN_BARS ? computeIndicatorSnapshot(candles) : null;

    const structureBull = structure.trend.value === "bullish" ? 1 : 0;
    const structureBear = structure.trend.value === "bearish" ? 1 : 0;
    const structureSection = scoreToEvidence(
        "structure",
        "Market structure",
        structureBull,
        structureBear,
        structure.trend.status === "available"
            ? `${structure.bosEvents.length} BOS and ${structure.chochEvents.length} CHOCH events.`
            : (structure.trend.reason ?? "Structure unavailable."),
        [
            { label: "Bias", value: structure.trend.value === "bullish" ? 1 : structure.trend.value === "bearish" ? -1 : null, unit: "signed" },
            { label: "BOS", value: structure.bosEvents.length, unit: "events" },
            { label: "CHOCH", value: structure.chochEvents.length, unit: "events" },
            { label: "Support levels", value: structure.support.value?.length ?? null, unit: "levels" },
            { label: "Resistance levels", value: structure.resistance.value?.length ?? null, unit: "levels" },
        ],
        { id: "analytics.market-structure", label: "Structure engine (BOS / CHOCH / swings)", kind: "analytics", asOf: dataAsOf }
    );

    const momentumSection = scoreToEvidence(
        "momentum",
        "Momentum",
        snap && snap.supertrendDirection === "bullish" ? 1 : (snap?.rsi14 ?? 0) > 55 ? 1 : 0,
        snap && snap.supertrendDirection === "bearish" ? 1 : (snap?.rsi14 ?? 50) < 45 ? 1 : 0,
        snap
            ? `RSI ${snap.rsi14?.toFixed(2) ?? "n/a"} · supertrend ${snap.supertrendDirection}.`
            : "Indicator engine did not produce a snapshot.",
        [
            { label: "RSI(14)", value: snap?.rsi14 ?? null, unit: "index" },
            { label: "MACD histogram", value: snap?.macdHistogram ?? null, unit: "price" },
            { label: "EMA20", value: snap?.ema20 ?? null, unit: "price" },
            { label: "EMA50", value: snap?.ema50 ?? null, unit: "price" },
        ],
        { id: "analytics.indicators", label: "Indicator engine", kind: "analytics", asOf: dataAsOf }
    );

    const levels = structure.liquidityLevels.value ?? [];
    const aboveCount = price === null ? 0 : levels.filter((l) => l.price > price).length;
    const belowCount = price === null ? 0 : levels.filter((l) => l.price < price).length;
    const liquiditySection = scoreToEvidence(
        "liquidity",
        "Liquidity",
        belowCount,
        aboveCount,
        levels.length === 0
            ? "No liquidity levels detected."
            : `${levels.length} levels detected (${belowCount} below, ${aboveCount} above price).`,
        [
            { label: "Levels", value: structure.liquidityLevels.status === "available" ? levels.length : null, unit: "levels" },
            { label: "Sweeps", value: structure.liquiditySweeps.status === "available" ? structure.liquiditySweeps.value?.length ?? null : null, unit: "sweeps" },
            { label: "Fair value gaps", value: structure.fairValueGaps.status === "available" ? structure.fairValueGaps.value?.length ?? null : null, unit: "gaps" },
            { label: "Order blocks", value: structure.orderBlocks.status === "available" ? structure.orderBlocks.value?.length ?? null : null, unit: "blocks" },
        ],
        { id: "analytics.liquidity", label: "Liquidity engine (levels / sweeps)", kind: "analytics", asOf: dataAsOf }
    );

    const vol = candles && candles.length >= MIN_BARS ? analyzeVolatility(candles, 14) : null;
    const volatilitySection = scoreToEvidence(
        "volatility",
        "Volatility",
        vol?.state === "high" || vol?.state === "extreme" ? 1 : 0,
        vol?.state === "low" ? 1 : 0,
        vol ? `ATR state ${vol.state}, range expansion ${vol.rangeExpansion.toFixed(2)}×.` : "Volatility engine did not run.",
        [
            { label: "ATR(14)", value: vol?.atr ?? null, unit: "price" },
            { label: "ATR %", value: vol?.atrPercent ?? null, unit: "%" },
            { label: "Range expansion", value: vol?.rangeExpansion ?? null, unit: "×" },
        ],
        { id: "analytics.volatility", label: "Volatility engine (ATR)", kind: "analytics", asOf: dataAsOf }
    );

    const mtfSection = scoreToEvidence(
        "mtfAlignment",
        "Multi-timeframe alignment",
        mtf.dominantBias.value === "bullish" ? mtf.alignedCount : 0,
        mtf.dominantBias.value === "bearish" ? mtf.alignedCount : 0,
        mtf.summary.value ?? (mtf.summary.reason ?? "Multi-timeframe unavailable."),
        [
            { label: "Aligned", value: mtf.alignedCount, unit: "timeframes" },
            { label: "Conflicting", value: mtf.conflictingCount, unit: "timeframes" },
            { label: "Measured", value: mtf.availableCount, unit: "timeframes" },
            { label: "Alignment ratio", value: mtf.alignmentRatio.value, unit: "ratio" },
        ],
        { id: "analytics.multi-timeframe", label: "Multi-timeframe engine", kind: "analytics", asOf: dataAsOf }
    );

    const sections = [structureSection, momentumSection, liquiditySection, volatilitySection, mtfSection];

    // When the synthesised confidence exists, append it as a sourced section so
    // the UI can show the arithmetic behind the headline number.
    if (finalConfidence && finalConfidence.status === "available" && finalConfidence.value !== null) {
        sections.push({
            id: "structure",
            label: "Synthesised AI confidence",
            score: finalConfidence.value / 100,
            detail: `Weighted blend of market score, regime confidence and VWAP alignment.`,
            metrics: [{ label: "Confidence", value: finalConfidence.value, unit: "0-100" }],
            source: finalConfidence.source,
        });
    }

    return sections;
}

// ── top level ───────────────────────────────────────────────────────────────

export function analyseAdvanced(
    symbol: string,
    primaryTimeframe: Timeframe,
    bundle: CandleBundle,
    finalConfidence: Sourced<number> | null = null
): AdvancedAnalysisResult {
    const primary = bundle[primaryTimeframe];
    const structure = analyseStructure(primary, primaryTimeframe);
    const multiTimeframe = analyseMultiTimeframe(bundle);
    const regime = analyseRegime(primary, primaryTimeframe, structure.reversalSetup.value ?? null);

    const price = lastPrice(primary);
    const scoredZones =
        price === null || !primary
            ? []
            : scoreAllZones([...(structure.fairValueGaps.value ?? []), ...(structure.orderBlocks.value ?? [])], price);

    return {
        symbol,
        asOf: Date.now(),
        primaryTimeframe,
        structure,
        multiTimeframe,
        regime,
        evidence: buildEvidence(structure, multiTimeframe, primary, primaryTimeframe, finalConfidence),
        scoredZones: scoredZones
            .map((s) => {
                const zone = [...(structure.fairValueGaps.value ?? []), ...(structure.orderBlocks.value ?? [])].find(
                    (z) => z.id === s.zoneId
                );
                return zone ? { zone, score: s.strength, reasons: s.reasons } : null;
            })
            .filter((z): z is { zone: Zone; score: number; reasons: string[] } => z !== null),
    };
}
