"use client";

import { Brain, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EvidenceSection } from "@/lib/ai/analysis/intelligence";
import type { ConfidenceComponent } from "@/lib/ai/agents/pipeline";
import { AwaitingState, SourceFooter, TerminalPanel } from "@/components/scalping/TerminalPrimitives";

/**
 * AI evidence panel.
 *
 * This is where the terminal explains itself. Each section carries a score that
 * is either a real 0–1 measurement or `null`; a `null` renders as an explicit
 * unavailable state with the source still named, because "we could not measure
 * this" is itself useful information.
 *
 * The final confidence block shows the components of the single derived number
 * in the whole module, including the exported weights, so the arithmetic is
 * inspectable rather than asserted.
 */

export function EvidencePanel({
    evidence,
    confidence,
    confidenceComponents,
    confidenceLabel,
    className,
}: {
    evidence: EvidenceSection[] | null;
    confidence: number | null;
    confidenceComponents: ConfidenceComponent[];
    confidenceLabel?: string;
    className?: string;
}) {
    return (
        <TerminalPanel
            title="AI Evidence"
            icon={<Brain className="size-3.5" />}
            meta={
                confidence === null
                    ? "confidence unavailable"
                    : `confidence ${confidence.toFixed(1)}${confidenceLabel ? ` · ${confidenceLabel}` : ""}`
            }
            className={className}
        >
            {evidence === null ? (
                <AwaitingState reason="The evidence builder has not run yet." />
            ) : evidence.length === 0 ? (
                <AwaitingState reason="No evidence section could be produced from the available data." />
            ) : (
                <ul className="space-y-3">
                    {evidence.map((s) => (
                        <EvidenceRow key={s.id} section={s} />
                    ))}
                </ul>
            )}

            {confidence === null ? (
                <p className="mt-3 rounded-md border border-border p-2.5 text-xs text-muted-foreground">
                    The final intelligence agent produced no confidence value for this pass, so none is
                    displayed. A confidence is only rendered when every weighted component is present.
                </p>
            ) : (
                <div className="mt-3 rounded-md border border-border p-2.5">
                    <p className="mb-1.5 text-xs font-medium text-foreground">
                        How this confidence was calculated
                    </p>
                    <ul className="space-y-1">
                        {confidenceComponents.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                <span className="text-muted-foreground">{c.label}</span>
                                {c.value === null ? (
                                    <span className="text-muted-foreground italic">unavailable</span>
                                ) : (
                                    <span className="font-mono tabular-nums text-foreground">
                                        {c.value.toFixed(1)}
                                    </span>
                                )}
                                <span className="text-muted-foreground/80">× {c.weight}</span>
                                <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                                    ={" "}
                                    {c.contribution === null ? (
                                        <span className="italic">unavailable</span>
                                    ) : (
                                        (c.contribution * 10).toFixed(1)
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        Each component is scaled to 0–100 (value × 10), multiplied by its weight, and
                        summed. Weights are exported as{" "}
                        <span className="font-mono">FINAL_INTELLIGENCE_WEIGHTS</span> and sum to 1. If any
                        component is missing the whole confidence is reported as unavailable rather than
                        computed from the remainder.
                    </p>
                </div>
            )}

            <SourceFooter
                className="mt-3 border-t border-border pt-2"
                items={[
                    {
                        label: "Method",
                        value: <span>Deterministic measurement — no language model involved</span>,
                    },
                ]}
            />
        </TerminalPanel>
    );
}

function EvidenceRow({ section }: { section: EvidenceSection }) {
    const score = section.score;

    return (
        <li className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{section.label}</span>
                {score === null ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground italic">
                        <CircleSlash className="size-3" />
                        Data unavailable
                    </span>
                ) : (
                    <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                        {(score * 100).toFixed(0)}
                    </span>
                )}
            </div>

            {score !== null ? (
                <div
                    className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                    role="meter"
                    aria-valuenow={Math.round(score * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={section.label}
                >
                    <div
                        className={cn(
                            "h-full rounded-full",
                            score >= 0.66
                                ? "bg-positive"
                                : score >= 0.33
                                  ? "bg-primary"
                                  : "bg-negative"
                        )}
                        style={{ width: `${Math.max(2, score * 100)}%` }}
                    />
                </div>
            ) : (
                <p className="mt-0.5 text-xs text-muted-foreground/80" title={section.source.label}>
                    {section.source.label} did not report this measurement.
                </p>
            )}

            <p className="mt-1 text-xs text-muted-foreground">{section.detail}</p>

            {section.metrics.length > 0 ? (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {section.metrics.map((m) => (
                        <li key={m.label} className="text-xs">
                            <span className="text-muted-foreground">{m.label}</span>{" "}
                            {m.value === null ? (
                                <span className="text-muted-foreground italic">unavailable</span>
                            ) : (
                                <span className="font-mono tabular-nums text-foreground">
                                    {m.value}
                                    {m.unit}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            ) : null}
        </li>
    );
}
