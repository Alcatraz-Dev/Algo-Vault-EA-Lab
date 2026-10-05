/**
 * Strategy → Alerts bridge (Phase 4).
 *
 * The SAME canonical condition evaluation that opens trades drives alerts —
 * there is no second alert implementation that could disagree with the
 * strategy. An alert fires when `evaluateEntry` fires (or when a specific
 * condition set passes), carrying the strategy version for reproducibility.
 */

import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type { Strategy, StrategyRule } from "@/lib/strategy-lab/types";
import { evaluateEntry, buildSeriesMap, type SeriesMap } from "./decisions";
import type { EntryEvaluation } from "./decisions";
import type { TraceCondition } from "./types";

export interface StrategyAlert {
    id: string;
    strategyId: string;
    strategyVersion: string;
    symbol: string;
    timeframe: Timeframe;
    timestamp: number;
    title: string;
    message: string;
    conditions: TraceCondition[];
    direction: "long" | "short";
    priority: "info" | "warning";
}

/** Human-readable descriptor of a rule — reused by the alert builder UI. */
export interface AlertConditionDescriptor {
    ruleId: string;
    label: string;
    group: string;
    timeframe: Timeframe | null;
    expression: string;
    enabled: boolean;
}

/** Map canonical strategy conditions into alert condition descriptors. */
export function strategyAlertConditions(strategy: Strategy): AlertConditionDescriptor[] {
    return [...strategy.entryRules, ...strategy.confirmationRules].map((r) => ({
        ruleId: r.id,
        label: r.label,
        group: r.group,
        timeframe: r.timeframe ?? null,
        expression: describeRule(r),
        enabled: r.enabled,
    }));
}

function describeRule(r: StrategyRule): string {
    const value = Array.isArray(r.value) ? r.value.join(",") : String(r.value);
    if (r.group === "indicator" && r.indicator) return `${r.indicator} ${r.operator} ${value}`;
    return `${r.group} ${r.operator} ${value}${r.negate ? " (negated)" : ""}`;
}

export interface BuildAlertInput {
    strategy: Strategy;
    symbol: string;
    timeframe: Timeframe;
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>;
    /** Alert at the last closed bar (default) or at a specific timestamp. */
    timestamp?: number;
    seriesMap?: SeriesMap;
}

/**
 * Evaluate the strategy conditions and build an alert when they fire.
 * Returns null when they do not — never alerts on stale/false conditions.
 */
export function buildStrategyAlert(input: BuildAlertInput): StrategyAlert | null {
    const seriesMap = input.seriesMap ?? buildSeriesMap(input.candlesByTF);
    const series = seriesMap[input.strategy.timeframes.setup];
    if (!series || series.candles.length === 0) return null;

    let index = series.candles.length - 1;
    if (input.timestamp !== undefined) {
        index = -1;
        for (let i = series.candles.length - 1; i >= 0; i--) {
            if (series.candles[i].timestamp <= input.timestamp) {
                index = i;
                break;
            }
        }
        if (index < 0) return null;
    }

    const evaluation: EntryEvaluation = evaluateEntry({
        strategy: input.strategy,
        seriesMap,
        index,
    });
    if (!evaluation.fired) return null;

    const candle = series.candles[index];
    const when = new Date(candle.timestamp).toISOString().replace("T", " ").slice(0, 16);
    const direction = input.strategy.direction;

    return {
        id: `alert_${input.strategy.id}_${candle.timestamp}`,
        strategyId: input.strategy.id,
        strategyVersion: input.strategy.version,
        symbol: input.symbol,
        timeframe: input.timeframe,
        timestamp: candle.timestamp,
        title: `${input.strategy.name} → ${direction.toUpperCase()} ${input.symbol}`,
        message: [
            `${when} · ${input.symbol} ${input.timeframe}`,
            evaluation.conditions.length > 0 ? `Conditions: ${evaluation.conditions.join(" + ")}` : "Conditions matched",
            `Regime: ${evaluation.regime} · Session: ${evaluation.session}`,
        ].join("\n"),
        conditions: evaluation.conditionTrace,
        direction: direction === "short" ? "short" : "long",
        priority: "info",
    };
}
