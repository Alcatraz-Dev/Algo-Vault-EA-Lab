// Strategy → MT5 EA Generator — deterministic validator.
//
// Validates a Strategy Lab strategy before EA generation. Rejects strategies
// that cannot be deterministically compiled into MQL5.
// ─────────────────────────────────────────────────────────────────────────────

import { Strategy } from "../types";
import { ValidationIssue } from "./types";

const UNSUPPORTED_RULE_GROUPS = new Set<string>([
    "custom",
]);

export function validateStrategyForEA(strategy: Strategy | null): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!strategy) {
        issues.push({ severity: "error", field: "strategy", message: "No strategy provided." });
        return issues;
    }

    if (!strategy.id) issues.push({ severity: "error", field: "id", message: "Strategy ID is missing." });
    if (!strategy.name || strategy.name.trim() === "") issues.push({ severity: "error", field: "name", message: "Strategy name is required." });

    if (!strategy.asset) issues.push({ severity: "error", field: "asset", message: "Symbol is required." });
    if (!strategy.timeframes) issues.push({ severity: "error", field: "timeframes", message: "Timeframe hierarchy is required." });
    else if (!strategy.timeframes.setup) issues.push({ severity: "error", field: "timeframes.setup", message: "Entry timeframe is required." });

    const entryEnabled = (strategy.entryRules || []).filter((r) => r.enabled);
    if (entryEnabled.length === 0) {
        issues.push({ severity: "error", field: "entryRules", message: "Entry logic is empty. At least one entry rule is required." });
    } else {
        for (const rule of entryEnabled) {
            if (UNSUPPORTED_RULE_GROUPS.has(rule.group) && typeof rule.value !== "string" && typeof rule.value !== "number" && !Array.isArray(rule.value)) {
                issues.push({ severity: "warning", field: `entryRules.${rule.id}`, message: `Custom rule "${rule.label}" may not translate to deterministic MQL5.` });
            }
        }
    }

    if (!strategy.stopLoss) {
        issues.push({ severity: "error", field: "stopLoss", message: "Stop Loss rule is missing." });
    } else {
        if (strategy.stopLoss.mode === "atr" && (!strategy.stopLoss.atrMultiple || strategy.stopLoss.atrMultiple <= 0)) {
            issues.push({ severity: "error", field: "stopLoss.atrMultiple", message: "ATR stop multiple must be greater than 0." });
        }
        if (strategy.stopLoss.mode === "level" && (!strategy.stopLoss.levelOffset || strategy.stopLoss.levelOffset <= 0)) {
            issues.push({ severity: "error", field: "stopLoss.levelOffset", message: "Level stop offset must be greater than 0." });
        }
    }

    if (!strategy.takeProfit) {
        issues.push({ severity: "error", field: "takeProfit", message: "Take Profit rule is missing." });
    } else {
        if (strategy.takeProfit.mode === "r") {
            if (!strategy.takeProfit.r1 || strategy.takeProfit.r1 <= 0) {
                issues.push({ severity: "error", field: "takeProfit.r1", message: "TP1 (R1) must be greater than 0." });
            }
        } else if (strategy.takeProfit.mode === "fixed") {
            if (!strategy.takeProfit.fixedDistance || strategy.takeProfit.fixedDistance <= 0) {
                issues.push({ severity: "error", field: "takeProfit.fixedDistance", message: "Fixed TP distance must be greater than 0." });
            }
        }
    }

    if (!strategy.risk) {
        issues.push({ severity: "error", field: "risk", message: "Risk configuration is missing." });
    } else {
        if (strategy.risk.mode === "percent") {
            if (strategy.risk.riskPercent === undefined || strategy.risk.riskPercent <= 0) {
                issues.push({ severity: "error", field: "risk.riskPercent", message: "Risk percent must be greater than 0." });
            } else if (strategy.risk.riskPercent > 100) {
                issues.push({ severity: "error", field: "risk.riskPercent", message: "Risk percent cannot exceed 100." });
            }
        } else if (strategy.risk.mode === "fixed_lot") {
            if (!strategy.risk.fixedLot || strategy.risk.fixedLot <= 0) {
                issues.push({ severity: "error", field: "risk.fixedLot", message: "Fixed lot must be greater than 0." });
            }
        }
        if (strategy.risk.maxPositions < 1) {
            issues.push({ severity: "error", field: "risk.maxPositions", message: "Max positions must be at least 1." });
        }
    }

    const entryRules = (strategy.entryRules || []).filter((r) => r.enabled);
    const indicatorGroups = new Set(["trend", "volatility"]);
    for (const rule of entryRules) {
        if (indicatorGroups.has(rule.group)) {
            if (!rule.timeframe && !strategy.timeframes?.setup) {
                issues.push({ severity: "warning", field: `entryRules.${rule.id}`, message: `Rule "${rule.label}" has no explicit timeframe; will use setup timeframe.` });
            }
        }
    }

    for (const rule of entryRules) {
        if (rule.group === "custom") {
            issues.push({ severity: "warning", field: `entryRules.${rule.id}`, message: `Custom rule "${rule.label}" will be included as a string condition and may not be deterministic.` });
        }
    }

    if (strategy.direction !== "long" && strategy.direction !== "short") {
        issues.push({ severity: "error", field: "direction", message: "Strategy direction must be 'long' or 'short'." });
    }

    if (strategy.costs) {
        if (strategy.costs.spreadPips < 0) issues.push({ severity: "warning", field: "costs.spreadPips", message: "Spread pips is negative." });
        if (strategy.costs.slippagePips < 0) issues.push({ severity: "warning", field: "costs.slippagePips", message: "Slippage pips is negative." });
    }

    return issues;
}

export function isEAReady(issues: ValidationIssue[]): boolean {
    return issues.filter((i) => i.severity === "error").length === 0;
}