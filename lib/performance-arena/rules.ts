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

import { roundHalfAwayFromZero, plannedRiskCents, notionalCents, CENTI_LOT } from "./money";
import { dayKeyOf } from "./metrics";
import { arenaSymbolSpec, marketOfSymbol, type ArenaSymbolSpec } from "./execution";
import {
    centiLotsToLots,
    effectiveAggregateRiskPct,
    effectiveNotionalMultiple,
    instrumentEconomics,
    previewPosition,
} from "./sizing";
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

/**
 * Order intent. `open` adds risk; `reduce` removes it.
 *
 * A reduction must never be gated by a risk or sizing rule: a trader who
 * cannot flatten a losing position because "the position is too large" is
 * strictly worse off than one who can. Entry gates are therefore skipped for
 * `reduce` and only the hard safety gates (challenge state, expiry, market /
 * symbol permission, session and trading hours) still apply.
 */
export type OrderIntent = "open" | "reduce";

export interface PreTradeInput {
    attempt: ChallengeAttempt;
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    now: number;
    symbol: string;
    side?: "long" | "short";
    sizeCentiLots: number;
    stopLossMicros: number | null;
    takeProfitMicros?: number | null;
    /** Price the order would fill at, in integer micros. */
    entryPriceMicros?: number | null;
    /** Planned risk of the new position (cents) — used only in the fallback path. */
    riskCents?: number | null;
    /** Notional of the new position (cents) — used only in the fallback path. */
    notionalCents?: number | null;
    openPositions: number;
    quotePrice: number;
    /** Session derived from canonical analytics (null when market closed). */
    session: string | null;
    marketOpen: boolean;
    /** Defaults to "open". */
    intent?: OrderIntent;
    nextEventId: () => string;
}

/** The sizing solution the gate settled on, echoed back for the caller. */
export interface PreTradeSizing {
    lots: number;
    maxLots: number;
    /** True when the request exceeded a ceiling and was reduced. */
    clamped: boolean;
    notionalCents: number;
    notionalPctOfEquity: number;
    riskCents: number | null;
    riskPctOfEquity: number | null;
    stopDistancePips: number | null;
    rewardRiskRatio: number | null;
    bindingGate: string;
}

export interface PreTradeResult {
    ok: boolean;
    /** Events describing every violation (persisted as ORDER_REJECTED context). */
    violations: RuleEvent[];
    /** Non-blocking advisories surfaced alongside a successful entry. */
    advisories: RuleEvent[];
    /** Resolved sizing preview when the gate could evaluate one. */
    sizing: PreTradeSizing | null;
}

/** Calculate the absolute position's notional after applying one-way netting. */
function projectedNetExposureCents(params: {
    currentSignedExposureCents: number;
    side: "long" | "short";
    newNotionalCents: number;
}): number {
    const signedNewExposure = params.side === "long" ? params.newNotionalCents : -params.newNotionalCents;
    return Math.abs(params.currentSignedExposureCents + signedNewExposure);
}

/**
 * Replace the current symbol exposure with its post-order value in account
 * exposure. `metrics.openExposureCents` contains that symbol's absolute net
 * notional, so subtract and add back the correctly netted result.
 */
function projectedAccountExposureCents(params: {
    metrics: ChallengeMetrics;
    symbol: string;
    side: "long" | "short";
    newNotionalCents: number;
}): number {
    const symbolKey = params.symbol.toUpperCase();
    // Signed net exposure is authoritative; the absolute map is the fallback for
    // metrics snapshots written before netting was introduced.
    const currentSignedExposure =
        params.metrics.symbolNetExposureCents?.[symbolKey] ??
        (params.metrics.symbolExposureCents?.[symbolKey] ?? 0);
    const currentAbsoluteExposure = Math.abs(currentSignedExposure);
    const nextSymbolExposure = projectedNetExposureCents({
        currentSignedExposureCents: currentSignedExposure,
        side: params.side,
        newNotionalCents: params.newNotionalCents,
    });
    return Math.max(0, params.metrics.openExposureCents - currentAbsoluteExposure) + nextSymbolExposure;
}

function violation(
    ctx: EventContext,
    params: Omit<Parameters<typeof event>[1], "severity" | "blocking">
): RuleEvent {
    return event(ctx, { ...params, severity: "BREACH", blocking: true });
}

