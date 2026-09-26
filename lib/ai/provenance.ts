/**
 * Provenance contract for the AlgoVault trading intelligence module.
 *
 * Every number the terminal, the analysis workspace or the strategy lab can
 * display is wrapped in `Sourced<T>`. The wrapper exists for one reason: it
 * makes it impossible to render a value that has no origin.
 *
 * Invariants
 * ----------
 * 1. `value === null`  ⇒  the UI MUST render "Data unavailable" (or
 *    "Awaiting engine data"). It must never substitute a default, a zero, or
 *    a previous value.
 * 2. `source.id` is always present, even for an unavailable metric, so a reader
 *    can tell *which* engine failed to answer.
 * 3. No module in `lib/ai/{scalping,analysis,strategy-lab,agents}` is allowed
 *    to invent a value. If the underlying engine did not produce a number, the
 *    metric is unavailable.
 *
 * This file is pure and isomorphic — no Firebase, no env, no network.
 */

/** Stable identifiers for the engines that can produce a metric. */
export type MetricSourceId =
    // market data
    | "market-data.biquote-ohlc"
    | "market-data.tradingview-live"
    // analytics engines
    | "analytics.market-structure"
    | "analytics.liquidity"
    | "analytics.zones"
    | "analytics.zone-scoring"
    | "analytics.market-regime"
    | "analytics.volatility"
    | "analytics.vwap"
    | "analytics.volume"
    | "analytics.market-score"
    | "analytics.sessions"
    | "analytics.multi-timeframe"
    | "analytics.indicators"
    // AI / signal engines
    | "ai-signals.scan-symbol"
    | "ai-signals.quality-filter"
    | "ai-signals.confidence"
    | "agents.market-data"
    | "agents.structure"
    | "agents.momentum"
    | "agents.liquidity"
    | "agents.volatility"
    | "agents.strategy"
    | "agents.risk"
    | "agents.final-intelligence"
    // strategy lab
    | "strategy-lab.market-data"
    | "strategy-lab.backtest"
    | "strategy-lab.validation"
    | "strategy-lab.robustness"
    | "strategy-lab.evolution-run"
    | "strategy-lab.dna";

export type MetricSourceKind = "market-data" | "analytics" | "ai-engine" | "backtest";

export type MetricSource = {
    id: MetricSourceId;
    label: string;
    kind: MetricSourceKind;
    /**
     * Timestamp of the underlying data (ms). `null` means the engine did not
     * report a data timestamp — NOT "now".
     */
    asOf: number | null;
};

export type MetricStatus = "available" | "unavailable";

export type Sourced<T> = {
    value: T | null;
    source: MetricSource;
    status: MetricStatus;
    /** Present only when `status === "unavailable"`. Machine-readable reason. */
    reason?: string;
};

/** Human-readable catalogue used to build sources without repeating strings. */
export const METRIC_SOURCE_LABELS: Record<MetricSourceId, string> = {
    "market-data.biquote-ohlc": "biquote.io OHLC feed",
    "market-data.tradingview-live": "TradingView live quote",
    "analytics.market-structure": "Structure engine (BOS / CHOCH / swings)",
    "analytics.liquidity": "Liquidity engine (levels / sweeps)",
    "analytics.zones": "Zone engine (FVG / order blocks)",
    "analytics.zone-scoring": "Zone scoring engine",
    "analytics.market-regime": "Regime classifier",
    "analytics.volatility": "Volatility engine (ATR)",
    "analytics.vwap": "VWAP engine",
    "analytics.volume": "Volume engine (tick volume)",
    "analytics.market-score": "Market score engine",
    "analytics.sessions": "Session engine",
    "analytics.multi-timeframe": "Multi-timeframe engine",
    "analytics.indicators": "Indicator engine",
    "ai-signals.scan-symbol": "AI signal scanner",
    "ai-signals.quality-filter": "Signal quality filter",
    "ai-signals.confidence": "Signal confidence model",
    "agents.market-data": "Market Data Agent",
    "agents.structure": "Structure Agent",
    "agents.momentum": "Momentum Agent",
    "agents.liquidity": "Liquidity Agent",
    "agents.volatility": "Volatility Agent",
    "agents.strategy": "Strategy Agent",
    "agents.risk": "Risk Agent",
    "agents.final-intelligence": "Final Intelligence Agent",
    "strategy-lab.market-data": "Strategy Lab data bundle",
    "strategy-lab.backtest": "Backtest engine",
    "strategy-lab.validation": "Validation engine (in/out-of-sample)",
    "strategy-lab.robustness": "Robustness scorer",
    "strategy-lab.evolution-run": "Strategy evolution run",
    "strategy-lab.dna": "Strategy DNA record",
};

