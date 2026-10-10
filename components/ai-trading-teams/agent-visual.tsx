"use client";

import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AgentRunStatus, AgentVisualType, TeamAgentDefinition } from "@/lib/ai-trading-teams/types";

/**
 * AgentAvatar / AgentNode — the AlgoVault-native agent visual system.
 *
 * Sophisticated instrument aesthetic (financial/AI, never cartoon robots):
 * layered rings, a signal core and per-state motion that stays subtle.
 * All motion respects `prefers-reduced-motion` (animations are defined in
 * app/globals.css under the `.av-*` classes).
 */

export type AgentVisualState =
    | "idle"
    | "waiting"
    | "scheduled"
    | "analyzing"
    | "completed"
    | "warning"
    | "error"
    | "disabled"
    | "skipped"
    | "blocked";

export function stateFromRunStatus(status?: AgentRunStatus | string): AgentVisualState {
    switch (status) {
        case "analyzing":
        case "scheduled":
            return "analyzing";
        case "completed":
            return "completed";
        case "partial":
            return "warning";
        case "failed":
            return "error";
        case "skipped":
            return "skipped";
        case "blocked":
            return "blocked";
        case "waiting":
            return "waiting";
        default:
            return "idle";
    }
}

const STATE_RING: Record<AgentVisualState, string> = {
    idle: "border-border",
    waiting: "border-border/70 av-ring-pulse",
    scheduled: "border-primary/50 av-ring-pulse",
    analyzing: "border-primary/70 av-ring-spin",
    completed: "border-positive/60",
    warning: "border-warning/70 av-ring-pulse",
    error: "border-destructive/70",
    disabled: "border-border/40 opacity-50",
    skipped: "border-border/40 opacity-60",
    blocked: "border-warning/60",
};

const STATE_CORE: Record<AgentVisualState, string> = {
    idle: "from-muted to-card text-muted-foreground",
    waiting: "from-muted to-card text-muted-foreground",
    scheduled: "from-primary/20 to-card text-primary",
    analyzing: "from-primary/30 to-card text-primary av-core-pulse",
    completed: "from-positive/20 to-card text-positive",
    warning: "from-warning/25 to-card text-warning",
    error: "from-destructive/25 to-card text-destructive",
    disabled: "from-muted to-card text-muted-foreground",
    skipped: "from-muted to-card text-muted-foreground",
    blocked: "from-warning/25 to-card text-warning",
};

const STATE_DOT: Record<AgentVisualState, string> = {
    idle: "bg-muted-foreground/60",
    waiting: "bg-muted-foreground/70 av-dot-pulse",
    scheduled: "bg-primary av-dot-pulse",
    analyzing: "bg-primary av-dot-pulse",
    completed: "bg-positive",
    warning: "bg-warning av-dot-pulse",
    error: "bg-destructive",
    disabled: "bg-muted-foreground/40",
    skipped: "bg-muted-foreground/40",
    blocked: "bg-warning",
};

/** Distinct inner motif per visual type — the instrument's "face". */
function VisualMotif({ visualType }: { visualType: AgentVisualType }) {
    const common = "h-full w-full";
    switch (visualType) {
        case "market-pulse":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <polyline
                        points="3,22 10,22 14,12 18,30 22,18 26,24 37,24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.9"
                    />
                </svg>
            );
        case "radar":
        case "event-radar":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                    <circle cx="20" cy="20" r="9" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                    <line x1="20" y1="4" x2="20" y2="36" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
                    <line x1="4" y1="20" x2="36" y2="20" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
                    <circle cx="26" cy="14" r="2.2" fill="currentColor" className="av-blip" />
                </svg>
            );
        case "liquidity-radar":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <path d="M6 26 Q13 20 20 26 T34 26" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.85" />
                    <path d="M6 20 Q13 14 20 20 T34 20" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
                    <line x1="6" y1="31" x2="34" y2="31" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
                </svg>
            );
        case "analytical-sphere":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <ellipse cx="20" cy="20" rx="14" ry="6" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
                    <ellipse cx="20" cy="20" rx="6" ry="14" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
                    <circle cx="20" cy="20" r="2.4" fill="currentColor" />
                </svg>
            );
        case "signal-node":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <path d="M8 28 L20 10 L32 28" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.8" />
                    <circle cx="20" cy="10" r="2.4" fill="currentColor" />
                    <circle cx="8" cy="28" r="2" fill="currentColor" opacity="0.7" />
                    <circle cx="32" cy="28" r="2" fill="currentColor" opacity="0.7" />
                </svg>
            );
        case "research-prism":
        case "research-lens":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <path d="M20 7 L33 30 L7 30 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" opacity="0.85" />
                    <line x1="13" y1="24" x2="27" y2="24" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                    <line x1="16" y1="18" x2="24" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                </svg>
            );
        case "shield":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <path
                        d="M20 6 L32 11 V21 C32 28 26.5 32.5 20 34.5 C13.5 32.5 8 28 8 21 V11 Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        opacity="0.9"
                    />
                    <path d="M14.5 20.5 L18.5 24.5 L26 16.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            );
        case "contrarian-core":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <path d="M8 14 H32" stroke="currentColor" strokeWidth="1.4" opacity="0.8" />
                    <path d="M8 14 L4 24 H12 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M32 14 L28 24 H36 Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="20" y1="10" x2="20" y2="30" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M14 30 H26" stroke="currentColor" strokeWidth="1.4" />
                </svg>
            );
        case "validation-gate":
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <rect x="8" y="8" width="24" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.75" />
                    <path d="M14 20.5 L18.5 25 L27 15.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            );
        case "chief-core":
        default:
            return (
                <svg viewBox="0 0 40 40" className={common} aria-hidden="true">
                    <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                    <circle cx="20" cy="20" r="8" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
                    <circle cx="20" cy="20" r="3.4" fill="currentColor" className="av-blip" />
                    {[0, 60, 120, 180, 240, 300].map((deg) => (
                        <circle
                            key={deg}
                            cx={20 + 13 * Math.cos((deg * Math.PI) / 180)}
                            cy={20 + 13 * Math.sin((deg * Math.PI) / 180)}
                            r="1.3"
                            fill="currentColor"
                            opacity="0.7"
                        />
                    ))}
                </svg>
            );
    }
}

