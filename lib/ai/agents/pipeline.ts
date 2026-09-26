/**
 * AlgoVault trading intelligence — sequential agent pipeline.
 *
 * Agents run strictly sequentially, in a fixed order, each reading the outputs
 * of the ones before it (the "controlled memory" pattern already used by
 * `lib/agents/workflow-engine.ts`). There are no parallel agents: every later
 * agent depends on the measured state the earlier agents established.
 *
 *   Market Data → Structure → Momentum → Liquidity → Volatility
 *               → Strategy → Risk → Final Intelligence
 *
 * Design decision: these agents are DETERMINISTIC. Every payload value is
 * computed from real candles by the existing engines in `lib/analytics` and
 * `lib/market-data`. No LLM is invoked, so:
 *   • there is no possibility of a fabricated metric,
 *   • there is no per-request AI spend, and therefore no way to bypass or
 *     erode the existing budget architecture in `lib/ai/budget.ts`.
 *
 * The one derived number in the whole pipeline — `FinalIntelligence.confidence`
 * — is a transparent weighted blend with the weights exported as a constant and
 * the contributing components included in the payload, so the UI can show the
 * arithmetic. If a contributing component is unavailable, confidence is
 * unavailable. It is never back-filled.
 *
 * Pure and isomorphic: no Firebase, no network, no env.
 */

import type { MarketCandle, MarketRegime, Timeframe } from "@/lib/market-data/types";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP, getVWAPPosition } from "@/lib/analytics/vwap";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { detectFairValueGaps, detectOrderBlocks } from "@/lib/analytics/zones";
import { getCurrentSession } from "@/lib/analytics/sessions";
import { computeIndicatorSnapshot } from "@/lib/analytics/indicators";
import { symbolRiskSpec } from "@/lib/risk/risk-engine";
import {
    type MetricSource,
    type MetricSourceId,
    type Sourced,
    metricSource,
    sourced,
    sourcedArray,
    sourcedNumber,
    unavailable,
} from "@/lib/ai/provenance";

// ── agent identity ──────────────────────────────────────────────────────────

export const AGENT_ORDER = [
    "market-data",
    "structure",
    "momentum",
    "liquidity",
    "volatility",
    "strategy",
    "risk",
    "final-intelligence",
] as const;

export type AgentId = (typeof AGENT_ORDER)[number];

export const AGENT_LABELS: Record<AgentId, string> = {
    "market-data": "Market Data Agent",
    structure: "Structure Agent",
    momentum: "Momentum Agent",
    liquidity: "Liquidity Agent",
    volatility: "Volatility Agent",
    strategy: "Strategy Agent",
    risk: "Risk Agent",
    "final-intelligence": "Final Intelligence Agent",
};

const AGENT_SOURCES: Record<AgentId, MetricSourceId> = {
    "market-data": "agents.market-data",
    structure: "agents.structure",
    momentum: "agents.momentum",
    liquidity: "agents.liquidity",
    volatility: "agents.volatility",
    strategy: "agents.strategy",
    risk: "agents.risk",
    "final-intelligence": "agents.final-intelligence",
};

export type AgentStatus = "completed" | "unavailable" | "skipped";

export type AgentRecord<T> = {
    agentId: AgentId;
    label: string;
    status: AgentStatus;
    durationMs: number;
    payload: T | null;
    reason?: string;
    source: MetricSource;
};

/** Minimum bars before the analytics engines produce trustworthy output. */
export const MIN_BARS = 60;

/** Declared weights for the single derived number in the pipeline. */
export const FINAL_INTELLIGENCE_WEIGHTS = {
    marketScore: 0.5,
    regimeConfidence: 0.3,
    alignment: 0.2,
} as const;

export type Bias = "bullish" | "bearish" | "neutral";

export type EvidenceItem = {
    id: string;
    label: string;
    /** The measurable value, or null when the engine could not produce it. */
    value: number | null;
    unit: string;
    detail: string;
    source: MetricSource;
};

// ── payloads ────────────────────────────────────────────────────────────────

export type MarketDataAgentPayload = {
    bars: number;
    lastPrice: Sourced<number>;
    change: Sourced<number>;
    changePercent: Sourced<number>;
    lookbackHigh: Sourced<number>;
    lookbackLow: Sourced<number>;
    session: { current: string; name: string };
    dataAsOf: number | null;
    dataAgeMs: number | null;
    stale: boolean;
};