const SOURCE_KINDS: Record<MetricSourceId, MetricSourceKind> = {
    "market-data.biquote-ohlc": "market-data",
    "market-data.tradingview-live": "market-data",
    "analytics.market-structure": "analytics",
    "analytics.liquidity": "analytics",
    "analytics.zones": "analytics",
    "analytics.zone-scoring": "analytics",
    "analytics.market-regime": "analytics",
    "analytics.volatility": "analytics",
    "analytics.vwap": "analytics",
    "analytics.volume": "analytics",
    "analytics.market-score": "analytics",
    "analytics.sessions": "analytics",
    "analytics.multi-timeframe": "analytics",
    "analytics.indicators": "analytics",
    "ai-signals.scan-symbol": "ai-engine",
    "ai-signals.quality-filter": "ai-engine",
    "ai-signals.confidence": "ai-engine",
    "agents.market-data": "ai-engine",
    "agents.structure": "ai-engine",
    "agents.momentum": "ai-engine",
    "agents.liquidity": "ai-engine",
    "agents.volatility": "ai-engine",
    "agents.strategy": "ai-engine",
    "agents.risk": "ai-engine",
    "agents.final-intelligence": "ai-engine",
    "strategy-lab.market-data": "market-data",
    "strategy-lab.backtest": "backtest",
    "strategy-lab.validation": "backtest",
    "strategy-lab.robustness": "backtest",
    "strategy-lab.evolution-run": "backtest",
    "strategy-lab.dna": "backtest",
};

export function metricSource(id: MetricSourceId, asOf: number | null): MetricSource {
    return { id, label: METRIC_SOURCE_LABELS[id] ?? id, kind: SOURCE_KINDS[id] ?? "analytics", asOf };
}

/** A metric the engine actually produced. */
export function sourced<T>(value: T, id: MetricSourceId, asOf: number | null = null): Sourced<T> {
    return { value, source: metricSource(id, asOf), status: "available" };
}

/** A metric the engine did not produce. Carries a reason, never a filler value. */
export function unavailable<T>(
    id: MetricSourceId,
    reason: string,
    asOf: number | null = null
): Sourced<T> {
    return { value: null, source: metricSource(id, asOf), status: "unavailable", reason };
}

/**
 * Coerce a possibly-missing number into a `Sourced<number>`.
 * Rejects NaN/Infinity because those are display bugs, not measurements.
 */
export function sourcedNumber(
    value: number | null | undefined,
    id: MetricSourceId,
    asOf: number | null = null,
    reason = "Engine did not report this metric."
): Sourced<number> {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return unavailable<number>(id, reason, asOf);
    }
    return sourced(value, id, asOf);
}

/** Same as {@link sourcedNumber} but preserves `null` for genuinely empty lists. */
export function sourcedArray<T>(
    values: T[] | null | undefined,
    id: MetricSourceId,
    asOf: number | null = null,
    reason = "Engine returned no records."
): Sourced<T[]> {
    if (!values || values.length === 0) {
        return unavailable<T[]>(id, reason, asOf);
    }
    return sourced(values, id, asOf);
}

// ── display helpers ─────────────────────────────────────────────────────────

export const UNAVAILABLE_LABEL = "Data unavailable";
export const AWAITING_LABEL = "Awaiting engine data";

/** Resolve the metric value, or `fallback` when unavailable. Callers must pass
 *  an explicit fallback — there is no implicit default. */
export function metricValue<T>(metric: Sourced<T> | null | undefined): T | null {
    return metric && metric.status === "available" ? metric.value : null;
}

export function isAvailable<T>(metric: Sourced<T> | null | undefined): metric is Sourced<T> & { value: T } {
    return !!metric && metric.status === "available" && metric.value !== null;
}
