"use client";

import Link from "next/link";
import { useState } from "react";
import {
    TrendingUp,
    TrendingDown,
    Eye,
    UserPlus,
    Zap,
    Clock,
    Target,
    Shield,
    BarChart3,
    CheckCircle2,
    Check,
    Loader2,
    Sparkles,
    AlertTriangle,
    ArrowRight,
    Activity,
    Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/ai-signals/symbol-specs";
import { calculateProfitUSD } from "@/lib/ai-signals/calculations";
import type { AISignal, SignalDirection, SignalStrength, SignalStatus } from "@/lib/ai-signals/types";

type Props = {
    signal: AISignal;
    viewHref?: string;
    onView?: (signal: AISignal) => void;
    onFollow?: (signalId: string) => Promise<void> | void;
    onTrade?: (signal: AISignal) => Promise<void> | void;
    onComplete?: (signal: AISignal) => Promise<void> | void;
    isFollowed?: boolean;
    followLoading?: boolean;
    tradeLoading?: boolean;
    completeLoading?: boolean;
    variant?: "standard" | "pro";
    isHighestConfidence?: boolean;
    currentPrice?: number;
};

function directionConfig(direction: SignalDirection) {
    return direction === "BUY"
        ? {
              color: "text-emerald-400",
              bg: "bg-emerald-500/10",
              border: "border-emerald-500/30",
              icon: TrendingUp,
              gradientFrom: "from-emerald-500/20",
              gradientTo: "to-emerald-500/5",
              trackColor: "bg-emerald-500",
              glowColor: "shadow-emerald-500/20",
          }
        : {
              color: "text-rose-400",
              bg: "bg-rose-500/10",
              border: "border-rose-500/30",
              icon: TrendingDown,
              gradientFrom: "from-rose-500/20",
              gradientTo: "to-rose-500/5",
              trackColor: "bg-rose-500",
              glowColor: "shadow-rose-500/20",
          };
}

function strengthConfig(strength: SignalStrength) {
    const map: Record<SignalStrength, string> = {
        HIGH_CONVICTION: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
        VERY_STRONG: "text-indigo-400 border-indigo-500/30 bg-indigo-500/10",
        STRONG: "text-blue-400 border-blue-500/30 bg-blue-500/10",
        GOOD: "text-sky-400 border-sky-500/30 bg-sky-500/10",
        MODERATE: "text-amber-400 border-amber-500/30 bg-amber-500/10",
        WEAK: "text-muted-foreground border-border/30 bg-muted/10",
    };
    return map[strength];
}

const STATUS_DISPLAY_MAP: Record<string, { label: string; color: string; active: boolean }> = {
    ACTIVE: { label: "ACTIVE", color: "text-emerald-400", active: true },
    READY: { label: "READY", color: "text-blue-400", active: false },
    NEW: { label: "NEW", color: "text-amber-400", active: true },
    PENDING_ENTRY: { label: "PENDING ENTRY", color: "text-blue-400", active: true },
    ENTRY_TRIGGERED: { label: "ENTRY TRIGGERED", color: "text-emerald-400", active: true },
    TP1_HIT: { label: "TP1 HIT ✓", color: "text-emerald-400", active: true },
    TP2_HIT: { label: "TP2 HIT ✓", color: "text-emerald-400", active: true },
    TP3_HIT: { label: "TP3 HIT ✓", color: "text-emerald-400", active: true },
    RUNNER: { label: "RUNNER", color: "text-emerald-400", active: true },
    CANCELLED: { label: "CANCELLED", color: "text-muted-foreground", active: false },
    EXPIRED: { label: "EXPIRED", color: "text-muted-foreground", active: false },
    STOPPED: { label: "SL HIT", color: "text-rose-400", active: false },
    COMPLETED: { label: "COMPLETED", color: "text-muted-foreground", active: false },
    WATCH: { label: "WATCH", color: "text-muted-foreground", active: false },
};

function statusConfig(status: string) {
    return STATUS_DISPLAY_MAP[status] ?? { label: status.replaceAll("_", " "), color: "text-muted-foreground", active: false };
}

function isTpHit(status: SignalStatus, tpIndex: number): boolean {
    if (tpIndex === 1) return ["TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(status);
    if (tpIndex === 2) return ["TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"].includes(status);
    if (tpIndex === 3) return ["TP3_HIT", "RUNNER", "COMPLETED"].includes(status);
    return false;
}

function isSlHit(status: SignalStatus): boolean {
    return status === "STOPPED";
}

const TRADABLE_STATUSES = new Set([
    "ACTIVE", "READY", "RUNNER", "TP1_HIT", "TP2_HIT", "TP3_HIT",
    "NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED",
    "TP1_REACHED", "TP2_REACHED", "TP3_REACHED", "TP4_REACHED", "TP5_REACHED",
    "TP5_OPEN_RUNNER", "BE_PROFIT_LOCK", "CREATED", "NEEDS_REVIEW",
]);

function formatTimeAgo(ts: number | undefined): string {
    if (ts == null || ts === 0) return "Unknown";
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ${mins % 60}m ago`;
    if (days < 7) return `${days}d ${hours % 24}h ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Calculate how far price has moved from entry toward a target level (0–100).
 * Returns null if any required value is missing or zero.
 */
function calcProgress(entry: number, target: number, current: number): number | null {
    if (!entry || !target || !current) return null;
    const total = Math.abs(target - entry);
    if (total === 0) return null;
    const moved = Math.abs(current - entry);
    return Math.min(100, Math.max(0, (moved / total) * 100));
}

/**
 * Distance as a signed pip/point percentage for display.
 */
function priceDelta(current: number, reference: number, isBuy: boolean): { value: number; pct: number } {
    const diff = current - reference;
    const pct = reference !== 0 ? (diff / reference) * 100 : 0;
    return { value: isBuy ? diff : -diff, pct: isBuy ? pct : -pct };
}




function formatMoney(amount: number): string {
    const abs = Math.abs(amount);
    if (abs >= 10000) return abs.toFixed(0);
    if (abs >= 1000) return abs.toFixed(1);
    return abs.toFixed(2);
}

export default function SignalCard({
    signal,
    viewHref,
    onView,
    onFollow,
    onTrade,
    onComplete,
    isFollowed,
    followLoading,
    tradeLoading,
    completeLoading,
    variant = "standard",
    isHighestConfidence = false,
    currentPrice = 0,
}: Props) {
    const dir = directionConfig(signal.direction);
    const DirIcon = dir.icon;
    const strength = strengthConfig(signal.strength ?? "MODERATE");
    const status = statusConfig(signal.status);
    const isTradable = TRADABLE_STATUSES.has(signal.status);
    const isCompletable = ["ACTIVE", "READY", "RUNNER", "TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(signal.status);
    const hasTP1 = signal.tp1 != null && signal.tp1 !== 0;
    const hasTP2 = signal.tp2 != null && signal.tp2 !== 0;
    const hasTP3 = signal.tp3 != null && signal.tp3 !== 0;
    const actionCount = [Boolean(viewHref || onView), Boolean(onFollow), Boolean(onTrade && isTradable), Boolean(isCompletable && onComplete)]
        .filter(Boolean).length;
    const actionGrid = actionCount === 1 ? "grid-cols-1"
        : actionCount === 2 ? "grid-cols-2"
        : actionCount === 3 ? "grid-cols-2 sm:grid-cols-3"
        : "grid-cols-2 sm:grid-cols-4";
    const isPro = variant === "pro";
    const [lotSize, setLotSize] = useState<number>(0.01);
    const slProfitUSD = signal.stopLoss ? calculateProfitUSD(signal.symbol, signal.direction, signal.entry, signal.stopLoss, lotSize) : 0;
    const tp1ProfitUSD = signal.tp1 ? calculateProfitUSD(signal.symbol, signal.direction, signal.entry, signal.tp1, lotSize) : 0;
    const tp2ProfitUSD = signal.tp2 ? calculateProfitUSD(signal.symbol, signal.direction, signal.entry, signal.tp2, lotSize) : 0;
    const tp3ProfitUSD = signal.tp3 ? calculateProfitUSD(signal.symbol, signal.direction, signal.entry, signal.tp3, lotSize) : 0;


    // Live price delta from entry
    const livePrice = currentPrice > 0 ? currentPrice : (signal.currentPrice ?? 0);
    const haslivePrice = livePrice > 0 && signal.entry > 0;
    const delta = haslivePrice ? priceDelta(livePrice, signal.entry, signal.direction === "BUY") : null;
    const slHit = isSlHit(signal.status);

    // SL progress toward current price
    const slProgress = haslivePrice && signal.stopLoss
        ? calcProgress(signal.entry, signal.stopLoss, livePrice)
        : null;

    // TP progress
    const tp1Progress = haslivePrice && hasTP1 && signal.tp1
        ? calcProgress(signal.entry, signal.tp1, livePrice)
        : null;
    const tp2Progress = haslivePrice && hasTP2 && signal.tp2
        ? calcProgress(signal.entry, signal.tp2, livePrice)
        : null;
    const tp3Progress = haslivePrice && hasTP3 && signal.tp3
        ? calcProgress(signal.entry, signal.tp3, livePrice)
        : null;

    return (
        <article
            className={cn(
                "group relative min-w-0 overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300",
                isPro
                    ? "border-amber-500/25 bg-gradient-to-br from-amber-500/[0.07] via-background to-background/95 shadow-sm hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/10"
                    : "border-border/30 bg-gradient-to-br from-background/80 via-background/40 to-background/80 hover:border-border/50 hover:shadow-md"
            )}
        >
            {/* Pro accent line */}
            {isPro && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-amber-500 via-amber-500/40 to-transparent" />}

            {/* Card body */}
            <div className="p-5">
                {/* ── Header row ── */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                            dir.bg, dir.border, dir.color
                        )}>
                            <DirIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="truncate font-bold text-foreground">{signal.symbol}</h3>
                                {isPro && (
                                    <span className="inline-flex shrink-0 items-center rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-400">
                                        Pro
                                    </span>
                                )}
                                {isHighestConfidence && (
                                    <span className="inline-flex shrink-0 items-center rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                                        Top
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">{signal.timeframe} · {signal.category || "market"}</p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        {/* Live price badge */}
                        {haslivePrice && delta && (
                            <span className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold font-mono tabular-nums",
                                delta.value >= 0
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                    : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                            )}>
                                <Activity className="h-2.5 w-2.5" />
                                {delta.value >= 0 ? "+" : ""}{formatPrice(livePrice, signal.symbol)}
                            </span>
                        )}
                        <span className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
                            signal.direction === "BUY"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                        )}>
                            {signal.direction}
                        </span>
                    </div>
                </div>

                {/* ── Confidence bar ── */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-[150px] flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                                <Sparkles className="h-3.5 w-3.5" />
                                {signal.confidence ?? 0}% confidence
                            </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-700"
                                style={{ width: `${Math.max(0, Math.min(100, signal.confidence ?? 0))}%` }}
                            />
                        </div>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">R:R {(signal.riskReward ?? 0).toFixed(1)}</span>
                </div>

                {/* ── Status + strength tags ── */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
                        status.active ? "border-emerald-500/20 bg-emerald-500/10" : "border-border/30 bg-muted/10",
                        status.color
                    )}>
                        {status.active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                        {status.label}
                    </span>
                    <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", strength)}>
                        {signal.strength?.replaceAll("_", " ") || "Moderate"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock size={12} />
                        {formatTimeAgo(signal.createdAt)}
                    </span>
                </div>

                {/* ══════════════════════════════════════════════════════════
                    SL / TP RESPONSIBILITY PANEL
                    ══════════════════════════════════════════════════════════ */}
                <div className="mt-4 overflow-hidden rounded-xl border border-border/25 bg-background/60">

                    {/* Entry level */}
                    <div className="flex items-center justify-between gap-3 border-b border-border/20 px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-[9px] font-black text-muted-foreground">E</span>
                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Entry</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-foreground tabular-nums">
                                {signal.entry ? formatPrice(signal.entry, signal.symbol) : "—"}
                            </span>
                            {haslivePrice && delta && (
                                <span className={cn(
                                    "text-[10px] font-semibold font-mono",
                                    delta.value >= 0 ? "text-emerald-400" : "text-rose-400"
                                )}>
                                    {delta.value >= 0 ? "▲" : "▼"} {Math.abs(delta.pct).toFixed(3)}%
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Stop Loss level */}
                    <div className={cn(
                        "relative border-b border-border/20",
                        slHit && "bg-rose-500/5"
                    )}>
                        <div className="relative flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-black",
                                    slHit
                                        ? "bg-rose-500 text-white"
                                        : "bg-rose-500/15 text-rose-400"
                                )}>SL</span>
                                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Stop Loss</span>
                                {slHit && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[9px] font-bold text-white animate-pulse">
                                        <AlertTriangle className="h-2.5 w-2.5" /> HIT
                                    </span>
                                )}
                            </div>
                            <span className="font-mono text-sm font-bold text-rose-400 tabular-nums">
                                {signal.stopLoss ? formatPrice(signal.stopLoss, signal.symbol) : "—"}
                            </span>
                        </div>
                        {/* SL progress bar (red fill = danger proximity) */}
                        {slProgress !== null && !slHit && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/30">
                                <div
                                    className="h-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-700"
                                    style={{ width: `${slProgress}%` }}
                                />
                            </div>
                        )}
                    </div>

                    {/* TP Levels */}
                    {[
                        { label: "TP1", value: signal.tp1, hasValue: hasTP1, hit: isTpHit(signal.status, 1), progress: tp1Progress, index: 1 },
                        { label: "TP2", value: signal.tp2, hasValue: hasTP2, hit: isTpHit(signal.status, 2), progress: tp2Progress, index: 2 },
                        { label: "TP3", value: signal.tp3, hasValue: hasTP3, hit: isTpHit(signal.status, 3), progress: tp3Progress, index: 3 },
                    ]
                        .filter((tp) => tp.hasValue)
                        .map((tp, i, arr) => (
                            <div
                                key={tp.label}
                                className={cn(
                                    "relative",
                                    i < arr.length - 1 && "border-b border-border/20",
                                    tp.hit && "bg-emerald-500/5"
                                )}
                            >
                                <div className="relative flex items-center justify-between gap-3 px-3.5 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-black",
                                            tp.hit
                                                ? "bg-emerald-500 text-white"
                                                : "bg-emerald-500/15 text-emerald-400"
                                        )}>
                                            {tp.hit ? <CheckCircle2 className="h-3 w-3" /> : tp.label.replace("TP", "")}
                                        </span>
                                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                                            {tp.label}
                                        </span>
                                        {tp.hit && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold text-white">
                                                <Check className="h-2.5 w-2.5" /> HIT
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm font-bold text-emerald-400 tabular-nums">
                                            {tp.value ? formatPrice(tp.value, signal.symbol) : "—"}
                                        </span>
                                        {tp.progress !== null && !tp.hit && (
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                {tp.progress.toFixed(0)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {/* TP progress bar (green fill = closeness to target) */}
                                {tp.progress !== null && !tp.hit && (
                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/30">
                                        <div
                                            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
                                            style={{ width: `${tp.progress}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        ))
                    }

                    {/* Risk/Reward track */}
                    {haslivePrice && signal.stopLoss && hasTP1 && (
                        <RiskTrack
                            entry={signal.entry}
                            stopLoss={signal.stopLoss}
                            tp1={signal.tp1!}
                            tp2={signal.tp2}
                            currentPrice={livePrice}
                            direction={signal.direction}
                        />
                    )}
                </div>


                {/* ── Lot Size & Projected P&L Calculator ── */}
                <div className="mt-3.5 rounded-xl border border-border/25 bg-background/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <Calculator className="h-3.5 w-3.5 text-amber-400" />
                            <span>P&L Calculator</span>
                        </div>
                        <div className="flex items-center gap-1">
                            {[0.01, 0.05, 0.1, 0.5, 1.0].map((preset) => (
                                <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setLotSize(preset)}
                                    className={cn(
                                        "rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold transition-all",
                                        lotSize === preset
                                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                                            : "bg-muted/10 text-muted-foreground hover:bg-muted/20"
                                    )}
                                >
                                    {preset}
                                </button>
                            ))}
                            <div className="relative flex items-center ml-1">
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.001"
                                    max="100"
                                    value={lotSize}
                                    onChange={(e) => setLotSize(Math.max(0.001, parseFloat(e.target.value) || 0.01))}
                                    className="w-14 rounded-md border border-border/30 bg-background/80 px-1.5 py-0.5 text-right font-mono text-[11px] font-bold text-foreground focus:border-amber-500 focus:outline-none"
                                />
                                <span className="ml-1 text-[10px] text-muted-foreground font-semibold">lot</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/15">
                        <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 text-center">
                            <div className="text-[10px] font-semibold text-rose-400/80 uppercase">Risk (SL)</div>
                            <div className="font-mono text-xs font-extrabold text-rose-400">
                                -${formatMoney(Math.abs(slProfitUSD))}
                            </div>
                        </div>
                        {hasTP1 && (
                            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-center">
                                <div className="text-[10px] font-semibold text-emerald-400/80 uppercase">TP1 Profit</div>
                                <div className="font-mono text-xs font-extrabold text-emerald-400">
                                    +${formatMoney(Math.abs(tp1ProfitUSD))}
                                </div>
                            </div>
                        )}
                        {hasTP2 && (
                            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-center">
                                <div className="text-[10px] font-semibold text-emerald-400/80 uppercase">TP2 Profit</div>
                                <div className="font-mono text-xs font-extrabold text-emerald-400">
                                    +${formatMoney(Math.abs(tp2ProfitUSD))}
                                </div>
                            </div>
                        )}
                        {hasTP3 && (
                            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-center">
                                <div className="text-[10px] font-semibold text-emerald-400/80 uppercase">TP3 Profit</div>
                                <div className="font-mono text-xs font-extrabold text-emerald-400">
                                    +${formatMoney(Math.abs(tp3ProfitUSD))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Footer meta row ── */}
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        {signal.suggestedRiskPercent > 0 && (
                            <span className="inline-flex items-center gap-1">
                                <Shield size={12} />
                                <span className="font-numeric">{signal.suggestedRiskPercent}% risk</span>
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                            <Target size={12} />
                            <span className="font-numeric">RR {(signal.riskReward ?? 0).toFixed(1)}</span>
                        </span>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1">
                        <BarChart3 size={12} />
                        <span className="font-numeric">{signal.followCount ?? 0} following</span>
                    </span>
                </div>

                {/* ── Action buttons ── */}
                {actionCount > 0 && (
                    <div className={cn("mt-4 grid gap-2 border-t border-border/20 pt-3", actionGrid)}>
                        {viewHref || onView ? (
                            viewHref ? (
                                <Link
                                    href={viewHref}
                                    className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-400 transition-colors hover:bg-amber-500/20"
                                >
                                    <Eye size={13} />
                                    View
                                </Link>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => onView?.(signal)}
                                    className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-400 transition-colors hover:bg-amber-500/20"
                                >
                                    <Eye size={13} />
                                    View
                                </button>
                            )
                        ) : null}

                        {onFollow ? (
                            <button
                                type="button"
                                onClick={() => void onFollow(signal.id)}
                                disabled={followLoading}
                                aria-pressed={isFollowed}
                                aria-busy={followLoading}
                                className={cn(
                                    "flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-60",
                                    isFollowed
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                        : "border-border/30 bg-muted/10 text-foreground hover:bg-muted/20"
                                )}
                            >
                                {followLoading ? <Loader2 size={13} className="animate-spin" /> : isFollowed ? <Check size={13} /> : <UserPlus size={13} />}
                                {followLoading ? "Updating" : isFollowed ? "Following" : "Follow"}
                            </button>
                        ) : null}

                        {onTrade && isTradable ? (
                            <button
                                type="button"
                                onClick={() => void onTrade(signal)}
                                disabled={tradeLoading}
                                aria-busy={tradeLoading}
                                className={cn(
                                    "flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-60",
                                    signal.direction === "BUY"
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                        : "border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                                )}
                            >
                                {tradeLoading ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                {tradeLoading ? "Sending" : "Trade"}
                            </button>
                        ) : null}

                        {isCompletable && onComplete ? (
                            <button
                                type="button"
                                onClick={() => void onComplete(signal)}
                                disabled={completeLoading}
                                aria-busy={completeLoading}
                                className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border/30 bg-muted/10 px-3 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted/20 disabled:cursor-wait disabled:opacity-60"
                            >
                                {completeLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                {completeLoading ? "Closing" : "Complete"}
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </article>
    );
}

/* ─────────────────────────────────────────────────────────────────
   RISK TRACK — horizontal bar showing SL → Entry → TP1 with
   a live price cursor dot.
───────────────────────────────────────────────────────────────── */
interface RiskTrackProps {
    entry: number;
    stopLoss: number;
    tp1: number;
    tp2?: number;
    currentPrice: number;
    direction: SignalDirection;
}

function RiskTrack({ entry, stopLoss, tp1, currentPrice, direction }: RiskTrackProps) {
    const isBuy = direction === "BUY";

    // Determine the full range displayed on the track
    const leftPrice = isBuy ? stopLoss : tp1;   // left = danger side
    const rightPrice = isBuy ? tp1 : stopLoss;  // right = target side
    const range = Math.abs(rightPrice - leftPrice);
    if (range === 0) return null;

    // Positions as percentages along the track (0 = left, 100 = right)
    const entryPct = Math.min(100, Math.max(0, (Math.abs(entry - leftPrice) / range) * 100));
    const currentPct = Math.min(100, Math.max(0, (Math.abs(currentPrice - leftPrice) / range) * 100));

    // Color the fill between SL and current price
    const fillFrom = isBuy ? 0 : currentPct;
    const fillWidth = isBuy ? currentPct : 100 - currentPct;
    const fillColor = isBuy
        ? currentPrice > entry ? "bg-emerald-500/60" : "bg-rose-500/50"
        : currentPrice < entry ? "bg-emerald-500/60" : "bg-rose-500/50";

    return (
        <div className="border-t border-border/20 px-3.5 pb-3 pt-3">
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="text-rose-400 font-mono">{isBuy ? "SL" : "TP1"}</span>
                <span className="flex items-center gap-1">
                    <Activity className="h-2.5 w-2.5 text-amber-400" />
                    <span className="text-amber-400 font-semibold">Live Track</span>
                </span>
                <span className="text-emerald-400 font-mono">{isBuy ? "TP1" : "SL"}</span>
            </div>

            {/* Track */}
            <div className="relative h-3 overflow-hidden rounded-full bg-border/40">
                {/* Colored fill */}
                <div
                    className={cn("absolute top-0 h-full rounded-full transition-all duration-700", fillColor)}
                    style={{ left: `${fillFrom}%`, width: `${fillWidth}%` }}
                />
                {/* Entry marker */}
                <div
                    className="absolute top-0 h-full w-0.5 bg-foreground/50"
                    style={{ left: `${entryPct}%` }}
                    title={`Entry: ${entry}`}
                />
                {/* Current price cursor */}
                <div
                    className={cn(
                        "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-md transition-all duration-700",
                        currentPrice > entry ? "bg-emerald-400" : "bg-rose-400"
                    )}
                    style={{ left: `${currentPct}%` }}
                    title={`Current: ${currentPrice}`}
                />
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <ArrowRight className="h-2.5 w-2.5 rotate-180 text-rose-400/60" />
                <span className="text-center">
                    Entry: <span className="text-foreground font-semibold">{formatPrice(entry, "XAUUSD")}</span>
                </span>
                <ArrowRight className="h-2.5 w-2.5 text-emerald-400/60" />
            </div>
        </div>
    );
}