export type StructureAgentPayload = {
    bias: Bias;
    events: Sourced<import("@/lib/market-data/types").MarketStructureEvent[]>;
    bosCount: number;
    chochCount: number;
    swingHighCount: number;
    swingLowCount: number;
    lastEvent: import("@/lib/market-data/types").MarketStructureEvent | null;
};

export type MomentumAgentPayload = {
    bias: Bias;
    rsi14: Sourced<number>;
    ema20: Sourced<number>;
    ema50: Sourced<number>;
    ema200: Sourced<number>;
    macdHistogram: Sourced<number>;
    supertrendDirection: "bullish" | "bearish" | "neutral";
    emaStack: Sourced<string>;
};

export type LiquidityAgentPayload = {
    levels: Sourced<import("@/lib/market-data/types").LiquidityLevel[]>;
    levelCount: number;
    nearestBuySide: Sourced<number>;
    nearestSellSide: Sourced<number>;
    sweepCount: number;
    lastSweep: import("@/lib/market-data/types").LiquiditySweep | null;
    distanceToBuySidePips: Sourced<number>;
    distanceToSellSidePips: Sourced<number>;
};

export type VolatilityAgentPayload = {
    atr: Sourced<number>;
    atrPercent: Sourced<number>;
    state: "low" | "normal" | "high" | "extreme";
    rangeExpansion: Sourced<number>;
    volumeRelative: Sourced<number>;
    volumeState: "expanded" | "normal" | "contracted" | "unavailable";
};

export type StrategyAgentPayload = {
    regime: Sourced<MarketRegime>;
    regimeConfidence: Sourced<number>;
    regimeFactors: string[];
    vwapPosition: Sourced<"above" | "below" | "at">;
    vwapValue: Sourced<number>;
    nearestFvg: Sourced<{ high: number; low: number; direction: string }>;
    nearestOrderBlock: Sourced<{ high: number; low: number; direction: string }>;
    fvgCount: number;
    orderBlockCount: number;
    /** How many independent factors point the same way. 0..1, transparent. */
    confluence: Sourced<number>;
    contributingFactors: string[];
};

export type RiskAgentPayload = {
    atr: Sourced<number>;
    /** ATR(14) × 1.5 — a reference distance, explicitly not a recommendation. */
    stopReferenceDistance: Sourced<number>;
    stopReferencePrice: Sourced<{ long: number; short: number }>;
    contractSize: number;
    pipSize: number;
    /** Currency value of a 1-pip move for 1 lot. */
    pipValue: Sourced<number>;
    /** Requires account state, which this pipeline deliberately does not hold. */
    positionSize: Sourced<number>;
    positionSizeReason: string;
    /** Whether a 2R target is geometrically reachable before opposing structure. */
    twoRTargetFeasible: Sourced<boolean>;
};

export type ConfidenceComponent = {
    id: "marketScore" | "regimeConfidence" | "alignment";
    label: string;
    weight: number;
    value: number | null;
    contribution: number | null;
    source: MetricSource;
};

export type FinalIntelligenceAgentPayload = {
    bias: Bias;
    confidence: Sourced<number>;
    confidenceLabel: "high" | "medium" | "low" | "unavailable";
    weights: typeof FINAL_INTELLIGENCE_WEIGHTS;
    components: ConfidenceComponent[];
    evidence: EvidenceItem[];
    /** Deterministic, template-composed from measured values. Not LLM prose. */
    headline: string | null;
};

export type AgentPipelineInput = {
    symbol: string;
    timeframe: Timeframe;
    candles: MarketCandle[];
    /** Injectable for deterministic tests. */
    now?: number;
};

export type AgentPipelineResult = {
    symbol: string;
    timeframe: Timeframe;
    asOf: number;
    dataAsOf: number | null;
    stale: boolean;
    bars: number;
    agents: {
        marketData: AgentRecord<MarketDataAgentPayload>;
        structure: AgentRecord<StructureAgentPayload>;
        momentum: AgentRecord<MomentumAgentPayload>;
        liquidity: AgentRecord<LiquidityAgentPayload>;
        volatility: AgentRecord<VolatilityAgentPayload>;
        strategy: AgentRecord<StrategyAgentPayload>;
        risk: AgentRecord<RiskAgentPayload>;
        finalIntelligence: AgentRecord<FinalIntelligenceAgentPayload>;
    };
    /** Convenience view of the synthesised intelligence, or null if unavailable. */
    intelligence: FinalIntelligenceAgentPayload | null;
};

