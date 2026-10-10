"use client";

import { memo, useState } from "react";
import { AlertTriangle, ChevronDown, Lightbulb, Radar, ShieldAlert, Target, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader } from "@/components/ui/section-header";
import type {
    AgentObservation,
    AgentRunOutput,
    ChiefSynthesis,
    EvidenceKind,
    TeamConsensus,
} from "@/lib/ai-trading-teams/types";

/**
 * EvidencePanel — the live evidence feed and the final research brief.
 * Evidence-first: every observation is classed FACT / INTERPRETATION /
 * HYPOTHESIS / RISK / INVALIDATION / UNKNOWN with its source reference.
 */

const KIND_META: Record<EvidenceKind, { label: string; className: string; icon: React.ReactNode }> = {
    FACT: { label: "FACT", className: "border-positive/40 text-positive", icon: <Target className="size-3" /> },
    INTERPRETATION: { label: "INTERPRETATION", className: "border-border text-foreground/80", icon: <Lightbulb className="size-3" /> },
    HYPOTHESIS: { label: "HYPOTHESIS", className: "border-info/40 text-info", icon: <Radar className="size-3" /> },
    RISK: { label: "RISK", className: "border-warning/50 text-warning", icon: <ShieldAlert className="size-3" /> },
    INVALIDATION: { label: "INVALIDATION", className: "border-destructive/40 text-destructive", icon: <AlertTriangle className="size-3" /> },
    UNKNOWN: { label: "UNKNOWN", className: "border-border/60 text-muted-foreground", icon: <HelpCircle className="size-3" /> },
};

export function EvidenceChip({ kind, className }: { kind: EvidenceKind; className?: string }) {
    const meta = KIND_META[kind] ?? KIND_META.UNKNOWN;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-micro font-semibold tracking-wide",
                meta.className,
                className,
            )}
        >
            {meta.icon}
            {meta.label}
        </span>
    );
}

export const ObservationRow = memo(function ObservationRow({ observation }: { observation: AgentObservation }) {
    const meta = KIND_META[observation.kind] ?? KIND_META.UNKNOWN;
    return (
        <li className="av-evidence-in flex items-start gap-2 border-l border-border/60 pl-2.5">
            <span className="mt-0.5 shrink-0">{meta.icon}</span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <EvidenceChip kind={observation.kind} />
                    {observation.reference ? (
                        <code className="max-w-full truncate rounded bg-muted px-1 py-0.5 text-micro text-muted-foreground">
                            {observation.reference}
                        </code>
                    ) : null}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-foreground/85">{observation.text}</p>
            </div>
        </li>
    );
});

