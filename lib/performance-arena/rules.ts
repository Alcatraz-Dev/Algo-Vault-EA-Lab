// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — deterministic rule engine.
//
// All challenge rules are evaluated HERE, never in React components. The
// engine emits structured RuleEvents (warning / breach / violation) with
// ruleId, severity, currentValue, threshold, percentageUsed, message and
// blocking semantics. Rule maths is pure: policy + metrics in, events out.
//
// Fail-closed data policy: BREACH-severity events are only produced when the
// metrics snapshot is FRESH. On stale data the engine downgrades to warnings
// so a market-data outage can never silently fail (or pass) a challenge.
// ─────────────────────────────────────────────────────────────────────────────

import { roundHalfAwayFromZero } from "./money";
import { dayKeyOf } from "./metrics";
import { marketOfSymbol } from "./execution";
import type {
    ChallengeAttempt,
    ChallengeMetrics,
    ChallengePolicy,
    RuleEvent,
    RuleEventType,
    RuleId,
    RuleSeverity,
} from "./types";

export interface RuleContext {
    attempt: ChallengeAttempt;
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    now: number;
    /** Monotonic id factory so events get unique ids deterministically. */
    nextEventId: () => string;
}

interface EventContext {
    attemptId: string;
    now: number;
    nextEventId: () => string;
}

function event(
    ctx: EventContext,
    params: {
        ruleId: RuleId;
        type: RuleEventType;
        severity: RuleSeverity;
        currentValue: number;
        threshold: number;
        percentageUsed: number;
        unit: RuleEvent["unit"];
        message: string;
        blocking: boolean;
    }
): RuleEvent {
    return {
        eventId: ctx.nextEventId(),
        attemptId: ctx.attemptId,
        ruleId: params.ruleId,
        type: params.type,
        severity: params.severity,
        currentValue: roundHalfAwayFromZero(params.currentValue * 100) / 100,
        threshold: roundHalfAwayFromZero(params.threshold * 100) / 100,
        percentageUsed: roundHalfAwayFromZero(params.percentageUsed * 100) / 100,
        unit: params.unit,
        message: params.message,
        timestamp: ctx.now,
        blocking: params.blocking,
    };
}

/**
 * Evaluate continuous account rules against a metrics snapshot.
 * Returns every event whose threshold is currently crossed (idempotent:
 * the caller persists only eventIds it has not stored yet).
 */
