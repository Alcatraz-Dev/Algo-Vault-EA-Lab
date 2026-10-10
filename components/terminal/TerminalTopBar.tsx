"use client";

/**
 * TerminalTopBar — Phase 5 §3 header row.
 *
 * AlgoVault | Symbol | Timeframe | Session | Market status | Account mode.
 *
 * Every value is sourced: session from the deterministic session windows,
 * freshness from the quote subscription, account mode from the connected
 * account record. Nothing in this bar is decorative.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Search, Signal, Wifi, WifiOff, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_SYMBOLS, TIMEFRAME_LABELS, type Timeframe } from "@/lib/market-data/types";
import { TERMINAL_TIMEFRAMES } from "@/components/pro-scalping-terminal/chart-layers";
import { sessionFor } from "@/lib/terminal/chat-context";
import { freshness, useTerminal } from "./TerminalContext";
import { useTerminalData, type RiskPayload } from "./TerminalData";

function SymbolPicker() {
    const { state, setSymbol } = useTerminal();
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                inputRef.current?.focus();
                setOpen(true);
            }
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const matches = useMemo(() => {
        const q = query.trim().toUpperCase();
        if (!q) return SUPPORTED_SYMBOLS.slice(0, 20);
        return SUPPORTED_SYMBOLS.filter((s) => s.includes(q)).slice(0, 20);
    }, [query]);

    return (
        <div className="relative">
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2">
                <Search className="size-3.5 text-muted-foreground" />
                <input
                    ref={inputRef}
                    id="terminal-symbol-search"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => window.setTimeout(() => setOpen(false), 150)}
                    placeholder={state.symbol}
                    aria-label="Search symbol"
                    className="w-24 bg-transparent font-mono text-xs uppercase text-foreground outline-none placeholder:text-foreground"
                />
                <kbd className="hidden rounded border border-border px-1 font-mono text-micro text-muted-foreground sm:inline">
                    ⌘K
                </kbd>
            </div>
            {open && matches.length > 0 ? (
                <ul className="absolute left-0 z-40 mt-1 max-h-64 w-44 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl">
                    {matches.map((s) => (
                        <li key={s}>
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setSymbol(s);
                                    setQuery("");
                                    setOpen(false);
                                }}
                                className={cn(
                                    "w-full rounded-md px-2 py-1.5 text-left font-mono text-xs transition",
                                    s === state.symbol ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                                )}
                            >
                                {s}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

function TimeframePicker() {
    const { state, setTimeframe } = useTerminal();
    return (
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5" role="group" aria-label="Timeframe">
            {TERMINAL_TIMEFRAMES.map((tf) => (
                <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    aria-pressed={state.timeframe === tf}
                    title={TIMEFRAME_LABELS[tf as Timeframe]}
                    className={cn(
                        "rounded px-2 py-1 font-mono text-micro font-semibold transition",
                        state.timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    )}
                >
                    {tf}
                </button>
            ))}
        </div>
    );
}

function FreshnessPill({
    lastUpdated,
    now,
    label,
    liveWithinMs,
}: {
    lastUpdated: number | null;
    now: number;
    label: string;
    /** Expected poll cadence for this source — drives the LIVE/STALE cut. */
    liveWithinMs: number;
}) {
    const f = freshness(lastUpdated, now, liveWithinMs);
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-micro",
                f.status === "live" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                f.status === "stale" && "border-amber-500/40 bg-amber-500/10 text-amber-400",
                f.status === "loading" && "border-border bg-muted text-muted-foreground"
            )}
            title={`${label} — ${f.label}`}
        >
            {f.status === "loading" ? <Loader2 className="size-2.5 animate-spin" /> : <Wifi className="size-2.5" />}
            {f.status === "live" ? "LIVE" : f.status === "stale" ? "STALE" : "…"}
            <span className="text-muted-foreground">{f.label}</span>
        </span>
    );
}

