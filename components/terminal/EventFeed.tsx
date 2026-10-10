"use client";

/**
 * EventFeed — Phase 5 §30 / §31 / §32.
 *
 * One ordered stream of everything the engines reported: structure breaks,
 * liquidity sweeps, zone creation/mitigation, scanner signals and risk
 * guard trips. Every row carries its timestamp, symbol, timeframe, type and
 * source, and clicking it drives the shared chart to that exact bar —
 * symbol, timeframe, timestamp and price — instead of flashing a toast.
 */

import { useMemo, useState } from "react";
import { Radio, Crosshair, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { eventChartTarget, eventTimeLabel } from "@/lib/terminal/events";
import type { TerminalEvent, TerminalEventSource } from "@/lib/terminal/types";
import { useTerminal } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";

const SOURCES: Array<TerminalEventSource | "all"> = ["all", "smart-money", "signal", "risk", "account"];

const TYPE_STYLE: Record<string, string> = {
    BOS: "border-info/40 text-info",
    CHOCH: "border-warning/40 text-warning",
    SWEEP: "border-primary/40 text-primary",
    FVG_CREATED: "border-positive/40 text-positive",
    FVG_MITIGATED: "border-border text-muted-foreground",
    OB_CREATED: "border-positive/40 text-positive",
    OB_MITIGATED: "border-border text-muted-foreground",
    STRATEGY_SIGNAL: "border-info/40 text-info",
    POSITION_OPENED: "border-info/40 text-info",
    POSITION_CLOSED: "border-border text-muted-foreground",
    RISK_WARNING: "border-negative/50 text-negative",
    ALERT_TRIGGERED: "border-warning/40 text-warning",
    SESSION_CHANGE: "border-border text-muted-foreground",
};

export function EventFeed({ now, limit = 40 }: { now: number; limit?: number }) {
    const { requestChartFocus, state } = useTerminal();
    const { events } = useTerminalData();
    const [source, setSource] = useState<TerminalEventSource | "all">("all");
    const [activeId, setActiveId] = useState<string | null>(null);

    const visible = useMemo(() => {
        const filtered = source === "all" ? events : events.filter((e) => e.source === source);
        return filtered.slice(0, limit);
    }, [events, source, limit]);

    const focus = (e: TerminalEvent) => {
        const target = eventChartTarget(e);
        if (!target) return;
        setActiveId(e.id);
        requestChartFocus(target);
    };

    return (
        <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card" aria-label="Market monitor">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-foreground">
                    <Radio className="size-3 text-primary" />
                    Market monitor
                    <span className="font-mono text-muted-foreground">({events.length})</span>
                </h2>
                <div className="flex items-center gap-1">
                    <Filter className="size-3 text-muted-foreground" />
                    {SOURCES.map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSource(s)}
                            aria-pressed={source === s}
                            className={cn(
                                "rounded border px-1.5 py-0.5 text-micro capitalize transition",
                                source === s
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground hover:bg-muted"
                            )}
                        >
                            {s === "smart-money" ? "SMC" : s}
                        </button>
                    ))}
                </div>
            </header>

            <ul className="max-h-[38vh] min-h-[6rem] overflow-y-auto">
                {visible.length === 0 ? (
                    <li className="px-3 py-4 text-micro leading-4 text-muted-foreground">
                        No events from {source === "all" ? "any engine" : source} yet. Events appear as soon as an
                        engine reports one — this feed never pads itself.
                    </li>
                ) : (
                    visible.map((e) => (
                        <li key={e.id}>
                            <button
                                type="button"
                                onClick={() => focus(e)}
                                className={cn(
                                    "flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left transition hover:bg-muted/60",
                                    activeId === e.id && "bg-primary/5"
                                )}
                                title="Focus the chart on this event"
                            >
                                <span className="w-9 shrink-0 pt-0.5 font-mono text-micro tabular-nums text-muted-foreground">
                                    {eventTimeLabel(e.timestamp)}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        <span
                                            className={cn(
                                                "rounded border px-1 font-mono text-micro font-bold tracking-wide",
                                                TYPE_STYLE[e.type] ?? "border-border text-muted-foreground"
                                            )}
                                        >
                                            {e.type.replace("_", " ")}
                                        </span>
                                        <span className="font-mono text-micro font-semibold text-foreground">{e.symbol}</span>
                                        <span className="font-mono text-micro text-muted-foreground">{e.timeframe}</span>
                                        <span className="text-micro text-muted-foreground">· {e.source}</span>
                                    </span>
                                    <span className="mt-0.5 block truncate text-micro text-foreground">{e.title}</span>
                                    {e.detail ? (
                                        <span className="block truncate font-mono text-micro text-muted-foreground">{e.detail}</span>
                                    ) : null}
                                </span>
                                <Crosshair
                                    className={cn(
                                        "mt-1 size-3 shrink-0",
                                        activeId === e.id ? "text-primary" : "text-muted-foreground/60"
                                    )}
                                />
                            </button>
                        </li>
                    ))
                )}
            </ul>

            <footer className="border-t border-border px-3 py-1.5 text-micro text-muted-foreground">
                Clicking an event selects its symbol/timeframe and navigates the chart
                {state.symbol ? ` (now ${state.symbol} ${state.timeframe})` : ""}. Updated{" "}
                {new Date(now).toISOString().slice(11, 19)} UTC.
            </footer>
        </section>
    );
}
