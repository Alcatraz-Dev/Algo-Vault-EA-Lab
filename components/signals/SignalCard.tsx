"use client";

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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AISignal, SignalDirection, SignalStrength } from "@/lib/ai-signals/types";

type Props = {
    signal: AISignal;
    onView?: (signal: AISignal) => void;
    onFollow?: (signalId: string) => void;
    onTrade?: (signal: AISignal) => void;
    onComplete?: (signal: AISignal) => void;
    isFollowed?: boolean;
};

function directionConfig(direction: SignalDirection) {
    return direction === "BUY"
        ? {
              label: "BUY",
              color: "text-emerald-400",
              bg: "bg-emerald-500/10",
              border: "border-emerald-500/20",
              icon: TrendingUp,
          }
        : {
              label: "SELL",
              color: "text-rose-400",
              bg: "bg-rose-500/10",
              border: "border-rose-500/20",
              icon: TrendingDown,
          };
}

function confidenceColor(confidence: number) {
    if (confidence >= 80) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (confidence >= 60) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    return "text-rose-400 bg-rose-500/10 border-rose-500/20";
}

function strengthLabel(strength: SignalStrength) {
    const map: Record<SignalStrength, { label: string; color: string }> = {
        HIGH_CONVICTION: {
            label: "HIGH CONVICTION",
            color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
        },
        VERY_STRONG: {
            label: "VERY STRONG",
            color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
        },
        STRONG: {
            label: "STRONG",
            color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
        },
        GOOD: {
            label: "GOOD",
            color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
        },
        MODERATE: {
            label: "MODERATE",
            color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
        },
        WEAK: {
            label: "WEAK",
            color: "text-muted-foreground bg-muted/10 border-border/30",
        },
    };
    return map[strength];
}

const STATUS_DISPLAY_MAP: Record<string, { label: string; color: string; active: boolean }> = {
    ACTIVE: { label: "ACTIVE", color: "text-emerald-400", active: true },
    READY: { label: "READY", color: "text-blue-400", active: false },
    FORMING: { label: "FORMING", color: "text-amber-400", active: false },
    SCANNING: { label: "SCANNING", color: "text-muted-foreground", active: false },
    WATCH: { label: "WATCH", color: "text-blue-400", active: false },
    TP1_HIT: { label: "TP1 HIT", color: "text-emerald-400", active: true },
    TP2_HIT: { label: "TP2 HIT", color: "text-emerald-400", active: true },
    TP3_HIT: { label: "TP3 HIT", color: "text-emerald-400", active: true },
    RUNNER: { label: "RUNNER", color: "text-emerald-400", active: true },
    CANCELLED: { label: "CANCELLED", color: "text-foreground/70", active: false },
    EXPIRED: { label: "EXPIRED", color: "text-foreground/70", active: false },
    STOPPED: { label: "STOPPED", color: "text-rose-400", active: false },
    COMPLETED: { label: "COMPLETED", color: "text-muted-foreground", active: false },
};

function statusConfig(status: string) {
    return STATUS_DISPLAY_MAP[status] ?? { label: status, color: "text-muted-foreground", active: false };
}

const TRADABLE_STATUSES = new Set([
    "ACTIVE", "READY", "RUNNER", "TP1_HIT", "TP2_HIT", "TP3_HIT",
    "NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP1_REACHED", "TP2_REACHED",
    "TP3_REACHED", "TP4_REACHED", "TP5_REACHED", "TP5_OPEN_RUNNER", "BE_PROFIT_LOCK",
    "CREATED", "NEEDS_REVIEW",
]);

