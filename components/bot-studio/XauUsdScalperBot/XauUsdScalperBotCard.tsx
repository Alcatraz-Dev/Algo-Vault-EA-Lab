"use client";

import { useCallback, useState, useMemo } from "react";
import type { XauUsdScalpingConfig } from "@/lib/bot-studio/scalping";
import { deriveLevels, pipsToPrice } from "@/lib/bot-studio/scalping";
import { ScalpingConfigForm } from "./ScalpingConfigForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Bot, Activity, ChevronDown, ChevronUp, Settings, Play, Square, ArrowUpRight, ArrowDownRight, Check, X, AlertCircle, RefreshCw, Zap } from "lucide-react";

interface RecentTrade {
    id: string;
    side: "BUY" | "SELL";
    entry: number;
    exit?: number;
    pnl?: number;
    tpLevel: 1 | 2 | "sl";
    status: "open" | "win" | "loss" | "sl";
    openedAt: number;
}

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
    /** The bot's currently open position (from MT5 via the unified path), if any. */
    currentPosition?: {
        ticket: string;
        side: "BUY" | "SELL";
        volume: number;
        entry: number;
        sl: number;
        tp1: number;
        tp2: number;
        openAt: number;
    } | null;
    /** Recent bot trades, most recent first. */
    recentTrades?: RecentTrade[];
    /** Live market price from the chart feed, if available. */
    currentPrice?: number;
    /** Manual test trade handler — opens a position at current market price. */
    onTestTrade?: () => void;
    /** Whether an auth token is available (bot cannot trade without it). */
    hasToken?: boolean;
    onToggle: (next: boolean) => void;
    onDeploy?: () => void;
    onConfigChange: (next: XauUsdScalpingConfig) => void;
    className?: string;
}

