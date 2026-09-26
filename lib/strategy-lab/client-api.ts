import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { EvolutionRun } from "@/lib/ai/strategy-lab/evolution";
import {
    AnalysisPeriod,
    BacktestResult,
    DeployMode,
    Deployment,
    ForwardTest,
    MarketAnalysisSet,
    OptimizationOutcome,
    Pattern,
    PatternRequest,
    RobustnessScore,
    Strategy,
    TimeframeHierarchy,
    ValidationOutcome,
} from "@/lib/strategy-lab/types";

export type AnalysisApiResponse = {
    analysis?: MarketAnalysisSet;
    aiSummary: { summary: string; generatedBy: string } | null;
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    coverage: import("@/lib/strategy-lab/types").DataCoverage[];
};

export type PatternsApiResponse = {
    patterns: Pattern[];
    symbol: SupportedSymbol;
    period: AnalysisPeriod;
    timeframe: Timeframe;
    savedId: string | null;
};

export type BacktestApiResponse = {
    backtest: BacktestResult;
    savedId: string;
    symbol: SupportedSymbol;
    strategyId: string;
};

export type OptimizeApiResponse = {
    optimization: OptimizationOutcome;
    savedId: string;
    symbol: SupportedSymbol;
    strategyId: string;
};

export type ValidateApiResponse = {
    validation: ValidationOutcome;
    robustness: RobustnessScore;
    savedId: string;
    symbol: SupportedSymbol;
    strategyId: string;
};

export type DeployApiResponse = {
    deployment: Deployment;
    forwardTest: ForwardTest | null;
    backtestMetrics: import("@/lib/strategy-lab/types").BacktestMetrics;
};

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
        throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
    }
    return data;
}

