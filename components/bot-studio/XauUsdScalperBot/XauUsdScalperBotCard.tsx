"use client";

import { useCallback, useMemo, useState } from "react";
import type {
    SmartMoneyScalpRead,
    XauUsdScalpingConfig,
} from "@/lib/bot-studio/scalping";
import { deriveLevels } from "@/lib/bot-studio/scalping";
import { ScalpingConfigForm } from "./ScalpingConfigForm";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Activity,
    AlertCircle,
    ArrowDownRight,
    ArrowUpRight,
    Bot,
    BrainCircuit,
    ChevronDown,
    ChevronUp,
    CircleSlash,
    Play,
    Settings,
    ShieldCheck,
    Square,
    Zap,
} from "lucide-react";

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
    analysis: SmartMoneyScalpRead;
    deployed?: boolean;
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
    /** Controlled config panel state — only one desk card should be open. */
    configOpen?: boolean;
    onConfigOpenChange?: (next: boolean) => void;
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

function fmtPrice(value: number | undefined): string {
    return value != null && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function pnlTone(value: number | undefined): string {
    if (value == null || value === 0) return "text-muted-foreground";
    return value > 0 ? "text-positive" : "text-negative";
}

function TradeRow({ trade }: { trade: RecentTrade }) {
    const buy = trade.side === "BUY";
    return (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-2 text-[11px] transition-colors hover:border-border hover:bg-background/70">
            <span
                className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md",
                    buy
                        ? "bg-positive/10 text-positive"
                        : "bg-negative/10 text-negative",
                )}
            >
                {buy ? (
                    <ArrowUpRight className="size-3.5" />
                ) : (
                    <ArrowDownRight className="size-3.5" />
                )}
            </span>
            <span className="font-numeric font-medium text-foreground">
                {fmtPrice(trade.entry)}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {buy ? "Long" : "Short"} ·{" "}
                {trade.tpLevel === 1
                    ? "TP1"
                    : trade.tpLevel === 2
                      ? "TP2"
                      : "SL"}
            </span>
            <span
                className={cn(
                    "shrink-0 font-medium",
                    trade.status === "open"
                        ? "text-muted-foreground"
                        : trade.status === "win"
                          ? "text-positive"
                          : "text-negative",
                )}
            >
                {trade.status === "open"
                    ? "Open"
                    : trade.status === "sl"
                      ? "SL"
                      : trade.status === "win"
                        ? "Win"
                        : "Loss"}
            </span>
            <span className="w-14 shrink-0 text-right font-numeric font-medium tabular-nums">
                {trade.pnl != null && trade.status !== "open" ? (
                    <span className={pnlTone(trade.pnl)}>
                        {trade.pnl >= 0 ? "+" : "−"}$
                        {Math.abs(trade.pnl).toFixed(2)}
                    </span>
                ) : (
                    <span className="text-muted-foreground">
                        {fmtRelative(trade.openedAt)}
                    </span>
                )}
            </span>
        </div>
    );
}

