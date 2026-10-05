/**
 * Strategy validation (Phase 4).
 *
 * A strategy must validate BEFORE it can run in any environment. Errors are
 * explicit and actionable — e.g.
 *
 *   Strategy validation failed:
 *   Stop Loss is required for this risk model.
 */

import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { Strategy, StrategyRule } from "@/lib/strategy-lab/types";

const VALID_TIMEFRAMES: Timeframe[] = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];
const VALID_SESSIONS = ["asian", "london", "new_york", "overlap"];
const VALID_INDICATORS = ["rsi", "ema_cross", "close_vs_ema20", "atr"];

export interface ValidationIssue {
    field: string;
    message: string;
    severity: "error" | "warning";
}

export interface StrategyValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
    issues: ValidationIssue[];
}

function issue(field: string, message: string, severity: ValidationIssue["severity"]): ValidationIssue {
    return { field, message, severity };
}

/**
 * Validate a canonical strategy before it may run in backtest, replay, paper
 * or live. Returns clear, human-readable errors.
 */
export function validateStrategyDefinition(
    strategy: Strategy,
    context?: { symbol?: string; availableTimeframes?: Timeframe[] }
): StrategyValidation {
    const issues: ValidationIssue[] = [];

    // ── Identity ──
    if (!strategy.id) issues.push(issue("id", "Strategy id is required.", "error"));
    if (!strategy.name) issues.push(issue("name", "Strategy name is required.", "error"));
    if (!strategy.version) issues.push(issue("version", "Strategy version is required (strategies are versioned).", "error"));

    // ── Market ──
    const symbol = context?.symbol ?? strategy.asset;
    if (symbol && ![...SUPPORTED_SYMBOLS].includes(symbol as SupportedSymbol)) {
        issues.push(issue("asset", `Unsupported symbol: ${symbol}.`, "error"));
    }
    const tfs = strategy.timeframes;
    for (const [name, tf] of Object.entries({ macro: tfs?.macro, structure: tfs?.structure, setup: tfs?.setup, entry: tfs?.entry })) {
        if (!tf) {
            issues.push(issue(`timeframes.${name}`, `Timeframe "${name}" is required.`, "error"));
        } else if (!VALID_TIMEFRAMES.includes(tf as Timeframe)) {
            issues.push(issue(`timeframes.${name}`, `Invalid timeframe: ${tf}.`, "error"));
        } else if (context?.availableTimeframes && !context.availableTimeframes.includes(tf as Timeframe)) {
            issues.push(issue(`timeframes.${name}`, `Timeframe ${tf} is not available in the selected dataset.`, "error"));
        }
    }

    // ── Conditions ──
    const entryRules = (strategy.entryRules ?? []).filter((r) => r.enabled);
    const confirmationRules = (strategy.confirmationRules ?? []).filter((r) => r.enabled);
    if (entryRules.length === 0 && confirmationRules.length === 0) {
        issues.push(issue("entryRules", "No entry conditions defined — the strategy would trade unconditionally.", "warning"));
    }
    for (const rule of [...entryRules, ...confirmationRules]) {
        validateRule(rule, issues);
    }

    // ── Risk / SL / TP ──
    const risk = strategy.risk;
    if (!risk) {
        issues.push(issue("risk", "Risk model is required.", "error"));
    } else {
        if (risk.mode === "percent" && (!(risk.riskPercent > 0) || risk.riskPercent > 100)) {
            issues.push(issue("risk.riskPercent", "Risk percent must be > 0 and ≤ 100.", "error"));
        } else if (risk.mode === "percent" && risk.riskPercent > 5) {
            issues.push(issue("risk.riskPercent", `Risk per trade of ${risk.riskPercent}% is aggressive (recommended ≤ 2%).`, "warning"));
        }
        if (risk.mode === "fixed_lot" && !(risk.fixedLot > 0)) {
            issues.push(issue("risk.fixedLot", "Fixed lot must be > 0.", "error"));
        }
        if (risk.maxPositions < 0) {
            issues.push(issue("risk.maxPositions", "Max positions cannot be negative.", "error"));
        }
        if (risk.maxPositions === 0) {
            issues.push(issue("risk.maxPositions", "Max positions = 0 blocks every entry.", "warning"));
        }
        if (risk.dailyLossLimitPct < 0 || risk.maxDrawdownPct < 0) {
            issues.push(issue("risk", "Daily loss / drawdown limits cannot be negative.", "error"));
        }

        // SL is mandatory for percent-based risk (position size derives from it).
        const sl = strategy.stopLoss;
        if (risk.mode === "percent") {
            if (!sl) {
                issues.push(issue("stopLoss", "Stop Loss is required for this risk model.", "error"));
            } else if (sl.mode === "atr" && !(sl.atrMultiple > 0)) {
                issues.push(issue("stopLoss.atrMultiple", "Stop Loss ATR multiple must be > 0.", "error"));
            } else if (sl.mode === "level" && !(sl.levelOffset > 0)) {
                issues.push(issue("stopLoss.levelOffset", "Stop Loss level offset must be > 0.", "error"));
            }
        }
    }

    const tp = strategy.takeProfit;
    if (tp) {
        if (tp.r1 < 0 || tp.r2 < 0 || tp.r3 < 0) {
            issues.push(issue("takeProfit", "Take-profit R levels cannot be negative.", "error"));
        }
        if (tp.mode === "r" && tp.r1 === 0 && tp.r2 === 0 && tp.r3 === 0 && !tp.trailingEnabled) {
            issues.push(issue("takeProfit", "No take-profit and no trailing stop configured — exits rely only on stop loss / signals.", "warning"));
        }
        for (const p of tp.partialCloses ?? []) {
            if (p.closePercent <= 0 || p.closePercent >= 100) {
                issues.push(issue("takeProfit.partialCloses", `Partial close of ${p.closePercent}% must be between 0 and 100 (exclusive).`, "warning"));
            }
        }
        const totalPct = (tp.partialCloses ?? []).reduce((s, p) => s + p.closePercent, 0);
        if (totalPct > 100) {
            issues.push(issue("takeProfit.partialCloses", `Partial closes sum to ${totalPct}% (> 100%).`, "error"));
        }
    }

    // ── Filters ──
    const filters = strategy.filters;
    if (filters) {
        for (const s of filters.sessions ?? []) {
            if (!VALID_SESSIONS.includes(s)) {
                issues.push(issue("filters.sessions", `Invalid session: ${s}.`, "error"));
            }
        }
        for (const d of filters.daysOfWeek ?? []) {
            if (!Number.isInteger(d) || d < 0 || d > 6) {
                issues.push(issue("filters.daysOfWeek", `Invalid day of week: ${d} (expected 0–6).`, "error"));
            }
        }
        if (filters.maxTradesPerDay === 0) {
            issues.push(issue("filters.maxTradesPerDay", "Max trades per day = 0 blocks every entry.", "warning"));
        }
        if (filters.cooldownCandles < 0) {
            issues.push(issue("filters.cooldownCandles", "Cooldown cannot be negative.", "error"));
        }
        if (filters.volatilityMinAtrPct > 0 && filters.volatilityMaxAtrPct > 0 && filters.volatilityMinAtrPct > filters.volatilityMaxAtrPct) {
            issues.push(issue("filters.volatility", "Volatility minimum exceeds maximum.", "error"));
        }
    }

    // ── Execution model ──
    if (!["next_bar_open", "same_bar_close"].includes(strategy.executionModel)) {
        issues.push(issue("executionModel", `Unsupported execution model: ${String(strategy.executionModel)}.`, "error"));
    }

    // ── Costs ──
    if (strategy.costs) {
        for (const [k, v] of Object.entries(strategy.costs)) {
            if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
                issues.push(issue(`costs.${k}`, `Cost "${k}" must be a non-negative number.`, "error"));
            }
        }
    }

    const errors = issues.filter((i) => i.severity === "error").map((i) => `${i.field}: ${i.message}`);
    const warnings = issues.filter((i) => i.severity === "warning").map((i) => `${i.field}: ${i.message}`);
    return { valid: errors.length === 0, errors, warnings, issues };
}

