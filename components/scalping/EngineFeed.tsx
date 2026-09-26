"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleSlash, ListTree, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RadarResult, RadarRow } from "@/lib/ai/scalping/radar";
import { AwaitingState, TerminalPanel } from "@/components/scalping/TerminalPrimitives";
import { relativeTime } from "@/lib/scalping/client";

/**
 * Engine feed — an audit trail of the agent pipeline.
 *
 * Performance: the feed can contain `symbols × 8 agents` rows, so it is capped
 * (`MAX_FEED_ROWS`) and rendered from a single memoised flat list. Nothing here
 * re-renders on the 1s clock tick; the parent passes a pre-serialised `now` only
 * to the header, and each row's relative time is computed from the pipeline's
 * own `asOf` rather than a per-row timer.
 */

const MAX_FEED_ROWS = 240;

type FeedEntry = {
    key: string;
    symbol: string;
    agentId: string;
    label: string;
    status: "completed" | "unavailable" | "skipped";
    durationMs: number;
    reason?: string;
    /** Pipeline `asOf` for the symbol this run belongs to. */
    asOf: number;
};

function buildEntries(radar: RadarResult | null): FeedEntry[] {
    if (!radar) return [];
    const out: FeedEntry[] = [];
    for (const row of radar.rows) {
        for (const t of row.agentTrace) {
            out.push({
                key: `${row.symbol}:${t.agentId}`,
                symbol: row.symbol,
                agentId: t.agentId,
                label: t.label,
                status: t.status,
                durationMs: t.durationMs,
                ...(t.reason ? { reason: t.reason } : {}),
                asOf: radar.asOf,
            });
        }
    }
    return out;
}

const STATUS_ICON = {
    completed: CheckCircle2,
    unavailable: CircleSlash,
    skipped: SkipForward,
} as const;

const STATUS_CLASS: Record<FeedEntry["status"], string> = {
    completed: "text-positive",
    unavailable: "text-negative",
    skipped: "text-muted-foreground",
};

export function EngineFeed({
    radar,
    now,
    className,
}: {
    radar: RadarResult | null;
    now: number;
    className?: string;
}) {
    const [onlyProblems, setOnlyProblems] = useState(false);

    const entries = useMemo(() => buildEntries(radar), [radar]);
    const filtered = useMemo(
        () => (onlyProblems ? entries.filter((e) => e.status !== "completed") : entries),
        [entries, onlyProblems]
    );
    const visible = useMemo(
        () => filtered.slice(Math.max(0, filtered.length - MAX_FEED_ROWS)),
        [filtered]
    );
    const problems = useMemo(
        () => entries.filter((e) => e.status !== "completed").length,
        [entries]
    );

    return (
        <TerminalPanel
            title="Engine Feed"
            icon={<ListTree className="size-3.5" />}
            meta={
                radar
                    ? `${entries.length} agent run${entries.length === 1 ? "" : "s"}${
                          problems > 0 ? ` · ${problems} degraded` : ""
                      }`
                    : "awaiting engine data"
            }
            dense
            className={className}
            bodyClassName="flex min-h-0 flex-col"
            action={
                problems > 0 ? (
                    <button
                        type="button"
                        onClick={() => setOnlyProblems((v) => !v)}
                        aria-pressed={onlyProblems}
                        className={cn(
                            "rounded-md border border-border px-2 py-0.5 text-xs transition",
                            onlyProblems
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                    >
                        {onlyProblems ? "Showing problems" : "Problems only"}
                    </button>
                ) : null
            }
        >
            {entries.length === 0 ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason="The agent pipeline has not run yet. Each row below records one deterministic agent and whether it produced a measurement."
                    />
                </div>
            ) : visible.length === 0 ? (
                <div className="p-3">
                    <p className="text-xs text-muted-foreground">
                        Every agent completed on this pass. Toggle <em>Problems only</em> off to see the
                        full trace.
                    </p>
                </div>
            ) : (
                <>
                    <ul className="max-h-[420px] min-w-0 flex-1 overflow-y-auto">
                        {visible.map((e) => {
                            const Icon = STATUS_ICON[e.status];
                            return (
                                <li
                                    key={e.key}
                                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/50 px-3 py-1.5 last:border-0"
                                >
                                    <span className="font-mono text-xs font-medium text-foreground">
                                        {e.symbol}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{e.label}</span>
                                    <span
                                        className={cn("inline-flex items-center gap-1 text-xs", STATUS_CLASS[e.status])}
                                    >
                                        <Icon className="size-3" />
                                        {e.status}
                                    </span>
                                    <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                                        {Math.round(e.durationMs)}ms
                                    </span>
                                    {e.reason ? (
                                        <span className="w-full text-xs text-muted-foreground/80">
                                            {e.reason}
                                        </span>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                    <div className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
                        Showing {visible.length} of {filtered.length} agent run
                        {filtered.length === 1 ? "" : "s"}
                        {filtered.length > visible.length ? " (most recent first)" : ""} · pipeline{" "}
                        {radar ? relativeTime(radar.asOf, now) : "—"}
                    </div>
                </>
            )}
        </TerminalPanel>
    );
}

/** Compact per-symbol agent health summary used under the radar on mobile. */
export function AgentHealthStrip({
    rows,
    className,
}: {
    rows: RadarRow[];
    className?: string;
}) {
    return (
        <ul className={cn("flex flex-wrap gap-1.5", className)}>
            {rows.map((r) => {
                const total = r.agentTrace.length;
                const ok = r.agentTrace.filter((t) => t.status === "completed").length;
                return (
                    <li
                        key={r.symbol}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                        title={r.degraded.map((d) => `${d.agent}: ${d.reason}`).join(" · ") || "All agents completed."}
                    >
                        <span className="font-mono font-medium text-foreground">{r.symbol}</span>
                        <span
                            className={cn(
                                "font-mono tabular-nums",
                                ok === total ? "text-positive" : "text-negative"
                            )}
                        >
                            {ok}/{total}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}
