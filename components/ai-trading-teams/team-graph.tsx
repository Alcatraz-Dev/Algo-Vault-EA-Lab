"use client";

import { memo, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AgentNode, type AgentVisualState } from "./agent-visual";
import type { Stance, TeamAgentDefinition } from "@/lib/ai-trading-teams/types";

/**
 * TeamGraph — the interactive "AI command center" visualization.
 *
 *   CHIEF ANALYST
 *        ●
 *   /     |     \
 * RISK  RESEARCH  REGIME
 *   ●       ●       ●
 *  / \     / \     / \
 * TECH SMC QUANT NEWS MACRO
 *        \   |    /
 *   MARKET INTELLIGENCE (deterministic substrate)
 *
 * Layered layout with percentage-based SVG connectors (no layout measurement,
 * no reflow on updates). Connectors animate only while evidence actually
 * flows, and respect reduced-motion via the `.av-*` classes.
 */

const TIER_1 = ["risk-manager", "strategy-research", "market-regime", "quant-research"];
const TIER_2_SKIP = ["chief-analyst", ...TIER_1];

function tiersOf(agents: TeamAgentDefinition[]): TeamAgentDefinition[][] {
    const chief = agents.filter((a) => a.isChief || a.id === "chief-analyst");
    const tier1 = agents.filter((a) => TIER_1.includes(a.id) && !(a.isChief || a.id === "chief-analyst"));
    const tier2 = agents.filter(
        (a) => !TIER_2_SKIP.includes(a.id) && !(a.isChief || a.id === "chief-analyst"),
    );
    const rows: TeamAgentDefinition[][] = [];
    if (chief.length) rows.push(chief);
    if (tier1.length) rows.push(tier1);
    if (tier2.length) rows.push(tier2);
    return rows;
}

/** Percentage-based connector bus between two rows. */
const Connector = memo(function Connector({
    parentCount,
    childCount,
    parentActive,
    childActive,
    conflict,
}: {
    parentCount: number;
    childCount: number;
    parentActive: boolean[];
    childActive: boolean[];
    conflict: boolean;
}) {
    const parentX = (i: number) => ((i + 0.5) / Math.max(1, parentCount)) * 100;
    const childX = (i: number) => ((i + 0.5) / Math.max(1, childCount)) * 100;
    const anyFlow = childActive.some(Boolean) || parentActive.some(Boolean);
    const strokeClass = conflict ? "stroke-warning/70" : anyFlow ? "av-edge-flow stroke-primary/70" : "av-edge-idle stroke-border";

    const busY = 50;
    const childSpanMin = Math.min(...Array.from({ length: childCount }, (_, i) => childX(i)));
    const childSpanMax = Math.max(...Array.from({ length: childCount }, (_, i) => childX(i)));

    return (
        <div className="relative hidden h-10 w-full md:block" aria-hidden="true">
            <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="presentation"
            >
                {/* parent drops to bus */}
                {Array.from({ length: parentCount }, (_, i) => (
                    <line
                        key={`p${i}`}
                        x1={parentX(i)}
                        y1={0}
                        x2={parentX(i)}
                        y2={busY}
                        vectorEffect="non-scaling-stroke"
                        strokeWidth={1}
                        className={strokeClass}
                    />
                ))}
                {/* horizontal bus */}
                <line
                    x1={Math.min(childSpanMin, parentX(0))}
                    y1={busY}
                    x2={Math.max(childSpanMax, parentX(parentCount - 1))}
                    y2={busY}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1}
                    className={strokeClass}
                />
                {/* bus down to children */}
                {Array.from({ length: childCount }, (_, i) => (
                    <line
                        key={`c${i}`}
                        x1={childX(i)}
                        y1={busY}
                        x2={childX(i)}
                        y2={100}
                        vectorEffect="non-scaling-stroke"
                        strokeWidth={1}
                        className={strokeClass}
                    />
                ))}
            </svg>
            {/* mobile fallback */}
            <span className="absolute top-1/2 left-1/2 h-px w-8 -translate-x-1/2 bg-border md:hidden" />
        </div>
    );
});

