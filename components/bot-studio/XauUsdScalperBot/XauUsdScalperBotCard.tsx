"use client";

import { useCallback } from "react";
import type { XauUsdScalpingConfig } from "@/lib/bot-studio/scalping";
import { ScalpingConfigForm } from "./ScalpingConfigForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Bot, Activity, ChevronDown, ChevronUp, Settings, Play, Square, AlertCircle } from "lucide-react";

interface XauUsdScalperBotCardProps {
    config: XauUsdScalpingConfig;
    running: boolean;
    signalCount?: number;
    executionCount?: number;
    lastTickAt?: number;
    lastSignalAt?: number;
    lastExecutionAt?: number;
    errorReason?: string | null;
    status: "idle" | "running" | "paused" | "error";
    onToggle: (next: boolean) => void;
    onDeploy?: () => void;
    onConfigChange: (next: XauUsdScalpingConfig) => void;
    className?: string;
}

function fmtRelative(ts: number | undefined): string {
    if (!ts) return "—";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

export function XauUsdScalperBotCard({
    config,
    running,
    signalCount = 0,
    executionCount = 0,
    lastTickAt,
    lastSignalAt,
    lastExecutionAt,
    errorReason,
    status,
    onToggle,
    onDeploy,
    onConfigChange,
    className,
}: XauUsdScalperBotCardProps) {
    const [configOpen, setConfigOpen] = useState(false);
    // Local import after top-level to keep the component tree clean.
    // React state for the collapse:
    const [collapsed, setCollapsed] = useState(false);

    const handleToggle = useCallback(() => {
        onToggle(!running);
    }, [running, onToggle]);

    const statusColor =
        status === "running"
            ? "bg-positive text-positive"
            : status === "paused"
              ? "bg-warning text-warning"
              : status === "error"
                ? "bg-negative text-negative"
                : "bg-muted text-muted-foreground";

    return (
        <Card className={cn("overflow-hidden", className)}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Bot className="size-4" />
                            </div>
                            <div className="min-w-0">
                                <CardTitle className="text-sm font-semibold leading-tight">
                                    XAUUSD M1 Scalper
                                </CardTitle>
                                <CardDescription className="flex items-center gap-2 text-[11px]">
                                    <span>XAUUSD · M1</span>
                                    <Badge variant="secondary" className="text-[10px] normal-case">
                                        {config.direction === "long" ? "Long bias" : "Short bias"}
                                    </Badge>
                                    {config.enabled ? (
                                        <Badge variant="outline" className="text-[10px] normal-case border-positive/40 text-positive">
                                            live
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[10px] normal-case">
                                            disabled
                                        </Badge>
                                    )}
                                </CardDescription>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfigOpen((o) => !o)}
                        >
                            {configOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                            Config
                        </Button>
                        {!configOpen && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setCollapsed((c) => !c)}
                            >
                                {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {/* Status strip */}
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium capitalize",
                            statusColor,
                        )}
                    >
                        <span className="size-1.5" />
                        {status}
                    </span>
                    {running ? (
                        <span className="inline-flex items-center gap-1 text-positive">
                            <Activity className="size-3" />
                            {signalCount} signals · {executionCount} execs
                        </span>
                    ) : null}
                    {errorReason ? (
                        <span className="inline-flex items-center gap-1 text-negative">
                            <AlertCircle className="size-3" />
                            {errorReason}
                        </span>
                    ) : null}
                </div>

                {/* Compact level readout */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono tabular-nums">TP1 {config.tp1Pips}p</span>
                    <span className="font-mono tabular-nums">TP2 {config.tp2Pips}p</span>
                    <span className="font-mono tabular-nums">SL {config.slPips}p</span>
                    <span className="font-mono tabular-nums">spread ≤ {config.maxSpreadPoints}pts</span>
                    <span className="font-mono tabular-nums">magic {config.magicNumber}</span>
                </div>

                {/* Compact stats */}
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                    <div className="flex items-center gap-1 text-muted-foreground">
                        <span className="text-muted-foreground">last tick</span>
                        <span className="font-mono tabular-nums text-foreground">
                            {fmtRelative(lastTickAt)}
                        </span>
                    </div>
                    {lastSignalAt ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                            <span className="text-muted-foreground">last signal</span>
                            <span className="font-mono tabular-nums text-foreground">
                                {fmtRelative(lastSignalAt)}
                            </span>
                        </div>
                    ) : null}
                    {lastExecutionAt ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                            <span className="text-muted-foreground">last exec</span>
                            <span className="font-mono tabular-nums text-foreground">
                                {fmtRelative(lastExecutionAt)}
                            </span>
                        </div>
                    ) : null}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                    {running ? (
                        <Button type="button" variant="outline" size="sm" onClick={handleToggle}>
                            <Square className="size-3.5 mr-1" />
                            Stop
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            className="bg-primary text-white hover:bg-primary/90"
                            onClick={handleToggle}
                        >
                            <Play className="size-3.5 mr-1" />
                            Start scalper
                        </Button>
                    )}
                    {onDeploy && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onDeploy}
                            className="text-xs"
                        >
                            Deploy to MT5
                        </Button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setCollapsed((c) => !c)}
                            disabled={configOpen}
                        >
                            {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
                            {collapsed ? "Expand" : "Collapse"}
                        </Button>
                    </div>
                </div>

                {/* Expanded config */}
                {!collapsed && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                        {configOpen ? (
                            <ScalpingConfigForm
                                config={config}
                                onChange={onConfigChange}
                                className="px-1"
                            />
                        ) : (
                            <div className="space-y-1.5 text-[11px] text-muted-foreground">
                                <div className="flex justify-between">
                                    <span>Risk per trade</span>
                                    <span className="font-mono tabular-nums text-foreground">
                                        {config.riskPercent}%
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Max positions</span>
                                    <span className="font-mono tabular-nums text-foreground">
                                        {config.maxPositions}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Warm-up candles</span>
                                    <span className="font-mono tabular-nums text-foreground">
                                        {config.warmUpCandles}
                                    </span>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs mt-1 w-full"
                                    onClick={() => setConfigOpen(true)}
                                >
                                    <Settings className="size-3 mr-1" />
                                    Open full config
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// React import needed for useState inside the card — declared here to keep
// the barrel import-free for the trading page.
import { useState } from "react";

// React import is declared here to keep the barrel import-free for the trading page.
