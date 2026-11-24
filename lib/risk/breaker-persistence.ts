/**
 * AlgoVault — Drawdown breaker persistence.
 *
 * `evaluateDrawdownBreaker` is a pure state machine; this module makes its
 * state REAL by driving it from the authoritative equity feed (the gateway
 * heartbeat) and persisting every transition to
 * `trading_controls/{userId}/{accountKey}/drawdownBreaker`, which is the exact
 * node the Risk Engine already reads through `loadAccountRiskSnapshot`.
 *
 * What this module guarantees:
 *   • TRIPPED is persisted the moment drawdown reaches the limit, and the
 *     record survives process restarts because it lives in RTDB.
 *   • A recovered equity curve never clears a trip: the pure machine returns
 *     the latched record unchanged, and this module only ever writes what the
 *     machine returned.
 *   • Missing / zero / negative / non-finite equity writes NOTHING. A missing
 *     observation is unknown, never "no drawdown".
 *   • Writes are throttled: a new high watermark (≥1%), a state transition, or
 *     a drawdown move of ≥0.25 pp. Heartbeats every few seconds do not create
 *     a write storm.
 *   • The write is a transaction, so two concurrent heartbeats cannot race the
 *     peak or the latch.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import {
    createDrawdownBreaker,
    evaluateDrawdownBreaker,
    type DrawdownBreakerLimits,
    type DrawdownBreakerRecord,
} from "./drawdown-breaker";

/** Drawdown move (percentage points) that justifies a state write. */
const DRAWDOWN_WRITE_DELTA = 0.25;
/** Peak growth (fraction) that justifies persisting a new high watermark. */
const PEAK_WRITE_DELTA = 0.01;

export const BREAKER_PATH = (userId: string, accountKey: string) =>
    `trading_controls/${userId}/${accountKey}/drawdownBreaker`;

export type BreakerObservationOutcome =
    | {
          status: "PERSISTED";
          state: DrawdownBreakerRecord["state"];
          drawdownPercent: number | undefined;
      }
    | {
          status: "UNCHANGED";
          state: DrawdownBreakerRecord["state"] | "UNKNOWN";
          reason: string;
      };

/**
 * Pure decision: given the stored record, the configured limits and an equity
 * observation, what (if anything) should be persisted?
 *
 * Kept separate from RTDB so the persistence rules are unit-testable.
 */
export function decideBreakerPersistence(input: {
    previous: DrawdownBreakerRecord | null;
    limits: DrawdownBreakerLimits;
    equity: number | undefined;
    now: number;
}): {
    record: DrawdownBreakerRecord | null;
    shouldWrite: boolean;
    reason: string;
} {
    const { previous, limits, equity, now } = input;

    if (!(limits.maxDrawdownPercent > 0)) {
        return { record: null, shouldWrite: false, reason: "No drawdown limit configured." };
    }
    if (typeof equity !== "number" || !Number.isFinite(equity) || equity <= 0) {
        return { record: null, shouldWrite: false, reason: "Equity observation is missing or invalid." };
    }

    // A latched breaker is never rewritten from an equity observation: the only
    // way out is the explicit operator reset.
    if (previous?.state === "TRIPPED") {
        return { record: previous, shouldWrite: false, reason: "Breaker is latched; equity does not clear it." };
    }

    // A stored record with no usable peak (legacy/corrupt) cannot measure
    // drawdown. Repair the peak to the current equity and persist that repair
    // rather than silently treating the account as healthy forever.
    const peakMissing = previous !== null && !(previous.peakEquity > 0);
    const base = previous === null
        ? createDrawdownBreaker(equity, now)
        : peakMissing
          ? { ...previous, peakEquity: equity, updatedAt: now }
          : previous;
    const decision = evaluateDrawdownBreaker(base, limits, { equity, now });

    // `STATE_UNKNOWN` cannot happen with a valid equity + seeded peak, but if
    // it ever did, writing would be wrong: keep the last known state.
    if (decision.code === "STATE_UNKNOWN") {
        return { record: null, shouldWrite: false, reason: decision.reason };
    }

    const record = decision.record;
    const seeded = previous === null || peakMissing;
    const transitioned = previous !== null && previous.state !== record.state;
    const ddMoved =
        previous !== null &&
        Math.abs((previous.drawdownPercent ?? 0) - (record.drawdownPercent ?? 0)) >= DRAWDOWN_WRITE_DELTA;
    const peakGrew =
        previous !== null &&
        previous.peakEquity > 0 &&
        record.peakEquity >= previous.peakEquity * (1 + PEAK_WRITE_DELTA);

    return {
        record,
        shouldWrite: seeded || transitioned || ddMoved || peakGrew,
        reason: seeded
            ? "Seeded the breaker at the current equity peak."
            : transitioned
              ? decision.reason
              : "Observation within the write threshold.",
    };
}

async function readBreakerLimits(userId: string, accountKey: string): Promise<DrawdownBreakerLimits | null> {
    const snap = await adminDatabase.ref(`trading_controls/${userId}/${accountKey}`).get();
    const controls = (snap.val() || {}) as Record<string, unknown>;
    const max = Number(controls.maxDrawdownPercent);
    if (!Number.isFinite(max) || max <= 0 || max > 100) return null;
    const warningRaw = Number(controls.drawdownBreakerWarningFraction);
    return {
        maxDrawdownPercent: max,
        warningFraction:
            Number.isFinite(warningRaw) && warningRaw >= 0.05 && warningRaw < 1 ? warningRaw : undefined,
    };
}

/**
 * Feed one authoritative equity observation into the persisted breaker.
 *
 * Failures are reported, never swallowed into a fake NORMAL state: a caller
 * (the heartbeat) logs them and leaves the previously persisted state intact,
 * which is the safe direction for a latched breaker.
 */
export async function observeEquityForBreaker(input: {
    userId: string;
    accountKey: string;
    equity: number | undefined;
    now?: number;
}): Promise<BreakerObservationOutcome> {
    const now = input.now ?? Date.now();
    const limits = await readBreakerLimits(input.userId, input.accountKey);
    if (!limits) {
        return { status: "UNCHANGED", state: "UNKNOWN", reason: "No drawdown limit configured." };
    }

    const ref = adminDatabase.ref(BREAKER_PATH(input.userId, input.accountKey));
    let outcome: BreakerObservationOutcome = {
        status: "UNCHANGED",
        state: "UNKNOWN",
        reason: "No observation applied.",
    };

    await ref.transaction((current) => {
        const previous = (current && typeof current === "object" ? current : null) as DrawdownBreakerRecord | null;
        const decision = decideBreakerPersistence({
            previous,
            limits,
            equity: input.equity,
            now,
        });

        if (!decision.record || !decision.shouldWrite) {
            outcome = {
                status: "UNCHANGED",
                state: decision.record?.state ?? previous?.state ?? "UNKNOWN",
                reason: decision.reason,
            };
            return undefined;
        }

        outcome = {
            status: "PERSISTED",
            state: decision.record.state,
            drawdownPercent: decision.record.drawdownPercent,
        };
        return decision.record;
    });

    return outcome;
}
