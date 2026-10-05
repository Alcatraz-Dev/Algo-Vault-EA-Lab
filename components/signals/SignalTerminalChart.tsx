"use client";

/**
 * SignalTerminalChart — the full Pro Terminal chart embedded in a signal
 * detail page. Wraps ProTerminalChartWorkspace with signal-context defaults:
 *
 *   • volume, VWAP, FVG, session levels + BOS/CHoCH on by default
 *   • Entry / SL / TP price lines drawn from the signal via chartLevels
 *   • Symbol alias normalisation (SP500, GOLD, … → SPX500, XAUUSD, …)
 *   • Per-signal storage scope so each signal's workspace state is independent
 *
 * The toolbar / drawing tools / layer picker / fullscreen toggle all come
 * from the shared ProTerminalChartWorkspace so every signal page renders the
 * same engine + the same set of buttons as every other page.
 */

import { useMemo } from "react";
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
import { defaultLayerState } from "@/components/pro-scalping-terminal/chart-layers";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { AISignal } from "@/lib/ai-signals/types";

// ── symbol normaliser ─────────────────────────────────────────────────────────
const SYMBOL_ALIASES: Record<string, string> = {
    SP500: "SPX500", S500: "SPX500", US500: "SPX500",
    SPXUSD: "SPX500", SPX: "SPX500",
    DJIA: "US30", DOW: "US30", DOW30: "US30", DOWJONES: "US30",
    NDX: "NAS100", NAS: "NAS100", NASDAQ: "NAS100", NASDAQ100: "NAS100",
    GOLD: "XAUUSD", SILVER: "XAGUSD",
    BTCUSDT: "BTCUSD", ETHUSDT: "ETHUSD",
};

function normaliseSymbol(raw: string): SupportedSymbol {
    const sym = String(raw ?? "").toUpperCase().replace(/[\s_/-]/g, "");
    return (SYMBOL_ALIASES[sym] ?? sym) as SupportedSymbol;
}

// ── timeframe normaliser ───────────────────────────────────────────────────────
const VALID_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
function normaliseTimeframe(raw: string): Timeframe {
    const tf = String(raw ?? "H1").toUpperCase() as Timeframe;
    return VALID_TIMEFRAMES.includes(tf) ? tf : "H1";
}

// ── signal-context layer state ────────────────────────────────────────────────
function signalLayerState(): Record<string, boolean> {
    const base = defaultLayerState();
    return {
        ...base,
        volume: true,
        vwap: true,
        fvg: true,
        sessionLevels: true,
        bosChoch: true,
        supportResistance: false,
    };
}

interface SignalTerminalChartProps {
    signal: AISignal;
    height?: number;
}

export default function SignalTerminalChart({ signal, height = 460 }: SignalTerminalChartProps) {
    const symbol = normaliseSymbol(signal.symbol);
    const timeframe = normaliseTimeframe(signal.timeframe);

    // Levels the engine scored: prefer the ones persisted on the signal;
    // legacy signals without chartLevels get nothing (no fabricated levels).
    const chartLevels = useMemo(() => {
        const stored = Array.isArray((signal as { chartLevels?: Array<{ kind: string; label: string; price: number }> }).chartLevels)
            ? (signal as { chartLevels?: Array<{ kind: string; label: string; price: number }> }).chartLevels
            : undefined;
        return stored && stored.length > 0 ? stored : null;
    }, [signal]);

    const initialLayers = useMemo(() => signalLayerState(), []);

    return (
        <div className="rounded-2xl border border-border/20 overflow-hidden bg-[#0b1118]">
            {/* Header — keeps the signal-context branding (Entry / SL / TP legend) */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
                <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Price Chart
                    </h3>
                    <span className="text-[10px] text-muted-foreground/50 font-mono">
                        {signal.symbol} · {timeframe}
                    </span>
                    {symbol !== signal.symbol.toUpperCase().replace(/[\s_/-]/g, "") && (
                        <span className="text-[10px] text-muted-foreground/40">
                            → {symbol}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-sky-400" />
                        <span className="text-foreground/60">Entry</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-rose-400" />
                        <span className="text-foreground/60">SL</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-emerald-400" />
                        <span className="text-foreground/60">TP</span>
                    </span>
                </div>
            </div>

            {/* Full Pro Terminal workspace — same engine + same toolbars as the
                scalping terminal / market-intelligence terminal / trading pages */}
            <div className="p-2">
                <ProTerminalChartWorkspace
                    initialSymbol={symbol}
                    initialTimeframe={timeframe}
                    initialLayers={initialLayers as never}
                    chartLevels={chartLevels}
                    height={height}
                    hideWatchlist
                    storageScope={`signal-${signal.id}`}
                />
            </div>
        </div>
    );
}