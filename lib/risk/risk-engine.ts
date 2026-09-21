/**
 * AlgoVault — Canonical Risk Engine
 *
 * Single source of truth for ORDER-INTENT risk decisions used by every
 * execution path (manual / quick orders, pro-signal dispatch, telegram
 * auto-execution, copy trading, strategy deployments).
 *
 *   Order Intent ─► canonical Risk Engine ─► APPROVED / REJECTED ─► Gateway
 *
 * The engine is PURE and DETERMINISTIC:
 *   • it never reads databases,
 *   • it never consults AI,
 *   • it never fabricates account state,
 *   • the same inputs always yield the same decision.
 *
 * Every limit and piece of account state is passed in explicitly. A rule only
 * blocks when the caller knows the limit AND the matching state — unknown
 * state / unset limits pass through honestly (absence of data is reported in
 * the decision, never synthesized into a fake number).
 *
 * Protective management actions (close / partial close / modify) are ALWAYS
 * approved — blocking a protective exit would weaken safety.
 *
 * Same-bar SL/TP ambiguity resolves conservatively (SL checked first), the
 * same policy as the canonical Strategy Lab backtest engine.
 */

import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import type { SupportedSymbol } from "@/lib/market-data/types";

export type OrderDirection = "BUY" | "SELL";

export type OrderEntryKind = "MARKET" | "LIMIT" | "STOP";

export interface OrderIntent {
    symbol: string;
    direction: OrderDirection;
    entryKind: OrderEntryKind;
    /** Entry price. 0 for MARKET entries (unknown until execution). */
    price: number;
    /** Proposed volume in lots. When omitted, the engine sizes it from risk. */
    volume?: number;
    sl?: number | null;
    tp?: number | null;
    /** True for protective/management actions — the engine always approves. */
    protective?: boolean;
}

export interface SymbolRiskSpec {
    pipSize: number;
    contractSize: number;
}

export interface BrokerLimits {
    minLot?: number;
    maxLot?: number;
    lotStep?: number;
}

export interface RiskLimits extends BrokerLimits {
    /** Block all new entries while market-closing protection is active. */
    emergencyStop?: boolean;
    /** Max permissible realized loss today, in % of balance. */
    maxDailyLossPercent?: number;
    /** Max permissible drawdown, in % of balance. */
    maxDrawdownPercent?: number;
    /** Max concurrent open positions on the account. */
    maxOpenPositions?: number;
    /** Max open lots on the same symbol. */
    maxSymbolExposureLots?: number;
    /** Entries must carry a Stop Loss. */
    requireStopLoss?: boolean;
    /** MARKET entries may be disallowed by policy. */
    allowMarketEntries?: boolean;
    /** Minimum seconds between orders. */
    cooldownSeconds?: number;
    /** % of balance risked per trade when sizing volume. */
    riskPercent?: number;
    /** Fallback volume when neither volume nor risk sizing applies. */
    defaultLot?: number;
}

export interface AccountRiskState {
    balance?: number;
    openPositionsCount?: number;
    /** Open lots on the intent's symbol. */
    symbolExposureLots?: number;
    /** Negative / positive realized result today (% of balance already lost). */
    dailyLossPercent?: number;
    drawdownPercent?: number;
    lastTradeAt?: number;
}

export type RiskDecisionCode =
    | "APPROVED"
    | "EMERGENCY_STOP"
    | "INVALID_VOLUME"
    | "VOLUME_TOO_SMALL"
    | "VOLUME_TOO_LARGE"
    | "LOT_STEP_MISMATCH"
    | "SL_REQUIRED"
    | "INVALID_SL"
    | "INVALID_TP"
    | "MARKET_ENTRY_DISABLED"
    | "COOLDOWN_ACTIVE"
    | "DAILY_LOSS_LIMIT"
    | "MAX_DRAWDOWN"
    | "MAX_OPEN_POSITIONS"
    | "SYMBOL_EXPOSURE_LIMIT"
    | "NO_RISK_FUNDS";