function fmtRelative(ts: number | undefined, now = Date.now()): string {
    if (!ts) return "—";
    const s = Math.floor((now - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

function TradeRow({ trade }: { trade: RecentTrade }) {
    const arrow = trade.side === "BUY" ? ArrowUpRight : ArrowDownRight;
    const sideColor = trade.side === "BUY" ? "text-positive" : "text-negative";
    const statusColor =
        trade.status === "win"
            ? "text-positive"
            : trade.status === "loss" || trade.status === "sl"
              ? "text-negative"
              : "text-muted-foreground";

    return (
        <div className="group flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-2.5 py-1.5 transition hover:border-border hover:bg-card">
            <span className={cn("size-3.5 shrink-0", sideColor)}>
                {trade.side === "BUY" ? (
                    <ArrowUpRight className="size-3.5" />
                ) : (
                    <ArrowDownRight className="size-3.5" />
                )}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-foreground">
                {trade.entry.toFixed(2)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {trade.side === "BUY" ? "long" : "short"}
                {" · "}
                {trade.tpLevel === 1 ? "TP1" : trade.tpLevel === 2 ? "TP2" : "SL"}
            </span>
            {trade.status === "open" ? (
                <span className="text-[11px] text-muted-foreground">open</span>
            ) : (
                <span className={cn("text-[11px] font-medium", statusColor)}>
                    {trade.status === "win" ? "win" : trade.status === "loss" ? "loss" : "SL"}
                </span>
            )}
            {trade.pnl != null && trade.status !== "open" ? (
                <span className={cn("font-mono text-[11px] font-semibold tabular-nums", trade.pnl >= 0 ? "text-positive" : "text-negative")}>
                    {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}
                </span>
            ) : null}
            {trade.exit != null && trade.status !== "open" ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                    exit {trade.exit.toFixed(2)}
                </span>
            ) : null}
            <span className="shrink-0 text-[10px] text-muted-foreground">
                {fmtRelative(trade.openedAt)}
            </span>
        </div>
    );
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
    currentPosition,
    recentTrades = [],
    currentPrice,
    onTestTrade,
    hasToken,
    onToggle,
    onDeploy,
    onConfigChange,
    className,
}: XauUsdScalperBotCardProps) {
    const [configOpen, setConfigOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [localRestartCount, setLocalRestartCount] = useState(0);

    const handleToggle = useCallback(() => {
        onToggle(!running);
    }, [running, onToggle]);

    const statusColor =
        status === "running"
            ? "bg-positive/10 text-positive"
            : status === "paused"
              ? "bg-warning/10 text-warning"
              : status === "error"
                ? "bg-negative/10 text-negative"
                : "bg-muted text-muted-foreground";

    const stats = useMemo(
        () => ({
            wins: recentTrades.filter((t) => t.status === "win").length,
            losses: recentTrades.filter((t) => t.status === "loss" || t.status === "sl").length,
            open: recentTrades.filter((t) => t.status === "open").length,
            totalPnl: recentTrades.reduce((s, t) => s + (t.pnl ?? 0), 0),
        }),
        [recentTrades],
    );

    const liveLevels = useMemo(() => {
        if (!currentPrice || currentPrice <= 0) return null;
        return deriveLevels(currentPrice, config.tp1Pips, config.tp2Pips, config.slPips, config.direction);
    }, [currentPrice, config]);

    return (
        <Card className={cn("overflow-hidden", className)}>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Bot className="size-4.5" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <CardTitle className="text-sm font-semibold leading-tight">
                                        XAUUSD M1 Scalper
                                    </CardTitle>
                                    {running && (
                                        <span className="size-1.5 rounded-full bg-positive animate-pulse" />
                                    )}
                                </div>
                                <CardDescription className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px]">
                                    <span>XAUUSD · M1</span>
                                    {currentPrice != null && currentPrice > 0 ? (
                                        <span className="font-mono tabular-nums text-[11px] font-semibold text-foreground">
                                            {currentPrice.toFixed(2)}
                                        </span>
                                    ) : (
                                        <span className="text-[11px] text-muted-foreground">—</span>
                                    )}
                                    <span className={cn("rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground", config.direction === "long" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative")}>
                                        {config.direction === "long" ? "Long bias" : "Short bias"}
                                    </span>
                                    {config.enabled ? (
                                        <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                                            enabled
                                        </span>
                                    ) : (
                                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                            disabled
                                        </span>
                                    )}
                                    {running ? (
                                        <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                                            running
                                        </span>
                                    ) : null}
                                </CardDescription>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfigOpen((o) => !o)}
                        >
                            {configOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
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
                                {collapsed ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-3">
                {/* Status strip */}
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize", statusColor)}>
                        <span className="size-1.5" />
                        {status}
                    </span>
                    {running && (
                        <span className="inline-flex items-center gap-1 text-positive text-[11px]">
                            <Activity className="size-3" />
                            {signalCount} signals · {executionCount} orders sent
                        </span>
                    )}
                    {errorReason ? (
                        <span className="inline-flex items-center gap-1 text-negative text-[11px]">
                            <AlertCircle className="size-3" />
                            {errorReason}
                        </span>
                    ) : null}
                    {config.enabled && !running && status !== "error" ? (
                        <span className="inline-flex items-center gap-1 text-warning text-[11px]">
                            <Settings className="size-3" />
                            enabled — not running
                        </span>
                    ) : null}
                </div>

                {/* Live level readout */}
                <div className="grid gap-2 sm:grid-cols-4">
                    {liveLevels ? (
                        <>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">TP1</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-positive">
                                    {liveLevels.tp1.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    {`+${config.tp1Pips}p`}
                                </div>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">TP2</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-positive">
                                    {liveLevels.tp2.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    {`+${config.tp2Pips}p`}
                                </div>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">SL</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-negative">
                                    {liveLevels.sl.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    {`-${config.slPips}p`}
                                </div>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Live price</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">
                                    {currentPrice!.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">XAUUSD · M1</div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">TP1 target</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-positive">
                                    {config.direction === "long" ? "+" : "−"}{config.tp1Pips}p
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    {config.direction === "long" ? "above entry" : "below entry"}
                                </div>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">TP2 target</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-positive">
                                    {config.direction === "long" ? "+" : "−"}{config.tp2Pips}p
                                </div>
                                <div className="text-[10px] text-muted-foreground">runner target</div>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stop loss</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-negative">
                                    {config.direction === "long" ? "−" : "+"}{config.slPips}p
                                </div>
                                <div className="text-[10px] text-muted-foreground">firm for full pos</div>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-center">
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spread cap</div>
                                <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">
                                    ≤ {config.maxSpreadPoints} pts
                                </div>
                                <div className="text-[10px] text-muted-foreground">signal filter</div>
                            </div>
                        </>
                    )}
                </div>

                {/* Magic + risk + positions line */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono tabular-nums">magic {config.magicNumber}</span>
                    <span className="font-mono tabular-nums">risk {config.riskPercent}% / trade</span>
                    <span className="font-mono tabular-nums">max {config.maxPositions} open</span>
                    <span className="font-mono tabular-nums">warm-up {config.warmUpCandles} bars</span>
                </div>

                {/* Current position */}
                {currentPosition && running ? (
                    <div className="rounded-lg border border-positive/30 bg-positive/5 p-3">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-positive">Open bot position</span>
                            <span className="text-[10px] text-muted-foreground">
                                {currentPosition.side === "BUY" ? "Long" : "Short"} · {currentPosition.volume} lots
                            </span>
                        </div>
                        <div className="grid gap-1.5 text-[11px] font-mono">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">entry</span>
                                <span className="text-foreground font-semibold">{currentPosition.entry.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">SL</span>
                                <span className="text-negative font-semibold">{currentPosition.sl.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">TP1</span>
                                <span className="text-positive font-semibold">{currentPosition.tp1.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">TP2</span>
                                <span className="text-positive font-semibold">{currentPosition.tp2.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between border-t border-border/60 pt-1">
                                <span className="text-muted-foreground">opened</span>
                                <span className="text-muted-foreground">{fmtRelative(currentPosition.openAt)}</span>
                            </div>
                        </div>
                    </div>
                ) : running ? (
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-center text-[11px] text-muted-foreground">
                        <RefreshCw className="mx-auto mb-1 size-3.5 animate-spin text-muted-foreground" />
                        waiting for next signal…
                    </div>
                ) : null}

                {/* Recent trades */}
                {recentTrades.length > 0 ? (
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-muted-foreground">Recent bot trades</span>
                            <span className="text-[10px] text-muted-foreground">
                                {stats.wins}W / {stats.losses}L
                                {stats.open ? ` · ${stats.open} open` : ""}
                                {stats.totalPnl !== 0 ? ` · net ${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)}` : ""}
                            </span>
                        </div>
                        <div className="space-y-1">
                            {recentTrades.slice(0, 8).map((t) => (
                                <TradeRow key={t.id} trade={t} />
                            ))}
                        </div>
                    </div>
                ) : running ? (
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-center text-[11px] text-muted-foreground">
                        no trades yet
                    </div>
                ) : null}

                {/* Action bar */}
                <div className="flex flex-wrap items-center gap-2">
                    {running ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={handleToggle}
                        >
                            <Square className="size-3.5" />
                            Stop bot
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            disabled={!hasToken}
                            className={cn(
                                "gap-1.5 bg-primary text-white hover:bg-primary/90 disabled:bg-primary/30 disabled:cursor-not-allowed",
                                !hasToken ? "opacity-60" : "",
                            )}
                            onClick={handleToggle}
                        >
                            <Play className="size-3.5" />
                            {hasToken ? "Start bot" : "Waiting for auth…"}
                        </Button>
                    )}
                    {onDeploy && !running && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onDeploy}
                            className="gap-1.5 text-xs"
                        >
                            Deploy to MT5
                        </Button>
                    )}
                    {!running && onTestTrade && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!hasToken}
                            onClick={onTestTrade}
                            className={cn(
                                "gap-1.5 text-xs bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 disabled:bg-amber-500/5 disabled:cursor-not-allowed",
                                !hasToken ? "opacity-60" : "",
                            )}
                        >
                            <Zap className="size-3.5" /> Test Trade
                        </Button>
                    )}
                    {running && (
                        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="font-mono tabular-nums">
                                last tick {fmtRelative(lastTickAt)}
                            </span>
                            {lastSignalAt ? (
                                <span className="font-mono tabular-nums">
                                    last signal {fmtRelative(lastSignalAt)}
                                </span>
                            ) : null}
                            {lastExecutionAt ? (
                                <span className="font-mono tabular-nums">
                                    last order {fmtRelative(lastExecutionAt)}
                                </span>
                            ) : null}
                        </div>
                    )}
                </div>

                {/* Expanded config */}
                {!collapsed && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                        {configOpen ? (
                            <ScalpingConfigForm
                                config={config}
                                onChange={onConfigChange}
                                currentPrice={currentPrice}
                                className="px-1"
                            />
                        ) : (
                            <div className="space-y-2 text-[11px]">
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Risk per trade</span>
                                    <span className="font-mono tabular-nums text-foreground">{config.riskPercent}%</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Max positions</span>
                                    <span className="font-mono tabular-nums text-foreground">{config.maxPositions}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Warm-up candles</span>
                                    <span className="font-mono tabular-nums text-foreground">{config.warmUpCandles}</span>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-7 px-2 text-xs"
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
