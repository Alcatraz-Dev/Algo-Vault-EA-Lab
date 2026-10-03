/**
 * Admin monitoring aggregation for AI Trading Teams (spec §22).
 *
 * Reuses existing observability primitives: the AI usage/budget records written
 * by the AIRouter (`aiUsageEvents` / `aiUsageDaily`) are the source of truth
 * for provider usage and cost — this module only adds team-run level rollups.
 */

import { getAgentMetrics, listRunIndex, listTeamEvents, type AgentMetricSnapshot } from "./database";
import { BUILTIN_TEAM_AGENTS } from "./agent-library";
import type { TeamRun } from "./types";

export interface MonitoringSnapshot {
    generatedAt: number;
    runs: {
        active: number;
        queued: number;
        completed: number;
        partial: number;
        failed: number;
        cancelled: number;
        total: number;
        avgDurationMs: number;
        successRate: number;
    };
    agents: {
        agentId: string;
        name: string;
        runs: number;
        completed: number;
        failed: number;
        errorRate: number;
        avgDurationMs: number;
        avgConfidence: number;
    }[];
    events: { type: string; count: number }[];
    recentFailures: {
        id: string;
        userId: string;
        teamName: string;
        status: string;
        startedAt: number;
        durationMs: number | null;
    }[];
    dataModes: Record<string, number>;
    notes: string[];
}

const NAME_BY_ID = new Map(BUILTIN_TEAM_AGENTS.map((a) => [a.id, a.name]));

export async function buildMonitoringSnapshot(): Promise<MonitoringSnapshot> {
    const [index, metrics, events] = await Promise.all([listRunIndex(300), getAgentMetrics(), listTeamEvents(500)]);

    const counts = { active: 0, queued: 0, completed: 0, partial: 0, failed: 0, cancelled: 0, total: index.length };
    let durationSum = 0;
    let durationCount = 0;
    const dataModes: Record<string, number> = {};
    const recentFailures: MonitoringSnapshot["recentFailures"] = [];

    for (const row of index) {
        const status = String(row.status ?? "");
        if (status === "running") counts.active += 1;
        else if (status === "queued") counts.queued += 1;
        else if (status === "completed") counts.completed += 1;
        else if (status === "partial") counts.partial += 1;
        else if (status === "failed") counts.failed += 1;
        else if (status === "cancelled") counts.cancelled += 1;

        if (typeof row.durationMs === "number" && row.durationMs > 0) {
            durationSum += row.durationMs;
            durationCount += 1;
        }
        const mode = String(row.mode ?? "live");
        dataModes[mode] = (dataModes[mode] ?? 0) + 1;

        if ((status === "failed" || status === "partial") && recentFailures.length < 10) {
            recentFailures.push({
                id: String(row.id ?? ""),
                userId: String(row.userId ?? ""),
                teamName: String(row.teamName ?? ""),
                status,
                startedAt: Number(row.startedAt ?? 0),
                durationMs: typeof row.durationMs === "number" ? row.durationMs : null,
            });
        }
    }

    const settled = counts.completed + counts.partial + counts.failed + counts.cancelled;
    const successRate = settled > 0 ? counts.completed / settled : 0;

    const agents = (Object.values(metrics) as AgentMetricSnapshot[])
        .map((m) => {
            const runs = m.runs ?? 0;
            const completed = m.completed ?? 0;
            const failed = m.failed ?? 0;
            const errorRate = runs > 0 ? failed / runs : 0;
            return {
                agentId: m.agentId,
                name: NAME_BY_ID.get(m.agentId) ?? m.agentId,
                runs,
                completed,
                failed,
                errorRate: Number(errorRate.toFixed(3)),
                avgDurationMs: runs > 0 ? Math.round((m.totalDurationMs ?? 0) / runs) : 0,
                avgConfidence: completed > 0 ? Number(((m.avgConfidenceSum ?? 0) / completed).toFixed(3)) : 0,
            };
        })
        .sort((a, b) => b.runs - a.runs);

    const eventCounts = new Map<string, number>();
    for (const event of events) {
        eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
    }

    return {
        generatedAt: Date.now(),
        runs: {
            ...counts,
            avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
            successRate: Number(successRate.toFixed(3)),
        },
        agents,
        events: Array.from(eventCounts.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count),
        recentFailures: recentFailures.sort((a, b) => b.startedAt - a.startedAt),
        dataModes,
        notes: [
            "Provider usage, token counts and estimated cost are tracked by the existing AI usage system (aiUsageEvents) under source `ai-trading-team`.",
        ],
    };
}

/** Lightweight run summary used by the admin run table. */
export type RunIndexRow = Partial<TeamRun> & { id?: string; userId?: string };