export const strategyLabApi = {
    analyze: (token: string, symbol: SupportedSymbol, period: AnalysisPeriod, hierarchy: TimeframeHierarchy) =>
        callApi<AnalysisApiResponse>("/api/strategy-lab/analyze", token, {
            method: "POST",
            body: JSON.stringify({ symbol, period, hierarchy }),
        }),

    patterns: (token: string, symbol: SupportedSymbol, period: AnalysisPeriod, timeframe: Timeframe, minOccurrences: number) =>
        callApi<PatternsApiResponse>("/api/strategy-lab/patterns", token, {
            method: "POST",
            body: JSON.stringify({ symbol, period, timeframe, minOccurrences } as PatternRequest),
        }),

    generateStrategy: (token: string, payload: { symbol: SupportedSymbol; period: AnalysisPeriod; pattern?: Pattern | null; direction?: "long" | "short" }) =>
        callApi<{ strategy: Strategy }>("/api/strategy-lab/strategies", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    listStrategies: (token: string) =>
        callApi<{ strategies: Strategy[] }>("/api/strategy-lab/strategies", token),

    updateStrategy: (token: string, id: string, patch: Partial<Strategy>) =>
        callApi<{ strategy: Strategy }>(`/api/strategy-lab/strategies/${id}`, token, {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),

    backtest: (token: string, payload: { symbol: SupportedSymbol; strategyId?: string; strategy?: Strategy }) =>
        callApi<BacktestApiResponse>("/api/strategy-lab/backtest", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    optimize: (token: string, payload: { symbol: SupportedSymbol; strategyId?: string; strategy?: Strategy }) =>
        callApi<OptimizeApiResponse>("/api/strategy-lab/optimize", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    validate: (token: string, payload: { symbol: SupportedSymbol; strategyId?: string; strategy?: Strategy }) =>
        callApi<ValidateApiResponse>("/api/strategy-lab/validate", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    listDeployments: (token: string) =>
        callApi<{ deployments: Deployment[] }>("/api/strategy-lab/deploy", token),

    deploy: (token: string, payload: { strategyId: string; symbol?: SupportedSymbol; mode: DeployMode; termsAccepted: boolean }) =>
        callApi<DeployApiResponse>("/api/strategy-lab/deploy", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    forwardMonitor: (token: string, payload: { forwardTestId: string; deploymentId?: string; symbol?: SupportedSymbol }) =>
        callApi<{ forwardTest: ForwardTest; newSignal: boolean; orderRequestWritten: boolean }>(
            "/api/strategy-lab/forward/monitor",
            token,
            { method: "POST", body: JSON.stringify(payload) }
        ),

    // ── Natural-language → structured draft ──────────────────────────────
    interpretStrategy: (token: string, payload: { prompt: string; symbol?: SupportedSymbol; direction?: "long" | "short"; hierarchy?: Partial<TimeframeHierarchy>; save?: boolean }) =>
        callApi<{
            success: boolean;
            draft: import("@/lib/strategy-lab/types").StrategyDraft;
            generatedBy: "ai" | "local";
            strategy?: Strategy;
            message: string;
        }>("/api/strategy-lab/interpret", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    // ── EA generation / lifecycle ─────────────────────────────────────────
    generateEA: (token: string, payload: { strategyId: string; options?: Record<string, unknown> }) =>
        callApi<{ success: boolean; eaId: string; ea: Record<string, unknown> }>("/api/strategy-lab/ea", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),

    listEAs: (token: string, limit = 50) =>
        callApi<{ eas: Array<Record<string, unknown>> }>(`/api/strategy-lab/ea?limit=${limit}`, token),

    getEA: (token: string, eaId: string, includeCode = false) =>
        callApi<{ ea: Record<string, unknown> }>(`/api/strategy-lab/ea/${eaId}?code=${includeCode ? 1 : 0}`, token),

    deleteEA: (token: string, eaId: string) =>
        callApi<{ success: boolean; eaId: string }>(`/api/strategy-lab/ea/${eaId}`, token, { method: "DELETE" }),

    compileEA: (token: string, eaId: string) =>
        callApi<{
            success: boolean;
            compiled: boolean;
            method: "metaeditor" | "static";
            errors: string[];
            warnings: string[];
            compilerOutput?: string;
            compiledAt: number;
        }>(`/api/strategy-lab/ea/${eaId}/compile`, token, { method: "POST" }),

    downloadEA: async (token: string, eaId: string): Promise<{ fileName: string; code: string }> => {
        const res = await fetch(`/api/strategy-lab/ea/${eaId}/download`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
        });
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? `Download failed (${res.status})`);
        }
        const disposition = res.headers.get("content-disposition") ?? "";
        const match = disposition.match(/filename="?([^";]+)"?/);
        const fileName = match ? match[1] : `${eaId}.mq5`;
        return { fileName, code: await res.text() };
    },

    deployEA: (token: string, eaId: string, mt5Account?: string) =>
        callApi<{
            success: boolean;
            botId: string;
            magicNumber: number;
            entitlement: { id: string; status: string; type: string };
        }>(`/api/strategy-lab/ea/${eaId}/deploy`, token, {
            method: "POST",
            body: JSON.stringify(mt5Account ? { mt5Account } : {}),
        }),

    publishEA: (token: string, eaId: string, payload?: { name?: string; description?: string; price?: number; currency?: string }) =>
        callApi<{
            success: boolean;
            productId: string;
            version: string;
            fileName: string;
            price: number;
        }>(`/api/strategy-lab/ea/${eaId}/publish`, token, {
            method: "POST",
            body: JSON.stringify(payload ?? {}),
        }),

    // ── Strategy DNA / evolution ────────────────────────────────────────────
    // Reuses `callApi`, so auth, error propagation and cache policy match the
    // rest of the lab rather than introducing a parallel fetch path.

    listEvolutionRuns: (token: string, limit = 10) =>
        callApi<{ runs: EvolutionRun[]; count: number }>(
            `/api/strategy-lab/evolution?limit=${limit}`,
            token
        ),

    runEvolution: (
        token: string,
        payload: { symbol: SupportedSymbol; timeframe?: Timeframe; period?: AnalysisPeriod; generations?: number; seedPopulation?: number }
    ) =>
        callApi<{
            run?: EvolutionRun;
            unavailable?: string;
            persistedSurvivors?: number;
            error?: string;
        }>("/api/strategy-lab/evolution", token, {
            method: "POST",
            body: JSON.stringify(payload),
        }),
};

export type { AnalysisPeriod, DeployMode, Pattern, Strategy, TimeframeHierarchy } from "@/lib/strategy-lab/types";
export type { EvolutionRun } from "@/lib/ai/strategy-lab/evolution";