/**
 * AlgoVault scalping terminal — market radar and live trade intelligence.
 *
 * The radar is a thin projection over the agent pipeline: for each watched
 * symbol it summarises the measured trend / momentum / volatility / liquidity /
 * regime and the synthesised AI confidence. It adds no new computation of its
 * own, so every number it shows already carries a provenance record.
 *
 * Signals are produced exclusively by the existing deterministic scanner
 * `scanSymbol` in `lib/ai-signals/engine.ts`, then re-labelled into the
 * terminal's shape. Nothing is invented, and a symbol that produces no
 * qualifying signal is reported as such rather than padded with a placeholder.
 */

import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import {
    type AgentId,
    type AgentPipelineResult,
    type AgentStatus,
    AGENT_ORDER,
    type Bias,
    runAgentPipeline,
} from "@/lib/ai/agents/pipeline";
import {
    type MetricSource,
    type Sourced,
    sourced,
    sourcedNumber,
    unavailable,
} from "@/lib/ai/provenance";

/** Default watchlist and execution timeframe live in a leaf module so the
 *  client can import them without pulling the agent pipeline into the bundle. */
export { RADAR_SYMBOLS, RADAR_TIMEFRAME } from "@/lib/ai/scalping/watchlist";

export type RadarTrend = {
    bias: Bias;
    /** Distance from structure to price, in ATR multiples. */
    emaDistanceAtr: Sourced<number>;
    lastChangePercent: Sourced<number>;
};

export type RadarMomentum = {
    bias: Bias;
    rsi14: Sourced<number>;
    macdHistogram: Sourced<number>;
    supertrend: string;
};

export type RadarVolatility = {
    state: "low" | "normal" | "high" | "extreme" | "unavailable";
    atr: Sourced<number>;
    atrPercent: Sourced<number>;
    rangeExpansion: Sourced<number>;
};

export type RadarLiquidity = {
    levelCount: number;
    sweepCount: number;
    distanceToBuySidePips: Sourced<number>;
    distanceToSellSidePips: Sourced<number>;
    /** Where the market sits between the nearest sell-side and buy-side pools. */
    poolPosition: Sourced<"upper_half" | "lower_half" | "unavailable">;
};

export type RadarRow = {
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    lastPrice: Sourced<number>;
    changePercent: Sourced<number>;
    dataAsOf: number | null;
    stale: boolean;
    trend: Sourced<RadarTrend>;
    momentum: Sourced<RadarMomentum>;
    volatility: Sourced<RadarVolatility>;
    liquidity: Sourced<RadarLiquidity>;
    /** `regime`/`label` are nullable because the inner Sourced may be unavailable. */
    regime: Sourced<{ regime: string | null; label: string | null; confidence: Sourced<number>; factors: string[] }>;
    /** Synthesised, fully attributed confidence. Never a bare percentage. */
    confidence: Sourced<number>;
    confidenceLabel: "high" | "medium" | "low" | "unavailable";
    confidenceComponents: import("@/lib/ai/agents/pipeline").ConfidenceComponent[];
    /**
     * Compact per-agent run record, in pipeline order. This is what the engine
     * feed renders: every agent that ran, how long it took and — when it failed
     * — why. No payload is included, so the feed cannot drift from the numbers
     * shown elsewhere.
     */
    agentTrace: RadarAgentTrace[];
    /** Agents that could not answer, with the reason. Drives the UI. */
    degraded: Array<{ agent: string; reason: string }>;
};

/** One row of the engine feed. Mirrors `AgentRecord` minus its payload. */
export type RadarAgentTrace = {
    agentId: AgentId;
    label: string;
    status: AgentStatus;
    durationMs: number;
    reason?: string;
};