// ── small helpers ───────────────────────────────────────────────────────────

function asOf(candles: MarketCandle[]): number | null {
    return candles.length > 0 ? candles[candles.length - 1].timestamp : null;
}

function record<T>(
    agentId: AgentId,
    source: MetricSource,
    started: number,
    payload: T | null,
    reason?: string
): AgentRecord<T> {
    return {
        agentId,
        label: AGENT_LABELS[agentId],
        status: payload === null ? "unavailable" : "completed",
        durationMs: Math.max(0, Date.now() - started),
        payload,
        reason,
        source,
    };
}

/** Directional agreement between two biases, as a 0..1 score. */
function alignmentScore(a: Bias, b: Bias): number {
    if (a === "neutral" || b === "neutral") return 0.5;
    return a === b ? 1 : 0;
}

// ── 1. Market Data Agent ────────────────────────────────────────────────────

function runMarketDataAgent(
    symbol: string,
    candles: MarketCandle[],
    now: number
): AgentRecord<MarketDataAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES["market-data"], asOf(candles));

    if (candles.length < 2) {
        return record<MarketDataAgentPayload>(
            "market-data",
            source,
            started,
            null,
            "Fewer than 2 bars returned by the market data provider."
        );
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const change = last.close - prev.close;
    const changePercent = prev.close !== 0 ? (change / prev.close) * 100 : null;

    const lookback = candles.slice(-100);
    const highs = lookback.map((c) => c.high);
    const lows = lookback.map((c) => c.low);

    const dataAsOf = last.timestamp;
    const dataAgeMs = dataAsOf > 0 ? Math.max(0, now - dataAsOf) : null;

    const session = getCurrentSession(new Date(now));

    return record("market-data", source, started, {
        bars: candles.length,
        lastPrice: sourced(last.close, "market-data.biquote-ohlc", dataAsOf),
        change: sourced(change, "market-data.biquote-ohlc", dataAsOf),
        changePercent: sourcedNumber(
            changePercent,
            "market-data.biquote-ohlc",
            dataAsOf,
            "Previous bar close was zero, so percentage change is undefined."
        ),
        lookbackHigh: sourced(Math.max(...highs), "market-data.biquote-ohlc", dataAsOf),
        lookbackLow: sourced(Math.min(...lows), "market-data.biquote-ohlc", dataAsOf),
        session,
        dataAsOf,
        dataAgeMs,
        stale: dataAgeMs === null ? true : dataAgeMs > 15 * 60 * 1000,
    });
}

// ── 2. Structure Agent ──────────────────────────────────────────────────────

function runStructureAgent(
    candles: MarketCandle[],
    timeframe: Timeframe,
    dataAsOf: number | null
): AgentRecord<StructureAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES.structure, dataAsOf);

    if (candles.length < MIN_BARS) {
        return record<StructureAgentPayload>(
            "structure",
            source,
            started,
            null,
            `Needs at least ${MIN_BARS} bars; received ${candles.length}.`
        );
    }

    const events = detectStructure(candles, timeframe);
    const bos = events.filter((e) => e.type === "BOS");
    const choch = events.filter((e) => e.type === "CHOCH");
    const breaks = events.filter((e) => e.type === "BOS" || e.type === "CHOCH");

    return record("structure", source, started, {
        bias: getOverallStructureBias(breaks) as Bias,
        events: sourcedArray(events, "analytics.market-structure", dataAsOf),
        bosCount: bos.length,
        chochCount: choch.length,
        swingHighCount: events.filter((e) => e.type === "swing_high").length,
        swingLowCount: events.filter((e) => e.type === "swing_low").length,
        lastEvent: breaks.length > 0 ? breaks[breaks.length - 1] : null,
    });
}

// ── 3. Momentum Agent ───────────────────────────────────────────────────────

