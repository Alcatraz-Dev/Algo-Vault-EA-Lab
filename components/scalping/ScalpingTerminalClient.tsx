"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Terminal as TerminalIcon } from "lucide-react";
import { SUPPORTED_SYMBOLS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";
import { RADAR_SYMBOLS } from "@/lib/ai/scalping/watchlist";
import type { RadarResult } from "@/lib/ai/scalping/radar";
import {
    SCALPING_TIMEFRAMES,
    useAuthToken,
    useNow,
    useThrottledAuthedFetch,
} from "@/lib/scalping/client";
import { EngineErrorBanner, EngineStatusBar, type EngineSummary } from "@/components/scalping/EngineStatusBar";
import { EngineFeed, AgentHealthStrip } from "@/components/scalping/EngineFeed";
import { MarketRadar } from "@/components/scalping/MarketRadar";
import {
    LiveSignalsPanel,
    type SignalScanPayload,
} from "@/components/scalping/LiveSignalsPanel";

/**
 * Scalping terminal.
 *
 * Layout follows the priority hierarchy, not a shrunken desktop: the radar is
 * the primary surface, live signals are secondary, and the engine feed is the
 * audit trail that appears last. On mobile they stack in that order; on tablet
 * it collapses to two columns; only on wide screens does the feed sit beside
 * the other panels.
 *
 * All polling goes through `useThrottledAuthedFetch`, which waits for the auth
 * token and aborts superseded requests, so switching symbol/timeframe cannot
 * deliver a stale payload.
 */

type RadarPayload = {
    radar: RadarResult;
    invalid?: string[];
    engine?: { mode: string; providers: number; budgetImpact: string };
};

const DEFAULT_WATCHLIST = RADAR_SYMBOLS.slice(0, 4);

export function ScalpingTerminalClient() {
    const token = useAuthToken();
    const now = useNow(1000);

    const [watchlist, setWatchlist] = useState<SupportedSymbol[]>(DEFAULT_WATCHLIST);
    const [timeframe, setTimeframe] = useState<Timeframe>("M5");
    const [interval, setIntervalMs] = useState<number>(30_000);

    // `interval` drives a nonce-based re-fetch rather than being part of the URL,
    // so changing the refresh cadence never changes the request payload.
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (interval === 0) return;
        const id = setInterval(() => setTick((t) => t + 1), interval);
        return () => clearInterval(id);
    }, [interval]);

    const symbolsParam = useMemo(() => watchlist.join(","), [watchlist]);

    const radarUrl = token
        ? `/api/scalping/radar?symbols=${encodeURIComponent(symbolsParam)}&timeframe=${timeframe}&t=${tick}`
        : null;
    const signalsUrl = token
        ? `/api/scalping/signals?symbols=${encodeURIComponent(symbolsParam)}&t=${tick}`
        : null;

    const radar = useThrottledAuthedFetch<RadarPayload>(radarUrl, {
        minIntervalMs: 5000,
        enabled: !!token,
    });
    const signals = useThrottledAuthedFetch<SignalScanPayload>(signalsUrl, {
        minIntervalMs: 5000,
        enabled: !!token,
    });

    const radarData = radar.data?.radar ?? null;

    const summary: EngineSummary = useMemo(() => {
        const rows = radarData?.rows ?? [];
        return {
            rows: rows.length,
            failed: radarData?.failed.length ?? 0,
            agentRuns: rows.reduce((n, r) => n + r.agentTrace.length, 0),
            agentFailures: rows.reduce(
                (n, r) => n + r.agentTrace.filter((t) => t.status !== "completed").length,
                0
            ),
            oldestDataAsOf: rows.reduce<number | null>(
                (min, r) =>
                    r.dataAsOf === null ? min : min === null ? r.dataAsOf : Math.min(min, r.dataAsOf),
                null
            ),
            stale: rows.some((r) => r.stale),
        };
    }, [radarData]);

    const toggleSymbol = useCallback((symbol: SupportedSymbol) => {
        setWatchlist((prev) => {
            if (prev.includes(symbol)) {
                // Never let the watchlist empty out — an empty radar is not a
                // useful state and hides the engine rather than exercising it.
                return prev.length === 1 ? prev : prev.filter((s) => s !== symbol);
            }
            return [...prev, symbol].slice(0, 12);
        });
    }, []);

    const refreshAll = useCallback(() => {
        radar.refresh();
        signals.refresh();
    }, [radar, signals]);

    if (!token) {
        return (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
                <Lock className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                    Sign in to open the scalping terminal.
                </p>
            </div>
        );
    }

    const accessError =
        radar.error && /license|subscription|plan|access/i.test(radar.error) ? radar.error : null;

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <EngineStatusBar
                summary={summary}
                dataSource={radarData?.dataSource ?? null}
                interval={interval}
                onIntervalChange={setIntervalMs}
                onRefresh={refreshAll}
                loading={radar.loading}
                lastUpdated={radar.lastUpdated}
                now={now}
            />

            {accessError ? <EngineErrorBanner error={accessError} isAccessError /> : null}

            <WatchlistPicker
                selected={watchlist}
                onToggle={toggleSymbol}
                timeframe={timeframe}
                onTimeframe={setTimeframe}
            />

            {radar.error && !accessError ? (
                <EngineErrorBanner error={radar.error} />
            ) : null}

            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-4">
                    <MarketRadar
                        radar={radarData}
                        loading={radar.loading}
                        invalid={radar.data?.invalid ?? []}
                    />
                    {radarData && radarData.rows.length > 0 ? (
                        <AgentHealthStrip rows={radarData.rows} className="px-1" />
                    ) : null}
                    {signals.error ? <EngineErrorBanner error={signals.error} /> : null}
                    <LiveSignalsPanel
                        payload={signals.data}
                        loading={signals.loading}
                        now={now}
                    />
                </div>

                <div className="flex min-w-0 flex-col gap-4">
                    <EngineFeed radar={radarData} now={now} />
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                Measurements come from the AlgoVault market-data and analytics engines. Signals are
                produced by the existing deterministic scanner — this terminal makes no AI model
                calls and consumes no AI budget. Nothing here is financial advice.
            </p>
        </div>
    );
}

function WatchlistPicker({
    selected,
    onToggle,
    timeframe,
    onTimeframe,
}: {
    selected: SupportedSymbol[];
    onToggle: (s: SupportedSymbol) => void;
    timeframe: Timeframe;
    onTimeframe: (t: Timeframe) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
                <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  Watchlist
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                    {selected.length} symbol{selected.length === 1 ? "" : "s"}
                </span>

                <label className="sr-only" htmlFor="terminal-timeframe">
                    Execution timeframe
                </label>
                <select
                    id="terminal-timeframe"
                    value={timeframe}
                    onChange={(e) => onTimeframe(e.target.value as Timeframe)}
                    className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                >
                    {SCALPING_TIMEFRAMES.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </select>

                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                    {expanded ? "Done" : "Edit symbols"}
                </button>
            </div>

            {expanded ? (
                <div className="flex flex-wrap gap-1.5">
                    {[...SUPPORTED_SYMBOLS].map((s) => {
                        const on = selected.includes(s);
                        return (
                            <button
                                key={s}
                                type="button"
                                onClick={() => onToggle(s)}
                                aria-pressed={on}
                                className={
                                    on
                                        ? "rounded-md border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary"
                                        : "rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                }
                            >
                                {s}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
