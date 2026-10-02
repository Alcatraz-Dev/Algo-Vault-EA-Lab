/**
 * Order-flow event scoring for AI signals — the SAME absorption / exhaustion
 * events the Pro Terminal chart draws as markers (ABSB / ABSS / EXH).
 *
 * Interpretation rules mirror the chart overlay and the order-flow confluence
 * engine (lib/order-flow/context-builder.ts#buildOrderFlowConfluence):
 *   • BUY_ABSORPTION  — buy-side pressure absorbed at a level ⇒ bearish.
 *   • SELL_ABSORPTION — sell-side pressure absorbed ⇒ bullish.
 *   • BUY_EXHAUSTION  — the up-move is running out of participation ⇒ a
 *     CONFLICT for longs (never an automatic reversal).
 *   • SELL_EXHAUSTION — mirror for the down-move.
 *
 * Events are observations, never an unconditional rule — scoring is bounded
 * and the detail strings are propagated verbatim into the signal record.
 */

import type { AbsorptionEvent, ExhaustionEvent } from "@/lib/order-flow/types";
import type { SignalDirection } from "./types";

export interface OrderFlowEventScore {
    /** Signed direction vote: positive bullish, negative bearish (≤2 in magnitude). */
    vote: number;
    /** Direction-relative score on the 0–5 event axis (see scoreOrderFlowEvents). */
    score: number;
    /** Human-readable evidence lines for reasoning / transparency. */
    evidence: string[];
    /** Conflicting observations for the chosen direction (exhaustion against it). */
    conflicts: string[];
}

/** Recent window the engine considers (matches the chart's marker density). */
const RECENT_WINDOW = 4;

/**
 * Direction-relative event score on the 0–5 axis:
 *   • each aligned absorption ≤2 each, capped 4;
 *   • aligned-vs-conflicting exhaustion balance ≤1;
 *   • exhaustion AGAINST the direction is reported as a conflict and never
 *     adds score.
 */
export function scoreOrderFlowEvents(
    absorptionEvents: ReadonlyArray<AbsorptionEvent | { type: string; price: number }>,
    exhaustionEvents: ReadonlyArray<ExhaustionEvent | { type: string; price: number }>,
    direction: SignalDirection
): OrderFlowEventScore {
    const long = direction === "BUY";
    let score = 0;
    let vote = 0;
    const evidence: string[] = [];
    const conflicts: string[] = [];

    const recentAbsorption = absorptionEvents.slice(-RECENT_WINDOW);
    for (const a of recentAbsorption) {
        // SELL_ABSORPTION = sellers were absorbed ⇒ demand dominant ⇒ bullish.
        const bullish = a.type === "SELL_ABSORPTION";
        if (bullish === long) {
            score += 2;
            evidence.push(
                `${a.type === "SELL_ABSORPTION" ? "Sell-side" : "Buy-side"} absorption at ${a.price} supports ${direction}`
            );
            vote += bullish ? 1 : -1;
        } else {
            evidence.push(
                `${a.type === "BUY_ABSORPTION" ? "Buy-side" : "Sell-side"} absorption at ${a.price} opposes ${direction}`
            );
            vote += bullish ? 1 : -1;
        }
    }

    const recentExhaustion = exhaustionEvents.slice(-RECENT_WINDOW);
    let alignedExhaustion = 0;
    let opposedExhaustion = 0;
    for (const e of recentExhaustion) {
        // BUY_EXHAUSTION = up-move exhausting ⇒ conflict for longs, tailwind for shorts.
        const exhaustiveBullish = e.type === "BUY_EXHAUSTION";
        if (exhaustiveBullish === long) {
            opposedExhaustion += 1;
            conflicts.push(
                `${e.type === "BUY_EXHAUSTION" ? "Up-move" : "Down-move"} exhaustion evidence at ${e.price} — reduce size or wait for confirmation`
            );
        } else {
            alignedExhaustion += 1;
        }
    }
    if (alignedExhaustion > opposedExhaustion) {
        score += 1;
        evidence.push(`${alignedExhaustion} opposing-move exhaustion event(s)`);
    }

    return {
        vote: Math.max(-2, Math.min(2, vote)),
        score: Math.min(5, score),
        evidence,
        conflicts,
    };
}

/**
 * Unsigned direction vote derived purely from the latest events (used before
 * a direction exists). Mirrors scoreChartDirection's contract: signed number,
 * |vote| ≤ 2.
 */
export function orderFlowEventDirectionVote(
    absorptionEvents: ReadonlyArray<{ type: string; price: number }>,
    exhaustionEvents: ReadonlyArray<{ type: string; price: number }>
): number {
    let vote = 0;
    for (const a of absorptionEvents.slice(-2)) {
        vote += a.type === "SELL_ABSORPTION" ? 1 : -1;
    }
    for (const e of exhaustionEvents.slice(-2)) {
        vote += e.type === "SELL_EXHAUSTION" ? 1 : e.type === "BUY_EXHAUSTION" ? -1 : 0;
    }
    return Math.max(-2, Math.min(2, vote));
}