function runMomentumAgent(
    candles: MarketCandle[],
    dataAsOf: number | null
): AgentRecord<MomentumAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES.momentum, dataAsOf);

    if (candles.length < MIN_BARS) {
        return record<MomentumAgentPayload>(
            "momentum",
            source,
            started,
            null,
            `Needs at least ${MIN_BARS} bars; received ${candles.length}.`
        );
    }

    const snap = computeIndicatorSnapshot(candles);

    const stack =
        snap.ema20 !== null && snap.ema50 !== null && snap.ema200 !== null
            ? snap.ema20 > snap.ema50 && snap.ema50 > snap.ema200
                ? "bullish_stack"
                : snap.ema20 < snap.ema50 && snap.ema50 < snap.ema200
                  ? "bearish_stack"
                  : "mixed"
            : null;

    // Bias is a plain majority vote over three independent momentum readings.
    const votes: Bias[] = [];
    if (stack === "bullish_stack") votes.push("bullish");
    if (stack === "bearish_stack") votes.push("bearish");
    if (snap.supertrendDirection !== "neutral") votes.push(snap.supertrendDirection);
    if (snap.macdHistogram !== null && snap.macdHistogram !== 0) {
        votes.push(snap.macdHistogram > 0 ? "bullish" : "bearish");
    }
    if (snap.rsi14 !== null) {
        if (snap.rsi14 >= 55) votes.push("bullish");
        else if (snap.rsi14 <= 45) votes.push("bearish");
    }

    const bias: Bias =
        votes.length === 0
            ? "neutral"
            : votes.filter((v) => v === "bullish").length > votes.filter((v) => v === "bearish").length
              ? "bullish"
              : votes.filter((v) => v === "bearish").length > votes.filter((v) => v === "bullish").length
                ? "bearish"
                : "neutral";

    return record("momentum", source, started, {
        bias,
        rsi14: sourcedNumber(snap.rsi14, "analytics.indicators", dataAsOf),
        ema20: sourcedNumber(snap.ema20, "analytics.indicators", dataAsOf),
        ema50: sourcedNumber(snap.ema50, "analytics.indicators", dataAsOf),
        ema200: sourcedNumber(snap.ema200, "analytics.indicators", dataAsOf),
        macdHistogram: sourcedNumber(snap.macdHistogram, "analytics.indicators", dataAsOf),
        supertrendDirection: snap.supertrendDirection,
        emaStack: stack === null
            ? unavailable<string>("analytics.indicators", "EMA series not yet long enough.", dataAsOf)
            : sourced(stack, "analytics.indicators", dataAsOf),
    });
}

// ── 4. Liquidity Agent ──────────────────────────────────────────────────────

function runLiquidityAgent(
    symbol: string,
    candles: MarketCandle[],
    lastPrice: number | null,
    dataAsOf: number | null
): AgentRecord<LiquidityAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES.liquidity, dataAsOf);

    if (candles.length < MIN_BARS) {
        return record<LiquidityAgentPayload>(
            "liquidity",
            source,
            started,
            null,
            `Needs at least ${MIN_BARS} bars; received ${candles.length}.`
        );
    }

    const { levels, sweeps } = detectLiquidity(candles, "H1");
    const pipSize = symbolRiskSpec(symbol).pipSize;

    const above = lastPrice === null ? [] : levels.filter((l) => l.price > lastPrice);
    const below = lastPrice === null ? [] : levels.filter((l) => l.price < lastPrice);
    const nearestBuySide = above.length > 0 ? Math.min(...above.map((l) => l.price)) : null;
    const nearestSellSide = below.length > 0 ? Math.max(...below.map((l) => l.price)) : null;

    const distBuy =
        nearestBuySide !== null && lastPrice !== null ? (nearestBuySide - lastPrice) / pipSize : null;
    const distSell =
        nearestSellSide !== null && lastPrice !== null ? (lastPrice - nearestSellSide) / pipSize : null;

    return record("liquidity", source, started, {
        levels: sourcedArray(levels, "analytics.liquidity", dataAsOf),
        levelCount: levels.length,
        nearestBuySide: sourcedNumber(
            nearestBuySide,
            "analytics.liquidity",
            dataAsOf,
            "No buy-side liquidity level above current price."
        ),
        nearestSellSide: sourcedNumber(
            nearestSellSide,
            "analytics.liquidity",
            dataAsOf,
            "No sell-side liquidity level below current price."
        ),
        sweepCount: sweeps.length,
        lastSweep: sweeps.length > 0 ? sweeps[sweeps.length - 1] : null,
        distanceToBuySidePips: sourcedNumber(
            distBuy,
            "analytics.liquidity",
            dataAsOf,
            "Requires a last price and a buy-side level."
        ),
        distanceToSellSidePips: sourcedNumber(
            distSell,
            "analytics.liquidity",
            dataAsOf,
            "Requires a last price and a sell-side level."
        ),
    });
}

