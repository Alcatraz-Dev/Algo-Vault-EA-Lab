"use client";

import {
    Crosshair,
    TrendingUp,
    TrendingDown,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Clock,
    Zap,
    RefreshCw,
    ChevronUp,
    ChevronDown,
    Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SignalTimelineEvent } from "@/lib/ai-signals/types";

type Props = {
    events: SignalTimelineEvent[];
};

function eventConfig(type: SignalTimelineEvent["type"]) {
    switch (type) {
        case "SETUP_DETECTED":
            return {
                icon: Crosshair,
                color: "text-amber-400",
                bg: "bg-amber-500/10",
                border: "border-amber-500/20",
                dot: "bg-amber-500",
            };
        case "CONFIDENCE_CHANGE":
            return {
                icon: RefreshCw,
                color: "text-blue-400",
                bg: "bg-blue-500/10",
                border: "border-blue-500/20",
                dot: "bg-blue-500",
            };
        case "STATUS_CHANGE":
            return {
                icon: Zap,
                color: "text-blue-400",
                bg: "bg-blue-500/10",
                border: "border-blue-500/20",
                dot: "bg-blue-500",
            };
        case "ENTRY_TRIGGERED":
            return {
                icon: Crosshair,
                color: "text-amber-400",
                bg: "bg-amber-500/10",
                border: "border-amber-500/20",
                dot: "bg-amber-500",
            };
        case "TP1_HIT":
        case "TP2_HIT":
        case "TP3_HIT":
            return {
                icon: CheckCircle2,
                color: "text-emerald-400",
                bg: "bg-emerald-500/10",
                border: "border-emerald-500/20",
                dot: "bg-emerald-500",
            };
        case "SL_HIT":
            return {
                icon: XCircle,
                color: "text-rose-400",
                bg: "bg-rose-500/10",
                border: "border-rose-500/20",
                dot: "bg-rose-500",
            };
        case "SIGNAL_INVALIDATED":
            return {
                icon: AlertTriangle,
                color: "text-rose-400",
                bg: "bg-rose-500/10",
                border: "border-rose-500/20",
                dot: "bg-rose-500",
            };
        case "SIGNAL_EXPIRED":
            return {
                icon: Clock,
                color: "text-muted-foreground",
                bg: "bg-muted/10",
                border: "border-border/30",
                dot: "bg-muted",
            };
        case "MANAGEMENT_UPDATE":
            return {
                icon: RefreshCw,
                color: "text-blue-400",
                bg: "bg-blue-500/10",
                border: "border-blue-500/20",
                dot: "bg-blue-500",
            };
        default:
            return {
                icon: Minus,
                color: "text-muted-foreground",
                bg: "bg-muted/10",
                border: "border-border/30",
                dot: "bg-muted",
            };
    }
}

function formatTime(timestamp: number) {
    const d = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function SignalTimeline({ events }: Props) {
    const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);

    if (sorted.length === 0) {
        return (
            <div className="rounded-2xl border border-border/20 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-4">
                <div className="flex flex-col items-center justify-center py-12">
                    <Clock size={20} className="mb-2 text-foreground/50" />
                    <p className="text-xs text-foreground/50">No timeline events</p>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-border/20 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl overflow-hidden">
            {/* Header */}
            <div className="border-b border-border/10 px-4 py-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Signal Timeline
                </h3>
            </div>

            {/* Timeline */}
            <div className="max-h-[400px] overflow-y-auto p-4">
                <div className="relative">
                    {/* Vertical line */}
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-background/20" />

                    <div className="space-y-4">
                        {sorted.map((event, i) => {
                            const cfg = eventConfig(event.type);
                            const Icon = cfg.icon;

                            return (
                                <div key={event.id} className="relative flex gap-3">
                                    {/* Dot */}
                                    <div className="relative z-10 mt-0.5">
                                        <div
                                            className={cn(
                                                "flex h-[15px] w-[15px] items-center justify-center rounded-full border",
                                                cfg.bg,
                                                cfg.border
                                            )}
                                        >
                                            <div className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex items-center gap-1.5">
                                                <Icon size={11} className={cfg.color} />
                                                <span className="text-[11px] font-medium text-foreground/70">
                                                    {event.type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase())}
                                                </span>
                                            </div>
                                            <span className="text-[9px] text-foreground/50 whitespace-nowrap">
                                                {formatTime(event.timestamp)}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[11px] leading-relaxed text-foreground/70">
                                            {event.message}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
