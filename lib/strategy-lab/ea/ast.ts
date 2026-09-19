// ─────────────────────────────────────────────────────────────────────────────
// Strategy → MT5 EA Generator — deterministic AST.
//
// Builds a typed intermediate representation from the Strategy Lab Strategy.
// The MQL5 generator consumes this AST; AI never writes MQL5 directly.
// ─────────────────────────────────────────────────────────────────────────────

import { Strategy, StrategyRule } from "../types";
import { Timeframe } from "../../market-data/types";
import { EAIndicator, EAStrategySpec } from "./types";

export type ASTCondition = {
    id: string;
    group: string;
    label: string;
    operator: string;
    value: string | number | boolean | string[];
    negate?: boolean;
    groupLogic: "AND" | "OR";
    timeframe?: Timeframe;
};

export type ASTEntryBlock = {
    conditions: ASTCondition[];
    confirmationConditions: ASTCondition[];
    direction: "long" | "short";
};

export type AST = {
    strategyId: string;
    name: string;
    version: string;
    symbol: string;
    timeframe: Timeframe;
    timeframes: Record<string, Timeframe>;
    direction: "long" | "short";
    regimeFilter: string[];
    indicators: EAIndicator[];
    entry: ASTEntryBlock;
    exit: {
        stopLoss: { mode: string; atrMultiple?: number; levelOffset?: number; useSwing?: boolean };
        takeProfit: { mode: string; r1: number; r2: number; r3: number; fixedDistance: number; partialCloses: { atR: number; closePercent: number }[]; moveBEAfterTp1: boolean; lockAfterTp2: boolean; trailingEnabled: boolean; trailingStopAtr: number };
    };
    risk: EAStrategySpec["risk"];
    filters: EAStrategySpec["filters"];
    executionModel: "next_bar_open" | "same_bar_close";
    costs: { spreadPips: number; commissionPerLot: number; slippagePips: number };
};

/**
 * Maps Strategy Lab rule groups to indicators that must be initialised in MQL5.
 */
export function buildIndicatorsFromRules(rules: StrategyRule[]): EAIndicator[] {
    const indicators: EAIndicator[] = [];
    const seen = new Set<string>();

    for (const rule of rules) {
        if (!rule.enabled) continue;
        const tf = rule.timeframe ?? "M5";
        switch (rule.group) {
            case "trend": {
                if (!seen.has(`ema20_${tf}`)) {
                    indicators.push({ id: `ema20_${tf}`, name: "EMA 20", type: "EMA", params: { period: 20 }, timeframe: tf, buffer: 0 });
                    seen.add(`ema20_${tf}`);
                }
                if (!seen.has(`ema50_${tf}`)) {
                    indicators.push({ id: `ema50_${tf}`, name: "EMA 50", type: "EMA", params: { period: 50 }, timeframe: tf, buffer: 1 });
                    seen.add(`ema50_${tf}`);
                }
                break;
            }
            case "volatility": {
                if (!seen.has(`atr14_${tf}`)) {
                    indicators.push({ id: `atr14_${tf}`, name: "ATR 14", type: "ATR", params: { period: 14 }, timeframe: tf, buffer: 0 });
                    seen.add(`atr14_${tf}`);
                }
                break;
            }
            case "liquidity":
            case "structure":
            case "fvg":
            case "order_block":
            case "price_action":
            case "confirmation": {
                if (!seen.has(`atr14_${tf}`)) {
                    indicators.push({ id: `atr14_${tf}`, name: "ATR 14", type: "ATR", params: { period: 14 }, timeframe: tf, buffer: 0 });
                    seen.add(`atr14_${tf}`);
                }
                break;
            }
            default:
                break;
        }
    }

    return indicators;
}

// options is part of the public signature (the generator passes it for
// future-proofing); the AST itself is derived purely from the strategy.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildAST(strategy: Strategy, _options: { enableGateway: boolean; enableLicense: boolean; licenseDurationDays: number; sourceAvailable: boolean; protected: boolean; generatorVersion: string; strategyHash: string }): AST {
    const entryConditions: ASTCondition[] = (strategy.entryRules || []).filter((r) => r.enabled).map((r) => ({
        id: r.id,
        group: r.group,
        label: r.label,
        operator: r.operator,
        value: r.value,
        negate: r.negate,
        groupLogic: r.groupLogic,
        timeframe: r.timeframe,
    }));

    const confirmationConditions: ASTCondition[] = (strategy.confirmationRules || []).filter((r) => r.enabled).map((r) => ({
        id: r.id,
        group: r.group,
        label: r.label,
        operator: r.operator,
        value: r.value,
        negate: r.negate,
        groupLogic: r.groupLogic,
        timeframe: r.timeframe,
    }));

    const allRules = [...(strategy.entryRules || []), ...(strategy.confirmationRules || [])];
    const indicators = buildIndicatorsFromRules(allRules);

    return {
        strategyId: strategy.id,
        name: strategy.name,
        version: strategy.version,
        symbol: strategy.asset,
        timeframe: strategy.timeframes.setup,
        timeframes: {
            macro: strategy.timeframes.macro,
            structure: strategy.timeframes.structure,
            setup: strategy.timeframes.setup,
            entry: strategy.timeframes.entry,
        },
        direction: strategy.direction,
        regimeFilter: strategy.regimeFilter ?? [],
        indicators,
        entry: {
            conditions: entryConditions,
            confirmationConditions,
            direction: strategy.direction,
        },
        exit: {
            stopLoss: {
                mode: strategy.stopLoss.mode,
                atrMultiple: strategy.stopLoss.atrMultiple,
                levelOffset: strategy.stopLoss.levelOffset,
                useSwing: strategy.stopLoss.useSwing,
            },
            takeProfit: {
                mode: strategy.takeProfit.mode,
                r1: strategy.takeProfit.r1,
                r2: strategy.takeProfit.r2,
                r3: strategy.takeProfit.r3,
                fixedDistance: strategy.takeProfit.fixedDistance,
                partialCloses: strategy.takeProfit.partialCloses,
                moveBEAfterTp1: strategy.takeProfit.moveBeAfterTp1,
                lockAfterTp2: strategy.takeProfit.lockAfterTp2,
                trailingEnabled: strategy.takeProfit.trailingEnabled,
                trailingStopAtr: strategy.takeProfit.trailingStopAtr,
            },
        },
        risk: {
            mode: strategy.risk.mode,
            riskPercent: strategy.risk.riskPercent,
            fixedLot: strategy.risk.fixedLot,
            maxPositions: strategy.risk.maxPositions,
            maxDailyLossPct: strategy.risk.dailyLossLimitPct,
            maxDrawdownPct: strategy.risk.maxDrawdownPct,
        },
        filters: {
            sessions: { enabled: strategy.filters.sessions.length > 0, sessions: strategy.filters.sessions as Array<"asian" | "london" | "new_york" | "overlap"> },
            daysOfWeek: strategy.filters.daysOfWeek,
            volatilityMinAtrPct: strategy.filters.volatilityMinAtrPct,
            volatilityMaxAtrPct: strategy.filters.volatilityMaxAtrPct,
            maxTradesPerDay: strategy.filters.maxTradesPerDay,
            cooldownCandles: strategy.filters.cooldownCandles,
            spread: { enabled: false, maxSpreadPips: 0 },
            news: { enabled: false, minutesBefore: 0, minutesAfter: 0 },
        },
        executionModel: strategy.executionModel,
        costs: { ...strategy.costs },
    };
}