export const AgentEvidenceCard = memo(function AgentEvidenceCard({
    output,
    compact = false,
}: {
    output: AgentRunOutput;
    compact?: boolean;
}) {
    const [expanded, setExpanded] = useState(!compact);
    const hasObservations = output.observations.length > 0;

    return (
        <div className="rounded-lg border border-border/60 bg-card/60 p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">
                        {output.agentName ?? output.agentId}
                    </p>
                    <p className="mt-0.5 text-micro leading-snug text-muted-foreground">{output.summary}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge
                        tone={
                            output.status === "completed"
                                ? "positive"
                                : output.status === "failed"
                                    ? "error"
                                    : output.status === "partial"
                                        ? "warning"
                                        : "neutral"
                        }
                        label={output.status}
                        dot
                    />
                    {output.status === "completed" ? (
                        <span className="text-micro tabular-nums text-muted-foreground">
                            conf {Math.round(output.confidence * 100)}%
                        </span>
                    ) : null}
                </div>
            </div>

            {output.warnings?.length ? (
                <ul className="mt-2 space-y-1">
                    {output.warnings.map((w, i) => (
                        <li key={i} className="rounded border border-warning/30 bg-warning/5 px-2 py-1 text-micro text-warning">
                            {w}
                        </li>
                    ))}
                </ul>
            ) : null}

            {hasObservations ? (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="mt-2 flex w-full items-center justify-between text-micro text-muted-foreground hover:text-foreground"
                    aria-expanded={expanded}
                >
                    <span>
                        {output.observations.length} observation{output.observations.length === 1 ? "" : "s"} ·{" "}
                        {output.evidence.length} source{output.evidence.length === 1 ? "" : "s"}
                    </span>
                    <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
                </button>
            ) : null}

            {expanded && hasObservations ? (
                <ul className="mt-2 space-y-2">
                    {output.observations.map((obs) => (
                        <ObservationRow key={obs.id} observation={obs} />
                    ))}
                </ul>
            ) : null}

            {expanded && output.status === "completed" ? (
                <div className="mt-3 space-y-2 border-t border-border/50 pt-2">
                    {output.interpretation ? (
                        <div>
                            <p className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">Interpretation</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">{output.interpretation}</p>
                        </div>
                    ) : null}
                    {output.risks.length ? (
                        <div>
                            <p className="text-micro font-semibold tracking-wide text-warning uppercase">Risks</p>
                            <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                                {output.risks.map((r, i) => (
                                    <li key={i} className="text-xs text-foreground/80">{r}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {output.invalidations.length ? (
                        <div>
                            <p className="text-micro font-semibold tracking-wide text-destructive uppercase">Invalidation</p>
                            <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                                {output.invalidations.map((r, i) => (
                                    <li key={i} className="text-xs text-foreground/80">{r}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {output.limitations.length ? (
                        <div>
                            <p className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">Limitations</p>
                            <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                                {output.limitations.map((r, i) => (
                                    <li key={i} className="text-xs text-muted-foreground">{r}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {output.error ? (
                        <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-micro text-destructive">
                            {output.error}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
});

export function ConsensusBar({ consensus }: { consensus: TeamConsensus }) {
    const total = Math.max(
        1,
        Object.values(consensus.agentsByStance).reduce((sum, list) => sum + list.length, 0),
    );
    const segments: { stance: string; count: number; className: string }[] = [
        { stance: "bullish", count: consensus.agentsByStance.bullish.length, className: "bg-positive" },
        { stance: "bearish", count: consensus.agentsByStance.bearish.length, className: "bg-negative" },
        { stance: "neutral", count: consensus.agentsByStance.neutral.length, className: "bg-muted-foreground/50" },
        { stance: "mixed", count: consensus.agentsByStance.mixed.length, className: "bg-warning" },
        { stance: "unclear", count: consensus.agentsByStance.unclear.length, className: "bg-muted" },
    ].filter((s) => s.count > 0);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                    Consensus: <span className="capitalize">{consensus.stance}</span>
                </span>
                <span className="text-micro text-muted-foreground">
                    {Math.round(consensus.agreementRatio * 100)}% agreement
                </span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Consensus ${consensus.stance}`}>
                {segments.map((seg) => (
                    <span
                        key={seg.stance}
                        className={cn("h-full transition-all duration-500", seg.className)}
                        style={{ width: `${(seg.count / total) * 100}%` }}
                        title={`${seg.stance}: ${seg.count}`}
                    />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
                {segments.map((seg) => (
                    <span key={seg.stance} className="inline-flex items-center gap-1 text-micro text-muted-foreground">
                        <span className={cn("h-1.5 w-1.5 rounded-full", seg.className)} />
                        <span className="capitalize">{seg.stance}</span> {seg.count}
                    </span>
                ))}
            </div>

            {consensus.conflicts.length > 0 ? (
                <ul className="space-y-1.5 pt-1">
                    {consensus.conflicts.map((conflict) => (
                        <li
                            key={conflict.id}
                            className={cn(
                                "rounded border px-2 py-1.5 text-micro leading-snug",
                                conflict.kind === "critical-risk"
                                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                                    : conflict.kind === "stance"
                                        ? "border-warning/40 bg-warning/5 text-warning"
                                        : "border-border bg-muted/40 text-muted-foreground",
                            )}
                        >
                            <span className="font-semibold">{conflict.label}: </span>
                            {conflict.detail}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

const SETUP_STATE_TONE: Record<string, "positive" | "warning" | "negative" | "info" | "neutral"> = {
    CONFIRMED: "positive",
    VALIDATING: "info",
    WATCHING: "neutral",
    WAITING: "neutral",
    INVALIDATED: "negative",
    CANCELLED: "neutral",
};

export function SynthesisBrief({ synthesis }: { synthesis: ChiefSynthesis }) {
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                    tone={SETUP_STATE_TONE[synthesis.setupState] ?? "neutral"}
                    label={synthesis.setupState}
                    dot
                />
                <StatusBadge
                    tone={synthesis.status === "final" ? "positive" : synthesis.status === "blocked" ? "warning" : "info"}
                    label={`synthesis ${synthesis.status}`}
                />
                <StatusBadge
                    tone={synthesis.dataFreshness.mode === "live" ? "live" : "stale"}
                    label={synthesis.dataFreshness.mode.toUpperCase()}
                />
                {synthesis.dataFreshness.stale ? <StatusBadge tone="warning" label="stale data" /> : null}
                <span className="ml-auto text-micro text-muted-foreground tabular-nums">
                    confidence {Math.round(synthesis.confidence * 100)}%
                </span>
            </div>

            {synthesis.blockedReason ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
                    <span className="font-semibold">Blocked: </span>
                    {synthesis.blockedReason}
                </div>
            ) : null}

            <Block title="Market Context">{synthesis.marketContext}</Block>

            {synthesis.evidence.length ? (
                <div>
                    <p className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">Evidence chain</p>
                    <ul className="mt-1.5 space-y-2">
                        {synthesis.evidence.map((obs) => (
                            <ObservationRow key={obs.id} observation={obs} />
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
                <CaseList title="Bullish case" items={synthesis.bullishCase} tone="positive" />
                <CaseList title="Bearish case" items={synthesis.bearishCase} tone="negative" />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <CaseList title="Risks" items={synthesis.risks} tone="warning" />
                <CaseList title="Invalidation" items={synthesis.invalidations} tone="destructive" />
            </div>

            {synthesis.missingEvidence.length ? (
                <CaseList title="Missing evidence" items={synthesis.missingEvidence} tone="muted" />
            ) : null}

            <Block title="Research next step">{synthesis.researchNextStep}</Block>

            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">Data freshness</p>
                <p className="mt-1 text-xs text-foreground/80">
                    Mode {synthesis.dataFreshness.mode.toUpperCase()} · data timestamp{" "}
                    <span className="tabular-nums">{synthesis.dataFreshness.dataTimestamp}</span>
                    {synthesis.dataFreshness.asOf ? <> · as-of cutoff {new Date(synthesis.dataFreshness.asOf).toLocaleString()}</> : null}
                    {synthesis.dataFreshness.ageMs > 0 ? (
                        <> · age {Math.round(synthesis.dataFreshness.ageMs / 1000)}s</>
                    ) : null}
                </p>
                {synthesis.synthesisNotes ? (
                    <p className="mt-2 text-xs text-muted-foreground">{synthesis.synthesisNotes}</p>
                ) : null}
            </div>

            <p className="text-micro leading-relaxed text-muted-foreground">{synthesis.disclaimer}</p>
        </div>
    );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <p className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
            <div className="mt-1 text-xs leading-relaxed text-foreground/85">{children}</div>
        </div>
    );
}

function CaseList({
    title,
    items,
    tone,
}: {
    title: string;
    items: string[];
    tone: "positive" | "negative" | "warning" | "destructive" | "muted";
}) {
    const toneClass =
        tone === "positive"
            ? "text-positive"
            : tone === "negative"
                ? "text-negative"
                : tone === "warning"
                    ? "text-warning"
                    : tone === "destructive"
                        ? "text-destructive"
                        : "text-muted-foreground";
    return (
        <div>
            <p className={cn("text-micro font-semibold tracking-wide uppercase", toneClass)}>{title}</p>
            {items.length ? (
                <ul className="mt-1.5 space-y-1">
                    {items.map((item, i) => (
                        <li key={i} className="rounded border border-border/60 bg-card/60 px-2 py-1.5 text-xs leading-snug text-foreground/85">
                            {item}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-1 text-xs text-muted-foreground">No {title.toLowerCase()} established from the available evidence.</p>
            )}
        </div>
    );
}

export function EvidenceSectionHeader({ meta }: { meta?: React.ReactNode }) {
    return <SectionHeader title="Live evidence" description="Structured observations from the team" meta={meta} />;
}