function AccountModeBadge({ risk }: { risk: RiskPayload | null }) {
    const { state } = useTerminal();
    const mode = state.accountMode;
    const status = risk?.status ?? null;

    return (
        <div className="flex items-center gap-1.5">
            <span
                className={cn(
                    "rounded border px-1.5 py-0.5 text-micro font-bold tracking-wider",
                    mode === "live" && "border-rose-500/50 bg-rose-500/10 text-rose-400",
                    mode === "paper" && "border-sky-500/50 bg-sky-500/10 text-sky-400",
                    mode === "unknown" && "border-border bg-muted text-muted-foreground"
                )}
                title={
                    mode === "live"
                        ? "Connected live account — orders are real."
                        : mode === "paper"
                          ? "Simulated account — every fill is a paper fill."
                          : "No connected account established."
                }
            >
                {mode === "live" ? "LIVE TRADING" : mode === "paper" ? "PAPER TRADING" : "NO ACCOUNT"}
            </span>
            {status && status !== "SAFE" ? (
                <span
                    className={cn(
                        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-micro font-bold tracking-wider",
                        status === "WARNING" && "border-amber-500/50 bg-amber-500/10 text-amber-400",
                        status === "RESTRICTED" && "border-orange-500/50 bg-orange-500/10 text-orange-400",
                        status === "HALTED" && "border-red-600/50 bg-red-600/10 text-red-400"
                    )}
                >
                    <ShieldAlert className="size-2.5" />
                    {status}
                </span>
            ) : null}
        </div>
    );
}

export function TerminalTopBar({ now, isPro }: { now: number; isPro: boolean }) {
    const { state } = useTerminal();
    const data = useTerminalData();
    const session = sessionFor(now);
    const price = data.lastPrice;
    const change = data.changePct;

    return (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Activity className="size-3.5" />
                </div>
                <div className="leading-none">
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold tracking-tight text-foreground">AlgoVault</span>
                        <span className="text-border">|</span>
                        <span className="font-mono text-xs font-bold text-primary">{state.symbol}</span>
                        <span className="font-mono text-micro text-muted-foreground">{state.timeframe}</span>
                        {isPro ? (
                            <span className="rounded border border-primary/30 px-1 py-px text-micro font-bold tracking-wider text-primary">
                                PRO
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-micro text-muted-foreground">
                        <span
                            className="inline-flex items-center gap-1"
                            title="Deterministic session windows (UTC)"
                        >
                            <Signal className="size-2.5" />
                            {session.label}
                        </span>
                        <span>·</span>
                        <span>{new Date(now).toISOString().slice(11, 19)} UTC</span>
                    </div>
                </div>
            </div>

            <SymbolPicker />
            <TimeframePicker />

            {price !== null ? (
                <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                        {price >= 100 ? price.toFixed(2) : price.toFixed(5)}
                    </span>
                    {change !== null ? (
                        <span
                            className={cn(
                                "font-mono text-micro tabular-nums",
                                change >= 0 ? "text-emerald-400" : "text-rose-400"
                            )}
                        >
                            {change >= 0 ? "+" : ""}
                            {change.toFixed(2)}%
                        </span>
                    ) : (
                        <span className="font-mono text-micro text-muted-foreground">day n/a</span>
                    )}
                </div>
            ) : (
                <span className="font-mono text-micro text-muted-foreground">
                    {data.quotesLoading ? "Loading price…" : "No price available"}
                </span>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
                <FreshnessPill lastUpdated={data.quotesUpdatedAt} now={now} label="Quotes" liveWithinMs={20_000} />
                <FreshnessPill lastUpdated={data.analysisUpdatedAt} now={now} label="Analysis" liveWithinMs={45_000} />
                <AccountModeBadge risk={data.risk} />
                {data.riskError ? (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-micro text-amber-400">
                        <WifiOff className="size-2.5" />
                        Risk state unavailable
                    </span>
                ) : null}
            </div>
        </header>
    );
}
