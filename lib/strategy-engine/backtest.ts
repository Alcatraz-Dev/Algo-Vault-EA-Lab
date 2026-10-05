/**
 * Unified research backtest (Phase 4).
 *
 *   Strategy → Dataset → Market conditions → Execution model → Simulation
 *   → Trades → Equity curve → Performance analytics → Experiment record
 *
 * Runs the CANONICAL engine (via StrategyLab's `backtestStrategy`, which is
 * now a thin driver over lib/strategy-engine) and packages the outcome with:
 *   • a reproducible ExperimentRecord (strategy version manifest + dataset +
 *     execution/risk configuration)
 *   • analytics: MAE/MFE, session/regime/time segmentation, drawdown periods
 *     with trade attribution, daily/monthly P&L, advanced metrics
 *   • integrity flags: INSUFFICIENT_DATA + documented SIMULATION_ASSUMPTION
 *
 * Nothing here fabricates results: insufficient inputs are flagged, and every
 * number comes from executed trades.
 */

import { backtestStrategy } from "@/lib/strategy-lab/backtest";
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type {
    BacktestConfig,
    BacktestResult,
    BacktestTrade,
    EquityPoint,
    Strategy,
} from "@/lib/strategy-lab/types";
import {
    byDayOfWeek,
    byDirection,
    byHourOfDay,
    byRegime,
    bySession,
    computeAdvancedMetrics,
    computeExcursions,
    dailyPnl,
    drawdownPeriods,
    monthlyPnl,
    summarizeExcursions,
    INSUFFICIENT_DATA,
    type AdvancedMetrics,
    type DrawdownPeriod,
    type ExcursionSummary,
    type GroupPerformance,
    type PnlBucket,
    type TradeExcursion,
} from "./analytics";
import { buildExperimentRecord } from "./versioning";
import type { ExperimentRecord, ExecutionEnvironment } from "./types";

/** Documented simulation assumptions surfaced next to every result. */
export const SIMULATION_ASSUMPTIONS = [
    "OHLC data only: spread and slippage are charged as explicit per-leg cash costs (net-equivalent of bid/ask execution); historical bid/ask is not available.",
    "When a stop and a target are both touched inside one bar, the stop is assumed to fill first (conservative).",
    "Gaps: stops/targets fill at the bar open when the market opened through them.",
    "Commission is charged once, on exit (established Strategy Lab cost model).",
    "Swap/rollover is not modeled.",
    "Margin is modeled 1:1 against notional for exposure reporting.",
];

/** Minimums below which metrics are declared unreliable. */
export const RELIABILITY = {
    minBars: 100,
    minTradesForSegments: 5,
};

export interface ResearchBacktestRequest {
    strategy: Strategy;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>;
    config: BacktestConfig;
    from?: number;
    to?: number;
    environment?: ExecutionEnvironment;
    datasetSource?: string;
    parameters?: Record<string, unknown>;
    /** Override "now" for reproducible experiment timestamps. */
    createdAt?: number;
}

export interface ResearchBacktestAnalytics {
    excursions: TradeExcursion[];
    excursionSummary: ExcursionSummary;
    sessions: GroupPerformance[];
    regimes: GroupPerformance[];
    hoursOfDay: GroupPerformance[];
    daysOfWeek: GroupPerformance[];
    directions: GroupPerformance[];
    drawdownPeriods: DrawdownPeriod[];
    daily: PnlBucket[];
    monthly: PnlBucket[];
    advanced: AdvancedMetrics;
}

export interface ResearchBacktestResult {
    experiment: ExperimentRecord;
    result: BacktestResult;
    analytics: ResearchBacktestAnalytics;
    integrity: {
        insufficientData: boolean;
        reasons: string[];
        assumptions: string[];
        limitations: string[];
    };
}

/**
 * Run a fully reproducible backtest + analytics pack.
 * Re-running with the same (strategy, dataset, config) yields the same
 * `experimentId` and the same numbers.
 */
export function runResearchBacktest(request: ResearchBacktestRequest): ResearchBacktestResult {
    const strategy = request.strategy;
    const symbol = request.symbol;
    const from = request.from ?? request.config.from;
    const to = request.to ?? request.config.to;

    const result = backtestStrategy(strategy, symbol, request.candlesByTF, request.config, from, to);

    const primaryCandles = request.candlesByTF[strategy.timeframes.setup] ?? [];
    const trades: BacktestTrade[] = result.trades;
    const equity: EquityPoint[] = result.equity;

    const excursions = trades.length > 0 ? computeExcursions(trades, primaryCandles) : [];
    const excursionSummary = summarizeExcursions(excursions);

    const analytics: ResearchBacktestAnalytics = {
        excursions,
        excursionSummary,
        sessions: bySession(trades),
        regimes: byRegime(trades),
        hoursOfDay: byHourOfDay(trades),
        daysOfWeek: byDayOfWeek(trades),
        directions: byDirection(trades),
        drawdownPeriods: drawdownPeriods(equity, trades),
        daily: dailyPnl(trades),
        monthly: monthlyPnl(trades),
        advanced: computeAdvancedMetrics(trades, equity, request.config.initialBalance),
    };

    // ── Integrity ──
    const reasons: string[] = [];
    const bars = result.coverage.availableBars;
    if (bars < RELIABILITY.minBars) {
        reasons.push(`${INSUFFICIENT_DATA}: ${bars} bars (< ${RELIABILITY.minBars}).`);
    }
    if (trades.length === 0) {
        reasons.push(`${INSUFFICIENT_DATA}: no trades were produced by this strategy on this dataset.`);
    } else if (trades.length < RELIABILITY.minTradesForSegments) {
        reasons.push(
            `${INSUFFICIENT_DATA}: only ${trades.length} trades — segment breakdowns (session/regime/time) are not statistically meaningful.`
        );
    }
    if (result.diagnostics && result.diagnostics.blockingRuleIds.length > 0) {
        reasons.push(
            `Blocking rules (zero passes): ${result.diagnostics.blockingRuleIds.join(", ")}.`
        );
    }

    const limitations: string[] = [];
    if (bars > 0 && result.coverage.availableFrom > from) {
        limitations.push("Dataset does not fully cover the requested range; results cover the available period only.");
    }

    const experiment = buildExperimentRecord({
        strategy,
        symbol,
        timeframe: strategy.timeframes.setup,
        from,
        to,
        bars,
        source: request.datasetSource ?? "historical",
        config: request.config,
        parameters: request.parameters ?? {},
        results: {
            netProfit: result.metrics.netProfit,
            winRate: result.metrics.winRate,
            profitFactor: Number.isFinite(result.metrics.profitFactor) ? result.metrics.profitFactor : 0,
            maxDrawdownPct: result.metrics.maxDrawdownPct,
            totalTrades: result.metrics.totalTrades,
            returnPct: result.metrics.returnPct,
        },
        createdAt: request.createdAt ?? Date.now(),
        environment: request.environment ?? "backtest",
        limitations,
        assumptions: SIMULATION_ASSUMPTIONS,
    });

    return {
        experiment,
        result,
        analytics,
        integrity: {
            insufficientData: reasons.some((r) => r.includes(INSUFFICIENT_DATA)),
            reasons,
            assumptions: SIMULATION_ASSUMPTIONS,
            limitations,
        },
    };
}