// ── 5. Volatility Agent ─────────────────────────────────────────────────────

function runVolatilityAgent(
    candles: MarketCandle[],
    dataAsOf: number | null
): AgentRecord<VolatilityAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES.volatility, dataAsOf);

    if (candles.length < MIN_BARS) {
        return record<VolatilityAgentPayload>(
            "volatility",
            source,
            started,
            null,
            `Needs at least ${MIN_BARS} bars; received ${candles.length}.`
        );
    }

    const vol = analyzeVolatility(candles, 14);
    const volume = analyzeVolume(candles);

    return record("volatility", source, started, {
        atr: sourcedNumber(vol.atr, "analytics.volatility", dataAsOf),
        atrPercent: sourcedNumber(vol.atrPercent, "analytics.volatility", dataAsOf),
        state: vol.state,
        rangeExpansion: sourcedNumber(vol.rangeExpansion, "analytics.volatility", dataAsOf),
        volumeRelative: sourcedNumber(volume.relativeVolume, "analytics.volume", dataAsOf),
        volumeState: Number.isFinite(volume.relativeVolume) ? volume.state : "unavailable",
    });
}

// ── 6. Strategy Agent ───────────────────────────────────────────────────────

function runStrategyAgent(
    candles: MarketCandle[],
    timeframe: Timeframe,
    lastPrice: number | null,
    dataAsOf: number | null
): AgentRecord<StrategyAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES.strategy, dataAsOf);

    if (candles.length < MIN_BARS) {
        return record<StrategyAgentPayload>(
            "strategy",
            source,
            started,
            null,
            `Needs at least ${MIN_BARS} bars; received ${candles.length}.`
        );
    }

    const regime = detectRegime(candles, timeframe);
    const vwapData = calculateVWAP(candles, "session");
    const fvgs = detectFairValueGaps(candles, timeframe);
    const obs = detectOrderBlocks(candles, timeframe);

    const position = lastPrice === null ? null : getVWAPPosition(lastPrice, vwapData);

    const nearestZone = (zones: typeof fvgs, price: number) => {
        let best: (typeof fvgs)[number] | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const z of zones) {
            if (price < z.low || price > z.high) {
                const d = price < z.low ? z.low - price : price - z.high;
                if (d < bestDist) {
                    bestDist = d;
                    best = z;
                }
            }
        }
        return best;
    };

    const nearestFvg = lastPrice === null ? null : nearestZone(fvgs, lastPrice);
    const nearestOb = lastPrice === null ? null : nearestZone(obs, lastPrice);

    // Confluence = share of the independent directional factors that agree with
    // the regime. Explicitly enumerated so the UI can list them.
    const factors: Array<{ name: string; agrees: boolean | null }> = [
        {
            name: "regime",
            agrees:
                regime.regime === "trending_bullish"
                    ? true
                    : regime.regime === "trending_bearish"
                      ? false
                      : null,
        },
        { name: "vwap", agrees: position === null ? null : position === "above" ? true : position === "below" ? false : null },
        { name: "order_block", agrees: nearestOb === null ? null : nearestOb.direction === "bullish" ? true : nearestOb.direction === "bearish" ? false : null },
        { name: "fvg", agrees: nearestFvg === null ? null : nearestFvg.direction === "bullish" ? true : nearestFvg.direction === "bearish" ? false : null },
    ];
    const decided = factors.filter((f) => f.agrees !== null);
    const agreeing = decided.filter((f) => f.agrees === true).length;
    const confluence = decided.length > 0 ? agreeing / decided.length : null;

    return record("strategy", source, started, {
        regime: sourced(regime.regime, "analytics.market-regime", dataAsOf),
        regimeConfidence: sourcedNumber(regime.confidence, "analytics.market-regime", dataAsOf),
        regimeFactors: regime.factors,
        vwapPosition:
            position === null
                ? unavailable<"above" | "below" | "at">(
                      "analytics.vwap",
                      "VWAP requires a last price.",
                      dataAsOf
                  )
                : sourced(position, "analytics.vwap", dataAsOf),
        vwapValue: sourcedNumber(vwapData.vwap, "analytics.vwap", dataAsOf),
        nearestFvg:
            nearestFvg === null
                ? unavailable<{ high: number; low: number; direction: string }>(
                      "analytics.zones",
                      "No fair value gap in the fetched range.",
                      dataAsOf
                  )
                : sourced(
                      { high: nearestFvg.high, low: nearestFvg.low, direction: nearestFvg.direction },
                      "analytics.zones",
                      dataAsOf
                  ),
        nearestOrderBlock:
            nearestOb === null
                ? unavailable<{ high: number; low: number; direction: string }>(
                      "analytics.zones",
                      "No order block in the fetched range.",
                      dataAsOf
                  )
                : sourced(
                      { high: nearestOb.high, low: nearestOb.low, direction: nearestOb.direction },
                      "analytics.zones",
                      dataAsOf
                  ),
        fvgCount: fvgs.length,
        orderBlockCount: obs.length,
        confluence: sourcedNumber(
            confluence,
            "agents.strategy",
            dataAsOf,
            "No directional zone or VWAP reading was available."
        ),
        contributingFactors: factors.map((f) => f.name),
    });
}

