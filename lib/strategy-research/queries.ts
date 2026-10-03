// Shared read-only queries over research results — used by the survivors API
// route AND the Workflow Logic research nodes so there is exactly one
// implementation of "research evidence lookup".

import { listCandidates, listMissions } from "./storage";

const SURVIVOR_LIFECYCLES = new Set(["survivor", "incubated", "forward_testing", "validated"]);

export interface SurvivorSummary {
    candidateId: string;
    missionId: string;
    missionName: string;
    strategyId: string | null;
    name: string;
    market: string;
    timeframe: string | null;
    direction: string;
    concepts: string[];
    lifecycle: string;
    score: { total: number; verdict: string } | null;
    backtest: { totalTrades: number; winRate: number; profitFactor: number; maxDrawdownPct: number } | null;
    outOfSample: { verdict: string; degradation: number } | null;
    memoryRecordId: string | null;
    knowledgeEdges: string[];
    forwardTestId: string | null;
    warnings: number;
    updatedAt: number;
}

/** Research survivors for a user, optionally scoped to one symbol. */
export async function listSurvivors(
    uid: string,
    opts?: { symbol?: string; limit?: number; missionLimit?: number }
): Promise<SurvivorSummary[]> {
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
    const symbol = opts?.symbol?.toUpperCase() || null;
    const missions = await listMissions(uid, Math.min(30, opts?.missionLimit ?? 30));
    const survivors: SurvivorSummary[] = [];

    for (const mission of missions) {
        if (survivors.length >= limit) break;
        const candidates = await listCandidates(uid, mission.id);
        for (const candidate of candidates) {
            if (survivors.length >= limit) break;
            if (!SURVIVOR_LIFECYCLES.has(candidate.lifecycle)) continue;
            if (symbol && candidate.hypothesis.market !== symbol) continue;
            const m = candidate.evaluation?.backtest?.metrics ?? null;
            const v = candidate.evaluation?.validation?.outcome ?? null;
            survivors.push({
                candidateId: candidate.id,
                missionId: mission.id,
                missionName: mission.name,
                strategyId: candidate.incubationStrategyId ?? candidate.strategy?.id ?? null,
                name: candidate.strategy?.name ?? "Candidate",
                market: candidate.hypothesis.market,
                timeframe: candidate.strategy?.timeframes.setup ?? null,
                direction: candidate.hypothesis.direction,
                concepts: candidate.hypothesis.concepts,
                lifecycle: candidate.lifecycle,
                score: candidate.score ? { total: candidate.score.total, verdict: candidate.score.verdict } : null,
                backtest: m
                    ? {
                          totalTrades: m.totalTrades,
                          winRate: m.winRate,
                          profitFactor: m.profitFactor,
                          maxDrawdownPct: m.maxDrawdownPct,
                      }
                    : null,
                outOfSample: v ? { verdict: v.verdict, degradation: v.degradation.overall } : null,
                memoryRecordId: candidate.memoryRecordId,
                knowledgeEdges: candidate.knowledgeEdges ?? [],
                forwardTestId: candidate.forwardTestId,
                warnings: (candidate.warnings ?? []).length,
                updatedAt: candidate.updatedAt,
            });
        }
    }
    return survivors;
}
