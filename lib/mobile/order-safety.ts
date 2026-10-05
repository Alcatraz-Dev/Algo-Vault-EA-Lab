/**
 * Phase 11 — order safety gate.
 *
 * This is the one file in the mobile layer allowed to say "no" to a trade, and it
 * is pure so it can be exhaustively tested. It does not talk to a broker, does not
 * compute risk (the canonical `lib/risk/risk-engine.ts` does that), and does not
 * decide whether a market is tradable. It only answers:
 *
 *   "Given the state this client can actually see right now, is it safe to
 *    submit this order, and if not, exactly which piece of state is missing?"
 *
 * Design rule: **FAIL CLOSED.** Anything the client cannot positively verify is a
 * blocker for a live order, not a warning. A phone that lost its socket five
 * seconds ago and still shows the last price it received must not be allowed to
 * send that price to a broker.
 *
 * Paper mode is deliberately permitted to proceed under staleness — but only
 * because the caller must then label the result as cached. That decision belongs
 * to the UI, and `OrderSafetyEvaluation.warnings` carries the text it needs.
 *
 * Pure module: no I/O, no React, no broker calls.
 */

import type {
    DataFreshness,
    OrderSafetyBlocker,
    OrderSafetyEvaluation,
    ResolvedLiveOrder,
    TradingMode,
} from "./contracts";

export interface OrderSafetyInput {
    mode: TradingMode;
    /** The fully-resolved intent as the client will submit it. */
    order: ResolvedLiveOrder;
    /** Freshness of the price used to size/estimate this order. */
    freshness: DataFreshness | null;
    /** Epoch ms now. Injected for determinism. */
    now: number;
    /** Age of the quote, in ms. `null` when unknown. */
    quoteAgeMs?: number | null;
    /** Canonical risk engine decision, when the server already produced one. */
    riskDecision?: { approved: boolean; code: string; reason?: string } | null;
    /** Broker/terminal connectivity as last reported by the account. */
    brokerConnected?: boolean | null;
    /** Kill switch armed server-side. */
    killSwitchActive?: boolean;
    /** True only when the user explicitly acknowledged a two-step confirmation. */
    confirmed?: boolean;
}

/** Symbols the product actually supports. Keeps a typo'd symbol off the wire. */
const SYMBOL_PATTERN = /^[A-Z0-9]{2,12}(?:[.\-_/][A-Z0-9]{1,6})?$/;

/** Live orders need a quote no older than this. Deliberately strict. */
export const MAX_LIVE_QUOTE_AGE_MS = 15_000;

export const BLOCKER_MESSAGE: Record<OrderSafetyBlocker, string> = {
    STALE_MARKET_DATA: "Market data is not live. A live order cannot be submitted against stale state.",
    OFFLINE: "This device is offline.",
    UNKNOWN_FRESHNESS: "Data freshness could not be determined. Failing closed.",
    MISSING_QUOTE: "No quote is available for this symbol.",
    MISSING_ACCOUNT: "No trading account is selected.",
    ACCOUNT_IDENTITY_MISMATCH: "The selected account does not match the account this ticket was built for.",
    MISSING_SYMBOL: "No symbol is selected.",
    MISSING_QUANTITY: "No quantity is set.",
    MISSING_STOP_LOSS: "This account requires a stop loss on every entry.",
    INVALID_STOP_LOSS: "The stop loss is on the wrong side of the entry price.",
    INVALID_PRICE: "The order price is missing or invalid for this order type.",
    BROKER_NOT_CONNECTED: "The broker connection is not confirmed.",
    RISK_REJECTED: "The risk engine rejected this order.",
    KILL_SWITCH_ACTIVE: "The account kill switch is active. Trading is halted.",
};

/**
 * Evaluate whether an order may be submitted.
 *
 * `allowed` is true only when `blockers` is empty. Paper mode never produces a
 * hard blocker for staleness/connectivity — but it still produces every
 * structural blocker, because a paper order with no symbol is not a simulation,
 * it is a bug.
 */
