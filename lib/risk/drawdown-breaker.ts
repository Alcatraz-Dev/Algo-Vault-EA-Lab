/**
 * AlgoVault — stateful drawdown breaker.
 *
 * The Risk Engine's `maxDrawdownPercent` check is stateless: it rejects an order
 * while drawdown is above the limit, and stops rejecting the moment equity
 * bounces. That is not a breaker — it is a momentary filter, and it lets an
 * account re-enter immediately after the worst point of a drawdown.
 *
 * This module adds the missing state:
 *
 *   NORMAL ──(dd ≥ warning × max)──► WARNING ──(dd ≥ max)──► TRIPPED
 *      ▲                                │                      │
 *      └────────(dd below warning)──────┘                      │
 *      └──────────── explicit audited reset ───────────────────┘
 *
 * TRIPPED is LATCHED: recovering equity does not clear it. Only a human reset
 * carrying an operator id, a reason and the exact confirmation phrase returns
 * the account to NORMAL, and every transition is appended to `history`.
 *
 * Protective actions are unaffected: the Risk Engine short-circuits them before
 * any account-level check, and this module is only consulted for new entries.
 *
 * Fail closed: when a limit is configured but the observation carries neither
 * equity nor drawdown, the result is `blocked` with code STATE_UNKNOWN. Missing
 * state is never treated as "no drawdown".
 */

export type BreakerState = "NORMAL" | "WARNING" | "TRIPPED";

export interface DrawdownBreakerLimits {
    /** Hard drawdown limit, % of peak equity. */
    maxDrawdownPercent: number;
    /** Fraction of the max at which WARNING begins (default 0.75). */
    warningFraction?: number;
}

export interface BreakerTransition {
    at: number;
    from: BreakerState;
    to: BreakerState;
    reason: string;
    equity?: number;
    drawdownPercent?: number;
    actor?: string;
}

export interface DrawdownBreakerRecord {
    state: BreakerState;
    /** Highest equity observed while the breaker was active (peak reference). */
    peakEquity: number;
    initiatedAt: number;
    updatedAt: number;
    trippedAt?: number;
    tripReason?: string;
    /** Most recent observed drawdown, % of peak. */
    drawdownPercent?: number;
    resetAt?: number;
    resetBy?: string;
    resetReason?: string;
    history: BreakerTransition[];
}

export interface BreakerObservation {
    /** Current account equity. */
    equity?: number;
    /** Drawdown from peak, % (0–100). Preferred over recomputing from equity. */
    drawdownPercent?: number;
    now: number;
}

export type BreakerDecision =
    | { blocked: false; record: DrawdownBreakerRecord; code: "NORMAL" | "WARNING"; reason: string }
    | { blocked: true; record: DrawdownBreakerRecord; code: "TRIPPED" | "STATE_UNKNOWN"; reason: string };

/** Fresh breaker for an account whose peak is known (or starting equity). */
export function createDrawdownBreaker(peakEquity: number, now: number): DrawdownBreakerRecord {
    return {
        state: "NORMAL",
        peakEquity: Number.isFinite(peakEquity) && peakEquity > 0 ? peakEquity : 0,
        initiatedAt: now,
        updatedAt: now,
        history: [],
    };
}