function MetricTile({
    label,
    value,
    hint,
    tone = "neutral",
}: {
    label: string;
    value: string;
    hint: string;
    tone?: "positive" | "negative" | "neutral";
}) {
    return (
        <div className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div
                className={cn(
                    "mt-0.5 font-numeric text-sm font-semibold tabular-nums",
                    tone === "positive" && "text-positive",
                    tone === "negative" && "text-negative",
                    tone === "neutral" && "text-foreground",
                )}
            >
                {value}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {hint}
            </div>
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
    analysis,
    deployed,
    currentPosition,
    recentTrades = [],
    currentPrice,
    onTestTrade,
    hasToken,
    configOpen: configOpenProp,
    onConfigOpenChange,
    onToggle,
    onDeploy,
    onConfigChange,
    className,
}: XauUsdScalperBotCardProps) {
    const [uncontrolledConfigOpen, setUncontrolledConfigOpen] = useState(false);
    const configOpen = configOpenProp ?? uncontrolledConfigOpen;

    const toggleConfig = useCallback(() => {
        const next = !configOpen;
        setUncontrolledConfigOpen(next);
        onConfigOpenChange?.(next);
    }, [configOpen, onConfigOpenChange]);

    const handleToggle = useCallback(() => {
        onToggle(!running);
    }, [running, onToggle]);

    const isAuto = config.direction === "auto";
    const activeSide =
        config.direction === "auto" ? analysis.direction : config.direction;
    const levelSide =
        activeSide === "long" || activeSide === "short" ? activeSide : null;

    const stats = useMemo(
        () => ({
            wins: recentTrades.filter((t) => t.status === "win").length,
            losses: recentTrades.filter(
                (t) => t.status === "loss" || t.status === "sl",
            ).length,
            open: recentTrades.filter((t) => t.status === "open").length,
            totalPnl: recentTrades.reduce((s, t) => s + (t.pnl ?? 0), 0),
        }),
        [recentTrades],
    );

    const liveLevels = useMemo(() => {
        if (!currentPrice || currentPrice <= 0 || !levelSide) return null;
        return deriveLevels(
            currentPrice,
            config.tp1Pips,
            config.tp2Pips,
            config.slPips,
            levelSide,
        );
    }, [currentPrice, config, levelSide]);

    const statusVariant: "success" | "warning" | "destructive" | "secondary" =
        status === "running"
            ? "success"
            : status === "paused"
              ? "warning"
              : status === "error"
                ? "destructive"
                : "secondary";

    const structureLabel =
        analysis.structureBias === "bullish"
            ? "Bullish"
            : analysis.structureBias === "bearish"
              ? "Bearish"
              : "Neutral";
    const structureTone =
        analysis.structureBias === "bullish"
            ? "text-positive"
            : analysis.structureBias === "bearish"
              ? "text-negative"
              : "text-muted-foreground";
    const routeLabel = isAuto
        ? analysis.direction === "long"
            ? "Long route"
            : analysis.direction === "short"
              ? "Short route"
              : "No route"
        : config.direction === "long"
          ? "Long only"
          : "Short only";
    const routeVariant: "success" | "destructive" | "secondary" =
        activeSide === "long"
            ? "success"
            : activeSide === "short"
              ? "destructive"
              : "secondary";
    const breakLabel =
        analysis.lastBreakKind === "bos"
            ? "BOS"
            : analysis.lastBreakKind === "choch"
              ? "CHoCH"
              : "No break";
    const breakDetail =
        analysis.lastBreakDirection === "bullish"
            ? "bullish"
            : analysis.lastBreakDirection === "bearish"
              ? "bearish"
              : "waiting";

    return (
        <Card
            className={cn(
                "gap-0 overflow-hidden shadow-[0_1px_2px_rgb(0_0_0/0.05)]",
                isAuto && "border-primary/25",
                className,
            )}
        >
            <CardHeader className="gap-4 border-b border-border/60 pb-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <div
                            className={cn(
                                "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1",
                                isAuto
                                    ? "bg-primary/10 text-primary ring-primary/20"
                                    : "bg-muted text-foreground ring-border",
                            )}
                        >
                            {isAuto ? (
                                <BrainCircuit className="size-5" />
                            ) : (
                                <Bot className="size-5" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <CardTitle className="truncate text-sm font-semibold">
                                    {isAuto
                                        ? "Smart Money Gold"
                                        : "Gold M1 Scalper"}
                                </CardTitle>
                                {running ? (
                                    <span className="size-1.5 shrink-0 rounded-full bg-positive motion-safe:animate-pulse" />
                                ) : null}
                            </div>
                            <CardDescription className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
                                <span>XAUUSD</span>
                                <span aria-hidden>·</span>
                                <span>M1</span>
                                <span aria-hidden>·</span>
                                <span>
                                    {isAuto ? "Long + short" : "Single side"}
                                </span>
                                {deployed ? (
                                    <>
                                        <span aria-hidden>·</span>
                                        <span>MT5 deployed</span>
                                    </>
                                ) : null}
                            </CardDescription>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant={statusVariant} className="capitalize">
                            {status}
                        </Badge>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px]"
                            onClick={toggleConfig}
                            aria-expanded={configOpen}
                        >
                            {configOpen ? (
                                <ChevronUp className="size-3" />
                            ) : (
                                <ChevronDown className="size-3" />
                            )}
                            Config
                        </Button>
                    </div>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-positive" />
                            Live XAUUSD
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                            <span className="font-numeric text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                                {fmtPrice(currentPrice)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                                USD
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={routeVariant}>{routeLabel}</Badge>
                        <Badge variant="outline">
                            {config.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        {running ? (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Activity className="size-3" />
                                {signalCount} signals · {executionCount} orders
                            </span>
                        ) : null}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-3.5 pt-4">
                {errorReason ? (
                    <div className="flex items-start gap-2 rounded-lg border border-negative/25 bg-negative/5 px-3 py-2 text-[11px] text-negative">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        <span>{errorReason}</span>
                    </div>
                ) : null}

                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                            <BrainCircuit className="size-3.5 text-primary" />
                            Smart Money structure
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                            Closed M1 · BOS / CHoCH
                        </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                        <div>
                            <div className="text-[11px] text-muted-foreground">
                                Structure
                            </div>
                            <div
                                className={cn(
                                    "mt-0.5 text-xs font-semibold",
                                    structureTone,
                                )}
                            >
                                {structureLabel}
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] text-muted-foreground">
                                Last break
                            </div>
                            <div className="mt-0.5 text-xs font-semibold text-foreground">
                                {breakLabel}
                                <span className="ml-1 font-normal text-muted-foreground">
                                    {breakDetail}
                                </span>
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] text-muted-foreground">
                                Signal quality
                            </div>
                            <div className="mt-0.5 font-numeric text-xs font-semibold text-foreground">
                                {Math.round(analysis.confidence * 100)}%
                            </div>
                        </div>
                    </div>

                    <div className="mt-3 flex items-start justify-between gap-3 border-t border-border/60 pt-2.5">
                        <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                            {analysis.reason}
                        </p>
                        {analysis.fresh ? (
                            <Badge variant="success" className="shrink-0">
                                Break fresh
                            </Badge>
                        ) : (
                            <Badge variant="secondary" className="shrink-0">
                                Waiting
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MetricTile
                        label="TP1"
                        value={
                            liveLevels
                                ? fmtPrice(liveLevels.tp1)
                                : `${config.tp1Pips} pips`
                        }
                        hint={
                            liveLevels
                                ? `+${config.tp1Pips} pips · 50%`
                                : "after entry"
                        }
                        tone="positive"
                    />
                    <MetricTile
                        label="TP2"
                        value={
                            liveLevels
                                ? fmtPrice(liveLevels.tp2)
                                : `${config.tp2Pips} pips`
                        }
                        hint={
                            liveLevels
                                ? `+${config.tp2Pips} pips · runner`
                                : "runner target"
                        }
                        tone="positive"
                    />
                    <MetricTile
                        label="Stop loss"
                        value={
                            liveLevels
                                ? fmtPrice(liveLevels.sl)
                                : `${config.slPips} pips`
                        }
                        hint="firm for full position"
                        tone="negative"
                    />
                    <MetricTile
                        label="Spread cap"
                        value={`≤ ${config.maxSpreadPoints}`}
                        hint="points · skip above"
                    />
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-numeric">Risk {config.riskPercent}%</span>
                    <span className="font-numeric">Max {config.maxPositions} open</span>
                    <span className="font-numeric">Magic {config.magicNumber}</span>
                    <span className="font-numeric">
                        Warm-up {config.warmUpCandles} bars
                    </span>
                </div>

                {currentPosition && running ? (
                    <div className="rounded-xl border border-positive/25 bg-positive/5 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-positive">
                                <ShieldCheck className="size-3.5" />
                                Open bot position
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                                {currentPosition.side === "BUY"
                                    ? "Long"
                                    : "Short"}{" "}
                                · {currentPosition.volume} lots
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-numeric text-[11px]">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Entry</span>
                                <span className="font-semibold text-foreground">
                                    {fmtPrice(currentPosition.entry)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">SL</span>
                                <span className="font-semibold text-negative">
                                    {fmtPrice(currentPosition.sl)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">TP1</span>
                                <span className="font-semibold text-positive">
                                    {fmtPrice(currentPosition.tp1)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">TP2</span>
                                <span className="font-semibold text-positive">
                                    {fmtPrice(currentPosition.tp2)}
                                </span>
                            </div>
                        </div>
                    </div>
                ) : running ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5 text-[11px] text-muted-foreground">
                        <CircleSlash className="size-3.5 shrink-0" />
                        {isAuto
                            ? "Standing aside until a fresh M1 structure break routes a side."
                            : `Waiting for a ${config.direction} entry.`}
                    </div>
                ) : null}

                {recentTrades.length > 0 ? (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-foreground">
                                Recent bot trades
                            </span>
                            <span className="font-numeric text-[11px] text-muted-foreground">
                                {stats.wins}W / {stats.losses}L
                                {stats.open ? ` · ${stats.open} open` : ""}
                                {stats.totalPnl !== 0
                                    ? ` · net ${stats.totalPnl >= 0 ? "+" : "−"}$${Math.abs(stats.totalPnl).toFixed(2)}`
                                    : ""}
                            </span>
                        </div>
                        <div className="space-y-1.5">
                            {recentTrades.slice(0, 6).map((trade) => (
                                <TradeRow key={trade.id} trade={trade} />
                            ))}
                        </div>
                    </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    <Button
                        type="button"
                        size="sm"
                        variant={running ? "outline" : "default"}
                        className="gap-1.5"
                        onClick={handleToggle}
                        disabled={!running && !hasToken}
                    >
                        {running ? (
                            <>
                                <Square className="size-3.5" />
                                Stop bot
                            </>
                        ) : (
                            <>
                                <Play className="size-3.5" />
                                {hasToken ? "Start bot" : "Waiting for auth…"}
                            </>
                        )}
                    </Button>

                    {!running && onTestTrade ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!hasToken}
                            onClick={onTestTrade}
                            className="gap-1.5"
                        >
                            <Zap className="size-3.5" />
                            Test trade
                        </Button>
                    ) : null}

                    {onDeploy && !running ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onDeploy}
                            className="gap-1.5"
                        >
                            <Settings className="size-3.5" />
                            Deploy to MT5
                        </Button>
                    ) : null}

                    <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>Last tick {fmtRelative(lastTickAt)}</span>
                        {lastSignalAt ? (
                            <span>Signal {fmtRelative(lastSignalAt)}</span>
                        ) : null}
                        {lastExecutionAt ? (
                            <span>Order {fmtRelative(lastExecutionAt)}</span>
                        ) : null}
                    </div>
                </div>

                {configOpen ? (
                    <div className="rounded-xl border border-border bg-muted/20 p-3">
                        <ScalpingConfigForm
                            config={config}
                            onChange={onConfigChange}
                            currentPrice={currentPrice}
                            analysisDirection={analysis.direction}
                            className="px-1"
                        />
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
