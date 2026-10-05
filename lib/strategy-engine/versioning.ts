/**
 * Strategy versioning & reproducibility (Phase 4).
 *
 * A strategy is a versioned artifact. Changing indicators, entry/exit rules,
 * SMC rules, risk or sizing produces a NEW structural fingerprint, so a result
 * produced by v1 can never silently change when v2 is created — experiments
 * always record the exact manifest they were produced with.
 *
 * Everything here is deterministic: no Math.random, no Date.now() in
 * fingerprints (timestamps are only recorded on experiment records).
 */

import { SMART_MONEY_VERSION } from "@/lib/market-core";
import { strategyFingerprint, stableHash } from "@/lib/strategy-research/fingerprint";
import type { BacktestConfig, Strategy } from "@/lib/strategy-lab/types";
import type { ExperimentRecord, StrategyDefinition, StrategyVersionManifest } from "./types";

/** Bump when the engine's decision/execution semantics change. */
export const STRATEGY_ENGINE_VERSION = "4.0.0";
/** Indicator computation version (lib/analytics/indicators + causal features). */
export const INDICATOR_ENGINE_VERSION = "1.1.0";
/** Order fill / cost semantics version (spread, slippage, commission, gaps). */
export const EXECUTION_MODEL_VERSION = "1.1.0";

export const ENGINE_VERSIONS = {
    strategyEngine: STRATEGY_ENGINE_VERSION,
    indicators: INDICATOR_ENGINE_VERSION,
    smartMoney: SMART_MONEY_VERSION,
    executionModel: EXECUTION_MODEL_VERSION,
} as const;

/**
 * Canonical, deterministic version manifest for a strategy.
 *
 * `strategyVersion` is the structural fingerprint: two strategies that differ
 * only in name/description share a fingerprint; any change to rules, filters,
 * SL/TP, risk, timeframes or execution model produces a new one.
 */
export function strategyVersionManifest(strategy: StrategyDefinition): StrategyVersionManifest {
    return {
        strategyVersion: strategyFingerprint(strategy as Strategy),
        declaredVersion: strategy.version ?? "0.0.0",
        indicatorVersions: {
            engine: INDICATOR_ENGINE_VERSION,
        },
        smcVersion: String(SMART_MONEY_VERSION),
        executionModelVersion: EXECUTION_MODEL_VERSION,
        engineVersion: STRATEGY_ENGINE_VERSION,
        costModelVersion: EXECUTION_MODEL_VERSION,
    };
}

/** Stable id for an experiment: strategy fingerprint + dataset + config. */
export function experimentId(input: {
    strategy: StrategyDefinition;
    symbol: string;
    timeframe: string;
    from: number;
    to: number;
    config: BacktestConfig;
}): string {
    const manifest = strategyVersionManifest(input.strategy);
    const key = [
        manifest.strategyVersion,
        manifest.engineVersion,
        manifest.executionModelVersion,
        input.symbol,
        input.timeframe,
        input.from,
        input.to,
        input.config.initialBalance,
        input.config.executionModel,
        input.config.spreadPips,
        input.config.commissionPerLot,
        input.config.slippagePips,
        input.config.riskMode,
        input.config.riskPercent,
        input.config.fixedLot,
    ].join("|");
    return `exp_${stableHash(key)}`;
}

/**
 * Build the experiment record for a finished run. Reproducible: replaying the
 * same (strategy manifest, dataset, config) must yield the same experimentId
 * and therefore the same numbers.
 */
export function buildExperimentRecord(input: {
    strategy: StrategyDefinition;
    symbol: string;
    timeframe: ExperimentRecord["dataset"]["timeframe"];
    from: number;
    to: number;
    bars: number;
    source?: string;
    config: BacktestConfig;
    parameters?: Record<string, unknown>;
    results: ExperimentRecord["results"];
    createdAt: number;
    environment: ExperimentRecord["environment"];
    limitations?: string[];
    assumptions?: string[];
}): ExperimentRecord {
    const manifest = strategyVersionManifest(input.strategy);
    return {
        experimentId: experimentId({
            strategy: input.strategy,
            symbol: input.symbol,
            timeframe: input.timeframe,
            from: input.from,
            to: input.to,
            config: input.config,
        }),
        strategyId: input.strategy.id,
        strategyName: input.strategy.name,
        manifest,
        dataset: {
            symbol: input.symbol,
            timeframe: input.timeframe,
            from: input.from,
            to: input.to,
            bars: input.bars,
            source: input.source ?? "historical",
        },
        config: input.config,
        parameters: input.parameters ?? {},
        results: input.results,
        createdAt: input.createdAt,
        environment: input.environment,
        limitations: input.limitations ?? [],
        assumptions: input.assumptions ?? [],
    };
}

/**
 * True when a stored result can be reproduced by re-running with this
 * strategy — i.e. the strategy has not changed since the result was produced.
 */
export function isReproducible(stored: StrategyVersionManifest, strategy: StrategyDefinition): boolean {
    const current = strategyVersionManifest(strategy);
    return (
        stored.strategyVersion === current.strategyVersion &&
        stored.engineVersion === current.engineVersion &&
        stored.executionModelVersion === current.executionModelVersion
    );
}