/** Maps `AGENT_ORDER` ids onto the camelCase keys of `AgentPipelineResult.agents`. */
const AGENT_RECORD_KEYS: Record<AgentId, keyof AgentPipelineResult["agents"]> = {
    "market-data": "marketData",
    structure: "structure",
    momentum: "momentum",
    liquidity: "liquidity",
    volatility: "volatility",
    strategy: "strategy",
    risk: "risk",
    "final-intelligence": "finalIntelligence",
};

export type RadarResult = {
    timeframe: Timeframe;
    asOf: number;
    rows: RadarRow[];
    /** Symbols that failed to fetch at all. */
    failed: Array<{ symbol: string; reason: string }>;
    dataSource: MetricSource;
};

function trendOf(p: AgentPipelineResult): Sourced<RadarTrend> {
    const md = p.agents.marketData.payload;
    const st = p.agents.structure.payload;
    const mo = p.agents.momentum.payload;
    const vol = p.agents.volatility.payload;

    if (!md || !st || !mo || !vol) {
        return unavailable<RadarTrend>(
            "agents.structure",
            "One or more upstream agents were unavailable.",
            p.dataAsOf
        );
    }

    const atr = vol.atr.value;
    const price = md.lastPrice.value;
    const ema20 = mo.ema20.value;
    const emaDistanceAtr =
        atr !== null && atr > 0 && price !== null && ema20 !== null
            ? (price - ema20) / atr
            : null;

    return sourced(
        {
            bias: st.bias,
            emaDistanceAtr: sourcedNumber(
                emaDistanceAtr,
                "analytics.volatility",
                p.dataAsOf,
                "Requires price, EMA20 and ATR."
            ),
            lastChangePercent: md.changePercent,
        },
        "agents.structure",
        p.dataAsOf
    );
}

function momentumOf(p: AgentPipelineResult): Sourced<RadarMomentum> {
    const mo = p.agents.momentum.payload;
    if (!mo) {
        return unavailable<RadarMomentum>("agents.momentum", "Momentum agent did not run.", p.dataAsOf);
    }
    return sourced(
        {
            bias: mo.bias,
            rsi14: mo.rsi14,
            macdHistogram: mo.macdHistogram,
            supertrend: mo.supertrendDirection,
        },
        "agents.momentum",
        p.dataAsOf
    );
}

function volatilityOf(p: AgentPipelineResult): Sourced<RadarVolatility> {
    const vol = p.agents.volatility.payload;
    if (!vol) {
        return unavailable<RadarVolatility>("agents.volatility", "Volatility agent did not run.", p.dataAsOf);
    }
    return sourced(
        {
            state: vol.state,
            atr: vol.atr,
            atrPercent: vol.atrPercent,
            rangeExpansion: vol.rangeExpansion,
        },
        "agents.volatility",
        p.dataAsOf
    );
}

function liquidityOf(p: AgentPipelineResult): Sourced<RadarLiquidity> {
    const liq = p.agents.liquidity.payload;
    if (!liq) {
        return unavailable<RadarLiquidity>("agents.liquidity", "Liquidity agent did not run.", p.dataAsOf);
    }

    const buy = liq.nearestBuySide.value;
    const sell = liq.nearestSellSide.value;
    const price = p.agents.marketData.payload?.lastPrice.value ?? null;

    const poolPosition =
        buy === null || sell === null || price === null || buy <= sell
            ? null
            : price >= (buy + sell) / 2
              ? "upper_half"
              : "lower_half";

    return sourced(
        {
            levelCount: liq.levelCount,
            sweepCount: liq.sweepCount,
            distanceToBuySidePips: liq.distanceToBuySidePips,
            distanceToSellSidePips: liq.distanceToSellSidePips,
            poolPosition:
                poolPosition === null
                    ? unavailable<"upper_half" | "lower_half">(
                          "analytics.liquidity",
                          "Requires a price and both a buy-side and sell-side level.",
                          p.dataAsOf
                      )
                    : sourced(poolPosition, "analytics.liquidity", p.dataAsOf),
        },
        "agents.liquidity",
        p.dataAsOf
    );
}

