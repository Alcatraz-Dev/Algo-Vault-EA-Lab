/**
 * AlgoVault — directional scalping evaluation (LONG / SHORT / BOTH).
 *
 * ONE implementation evaluates both sides. It does NOT re-implement the
 * strategy decision rules: each side is a canonical `Strategy` produced by
 * `buildScalpingStrategy`, evaluated through
 * `evaluateEntry` (lib/strategy-engine/decisions) — the SAME decision core the
 * Strategy Lab backtest, replay and forward tester use, with the feature
 * series built once per call.
 *
 * Conflict policy:
 *   • neither side qualifies        → WAIT (no_setup)
 *   • both sides qualify            → WAIT (conflicting_signals) — never pick one
 *   • one side below min confidence → WAIT (low_confidence)
 *   • forbidden side by direction   → that side is not even evaluated
 *
 * Confidence is a documented, deterministic score computed from the canonical
 * feature row. It is a signal-QUALITY filter, not a probability of profit and
 * not an AI judgement.
 */

import type { MarketCandle, MarketSession, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { CandleFeatures } from "@/lib/strategy-lab/features";
import { buildSeriesMap, evaluateEntry, type SeriesMap } from "@/lib/strategy-engine/decisions";
import type { Strategy } from "@/lib/strategy-lab/types";
import {
    buildScalpingStrategy,
    directionPermits,
    type ScalpingBotConfig,
} from "./profiles";

export type ScalpingDecision = "ENTER" | "WAIT";

export type ScalpingWaitReason =
    | "no_data"
    | "insufficient_data"
    | "stale_data"
    | "out_of_session"
    | "no_setup"
    | "conflicting_signals"
    | "low_confidence"
    | "direction_not_allowed";

export interface ConfidenceComponent {
    id: string;
    label: string;
    weight: number;
    /** Normalised 0–1 contribution before weighting. */
    value: number;
    detail: string;
}

export interface ScalpingSideEvaluation {
    side: "long" | "short";
    /** False when the configured direction forbids this side. */
    evaluated: boolean;
    fired: boolean;
    confidence: number;
    blockedBy: string | null;
    conditions: string[];
    breakdown: ConfidenceComponent[];
}

export interface DirectionalScalpingEvaluation {
    decision: ScalpingDecision;
    direction: "long" | "short" | null;
    reason: ScalpingWaitReason | null;
    detail: string;
    confidence: number;
    atr: number;
    regime: string;
    session: string;
    trend: string;
    barTimestamp: number;
    barAgeMs: number;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    sides: { long: ScalpingSideEvaluation; short: ScalpingSideEvaluation };
}

export interface DirectionalEvaluationOptions {
    /** Wall clock used for staleness. Defaults to Date.now(). */
    now?: number;
    /**
     * Maximum accepted age of the newest closed bar. Defaults to 3× the
     * timeframe duration — enough for one missed poll, never enough to trade a
     * dead feed.
     */
    maxBarAgeMs?: number;
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
    M1: 60_000,
    M3: 180_000,
    M5: 300_000,
    M15: 900_000,
    M30: 1_800_000,
    H1: 3_600_000,
    H4: 14_400_000,
    D1: 86_400_000,
    W1: 604_800_000,
};

/** Minimum closed bars before any side is evaluated (indicator warm-up). */
export const SCALPING_MIN_BARS = 60;

export function timeframeMs(tf: Timeframe): number {
    return TIMEFRAME_MS[tf] ?? TIMEFRAME_MS.M5;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function emptySide(side: "long" | "short", evaluated: boolean, blockedBy: string | null): ScalpingSideEvaluation {
    return { side, evaluated, fired: false, confidence: 0, blockedBy, conditions: [], breakdown: [] };
}

/**
 * Deterministic signal-quality score for one side at one feature row.
 *
 * Weights sum to 1.0. Every input is a causal feature already computed by
 * `lib/strategy-lab/features` — nothing is estimated or invented.
 */
export function scoreSignalConfidence(
    features: CandleFeatures | null,
    side: "long" | "short",
): { score: number; breakdown: ConfidenceComponent[] } {
    if (!features) return { score: 0, breakdown: [] };

    const long = side === "long";
    const atr = features.atr > 0 ? features.atr : 0;
    const emaFast = features.ind["ema_9"] ?? null;
    const emaSlow = features.ind["ema_21"] ?? null;
    const rsi = features.rsi ?? features.ind["rsi_14"] ?? null;

    const trendValue = features.trend === (long ? "bullish" : "bearish") ? 1 : 0;

    const emaSeparation =
        emaFast !== null && emaSlow !== null && atr > 0 && Number.isFinite(emaFast) && Number.isFinite(emaSlow)
            ? clamp01(Math.abs(emaFast - emaSlow) / (atr * 0.5))
            : 0;

    const rsiAligned = rsi === null ? 0 : long ? clamp01((rsi - 50) / 20) : clamp01((50 - rsi) / 20);

    const structureRaw = long
        ? features.bos?.direction === "bullish" || features.choch?.direction === "bullish"
            ? 1
            : features.higherLow
              ? 0.6
              : features.higherHigh
                ? 0.3
                : 0
        : features.bos?.direction === "bearish" || features.choch?.direction === "bearish"
          ? 1
          : features.lowerHigh
            ? 0.6
            : features.lowerLow
              ? 0.3
              : 0;

    const momentumAligned = long
        ? features.momentumPct > 0
            ? clamp01(features.momentumPct / 0.2)
            : 0
        : features.momentumPct < 0
          ? clamp01(-features.momentumPct / 0.2)
          : 0;

    const range = features.high - features.low;
    const body = features.close - features.open;
    const candleRaw =
        range > 0
            ? long
                ? body > 0
                    ? clamp01(body / range)
                    : 0
                : body < 0
                  ? clamp01(-body / range)
                  : 0
            : 0;

    const breakdown: ConfidenceComponent[] = [
        {
            id: "trend",
            label: "Trend regime alignment",
            weight: 0.3,
            value: trendValue,
            detail: `trend ${features.trend}`,
        },
        {
            id: "ema",
            label: "EMA 9/21 separation",
            weight: 0.15,
            value: emaSeparation,
            detail:
                emaFast !== null && emaSlow !== null
                    ? `EMA9 ${emaFast.toFixed(4)} vs EMA21 ${emaSlow.toFixed(4)}`
                    : "EMA not ready",
        },
        {
            id: "rsi",
            label: "RSI 14 momentum",
            weight: 0.2,
            value: rsiAligned,
            detail: rsi === null ? "RSI not ready" : `RSI ${rsi.toFixed(1)}`,
        },
        {
            id: "structure",
            label: "Market structure alignment",
            weight: 0.15,
            value: clamp01(structureRaw),
            detail: `bos ${features.bos?.direction ?? "none"} · choch ${features.choch?.direction ?? "none"}`,
        },
        {
            id: "momentum",
            label: "Short-term momentum",
            weight: 0.1,
            value: momentumAligned,
            detail: `momentum ${features.momentumPct.toFixed(3)}%`,
        },
        {
            id: "candle",
            label: "Candle confirmation",
            weight: 0.1,
            value: candleRaw,
            detail: `body/range ${range > 0 ? (body / range).toFixed(2) : "n/a"}`,
        },
    ];

    const score = clamp01(breakdown.reduce((sum, c) => sum + c.weight * c.value, 0));
    return { score, breakdown };
}

export interface DirectionalResolutionInput {
    direction: ScalpingBotConfig["direction"];
    longFired: boolean;
    shortFired: boolean;
    longConfidence: number;
    shortConfidence: number;
    minConfidence: number;
}

export interface DirectionalResolution {
    decision: ScalpingDecision;
    direction: "long" | "short" | null;
    reason: ScalpingWaitReason | null;
    confidence: number;
}

/**
 * Resolve two independent side decisions into ONE action.
 *
 * Pure and exported so the conflict/no-setup/low-confidence policy is
 * testable on its own: the strategy is never allowed to pick a side out of a
 * genuine conflict, and "both qualified" is a WAIT, not a preference.
 */
export function resolveDirectionalDecision(
    input: DirectionalResolutionInput,
): DirectionalResolution {
    const { longFired, shortFired } = input;

    if (longFired && shortFired) {
        return {
            decision: "WAIT",
            direction: null,
            reason: "conflicting_signals",
            confidence: Math.max(input.longConfidence, input.shortConfidence),
        };
    }
    if (!longFired && !shortFired) {
        return { decision: "WAIT", direction: null, reason: "no_setup", confidence: 0 };
    }

    const side: "long" | "short" = longFired ? "long" : "short";
    const confidence = longFired ? input.longConfidence : input.shortConfidence;
    if (confidence < input.minConfidence) {
        return { decision: "WAIT", direction: null, reason: "low_confidence", confidence };
    }
    return { decision: "ENTER", direction: side, reason: null, confidence };
}

/** Index of the last bar at or before `timestamp` (binary search), or -1. */
function indexAtOrBefore(candles: MarketCandle[], timestamp: number): number {
    let lo = 0;
    let hi = candles.length - 1;
    let idx = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].timestamp <= timestamp) {
            idx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return idx;
}

/**
 * Evaluate LONG and SHORT for one closed bar and resolve a single decision.
 *
 * `candlesByTF` must contain the config timeframe; auxiliary timeframes are
 * honoured for rules that name them (the scalping profile uses one timeframe).
 */
export function evaluateDirectionalScalping(
    config: ScalpingBotConfig,
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    timestamp?: number,
    options: DirectionalEvaluationOptions = {},
): DirectionalScalpingEvaluation {
    const now = options.now ?? Date.now();
    const primary = candlesByTF[config.timeframe] ?? [];
    const emptySides = {
        long: emptySide("long", false, null),
        short: emptySide("short", false, null),
    };

    const base = {
        decision: "WAIT" as ScalpingDecision,
        direction: null,
        confidence: 0,
        atr: 0,
        regime: "transitional",
        session: "closed" as MarketSession,
        trend: "neutral",
        barTimestamp: 0,
        barAgeMs: 0,
        symbol: config.symbol,
        timeframe: config.timeframe,
        sides: emptySides,
    };

    if (primary.length === 0) {
        return { ...base, reason: "no_data", detail: "No closed bars are available for the configured timeframe." };
    }
    if (primary.length < SCALPING_MIN_BARS) {
        return {
            ...base,
            reason: "insufficient_data",
            detail: `Only ${primary.length} closed bars available; ${SCALPING_MIN_BARS} are required for indicator warm-up.`,
        };
    }

    const index = timestamp === undefined ? primary.length - 1 : indexAtOrBefore(primary, timestamp);
    if (index < 0) {
        return { ...base, reason: "no_data", detail: "No closed bar exists at or before the requested timestamp." };
    }

    const bar = primary[index];
    const barAgeMs = Math.max(0, now - bar.timestamp);
    const maxBarAgeMs = options.maxBarAgeMs ?? timeframeMs(config.timeframe) * 3;
    if (barAgeMs > maxBarAgeMs) {
        return {
            ...base,
            barTimestamp: bar.timestamp,
            barAgeMs,
            reason: "stale_data",
            detail: `Newest closed bar is ${Math.round(barAgeMs / 1000)}s old (limit ${Math.round(maxBarAgeMs / 1000)}s).`,
        };
    }

    const seriesMap: SeriesMap = buildSeriesMap({ ...candlesByTF, [config.timeframe]: primary });
    const features = seriesMap[config.timeframe]?.features[index] ?? null;

    const longAllowed = directionPermits(config.direction, "long");
    const shortAllowed = directionPermits(config.direction, "short");

    const evaluateSide = (
        side: "long" | "short",
        allowed: boolean,
    ): { side: ScalpingSideEvaluation; regime: string | null } => {
        if (!allowed) return { side: emptySide(side, false, "direction_not_allowed"), regime: null };
        const strategy: Strategy = buildScalpingStrategy(config, side);
        const result = evaluateEntry({ strategy, seriesMap, index });
        const { score, breakdown } = scoreSignalConfidence(features, side);
        return {
            regime: result.regime,
            side: {
                side,
                evaluated: true,
                fired: result.fired,
                confidence: result.fired ? score : 0,
                blockedBy: result.blockedBy,
                conditions: result.conditions,
                breakdown,
            },
        };
    };

    const longResult = evaluateSide("long", longAllowed);
    const shortResult = evaluateSide("short", shortAllowed);
    const long = longResult.side;
    const short = shortResult.side;

    const session = (features?.session ?? "closed") as MarketSession;
    const shared = {
        atr: features?.atr ?? 0,
        regime: longResult.regime ?? shortResult.regime ?? "transitional",
        session,
        trend: features?.trend ?? "neutral",
        barTimestamp: bar.timestamp,
        barAgeMs,
    };

    const resolution = resolveDirectionalDecision({
        direction: config.direction,
        longFired: long.fired,
        shortFired: short.fired,
        longConfidence: long.confidence,
        shortConfidence: short.confidence,
        minConfidence: config.minSignalConfidence,
    });

    if (resolution.decision === "ENTER" && resolution.direction) {
        return {
            ...base,
            ...shared,
            decision: "ENTER",
            direction: resolution.direction,
            reason: null,
            confidence: resolution.confidence,
            detail: `${resolution.direction} setup qualified with confidence ${resolution.confidence.toFixed(2)}.`,
            sides: { long, short },
        };
    }

    if (resolution.reason === "conflicting_signals") {
        return {
            ...base,
            ...shared,
            reason: "conflicting_signals",
            detail: "Long and short conditions both qualified on the same bar — no order is issued.",
            confidence: resolution.confidence,
            sides: { long, short },
        };
    }

    if (resolution.reason === "low_confidence") {
        const firedSide = long.fired ? long : short;
        return {
            ...base,
            ...shared,
            reason: "low_confidence",
            detail: `${firedSide.side} setup scored ${resolution.confidence.toFixed(2)} below the ${config.minSignalConfidence} minimum.`,
            confidence: resolution.confidence,
            sides: { long, short },
        };
    }

    const blocked = [long, short].find((s) => s.evaluated)?.blockedBy ?? "entry_rules";
    return {
        ...base,
        ...shared,
        reason: blocked === "session" ? "out_of_session" : "no_setup",
        detail: `Neither direction qualified (blocked by ${blocked}).`,
        sides: { long, short },
    };
}