export interface RiskDecision {
    approved: boolean;
    code: RiskDecisionCode;
    reason?: string;
    /** Final volume (clamped + stepped) when approved. */
    volume?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume helpers
// ─────────────────────────────────────────────────────────────────────────────

export function symbolRiskSpec(symbol: string): SymbolRiskSpec {
    const spec = getSymbolSpec(symbol);
    return {
        pipSize: spec?.pipSize ?? 0.01,
        contractSize: spec?.contractSize ?? 100,
    };
}

const DEFAULT_STEP = 0.01;
const DEFAULT_MIN_LOT = 0.01;

const SNIPPET_EPSILON = 1e-9;

/**
 * Round a raw lot value to the nearest lotStep and clamp to [minLot, maxLot].
 * Pure — never raises, never rejects; used where a cap is the established
 * semantics (e.g. copy-trading lot caps).
 */
export function normalizeVolume(
    volume: number,
    limits: BrokerLimits = {},
    spec?: SymbolRiskSpec
): number {
    if (!Number.isFinite(volume)) return Math.max(limits.minLot ?? DEFAULT_MIN_LOT, 0);
    const step = limits.lotStep ?? DEFAULT_STEP;
    let out = step > 0 ? Math.round(volume / step) * step : volume;
    out = Math.round(out * 1000000) / 1000000;
    const min = limits.minLot ?? DEFAULT_MIN_LOT;
    if (limits.maxLot && limits.maxLot > 0) {
        out = Math.min(out, limits.maxLot);
    }
    // Avoid trimming below an explicitly configured min lot: same rule as
    // broker rounds. Never below the platform floor.
    return Math.max(out, Math.min(min, DEFAULT_MIN_LOT));
}

/**
 * Risk-based position sizing: lots = riskAmount / (stopDistance × contractSize).
 * Requires a known entry reference price and SL. Returns undefined when the
 * inputs are insufficient (caller falls back to default/min lot honestly).
 */
export function sizePositionByRisk(
    intent: OrderIntent,
    limits: RiskLimits,
    state: AccountRiskState
): number | undefined {
    const spec = symbolRiskSpec(intent.symbol);
    const riskPercent = limits.riskPercent ?? 0;
    const balance = state.balance ?? 0;
    const sl = intent.sl;

    if (!(riskPercent > 0) || !(balance > 0)) return undefined;
    if (!sl || !(sl > 0)) return undefined;

    const entryRef = intent.price > 0 ? intent.price : undefined;
    if (entryRef === undefined) return undefined; // stop distance unknown

    const distance = Math.abs(entryRef - sl);
    if (!(distance > 0) || !(spec.contractSize > 0)) return undefined;

    const riskAmount = (balance * riskPercent) / 100;
    let lots = riskAmount / (distance * spec.contractSize);
    const step = limits.lotStep ?? DEFAULT_STEP;
    if (step > 0) lots = Math.round(lots / step) * step;
    lots = Math.round(lots * 1000000) / 1000000;

    const min = limits.minLot ?? DEFAULT_MIN_LOT;
    if (limits.maxLot && limits.maxLot > 0) lots = Math.min(lots, limits.maxLot);
    if (lots < min) lots = min;
    return lots;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision helpers
// ─────────────────────────────────────────────────────────────────────────────

function decided(approved: boolean, code: RiskDecisionCode, reason?: string, volume?: number): RiskDecision {
    return { approved, code, reason, volume };
}

function reject(code: RiskDecisionCode, reason: string): RiskDecision {
    return decided(false, code, reason);
}

function slValid(intent: OrderIntent): boolean {
    const sl = intent.sl;
    if (!sl || !(sl > 0)) return true; // optional unless requireStopLoss
    if (!(intent.price > 0)) return true; // can't validate without an entry reference
    if (intent.direction === "BUY") return sl < intent.price;
    return sl > intent.price;
}

function tpValid(intent: OrderIntent): boolean {
    const tp = intent.tp;
    if (!tp || !(tp > 0)) return true;
    if (!(intent.price > 0)) return true;
    if (intent.direction === "BUY") return tp > intent.price;
    return tp < intent.price;
}

function slotsReached(limit: number | undefined, value: number | undefined): boolean {
    if (limit === undefined || limit <= 0) return false;
    if (value === undefined) return false;
    return value >= limit - SNIPPET_EPSILON;
}

/**
 * Evaluate an order intent against configured limits + known account state.
 * Deterministic. Always returns a decision; volume is only present when
 * approved.
 */
export function evaluateOrder(
    intent: OrderIntent,
    limits: RiskLimits = {},
    state: AccountRiskState = {},
    now: number = Date.now()
): RiskDecision {
    // Protective/management actions are never blocked: closing or protecting
    // an existing position is always safer than leaving it unprotected.
    if (intent.protective) {
        return decided(true, "APPROVED");
    }

    // 1. Emergency stop — blocks NEW entries while active.
    if (limits.emergencyStop === true) {
        return reject("EMERGENCY_STOP", "Emergency stop is active. Cannot place new orders.");
    }

    // 2. Market-entry policy.
    if (intent.entryKind === "MARKET" && limits.allowMarketEntries === false) {
        return reject("MARKET_ENTRY_DISABLED", "Market entry execution is disabled in risk settings.");
    }

    // 3. Volume.
    let volume: number | undefined;
    if (intent.volume !== undefined) {
        const proposed = intent.volume;
        if (!Number.isFinite(proposed) || !(proposed > 0)) {
            return reject("INVALID_VOLUME", "Volume must be greater than 0.");
        }
        const spec = symbolRiskSpec(intent.symbol);
        if (limits.minLot !== undefined && proposed < limits.minLot - SNIPPET_EPSILON) {
            return reject("VOLUME_TOO_SMALL", `Minimum lot size is ${limits.minLot}.`);
        }
        if (limits.maxLot !== undefined && limits.maxLot > 0 && proposed > limits.maxLot + SNIPPET_EPSILON) {
            return reject("VOLUME_TOO_LARGE", `Maximum lot size is ${limits.maxLot}.`);
        }
        const step = limits.lotStep ?? DEFAULT_STEP;
        const aligned = step <= 0 || (Math.abs((proposed / step) - Math.round(proposed / step)) * step) < SNIPPET_EPSILON;
        if (!aligned) {
            return reject("LOT_STEP_MISMATCH", `Volume must be a multiple of ${step}.`);
        }
        volume = proposed;
    } else {
        // Size from risk when possible; fall back honestly when it isn't.
        volume = sizePositionByRisk(intent, limits, state);
        if (volume === undefined) {
            volume = limits.defaultLot ?? limits.minLot ?? DEFAULT_MIN_LOT;
            if (!(volume > 0)) {
                return reject("NO_RISK_FUNDS", "Cannot size position — no balance or stop distance available.");
            }
        }
        if (limits.maxLot && limits.maxLot > 0 && volume > limits.maxLot) {
            return reject("VOLUME_TOO_LARGE", `Maximum lot size is ${limits.maxLot}.`);
        }
    }

    // 4. Stop Loss policy + geometry.
    if (limits.requireStopLoss === true && (!intent.sl || !(intent.sl > 0))) {
        return reject("SL_REQUIRED", "Signal lacks mandatory Stop Loss.");
    }
    if (!slValid(intent)) {
        return reject("INVALID_SL", "Stop Loss is on the wrong side of the entry price.");
    }
    if (!tpValid(intent)) {
        return reject("INVALID_TP", "Take Profit is on the wrong side of the entry price.");
    }

    // 5. Account-level limits (only when both limit and state are known).
    if (slotsReached(limits.maxDailyLossPercent, state.dailyLossPercent)) {
        return reject("DAILY_LOSS_LIMIT", "Max daily loss limit reached.");
    }
    if (slotsReached(limits.maxDrawdownPercent, state.drawdownPercent)) {
        return reject("MAX_DRAWDOWN", "Max drawdown limit reached.");
    }
    if (slotsReached(limits.maxOpenPositions, state.openPositionsCount)) {
        return reject("MAX_OPEN_POSITIONS", "Max open positions limit reached.");
    }
    if (
        limits.maxSymbolExposureLots !== undefined &&
        limits.maxSymbolExposureLots > 0 &&
        (state.symbolExposureLots ?? 0) + volume > limits.maxSymbolExposureLots + SNIPPET_EPSILON
    ) {
        return reject("SYMBOL_EXPOSURE_LIMIT", `Max symbol exposure limit reached for ${intent.symbol}.`);
    }

    // 6. Cooldown.
    if (
        limits.cooldownSeconds && limits.cooldownSeconds > 0 &&
        state.lastTradeAt && state.lastTradeAt > 0 &&
        now - state.lastTradeAt < limits.cooldownSeconds * 1000
    ) {
        return reject("COOLDOWN_ACTIVE", `Trade execution cooldown active (${limits.cooldownSeconds}s).`);
    }

    return decided(true, "APPROVED", undefined, volume);
}

/** Convenience: build broker limits from an MT5-style account record. */
export function brokerLimitsFromAccount(account: Record<string, unknown>): BrokerLimits {
    const min = Number(account.minLot);
    const max = Number(account.maxLot);
    const step = Number(account.lotStep);
    const limits: BrokerLimits = {};
    if (Number.isFinite(min) && min > 0) limits.minLot = min;
    if (Number.isFinite(max) && max > 0) limits.maxLot = max;
    if (Number.isFinite(step) && step > 0) limits.lotStep = step;
    return limits;
}

export type { SupportedSymbol };