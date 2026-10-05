/**
 * Strategy input context (Phase 4).
 *
 * The strategy receives ONE structured context per step and never fetches
 * market data from arbitrary components. Everything in the context is
 * guaranteed to be available AS OF the current candle:
 *
 *   Market      — candle + history with timestamp ≤ current
 *   Indicators  — causal feature snapshot (features[i] uses candles[0..i] only)
 *   Smart Money — structure/liquidity/FVG/OB/sweep state, events ≤ current
 *   Portfolio   — balance, equity, exposure, open positions
 *   Risk        — limits + last verdict
 *   State       — strategy id/version, pacing
 */

import type { CandleFeatures } from "@/lib/strategy-lab/features";
import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type { Strategy } from "@/lib/strategy-lab/types";
import { portfolioSnapshot } from "./account";
import type {
    AccountState,
    ExecutionEnvironment,
    Position,
    SmartMoneyContext,
    StrategyContext,
} from "./types";

export interface BuildContextInput {
    environment: ExecutionEnvironment;
    strategy: Strategy;
    symbol: string;
    timeframe: Timeframe;
    candles: MarketCandle[];
    features: CandleFeatures[];
    /** Index of the current candle in the visible series. */
    index: number;
    account: AccountState;
    positions: Position[];
    /** Optional raw SMC events (already filtered by the host). */
    events?: Array<{ id: string; type: string; timestamp: number; price?: number }>;
    barsSinceLastEntry?: number | null;
    lastSignalAt?: number | null;
}

/** Derive the Smart Money view from the causal feature snapshot. */
export function smartMoneyContext(
    features: CandleFeatures | null,
    events: BuildContextInput["events"],
    availableAt?: number
): SmartMoneyContext {
    const cutoff = availableAt ?? features?.timestamp ?? Number.NEGATIVE_INFINITY;
    const structureBreak = (b: CandleFeatures["bos"]): SmartMoneyContext["bos"] =>
        b && b.direction !== "neutral" ? { direction: b.direction, index: b.index } : null;
    return {
        structure: features ? features.trend : "unknown",
        bos: structureBreak(features?.bos ?? null),
        choch: structureBreak(features?.choch ?? null),
        fvgDirection: features?.fvgDirection ?? null,
        fvgBarsAgo: features?.fvgBarsAgo ?? null,
        obDirection: features?.obDirection ?? null,
        lastSweep: features?.lastSweep
            ? { side: features.lastSweep.side, level: features.lastSweep.level, index: features.lastSweep.index }
            : null,
        events: (events ?? []).filter((e) => e.timestamp <= cutoff),
    };
}

/**
 * Build the strategy context at `index`. History is strictly
 * `candles[0..index]` — future candles are physically excluded.
 */
export function buildStrategyContext(input: BuildContextInput): StrategyContext {
    const candle = input.candles[input.index];
    const visible = input.candles.slice(0, input.index + 1);
    const feature = input.features[input.index] ?? null;

    return {
        environment: input.environment,
        market: {
            symbol: input.symbol,
            timeframe: input.timeframe,
            candle,
            index: input.index,
            history: visible,
            session: feature?.session ?? "closed",
            timestamp: candle.timestamp,
        },
        indicators: feature,
        smartMoney: smartMoneyContext(feature, input.events, candle.timestamp),
        portfolio: portfolioSnapshot(input.account, input.positions.filter((p) => p.status === "open").length),
        risk: {
            maxRiskPerTrade: input.strategy.risk.riskPercent,
            maxOpenPositions: input.strategy.risk.maxPositions,
            openPositions: input.positions.filter((p) => p.status === "open").length,
        },
        state: {
            strategyId: input.strategy.id,
            strategyVersion: input.strategy.version,
            barsSinceLastEntry: input.barsSinceLastEntry ?? null,
            lastSignalAt: input.lastSignalAt ?? null,
        },
    };
}