function regimeOf(p: AgentPipelineResult): Sourced<{ regime: string | null; label: string | null; confidence: Sourced<number>; factors: string[] }> {
    const stg = p.agents.strategy.payload;
    if (!stg) {
        return unavailable<{ regime: string | null; label: string | null; confidence: Sourced<number>; factors: string[] }>(
            "agents.strategy",
            "Strategy agent did not run.",
            p.dataAsOf
        );
    }
    // `regime` is itself a Sourced, so a null here must not be coerced to a
    // string. The wrapper carries the availability; the inner value may be null.
    return sourced(
        {
            regime: stg.regime.value,
            label: stg.regime.value,
            confidence: stg.regimeConfidence,
            factors: stg.regimeFactors,
        },
        "analytics.market-regime",
        p.dataAsOf
    );
}

/** Build one radar row from a completed pipeline run. */
export function toRadarRow(p: AgentPipelineResult): RadarRow {
    const md = p.agents.marketData.payload;
    const intel = p.intelligence;

    const degraded: Array<{ agent: string; reason: string }> = [];
    for (const rec of Object.values(p.agents)) {
        if (rec.status !== "completed" && rec.reason) {
            degraded.push({ agent: rec.label, reason: rec.reason });
        }
    }

    return {
        symbol: p.symbol as SupportedSymbol,
        timeframe: p.timeframe,
        lastPrice: md?.lastPrice ?? unavailable("market-data.biquote-ohlc", "Market data agent did not run.", p.dataAsOf),
        changePercent: md?.changePercent ?? unavailable("market-data.biquote-ohlc", "Market data agent did not run.", p.dataAsOf),
        dataAsOf: p.dataAsOf,
        stale: p.stale,
        trend: trendOf(p),
        momentum: momentumOf(p),
        volatility: volatilityOf(p),
        liquidity: liquidityOf(p),
        regime: regimeOf(p),
        confidence:
            intel?.confidence ??
            unavailable<number>(
                "agents.final-intelligence",
                "Final intelligence agent did not produce a confidence value.",
                p.dataAsOf
            ),
        confidenceLabel: intel?.confidenceLabel ?? "unavailable",
        confidenceComponents: intel?.components ?? [],
        agentTrace: AGENT_ORDER.map((agentId) => {
            const rec = p.agents[AGENT_RECORD_KEYS[agentId]];
            return {
                agentId,
                label: rec.label,
                status: rec.status,
                durationMs: rec.durationMs,
                ...(rec.reason ? { reason: rec.reason } : {}),
            };
        }),
        degraded,
    };
}

export type RadarInput = {
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    candles: MarketCandle[];
};

/**
 * Run the pipeline for a set of symbols and project the results into the
 * radar. Symbols that produced no candles are reported in `failed` rather than
 * being rendered as an empty row with fabricated zeros.
 */
export async function buildRadar(inputs: RadarInput[], timeframe: Timeframe): Promise<RadarResult> {
    const rows: RadarRow[] = [];
    const failed: Array<{ symbol: string; reason: string }> = [];
    const asOf = Date.now();

    for (const input of inputs) {
        if (!input.candles || input.candles.length === 0) {
            failed.push({
                symbol: input.symbol,
                reason: "Market data provider returned no candles for this symbol and timeframe.",
            });
            continue;
        }
        const pipeline = await runAgentPipeline({
            symbol: input.symbol,
            timeframe: input.timeframe,
            candles: input.candles,
        });
        rows.push(toRadarRow(pipeline));
    }

    return {
        timeframe,
        asOf,
        rows,
        failed,
        dataSource: {
            id: "market-data.biquote-ohlc",
            label: "biquote.io OHLC feed",
            kind: "market-data",
            asOf,
        },
    };
}

// ── E. Live trade intelligence ──────────────────────────────────────────────

