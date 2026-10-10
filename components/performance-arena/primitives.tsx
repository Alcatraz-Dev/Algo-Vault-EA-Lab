"use client";

// Performance Arena — shared display primitives (client).
// All values arriving here were computed server-side; these components only
// render them. Design language: DESIGN.md (mono numbers, hairline cards,
// semantic colors, no gradients/glow).

import type { ReactNode } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { ARENA_DISCLAIMERS, type ChallengeStatus, type RuleEvent } from "@/lib/performance-arena/types";
import { formatCents } from "@/lib/performance-arena/money";

export function ArenaDisclaimer({ className, children }: { className?: string; children?: ReactNode }) {
    return (
        <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{children ?? `${ARENA_DISCLAIMERS.simulated} ${ARENA_DISCLAIMERS.noGuarantees}`}</span>
        </p>
    );
}

export function SimulatedBadge() {
    return (
        <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> Simulated · Virtual capital
        </Badge>
    );
}

const STATUS_TONE: Record<ChallengeStatus, StatusTone> = {
    DRAFT: "neutral",
    AVAILABLE: "info",
    ACTIVE: "live",
    PAUSED: "warning",
    PASSED: "positive",
    FAILED: "error",
    EXPIRED: "expired",
    CANCELLED: "neutral",
    ARCHIVED: "offline",
};

const STATUS_LABEL: Record<ChallengeStatus, string> = {
    DRAFT: "Draft",
    AVAILABLE: "Available",
    ACTIVE: "Active",
    PAUSED: "Paused",
    PASSED: "Passed",
    FAILED: "Failed",
    EXPIRED: "Expired",
    CANCELLED: "Cancelled",
    ARCHIVED: "Archived",
};

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
    return (
        <StatusBadge
            tone={STATUS_TONE[status]}
            label={STATUS_LABEL[status]}
            dot={status === "ACTIVE"}
            pulse={status === "ACTIVE"}
        />
    );
}

/** Horizontal usage bar — target (progress up), limits (usage down). */
export function LimitBar({
    label,
    usedPct,
    tone = "warning",
    detail,
    invert = false,
}: {
    label: string;
    usedPct: number;
    tone?: "positive" | "warning" | "negative" | "info";
    detail?: ReactNode;
    invert?: boolean;
}) {
    const clamped = Math.max(0, Math.min(100, usedPct));
    const fill =
        tone === "positive"
            ? "bg-emerald-500"
            : tone === "negative"
              ? "bg-red-500"
              : tone === "info"
                ? "bg-sky-500"
                : "bg-amber-500";
    return (
        <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono tabular-nums text-foreground">
                    {invert ? `${usedPct.toFixed(1)}%` : `${usedPct.toFixed(0)}%`}
                </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={cn("h-full rounded-full transition-all", fill)}
                    style={{ width: `${clamped}%` }}
                />
            </div>
            {detail ? <p className="text-micro text-muted-foreground">{detail}</p> : null}
        </div>
    );
}

export function ArenaLoading({ label = "Loading…" }: { label?: string }) {
    return (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {label}
        </div>
    );
}

export function ArenaError({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <div className="flex items-start justify-between gap-4">
                <span className="text-destructive">{message}</span>
                {onRetry ? (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/20"
                    >
                        Retry
                    </button>
                ) : null}
            </div>
        </div>
    );
}

/** Compact key/value row used across detail panels. */
export function KV({ label, value, mono = true }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 py-1 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn("text-foreground", mono && "font-mono tabular-nums")}>{value}</span>
        </div>
    );
}

export function RuleEventList({ events }: { events: Array<{ id?: string; eventId?: string; type?: string; severity?: "info" | "warning" | "critical"; message: string; timestamp: number }> }) {
    if (events.length === 0) {
        return <p className="text-xs text-muted-foreground">No rule events yet.</p>;
    }
    return (
        <ul className="space-y-2">
            {events.slice(0, 40).map((event, index) => {
                const key = event.eventId ?? event.id ?? `${event.timestamp}-${index}`;
                const critical = event.severity === "critical";
                const warning = event.severity === "warning";
                return (
                    <li
                        key={key}
                        className={cn(
                            "rounded-md border px-3 py-2 text-xs",
                            critical
                                ? "border-destructive/40 bg-destructive/10"
                                : warning
                                  ? "border-amber-500/30 bg-amber-500/5"
                                  : "border-border bg-muted/30"
                        )}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <span className={cn(critical ? "text-destructive" : warning ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                                {event.message}
                            </span>
                            <span className="shrink-0 font-mono text-micro text-muted-foreground">
                                {new Date(event.timestamp).toLocaleTimeString()}
                            </span>
                        </div>
                        {event.type ? (
                            <span className="mt-1 inline-block font-mono text-micro text-muted-foreground">{event.type}</span>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

/** Maps a RuleEvent list (rule engine shape) into the feed shape. */
export function ruleEventsToFeed(events: RuleEvent[]) {
    return events.map((e) => ({
        eventId: e.eventId,
        type: e.type,
        severity: e.severity === "BREACH" ? ("critical" as const) : e.severity === "WARNING" ? ("warning" as const) : ("info" as const),
        message: e.message,
        timestamp: e.timestamp,
    }));
}

export function Money({ cents, className, signed = false }: { cents: number; className?: string; signed?: boolean }) {
    const text = formatCents(cents);
    const display = signed && cents > 0 ? `+${text}` : text;
    return (
        <span className={cn("font-mono tabular-nums", cents < 0 && "text-red-500", cents > 0 && signed && "text-emerald-500", className)}>
            {display}
        </span>
    );
}

export function ArenaPageLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className="text-sm text-primary hover:underline">
            {children}
        </Link>
    );
}