export function evaluateOrderSafety(input: OrderSafetyInput): OrderSafetyEvaluation {
    const blockers: OrderSafetyBlocker[] = [];
    const warnings: string[] = [];
    const { order, mode, now } = input;

    // ── Structural completeness. Applies to BOTH modes: an incomplete intent is
    //    not a trade, it is a bug, and letting it through would train the user to
    //    expect fills for orders that were never coherent.
    if (!order.symbol || !SYMBOL_PATTERN.test(order.symbol)) {
        blockers.push("MISSING_SYMBOL");
    }
    if (!Number.isFinite(order.quantity ?? NaN) || (order.quantity ?? 0) <= 0) {
        blockers.push("MISSING_QUANTITY");
    }
    if (!order.accountId) {
        blockers.push("MISSING_ACCOUNT");
    }

    // ── Live-mode-only requirements.
    if (mode === "live") {
        if (order.side !== "BUY" && order.side !== "SELL") {
            blockers.push("INVALID_PRICE");
        }

        if (order.orderType === "MARKET") {
            if (!order.priceTimestamp) {
                blockers.push("MISSING_QUOTE");
            }
        } else if (!Number.isFinite(order.price ?? NaN) || (order.price ?? 0) <= 0) {
            blockers.push("INVALID_PRICE");
        }

        // ── The freshness gate. `null` means "we do not know", which is not the
        //    same as "it is fine".
        if (input.freshness === null || input.freshness === undefined) {
            blockers.push("UNKNOWN_FRESHNESS");
        } else if (input.freshness === "offline") {
            blockers.push("OFFLINE");
        } else if (input.freshness !== "live") {
            // `delayed`, `stale` and `reconnecting` all fail closed for live.
            const age = input.quoteAgeMs;
            if (typeof age === "number" && age > MAX_LIVE_QUOTE_AGE_MS) {
                blockers.push("STALE_MARKET_DATA");
            } else {
                // DELAYED/RECONNECTING without a measured age is still not live.
                blockers.push("STALE_MARKET_DATA");
            }
        }

        if (input.quoteAgeMs !== null && input.quoteAgeMs !== undefined) {
            if (input.quoteAgeMs > MAX_LIVE_QUOTE_AGE_MS) {
                if (!blockers.includes("STALE_MARKET_DATA")) blockers.push("STALE_MARKET_DATA");
            } else if (input.quoteAgeMs > MAX_LIVE_QUOTE_AGE_MS / 3) {
                warnings.push(`Quote is ${Math.round(input.quoteAgeMs / 1000)}s old.`);
            }
        }

        if (order.stopLoss === null || order.stopLoss === undefined) {
            blockers.push("MISSING_STOP_LOSS");
        } else {
            const entry = order.orderType === "MARKET" ? (order.price ?? null) : order.price;
            if (entry !== null && Number.isFinite(entry)) {
                const invalid =
                    (order.side === "BUY" && order.stopLoss >= entry) ||
                    (order.side === "SELL" && order.stopLoss <= entry);
                if (invalid) blockers.push("INVALID_STOP_LOSS");
            }
        }

        if (input.brokerConnected === false) {
            blockers.push("BROKER_NOT_CONNECTED");
        }
        if (input.brokerConnected === null || input.brokerConnected === undefined) {
            // Unconfirmed connectivity fails closed, exactly like unknown freshness.
            blockers.push("BROKER_NOT_CONNECTED");
        }
        if (input.killSwitchActive) {
            blockers.push("KILL_SWITCH_ACTIVE");
        }
        if (input.riskDecision && !input.riskDecision.approved) {
            blockers.push("RISK_REJECTED");
            if (input.riskDecision.reason) {
                warnings.push(`Risk engine: ${input.riskDecision.code} — ${input.riskDecision.reason}`);
            } else {
                warnings.push(`Risk engine: ${input.riskDecision.code}`);
            }
        }
        if (!input.confirmed) {
            warnings.push("Order has not been explicitly confirmed.");
        }
    } else {
        // ── Paper mode. Structural blockers above still apply; freshness becomes
        //    a labelled warning rather than a refusal, which is the only reason
        //    paper mode is allowed to keep working on a train.
        if (input.freshness !== "live") {
            warnings.push(
                `Paper fill will use ${input.freshness ?? "unknown"} state. This is a simulation, not a live fill.`,
            );
        }
        if (input.quoteAgeMs !== null && input.quoteAgeMs !== undefined && input.quoteAgeMs > 0) {
            warnings.push(`Quote age at submission: ${Math.round(input.quoteAgeMs / 1000)}s.`);
        }
        if (input.riskDecision && !input.riskDecision.approved) {
            warnings.push(`Risk engine rejected this order (${input.riskDecision.code}). Paper mode continues.`);
        }
    }

    if (input.killSwitchActive && mode === "paper") {
        warnings.push("Account kill switch is active.");
    }

    return {
        allowed: blockers.length === 0,
        blockers: dedupe(blockers),
        warnings,
        resolved: { ...order },
    };
}

function dedupe<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

/** Human-readable reason for the *first* blocker — what the UI puts on the button. */
export function primaryBlockerMessage(evaluation: OrderSafetyEvaluation): string | null {
    const first = evaluation.blockers[0];
    return first ? BLOCKER_MESSAGE[first] : null;
}

/**
 * How long a live ticket stays valid before the client must re-quote.
 * Short by design: a mobile ticket can sit behind a lock screen.
 */
export function ticketTtlMs(): number {
    return 10_000;
}

export function isTicketExpired(createdAt: number, now: number): boolean {
    return now - createdAt > ticketTtlMs();
}
