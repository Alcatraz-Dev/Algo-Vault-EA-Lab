"use client";

import { useMemo, useState } from "react";
import { Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_SYMBOLS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import type { ConfidenceComponent } from "@/lib/ai/agents/pipeline";
import { useAuthToken, useNow, useThrottledAuthedFetch } from "@/lib/scalping/client";
import { AwaitingState, TerminalPanel } from "@/components/scalping/TerminalPrimitives";
import { EngineErrorBanner } from "@/components/scalping/EngineStatusBar";
import { AdvancedChart } from "@/components/analysis/advanced/AdvancedChart";
import { StructurePanel } from "@/components/analysis/advanced/StructurePanel";
import { MtfLadderPanel } from "@/components/analysis/advanced/MtfLadderPanel";
import { RegimePanel } from "@/components/analysis/advanced/RegimePanel";
import { EvidencePanel } from "@/components/analysis/advanced/EvidencePanel";

/**
 * Advanced analysis workspace.
 *
 * One request produces the whole page: the route loads every timeframe in the
 * ladder, runs the agent pipeline on the primary timeframe and returns the
 * structure / MTF / regime / evidence sections together. Folding them into a
 * single fetch keeps the panels consistent with each other — a chart showing
 * swing points from pass A next to a structure table from pass B would be a
 * correctness bug, not just a staleness annoyance.
 */

type AnalysisPayload = {
    analysis: AdvancedAnalysisResult;
    pipeline?: {
        symbol: string;
        timeframe: Timeframe;
        asOf: number;
        dataAsOf: number | null;
        stale: boolean;
        bars: number;
        confidence: number | null;
        confidenceComponents: ConfidenceComponent[];
    };
    fetchErrors?: Array<{ timeframe: Timeframe; reason: string }>;
    dataSource?: { id: string; label: string };
};

const PRIMARY_TIMEFRAMES: Timeframe[] = ["M5", "M15", "M30", "H1", "H4"];

export function AdvancedAnalysisClient() {
    const token = useAuthToken();
    const now = useNow(1000);

    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("M15");

    const url = token
        ? `/api/analysis/intelligence?symbol=${symbol}&timeframe=${timeframe}`
        : null;

    const { data, error, loading, refresh, lastUpdated } = useThrottledAuthedFetch<AnalysisPayload>(url, {
        minIntervalMs: 2000,
        enabled: !!token,
    });

    const analysis = data?.analysis ?? null;
    const fetchErrors = data?.fetchErrors ?? [];

    const swingHighs = useMemo(
        () =>
            (analysis?.structure.swingHighs ?? []).map((e) => ({
                price: e.price,
                timestamp: e.timestamp,
            })),
        [analysis]
    );
    const swingLows = useMemo(
        () =>
            (analysis?.structure.swingLows ?? []).map((e) => ({
                price: e.price,
                timestamp: e.timestamp,
            })),
        [analysis]
    );

    if (!token) {
        return (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
                <Lock className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Sign in to open advanced analysis.</p>
            </div>
        );
    }

    const accessError = error && /license|subscription|plan|access/i.test(error) ? error : null;

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
                <label className="sr-only" htmlFor="advanced-symbol">
                    Symbol
                </label>
                <select
                    id="advanced-symbol"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value as SupportedSymbol)}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                >
                    {[...SUPPORTED_SYMBOLS].map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </select>

                <label className="sr-only" htmlFor="advanced-timeframe">
                    Primary timeframe
                </label>
                <select
                    id="advanced-timeframe"
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                >
                    {PRIMARY_TIMEFRAMES.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </select>

                <span className="font-mono text-xs text-muted-foreground">
                    {analysis ? `${analysis.symbol} · ${analysis.primaryTimeframe}` : "awaiting analysis"}
                </span>

                {data?.pipeline?.stale ? (
                    <span
                        className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning"
                        title="The newest candle is older than the pipeline's staleness threshold."
                    >
                        Stale data
                    </span>
                ) : null}

                <button
                    type="button"
                    onClick={refresh}
                    disabled={loading}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition hover:bg-muted disabled:opacity-50"
                >
                    <RefreshCw className={cn("size-3", loading && "animate-spin")} />
                    Re-analyse
                </button>
            </div>

            {accessError ? <EngineErrorBanner error={accessError} isAccessError /> : null}
            {error && !accessError ? <EngineErrorBanner error={error} /> : null}

            {fetchErrors.length > 0 ? (
                <div
                    role="status"
                    className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3"
                >
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <ShieldAlert className="size-3.5" />
                        {fetchErrors.length} timeframe{fetchErrors.length === 1 ? "" : "s"} unavailable
                    </p>
                    <ul className="space-y-0.5">
                        {fetchErrors.map((f) => (
                            <li key={f.timeframe} className="text-xs text-muted-foreground">
                                <span className="font-mono font-medium text-foreground">{f.timeframe}</span> —{" "}
                                {f.reason}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {!analysis && !error ? (
                <TerminalPanel title="Advanced Analysis" className="min-h-[320px]">
                    <AwaitingState reason="Analysing structure, the multi-timeframe ladder and the market regime from live candles." />
                </TerminalPanel>
            ) : null}

            {analysis ? (
                <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
                    <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
                        <AdvancedChart
                            symbol={analysis.symbol}
                            timeframe={analysis.primaryTimeframe}
                            levels={{
                                support: analysis.structure.support.value ?? [],
                                resistance: analysis.structure.resistance.value ?? [],
                            }}
                            swingHighs={swingHighs}
                            swingLows={swingLows}
                            vwap={analysis.structure.vwap.value}
                        />
                        <StructurePanel structure={analysis.structure} now={now} />
                    </div>

                    <div className="flex min-w-0 flex-col gap-4">
                        <RegimePanel regime={analysis.regime} now={now} />
                        <EvidencePanel
                            evidence={analysis.evidence}
                            confidence={data?.pipeline?.confidence ?? null}
                            confidenceComponents={data?.pipeline?.confidenceComponents ?? []}
                            confidenceLabel={undefined}
                        />
                        <MtfLadderPanel
                            mtf={analysis.multiTimeframe}
                            primaryTimeframe={analysis.primaryTimeframe}
                            onSelectTimeframe={(tf) => setTimeframe(tf as Timeframe)}
                        />
                    </div>
                </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
                Analysis is produced by the AlgoVault analytics engines from real candles — no language
                model is called and no AI budget is consumed. {lastUpdated ? "Last response received." : ""}{" "}
                Nothing here is financial advice.
            </p>
        </div>
    );
}
