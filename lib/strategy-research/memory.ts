// ─────────────────────────────────────────────────────────────────────────────
// Strategy / Setup Memory integration (existing Phase-10 memory subsystem).
//
// Every evaluated candidate is remembered — survivors AND rejections. Failures
// are valuable research evidence: rejected strategies are never deleted; their
// memory record (mode RESEARCH, status INVALIDATED) carries the failure reason
// and the market regime so future missions can avoid repeating them.
//
// Records use the EXISTING SetupMemoryRecord shape and are persisted both
// mission-scoped (lineage) and in the platform-wide monitoring/setups tree via
// the existing MEMORY_PATHS convention.
// ─────────────────────────────────────────────────────────────────────────────

import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";
import { saveResearchMemoryRecord } from "./storage";
import type { ResearchCandidate, ResearchMission } from "./types";

function recordStatus(candidate: ResearchCandidate): SetupMemoryRecord["status"] {
    switch (candidate.lifecycle) {
        case "rejected":
        case "failed":
            return "INVALIDATED";
        case "survivor":
        case "incubated":
        case "forward_testing":
        case "validated":
            return "TRIGGERED";
        default:
            return "ACTIVE";
    }
}

/** Builds the deterministic Setup Memory record for one evaluated candidate. */
export function buildCandidateMemoryRecord(
    mission: ResearchMission,
    candidate: ResearchCandidate
): SetupMemoryRecord {
    const ev = candidate.evaluation;
    const conditions: SetupMemoryRecord["conditions"] = [
        { type: "compiled", matched: candidate.compilation.valid, evidence: candidate.compilation.valid ? "strategy compiled" : candidate.compilation.errors.slice(0, 2).join("; "), timestamp: candidate.createdAt },
        { type: "backtest", matched: Boolean(ev?.backtest), evidence: ev?.backtest ? `${ev.backtest.metrics.totalTrades} trades, PF ${ev.backtest.metrics.profitFactor.toFixed(2)}` : "no backtest evidence", timestamp: ev?.backtest?.executedAt },
        { type: "out_of_sample", matched: Boolean(ev?.validation), evidence: ev?.validation ? `verdict=${ev.validation.outcome.verdict}, degradation=${ev.validation.outcome.degradation.overall}` : "OOS missing", timestamp: ev?.validation?.outcome.generatedAt },
        { type: "walk_forward", matched: ev?.validation?.outcome.walkForward.stable ?? false, evidence: ev?.validation ? `windows=${ev.validation.outcome.walkForward.windows.length}, stable=${ev.validation.outcome.walkForward.stable}` : "WF missing" },
        { type: "monte_carlo", matched: (ev?.monteCarlo?.summary.simulations ?? 0) > 0, evidence: ev?.monteCarlo ? `simulations=${ev.monteCarlo.summary.simulations}` : "MC missing" },
    ];

    const notesParts = [
        `mission=${mission.id}`,
        `lifecycle=${candidate.lifecycle}`,
        candidate.score ? `researchScore=${candidate.score.total}` : null,
        candidate.rejectedReason ? `rejectedReason=${candidate.rejectedReason}` : null,
        candidate.rejectedNotes.length > 0 ? `notes=${candidate.rejectedNotes.slice(0, 2).join(" | ")}` : null,
        candidate.robustnessReport ? `robustness=${candidate.robustnessReport.status}` : null,
    ].filter(Boolean) as string[];

    const now = Date.now();
    return {
        id: candidate.id,
        setupDefinitionId: candidate.hypothesis.id,
        symbol: candidate.hypothesis.market,
        timeframe: candidate.strategy?.timeframes.setup ?? candidate.hypothesis.timeframes[0],
        mode: "RESEARCH",
        status: recordStatus(candidate),
        createdAt: candidate.createdAt,
        updatedAt: now,
        conditions,
        matchedCount: conditions.filter((c) => c?.matched).length,
        totalCount: conditions.length,
        stateHistory: [
            { state: "RESEARCH_CREATED", timestamp: candidate.createdAt, evidence: `hypothesis ${candidate.hypothesis.id}` },
            { state: candidate.lifecycle.toUpperCase(), timestamp: now, evidence: candidate.rejectedReason ?? "in progress" },
        ],
        evidenceIds: candidate.knowledgeEdges.slice(0, 10),
        links: {
            backtestId: ev?.backtest?.backtestId ?? undefined,
            researchId: mission.id,
        },
        notes: notesParts.join("; ").slice(0, 500),
    };
}

/**
 * Persists the memory record mission-scoped + into the platform setup tree.
 * Returns the record id (also stored on the candidate as memoryRecordId).
 *
 * Phase 16 §40 — before persisting, the current cross-asset context is frozen
 * onto the record (one bounded read of the stored graph; the graph is never
 * recomputed here). Capture failure is recorded as `status: UNAVAILABLE` with
 * a reason — honest absence, never a silent omission — and never blocks the
 * memory write itself.
 */
export async function persistCandidateMemory(
    mission: ResearchMission,
    candidate: ResearchCandidate
): Promise<string> {
    const base = buildCandidateMemoryRecord(mission, candidate);
    let crossAsset = base.crossAsset;
    if (!crossAsset) {
        try {
            const { captureSetupCrossAssetSnapshot } = await import("../cross-asset/service");
            crossAsset = await captureSetupCrossAssetSnapshot({ symbol: base.symbol });
        } catch {
            crossAsset = undefined;
        }
        crossAsset ??= {
            capturedAt: Date.now(),
            status: "UNAVAILABLE",
            reason: "Cross-asset snapshot capture failed for this setup.",
        };
    }
    const record: SetupMemoryRecord = { ...base, crossAsset };
    await saveResearchMemoryRecord(mission.uid, mission.id, record);
    return record.id;
}