export interface TeamGraphProps {
    agents: TeamAgentDefinition[];
    states: Record<string, AgentVisualState>;
    selectedId?: string | null;
    conflictIds?: string[];
    findings?: Record<string, string>;
    confidences?: Record<string, number>;
    onSelect: (agentId: string) => void;
    /** Optional footer node label (deterministic substrate). */
    substrateLabel?: string;
    accessibleSummary?: ReactNode;
}

export const TeamGraph = memo(function TeamGraph({
    agents,
    states,
    selectedId,
    conflictIds = [],
    findings = {},
    confidences = {},
    onSelect,
    substrateLabel = "AlgoVault Market Intelligence",
    accessibleSummary,
}: TeamGraphProps) {
    const rows = useMemo(() => tiersOf(agents), [agents]);
    const conflictSet = useMemo(() => new Set(conflictIds), [conflictIds]);

    const activeFlow = (id: string) => {
        const state = states[id];
        return state === "analyzing" || state === "completed";
    };

    const renderRow = (row: TeamAgentDefinition[], index: number) => (
        <div
            key={`row-${index}`}
            role="list"
            className={cn(
                "grid gap-2 sm:gap-3",
                row.length === 1 ? "grid-cols-1 justify-items-center" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
                index === 0 && "mx-auto w-full max-w-[320px]",
            )}
        >
            {row.map((agent) => (
                <div role="listitem" key={agent.id} className="flex justify-center">
                    <div className="w-full max-w-[190px]">
                        <AgentNode
                            agent={agent}
                            state={states[agent.id] ?? "idle"}
                            selected={selectedId === agent.id}
                            conflict={conflictSet.has(agent.id)}
                            latestFinding={findings[agent.id]}
                            confidence={confidences[agent.id]}
                            onClick={onSelect}
                        />
                    </div>
                </div>
            ))}
        </div>
    );

    return (
        <div className="flex w-full flex-col items-stretch gap-0">
            {/* Accessible, non-visual alternative (spec §36) */}
            <div className="sr-only">
                {accessibleSummary ?? (
                    <ul>
                        {agents.map((agent) => (
                            <li key={agent.id}>
                                {agent.name} ({agent.category}) — {states[agent.id] ?? "idle"}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {rows.map((row, index) => {
                const previous = rows[index - 1];
                return (
                    <div key={`block-${index}`} className="flex flex-col">
                        {index > 0 && previous ? (
                            <Connector
                                parentCount={previous.length}
                                childCount={row.length}
                                parentActive={previous.map((a) => activeFlow(a.id))}
                                childActive={row.map((a) => activeFlow(a.id))}
                                conflict={row.some((a) => conflictSet.has(a.id)) || previous.some((a) => conflictSet.has(a.id))}
                            />
                        ) : null}
                        {renderRow(row, index)}
                    </div>
                );
            })}

            {/* Deterministic substrate node */}
            {rows.length > 0 ? (
                <Connector
                    parentCount={rows[rows.length - 1].length}
                    childCount={1}
                    parentActive={rows[rows.length - 1].map((a) => activeFlow(a.id))}
                    childActive={[true]}
                    conflict={false}
                />
            ) : null}
            <div className="mx-auto flex w-full max-w-[420px] items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background/60 px-4 py-3 text-center">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" aria-hidden="true" />
                <span className="text-xs font-medium text-muted-foreground">{substrateLabel}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" aria-hidden="true" />
            </div>
        </div>
    );
});

/** Compact list alternative used on mobile instead of the full graph. */
export const AgentCarousel = memo(function AgentCarousel({
    agents,
    states,
    onSelect,
}: {
    agents: TeamAgentDefinition[];
    states: Record<string, AgentVisualState>;
    onSelect: (agentId: string) => void;
}) {
    return (
        <div className="flex gap-2 overflow-x-auto pb-2 md:hidden">
            {agents.map((agent) => (
                <div key={agent.id} className="w-[160px] shrink-0">
                    <AgentNode
                        agent={agent}
                        state={states[agent.id] ?? "idle"}
                        onClick={onSelect}
                    />
                </div>
            ))}
        </div>
    );
});

export function stanceColor(stance?: Stance): string {
    switch (stance) {
        case "bullish":
            return "text-positive";
        case "bearish":
            return "text-negative";
        case "neutral":
            return "text-muted-foreground";
        case "mixed":
            return "text-warning";
        default:
            return "text-muted-foreground/70";
    }
}