export function evaluateDrawdownBreaker(
    previous: DrawdownBreakerRecord,
    limits: DrawdownBreakerLimits,
    observation: BreakerObservation,
): BreakerDecision {
    const now = observation.now;
    const maxDd = limits.maxDrawdownPercent;

    // A latched breaker is checked before anything else, so a caller that
    // supplies partial state can never quietly resume trading.
    if (previous.state === "TRIPPED") {
        return {
            blocked: true,
            record: previous,
            code: "TRIPPED",
            reason: previous.tripReason ?? "Drawdown breaker is latched.",
        };
    }

    if (!(maxDd > 0)) {
        // No limit configured → the breaker cannot trip. Unknown state passes
        // through only because there is nothing to enforce.
        return { blocked: false, record: { ...previous, updatedAt: now }, code: "NORMAL", reason: "No drawdown limit configured." };
    }

    const equity = typeof observation.equity === "number" && Number.isFinite(observation.equity) ? observation.equity : undefined;
    const dd =
        typeof observation.drawdownPercent === "number" && Number.isFinite(observation.drawdownPercent)
            ? Math.max(0, observation.drawdownPercent)
            : equity !== undefined && previous.peakEquity > 0
              ? Math.max(0, ((previous.peakEquity - equity) / previous.peakEquity) * 100)
              : undefined;

    if (dd === undefined) {
        return {
            blocked: true,
            record: previous,
            code: "STATE_UNKNOWN",
            reason: "Drawdown state is unknown while a drawdown limit is configured — failing closed.",
        };
    }

    const peakEquity = equity !== undefined ? Math.max(previous.peakEquity, equity) : previous.peakEquity;
    const warningFraction = clamp(limits.warningFraction ?? 0.75, 0.05, 0.99);
    const warningAt = maxDd * warningFraction;

    let state: BreakerState = previous.state;
    let reason = "Within drawdown limits.";
    if (dd >= maxDd) {
        state = "TRIPPED";
        reason = `Drawdown ${dd.toFixed(2)}% reached the ${maxDd}% breaker limit.`;
    } else if (dd >= warningAt) {
        state = "WARNING";
        reason = `Drawdown ${dd.toFixed(2)}% is past the ${warningAt.toFixed(2)}% warning threshold.`;
    } else {
        state = "NORMAL";
    }

    const transitioned = state !== previous.state;
    const record: DrawdownBreakerRecord = {
        ...previous,
        state,
        peakEquity,
        updatedAt: now,
        drawdownPercent: round(dd, 2),
        history: transitioned
            ? [
                  ...previous.history,
                  {
                      at: now,
                      from: previous.state,
                      to: state,
                      reason,
                      equity,
                      drawdownPercent: round(dd, 2),
                  },
              ]
            : previous.history,
    };
    if (state === "TRIPPED") {
        record.trippedAt = now;
        record.tripReason = reason;
    }

    if (state === "TRIPPED") {
        return { blocked: true, record, code: "TRIPPED", reason };
    }
    return { blocked: false, record, code: state, reason };
}

export const BREAKER_RESET_PHRASE = "RESET DRAWDOWN BREAKER";

export interface BreakerResetInput {
    by: string;
    reason: string;
    confirmation: string;
    now: number;
}

export type BreakerResetResult =
    | { ok: true; record: DrawdownBreakerRecord }
    | { ok: false; code: "NOT_TRIPPED" | "MISSING_ACTOR" | "MISSING_REASON" | "BAD_CONFIRMATION"; reason: string };

/**
 * Explicit, audited reset. The phrase must match exactly (after trimming and
 * collapsing whitespace); there is no code path that clears a trip silently.
 */
export function resetDrawdownBreaker(record: DrawdownBreakerRecord, input: BreakerResetInput): BreakerResetResult {
    if (record.state !== "TRIPPED") {
        return { ok: false, code: "NOT_TRIPPED", reason: "The breaker is not tripped; nothing to reset." };
    }
    if (!input.by || !input.by.trim()) {
        return { ok: false, code: "MISSING_ACTOR", reason: "A reset requires the operator id that authorized it." };
    }
    if (!input.reason || !input.reason.trim()) {
        return { ok: false, code: "MISSING_REASON", reason: "A reset requires a recorded reason." };
    }
    if (normalize(input.confirmation) !== BREAKER_RESET_PHRASE) {
        return { ok: false, code: "BAD_CONFIRMATION", reason: `Type "${BREAKER_RESET_PHRASE}" exactly to reset the breaker.` };
    }

    const transition: BreakerTransition = {
        at: input.now,
        from: "TRIPPED",
        to: "NORMAL",
        reason: `Manual reset: ${input.reason.trim()}`,
        actor: input.by.trim(),
    };
    return {
        ok: true,
        record: {
            ...record,
            state: "NORMAL",
            updatedAt: input.now,
            resetAt: input.now,
            resetBy: input.by.trim(),
            resetReason: input.reason.trim(),
            history: [...record.history, transition],
        },
    };
}

/** The latched flag consumed by the Risk Engine's AccountRiskState. */
export function breakerBlocksEntries(record: DrawdownBreakerRecord | undefined): boolean {
    return record?.state === "TRIPPED";
}

function normalize(value: string): string {
    return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}