// ── 7. Risk Agent ───────────────────────────────────────────────────────────

function runRiskAgent(
    symbol: string,
    atr: Sourced<number>,
    lastPrice: Sourced<number>,
    liquidity: AgentRecord<LiquidityAgentPayload> | null,
    dataAsOf: number | null
): AgentRecord<RiskAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES.risk, dataAsOf);
    const spec = symbolRiskSpec(symbol);
    const ATR_MULTIPLE = 1.5;

    const price = lastPrice.value;
    const stopDistance =
        atr.value !== null ? atr.value * ATR_MULTIPLE : null;
    const pipValue = spec.pipSize > 0 ? (spec.pipSize * spec.contractSize) : null;

    // A 2R target is geometrically reachable when the nearest opposing liquidity
    // level is at least 2R away. This is a geometry check, not a trade call.
    const liq = liquidity?.payload;
    let twoR: boolean | null = null;
    if (stopDistance !== null && stopDistance > 0 && price !== null && liq) {
        const buySide = liq.nearestBuySide.value;
        const sellSide = liq.nearestSellSide.value;
        const upside = buySide !== null ? buySide - price : null;
        const downside = sellSide !== null ? price - sellSide : null;
        const room = Math.max(upside ?? 0, downside ?? 0);
        twoR = room >= stopDistance * 2;
    }

    return record("risk", source, started, {
        atr,
        stopReferenceDistance: sourcedNumber(
            stopDistance,
            "agents.risk",
            dataAsOf,
            "ATR is unavailable, so no stop reference can be derived."
        ),
        stopReferencePrice:
            price === null || stopDistance === null
                ? unavailable<{ long: number; short: number }>(
                      "agents.risk",
                      "Requires both a last price and ATR.",
                      dataAsOf
                  )
                : sourced(
                      { long: price - stopDistance, short: price + stopDistance },
                      "agents.risk",
                      dataAsOf
                  ),
        contractSize: spec.contractSize,
        pipSize: spec.pipSize,
        pipValue: sourcedNumber(
            pipValue,
            "agents.risk",
            dataAsOf,
            "Symbol spec returned a zero pip size."
        ),
        // Position sizing is intentionally unavailable: this pipeline holds no
        // account state, and inventing a balance would fabricate a risk number.
        positionSize: unavailable<number>(
            "agents.risk",
            "Position sizing requires account balance and risk limits, which this read-only pipeline does not hold.",
            dataAsOf
        ),
        positionSizeReason:
            "Position sizing requires account balance and risk limits, which this read-only pipeline does not hold.",
        twoRTargetFeasible:
            twoR === null
                ? unavailable<boolean>(
                      "agents.risk",
                      "Insufficient ATR, price or liquidity geometry.",
                      dataAsOf
                  )
                : sourced(twoR, "agents.risk", dataAsOf),
    });
}