function validateRule(rule: StrategyRule, issues: ValidationIssue[]): void {
    const where = `rule(${rule.label || rule.id})`;
    if (!rule.group) {
        issues.push(issue(where, "Rule group is required.", "error"));
    }
    if (rule.group === "indicator") {
        if (!rule.indicator) {
            issues.push(issue(where, "Indicator rule must specify which indicator (rsi | ema_cross | close_vs_ema20 | atr).", "error"));
        } else if (!VALID_INDICATORS.includes(rule.indicator)) {
            issues.push(issue(where, `Unsupported indicator: ${rule.indicator}.`, "error"));
        }
        if (rule.indicator === "rsi") {
            const v = Number(rule.value);
            if (!Number.isFinite(v) || v < 0 || v > 100) {
                issues.push(issue(where, "RSI threshold must be between 0 and 100.", "error"));
            }
        }
    }
    if (rule.timeframe && !VALID_TIMEFRAMES.includes(rule.timeframe)) {
        issues.push(issue(where, `Invalid rule timeframe: ${rule.timeframe}.`, "error"));
    }
    if (rule.operator === "gte" || rule.operator === "lte" || rule.operator === "gt" || rule.operator === "lt") {
        if (typeof rule.value !== "number") {
            issues.push(issue(where, `Operator "${rule.operator}" requires a numeric value.`, "error"));
        }
    }
}