export function evaluateAccountRules(ctx: RuleContext): RuleEvent[] {
    const { policy, metrics } = ctx;
    const ectx: EventContext = { attemptId: ctx.attempt.id, now: ctx.now, nextEventId: ctx.nextEventId };
    const events: RuleEvent[] = [];
    const warnAt = policy.warningUtilizationPct;
    const fresh = metrics.dataQuality === "fresh";

    // ── Max drawdown ────────────────────────────────────────────────────────
    const ddUsed = metrics.drawdownUsedPct;
    if (ddUsed >= 100 && fresh) {
        events.push(
            event(ectx, {
                ruleId: "MAX_DRAWDOWN",
                type: "DRAWDOWN_BREACH",
                severity: "BREACH",
                currentValue: metrics.currentDrawdownPct,
                threshold: policy.maxDrawdownPct,
                percentageUsed: ddUsed,
                unit: "pct",
                message: `Maximum drawdown reached: ${metrics.currentDrawdownPct.toFixed(2)}% of ${policy.maxDrawdownMode === "trailing" ? "peak equity" : "starting balance"} (limit ${policy.maxDrawdownPct}%).`,
                blocking: true,
            })
        );
    } else if (ddUsed >= 100) {
        events.push(
            event(ectx, {
                ruleId: "MAX_DRAWDOWN",
                type: "DRAWDOWN_WARNING",
                severity: "WARNING",
                currentValue: metrics.currentDrawdownPct,
                threshold: policy.maxDrawdownPct,
                percentageUsed: ddUsed,
                unit: "pct",
                message: `Drawdown at limit on STALE data — breach confirmation paused until fresh quotes arrive.`,
                blocking: false,
            })
        );
    } else if (ddUsed >= warnAt) {
        events.push(
            event(ectx, {
                ruleId: "MAX_DRAWDOWN",
                type: "DRAWDOWN_WARNING",
                severity: "WARNING",
                currentValue: metrics.currentDrawdownPct,
                threshold: policy.maxDrawdownPct,
                percentageUsed: ddUsed,
                unit: "pct",
                message: `You have used ${ddUsed.toFixed(0)}% of the maximum drawdown allowance (${metrics.currentDrawdownPct.toFixed(2)}% of ${policy.maxDrawdownPct}%).`,
                blocking: false,
            })
        );
    }

    // ── Daily loss ──────────────────────────────────────────────────────────
    const dailyUsed = metrics.dailyLossUsedPct;
    if (dailyUsed >= 100 && fresh) {
        events.push(
            event(ectx, {
                ruleId: "DAILY_LOSS",
                type: "DAILY_LOSS_BREACH",
                severity: "BREACH",
                currentValue: Math.abs(Math.min(0, metrics.dailyPnLCcents)) / 100,
                threshold: metrics.dailyLossLimitCents / 100,
                percentageUsed: dailyUsed,
                unit: "cents",
                message: `Daily loss limit reached: ${dailyUsed.toFixed(0)}% of today's permitted loss used.`,
                blocking: true,
            })
        );
    } else if (dailyUsed >= 100) {
        events.push(
            event(ectx, {
                ruleId: "DAILY_LOSS",
                type: "DAILY_LOSS_WARNING",
                severity: "WARNING",
                currentValue: Math.abs(Math.min(0, metrics.dailyPnLCcents)) / 100,
                threshold: metrics.dailyLossLimitCents / 100,
                percentageUsed: dailyUsed,
                unit: "cents",
                message: `Daily loss at limit on STALE data — breach confirmation paused until fresh quotes arrive.`,
                blocking: false,
            })
        );
    } else if (dailyUsed >= warnAt) {
        events.push(
            event(ectx, {
                ruleId: "DAILY_LOSS",
                type: "DAILY_LOSS_WARNING",
                severity: "WARNING",
                currentValue: Math.abs(Math.min(0, metrics.dailyPnLCcents)) / 100,
                threshold: metrics.dailyLossLimitCents / 100,
                percentageUsed: dailyUsed,
                unit: "cents",
                message: `You have used ${dailyUsed.toFixed(0)}% of today's permitted loss.`,
                blocking: false,
            })
        );
    }

    // ── Profit target ───────────────────────────────────────────────────────
    if (metrics.totalReturnPct >= policy.profitTargetPct) {
        events.push(
            event(ectx, {
                ruleId: "PROFIT_TARGET",
                type: "PROFIT_TARGET_REACHED",
                severity: "INFO",
                currentValue: metrics.totalReturnPct,
                threshold: policy.profitTargetPct,
                percentageUsed: metrics.totalReturnPct > 0 ? (metrics.totalReturnPct / policy.profitTargetPct) * 100 : 0,
                unit: "pct",
                message:
                    metrics.tradingDays >= policy.minTradingDays
                        ? `Profit target reached (${metrics.totalReturnPct.toFixed(2)}% ≥ ${policy.profitTargetPct}%). Close open positions to settle.`
                        : `Profit target reached (${metrics.totalReturnPct.toFixed(2)}%), but ${policy.minTradingDays - metrics.tradingDays} more trading day(s) are required.`,
                blocking: false,
            })
        );
    } else {
        events.push(
            event(ectx, {
                ruleId: "PROFIT_TARGET",
                type: "RULE_WARNING",
                severity: "INFO",
                currentValue: metrics.totalReturnPct,
                threshold: policy.profitTargetPct,
                percentageUsed: policy.profitTargetPct > 0 ? (metrics.totalReturnPct / policy.profitTargetPct) * 100 : 0,
                unit: "pct",
                message: `You are ${metrics.distanceToTargetPct.toFixed(1)}% away from the challenge target.`,
                blocking: false,
            })
        );
    }

    // ── Minimum trading days ────────────────────────────────────────────────
    if (metrics.tradingDays >= policy.minTradingDays) {
        events.push(
            event(ectx, {
                ruleId: "MIN_TRADING_DAYS",
                type: "MIN_TRADING_DAYS_REACHED",
                severity: "INFO",
                currentValue: metrics.tradingDays,
                threshold: policy.minTradingDays,
                percentageUsed: 100,
                unit: "count",
                message: `Minimum trading days requirement met (${metrics.tradingDays}/${policy.minTradingDays}).`,
                blocking: false,
            })
        );
    } else if (metrics.tradingDays >= Math.max(1, policy.minTradingDays - 1)) {
        events.push(
            event(ectx, {
                ruleId: "MIN_TRADING_DAYS",
                type: "RULE_WARNING",
                severity: "INFO",
                currentValue: metrics.tradingDays,
                threshold: policy.minTradingDays,
                percentageUsed: (metrics.tradingDays / policy.minTradingDays) * 100,
                unit: "count",
                message: `${policy.minTradingDays - metrics.tradingDays} more trading day(s) required before this challenge can pass.`,
                blocking: false,
            })
        );
    }

    // ── Consistency ─────────────────────────────────────────────────────────
    if (
        policy.consistency.required &&
        metrics.totalPnLCents > 0 &&
        metrics.tradingDays > 0 &&
        metrics.totalReturnPct >= policy.profitTargetPct
    ) {
        // Full evaluation happens at settlement (needs per-day series); here
        // we only surface that the requirement is active.
        events.push(
            event(ectx, {
                ruleId: "CONSISTENCY",
                type: "CONSISTENCY_WARNING",
                severity: "WARNING",
                currentValue: 0,
                threshold: policy.consistency.maxSingleDayPnlSharePct,
                percentageUsed: 0,
                unit: "pct",
                message: `Consistency rule active: no single day may contribute more than ${policy.consistency.maxSingleDayPnlSharePct}% of total profit.`,
                blocking: false,
            })
        );
    }

    // ── Challenge expiry ────────────────────────────────────────────────────
    if (metrics.expired) {
        events.push(
            event(ectx, {
                ruleId: "CHALLENGE_EXPIRY",
                type: "RULE_BREACH",
                severity: "BREACH",
                currentValue: 0,
                threshold: policy.maxCalendarDays,
                percentageUsed: 100,
                unit: "count",
                message: `Challenge duration exceeded (${policy.maxCalendarDays} calendar days).`,
                blocking: true,
            })
        );
    } else if (metrics.timeRemainingMs < 24 * 60 * 60 * 1000) {
        events.push(
            event(ectx, {
                ruleId: "CHALLENGE_EXPIRY",
                type: "RULE_WARNING",
                severity: "WARNING",
                currentValue: Math.round(metrics.timeRemainingMs / (60 * 60 * 1000)),
                threshold: policy.maxCalendarDays,
                percentageUsed: 100,
                unit: "hours",
                message: `Less than 24h remaining before this challenge expires.`,
                blocking: false,
            })
        );
    }

    return events;
}