function fmtLots(lots: number): string {
    return lots.toFixed(2);
}

function pluralLots(lots: number): string {
    return `${fmtLots(lots)} lot${lots === 1 ? "" : "s"}`;
}

/**
 * Stop validity and distance, shared by the preview and the per-trade risk
 * check so both agree on what "a measurable stop" means.
 */
function stopGeometry(params: {
    side: "long" | "short";
    entryPriceMicros: number;
    stopLossMicros: number | null;
}): { valid: boolean; distanceMicros: number } {
    const { side, entryPriceMicros, stopLossMicros } = params;
    const valid =
        stopLossMicros !== null &&
        (side === "long" ? stopLossMicros < entryPriceMicros : stopLossMicros > entryPriceMicros);
    return { valid, distanceMicros: valid ? Math.abs(entryPriceMicros - (stopLossMicros as number)) : 0 };
}

/** Planned risk in cents for a concrete size — used to price the REQUESTED order. */
function requestedRiskCents(params: {
    spec: ArenaSymbolSpec;
    policy: ChallengePolicy;
    side: "long" | "short";
    entryPriceMicros: number;
    /** Null ⇒ no measurable stop, so risk cannot be priced. */
    stopDistanceMicros: number | null;
    sizeCentiLots: number;
}): number {
    const stopDistance = params.stopDistanceMicros;
    if (stopDistance === null || stopDistance <= 0 || params.sizeCentiLots <= 0) return 0;
    const econ = instrumentEconomics({
        spec: params.spec,
        policy: params.policy,
        priceMicros: params.entryPriceMicros,
    });
    const costCents = Math.max(0, roundHalfAwayFromZero((econ.costPerLotCents * params.sizeCentiLots) / CENTI_LOT));
    return plannedRiskCents({
        side: params.side,
        entryPriceMicros: params.entryPriceMicros,
        stopLossMicros:
            params.side === "long"
                ? params.entryPriceMicros - stopDistance
                : params.entryPriceMicros + stopDistance,
        sizeCentiLots: params.sizeCentiLots,
        contractSize: params.spec.contractSize,
        costCents,
    }) ?? 0;
}

/**
 * Deterministic pre-trade gate. Any violation rejects the order — the rule
 * engine, not the UI, decides what may be traded under challenge rules.
 *
 * Sizing is measured in RISK. `previewPosition` (./sizing) is the exact solve
 * the order ticket runs for its live preview, so the number shown before
 * clicking Buy and the number enforced here can never disagree — and every
 * rejection states the maximum size that *would* be accepted.
 */
