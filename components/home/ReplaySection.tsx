"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Play, Pause, SkipBack, SkipForward, RotateCcw, Scissors, TrendingUp, TrendingDown, RefreshCw, Zap } from "lucide-react";

export default function ReplaySection() {
    const [cursor, setCursor] = useState(120);
    const [isPlaying, setIsPlaying] = useState(true);
    const [speed, setSpeed] = useState(1);
    const [isCutoffMode, setIsCutoffMode] = useState(false);
    
    // Interactive Paper Trade state inside Homepage Demo
    const [position, setPosition] = useState<{ type: "LONG" | "SHORT"; entry: number; tp: number; sl: number } | null>(null);
    const [pnl, setPnl] = useState(420.50);
    const [tradesCount, setTradesCount] = useState(8);
    const [winsCount, setWinsCount] = useState(6);

    const totalBars = 240;

    // Simulated historical candle data generation for the SVG chart
    const candleData = Array.from({ length: totalBars }).map((_, i) => {
        const base = 2620 + Math.sin(i * 0.1) * 35 + Math.cos(i * 0.05) * 20 + (i * 0.15);
        const open = base;
        const close = base + (Math.sin(i * 1.5) * 6);
        const high = Math.max(open, close) + Math.abs(Math.cos(i) * 4);
        const low = Math.min(open, close) - Math.abs(Math.sin(i) * 4);
        return { open, close, high, low, isUp: close >= open };
    });

    const visibleCandles = candleData.slice(0, cursor);
    const currentCandle = visibleCandles[visibleCandles.length - 1] || candleData[0];
    const currentPrice = currentCandle.close;

    useEffect(() => {
        if (!isPlaying) return;
        const timer = setInterval(() => {
            setCursor((prev) => {
                if (prev >= totalBars) {
                    setIsPlaying(false);
                    return prev;
                }
                return prev + 1;
            });
        }, 800 / speed);
        return () => clearInterval(timer);
    }, [isPlaying, speed]);

    // Handle paper position updates
    const handleBuy = () => {
        if (position) return;
        setPosition({
            type: "LONG",
            entry: currentPrice,
            tp: currentPrice + 12.0,
            sl: currentPrice - 6.0,
        });
    };

    const handleSell = () => {
        if (position) return;
        setPosition({
            type: "SHORT",
            entry: currentPrice,
            tp: currentPrice - 12.0,
            sl: currentPrice + 6.0,
        });
    };

    const handleClose = () => {
        if (!position) return;
        const tradePnl = position.type === "LONG" ? (currentPrice - position.entry) * 10 : (position.entry - currentPrice) * 10;
        setPnl((prev) => prev + tradePnl);
        setTradesCount((prev) => prev + 1);
        if (tradePnl > 0) setWinsCount((prev) => prev + 1);
        setPosition(null);
    };

    return (
        <section className="relative overflow-hidden border-b border-border bg-background py-24">
            <div className="relative z-10 mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <Scissors size={13} className="text-primary" /> TradingView-Grade Market Replay
                        </div>
                        <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                            Bar-by-Bar Replay &amp; Execution Simulator
                        </h2>
                        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
                            Step through past market price action bar by bar. Practice manual entry triggers, analyze market structure without lookahead bias, and test paper trades in real time.
                        </p>
                    </div>
                    <Link
                        href="/trade-replay"
                        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 active:translate-y-px md:mt-0"
                    >
                        Launch Replay Studio <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Main TradingView Replay Console Window */}
                <div className="mt-10 space-y-6 rounded-lg border border-border bg-card p-5 sm:p-7">
                    
                    {/* Floating Top Control Toolbar (TradingView Replay Toolbar) */}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border/40 pb-5">
                        
                        {/* Symbol & Cutoff Badge */}
                        <div className="flex items-center gap-3 font-numeric text-xs">
                            <span className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 font-bold text-foreground">
                                <Zap size={14} className="text-primary" /> XAUUSD · 1H
                            </span>
                            <span className="hidden text-muted-foreground sm:inline">|</span>
                            <span className="flex items-center gap-1.5 font-semibold text-foreground">
                                <span className="h-2 w-2 rounded-full bg-positive animate-pulse motion-reduce:animate-none" /> Replay Cut-off Active
                            </span>
                        </div>

                        {/* Center Controls: Play, Step, Jump Cut */}
                        <div className="flex flex-wrap items-center gap-2 self-center lg:self-auto">
                            <button
                                type="button"
                                onClick={() => { setIsCutoffMode(!isCutoffMode); setIsPlaying(false); }}
                                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                                    isCutoffMode
                                        ? "border-negative/40 bg-negative/15 text-negative animate-pulse motion-reduce:animate-none"
                                        : "border-border bg-muted/50 text-muted-foreground hover:text-foreground"
                                }`}
                                title="Jump to bar (Cut point)"
                            >
                                <Scissors size={14} /> {isCutoffMode ? "Click Bar to Cut" : "Jump To..."}
                            </button>

                            <button
                                type="button"
                                onClick={() => { setCursor((p) => Math.max(1, p - 1)); setIsPlaying(false); }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted"
                                title="Step Back"
                            >
                                <SkipBack size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsPlaying((p) => !p)}
                                className="flex h-8.5 w-10 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                                title={isPlaying ? "Pause" : "Play"}
                            >
                                {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setCursor((p) => Math.min(totalBars, p + 1)); setIsPlaying(false); }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted"
                                title="Step Forward"
                            >
                                <SkipForward size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={() => { setCursor(10); setIsPlaying(false); setPosition(null); }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
                                title="Reset"
                            >
                                <RotateCcw size={14} />
                            </button>

                            <select
                                value={speed}
                                onChange={(e) => setSpeed(Number(e.target.value))}
                                className="ml-1 rounded-lg border border-border bg-background px-2.5 py-1.5 font-numeric text-xs outline-none focus:border-ring"
                            >
                                {[1, 2, 5, 10].map((s) => (
                                    <option key={s} value={s}>{s}x Speed</option>
                                ))}
                            </select>
                        </div>

                        {/* Paper Execution Simulator Action Buttons */}
                        <div className="flex items-center gap-2">
                            {position ? (
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/15 px-3 py-1.5 text-xs font-bold text-warning transition-colors hover:bg-warning/25"
                                >
                                    <RefreshCw size={13} /> Close Position
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleBuy}
                                        className="flex items-center gap-1 rounded-lg bg-positive px-3 py-1.5 text-xs font-bold text-background transition-colors hover:bg-positive/90"
                                    >
                                        <TrendingUp size={13} /> Buy Long
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSell}
                                        className="flex items-center gap-1 rounded-lg bg-negative px-3 py-1.5 text-xs font-bold text-background transition-colors hover:bg-negative/90"
                                    >
                                        <TrendingDown size={13} /> Sell Short
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Timeline Scrubber Bar */}
                    <div className="space-y-1.5 font-numeric text-xs">
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span>Bar Sequence ({cursor} / {totalBars})</span>
                            <span className="font-bold text-foreground">XAUUSD @ ${currentPrice.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={totalBars}
                            value={cursor}
                            onChange={(e) => { setCursor(Number(e.target.value)); setIsPlaying(false); }}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                        />
                    </div>

                    {/* Interactive SVG TradingView Chart Simulator Container */}
                    <div className="relative flex h-64 flex-col justify-between overflow-hidden rounded-lg border border-border bg-background p-4">
                        
                        {/* Replay Watermark & Cutoff Indicator Line */}
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-numeric text-6xl font-black uppercase tracking-widest text-foreground opacity-5">
                            TradingView Replay
                        </div>

                        {/* Top Info Bar */}
                        <div className="z-10 flex items-center justify-between font-numeric text-xs text-muted-foreground">
                            <div className="flex items-center gap-4">
                                <span className="font-semibold text-foreground">EMA(20): ${(currentPrice * 0.998).toFixed(2)}</span>
                                <span>RSI(14): 58.4</span>
                            </div>
                            <span className="font-bold text-primary-text">
                                {isPlaying ? "REPLAY PLAYING" : "PAUSED (NO LOOKAHEAD)"}
                            </span>
                        </div>

                        {/* SVG Candlestick Render */}
                        <div className="relative my-auto h-40 w-full flex items-end justify-between px-2">
                            {visibleCandles.slice(-60).map((candle, idx) => {
                                const heightPct = Math.max(10, Math.min(90, ((candle.close - 2600) / 70) * 100));
                                return (
                                    <div key={idx} className="flex flex-col items-center justify-end h-full w-1.5 group relative">
                                        <div
                                            className={`w-0.5 ${candle.isUp ? "bg-positive" : "bg-negative"}`}
                                            style={{ height: `${Math.min(100, heightPct + 15)}%` }}
                                        />
                                        <div
                                            className={`w-1.5 rounded-sm ${candle.isUp ? "bg-positive" : "bg-negative"}`}
                                            style={{ height: `${Math.max(15, Math.abs(candle.close - candle.open) * 5)}px` }}
                                        />
                                    </div>
                                );
                            })}
                            
                            {/* Vertical Cutoff Indicator Line */}
                            <div className="absolute right-4 top-0 bottom-0 flex flex-col items-end justify-between border-r-2 border-dashed border-negative/70 pr-1 font-numeric text-micro font-bold text-negative">
                                <span>REPLAY CUTOFF</span>
                                <span>FUTURE HIDDEN</span>
                            </div>
                        </div>

                        {/* Bottom Scorecard Strip */}
                        <div className="z-10 flex items-center justify-between border-t border-border pt-2 font-numeric text-xs">
                            <div className="flex items-center gap-4">
                                <span className="text-muted-foreground">Session PnL: <strong className="text-positive">+${pnl.toFixed(2)}</strong></span>
                                <span className="text-muted-foreground">Win Rate: <strong className="text-info">{((winsCount / tradesCount) * 100).toFixed(0)}% ({winsCount}/{tradesCount})</strong></span>
                            </div>
                            {position && (
                                <span className={`font-bold ${position.type === "LONG" ? "text-positive" : "text-negative"}`}>
                                    Active: {position.type} @ ${position.entry.toFixed(2)}
                                </span>
                            )}
                        </div>
                    </div>

                </div>

            </div>
        </section>
    );
}
