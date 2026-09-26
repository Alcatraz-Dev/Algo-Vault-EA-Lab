"use client";

import { Activity, Cpu, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { REFRESH_INTERVALS, relativeTime } from "@/lib/scalping/client";
import { SourceTag } from "@/components/scalping/TerminalPrimitives";

/**
 * Engine status header for the scalping terminal.
 *
 * This bar is intentionally honest about two things that a trading UI usually
 * hides:
 *   1. The pipeline is deterministic — it spends no AI budget. Saying so stops
 *      the terminal being mistaken for a black-box LLM product.
 *   2. The data may be stale. When the provider's last candle is older than the
 *      staleness threshold the whole terminal is marked stale rather than being
 *      presented as live.
 */

export type EngineSummary = {
    /** Symbols the pipeline actually produced a row for. */
    rows: number;
    /** Symbols that could not be fetched. */
    failed: number;
    /** Total agent runs in the last pass. */
    agentRuns: number;
    /** Agent runs that did not complete. */
    agentFailures: number;
    /** Oldest data timestamp across all rows. */
    oldestDataAsOf: number | null;
    /** Any row flagged stale by the pipeline. */
    stale: boolean;
};

export function EngineStatusBar({
    summary,
    dataSource,
    interval,
    onIntervalChange,
    onRefresh,
    loading,
    lastUpdated,
    now,
    className,
}: {
    summary: EngineSummary;
    dataSource: { id: string; label: string; asOf: number | null } | null;
    interval: number;
    onIntervalChange: (ms: number) => void;
    onRefresh: () => void;
    loading: boolean;
    lastUpdated: number | null;
    now: number;
    className?: string;
}) {
    const health =
        summary.rows === 0
            ? { tone: "unavailable" as const, label: "No data" }
            : summary.stale
              ? { tone: "warn" as const, label: "Stale data" }
              : summary.agentFailures > 0
                ? { tone: "warn" as const, label: "Partial" }
                : { tone: "ok" as const, label: "Live" };

    return (
        <section
            className={cn(
                "flex flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:flex-row lg:items-center lg:justify-between",
                className
            )}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                <span
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
                        health.tone === "ok" && "border-positive/40 bg-positive/10 text-positive",
                        health.tone === "warn" && "border-border bg-muted text-muted-foreground",
                        health.tone === "unavailable" && "border-border bg-muted text-muted-foreground"
                    )}
                >
                    {health.tone === "unavailable" ? (
                        <ShieldAlert className="size-3" />
                    ) : (
                        <Activity className="size-3" />
                    )}
                    {health.label}
                </span>

                <Stat label="Symbols" value={`${summary.rows}/${summary.rows + summary.failed}`} />
                <Stat
                    label="Agents"
                    value={
                        summary.agentRuns > 0
                            ? `${summary.agentRuns - summary.agentFailures}/${summary.agentRuns}`
                            : "—"
                    }
                    hint="Deterministic agents that completed, out of the total run."
                />
                <Stat
                    label="Refreshed"
                    value={relativeTime(lastUpdated, now)}
                    hint="When this browser last received a response."
                />
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    title="This terminal runs the deterministic measurement pipeline. It makes no LLM calls and consumes no AI budget."
                >
                    <Cpu className="size-3" />
                    Deterministic · 0 AI spend
                </span>

                <label className="sr-only" htmlFor="terminal-refresh">
                    Auto refresh interval
                </label>
                <select
                    id="terminal-refresh"
                    value={interval}
                    onChange={(e) => onIntervalChange(Number(e.target.value))}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                >
                    {REFRESH_INTERVALS.map((i) => (
                        <option key={i.value} value={i.value}>
                            {i.value === 0 ? "Auto refresh off" : `Every ${i.label}`}
                        </option>
                    ))}
                </select>

                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition hover:bg-muted disabled:opacity-50"
                >
                    <RefreshCw className={cn("size-3", loading && "animate-spin")} />
                    Refresh
                </button>

                <SourceTag source={dataSource} />
            </div>
        </section>
    );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <span className="inline-flex items-baseline gap-1.5 text-xs" title={hint}>
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">{value}</span>
        </span>
    );
}

/**
 * A single "engine unavailable" banner used when the terminal cannot load at
 * all. It distinguishes an access problem from a provider problem, because the
 * remedy is different in each case.
 */
export function EngineErrorBanner({
    error,
    isAccessError,
    className,
}: {
    error: string;
    isAccessError?: boolean;
    className?: string;
}) {
    return (
        <div
            role="alert"
            className={cn(
                "flex flex-col gap-1 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:gap-3",
                className
            )}
        >
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
                {isAccessError ? <Zap className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
                {isAccessError ? "Access required" : "Engine unavailable"}
            </span>
            <span className="min-w-0 text-xs text-muted-foreground">{error}</span>
        </div>
    );
}
