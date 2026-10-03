"use client";

import { memo } from "react";
import { Wrench, Clock, FileWarning, Info } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { AgentAvatar, stateLabel, type AgentVisualState } from "./agent-visual";
import { AgentEvidenceCard } from "./evidence-panel";
import { cn } from "@/lib/utils";
import type { AgentRunOutput, TeamAgentDefinition } from "@/lib/ai-trading-teams/types";

/**
 * AgentDetailPanel — opens when an agent node is clicked.
 *
 * Shows purpose, state, what it analyzed, evidence, tools, confidence,
 * invalidations, risks, timestamp and limitations. Only user-safe reasoning
 * summaries are shown — never hidden chain-of-thought.
 */

export const AgentDetailPanel = memo(function AgentDetailPanel({
    agent,
    state,
    output,
    open,
    onClose,
}: {
    agent: TeamAgentDefinition;
    state: AgentVisualState;
    output?: AgentRunOutput;
    open: boolean;
    onClose: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
                <div className="flex items-start gap-4">
                    <AgentAvatar visualType={agent.visualType} state={state} size={72} />
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="text-base">{agent.name}</DialogTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">{agent.description}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <StatusBadge
                                tone={
                                    state === "completed"
                                        ? "positive"
                                        : state === "error"
                                            ? "error"
                                            : state === "analyzing"
                                                ? "live"
                                                : state === "warning" || state === "blocked"
                                                    ? "warning"
                                                    : "neutral"
                                }
                                label={stateLabel(state)}
                                dot
                                pulse={state === "analyzing"}
                            />
                            <StatusBadge tone="neutral" label={`v${agent.version}`} />
                            <StatusBadge tone="neutral" label={agent.category} />
                            {agent.isChief ? <StatusBadge tone="active" label="chief" /> : null}
                        </div>
                    </div>
                </div>

                <section className="space-y-1">
                    <DetailHeading icon={<Info className="size-3.5" />} title="Purpose & responsibilities" />
                    <p className="text-xs leading-relaxed text-foreground/85">{agent.systemInstructions}</p>
                </section>

                <section className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <DetailHeading icon={<Wrench className="size-3.5" />} title="Allowed tools" />
                        <div className="flex flex-wrap gap-1">
                            {agent.tools.map((tool) => (
                                <span key={tool} className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {tool}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div>
                        <DetailHeading icon={<Clock className="size-3.5" />} title="Execution" />
                        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                            <li>Timeout {Math.round((agent.timeoutMs ?? 30000) / 1000)}s · retries {agent.maxRetries ?? 1}</li>
                            <li>Required inputs: {agent.requiredInputs.join(", ") || "—"}</li>
                            <li>Optional inputs: {agent.optionalInputs.join(", ") || "—"}</li>
                            <li>Activation: {agent.activationTags.join(", ") || "—"}</li>
                        </ul>
                    </div>
                </section>

                <section>
                    <DetailHeading icon={<FileWarning className="size-3.5" />} title="Declared limitations" />
                    <ul className="list-inside list-disc space-y-0.5">
                        {agent.limitations.length ? (
                            agent.limitations.map((l, i) => (
                                <li key={i} className="text-[11px] text-muted-foreground">{l}</li>
                            ))
                        ) : (
                            <li className="text-[11px] text-muted-foreground">No additional limitations declared.</li>
                        )}
                    </ul>
                </section>

                <section>
                    <DetailHeading title="Current run output" />
                    {output ? (
                        <AgentEvidenceCard output={output} />
                    ) : (
                        <p className="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                            No output for this agent yet. Run an analysis to see its structured evidence.
                        </p>
                    )}
                </section>

                {output?.reasoningSummary ? (
                    <section>
                        <DetailHeading title="Reasoning summary" />
                        <p className="rounded border border-border/60 bg-muted/30 p-2.5 text-xs leading-relaxed text-foreground/80">
                            {output.reasoningSummary}
                        </p>
                    </section>
                ) : null}

                <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Confidence" value={output ? `${Math.round(output.confidence * 100)}%` : "—"} />
                    <Metric label="Observations" value={output ? String(output.observations.length) : "—"} />
                    <Metric
                        label="Duration"
                        value={output?.durationMs ? `${(output.durationMs / 1000).toFixed(1)}s` : "—"}
                    />
                    <Metric label="Data timestamp" value={output ? new Date(output.dataTimestamp).toLocaleTimeString() : "—"} />
                </section>
            </DialogContent>
        </Dialog>
    );
});

function DetailHeading({ icon, title }: { icon?: React.ReactNode; title: string }) {
    return (
        <h4 className={cn("mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase")}>
            {icon}
            {title}
        </h4>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded border border-border/60 bg-card/60 px-2 py-1.5">
            <p className="text-[9px] tracking-wide text-muted-foreground uppercase">{label}</p>
            <p className="mt-0.5 text-xs font-semibold text-foreground tabular-nums">{value}</p>
        </div>
    );
}