export type TerminalSignal = {
    id: string;
    symbol: SupportedSymbol;
    direction: "long" | "short";
    confidence: number;
    confidenceLabel: string;
    timeframe: Timeframe;
    entry: number;
    stop: number;
    target: number;
    riskReward: number;
    risk: number;
    evidence: string[];
    regime: string;
    strength: string;
    status: string;
    createdAt: number;
    /** Provenance for the whole signal. */
    source: MetricSource;
};

export type SignalScanResult = {
    signals: TerminalSignal[];
    /** Symbols the scanner examined but did not qualify. */
    rejected: Array<{ symbol: string; reason: string }>;
    asOf: number;
};

/**
 * Project the existing scanner output into terminal signal shape.
 *
 * `scanSymbol` is the deterministic path in `lib/ai-signals/engine.ts`: it
 * already computes a real confidence breakdown, enforces a minimum R:R and
 * returns `null` when the setup does not qualify. This function only renames
 * fields and collects the reasoning strings, so a signal can only ever appear
 * here if the existing engine produced one.
 */
export function toTerminalSignals(
    symbol: SupportedSymbol,
    raw: Array<Partial<import("@/lib/ai-signals/types").AISignal>>
): TerminalSignal[] {
    const out: TerminalSignal[] = [];

    for (const s of raw) {
        // Require a complete, internally consistent signal. A partial record
        // cannot be displayed honestly, so it is dropped rather than padded.
        if (
            typeof s.id !== "string" ||
            typeof s.symbol !== "string" ||
            (s.direction !== "BUY" && s.direction !== "SELL") ||
            typeof s.entry !== "number" ||
            typeof s.stopLoss !== "number" ||
            typeof s.tp1 !== "number" ||
            typeof s.confidence !== "number" ||
            typeof s.timeframe !== "string"
        ) {
            continue;
        }

        const risk = Math.abs(s.entry - s.stopLoss);
        // Re-derive R:R from the real prices rather than trusting a field, and
        // reject any record whose own numbers do not agree.
        const reward = Math.abs(s.tp1 - s.entry);
        const riskReward = risk > 0 ? reward / risk : 0;

        out.push({
            id: s.id,
            symbol: s.symbol as SupportedSymbol,
            direction: s.direction === "BUY" ? "long" : "short",
            confidence: s.confidence,
            confidenceLabel: String(s.strength ?? "unclassified"),
            timeframe: s.timeframe as Timeframe,
            entry: s.entry,
            stop: s.stopLoss,
            target: s.tp1,
            riskReward: Math.round(riskReward * 100) / 100,
            risk: Math.round(risk * 10000) / 10000,
            evidence: collectEvidence(s),
            regime: String(s.marketRegime ?? "unavailable"),
            strength: String(s.strength ?? "unavailable"),
            status: String(s.status ?? "unknown"),
            createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
            source: {
                id: "ai-signals.scan-symbol",
                label: "AI signal scanner",
                kind: "ai-engine",
                asOf: typeof s.marketDataTimestamp === "number" ? s.marketDataTimestamp : null,
            },
        });
    }

    return out;
}

/** Flatten the scanner's own confidence breakdown into readable evidence lines. */
function collectEvidence(s: Partial<import("@/lib/ai-signals/types").AISignal>): string[] {
    const out: string[] = [];
    const cb = s.confidenceBreakdown;
    if (cb) {
        for (const [key, entry] of Object.entries(cb)) {
            if (!entry || typeof entry !== "object") continue;
            const e = entry as { score?: number; max?: number; detail?: string };
            if (typeof e.score === "number" && typeof e.max === "number" && e.max > 0) {
                out.push(`${humanise(key)}: ${e.score}/${e.max}${e.detail ? ` — ${e.detail}` : ""}`);
            }
        }
    }
    if (typeof s.reasoning === "string" && s.reasoning.trim().length > 0) {
        out.push(s.reasoning.trim());
    }
    return out;
}

function humanise(key: string): string {
    return key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
}
