"use client";

/**
 * AlgoVault Pro Scalping Terminal.
 *
 * One coherent workspace over the platform's real engines:
 *  • Watchlist quotes      → /api/analytics/watchlist (biquote)
 *  • Chart + overlays      → /api/analytics/ohlc + client overlay engines
 *  • MTF / regime / zones  → /api/analysis/intelligence (agent pipeline)
 *  • Radar + live signals  → /api/scalping/radar, /api/scalping/signals
 *  • Journal analytics     → /api/journal (user's own logged trades)
 *  • Economic calendar     → /api/calendar (platform feed)
 *  • Replay                → /api/replay-data (real historical candles)
 *
 * Every panel degrades honestly: when an engine has nothing, the panel says
 * so instead of rendering fabricated values. Polling is centralised here and
 * throttled through `useThrottledAuthedFetch`, which waits for the auth token
 * and aborts superseded requests.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    Cpu,
    Layers,
    Pause,
    Play,
    RefreshCw,
    Terminal as TerminalIcon,
    Wifi,
    WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { RADAR_SYMBOLS } from "@/lib/ai/scalping/watchlist";
import type { RadarResult, TerminalSignal } from "@/lib/ai/scalping/radar";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import {
    useAuthToken,
    useNow,
    useThrottledAuthedFetch,
} from "@/lib/scalping/client";
import { CHART_LAYERS, TERMINAL_TIMEFRAMES, defaultLayerState, type ChartLayerId } from "./chart-layers";
import { fmtSignedPct, fmtTime } from "./terminal-utils";
import {
    CalendarPanel,
    LiquidityPanel,
    MtfPanel,
    RadarMiniPanel,
    RegimeStrip,
    SessionsPanel,
    SignalsMiniPanel,
    WatchlistPanel,
    useCalendar,
    type WatchlistQuote,
} from "./ProTerminalPanels";
import { ProTerminalReplay } from "./ProTerminalReplay";
import { ProTerminalJournal } from "./ProTerminalJournal";
import { ProTerminalChart } from "./ProTerminalChart";
import { parseTrades, type TerminalTrade } from "./terminal-utils";

type RadarPayload = { radar: RadarResult; invalid?: string[] };
type AnalysisPayload = { analysis: AdvancedAnalysisResult; fetchErrors?: Array<{ timeframe: string; reason: string }> };
type SignalsPayload = { signals: TerminalSignal[]; rejected: Array<{ symbol: string; reason: string }> };
type QuotesPayload = { quotes: Record<string, WatchlistQuote> };

const DEFAULT_WATCHLIST: SupportedSymbol[] = RADAR_SYMBOLS.slice(0, 5);

export function ProScalpingTerminal() {
    const token = useAuthToken();
    const now = useNow(1000);

    // ── workspace state ─────────────────────────────────────────────────────
    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("M5");
    const [watchlist, setWatchlist] = useState<SupportedSymbol[]>(DEFAULT_WATCHLIST);
    const [layers, setLayers] = useState<Record<ChartLayerId, boolean>>(defaultLayerState);
    const [layersOpen, setLayersOpen] = useState(false);
    const [pollMs, setPollMs] = useState<number>(30_000);
    const [tick, setTick] = useState(0);
    const [mobileView, setMobileView] = useState<"chart" | "panels">("chart");
    const [riskOpen, setRiskOpen] = useState(false);

    // Risk calculator inputs (persisted per session only).
    const [balance, setBalance] = useState("10000");
    const [riskPct, setRiskPct] = useState("1");

    useEffect(() => {
        if (pollMs === 0) return;
        const id = setInterval(() => setTick((t) => t + 1), pollMs);
        return () => clearInterval(id);
    }, [pollMs]);

    const symbolsParam = useMemo(() => watchlist.join(","), [watchlist]);

    // ── data: quotes, radar, analysis, signals, journal ────────────────────
    const quotesUrl = token ? `/api/analytics/watchlist?symbols=${encodeURIComponent(symbolsParam)}&t=${tick}` : null;
    const radarUrl = token ? `/api/scalping/radar?symbols=${encodeURIComponent(symbolsParam)}&timeframe=${timeframe}&t=${tick}` : null;
    const signalsUrl = token ? `/api/scalping/signals?symbols=${encodeURIComponent(symbolsParam)}&t=${tick}` : null;
    const analysisUrl = token ? `/api/analysis/intelligence?symbol=${symbol}&timeframe=${timeframe}&t=${tick}` : null;
    const journalUrl = token ? `/api/journal` : null;

    const quotes = useThrottledAuthedFetch<QuotesPayload>(quotesUrl, { minIntervalMs: 8000, enabled: !!token });
    const radar = useThrottledAuthedFetch<RadarPayload>(radarUrl, { minIntervalMs: 8000, enabled: !!token });
    const analysis = useThrottledAuthedFetch<AnalysisPayload>(analysisUrl, { minIntervalMs: 8000, enabled: !!token });
    const signals = useThrottledAuthedFetch<SignalsPayload>(signalsUrl, { minIntervalMs: 10000, enabled: !!token });
    const journal = useThrottledAuthedFetch<{ trades: unknown[] }>(journalUrl, { minIntervalMs: 60000, enabled: !!token });
    const journalTrades: TerminalTrade[] = useMemo(() => parseTrades(journal.data?.trades ?? []), [journal.data]);
    const calendar = useCalendar();

    const accessError = [radar.error, analysis.error, signals.error].find((e) => e && /license|subscription|plan|access/i.test(e));

    const refreshAll = useCallback(() => {
        setTick((t) => t + 1);
    }, []);

    // ⌘K / Ctrl+K focuses symbol search; R refreshes. Small but real keyboard support.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                document.getElementById("pro-terminal-symbol-filter")?.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const activeQuote = quotes.data?.quotes?.[symbol] ?? null;
    const lastPrice = radar.data?.radar.rows.find((r) => r.symbol === symbol)?.lastPrice.value ?? activeQuote?.bid ?? null;
    const changePercent =
        radar.data?.radar.rows.find((r) => r.symbol === symbol)?.changePercent.value ?? activeQuote?.changePercent ?? null;

    const onAddSymbol = useCallback((s: SupportedSymbol) => {
        setWatchlist((prev) => (prev.includes(s) ? prev : [...prev, s].slice(0, 12)));
    }, []);
    const onRemoveSymbol = useCallback((s: SupportedSymbol) => {
        setWatchlist((prev) => {
            if (prev.length === 1) return prev; // never empty the watchlist
            const next = prev.filter((x) => x !== s);
            if (s === symbol) setSymbol(next[0]);
            return next;
        });
    }, [symbol]);

    const toggleLayer = useCallback((id: ChartLayerId) => {
        setLayers((prev) => ({ ...prev, [id]: !prev[id] }));
    }, []);

    const unavailableLayers = CHART_LAYERS.filter((l) => !l.available);

    if (!token) {
        return (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
                <TerminalIcon className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Authenticating the terminal…</p>
            </div>
        );
    }

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {/* ── command bar ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <TerminalIcon className="size-3.5" />
                    </div>
                    <div className="min-w-0 leading-none">
                        <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold tracking-tight text-foreground">AlgoVault Pro</span>
                            <span className="rounded border border-primary/30 px-1 py-0.5 text-[9px] font-bold tracking-wider text-primary">
                                PRO
                            </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                            <span>{symbol}</span>
                            <span className="text-border">·</span>
                            <span>{timeframe}</span>
                            <span className="text-border">·</span>
                            <span className="tabular-nums">{fmtTime(now)}</span>
                        </div>
                    </div>
                </div>

                {lastPrice !== null ? (
                    <div className="flex items-baseline gap-1.5 px-1">
                        <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                            {lastPrice >= 100 ? lastPrice.toFixed(2) : lastPrice.toFixed(5)}
                        </span>
                        <span
                            className={cn(
                                "font-mono text-xs tabular-nums",
                                (changePercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                            )}
                        >
                            {fmtSignedPct(changePercent, 3)}
                        </span>
                    </div>
                ) : null}

                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setPollMs((p) => (p === 0 ? 30_000 : 0))}
                        className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition",
                            pollMs === 0
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        )}
                        aria-label={pollMs === 0 ? "Resume live polling" : "Pause live polling"}
                    >
                        {pollMs === 0 ? <Pause className="size-3" /> : <Play className="size-3" />}
                        {pollMs === 0 ? "Paused" : "Live"}
                    </button>
                    <select
                        value={pollMs}
                        onChange={(e) => setPollMs(Number(e.target.value))}
                        className="rounded-md border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-primary/50"
                        aria-label="Poll interval"
                    >
                        <option value={0}>Off</option>
                        <option value={15000}>15s</option>
                        <option value={30000}>30s</option>
                        <option value={60000}>60s</option>
                        <option value={300000}>5m</option>
                    </select>
                    <button
                        type="button"
                        onClick={refreshAll}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs transition hover:bg-muted"
                        aria-label="Refresh all data"
                    >
                        <RefreshCw className={cn("size-3", (quotes.loading || radar.loading || analysis.loading) && "animate-spin")} />
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={() => setRiskOpen((o) => !o)}
                        aria-expanded={riskOpen}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs transition hover:bg-muted"
                    >
                        Risk
                    </button>
                </div>

                {/* Risk calculator drawer */}
                {riskOpen ? (
                    <div className="w-full rounded-md border border-border bg-background p-2.5">
                        <RiskCalculator
                            symbol={symbol}
                            price={lastPrice}
                            analysis={analysis.data?.analysis ?? null}
                            balance={balance}
                            setBalance={setBalance}
                            riskPct={riskPct}
                            setRiskPct={setRiskPct}
                        />
                    </div>
                ) : null}
            </div>

            {/* access / engine errors */}
            {accessError ? (
                <div role="alert" className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                    <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
                    <span className="min-w-0 text-amber-200">{accessError}</span>
                </div>
            ) : null}

            {/* ── mobile view switch ──────────────────────────────────────── */}
            <div className="flex gap-1 rounded-lg border border-border bg-card p-1 lg:hidden">
                {(["chart", "panels"] as const).map((v) => (
                    <button
                        key={v}
                        type="button"
                        onClick={() => setMobileView(v)}
                        className={cn(
                            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition",
                            mobileView === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                        )}
                        aria-pressed={mobileView === v}
                    >
                        {v === "chart" ? "Chart" : "Panels"}
                    </button>
                ))}
            </div>

            {/* ── main grid ───────────────────────────────────────────────── */}
            <div className="grid min-w-0 gap-3 xl:grid-cols-[230px_minmax(0,1fr)_330px]">
                {/* Left rail */}
                <aside className={cn("flex min-w-0 flex-col gap-3", mobileView === "panels" && "hidden xl:flex")}>
                    <WatchlistPanel
                        quotes={quotes.data?.quotes ?? {}}
                        active={symbol}
                        watchlist={watchlist}
                        onSelect={setSymbol}
                        onAdd={onAddSymbol}
                        onRemove={onRemoveSymbol}
                        quotesLoading={quotes.loading}
                    />
                    <SessionsPanel now={now} />
                </aside>

                {/* Center: chart + engines */}
                <div className={cn("flex min-w-0 flex-col gap-3", mobileView === "panels" && "hidden xl:flex")}>
                    <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setLayersOpen((o) => !o)}
                                aria-expanded={layersOpen}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs transition hover:bg-muted"
                            >
                                <Layers className="size-3.5" />
                                Overlays
                                <span className="font-mono text-[10px] text-muted-foreground">
                                    {Object.values(layers).filter(Boolean).length}
                                </span>
                            </button>
                            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground" title="This terminal runs the deterministic measurement pipeline. It makes no LLM calls and consumes no AI budget.">
                                <Cpu className="size-3" />
                                Deterministic · 0 AI spend
                            </span>
                            {unavailableLayers.length > 0 ? (
                                <span className="text-[10px] text-muted-foreground">
                                    {unavailableLayers.map((l) => l.label).join(", ")} — not yet rendered
                                </span>
                            ) : null}
                        </div>
                        {layersOpen ? (
                            <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-2.5">
                                {CHART_LAYERS.map((l) => (
                                    <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => l.available && toggleLayer(l.id)}
                                        disabled={!l.available}
                                        aria-pressed={layers[l.id]}
                                        className={cn(
                                            "rounded-md border px-2 py-0.5 text-xs transition",
                                            !l.available
                                                ? "cursor-not-allowed border-border/50 text-muted-foreground/40"
                                                : layers[l.id]
                                                  ? "border-primary/40 bg-primary/10 text-primary"
                                                  : "border-border bg-background text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {l.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <ProTerminalChart
                        symbol={symbol}
                        timeframe={timeframe}
                        layers={layers}
                        analysis={analysis.data?.analysis ?? null}
                        token={token}
                        height={520}
                        signals={signals.data?.signals ?? []}
                    />

                    <RegimeStrip analysis={analysis.data?.analysis ?? null} loading={analysis.loading} />

                    {/* timeframe picker */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Execution TF</span>
                        <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
                            {TERMINAL_TIMEFRAMES.map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTimeframe(t)}
                                    aria-pressed={timeframe === t}
                                    className={cn(
                                        "rounded-md px-2 py-1 font-mono text-xs transition",
                                        timeframe === t ? "bg-primary/10 font-bold text-primary" : "text-muted-foreground hover:bg-muted"
                                    )}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                        {analysis.data?.fetchErrors && analysis.data.fetchErrors.length > 0 ? (
                            <span className="text-[10px] text-muted-foreground">
                                {analysis.data.fetchErrors.map((f) => f.timeframe).join(", ")} unavailable from provider
                            </span>
                        ) : null}
                    </div>

                    {/* MTF + liquidity */}
                    <div className="grid min-w-0 gap-3 md:grid-cols-2">
                        <MtfPanel analysis={analysis.data?.analysis ?? null} loading={analysis.loading} error={analysis.error} />
                        <LiquidityPanel analysis={analysis.data?.analysis ?? null} loading={analysis.loading} />
                    </div>

                    <CalendarPanel
                        events={calendar.events}
                        loading={calendar.loading}
                        error={calendar.error}
                        activeSymbol={symbol}
                        now={now}
                    />

                    <ProTerminalReplay token={token} />
                </div>

                {/* Right rail */}
                <aside className={cn("flex min-w-0 flex-col gap-3", mobileView === "chart" && "hidden xl:flex")}>
                    <RadarMiniPanel
                        radar={radar.data?.radar ?? null}
                        loading={radar.loading}
                        activeSymbol={symbol}
                        onSelectSymbol={setSymbol}
                    />
                    <SignalsMiniPanel
                        signals={signals.data?.signals ?? []}
                        rejected={signals.data?.rejected ?? []}
                        loading={signals.loading}
                        now={now}
                    />
                    <ProTerminalJournal trades={journalTrades} loading={journal.loading} error={journal.error} now={now} />

                    <div className="rounded-lg border border-border bg-card p-3">
                        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                            {pollMs === 0 ? <WifiOff className="size-3 text-amber-400" /> : <Wifi className="size-3 text-emerald-400" />}
                            Data status
                        </h3>
                        <ul className="mt-1.5 space-y-1 font-mono text-[10px] text-muted-foreground">
                            <li>quotes · {quotes.lastUpdated ? fmtTime(quotes.lastUpdated) : "—"}</li>
                            <li>radar · {radar.lastUpdated ? fmtTime(radar.lastUpdated) : "—"}</li>
                            <li>analysis · {analysis.lastUpdated ? fmtTime(analysis.lastUpdated) : "—"}</li>
                            <li>signals · {signals.lastUpdated ? fmtTime(signals.lastUpdated) : "—"}</li>
                            <li>journal · {journal.lastUpdated ? fmtTime(journal.lastUpdated) : "—"}</li>
                        </ul>
                    </div>
                </aside>
            </div>

            <p className="text-[10px] leading-4 text-muted-foreground">
                All measurements come from the AlgoVault market-data and analytics engines; the terminal makes no AI model calls.
                Signals are produced by the deterministic scanner only when its confidence and R:R gates pass. Analytics use only
                your own journal entries. Nothing here is financial advice.
            </p>
        </div>
    );
}

// ── risk calculator ─────────────────────────────────────────────────────────

function RiskCalculator({
    symbol,
    price,
    analysis,
    balance,
    setBalance,
    riskPct,
    setRiskPct,
}: {
    symbol: SupportedSymbol;
    price: number | null;
    analysis: AdvancedAnalysisResult | null;
    balance: string;
    setBalance: (v: string) => void;
    riskPct: string;
    setRiskPct: (v: string) => void;
}) {
    const nearestSupport = analysis?.structure.support.value?.[0]?.price ?? null;
    const stopCandidate = nearestSupport ?? null;

    const bal = Number(balance);
    const pct = Number(riskPct);
    const entry = price;
    const stop = stopCandidate;

    let sizing: { lots: number; riskAmount: number; stopDistance: number } | null = null;
    if (Number.isFinite(bal) && Number.isFinite(pct) && entry !== null && stop !== null && stop < entry) {
        const riskAmount = (bal * pct) / 100;
        const stopDistance = entry - stop;
        const contract = symbol === "XAUUSD" ? 100 : 1;
        sizing = { riskAmount, stopDistance, lots: riskAmount / (stopDistance * contract) };
    }

    return (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-xs">
            <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Balance</span>
                <input
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                    inputMode="decimal"
                    className="w-24 rounded-md border border-border bg-card px-2 py-1 font-mono tabular-nums outline-none focus:border-primary/50"
                />
            </label>
            <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk %</span>
                <input
                    value={riskPct}
                    onChange={(e) => setRiskPct(e.target.value)}
                    inputMode="decimal"
                    className="w-16 rounded-md border border-border bg-card px-2 py-1 font-mono tabular-nums outline-none focus:border-primary/50"
                />
            </label>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Entry (live)</span>
                <span className="font-mono tabular-nums text-foreground">{price !== null ? price.toFixed(price >= 100 ? 2 : 5) : "—"}</span>
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Stop (nearest S)</span>
                <span className="font-mono tabular-nums text-foreground">{stop !== null ? stop.toFixed(stop >= 100 ? 2 : 5) : "—"}</span>
            </div>
            {sizing ? (
                <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Suggested size</span>
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                        {sizing.lots < 0.01 ? `${(sizing.lots * 100).toFixed(2)} mini-lots` : `${sizing.lots.toFixed(2)} lots`}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                        risks ≈ {sizing.riskAmount.toFixed(2)} over {sizing.stopDistance.toFixed(sizing.stopDistance >= 10 ? 2 : 5)} of price
                    </span>
                </div>
            ) : (
                <p className="text-[10px] text-muted-foreground">
                    {nearestSupport === null
                        ? "No structural support level available for a stop reference."
                        : "Nearest support is above the live price — no long sizing suggestion."}
                </p>
            )}
            <p className="w-full text-[10px] text-muted-foreground">
                Sizing uses standard contract conventions (XAUUSD 100 oz/lot). Verify contract specs with your broker — this is a
                calculation aid, not an order ticket.
            </p>
        </div>
    );
}
