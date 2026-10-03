// ─────────────────────────────────────────────────────────────────────────────
// Strategy Incubation — survivors enter the EXISTING Strategy Lab.
//
// Incubation is a persistence hand-off, not a new system: the compiled
// strategy is saved through the Strategy Lab's own storage (saveStrategy), so
// it appears in /strategy-lab with all existing tooling (backtest, optimize,
// EA generation, forward tests).
//
// Execution safety: incubation NEVER creates a Deployment and never touches
// the execution gateway. When the mission opts into forward testing, the
// record created is a signal-only ForwardTest through the existing forward
// harness — paper/signal observation only, `executionEnabled` stays false.
// ─────────────────────────────────────────────────────────────────────────────

import { saveStrategy, saveForwardTest } from "@/lib/strategy-lab/storage";
import { createForwardTest } from "@/lib/strategy-lab/forward";
import type { ForwardTest, Strategy } from "@/lib/strategy-lab/types";
import type { ResearchCandidate, ResearchMission } from "./types";

export interface IncubationOutcome {
    ok: boolean;
    strategyId: string | null;
    forwardTestId: string | null;
    error?: string;
}

/**
 * Moves a surviving candidate into Strategy Lab incubation.
 * Idempotent: re-running returns the existing strategy id.
 */
export async function incubateCandidate(
    mission: ResearchMission,
    candidate: ResearchCandidate
): Promise<IncubationOutcome> {
    if (!candidate.strategy) {
        return { ok: false, strategyId: null, forwardTestId: null, error: "Candidate has no compiled strategy." };
    }
    if (candidate.rejectedReason) {
        return { ok: false, strategyId: null, forwardTestId: null, error: `Candidate rejected (${candidate.rejectedReason}).` };
    }

    const strategy: Strategy = {
        ...candidate.strategy,
        description:
            `${candidate.strategy.description} [Research incubation: mission ${mission.id}, candidate ${candidate.id}]`.slice(0, 500),
        updated: Date.now(),
    };

    let strategyId: string;
    try {
        strategyId = await saveStrategy(mission.uid, strategy);
    } catch (err) {
        return {
            ok: false,
            strategyId: null,
            forwardTestId: null,
            error: err instanceof Error ? err.message : "Failed to save strategy for incubation.",
        };
    }

    // Optional forward/paper observation via the EXISTING forward-test harness.
    let forwardTestId: string | null = null;
    if (mission.spec.forwardTesting && candidate.evaluation?.backtest) {
        try {
            const ft: ForwardTest = createForwardTest(
                strategy,
                candidate.hypothesis.market,
                candidate.evaluation.backtest.metrics,
                strategy.timeframes,
                "signal_only" // never paper-money execution beyond signal observation; no broker access
            );
            ft.uid = mission.uid;
            await saveForwardTest(mission.uid, ft);
            forwardTestId = ft.id;
        } catch (err) {
            // Forward test is optional — a failure must not block incubation.
            console.error("[strategy-research/incubation] forward test creation failed:", err);
        }
    }

    return { ok: true, strategyId, forwardTestId };
}
