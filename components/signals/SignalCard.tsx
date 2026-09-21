"use client";

import Link from "next/link";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AISignal, SignalDirection, SignalStrength } from "@/lib/ai-signals/types";

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
};

function directionConfig(direction: SignalDirection) {
    return direction === "BUY"
        ? {
              color: "text-emerald-400",
              bg: "bg-emerald-500/10",
              border: "border-emerald-500/30",
              icon: TrendingUp,
          }
        : {
              color: "text-rose-400",
              bg: "bg-rose-500/10",
              border: "border-rose-500/30",
              icon: TrendingDown,
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
    TP1_HIT: { label: "TP1 HIT", color: "text-emerald-400", active: true },
    TP2_HIT: { label: "TP2 HIT", color: "text-emerald-400", active: true },
    TP3_HIT: { label: "TP3 HIT", color: "text-emerald-400", active: true },
    RUNNER: { label: "RUNNER", color: "text-emerald-400", active: true },
    CANCELLED: { label: "CANCELLED", color: "text-muted-foreground", active: false },
    EXPIRED: { label: "EXPIRED", color: "text-muted-foreground", active: false },
    STOPPED: { label: "STOPPED", color: "text-rose-400", active: false },
    COMPLETED: { label: "COMPLETED", color: "text-muted-foreground", active: false },
    WATCH: { label: "WATCH", color: "text-muted-foreground", active: false },
};

function statusConfig(status: string) {
    return STATUS_DISPLAY_MAP[status] ?? { label: status.replaceAll("_", " "), color: "text-muted-foreground", active: false };
}

const TRADABLE_STATUSES = new Set([
    "ACTIVE",
    "READY",
    "RUNNER",
    "TP1_HIT",
    "TP2_HIT",
    "TP3_HIT",
    "NEW",
    "PENDING_ENTRY",
    "ENTRY_TRIGGERED",
    "TP1_REACHED",
    "TP2_REACHED",
    "TP3_REACHED",
    "TP4_REACHED",
    "TP5_REACHED",
    "TP5_OPEN_RUNNER",
    "BE_PROFIT_LOCK",
    "CREATED",
    "NEEDS_REVIEW",
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
    const actionGrid = actionCount === 1
        ? "grid-cols-1"
        : actionCount === 2
          ? "grid-cols-2"
          : actionCount === 3
            ? "grid-cols-2 sm:grid-cols-3"
            : "grid-cols-2 sm:grid-cols-4";

    return (
        <article className="group relative min-w-0 overflow-hidden rounded-2xl border border-border/30 bg-linear-to-br from-background/80 via-background/40 to-background/80 p-5 backdrop-blur-xl transition-all hover:border-border/50">
            <div className="absolute -top-3 -left-3 flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-[11px] font-black text-foreground shadow-lg shadow-amber-500/30">
                PRO
            </div>

            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <div className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold",
                        dir.bg,
                        dir.border,
                        dir.color
                    )}>
                        <DirIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="truncate font-bold text-foreground">{signal.symbol}</h3>
                        <p className="text-xs text-muted-foreground">{signal.timeframe} · {signal.tier || "PRO"}</p>
                    </div>
                </div>
                <span className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                    signal.direction === "BUY"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                )}>
                    {signal.direction}
                </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{signal.confidence ?? 0}% Confidence</span>
                </div>
                <span className="font-mono text-muted-foreground">R:R {(signal.riskReward ?? 0).toFixed(1)}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                    status.active ? "border-emerald-500/20 bg-emerald-500/10" : "border-border/30 bg-muted/10",
                    status.color
                )}>
                    {status.active && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    {status.label}
                </span>
                <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-semibold", strength)}>
                    {signal.strength?.replaceAll("_", " ") || "Moderate"}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock size={10} />
                    {formatTimeAgo(signal.createdAt)}
                </span>
            </div>

            <div className={cn(
                "mt-3 grid grid-cols-2 gap-2 rounded-xl border border-border/30 p-3",
                hasTP3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
            )}>
                <CompactPriceCell label="Entry" value={signal.entry} color="text-foreground" />
                <CompactPriceCell label="SL" value={signal.stopLoss} color="text-rose-400" />
                {hasTP1 && <CompactPriceCell label="TP1" value={signal.tp1} color="text-emerald-400" />}
                {hasTP2 && <CompactPriceCell label="TP2" value={signal.tp2} color="text-emerald-400" />}
                {hasTP3 && <CompactPriceCell label="TP3" value={signal.tp3} color="text-emerald-400" />}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                    {signal.suggestedRiskPercent != null && (
                        <span className="inline-flex items-center gap-1">
                            <Shield size={10} />
                            <span className="font-numeric">{signal.suggestedRiskPercent}% risk</span>
                        </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                        <Target size={10} />
                        <span className="font-numeric">RR {(signal.riskReward ?? 0).toFixed(1)}</span>
                    </span>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1">
                    <BarChart3 size={10} />
                    <span className="font-numeric">{signal.followCount ?? 0} following</span>
                </span>
            </div>

            {actionCount > 0 && (
                <div className={cn("mt-4 grid gap-2 border-t border-border/20 pt-3", actionGrid)}>
                    {viewHref || onView ? (
                        viewHref ? (
                            <Link
                                href={viewHref}
                                className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-400 transition-colors hover:bg-amber-500/20"
                            >
                                <Eye size={12} />
                                View
                            </Link>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onView?.(signal)}
                                className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-400 transition-colors hover:bg-amber-500/20"
                            >
                                <Eye size={12} />
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
                                "flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60",
                                isFollowed
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                    : "border-border/30 bg-muted/10 text-foreground hover:bg-muted/20"
                            )}
                        >
                            {followLoading ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : isFollowed ? (
                                <Check size={12} />
                            ) : (
                                <UserPlus size={12} />
                            )}
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
                                "flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold transition-colors disabled:cursor-wait disabled:opacity-60",
                                signal.direction === "BUY"
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                    : "border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                            )}
                        >
                            {tradeLoading ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <Zap size={12} />
                            )}
                            {tradeLoading ? "Sending" : "Trade"}
                        </button>
                    ) : null}

                    {isCompletable && onComplete ? (
                        <button
                            type="button"
                            onClick={() => void onComplete(signal)}
                            disabled={completeLoading}
                            aria-busy={completeLoading}
                            className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border/30 bg-muted/10 px-3 py-2 text-[11px] font-bold text-foreground transition-colors hover:bg-muted/20 disabled:cursor-wait disabled:opacity-60"
                        >
                            {completeLoading ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <CheckCircle2 size={12} />
                            )}
                            {completeLoading ? "Closing" : "Complete"}
                        </button>
                    ) : null}
                </div>
            )}
        </article>
    );
}

function CompactPriceCell({
    label,
    value,
    color,
}: {
    label: string;
    value: number | undefined;
    color: string;
}) {
    return (
        <div className="min-w-0">
            <span className="block text-[10px] text-muted-foreground">{label}</span>
            <span className={cn("block truncate font-mono text-xs font-bold", color)}>
                {value != null && value !== 0 ? value.toFixed(5) : "—"}
            </span>
        </div>
    );
}