// ──────────── Pre-trade validation ───────────────────────────────────────────

export interface PreTradeInput {
    attempt: ChallengeAttempt;
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    now: number;
    symbol: string;
    sizeCentiLots: number;
    stopLossMicros: number | null;
    /** Notional of the new position at the current quote (cents). */
    notionalCents: number;
    /** Planned risk of the new position (cents), null when no stop. */
    riskCents: number | null;
    openPositions: number;
    quotePrice: number;
    /** Session derived from canonical analytics (null when market closed). */
    session: string | null;
    marketOpen: boolean;
    nextEventId: () => string;
}

export interface PreTradeResult {
    ok: boolean;
    /** Events describing every violation (persisted as ORDER_REJECTED context). */
    violations: RuleEvent[];
    /** Non-blocking advisories surfaced alongside a successful entry. */
    advisories: RuleEvent[];
}

function violation(
    ctx: EventContext,
    params: Omit<Parameters<typeof event>[1], "severity" | "blocking">
): RuleEvent {
    return event(ctx, { ...params, severity: "BREACH", blocking: true });
}

/**
 * Deterministic pre-trade gate. Any violation rejects the order — the rule
 * engine, not the UI, decides what may be traded under challenge rules.
 */
export function evaluatePreTrade(input: PreTradeInput): PreTradeResult {
    const { attempt, policy, metrics, now, symbol, sizeCentiLots, notionalCents, riskCents, openPositions, marketOpen, session, nextEventId } = input;
    const violations: RuleEvent[] = [];
    const advisories: RuleEvent[] = [];
    const ectx: EventContext = { attemptId: attempt.id, now, nextEventId };
    const mk = (params: Omit<Parameters<typeof event>[1], "severity" | "blocking">) => violation(ectx, params);

    if (attempt.status !== "ACTIVE") {
        violations.push(
            mk({
                ruleId: "CHALLENGE_EXPIRY",
                type: "RULE_BLOCKED",
                currentValue: 0,
                threshold: 1,
                percentageUsed: 100,
                unit: "count",
                message: `This challenge is ${attempt.status} — new entries are blocked.`,
            })
        );
    }

    // ── Wall-clock expiry ───────────────────────────────────────────────────
    if (now >= attempt.expiresAt) {
        violations.push(
            mk({
                ruleId: "CHALLENGE_EXPIRY",
                type: "RULE_BLOCKED",
                currentValue: 0,
                threshold: policy.maxCalendarDays,
                percentageUsed: 100,
                unit: "count",
                message: "Challenge expired — no further trading is allowed.",
            })
        );
    }

    // ── Market / symbol / session ───────────────────────────────────────────
    const market = marketOfSymbol(symbol);
    const allowedMarket = market !== null && policy.allowedMarkets.includes(market);
    const allowedSymbol = policy.allowedSymbols === "all" || policy.allowedSymbols.map((s) => s.toUpperCase()).includes(symbol.toUpperCase());
    if (!market || !allowedMarket) {
        violations.push(
            mk({
                ruleId: "MARKET_ALLOWED",
                type: "RULE_BLOCKED",
                currentValue: 0,
                threshold: policy.allowedMarkets.length,
                percentageUsed: 100,
                unit: "count",
                message: `Market "${market ?? symbol}" is not allowed in this challenge. Allowed: ${policy.allowedMarkets.join(", ")}.`,
            })
        );
    } else if (!allowedSymbol) {
        violations.push(
            mk({
                ruleId: "SYMBOL_ALLOWED",
                type: "RULE_BLOCKED",
                currentValue: 0,
                threshold: policy.allowedSymbols.length,
                percentageUsed: 100,
                unit: "count",
                message: `${symbol} is not on this challenge's allowed symbol list.`,
            })
        );
    }

    const isCryptoMarket = market === "crypto";
    if (!isCryptoMarket && policy.weekendTrading === "blocked" && marketOpen === false) {
        violations.push(
            mk({
                ruleId: "WEEKEND_TRADING",
                type: "TRADING_HOURS_VIOLATION",
                currentValue: 0,
                threshold: 1,
                percentageUsed: 100,
                unit: "count",
                message: "Market is closed (weekend) and weekend trading is blocked for this challenge.",
            })
        );
    } else if (!isCryptoMarket && marketOpen && policy.allowedSessions !== "all") {
        if (!session || session === "closed" || !policy.allowedSessions.includes(session as never)) {
            violations.push(
                mk({
                    ruleId: "SESSION_ALLOWED",
                    type: "TRADING_HOURS_VIOLATION",
                    currentValue: 0,
                    threshold: policy.allowedSessions.length,
                    percentageUsed: 100,
                    unit: "count",
                    message: `Current session (${session ?? "closed"}) is outside the allowed sessions: ${policy.allowedSessions.join(", ")}.`,
                })
            );
        }
    }

    if (!isCryptoMarket && policy.tradingHours !== "all") {
        const hour = new Date(now).getUTCHours();
        const { startUtcHour, endUtcHour } = policy.tradingHours;
        const inWindow = marketOpen !== false && (
            startUtcHour < endUtcHour
                ? hour >= startUtcHour && hour < endUtcHour
                : hour >= startUtcHour || hour < endUtcHour
        );
        if (!inWindow) {
            violations.push(
                mk({
                    ruleId: "TRADING_HOURS",
                    type: "TRADING_HOURS_VIOLATION",
                    currentValue: hour,
                    threshold: startUtcHour,
                    percentageUsed: 100,
                    unit: "hours",
                    message: `Trading hours for this challenge are ${startUtcHour}:00–${endUtcHour}:00 UTC.`,
                })
            );
        }
    }

    // ── Capacity limits ─────────────────────────────────────────────────────
    if (openPositions >= policy.maxConcurrentPositions) {
        violations.push(
            mk({
                ruleId: "MAX_POSITIONS",
                type: "MAX_POSITIONS_VIOLATION",
                currentValue: openPositions,
                threshold: policy.maxConcurrentPositions,
                percentageUsed: (openPositions / policy.maxConcurrentPositions) * 100,
                unit: "count",
                message: `Max concurrent positions reached (${openPositions}/${policy.maxConcurrentPositions}).`,
            })
        );
    }

    const today = dayKeyOf(now);
    const dayTrades = attempt.dailyTradeCounts?.[today] ?? 0;
    if (dayTrades >= policy.maxDailyTrades) {
        violations.push(
            mk({
                ruleId: "MAX_DAILY_TRADES",
                type: "RULE_BLOCKED",
                currentValue: dayTrades,
                threshold: policy.maxDailyTrades,
                percentageUsed: (dayTrades / policy.maxDailyTrades) * 100,
                unit: "count",
                message: `Daily trade limit reached (${dayTrades}/${policy.maxDailyTrades} today).`,
            })
        );
    }

    const dayCount = Object.keys(attempt.tradingDayKeys ?? {}).length;
    const alreadyActiveToday = Boolean(attempt.tradingDayKeys?.[today]);
    if (!alreadyActiveToday && dayCount >= policy.maxTradingDays) {
        violations.push(
            mk({
                ruleId: "MAX_TRADING_DAYS",
                type: "RULE_BLOCKED",
                currentValue: dayCount,
                threshold: policy.maxTradingDays,
                percentageUsed: (dayCount / policy.maxTradingDays) * 100,
                unit: "count",
                message: `Maximum trading days reached (${dayCount}/${policy.maxTradingDays}).`,
            })
        );
    }

    // ── Sizing / risk ───────────────────────────────────────────────────────
    const lots = sizeCentiLots / 100;
    if (lots > policy.positionSizePolicy.maxSizeLots + 1e-9) {
        violations.push(
            mk({
                ruleId: "POSITION_SIZE",
                type: "POSITION_SIZE_VIOLATION",
                currentValue: lots,
                threshold: policy.positionSizePolicy.maxSizeLots,
                percentageUsed: (lots / policy.positionSizePolicy.maxSizeLots) * 100,
                unit: "count",
                message: `Position size ${lots.toFixed(2)} lots exceeds the ${policy.positionSizePolicy.maxSizeLots} lot maximum for this challenge.`,
            })
        );
    }

    const equity = Math.max(metrics.equityCents, 1);
    if (riskCents !== null) {
        const riskPct = (riskCents / equity) * 100;
        if (riskPct > policy.maxRiskPerTradePct) {
            violations.push(
                mk({
                    ruleId: "RISK_PER_TRADE",
                    type: "POSITION_SIZE_VIOLATION",
                    currentValue: Math.round(riskPct * 100) / 100,
                    threshold: policy.maxRiskPerTradePct,
                    percentageUsed: (riskPct / policy.maxRiskPerTradePct) * 100,
                    unit: "pct",
                    message: `Planned risk ${riskPct.toFixed(2)}% of equity exceeds the ${policy.maxRiskPerTradePct}% per-trade limit — reduce the position size.`,
                })
            );
        } else if (riskPct >= policy.maxRiskPerTradePct * 0.8) {
            advisories.push(
                event(ectx, {
                    ruleId: "RISK_PER_TRADE",
                    type: "RULE_WARNING",
                    severity: "WARNING",
                    currentValue: Math.round(riskPct * 100) / 100,
                    threshold: policy.maxRiskPerTradePct,
                    percentageUsed: (riskPct / policy.maxRiskPerTradePct) * 100,
                    unit: "pct",
                    message: `This position would bring your estimated risk to ${riskPct.toFixed(2)}% of equity — close to the ${policy.maxRiskPerTradePct}% limit.`,
                    blocking: false,
                })
            );
        }
    } else {
        advisories.push(
            event(ectx, {
                ruleId: "RISK_PER_TRADE",
                type: "RULE_WARNING",
                severity: "WARNING",
                currentValue: 0,
                threshold: policy.maxRiskPerTradePct,
                percentageUsed: 0,
                unit: "pct",
                message: "No stop-loss set: per-trade risk cannot be measured against the challenge limit.",
                blocking: false,
            })
        );
    }

    const notionalPct = (notionalCents / equity) * 100;
    if (notionalPct > policy.maxPositionPctOfEquity) {
        violations.push(
            mk({
                ruleId: "POSITION_SIZE",
                type: "POSITION_SIZE_VIOLATION",
                currentValue: Math.round(notionalPct * 100) / 100,
                threshold: policy.maxPositionPctOfEquity,
                percentageUsed: (notionalPct / policy.maxPositionPctOfEquity) * 100,
                unit: "pct",
                message: `Position notional is ${notionalPct.toFixed(1)}% of equity (limit ${policy.maxPositionPctOfEquity}%).`,
            })
        );
    }

    // Leverage guard: existing exposure + new notional vs equity × max ratio.
    const projectedExposure = metrics.openExposureCents + notionalCents;
    const maxExposure = equity * policy.leveragePolicy.maxLeverageRatio;
    if (projectedExposure > maxExposure) {
        violations.push(
            mk({
                ruleId: "LEVERAGE",
                type: "POSITION_SIZE_VIOLATION",
                currentValue: Math.round((projectedExposure / equity) * 100) / 100,
                threshold: policy.leveragePolicy.maxLeverageRatio,
                percentageUsed: (projectedExposure / maxExposure) * 100,
                unit: "pct",
                message: `Combined exposure would be ${(projectedExposure / equity).toFixed(2)}× equity — above the ${policy.leveragePolicy.maxLeverageRatio}× leverage policy.`,
            })
        );
    }

    // ── Drawdown proximity advisory (entries near the floor) ────────────────
    if (metrics.drawdownUsedPct >= policy.warningUtilizationPct) {
        advisories.push(
            event(ectx, {
                ruleId: "MAX_DRAWDOWN",
                type: "DRAWDOWN_WARNING",
                severity: "WARNING",
                currentValue: metrics.currentDrawdownPct,
                threshold: policy.maxDrawdownPct,
                percentageUsed: metrics.drawdownUsedPct,
                unit: "pct",
                message: `Drawdown is at ${metrics.drawdownUsedPct.toFixed(0)}% of the limit — new risk will compound it.`,
                blocking: false,
            })
        );
    }

    if (metrics.dailyLossUsedPct >= policy.warningUtilizationPct) {
        advisories.push(
            event(ectx, {
                ruleId: "DAILY_LOSS",
                type: "DAILY_LOSS_WARNING",
                severity: "WARNING",
                currentValue: Math.abs(Math.min(0, metrics.dailyPnLCcents)) / 100,
                threshold: metrics.dailyLossLimitCents / 100,
                percentageUsed: metrics.dailyLossUsedPct,
                unit: "cents",
                message: `Today's loss usage is ${metrics.dailyLossUsedPct.toFixed(0)}% of the permitted amount — consider reducing exposure.`,
                blocking: false,
            })
        );
    }

    return { ok: violations.length === 0, violations, advisories };
}
