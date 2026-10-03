// Client-side API surface for Strategy Research. Mirrors the Strategy Lab
// client-api convention: one callApi helper (bearer token, no-store, typed
// errors) so auth/error handling matches the rest of the platform.

import type {
    ResearchCandidate,
    ResearchEvent,
    ResearchMission,
    ResearchMissionSpec,
} from "./types";

async function callApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(init?.headers ?? {}),
        },
        cache: "no-store",
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
    }
    return data;
}

export interface CandidateSummary {
    id: string;
    missionId: string;
    name: string;
    market: string;
    timeframe: string | null;
    direction: "long" | "short";
    source: "ai" | "local";
    lifecycle: ResearchCandidate["lifecycle"];
    rejectedReason: ResearchCandidate["rejectedReason"];
    rejectedNotes: string[];
    score: ResearchCandidate["score"];
    linkedTo: string | null;
    warnings: Array<{ type: string; severity: "low" | "medium" | "high"; message: string }>;
    robustness: { status: string; warnings: number } | null;
    backtest: { totalTrades: number; winRate: number; profitFactor: number; netProfit: number; maxDrawdownPct: number; returnPct: number } | null;
    outOfSample: { verdict: string; degradation: number; trades: number } | null;
    walkForward: { enabled: boolean; windows: number; stable: boolean; stabilityScore: number } | null;
    monteCarlo: { simulations: number; profitProbability: number | null; drawdownP95: number | null } | null;
    incubationStrategyId: string | null;
    forwardTestId: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface LineageEntryView {
    kind: string;
    id: string;
    label: string;
    status: "completed" | "failed" | "pending" | "skipped";
    detail?: string;
    at?: number;
}

export const strategyResearchApi = {
    listMissions: (token: string) =>
        callApi<{ missions: ResearchMission[] }>(`/api/strategy-research/missions`, token),

    createMission: (token: string, payload: { name?: string; spec: Partial<ResearchMissionSpec> }) =>
        callApi<{ mission: ResearchMission }>(`/api/strategy-research/missions`, token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    getMission: (token: string, missionId: string) =>
        callApi<{ mission: ResearchMission; events: ResearchEvent[]; knowledgeEdges: unknown[] }>(
            `/api/strategy-research/missions/${encodeURIComponent(missionId)}`,
            token
        ),

    controlMission: (token: string, missionId: string, action: "pause" | "resume" | "cancel") =>
        callApi<{ mission: ResearchMission }>(`/api/strategy-research/missions/${encodeURIComponent(missionId)}`, token, {
            method: "PATCH",
            body: JSON.stringify({ action }),
        }),

    deleteMission: (token: string, missionId: string) =>
        callApi<{ ok: boolean; id: string }>(`/api/strategy-research/missions/${encodeURIComponent(missionId)}`, token, {
            method: "DELETE",
        }),

    advance: (token: string, missionId: string, options?: { runAll?: boolean; maxUnits?: number }) =>
        callApi<{
            result: {
                missionId: string;
                status: string;
                stage: string;
                didWork: boolean;
                completed: boolean;
                message: string;
                processedCandidates?: number;
            };
            mission: ResearchMission | null;
        }>(`/api/strategy-research/missions/${encodeURIComponent(missionId)}/advance`, token, {
            method: "POST",
            body: JSON.stringify(options ?? {}),
        }),

    listCandidates: (token: string, missionId: string, opts?: { offset?: number; limit?: number; lifecycle?: string }) => {
        const params = new URLSearchParams();
        if (opts?.offset) params.set("offset", String(opts.offset));
        if (opts?.limit) params.set("limit", String(opts.limit));
        if (opts?.lifecycle) params.set("lifecycle", opts.lifecycle);
        const qs = params.toString();
        return callApi<{ candidates: CandidateSummary[]; total: number; offset: number; limit: number }>(
            `/api/strategy-research/missions/${encodeURIComponent(missionId)}/candidates${qs ? `?${qs}` : ""}`,
            token
        );
    },

    getCandidate: (token: string, missionId: string, candidateId: string, withTrades = false) =>
        callApi<{
            mission: {
                id: string;
                name: string;
                spec: ResearchMissionSpec;
                status: string;
                currentStage: string;
                lineageNote: string;
            };
            candidate: ResearchCandidate;
            lineage: LineageEntryView[];
            knowledgeEdges: Array<Record<string, unknown>>;
            events: ResearchEvent[];
            backtest: unknown;
        }>(
            `/api/strategy-research/missions/${encodeURIComponent(missionId)}/candidates/${encodeURIComponent(candidateId)}${withTrades ? "?trades=1" : ""}`,
            token
        ),

    survivors: (token: string, opts?: { symbol?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (opts?.symbol) params.set("symbol", opts.symbol);
        if (opts?.limit) params.set("limit", String(opts.limit));
        const qs = params.toString();
        return callApi<{ survivors: Array<Record<string, unknown>>; count: number }>(
            `/api/strategy-research/survivors${qs ? `?${qs}` : ""}`,
            token
        );
    },
};
