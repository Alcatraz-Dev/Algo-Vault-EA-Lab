import { ConditionOperator, ConditionSource } from "../types";

/**
 * Valid source/operator catalog for declarative conditions.
 * The AI Plugin Studio and the sandbox validator use this list to accept
 * only conditions the runtime can actually resolve.
 */

export const CONDITION_SOURCES: ConditionSource[] = [
    "market.volatility.atr",
    "market.volatility.atrPercent",
    "market.volatility.rangeExpansion",
    "market.volatility.state",
    "market.regime.regime",
    "market.regime.confidence",
    "market.session.current",
    "market.quote.changePercent",
    "market.quote.spread",
    "market.structure.count",
    "market.liquidity.count",
    "market.multiTimeframe.bias",
    "risk.drawdownPercent",
    "risk.exposure",
    "risk.positionCount",
    "risk.correlatedExposure",
    "news.impact.incomingEvents",
    "news.impact.recentImpact",
];

export const CONDITION_OPERATORS: ConditionOperator[] = [
    "gt",
    "gte",
    "lt",
    "lte",
    "eq",
    "neq",
    "crossed_above",
    "crossed_below",
];

export function isValidConditionSource(source: string): boolean {
    return (CONDITION_SOURCES as string[]).includes(source);
}

export function sanitizeConditionSource(source: string): ConditionSource {
    return isValidConditionSource(source) ? (source as ConditionSource) : CONDITION_SOURCES[0];
}

export function isValidConditionOperator(operator: string): boolean {
    return (CONDITION_OPERATORS as string[]).includes(operator);
}

export function sanitizeConditionOperator(operator: string): ConditionOperator {
    return isValidConditionOperator(operator) ? (operator as ConditionOperator) : "gt";
}