/**
 * Structured team memory (spec §17).
 *
 * Memory stores durable, structured facts only — preferred markets/timeframes,
 * strategy preferences, validated/rejected setups, research notes and agent
 * performance metadata. Raw conversations are never stored.
 *
 * NOTE: `sanitizeMemoryUpdates` (the pure validator) lives in ./validation so
 * it can be imported without pulling in Firebase Admin. It is re-exported here.
 */

import type { AITradingTeam, TeamMemoryRecord, TeamRun } from "./types";
import { emptyMemory, getMemory, saveMemory } from "./database";

export { sanitizeMemoryUpdates } from "./validation";

const MAX_RESEARCH = 20;
const MAX_SETUPS = 30;
const MAX_PREFERENCES = 40;

function pushCapped<T>(list: T[], item: T, max: number, equals?: (a: T, b: T) => boolean): T[] {
    const filtered = equals ? list.filter((existing) => !equals(existing, item)) : list;
    return [item, ...filtered].slice(0, max);
}

/**
 * Folds a completed run into the team's memory. Safe to call repeatedly;
 * failures never affect the run itself.
 */
export async function updateMemoryAfterRun(
    uid: string,
    team: AITradingTeam,
    run: TeamRun,
): Promise<TeamMemoryRecord> {
    const existing = (await getMemory(uid, team.id)) ?? emptyMemory(uid, team.id);
    const memory: TeamMemoryRecord = { ...existing, updatedAt: Date.now() };

    // Preferences derived from the team's own configuration.
    memory.preferredMarkets = Array.from(new Set([team.config.market, ...memory.preferredMarkets])).slice(0, 12);
    memory.preferredTimeframes = Array.from(
        new Set([team.config.entryTimeframe, team.config.confirmationTimeframe, team.config.contextTimeframe, ...memory.preferredTimeframes]),
    ).slice(0, 12);

    // Setup state outcomes → validated / rejected research records.
    const setupState = run.synthesis?.setupState;
    if (setupState === "CONFIRMED" && run.synthesis) {
        memory.validatedSetups = pushCapped(
            memory.validatedSetups,
            {
                id: run.id,
                market: run.market,
                at: run.finishedAt ?? Date.now(),
                note: run.synthesis.marketContext.slice(0, 240),
            },
            MAX_SETUPS,
            (a, b) => a.id === b.id,
        );
    } else if (setupState === "INVALIDATED" && run.synthesis) {
        memory.rejectedSetups = pushCapped(
            memory.rejectedSetups,
            {
                id: run.id,
                market: run.market,
                at: run.finishedAt ?? Date.now(),
                note: (run.synthesis.researchNextStep || run.synthesis.marketContext).slice(0, 240),
            },
            MAX_SETUPS,
            (a, b) => a.id === b.id,
        );
    }

    // Research notes from the chief analyst's next step.
    if (run.synthesis?.researchNextStep) {
        memory.previousResearch = pushCapped(
            memory.previousResearch,
            {
                id: run.id,
                title: `${run.market} — ${run.synthesis.setupState}`,
                at: run.finishedAt ?? Date.now(),
                summary: run.synthesis.researchNextStep.slice(0, 300),
            },
            MAX_RESEARCH,
            (a, b) => a.id === b.id,
        );
    }

    // Agent performance metadata (rolling counters).
    const perf = { ...memory.agentPerformance };
    for (const output of Object.values(run.agentOutputs)) {
        const current = perf[output.agentId] ?? { runs: 0, completed: 0, failed: 0, avgConfidence: 0 };
        const runs = current.runs + 1;
        const completed = current.completed + (output.status === "completed" ? 1 : 0);
        const failed = current.failed + (output.status === "failed" ? 1 : 0);
        const avgConfidence =
            current.avgConfidence +
            ((output.confidence ?? 0) - current.avgConfidence) / Math.max(1, runs);
        perf[output.agentId] = { runs, completed, failed, avgConfidence: Number(avgConfidence.toFixed(3)) };
    }
    memory.agentPerformance = perf;

    // Preference keys are user-editable and bounded.
    const prefKeys = Object.keys(memory.preferences).slice(0, MAX_PREFERENCES);
    memory.preferences = prefKeys.reduce<Record<string, string | number | boolean>>((acc, key) => {
        acc[key] = memory.preferences[key];
        return acc;
    }, {});

    await saveMemory(memory);
    return memory;
}

/** Compact memory summary injected into the Chief prompt (context minimization). */
export function summarizeMemory(memory: TeamMemoryRecord | null): Record<string, unknown> | null {
    if (!memory) return null;
    return {
        preferredMarkets: memory.preferredMarkets.slice(0, 6),
        preferredTimeframes: memory.preferredTimeframes.slice(0, 6),
        strategyPreferences: memory.strategyPreferences.slice(0, 6),
        validatedSetupCount: memory.validatedSetups.length,
        rejectedSetupCount: memory.rejectedSetups.length,
        recentResearch: memory.previousResearch.slice(0, 3).map((r) => ({ title: r.title, summary: r.summary })),
        notes: memory.notes?.slice(0, 400),
    };
}

