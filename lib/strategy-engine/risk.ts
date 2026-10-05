/**
 * Unified risk engine (Phase 4).
 *
 * One set of risk rules evaluated identically in backtest, replay, paper and
 * (later) live. Every check produces a named, inspectable result so the debug
 * mode and decision traces can show exactly WHY an order was allowed or
 * blocked.
 *
 * Safety guards are fail-closed: stale data, invalid prices, kill switch,
 * account halt → no trading.
 */

import type { Strategy } from "@/lib/strategy-lab/types";
import type { MarketSession } from "@/lib/market-data/types";
import { portfolioSnapshot } from "./account";
import type { AccountState, OrderIntent, RiskInput, RiskLimits, RiskVerdict } from "./types";

export interface RiskCheckInput extends RiskInput {
    /** % of equity at risk if this trade hits its stop (computed by caller). */
    riskPct?: number;
}

function verdict(checks: RiskVerdict["checks"]): RiskVerdict {
    const failed = checks.filter((c) => !c.passed);
    return {
        allowed: failed.length === 0,
        reasons: failed.map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`),
        checks,
    };
}

/**
 * Evaluate every risk guard for a prospective order (or the current state
 * when no intent is given — used for account-level halt checks).
 */
export function evaluateRisk(limits: RiskLimits, input: RiskCheckInput): RiskVerdict {
    const checks: RiskVerdict["checks"] = [];
    const opening = !!input.intent && !input.intent.reduceOnly;
    const equity = input.equity > 0 ? input.equity : input.account.balance;

    // ── Account-level guards (always evaluated) ──
    checks.push({
        name: "kill_switch",
        passed: limits.killSwitch !== true,
        detail: limits.killSwitch === true ? "engaged" : undefined,
    });
    checks.push({
        name: "account_halted",
        passed: !input.account.halted,
        detail: input.account.haltReason,
    });

    if (limits.maxDataAgeMs !== undefined && input.now !== undefined && input.dataTimestamp !== undefined) {
        const age = Math.max(0, input.now - input.dataTimestamp);
        checks.push({
            name: "data_freshness",
            passed: age <= limits.maxDataAgeMs,
            detail: `${age}ms / max ${limits.maxDataAgeMs}ms`,
        });
    }

    if (limits.maxDailyLossPct !== undefined && limits.maxDailyLossPct > 0 && equity > 0) {
        const threshold = -(equity * limits.maxDailyLossPct) / 100;
        checks.push({
            name: "max_daily_loss",
            passed: input.account.dailyPnL > threshold,
            detail: `daily ${input.account.dailyPnL.toFixed(2)} / limit ${threshold.toFixed(2)}`,
        });
    }

    if (limits.maxDrawdownPct !== undefined && limits.maxDrawdownPct > 0) {
        checks.push({
            name: "max_drawdown",
            passed: input.account.drawdownPct < limits.maxDrawdownPct,
            detail: `${input.account.drawdownPct}% / limit ${limits.maxDrawdownPct}%`,
        });
    }

    if (limits.maxConsecutiveLosses !== undefined && limits.maxConsecutiveLosses > 0) {
        checks.push({
            name: "consecutive_losses",
            passed: input.account.consecutiveLosses < limits.maxConsecutiveLosses,
            detail: `${input.account.consecutiveLosses} / max ${limits.maxConsecutiveLosses}`,
        });
    }

    // ── Order-specific guards ──
    if (input.intent) {
        const qty = input.intent.quantity;
        const validQty = Number.isFinite(qty) && qty > 0;
        checks.push({ name: "valid_quantity", passed: validQty, detail: validQty ? undefined : String(qty) });

        if (input.intent.type !== "MARKET") {
            const validPrice = !!input.intent.price && Number.isFinite(input.intent.price) && input.intent.price > 0;
            checks.push({ name: "valid_price", passed: validPrice, detail: validPrice ? undefined : "limit/stop requires price" });
        }

        if (opening) {
            if (limits.maxOpenPositions !== undefined && limits.maxOpenPositions >= 0) {
                checks.push({
                    name: "max_open_positions",
                    passed: input.openPositions < limits.maxOpenPositions,
                    detail: `${input.openPositions} / max ${limits.maxOpenPositions}`,
                });
            }

            if (limits.maxExposure !== undefined && limits.maxExposure > 0) {
                checks.push({
                    name: "max_exposure",
                    passed: input.exposure < limits.maxExposure,
                    detail: `${input.exposure.toFixed(2)} / max ${limits.maxExposure}`,
                });
            }

            if (limits.maxRiskPerTradePct !== undefined && limits.maxRiskPerTradePct > 0 && input.riskPct !== undefined) {
                checks.push({
                    name: "max_risk_per_trade",
                    passed: input.riskPct <= limits.maxRiskPerTradePct,
                    detail: `${input.riskPct.toFixed(3)}% / max ${limits.maxRiskPerTradePct}%`,
                });
            }

            if (limits.allowedSessions && limits.allowedSessions.length > 0 && input.session) {
                checks.push({
                    name: "session_restriction",
                    passed: limits.allowedSessions.includes(input.session),
                    detail: input.session,
                });
            }

            if (limits.maxSpread !== undefined && input.spread !== undefined) {
                checks.push({
                    name: "spread_guard",
                    passed: input.spread <= limits.maxSpread,
                    detail: `${input.spread} / max ${limits.maxSpread}`,
                });
            }
        }
    }

    return verdict(checks);
}

/**
 * Map the canonical strategy risk model onto engine risk limits.
 *
 * NOTE: `riskPercent` is the SIZING target, not a cap — deriving a cap from it
 * would reject every trade whose lot-step rounding rounds a hair above the
 * target. A hard per-trade cap can still be supplied via `extra`.
 */
export function riskLimitsFromStrategy(strategy: Strategy, extra?: RiskLimits): RiskLimits {
    return {
        maxDailyLossPct: strategy.risk.dailyLossLimitPct > 0 ? strategy.risk.dailyLossLimitPct : undefined,
        maxDrawdownPct: strategy.risk.maxDrawdownPct > 0 ? strategy.risk.maxDrawdownPct : undefined,
        maxOpenPositions: strategy.risk.maxPositions,
        allowedSessions: strategy.filters.sessions.length > 0 ? (strategy.filters.sessions as MarketSession[]) : undefined,
        ...extra,
    };
}

/**
 * Account-level halt evaluation (no intent): when the verdict fails, the
 * account is halted so NO further orders pass until an operator resumes it.
 */
export function evaluateAccountHalt(limits: RiskLimits, account: AccountState, openPositions: number): RiskVerdict {
    return evaluateRisk(limits, {
        account,
        openPositions,
        exposure: account.exposure,
        equity: account.equity,
        now: account.updatedAt,
    });
}

/** Convenience snapshot used by traces and UI panels. */
export function riskSnapshot(account: AccountState, openPositions: number) {
    return portfolioSnapshot(account, openPositions);
}

/** Risk % of equity for a prospective trade (stop distance × size ÷ equity). */
export function tradeRiskPct(input: {
    stopDistance: number;
    quantity: number;
    contractSize: number;
    equity: number;
}): number {
    if (input.equity <= 0) return Number.POSITIVE_INFINITY;
    const riskAmount = Math.abs(input.stopDistance) * input.quantity * input.contractSize;
    return (riskAmount / input.equity) * 100;
}

export type { OrderIntent };