export function AgentAvatar({
    visualType,
    state = "idle",
    size = 56,
    className,
}: {
    visualType: AgentVisualType;
    state?: AgentVisualState;
    size?: number;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "av-root relative inline-flex shrink-0 items-center justify-center rounded-full border bg-gradient-to-b",
                STATE_RING[state],
                STATE_CORE[state],
                className,
            )}
            style={{ width: size, height: size }}
            data-state={state}
            data-visual={visualType}
        >
            <span className="absolute inset-[3px] rounded-full border border-border/40" aria-hidden="true" />
            <span className="absolute inset-[8px] opacity-90" aria-hidden="true">
                <VisualMotif visualType={visualType} />
            </span>
        </span>
    );
}

export function AgentStateDot({ state, className }: { state: AgentVisualState; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[state], className)}
            data-state={state}
        />
    );
}

/**
 * Interactive team-graph node: avatar + identity + live status + latest
 * finding. Entirely memoized so realtime run updates don't re-render the
 * whole graph.
 */
export const AgentNode = memo(function AgentNode({
    agent,
    state,
    selected,
    conflict,
    latestFinding,
    confidence,
    onClick,
}: {
    agent: TeamAgentDefinition;
    state: AgentVisualState;
    selected?: boolean;
    conflict?: boolean;
    latestFinding?: string;
    confidence?: number;
    onClick?: (agentId: string) => void;
}) {
    const isChief = agent.isChief || agent.id === "chief-analyst";
    return (
        <button
            type="button"
            onClick={() => onClick?.(agent.id)}
            aria-label={`${agent.name} — ${state}${conflict ? " — in disagreement" : ""}`}
            aria-pressed={selected}
            className={cn(
                "group relative flex w-full min-w-0 flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-colors outline-none",
                "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                selected ? "border-primary/60 bg-primary/5" : "border-border/60 bg-card/70 hover:border-border hover:bg-card",
                conflict && "border-warning/50",
                isChief && "border-primary/40 bg-primary/[0.04]",
            )}
        >
            <span
                className={cn(
                    "absolute -top-px left-1/2 h-px w-10 -translate-x-1/2",
                    isChief ? "bg-primary/60" : "bg-transparent",
                )}
                aria-hidden="true"
            />
            <span className="relative">
                <AgentAvatar visualType={agent.visualType} state={state} size={isChief ? 64 : 52} />
                <span className="absolute -right-0.5 -bottom-0.5 rounded-full border border-background bg-card p-0.5">
                    <AgentStateDot state={state} />
                </span>
            </span>
            <span className="w-full min-w-0">
                <span className="block truncate text-xs font-semibold text-foreground">{agent.name}</span>
                <span className="mt-0.5 flex items-center justify-center gap-1.5 text-micro capitalize text-muted-foreground">
                    {agent.category.replace("-", " ")}
                    {typeof confidence === "number" && confidence > 0 ? (
                        <span className="tabular-nums text-foreground/70">{Math.round(confidence * 100)}%</span>
                    ) : null}
                </span>
            </span>
            {latestFinding ? (
                <span className="line-clamp-2 w-full text-micro leading-snug text-muted-foreground">{latestFinding}</span>
            ) : null}
        </button>
    );
});

export function stateLabel(state: AgentVisualState): string {
    switch (state) {
        case "analyzing":
            return "Analyzing";
        case "completed":
            return "Completed";
        case "warning":
            return "Partial";
        case "error":
            return "Failed";
        case "waiting":
            return "Waiting";
        case "scheduled":
            return "Queued";
        case "skipped":
            return "Skipped";
        case "blocked":
            return "Blocked";
        case "disabled":
            return "Disabled";
        default:
            return "Idle";
    }
}

export function LegendItem({ state, label, icon }: { state: AgentVisualState; label: string; icon?: ReactNode }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-micro text-muted-foreground">
            <AgentStateDot state={state} />
            {icon}
            {label}
        </span>
    );
}
