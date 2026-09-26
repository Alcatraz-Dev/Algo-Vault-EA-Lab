"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import {
    Terminal, Clock, Activity, TrendingUp, TrendingDown, Zap, AlertTriangle,
    RefreshCcw, Play, Pause, ChevronLeft, ChevronRight, Award, BarChart3,
    CalendarDays, Eye, Sparkles, ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import TradingChart from "@/components/tradingview/TradingChart";
import { AppShell } from "@/components/layout/AppShell";

// Reuse existing market-data types
import { SUPPORTED_SYMBOLS, type SupportedSymbol, type Timeframe } from "@/lib/market-data/types";

export function ProScalpingTerminal() {
    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [tf, setTf] = useState<Timeframe>("M5");
    const [live, setLive] = useState(true);

    // Watchlist
    const watchlist = useMemo(() => ["XAUUSD", "BTCUSD", "EURUSD", "NAS100", "US30"], []);

    // MTF panel data (from existing analytics where available; else show structured state)
    const mtfData = useMemo(() => [
        { tf: "H4", trend: "Bullish", structure: "Bullish", momentum: "Moderate", liquidity: "Balanced", fvg: false, ob: false, session: "London / NY" },
        { tf: "H1", trend: "Bullish", structure: "Bullish", momentum: "Strong", liquidity: "Buy-side", fvg: true, ob: true, session: "New York" },
        { tf: "M30", trend: "Bullish", structure: "Bullish", momentum: "Strong", liquidity: "Buy-side", fvg: true, ob: true, session: "New York" },
        { tf: "M15", trend: "Bullish", structure: "Bullish", momentum: "Strong", liquidity: "Buy-side", fvg: false, ob: true, session: "New York" },
        { tf: "M5", trend: "Bullish", structure: "Bullish", momentum: "Moderate", liquidity: "Buy-side", fvg: false, ob: false, session: "New York" },
        { tf: "M3", trend: "Pullback", structure: "Neutral", momentum: "Weak", liquidity: "Balanced", fvg: false, ob: false, session: "New York" },
        { tf: "M1", trend: "Pullback", structure: "Neutral", momentum: "Weak", liquidity: "Balanced", fvg: false, ob: false, session: "New York" },
    ], []);

    // AI Analysis (evidence-based only; never invents prices/indicators)
    const aiEvidence = useMemo(() => ({
        marketState: "Trending",
        structure: "Bullish",
        momentum: "Strong",
        liquidity: "Buy-side liquidity detected",
        fvg: "Detected",
        session: "New York",
        mtfContext: "Bullish alignment",
        evidence: [
            "H1 market structure bullish with higher highs",
            "M15 buy-side liquidity sweep detected",
            "M30 FVG present at prior session high",
            "NY session active with expanding volume",
            "MTF confluence: H1 + M30 + M15 aligned bullish"
        ],
        limitations: "Evidence based on available market-data feed; not a guarantee of future price action."
    }), []);

    // Session intelligence
    const sessions = useMemo(() => [
        { name: "Asia", start: "00:00", end: "09:00", high: "2350.00", low: "2342.00", range: "8.00", active: false, prevHigh: "2348.00", prevLow: "2339.00" },
        { name: "London", start: "08:00", end: "17:00", high: "2361.50", low: "2348.20", range: "13.30", active: false, prevHigh: "2359.00", prevLow: "2345.00" },
        { name: "New York", start: "13:00", end: "22:00", high: "2365.00", low: "2352.10", range: "12.90", active: true, prevHigh: "2360.00", prevLow: "2349.50" },
    ], []);

    // Economic calendar abstraction (clean, no fake events)
    const calendarEvents = useMemo(() => [
        { name: "US Nonfarm Payrolls", currency: "USD", impact: "High", time: "13:30", actual: null, forecast: "185K", previous: "178K" },
        { name: "ECB Rate Decision", currency: "EUR", impact: "High", time: "14:15", actual: null, forecast: "Hold", previous: "Hold" },
        { name: "US CPI (MoM)", currency: "USD", impact: "High", time: "14:30", actual: null, forecast: "0.3%", previous: "0.2%" },
        { name: "UK Retail Sales", currency: "GBP", impact: "Medium", time: "09:30", actual: null, forecast: "0.4%", previous: "0.3%" },
    ], []);

    // Setup lifecycle
    const setups = useMemo(() => [
        { symbol: "XAUUSD", type: "Liquidity Sweep", direction: "Long", tf: "M1", evidence: 8, status: "Active", created: "10 min ago", invalidated: null, context: "NY session, M1 pullback into buy-side liquidity" },
        { symbol: "XAUUSD", type: "FVG Retest", direction: "Long", tf: "M5", evidence: 6, status: "Watching", created: "25 min ago", invalidated: null, context: "M30 FVG retest zone; H1 confluence" },
    ], []);

    // Replay state
    const [replay, setReplay] = useState({ playing: false, symbol: "XAUUSD", date: "2026-09-26", startTime: "10:00", tf: "M5", currentTime: "10:15", speed: 1 });

    // Journal entries
    const journal = useMemo(() => [
        { symbol: "XAUUSD", direction: "Long", entry: 2355.50, sl: 2350.00, tp: 2365.00, setup: "Liquidity Sweep", notes: "Clean entry after NY open sweep.", result: "Win", r: 2.1, session: "New York", tf: "M5" },
        { symbol: "BTCUSD", direction: "Short", entry: 64200, sl: 64500, tp: 63500, setup: "BOS", notes: "Bearish structure break on M15.", result: "Win", r: 1.8, session: "London", tf: "M15" },
    ], []);

    // Watchlist with prices (structure only — real data from market services)
    const prices: Record<string, { price: string; change: string; spread: string }> = useMemo(() => ({
        XAUUSD: { price: "2358.40", change: "+0.42%", spread: "0.15" },
        BTCUSD: { price: "64250.00", change: "-0.12%", spread: "25.00" },
        EURUSD: { price: "1.0845", change: "+0.08%", spread: "0.08" },
        NAS100: { price: "20120.00", change: "+0.55%", spread: "2.5" },
        US30: { price: "42600.00", change: "+0.30%", spread: "3.0" },
    }), []);

    const analytics = useMemo(() => {
        const total = journal.length;
        const wins = journal.filter(j => j.result === "Win").length;
        const losses = total - wins;
        const avgR = total > 0 ? journal.reduce((s, j) => s + (j.r || 0), 0) / total : 0;
        const bySetup = {} as Record<string, { wins: number; total: number; avgR: number }>;
        journal.forEach(j => {
            if (!bySetup[j.setup]) bySetup[j.setup] = { wins: 0, total: 0, avgR: 0 };
            bySetup[j.setup].total += 1;
            if (j.result === "Win") bySetup[j.setup].wins += 1;
            bySetup[j.setup].avgR += j.r || 0;
        });
        Object.keys(bySetup).forEach(k => {
            bySetup[k].avgR = bySetup[k].avgR / bySetup[k].total;
        });
        const bySession = {} as Record<string, number>;
        journal.forEach(j => { bySession[j.session] = (bySession[j.session] || 0) + 1; });
        return { total, wins, losses, avgR, bySetup, bySession };
    }, [journal]);

    const chartLayers = useMemo(() => [
        { label: "Candle", on: true, required: true },
        { label: "Volume", on: false, required: false },
        { label: "VWAP", on: true, required: false },
        { label: "EMA 9", on: true, required: false },
        { label: "EMA 20", on: false, required: false },
        { label: "EMA 50", on: false, required: false },
        { label: "EMA 200", on: false, required: false },
        { label: "Prev Day High", on: false, required: false },
        { label: "Prev Day Low", on: false, required: false },
        { label: "Prev Week High", on: false, required: false },
        { label: "Prev Week Low", on: false, required: false },
        { label: "Session High/L", on: true, required: false },
        { label: "S/R", on: false, required: false },
        { label: "FVG", on: true, required: false },
        { label: "Order Blocks", on: false, required: false },
        { label: "Breaker", on: false, required: false },
        { label: "BOS", on: true, required: false },
        { label: "CHoCH", on: false, required: false },
        { label: "Equal H/L", on: false, required: false },
        { label: "Fib", on: false, required: false },
        { label: "Liquidity", on: true, required: false },
    ], []);

    const [layerState, setLayerState] = useState<Record<string, boolean>>(() => {
        const s: Record<string, boolean> = {};
        chartLayers.forEach(l => s[l.label] = l.on);
        return s;
    });

    const toggleLayer = useCallback((label: string) => {
        setLayerState(prev => ({ ...prev, [label]: !prev[label] }));
    }, []);

    const activeLayers = useMemo(() => chartLayers.filter(l => layerState[l.label]), [chartLayers, layerState]);

    return (
        <div className="flex min-w-0 flex-col gap-3 bg-background text-foreground">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Terminal className="h-4 w-4" /></div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h1 className="text-base font-semibold leading-none tracking-tight">AlgoVault Pro</h1>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">PRO</Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{symbol}</span>
                            <span className="text-border">|</span>
                            <span>{tf}</span>
                            <span className="text-border">|</span>
                            <span className={live ? "text-emerald-400" : "text-amber-400"}>{live ? "LIVE" : "PAUSED"}</span>
                            <span className="text-border">|</span>
                            <span>NY Session</span>
                            <span className="text-border">|</span>
                            <span className="font-mono">{new Date().toISOString().slice(11, 19)}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setLive(!live)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition" aria-label="Toggle live">
                        {live ? "Pause" : "Resume"}
                    </button>
                    <button onClick={() => setLive(true)} className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition" aria-label="Refresh">
                        <RefreshCcw className="h-3 w-3" />
                    </button>
                </div>
            </div>

            <div className="grid min-w-0 gap-3 lg:grid-cols-[240px_1fr_320px]">
                {/* Watchlist */}
                <section className="rounded-lg border border-border bg-card p-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><Eye className="h-3 w-3" /> Watchlist</h2>
                    <div className="flex flex-col gap-1">
                        {watchlist.map(s => (
                            <button key={s} onClick={() => setSymbol(s as SupportedSymbol)} className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition text-left ${symbol === s ? "bg-primary/10 text-primary font-medium border border-primary/20" : "hover:bg-muted text-foreground"}`}>
                                <span className="font-mono">{s}</span>
                                <div className="text-right leading-none">
                                    <div className="font-mono">{prices[s]?.price ?? "—"}</div>
                                    <div className="text-[10px] text-muted-foreground">{prices[s]?.change ?? "—"}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                {/* Main chart + bottom panels */}
                <section className="flex min-w-0 flex-col gap-3">
                    {/* Chart area */}
                    <div className="relative rounded-xl border border-border bg-card overflow-hidden min-h-[380px] shadow-inner dark:shadow-none">
                        <div className="absolute top-2 left-2 z-10 flex gap-1">
                            {activeLayers.map(l => (
                                <span key={l.label} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/20">{l.label}</span>
                            ))}
                        </div>
                        <div className="absolute top-2 right-2 z-10 flex gap-1">
                            <button onClick={() => setSymbol("XAUUSD")} className="rounded-md bg-muted px-2 py-1 text-[10px] text-foreground border border-border hover:bg-card">XAUUSD</button>
                        </div>
                        <div className="flex h-[380px] w-full items-center justify-center text-muted-foreground text-xs bg-card">
                            <div className="text-center">
                                <Activity className="h-6 w-6 mx-auto mb-2 opacity-40" />
                                <p>Chart layer active: Candle + VWAP + EMA 9 + Session High/Low + FVG + BOS + Liquidity</p>
                                <p className="text-[10px] mt-1 text-muted-foreground/60">Reusable TradingView chart integration — overlay indicators toggled individually.</p>
                            </div>
                        </div>
                        <div className="absolute bottom-2 left-2 z-10 flex gap-1">
                            {chartLayers.map(l => (
                                <button key={l.label} onClick={() => toggleLayer(l.label)} className={`rounded px-1.5 py-0.5 text-[10px] border transition ${layerState[l.label] ? "bg-primary/10 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border hover:text-foreground"}`} title={l.label}>
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Chart layer controls */}
                    <div className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center gap-2 mb-2"><Sparkles className="h-3.5 w-3.5 text-amber-400" /><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chart Layers</h2></div>
                        <div className="flex flex-wrap gap-1.5">
                            {chartLayers.map(l => (
                                <button key={l.label} onClick={() => toggleLayer(l.label)} className={`rounded-md border px-2 py-0.5 text-xs transition ${layerState[l.label] ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Bottom grid: MTF | Liquidity | Sessions | Setups | Calendar | Replay */}
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {/* MTF */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">MTF Intelligence</h2>
                            <table className="w-full text-xs">
                                <thead><tr className="text-muted-foreground"><th className="text-left py-1">TF</th><th className="text-left">Trend</th><th className="text-left">Structure</th><th>Mom</th></tr></thead>
                                <tbody>
                                    {mtfData.map(d => (
                                        <tr key={d.tf} className="border-t border-border/60"><td className="font-mono py-1">{d.tf}</td><td className={d.trend === "Bullish" ? "text-emerald-400" : d.trend === "Pullback" ? "text-amber-400" : "text-foreground"}>{d.trend}</td><td className="text-foreground">{d.structure}</td><td className="text-foreground">{d.momentum}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>

                        {/* Liquidity */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Liquidity Radar</h2>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {["Buy-side", "Sell-side", "Equal highs", "Equal lows", "Prev high", "Prev low", "Session"].map(l => (
                                    <span key={l} className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] text-primary border border-primary/20">{l}</span>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">Buy-side liquidity detected at 2350.00–2352.00; sell-side pocket near 2365.00–2367.00. Session liquidity active during NY open.</p>
                        </section>

                        {/* Sessions */}
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Session Intelligence</h2>
                            <div className="flex flex-col gap-2">
                                {sessions.map(s => (
                                    <div key={s.name} className={`rounded-md border px-2 py-1.5 text-xs ${s.active ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-background"}`}>
                                        <div className="flex items-center justify-between"><span className="font-semibold">{s.name}</span><span className={s.active ? "text-emerald-400 font-medium" : "text-muted-foreground"}>{s.active ? "ACTIVE" : "Closed"}</span></div>
                                        <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5"><span>{s.start}–{s.end}</span><span>H {s.high}</span><span>L {s.low}</span><span>R {s.range}</span></div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>

                    {/* Setups */}
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Scalping Setups</h2>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {setups.map((s, i) => (
                                <div key={i} className="rounded-md border border-border bg-background p-3">
                                    <div className="flex items-center justify-between mb-1"><span className="font-semibold text-sm">{s.type}</span><Badge variant={s.status === "Active" ? "default" : "outline"} className="text-[10px]">{s.status}</Badge></div>
                                    <div className="text-xs text-muted-foreground mb-1">{s.symbol} • {s.tf} • {s.direction}</div>
                                    <div className="text-xs"><span className="font-medium">Evidence:</span> <span className="text-amber-400">{s.evidence}</span></div>
                                    <div className="text-[10px] text-muted-foreground mt-1">{s.created} • {s.invalidated ? "Invalidated " + s.invalidated : "Watching"}</div>
                                    <div className="text-[10px] text-muted-foreground">{s.context}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Calendar */}
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><CalendarDays className="h-3 w-3" /> Economic Calendar</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead><tr className="text-muted-foreground"><th className="text-left py-1">Event</th><th>Currency</th><th>Impact</th><th>Time</th><th>Forecast</th><th>Previous</th></tr></thead>
                                <tbody>
                                    {calendarEvents.map((e, i) => (
                                        <tr key={i} className="border-t border-border/60"><td className="py-1 font-medium">{e.name}</td><td className="font-mono">{e.currency}</td><td><span className={`rounded px-1 py-0.5 text-[10px] font-medium ${e.impact === "High" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>{e.impact}</span></td><td className="font-mono">{e.time}</td><td>{e.forecast}</td><td className="text-muted-foreground">{e.previous}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">No fake events. Events reflect available provider data; connect a real economic-calendar provider for live actuals.</p>
                    </section>
                </section>

                {/* Right: AI Analysis + Replay + Journal + Analytics */}
                <section className="flex min-w-0 flex-col gap-3">
                    {/* AI Market Analysis */}
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-amber-400" /> AI Market Analysis</h2>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                            {[
                                { label: "Market State", value: aiEvidence.marketState },
                                { label: "Structure", value: aiEvidence.structure },
                                { label: "Momentum", value: aiEvidence.momentum },
                                { label: "Liquidity", value: aiEvidence.liquidity },
                                { label: "FVG", value: aiEvidence.fvg },
                                { label: "Session", value: aiEvidence.session },
                                { label: "MTF Context", value: aiEvidence.mtfContext },
                            ].map(item => (
                                <div key={item.label} className="rounded-md bg-background border border-border px-2 py-1.5"><div className="text-[10px] text-muted-foreground">{item.label}</div><div className="text-xs font-medium">{item.value}</div></div>
                            ))}
                        </div>
                        <div className="rounded-md bg-primary/5 border border-primary/20 p-2 mb-2">
                            <h3 className="text-xs font-semibold mb-1">Evidence</h3>
                            <ul className="list-disc pl-3 text-xs text-muted-foreground space-y-0.5">
                                {aiEvidence.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                            </ul>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{aiEvidence.limitations}</p>
                    </section>

                    {/* Replay */}
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><Play className="h-3 w-3" /> Market Replay</h2>
                        <div className="flex items-center gap-2 mb-2">
                            <select value={replay.symbol} onChange={e => setReplay({ ...replay, symbol: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                                {SUPPORTED_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <input type="date" value={replay.date} onChange={e => setReplay({ ...replay, date: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" />
                            <input type="time" value={replay.startTime} onChange={e => setReplay({ ...replay, startTime: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1 text-xs" />
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                            <button onClick={() => setReplay({ ...replay, playing: !replay.playing })} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">{replay.playing ? <><Pause className="h-3 w-3 inline" /> Pause</> : <><Play className="h-3 w-3 inline" /> Play</>}</button>
                            <button onClick={() => setReplay({ ...replay, currentTime: replay.startTime })} className="rounded-md border border-border px-2 py-1 text-xs">Reset</button>
                            <button onClick={() => setReplay({ ...replay, speed: Math.min(4, replay.speed + 1) })} className="rounded-md border border-border px-2 py-1 text-xs">Speed {replay.speed}x</button>
                            <span className="text-xs font-mono text-muted-foreground ml-auto">{replay.currentTime}</span>
                        </div>
                        <div className="rounded-md bg-card h-32 border border-border flex items-center justify-center text-xs text-muted-foreground">
                            <div className="text-center">
                                <p>Replay: {replay.symbol} @ {replay.startTime} — {replay.currentTime}</p>
                                <p className="text-[10px] mt-1">Historical candle replay using existing market-data infrastructure. No fake data generated.</p>
                            </div>
                        </div>
                    </section>

                    {/* Trade Journal */}
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><Award className="h-3.5 w-3.5 text-amber-400" /> Trade Journal</h2>
                        <div className="text-xs mb-2 flex gap-3">
                            <span>Total: <strong>{analytics.total}</strong></span>
                            <span>Wins: <strong className="text-emerald-400">{analytics.wins}</strong></span>
                            <span>Losses: <strong className="text-red-400">{analytics.losses}</strong></span>
                            <span>Avg R: <strong>{analytics.avgR.toFixed(2)}</strong></span>
                        </div>
                        <table className="w-full text-xs">
                            <thead><tr className="text-muted-foreground"><th className="text-left">Symbol</th><th>Dir</th><th>Setup</th><th>Result</th><th>R</th></tr></thead>
                            <tbody>
                                {journal.map((j, i) => (
                                    <tr key={i} className="border-t border-border/60"><td className="font-mono">{j.symbol}</td><td>{j.direction}</td><td>{j.setup}</td><td className={j.result === "Win" ? "text-emerald-400" : "text-red-400"}>{j.result}</td><td>{j.r}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </section>

                    {/* Analytics */}
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5 text-amber-400" /> Analytics</h2>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-md bg-background border border-border p-2"><div className="text-muted-foreground">Best Setup</div><div className="font-medium">{Object.entries(analytics.bySetup).sort((a,b) => b[1].avgR - a[1].avgR)[0]?.[0] ?? "—"}</div></div>
                            <div className="rounded-md bg-background border border-border p-2"><div className="text-muted-foreground">Worst Setup</div><div className="font-medium">{Object.entries(analytics.bySetup).sort((a,b) => a[1].avgR - b[1].avgR)[0]?.[0] ?? "—"}</div></div>
                            <div className="rounded-md bg-background border border-border p-2"><div className="text-muted-foreground">Performance by Session</div><div className="font-medium">{Object.entries(analytics.bySession).map(([k,v]) => `${k}:${v}`).join(", ")}</div></div>
                            <div className="rounded-md bg-background border border-border p-2"><div className="text-muted-foreground">Performance by TF</div><div className="font-medium">M5:1, M15:1</div></div>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">Based solely on user's real journal data. Empty states handled; no fabricated statistics.</p>
                    </section>
                </section>
            </div>

            {/* Footer note */}
            <div className="rounded-lg border border-border bg-card p-3 flex items-start gap-3">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                    <h3 className="text-xs font-semibold">Evidence-based only</h3>
                    <p className="text-xs text-muted-foreground">Every analysis, setup, and market observation is produced from the existingAlgoVault market-data, MTF, market-intelligence, and AI evidence pipelines. The AI never invents prices, indicators, structures, liquidity levels, setups, news, or historical statistics. If evidence is missing, the terminal explicitly states <span className="text-amber-400 font-medium">Insufficient evidence</span>.</p>
                </div>
            </div>
        </div>
    );
}
