"use client";

import { useState, useMemo } from "react";
import { Search, SlidersHorizontal, BarChart3, LineChart, AreaChart, BarChart as BarIcon, Activity, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChartType, Candle } from "./types";

interface ChartToolbarProps {
    symbol: string;
    interval: string;
    chartType: ChartType;
    studies: string[];
    candles: Candle[];
    canUndo: boolean;
    canRedo: boolean;
    onChangeSymbol: (symbol: string) => void;
    onChangeInterval: (interval: string) => void;
    onChangeChartType: (type: ChartType) => void;
    onChangeStudies: (studies: string[]) => void;
    onUndo: () => void;
    onRedo: () => void;
}

const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W", "1M"];

const STUDIES = [
    { id: "MASimple@tv-basicstudies", name: "Moving Average", color: "#22d3ee" },
    { id: "RSI@tv-basicstudies", name: "RSI", color: "#f59e0b" },
    { id: "MACD@tv-basicstudies", name: "MACD", color: "#a78bfa" },
    { id: "BB@tv-basicstudies", name: "Bollinger Bands", color: "#34d399" },
];

const CHART_TYPES: { type: ChartType; label: string; icon: React.ReactNode }[] = [
    { type: "candlestick", label: "Candles", icon: <BarChart3 size={14} /> },
    { type: "line", label: "Line", icon: <LineChart size={14} /> },
    { type: "area", label: "Area", icon: <AreaChart size={14} /> },
    { type: "bar", label: "Bar", icon: <BarIcon size={14} /> },
];

export default function ChartToolbar({
    symbol,
    interval,
    chartType,
    studies,
    candles,
    canUndo,
    canRedo,
    onChangeSymbol,
    onChangeInterval,
    onChangeChartType,
    onChangeStudies,
    onUndo,
    onRedo,
}: ChartToolbarProps) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
    const _displayInterval = isMobile && interval.length > 3 ? interval.slice(0, -1) + interval.slice(-1).toUpperCase() : interval;

    void candles;
    void _displayInterval;

    const filteredSymbols = useMemo(() => {
        if (!searchQuery) return [];
        const allSymbols = ["FX:EURUSD", "FX:GBPUSD", "FX:USDJPY", "BTC/USD", "ETH/USD", "XAU/USD", "XAG/USD", "INDU:INDEX"];
        return allSymbols.filter((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [searchQuery]);

    const toggleStudy = (id: string) => {
        if (studies.includes(id)) {
            onChangeStudies(studies.filter((s) => s !== id));
        } else {
            onChangeStudies([...studies, id]);
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/20 px-3 py-2">
            <div className="relative">
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs text-foreground/70 hover:text-foreground"
                    onClick={() => setSearchOpen(!searchOpen)}
                >
                    <Search size={14} />
                    <span className="hidden sm:inline">{symbol}</span>
                </Button>
                {searchOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border/20 bg-background p-2 shadow-xl">
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search symbol..."
                            className="border-border/20 bg-foreground/30 text-xs text-foreground placeholder:text-foreground/50"
                        />
                        <div className="mt-1 max-h-48 overflow-auto">
                            {filteredSymbols.length === 0 && (
                                <p className="px-2 py-1 text-xs text-foreground/50">No results</p>
                            )}
                            {filteredSymbols.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => {
                                        onChangeSymbol(s);
                                        setSearchOpen(false);
                                        setSearchQuery("");
                                    }}
                                    className="w-full rounded px-2 py-1 text-left text-xs text-foreground/70 hover:bg-foreground/10"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="mx-1 h-5 w-px bg-background/20" />

            <div className="flex items-center gap-0.5">
                {INTERVALS.map((tf) => (
                    <Button
                        key={tf}
                        variant={interval === tf ? "secondary" : "ghost"}
                        size="sm"
                        className={`text-[10px] px-1.5 ${interval === tf ? "bg-cyan-400/15 text-cyan-200" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => onChangeInterval(tf)}
                    >
                        {tf}
                    </Button>
                ))}
            </div>

            <div className="mx-1 h-5 w-px bg-background/20" />

            <div className="flex items-center gap-0.5">
                {CHART_TYPES.map(({ type, label, icon }) => (
                    <Button
                        key={type}
                        variant={chartType === type ? "secondary" : "ghost"}
                        size="sm"
                        className="gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => onChangeChartType(type)}
                    >
                        {icon}
                        <span className="hidden md:inline">{label}</span>
                    </Button>
                ))}
            </div>

            <div className="mx-1 h-5 w-px bg-background/20" />

            <div className="relative group">
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-foreground/70 hover:text-foreground">
                    <Activity size={14} />
                    <span className="hidden sm:inline">Indicators</span>
                </Button>
                <div className="absolute left-0 top-full z-50 mt-1 hidden w-56 rounded-lg border border-border/20 bg-background p-2 shadow-xl group-hover:block">
                    <p className="mb-1 px-2 text-[10px] font-medium text-foreground/70">Studies</p>
                    {STUDIES.map((study) => (
                        <button
                            key={study.id}
                            onClick={() => toggleStudy(study.id)}
                            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-foreground/10"
                        >
                            <span className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: study.color }} />
                                {study.name}
                            </span>
                            {studies.includes(study.id) && <span className="text-cyan-400">✓</span>}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1" />

            <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                disabled={!canUndo}
                onClick={onUndo}
            >
                <Undo2 size={14} />
            </Button>
            <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                disabled={!canRedo}
                onClick={onRedo}
            >
                <Redo2 size={14} />
            </Button>

            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <SlidersHorizontal size={14} />
            </Button>
        </div>
    );
}