// ── 8. Final Intelligence Agent ─────────────────────────────────────────────

function runFinalIntelligenceAgent(
    candles: MarketCandle[],
    timeframe: Timeframe,
    previous: {
        structure: AgentRecord<StructureAgentPayload> | null;
        momentum: AgentRecord<MomentumAgentPayload> | null;
        liquidity: AgentRecord<LiquidityAgentPayload> | null;
        volatility: AgentRecord<VolatilityAgentPayload> | null;
        strategy: AgentRecord<StrategyAgentPayload> | null;
    },
    dataAsOf: number | null
): AgentRecord<FinalIntelligenceAgentPayload> {
    const started = Date.now();
    const source = metricSource(AGENT_SOURCES["final-intelligence"], dataAsOf);

    if (candles.length < MIN_BARS) {
        return record<FinalIntelligenceAgentPayload>(
            "final-intelligence",
            source,
            started,
            null,
            `Needs at least ${MIN_BARS} bars; received ${candles.length}.`
        );
    }

    // Real engine output — weights live in lib/analytics/market-score.ts.
    const marketScore = calculateMarketScore(candles, timeframe);
    const strategy = previous.strategy?.payload ?? null;
    const structure = previous.structure?.payload ?? null;
    const momentum = previous.momentum?.payload ?? null;
    const liquidity = previous.liquidity?.payload ?? null;
    const volatility = previous.volatility?.payload ?? null;

    const votes: Bias[] = [
        structure?.bias ?? null,
        momentum?.bias ?? null,
        marketScore.bias,
        marketScore.bias,
    ].filter((v): v is Bias => v !== null && v !== undefined);

    const bull = votes.filter((v) => v === "bullish").length;
    const bear = votes.filter((v) => v === "bearish").length;
    const bias: Bias = bull === bear ? "neutral" : bull > bear ? "bullish" : "bearish";

    const regimeConfidence = strategy?.regimeConfidence.value ?? null;
    const alignment = alignmentScore(strategy?.vwapPosition.value === "above" ? "bullish" : strategy?.vwapPosition.value === "below" ? "bearish" : "neutral", bias);

    const components: ConfidenceComponent[] = [
        {
            id: "marketScore",
            label: "Market score",
            weight: FINAL_INTELLIGENCE_WEIGHTS.marketScore,
            value: Number.isFinite(marketScore.total) ? marketScore.total : null,
            contribution: Number.isFinite(marketScore.total)
                ? marketScore.total * FINAL_INTELLIGENCE_WEIGHTS.marketScore
                : null,
            source: metricSource("analytics.market-score", dataAsOf),
        },
        {
            id: "regimeConfidence",
            label: "Regime confidence",
            weight: FINAL_INTELLIGENCE_WEIGHTS.regimeConfidence,
            value: regimeConfidence,
            contribution:
                regimeConfidence === null
                    ? null
                    : regimeConfidence * FINAL_INTELLIGENCE_WEIGHTS.regimeConfidence,
            source: metricSource("analytics.market-regime", dataAsOf),
        },
        {
            id: "alignment",
            label: "VWAP / bias alignment",
            weight: FINAL_INTELLIGENCE_WEIGHTS.alignment,
            value: alignment,
            contribution: alignment * FINAL_INTELLIGENCE_WEIGHTS.alignment,
            source: metricSource("agents.final-intelligence", dataAsOf),
        },
    ];

    const allPresent = components.every((c) => c.contribution !== null);
    const confidence = allPresent
        ? Math.round(
              components.reduce((sum, c) => sum + (c.contribution ?? 0), 0) * 10
          ) / 10
        : null;

    const evidence: EvidenceItem[] = [
        {
            id: "structure",
            label: "Structure bias",
            value: structure ? biasToNumber(structure.bias) : null,
            unit: "score",
            detail: structure
                ? `${structure.bosCount} BOS, ${structure.chochCount} CHOCH events.`
                : "Structure agent unavailable.",
            source: metricSource("agents.structure", dataAsOf),
        },
        {
            id: "momentum",
            label: "RSI(14)",
            value: momentum?.rsi14.value ?? null,
            unit: "index",
            detail: momentum?.emaStack.value
                ? `EMA stack: ${momentum.emaStack.value}.`
                : "Momentum agent unavailable.",
            source: metricSource("analytics.indicators", dataAsOf),
        },
        {
            id: "liquidity",
            label: "Liquidity levels",
            value: liquidity ? liquidity.levelCount : null,
            unit: "levels",
            detail: liquidity
                ? `${liquidity.sweepCount} sweeps detected.`
                : "Liquidity agent unavailable.",
            source: metricSource("agents.liquidity", dataAsOf),
        },
        {
            id: "volatility",
            label: "ATR(14)",
            value: volatility?.atr.value ?? null,
            unit: "price",
            detail: volatility ? `State: ${volatility.state}.` : "Volatility agent unavailable.",
            source: metricSource("agents.volatility", dataAsOf),
        },
        {
            id: "mtf",
            label: "Confluence",
            value: strategy?.confluence.value ?? null,
            unit: "ratio",
            detail: strategy
                ? `Factors: ${strategy.contributingFactors.join(", ")}.`
                : "Strategy agent unavailable.",
            source: metricSource("agents.strategy", dataAsOf),
        },
    ];

    const headline = confidence === null
        ? null
        : `${marketScore.bias === "neutral" ? "Neutral" : marketScore.bias === "bullish" ? "Bullish" : "Bearish"} read — regime ${strategy?.regime.value ?? "unavailable"}, ATR ${volatility?.atr.value?.toFixed(5) ?? "unavailable"}, ${liquidity?.levelCount ?? 0} liquidity levels.`;

    return record("final-intelligence", source, started, {
        bias,
        confidence:
            confidence === null
                ? unavailable<number>(
                      "agents.final-intelligence",
                      "One or more confidence components were unavailable; confidence is not derived from partial data.",
                      dataAsOf
                  )
                : sourced(confidence, "agents.final-intelligence", dataAsOf),
        confidenceLabel:
            confidence === null
                ? "unavailable"
                : confidence >= 70
                  ? "high"
                  : confidence >= 45
                    ? "medium"
                    : "low",
        weights: FINAL_INTELLIGENCE_WEIGHTS,
        components,
        evidence,
        headline,
    });
}