function formatTimeAgo(ts: number | undefined): string {
    if (ts == null || ts === 0) return "Unknown";
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ${Math.floor((mins % 60))}m`;
    if (days < 7) return `${days}d ${hours % 24}h`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SignalCard({ signal, onView, onFollow, onTrade, onComplete, isFollowed }: Props) {
    const dir = directionConfig(signal.direction);
    const DirIcon = dir.icon;
    const conf = confidenceColor(signal.confidence ?? 0);
    const strength = strengthLabel(signal.strength ?? "MODERATE");
    const status = statusConfig(signal.status);
    const isTradable = TRADABLE_STATUSES.has(signal.status);
    const isCompletable = signal.status === "ACTIVE" || signal.status === "READY" || signal.status === "RUNNER" || signal.status === "TP1_HIT" || signal.status === "TP2_HIT" || signal.status === "TP3_HIT";

    const hasTP1 = signal.tp1 != null && signal.tp1 !== 0;
    const hasTP2 = signal.tp2 != null && signal.tp2 !== 0;
    const hasTP3 = signal.tp3 != null && signal.tp3 !== 0;

    return (
        <div className="group relative rounded-2xl border border-border/30 bg-gradient-to-br from-card/95 via-card/80 to-card/60 backdrop-blur-xl transition-all duration-300 hover:border-border/60 hover:shadow-lg hover:shadow-amber-500/5 hover:-translate-y-0.5">
            {/* Top accent bar */}
            <div className={cn(
                "absolute top-0 left-4 right-4 h-[2px] rounded-full opacity-60 transition-opacity",
                signal.direction === "BUY" ? "bg-emerald-500/60" : "bg-rose-500/60",
                "group-hover:opacity-100"
            )} />

            {/* Header */}
            <div className="flex items-start justify-between p-4 pb-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-shadow",
                        dir.bg, dir.border, dir.color
                    )}>
                        <DirIcon size={15} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold tracking-tight text-foreground truncate">{signal.symbol}</h3>
                        <p className="text-[10px] text-muted-foreground">{signal.timeframe}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {signal.confidence != null && (
                        <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-bold", conf)}>
                            {signal.confidence}%
                        </span>
                    )}
                    <div className="flex items-center gap-1.5">
                        {status.active && (
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                            </span>
                        )}
                        <span className={cn("text-[10px] font-semibold", status.color)}>{status.label}</span>
                    </div>
                </div>
            </div>

            {/* Timestamp + Strength */}
            <div className="flex items-center justify-between px-4 pb-3">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Clock size={9} />
                    {formatTimeAgo(signal.createdAt)}
                </span>
                <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-bold", strength.color)}>
                    {strength.label}
                </span>
            </div>

            {/* Price Levels Grid */}
            <div className="mx-4 mb-3 grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-border/20 bg-border/10">
                <PriceCell label="Entry" value={signal.entry} color="text-amber-400" />
                <PriceCell label="SL" value={signal.stopLoss} color="text-rose-400" highlight />
                {hasTP1 && <PriceCell label="TP1" value={signal.tp1} color="text-emerald-400" />}
                {hasTP2 && <PriceCell label="TP2" value={signal.tp2} color="text-emerald-500/70" />}
                {hasTP3 && <PriceCell label="TP3" value={signal.tp3} color="text-emerald-500/50" />}
            </div>

            {/* Meta Row */}
            <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-3">
                    {signal.riskReward != null && (
                        <div className="flex items-center gap-1 text-[10px] text-foreground/70">
                            <Target size={10} />
                            <span className="font-medium">RR {signal.riskReward.toFixed(1)}</span>
                        </div>
                    )}
                    {signal.suggestedRiskPercent != null && (
                        <div className="flex items-center gap-1 text-[10px] text-foreground/70">
                            <Shield size={10} />
                            <span className="font-medium">{signal.suggestedRiskPercent}% risk</span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-foreground/50">
                    <BarChart3 size={10} />
                    <span>{signal.followCount ?? 0} following</span>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex border-t border-border/10 mt-2">
                {onView ? (
                    <button
                        onClick={() => onView(signal)}
                        className="flex flex-1 items-center justify-center gap-1.5 border-r border-border/10 px-3 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    >
                        <Eye size={12} />
                        View
                    </button>
                ) : null}
                {onFollow ? (
                    <button
                        onClick={() => onFollow(signal.id)}
                        className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 border-r border-border/10 px-3 py-2.5 text-[11px] font-medium transition-colors hover:bg-foreground/5",
                            isFollowed
                                ? "text-emerald-400 hover:text-emerald-300 bg-emerald-500/5"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <UserPlus size={12} />
                        {isFollowed ? "Following" : "Follow"}
                    </button>
                ) : null}
                {onTrade && isTradable ? (
                    <button
                        onClick={() => onTrade(signal)}
                        className={cn(
                            "flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-bold transition-all",
                            signal.direction === "BUY"
                                ? "text-emerald-400 hover:bg-emerald-500/10"
                                : "text-rose-400 hover:bg-rose-500/10"
                        )}
                    >
                        <Zap size={12} />
                        Trade
                    </button>
                ) : null}
                {isCompletable && onComplete ? (
                    <button
                        onClick={() => onComplete(signal)}
                        className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-bold transition-all text-blue-400 hover:bg-blue-500/10"
                    >
                        <CheckCircle2 size={12} />
                        Complete
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function PriceCell({
    label,
    value,
    color,
    highlight,
}: {
    label: string;
    value: number | undefined;
    color: string;
    highlight?: boolean;
}) {
    return (
        <div className={cn(
            "flex flex-col items-center px-2 py-2.5",
            highlight ? "bg-rose-500/5" : "bg-muted/15"
        )}>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                    <span className={cn("font-mono text-xs font-bold", color)}>
                        {value != null && value !== 0 ? value.toFixed(5) : "—"}
                    </span>
        </div>
    );
}