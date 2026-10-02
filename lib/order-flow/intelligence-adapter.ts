/**
 * Market Intelligence adapter — bridges Order Flow into the existing
 * Intelligence Layer (FACT / INTERPRETATION / LIMITATION model) and into the
 * AI signal engine's confidence pipeline.
 *
 * Hard rules preserved:
 *  • This layer NEVER replaces Smart Money / technical evidence — it merges
 *    alongside it with explicit `order_flow` source tags.
 *  • A fact is only emitted when the underlying capability is available.
 *  • Every limitation of the data class is propagated to the AI verbatim.
 */

import type { OrderFlowContext, OrderFlowEvidence } from "./types";
import type { EvidenceSource } from "@/lib/market-intelligence/ai/intelligence-layer";

/** Map order-flow evidence kind → intelligence-layer evidence source. */
export const ORDER_FLOW_SOURCE: EvidenceSource = "order_flow";

/**
 * Convert an OrderFlowContext into intelligence-layer evidence lists.
 * Returns [facts, interpretations] plus the limitations to append.
 */
export function orderFlowToIntelligence(
    ctx: OrderFlowContext | null,
): {
    facts: Array<{ source: EvidenceSource; value: string; reference?: string }>;
    interpretations: Array<{ source: EvidenceSource; value: string; reference?: string }>;
    limitations: string[];
} {
    if (!ctx) {
        return { facts: [], interpretations: [], limitations: [] };
    }

    const facts: Array<{ source: EvidenceSource; value: string; reference?: string }> = [];
    const interpretations: Array<{ source: EvidenceSource; value: string; reference?: string }> = [];

    for (const f of ctx.facts) {
        facts.push({ source: ORDER_FLOW_SOURCE, value: f.text, ...(f.sourceIds.length ? { reference: f.sourceIds.join(",") } : {}) });
    }
    for (const i of ctx.interpretations) {
        interpretations.push({ source: ORDER_FLOW_SOURCE, value: i.text, ...(i.sourceIds.length ? { reference: i.sourceIds.join(",") } : {}) });
    }

    return { facts, interpretations, limitations: [...ctx.limitations] };
}

// ── AI signal scoring ────────────────────────────────────────────────────────

export interface OrderFlowSignalScore {
    /** 0–15 raw score compatible with the confidence pipeline's orderFlow axis. */
    score: number;
    /** Detail string for ConfidenceBreakdown.orderFlow.detail. */
    detail: string;
    /** Evidence ids for traceability (records into the signal record). */
    evidenceIds: string[];
    /** Explicitly unavailable note when data cannot support scoring. */
    unavailable: boolean;
}

/**
 * Score order-flow confluence for the AI signal engine (0–15 axis).
 * Direction-relative: bullish evidence counts toward BUY, bearish toward SELL.
 * With no usable order-flow data the score is 0 and the detail says so —
 * the confidence weight for orderFlow stays user-controlled and may be 0,
 * so unavailability never silently deflates or inflates a signal.
 */