function biasToNumber(bias: Bias): number {
    return bias === "bullish" ? 1 : bias === "bearish" ? -1 : 0;
}

// ── orchestrator ────────────────────────────────────────────────────────────

/**
 * Run all eight agents sequentially. Never throws: an agent that cannot
 * produce a payload is recorded as `unavailable` with a reason, and the
 * pipeline continues so later agents still report what they can.
 */
export async function runAgentPipeline(input: AgentPipelineInput): Promise<AgentPipelineResult> {
    const now = input.now ?? Date.now();
    const { symbol, timeframe, candles } = input;
    const dataAsOf = asOf(candles);

    const marketData = runMarketDataAgent(symbol, candles, now);
    const structure = runStructureAgent(candles, timeframe, dataAsOf);
    const momentum = runMomentumAgent(candles, dataAsOf);
    const lastPrice = marketData.payload?.lastPrice ?? null;
    const liquidity = runLiquidityAgent(symbol, candles, lastPrice?.value ?? null, dataAsOf);
    const volatility = runVolatilityAgent(candles, dataAsOf);
    const strategy = runStrategyAgent(candles, timeframe, lastPrice?.value ?? null, dataAsOf);
    const risk = runRiskAgent(
        symbol,
        volatility.payload?.atr ?? unavailable("analytics.volatility", "Volatility agent did not run.", dataAsOf),
        lastPrice ?? unavailable("market-data.biquote-ohlc", "Market data agent did not run.", dataAsOf),
        liquidity,
        dataAsOf
    );
    const finalIntelligence = runFinalIntelligenceAgent(
        candles,
        timeframe,
        { structure, momentum, liquidity, volatility, strategy },
        dataAsOf
    );

    return {
        symbol,
        timeframe,
        asOf: now,
        dataAsOf,
        stale: marketData.payload?.stale ?? true,
        bars: candles.length,
        agents: {
            marketData,
            structure,
            momentum,
            liquidity,
            volatility,
            strategy,
            risk,
            finalIntelligence,
        },
        intelligence: finalIntelligence.payload,
    };
}
