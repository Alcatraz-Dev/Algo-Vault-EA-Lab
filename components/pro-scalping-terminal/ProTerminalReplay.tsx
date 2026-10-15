"use client";

/**
 * Market Replay — a real chart, replayed bar by bar.
 *
 * The candle set comes from `/api/replay-data`, which serves whatever the
 * market-data provider has for the requested symbol/timeframe. That exact
 * series is handed to the same `ProTerminalChart` the rest of the app uses, in
 * replay mode: the chart draws only the bars up to its playhead and carries the
 * transport (rewind / step / play-pause / jump / speed / scrubber), so the
 * replay is honest by construction — what you see is the data, and the chart
 * never reveals a bar to the right of the playhead.
 *
 * Because the historical window is the input, the chart's live feed is switched
 * off for this instance (`candles` override ⇒ `enabled: false`): one window,
 * one subscription, no live/market-hours noise on a surface that is replaying
 * the past.
 */

import { useEffect, useMemo, useState } from "react";
import { History, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { ProTerminalChart, type Candle } from "./ProTerminalChart";
import { TERMINAL_TIMEFRAMES, defaultLayerState } from "./chart-layers";
import { useChartSettings } from "@/hooks/use-chart-settings";

type ReplayState = {
    /** Request key the current payload belongs to ("" = none yet). */
    key: string;
    candles: Candle[];
    from: number | null;
    to: number | null;
    error: string | null;
};

const REPLAY_SYMBOLS: SupportedSymbol[] = [
    "XAUUSD",
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "US30",
    "NAS100",
    "BTCUSD",
    "ETHUSD",
];

const WINDOW_OPTIONS = [100, 300, 500, 1000] as const;

export function ProTerminalReplay({ token }: { token: string | null }) {
    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("M5");
    const [bars, setBars] = useState(300);
    const [reload, setReload] = useState(0);

    const { settings } = useChartSettings();
    const layers = useMemo(() => defaultLayerState(), []);

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
                    | { candles?: Candle[]; error?: string }
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
            } catch {
                if (cancelled) return;
                setState({ key: requestKey, candles: [], from: null, to: null, error: "Failed to load replay data." });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbol, timeframe, bars, token, reload, requestKey]);

    if (!token) {
        return (
            <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
                <div className="border-b border-border p-3">
                    <ReplayHeader
                        bars={bars}
                        setBars={setBars}
                        onReload={() => setReload((r) => r + 1)}
                        disabled
                    />
                </div>
                <p className="py-8 text-center text-xs italic text-muted-foreground">
                    Sign in to replay historical candles.
                </p>
            </section>
        );
    }

    const range =
        state.from !== null && state.to !== null
            ? `${new Date(state.from).toISOString().slice(0, 10)} → ${new Date(state.to).toISOString().slice(0, 10)}`
            : "—";

    return (
        <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <History className="size-3.5 shrink-0 text-muted-foreground" />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Market Replay</h2>
                <span className="rounded-full border border-border/60 bg-muted px-1.5 py-0.5 font-numeric text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
                    Bar-by-bar
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <select
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value as SupportedSymbol)}
                        className="rounded-md border border-border bg-background px-1.5 py-0.5 font-numeric text-xs outline-none focus:border-primary/50"
                        aria-label="Replay symbol"
                    >
                        {REPLAY_SYMBOLS.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                    <select
                        value={timeframe}
                        onChange={(e) => setTimeframe(e.target.value as Timeframe)}
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
                    <div className="mt-3 flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-3 py-6 text-center">
                        <TriangleAlert className="size-4 text-warning" />
                        <p className="text-xs font-medium text-muted-foreground">Replay unavailable</p>
                        <p className="text-[8px] text-muted-foreground/80">{state.error}</p>
                    </div>
                ) : loading ? (
                    <div className="mt-3 flex h-[400px] items-center justify-center rounded-lg border border-dashed border-border">
                        <span className="text-xs text-muted-foreground">Loading candles…</span>
                    </div>
                ) : state.candles.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center">
                        <p className="text-xs text-muted-foreground">No candles returned for this window.</p>
                    </div>
                ) : (
                    <>
                        {/* Meta strip: the loaded window only — no future bar is
                            summarised, so replay practice stays honest. */}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-numeric text-[8px] text-muted-foreground">
                            <span>{state.candles.length} bars loaded</span>
                            <span>{range}</span>
                            <span className="ml-auto">
                                Replay with the transport bar on the chart · nothing right of the playhead is drawn
                            </span>
                        </div>

                        <div className="mt-2 overflow-hidden rounded-lg border border-border">
                            <ProTerminalChart
                                symbol={symbol}
                                timeframe={timeframe}
                                layers={layers}
                                analysis={null}
                                height={400}
                                token={token}
                                theme={settings.preset === "light" ? "light" : "dark"}
                                settings={settings}
                                gridVisible={settings.display.grid}
                                candles={state.candles}
                                replayActive
                            />
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
        <div className={cn("flex items-center gap-2 text-[8px] text-muted-foreground", disabled && "opacity-70")}>
            <span>Window</span>
            {WINDOW_OPTIONS.map((n) => (
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