export function scoreOrderFlowForSignal(
    ctx: OrderFlowContext | null,
    direction: "BUY" | "SELL",
): OrderFlowSignalScore {
    if (!ctx) {
        return { score: 0, detail: "Order flow data unavailable", evidenceIds: [], unavailable: true };
    }

    if (!ctx.delta.available && !ctx.volumeProfile.available) {
        return {
            score: 0,
            detail: "Order flow unavailable: no trade-side classification and no volume data",
            evidenceIds: [],
            unavailable: true,
        };
    }

    let score = 0;
    const evidenceIds: string[] = [];
    const aligned = direction === "BUY" ? ctx.confluence?.bullEvidence ?? [] : ctx.confluence?.bearEvidence ?? [];
    const opposed = direction === "BUY" ? ctx.confluence?.bearEvidence ?? [] : ctx.confluence?.bullEvidence ?? [];

    // Profile position (≤4): price on the right side of POC / value area.
    if (ctx.volumeProfile.available && ctx.volumeProfile.priceRelation) {
        const rel = ctx.volumeProfile.priceRelation;
        const bullRel = rel === "above_poc";
        if ((direction === "BUY" && bullRel) || (direction === "SELL" && rel === "below_poc")) {
            score += 4;
        } else if (rel === "inside_value_area") {
            score += 1;
        }
    }

    // Delta (≤6): true delta alignment. The candle-derived ESTIMATED proxy
    // (deltaEstimated) counts at reduced weight (≤3) — directional pressure
    // evidence, never mistaken for aggressor flow.
    if (ctx.delta.available && ctx.delta.value !== null) {
        const bullDelta = ctx.delta.value > 0;
        if ((direction === "BUY" && bullDelta) || (direction === "SELL" && !bullDelta)) score += 4;
        if (ctx.delta.cumulative !== null) {
            const bullCum = ctx.delta.cumulative > 0;
            if ((direction === "BUY" && bullCum) || (direction === "SELL" && !bullCum)) score += 2;
        }
    } else if (ctx.deltaEstimated?.available && ctx.deltaEstimated.value !== null) {
        const bullDelta = ctx.deltaEstimated.value > 0;
        if ((direction === "BUY" && bullDelta) || (direction === "SELL" && !bullDelta)) score += 2;
        if (ctx.deltaEstimated.cumulative !== null) {
            const bullCum = ctx.deltaEstimated.cumulative > 0;
            if ((direction === "BUY" && bullCum) || (direction === "SELL" && !bullCum)) score += 1;
        }
    }

    // Confluence events (≤5): aligned minus opposed evidence.
    score += Math.min(5, Math.max(0, aligned.length - opposed.length));

    // Traceability: evidence ids from facts.
    for (const f of ctx.facts) evidenceIds.push(...f.sourceIds.slice(0, 2));

    const detail = [
        `OF ${ctx.confluence?.direction ?? "neutral"} (${ctx.dataQuality})`,
        ctx.volumeProfile.available ? `price ${ctx.volumeProfile.priceRelation?.replace(/_/g, " ") ?? "n/a"}` : "no profile",
        ctx.delta.available
            ? `delta ${ctx.delta.value! >= 0 ? "+" : ""}${ctx.delta.value!.toFixed(0)}`
            : ctx.deltaEstimated?.available && ctx.deltaEstimated.value !== null
                ? `est. delta ${ctx.deltaEstimated.value >= 0 ? "+" : ""}${ctx.deltaEstimated.value.toFixed(0)} (candle-direction)`
                : "no delta",
        `${aligned.length} aligned / ${opposed.length} opposed`,
    ].join("; ");

    return {
        score: Math.max(0, Math.min(15, Math.round(score))),
        detail,
        evidenceIds: [...new Set(evidenceIds)].slice(0, 8),
        unavailable: false,
    };
}

/**
 * Build the signal-explanation sections (SIGNAL / ORDER FLOW EVIDENCE /
 * CONFLICTS / LIMITATIONS) for the UI from a context.
 */
export function buildSignalExplanation(ctx: OrderFlowContext | null): {
    orderFlowEvidence: string[];
    conflicts: string[];
    limitations: string[];
    dataQuality: string;
} {
    if (!ctx) {
        return {
            orderFlowEvidence: [],
            conflicts: [],
            limitations: ["Order Flow context unavailable."],
            dataQuality: "UNAVAILABLE",
        };
    }
    return {
        orderFlowEvidence: [
            ...ctx.facts.map((f) => f.text),
            ...ctx.interpretations.map((i) => i.text),
        ],
        conflicts: ctx.confluence?.conflicts ?? [],
        limitations: ctx.limitations,
        dataQuality: ctx.dataQuality,
    };
}

/** Re-export for adapter consumers. */
export type { OrderFlowEvidence };
