"use client";

/**
 * Market Replay — real historical candles, scrubbed and played back.
 *
 * The candle set comes from `/api/replay-data`, which serves whatever the
 * market-data provider has for the requested symbol/timeframe. Playback only
 * walks the candles that were actually returned, so the replay is honest by
 * construction: what you see is the data, and the HUD reports exactly which
 * window was loaded.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Gauge, History, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { TERMINAL_TIMEFRAMES } from "./chart-layers";
import { fmtPrice, fmtSigned } from "./terminal-utils";

type ReplayCandle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
};

type ReplayState = {
    /** Request key the current payload belongs to ("" = none yet). */
    key: string;
    candles: ReplayCandle[];
    from: number | null;
    to: number | null;
    error: string | null;
};

const SPEEDS = [1, 2, 4, 8, 16] as const;

export function ProTerminalReplay({ token }: { token: string | null }) {
    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("M5");
    const [bars, setBars] = useState(300);
    const [playhead, setPlayhead] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState<number>(4);
    const [reload, setReload] = useState(0);

    const [state, setState] = useState<ReplayState>({
        key: "",
        candles: [],
        from: null,
        to: null,
        error: null,
    });

    // Loading is derived from a key mismatch, so no effect needs to call
    // setState synchronously: switching inputs immediately reads as loading.
    const requestKey = `${symbol}|${timeframe}|${bars}|${reload}`;
    const loading = state.key !== requestKey;

    // Fetch on inputs change.
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const params = new URLSearchParams({
                    symbol,
                    timeframe,
                    limit: String(bars),
                });
                const res = await fetch(`/api/replay-data?${params.toString()}`, {
                    cache: "no-store",
                    headers: { Authorization: `Bearer ${token}` },
                });
                const body = (await res.json().catch(() => null)) as
                    | { candles?: ReplayCandle[]; error?: string }
                    | null;
                if (cancelled) return;
                if (!res.ok || !body?.candles?.length) {
                    setState({
                        key: requestKey,
                        candles: [],
                        from: null,
                        to: null,
                        error:
                            body?.error ??
                            (res.status === 401
                                ? "Session expired — sign in again."
                                : "Replay provider returned no candles for this symbol/timeframe."),
                    });
                    return;
                }
                const candles = [...body.candles]
                    .filter((c) => Number.isFinite(c.timestamp) && Number.isFinite(c.close))
                    .sort((a, b) => a.timestamp - b.timestamp);
                setState({
                    key: requestKey,
                    candles,
                    from: candles[0]?.timestamp ?? null,
                    to: candles[candles.length - 1]?.timestamp ?? null,
                    error: null,
                });
                setPlayhead(candles.length - 1);
            } catch {
                if (cancelled) return;
                setState({ key: requestKey, candles: [], from: null, to: null, error: "Failed to load replay data." });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbol, timeframe, bars, token, reload, requestKey]);

    // Playback loop.
    useEffect(() => {
        if (!playing) return;
        const id = setInterval(() => {
            setPlayhead((p) => {
                const next = p + 1;
                if (next >= state.candles.length) {
                    setPlaying(false);
                    return state.candles.length - 1;
                }
                return next;
            });
        }, 1000 / speed);
        return () => clearInterval(id);
    }, [playing, speed, state.candles.length]);

    const current = state.candles[playhead] ?? null;
    const prev = playhead > 0 ? state.candles[playhead - 1] : null;

    const visibleWindow = useMemo(() => state.candles.slice(0, playhead + 1), [state.candles, playhead]);
    const sessionHi = useMemo(() => (visibleWindow.length ? Math.max(...visibleWindow.map((c) => c.high)) : null), [visibleWindow]);
    const sessionLo = useMemo(() => (visibleWindow.length ? Math.min(...visibleWindow.map((c) => c.low)) : null), [visibleWindow]);
    const rangePct = useMemo(() => {
        if (sessionHi === null || sessionLo === null || sessionLo === 0) return null;
        return ((sessionHi - sessionLo) / sessionLo) * 100;
    }, [sessionHi, sessionLo]);

    if (!token) {
        return (
            <section className="rounded-lg border border-border bg-card p-3">
                <ReplayHeader bars={bars} setBars={setBars} onReload={() => setReload((r) => r + 1)} disabled={loading} />
                <p className="py-4 text-center text-xs italic text-muted-foreground">
                    Sign in to replay historical candles.
                </p>
            </section>
        );
    }

    return (
        <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <History className="size-3.5 shrink-0 text-muted-foreground" />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Market Replay</h2>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <select
                        value={symbol}
                        onChange={(e) => {
                            setSymbol(e.target.value as SupportedSymbol);
                            setPlaying(false);
                        }}
                        className="rounded-md border border-border bg-background px-1.5 py-0.5 font-numeric text-xs outline-none focus:border-primary/50"
                        aria-label="Replay symbol"
                    >
                        {["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "US30", "NAS100", "BTCUSD", "ETHUSD"].map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                    <select
                        value={timeframe}
                        onChange={(e) => {
                            setTimeframe(e.target.value as Timeframe);
                            setPlaying(false);
                        }}
                        className="rounded-md border border-border bg-background px-1.5 py-0.5 font-numeric text-xs outline-none focus:border-primary/50"
                        aria-label="Replay timeframe"
                    >
                        {TERMINAL_TIMEFRAMES.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="p-3">
                <ReplayHeader
                    bars={bars}
                    setBars={setBars}
                    onReload={() => setReload((r) => r + 1)}
                    disabled={loading}
                />

                {state.error ? (
                    <div className="mt-2 rounded-md border border-dashed border-border px-3 py-4 text-center">
                        <p className="text-xs font-medium text-muted-foreground">Replay unavailable</p>
                        <p className="mt-1 text-micro text-muted-foreground/80">{state.error}</p>
                    </div>
                ) : loading ? (
                    <div className="mt-2 flex h-40 items-center justify-center rounded-md border border-dashed border-border">
                        <span className="text-xs text-muted-foreground">Loading candles…</span>
                    </div>
                ) : state.candles.length === 0 ? (
                    <div className="mt-2 rounded-md border border-dashed border-border px-3 py-4 text-center">
                        <p className="text-xs text-muted-foreground">No candles returned for this window.</p>
                    </div>
                ) : (
                    <>
                        {/* OHLC HUD */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border/70 bg-background px-2.5 py-1.5">
                            <span className="font-numeric text-micro tabular-nums text-muted-foreground">
                                {current ? new Date(current.timestamp).toISOString().replace("T", " ").slice(0, 16) : "—"} UTC
                            </span>
                            {current ? (
                                <>
                                    <span className="font-numeric text-micro tabular-nums">
                                        <span className="text-muted-foreground">O </span>
                                        <span className="text-foreground">{fmtPrice(current.open, symbol)}</span>
                                    </span>
                                    <span className="font-numeric text-micro tabular-nums">
                                        <span className="text-muted-foreground">H </span>
                                        <span className="text-positive">{fmtPrice(current.high, symbol)}</span>
                                    </span>
                                    <span className="font-numeric text-micro tabular-nums">
                                        <span className="text-muted-foreground">L </span>
                                        <span className="text-negative">{fmtPrice(current.low, symbol)}</span>
                                    </span>
                                    <span className="font-numeric text-micro tabular-nums">
                                        <span className="text-muted-foreground">C </span>
                                        <span className={cn(current.close >= current.open ? "text-positive" : "text-negative")}>
                                            {fmtPrice(current.close, symbol)}
                                        </span>
                                    </span>
                                    <span
                                        className={cn(
                                            "font-numeric text-micro tabular-nums",
                                            (current.close - (prev?.close ?? current.open)) >= 0 ? "text-positive" : "text-negative"
                                        )}
                                    >
                                        {fmtSigned(current.close - (prev?.close ?? current.open), current.close < 10 ? 5 : 2)}
                                    </span>
                                    {current.volume !== undefined ? (
                                        <span className="font-numeric text-micro tabular-nums text-muted-foreground">
                                            V {current.volume.toLocaleString()}
                                        </span>
                                    ) : null}
                                </>
                            ) : null}
                            <span className="ml-auto font-numeric text-micro tabular-nums text-muted-foreground">
                                Hi {fmtPrice(sessionHi, symbol)} · Lo {fmtPrice(sessionLo, symbol)}
                                {rangePct !== null ? ` · range ${rangePct.toFixed(2)}%` : ""}
                            </span>
                        </div>

                        {/* Playhead scrubber */}
                        <div className="mt-3">
                            <input
                                type="range"
                                min={0}
                                max={Math.max(0, state.candles.length - 1)}
                                value={playhead}
                                onChange={(e) => {
                                    setPlaying(false);
                                    setPlayhead(Number(e.target.value));
                                }}
                                className="w-full accent-[var(--primary,--theme(--color-primary))]"
                                aria-label="Replay playhead"
                            />
                            <div className="mt-0.5 flex justify-between font-numeric text-micro text-muted-foreground">
                                <span>{state.from ? new Date(state.from).toISOString().slice(0, 10) : ""}</span>
                                <span>
                                    bar {playhead + 1}/{state.candles.length}
                                </span>
                                <span>{state.to ? new Date(state.to).toISOString().slice(0, 10) : ""}</span>
                            </div>
                        </div>

                        {/* Transport controls */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => {
                                    setPlayhead(0);
                                    setPlaying(false);
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs transition hover:bg-muted"
                                aria-label="Reset to first bar"
                            >
                                <RotateCcw className="size-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setPlaying(false);
                                    setPlayhead((p) => Math.max(0, p - 1));
                                }}
                                className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs transition hover:bg-muted"
                                aria-label="Step back one bar"
                            >
                                <ChevronLeft className="size-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setPlaying((p) => !p)}
                                disabled={playhead >= state.candles.length - 1}
                                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                            >
                                {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
                                {playing ? "Pause" : "Play"}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setPlaying(false);
                                    setPlayhead((p) => Math.min(state.candles.length - 1, p + 1));
                                }}
                                className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs transition hover:bg-muted"
                                aria-label="Step forward one bar"
                            >
                                <ChevronRight className="size-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s as 1) + 1) % SPEEDS.length])}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-numeric text-xs transition hover:bg-muted"
                                aria-label="Cycle playback speed"
                                title="Playback speed"
                            >
                                <Gauge className="size-3" />
                                {speed}×
                            </button>
                            <span className="ml-auto text-micro text-muted-foreground">
                                {state.candles.length} real candles loaded — replay walks exactly this set
                            </span>
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}

function ReplayHeader({
    bars,
    setBars,
    onReload,
    disabled,
}: {
    bars: number;
    setBars: (n: number) => void;
    onReload: () => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center gap-2 text-micro text-muted-foreground">
            <span>Window</span>
            {[100, 300, 500, 1000].map((n) => (
                <button
                    key={n}
                    type="button"
                    disabled={disabled}
                    onClick={() => setBars(n)}
                    className={cn(
                        "rounded border px-1.5 py-0.5 font-numeric transition disabled:opacity-50",
                        bars === n ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-muted"
                    )}
                >
                    {n}
                </button>
            ))}
            <button
                type="button"
                onClick={onReload}
                className="ml-auto rounded border border-border px-1.5 py-0.5 transition hover:bg-muted"
            >
                Reload
            </button>
        </div>
    );
}