export function evaluatePreTrade(input: PreTradeInput): PreTradeResult {
    const {
        attempt,
        policy,
        metrics,
        now,
        symbol,
        side = "long",
        sizeCentiLots,
        stopLossMicros,
        openPositions,
        marketOpen,
        session,
        nextEventId,
    } = input;
    const intent: OrderIntent = input.intent ?? "open";
    const isReduction = intent === "reduce";

    const violations: RuleEvent[] = [];
    const advisories: RuleEvent[] = [];
    const ectx: EventContext = { attemptId: attempt.id, now, nextEventId };
    const mk = (params: Omit<Parameters<typeof event>[1], "severity" | "blocking">) => violation(ectx, params);

    // ── Challenge state ─────────────────────────────────────────────────────
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
    const allowedSymbol =
        policy.allowedSymbols === "all" ||
        policy.allowedSymbols.map((s) => s.toUpperCase()).includes(symbol.toUpperCase());
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
        const inWindow =
            marketOpen !== false &&
            (startUtcHour < endUtcHour
                ? hour >= startUtcHour && hour < endUtcHour
                : hour >= startUtcHour || hour < endUtcHour);
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

    // ── Risk-reducing orders bypass every entry gate below ─────────────────
    // A flat or hedged book is always safer than an open one, so capacity and
    // sizing ceilings cannot block it. Recording the bypass keeps the audit
    // log honest about what was skipped and why.
    if (isReduction) {
        advisories.push(
            event(ectx, {
                ruleId: "RISK_PER_TRADE",
                type: "RISK_REDUCING_ALLOWED",
                severity: "INFO",
                currentValue: centiLotsToLots(sizeCentiLots),
                threshold: 0,
                percentageUsed: 0,
                unit: "count",
                message: `Risk-reducing ${side === "long" ? "buy" : "sell"} of ${pluralLots(centiLotsToLots(sizeCentiLots))} accepted — position size, risk and exposure limits do not apply when reducing exposure.`,
                blocking: false,
            })
        );
    }

    // ── Capacity limits (entries only) ─────────────────────────────────────
    if (!isReduction && openPositions >= policy.maxConcurrentPositions) {
        violations.push(
            mk({
                ruleId: "MAX_POSITIONS",
                type: "MAX_POSITIONS_VIOLATION",
                currentValue: openPositions,
                threshold: policy.maxConcurrentPositions,
                percentageUsed: (openPositions / policy.maxConcurrentPositions) * 100,
                unit: "count",
                message: `Max concurrent positions reached (${openPositions}/${policy.maxConcurrentPositions}). Close a position before opening another.`,
            })
        );
    }

    const today = dayKeyOf(now);
    const dayTrades = attempt.dailyTradeCounts?.[today] ?? 0;
    if (!isReduction && dayTrades >= policy.maxDailyTrades) {
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
    if (!isReduction && !alreadyActiveToday && dayCount >= policy.maxTradingDays) {
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
    const equity = Math.max(metrics.equityCents, 1);
    const lots = centiLotsToLots(sizeCentiLots);
    const spec = arenaSymbolSpec(symbol);
    const entryPriceMicros = input.entryPriceMicros ?? null;
    const symbolExposureCents = metrics.symbolExposureCents?.[symbol.toUpperCase()] ?? 0;
    const stopGeom = stopGeometry({ side, entryPriceMicros: entryPriceMicros ?? 0, stopLossMicros });
    const stopValidMicros = stopGeom.valid ? stopGeom.distanceMicros : null;

    // Signed net exposures, so a reduction is never charged for exposure it is
    // relieving. `symbolExposureCents` (absolute) is the fallback for snapshots
    // written before signed netting existed.
    const signedSymbolExposureCents =
        metrics.symbolNetExposureCents?.[symbol.toUpperCase()] ?? symbolExposureCents;

    // The same solve the order ticket previews live, so the numbers agree.
    const preview =
        spec && entryPriceMicros !== null && entryPriceMicros > 0
            ? previewPosition(
                {
                    spec,
                    policy,
                    equityCents: equity,
                    entryPriceMicros,
                    stopLossMicros,
                    takeProfitMicros: input.takeProfitMicros ?? null,
                    side,
                    currentSignedSymbolExposureCents: signedSymbolExposureCents,
                    openRiskCents: metrics.openRiskCents ?? 0,
                    currentSignedTotalExposureCents: metrics.openExposureCents,
                },
                sizeCentiLots
            )
            : null;

    if (preview && spec) {
        const maxLots = centiLotsToLots(preview.ceilings.maxCentiLots);
        const requestedCentiLots = preview.requestedCentiLots;
        const sizing: PreTradeSizing = {
            lots: preview.lots,
            maxLots,
            clamped: preview.clamped,
            notionalCents: preview.notionalCents,
            notionalPctOfEquity: preview.notionalPctOfEquity,
            riskCents: preview.riskCents,
            riskPctOfEquity: preview.riskPctOfEquity,
            stopDistancePips: preview.stopDistancePips,
            rewardRiskRatio: preview.rewardRiskRatio,
            bindingGate: preview.ceilings.bindingGate,
        };

        // ── Every ceiling rejects rather than silently resizes ────────────
        // The trader asked for a size; the gate either fills that size or
        // rejects with the largest size that would be accepted. Quietly
        // clamping would fill a different trade than the one that was clicked
        // and would leave every ceiling unenforced.
        if (!isReduction && sizeCentiLots > preview.ceilings.maxCentiLots) {
            violations.push(
                mk({
                    ruleId: "POSITION_SIZE",
                    type: "POSITION_SIZE_VIOLATION",
                    currentValue: lots,
                    threshold: maxLots,
                    percentageUsed: (lots / Math.max(maxLots, 0.0001)) * 100,
                    unit: "count",
                    message:
                        maxLots <= 0
                            ? `No ${symbol} position can be opened right now — the account has no remaining risk or exposure budget. Close or reduce a position first.`
                            : `Size ${pluralLots(lots)} exceeds the ${pluralLots(maxLots)} maximum for ${symbol} on this challenge (limited by the ${preview.ceilings.bindingGate.replace(/_/g, " ")} cap).`,
                })
            );
        }

        if (!isReduction) {
            // Aggregate open risk across every position — the guard that
            // actually protects the drawdown envelope on a leveraged book.
            const maxAggregatePct = effectiveAggregateRiskPct(policy);
            const requestedRisk = requestedRiskCents({
                spec,
                policy,
                side,
                entryPriceMicros: entryPriceMicros as number,
                stopDistanceMicros: stopValidMicros ?? 0,
                sizeCentiLots: requestedCentiLots,
            });
            const projectedRiskPct =
                stopValidMicros !== null && requestedCentiLots > 0
                    ? ((Math.max(0, metrics.openRiskCents ?? 0) + requestedRisk) / equity) * 100
                    : preview.projectedAggregateRiskPct;
            if (stopValidMicros !== null && requestedCentiLots > 0 && projectedRiskPct > maxAggregatePct + 1e-9) {
                violations.push(
                    mk({
                        ruleId: "AGGREGATE_RISK",
                        type: "AGGREGATE_RISK_VIOLATION",
                        currentValue: Math.round(projectedRiskPct * 100) / 100,
                        threshold: maxAggregatePct,
                        percentageUsed: (projectedRiskPct / Math.max(maxAggregatePct, 0.01)) * 100,
                        unit: "pct",
                        message: `Total open risk would reach ${projectedRiskPct.toFixed(2)}% of equity (limit ${maxAggregatePct}%). Maximum size for ${symbol} right now: ${pluralLots(maxLots)}.`,
                    })
                );
            }

            // Per-trade risk, measured at the size actually REQUESTED — not at
            // the clamped size, which is already inside the cap by construction.
            const riskPct =
                stopValidMicros !== null && requestedCentiLots > 0 ? (requestedRisk / equity) * 100 : null;
            if (riskPct !== null && riskPct > policy.maxRiskPerTradePct + 1e-9) {
                violations.push(
                    mk({
                        ruleId: "RISK_PER_TRADE",
                        type: "POSITION_SIZE_VIOLATION",
                        currentValue: Math.round(riskPct * 100) / 100,
                        threshold: policy.maxRiskPerTradePct,
                        percentageUsed: (riskPct / policy.maxRiskPerTradePct) * 100,
                        unit: "pct",
                        message: `This trade risks ${riskPct.toFixed(2)}% of equity (per-trade limit ${policy.maxRiskPerTradePct}%) at a ${preview.stopDistancePips?.toFixed(1) ?? "?"} pip stop. Maximum size for ${symbol}: ${pluralLots(maxLots)}.`,
                    })
                );
            } else if (riskPct !== null && riskPct >= policy.maxRiskPerTradePct * 0.8) {
                advisories.push(
                    event(ectx, {
                        ruleId: "RISK_PER_TRADE",
                        type: "RULE_WARNING",
                        severity: "WARNING",
                        currentValue: Math.round(riskPct * 100) / 100,
                        threshold: policy.maxRiskPerTradePct,
                        percentageUsed: (riskPct / policy.maxRiskPerTradePct) * 100,
                        unit: "pct",
                        message: `This position risks ${riskPct.toFixed(2)}% of equity — close to the ${policy.maxRiskPerTradePct}% per-trade limit.`,
                        blocking: false,
                    })
                );
            }

            // Keyed on stop geometry, not on preview.riskCents: a size clamped to
            // zero by another ceiling also reports null risk and must not be
            // mislabelled as a missing stop.
            if (stopValidMicros === null) {
                advisories.push(
                    event(ectx, {
                        ruleId: "RISK_PER_TRADE",
                        type: "RULE_WARNING",
                        severity: "WARNING",
                        currentValue: 0,
                        threshold: policy.maxRiskPerTradePct,
                        percentageUsed: 0,
                        unit: "pct",
                        message:
                            input.stopLossMicros === null
                                ? "No stop-loss set: per-trade risk cannot be measured, so only notional and leverage limits apply to this order."
                                : "Stop-loss is on the wrong side of the entry price, so per-trade risk cannot be measured for this order.",
                        blocking: false,
                    })
                );
            }

            // Per-instrument NET notional. A raw notional-to-equity percentage
            // is not a risk measure (25% of a $10K account is 0.02 lots of
            // EURUSD), so the ceiling is a leverage multiple and the rejection
            // names the maximum size instead of an abstract percentage.
            const notionalMultiple = effectiveNotionalMultiple(policy);
            const requestedNotionalCents =
                requestedCentiLots > 0
                    ? notionalCents({ priceMicros: entryPriceMicros as number, sizeCentiLots: requestedCentiLots, contractSize: spec.contractSize })
                    : 0;
            const projectedSymbolMultiple = projectedNetExposureCents({
                currentSignedExposureCents: signedSymbolExposureCents,
                side,
                newNotionalCents: requestedNotionalCents,
            }) / equity;
            if (projectedSymbolMultiple > notionalMultiple + 1e-9) {
                violations.push(
                    mk({
                        ruleId: "POSITION_SIZE",
                        type: "POSITION_SIZE_VIOLATION",
                        currentValue: Math.round(projectedSymbolMultiple * 100) / 100,
                        threshold: notionalMultiple,
                        percentageUsed: (projectedSymbolMultiple / notionalMultiple) * 100,
                        unit: "count",
                        message: `${symbol} exposure would reach ${projectedSymbolMultiple.toFixed(2)}× equity (limit ${notionalMultiple}×). Maximum size for ${symbol}: ${pluralLots(maxLots)}.`,
                    })
                );
            }

            // Account-wide leverage guard: existing exposure + new notional,
            // both measured at the size actually requested.
            const projectedExposure = projectedAccountExposureCents({
                metrics,
                symbol,
                side,
                newNotionalCents: requestedNotionalCents,
            });
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

            // ── Drawdown / daily-loss proximity (entries only) ────────────
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
        }

        return { ok: violations.length === 0, violations, advisories, sizing };
    }

    // ── Fallback: instrument the execution layer cannot price ──────────────
    // Reachable only for a symbol with no spec, which service.ts rejects
    // before calling the gate. Kept so the gate stays total: it can never
    // throw, and it can never silently approve.
    if (!isReduction && lots > policy.positionSizePolicy.maxSizeLots + 1e-9) {
        violations.push(
            mk({
                ruleId: "POSITION_SIZE",
                type: "POSITION_SIZE_VIOLATION",
                currentValue: lots,
                threshold: policy.positionSizePolicy.maxSizeLots,
                percentageUsed: (lots / policy.positionSizePolicy.maxSizeLots) * 100,
                unit: "count",
                message: `Position size ${pluralLots(lots)} exceeds the ${policy.positionSizePolicy.maxSizeLots} lot maximum for this challenge.`,
            })
        );
    }

    const fallbackRisk = input.riskCents ?? null;
    const fallbackNotional = input.notionalCents ?? 0;
    if (!isReduction && fallbackRisk !== null) {
        const riskPct = (fallbackRisk / equity) * 100;
        if (riskPct > policy.maxRiskPerTradePct + 1e-9) {
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
        }
    }
    if (!isReduction && fallbackNotional > 0) {
        const notionalMultiple = fallbackNotional / equity;
        const ceiling = effectiveNotionalMultiple(policy);
        if (notionalMultiple > ceiling + 1e-9) {
            violations.push(
                mk({
                    ruleId: "POSITION_SIZE",
                    type: "POSITION_SIZE_VIOLATION",
                    currentValue: Math.round(notionalMultiple * 100) / 100,
                    threshold: ceiling,
                    percentageUsed: (notionalMultiple / ceiling) * 100,
                    unit: "count",
                    message: `Position notional is ${notionalMultiple.toFixed(2)}× equity (limit ${ceiling}×).`,
                })
            );
        }
        const projectedExposure = projectedAccountExposureCents({
            metrics,
            symbol,
            side,
            newNotionalCents: fallbackNotional,
        });
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
    }

    return { ok: violations.length === 0, violations, advisories, sizing: null };
}