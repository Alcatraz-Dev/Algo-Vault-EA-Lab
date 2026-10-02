"use client";

/**
 * SignalTerminalChart — the full Pro Terminal chart embedded in a signal
 * detail page. Wraps ProTerminalChart with sensible signal-context defaults:
 * volume, VWAP, FVG, session levels on by default; entry / SL / TP price lines
 * drawn from the signal; symbol alias normalisation so legacy signal symbols
 * (SP500, GOLD, etc.) map to the canonical data-source names.
 */

import { useMemo, useState } from "react";
import { ProTerminalChart } from "@/components/pro-scalping-terminal/ProTerminalChart";
import { defaultLayerState } from "@/components/pro-scalping-terminal/chart-layers";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
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
function signalLayerState() {
    return {
        ...defaultLayerState(),
        volume: true,
        vwap: true,
        fvg: true,
        sessionLevels: true,
        bosChoch: true,
        supportResistance: false,
    };
}

// ── adapt AISignal → TerminalSignal so price levels become chart markers ───────
function toTerminalSignal(signal: AISignal): TerminalSignal {
    const symbol    = normaliseSymbol(signal.symbol);
    const timeframe = normaliseTimeframe(signal.timeframe);
    return {
        id:               signal.id,
        symbol,
        timeframe,
        direction:        signal.direction === "BUY" ? "long" : "short",
        entry:            signal.entry    ?? 0,
        stop:             signal.stopLoss ?? 0,
        target:           signal.tp1      ?? signal.tp2 ?? signal.tp3 ?? 0,
        riskReward:       signal.riskReward ?? 0,
        risk:             0,
        confidence:       signal.confidence ?? 0,
        confidenceLabel:  signal.confidence != null ? `${signal.confidence}%` : "—",
        evidence:         [],
        regime:           "",
        strength:         "",
        status:           signal.status ?? "ACTIVE",
        createdAt:        typeof signal.createdAt === "number" ? signal.createdAt : Date.now(),
        source:           "AI_GENERATED" as unknown as TerminalSignal["source"],
    };
}

interface SignalTerminalChartProps {
    signal: AISignal;
    height?: number;
}

export default function SignalTerminalChart({ signal, height = 460 }: SignalTerminalChartProps) {
    const [layers] = useState(signalLayerState);

    const symbol    = normaliseSymbol(signal.symbol);
    const timeframe = normaliseTimeframe(signal.timeframe);

    const signalMarkers = useMemo<TerminalSignal[]>(() => [toTerminalSignal(signal)], [signal]);

    // Levels the engine scored: prefer the ones persisted on the signal;
    // legacy signals without chartLevels get nothing (no fabricated levels).
    const chartLevels = useMemo(() => {
        const stored = Array.isArray((signal as { chartLevels?: Array<{ kind: string; label: string; price: number }> }).chartLevels)
            ? signal.chartLevels
            : undefined;
        return stored && stored.length > 0 ? stored : null;
    }, [signal]);

    return (
        <div className="rounded-2xl border border-border/20 overflow-hidden bg-[#0b1118]">
            {/* Header */}
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

            {/* Full Pro Terminal chart — same engine used in the scalping terminal */}
            <ProTerminalChart
                symbol={symbol}
                timeframe={timeframe}
                layers={layers}
                analysis={null}
                token={null}
                height={height}
                signals={signalMarkers}
                studyOverlay={null}
                chartLevels={chartLevels}
            />
        </div>
    );
}
