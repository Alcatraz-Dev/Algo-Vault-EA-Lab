"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleSlash, Dna, SkipForward, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    LIMITS,
    PIPELINE_STAGES,
    STAGE_LABELS,
    SURVIVOR_THRESHOLDS,
    type StageStatus,
} from "@/lib/ai/strategy-lab/evolution-constants";
import type { EvolutionRun, GenerationReport } from "@/lib/ai/strategy-lab/evolution";
import { dnaActiveBlockCount, dnaSignature, type StrategyDna } from "@/lib/ai/strategy-lab/dna";
import { AwaitingState, StatRow, TerminalPanel } from "@/components/scalping/TerminalPrimitives";
import { StrategyEvolution, StrategyEvolutionDetail } from "@/components/scalping/StrategyEvolution";

/**
 * Strategy DNA + evolution tab.
 *
 * Two parts:
 *   • PipelineView — the nine real stages of the evolution loop with the actual
 *     record count that survived each one. Counts come from `StageReport.count`,
 *     which the engine fills in, so a collapse in the funnel is a real collapse.
 *   • DnaInspector — the genome itself, block by block, with a toggle per block.
 *     Toggling edits a *local draft*; nothing is persisted to RTDB from the
 *     browser, because a DNA only becomes a strategy through the server-side
 *     `dnaToStrategy` → `backtestStrategy` path. Saving a DNA without a backtest
 *     would let an unvalidated genome into the record, which is exactly the kind
 *     of unverified result this module is meant to avoid.
 */

const STAGE_ICON: Record<StageStatus, typeof CircleCheck> = {
    completed: CircleCheck,
    skipped: SkipForward,
    failed: CircleSlash,
};

const STAGE_TONE: Record<StageStatus, string> = {
    completed: "text-positive",
    skipped: "text-muted-foreground",
    failed: "text-negative",
};

export function PipelineView({
    run,
    generation,
    onSelectGeneration,
}: {
    run: EvolutionRun | null;
    generation: number;
    onSelectGeneration: (g: number) => void;
}) {
    const reports = run?.generationReports ?? [];
    const report: GenerationReport | undefined = reports.find((g) => g.generation === generation);

    if (!run) {
        return (
            <TerminalPanel title="Evolution Pipeline" icon={<Workflow className="size-3.5" />}>
                <AwaitingState reason="No evolution run has been started for this workspace." />
            </TerminalPanel>
        );
    }
    if (run.unavailable) {
        return (
            <TerminalPanel title="Evolution Pipeline" icon={<Workflow className="size-3.5" />}>
                <AwaitingState reason={run.unavailable} />
            </TerminalPanel>
        );
    }
    if (!report) {
        return (
            <TerminalPanel title="Evolution Pipeline" icon={<Workflow className="size-3.5" />}>
                <AwaitingState compact reason={`Generation ${generation} was not produced by this run.`} />
            </TerminalPanel>
        );
    }

    // Normalise each stage count against the first stage so the bars are
    // comparable; a stage that produced zero renders as an empty bar.
    const max = Math.max(1, ...report.stages.map((s) => s.count));

    return (
        <TerminalPanel
            title="Evolution Pipeline"
            icon={<Workflow className="size-3.5" />}
            meta={`gen ${generation} of ${run.generations} · ${report.durationMs}ms`}
            dense
            action={
                <GenerationPicker reports={reports} selected={generation} onSelect={onSelectGeneration} />
            }
        >
            <ul>
                {report.stages.map((s) => {
                    const Icon = STAGE_ICON[s.status];
                    return (
                        <li
                            key={s.stage}
                            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border/60 px-3 py-1.5 last:border-0"
                        >
                            <span className={cn("inline-flex shrink-0 items-center gap-1.5", STAGE_TONE[s.status])}>
                                <Icon className="size-3" />
                                <span className="text-xs font-medium text-foreground">
                                    {s.label ?? STAGE_LABELS[s.stage]}
                                </span>
                            </span>
                            <span className="h-1 min-w-[60px] flex-1 overflow-hidden rounded-full bg-muted">
                                <span
                                    className={cn(
                                        "block h-full rounded-full",
                                        s.status === "failed" ? "bg-negative" : "bg-primary"
                                    )}
                                    style={{ width: `${Math.max(s.count > 0 ? 3 : 0, (s.count / max) * 100)}%` }}
                                />
                            </span>
                            <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">
                                {s.count.toLocaleString()}
                            </span>
                            <span className="w-full text-xs text-muted-foreground sm:w-auto sm:min-w-0 sm:flex-1 sm:truncate">
                                {s.detail}
                            </span>
                        </li>
                    );
                })}
            </ul>

            <div className="border-t border-border px-3 py-2">
                <StatRow
                    label="Candidates this generation"
                    value={<span className="font-mono tabular-nums">{report.candidates.toLocaleString()}</span>}
                />
                <StatRow
                    label="Backtested"
                    value={
                        <span className="font-mono tabular-nums">
                            {report.evaluated.toLocaleString()}
                            {report.unevaluated > 0 ? (
                                <span className="text-warning"> · {report.unevaluated} not evaluable</span>
                            ) : null}
                        </span>
                    }
                />
                <StatRow
                    label="Survivors"
                    value={<span className="font-mono tabular-nums">{report.survivors.toLocaleString()}</span>}
                />
                <StatRow
                    label="Mutations"
                    value={<span className="font-mono tabular-nums">{report.mutations.toLocaleString()}</span>}
                />
            </div>
        </TerminalPanel>
    );
}

function GenerationPicker({
    reports,
    selected,
    onSelect,
}: {
    reports: GenerationReport[];
    selected: number;
    onSelect: (g: number) => void;
}) {
    if (reports.length <= 1) return null;
    return (
        <div className="flex flex-wrap gap-1">
            {reports.map((g) => (
                <button
                    key={g.generation}
                    type="button"
                    onClick={() => onSelect(g.generation)}
                    aria-pressed={g.generation === selected}
                    className={cn(
                        "rounded-md border border-border px-1.5 py-0.5 font-mono text-xs transition",
                        g.generation === selected
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    title={`${g.survivors} survivors of ${g.candidates} candidates`}
                >
                    {g.generation}
                </button>
            ))}
        </div>
    );
}

// ── DNA inspector ───────────────────────────────────────────────────────────

export function DnaInspector({ dna }: { dna: StrategyDna | null }) {
    const [draft, setDraft] = useState<StrategyDna | null>(null);

    // Reset the draft whenever a different DNA is selected.
    const active = useMemo(() => draft && draft.id === dna?.id ? draft : dna, [draft, dna]);

    if (!active) {
        return (
            <TerminalPanel title="Strategy DNA" icon={<Dna className="size-3.5" />}>
                <AwaitingState
                    reason="Select a candidate to inspect its genome. A DNA is the declarative spec a strategy is generated from."
                />
            </TerminalPanel>
        );
    }

    const activeCount = dnaActiveBlockCount(active);
    const dirty = draft !== null && draft.id === active.id;

    const toggle = (
        group: "entry" | "filters" | "exit",
        index: number
    ) => {
        setDraft({
            ...active,
            [group]: active[group].map((c, i) => (i === index ? { ...c, active: !c.active } : c)),
        });
    };

    return (
        <TerminalPanel
            title="Strategy DNA"
            icon={<Dna className="size-3.5" />}
            meta={
                <span className="font-mono">
                    {active.symbol} {active.timeframe} {active.direction.toUpperCase()}
                </span>
            }
            dense
            action={
                dirty ? (
                    <span className="text-xs text-warning">draft — not backtested</span>
                ) : (
                    <span className="text-xs text-muted-foreground">
                        gen {active.generation} · {activeCount} active block{activeCount === 1 ? "" : "s"}
                    </span>
                )
            }
        >
            <div className="px-3 py-2">
                <StatRow
                    label="Parent"
                    value={
                        active.parentId ? (
                            <span className="font-mono">{active.parentId}</span>
                        ) : (
                            <span className="text-muted-foreground">seed</span>
                        )
                    }
                />
                <StatRow label="Label" value={<span className="font-mono">{active.label}</span>} />
                <StatRow
                    label="Signature"
                    value={
                        <span
                            className="truncate font-mono text-xs"
                            title={dnaSignature(active)}
                        >
                          {dnaSignature(active)}
                        </span>
                    }
                />
                {active.mutationNote ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">{active.mutationNote}</p>
                ) : null}
            </div>

            <DnaGroup
                title="Entry"
                components={active.entry}
                onToggle={(i) => toggle("entry", i)}
            />
            <DnaGroup
                title="Filters"
                components={active.filters}
                onToggle={(i) => toggle("filters", i)}
            />
            <DnaGroup title="Exit" components={active.exit} onToggle={(i) => toggle("exit", i)} />

            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                Toggling a block edits a local draft only. A draft becomes a strategy solely through
                the server-side pipeline, which converts the DNA and re-runs{" "}
                <span className="font-mono">backtestStrategy</span> before anything is recorded — so an
                unvalidated genome can never enter the record.
            </div>
        </TerminalPanel>
    );
}

function DnaGroup({
    title,
    components,
    onToggle,
}: {
    title: string;
    components: Array<{ block: string; active: boolean; condition: string; value?: number | string }>;
    onToggle: (index: number) => void;
}) {
    return (
        <div className="border-t border-border px-3 py-2">
            <p className="mb-1 text-xs font-medium text-foreground">
                {title}
                <span className="ml-1.5 font-mono text-muted-foreground">
                    {components.filter((c) => c.active).length}/{components.length}
                </span>
            </p>
            <ul className="space-y-1">
                {components.map((c, i) => (
                    <li key={c.block} className="flex items-start gap-2">
                        <input
                            type="checkbox"
                            checked={c.active}
                            onChange={() => onToggle(i)}
                            className="mt-0.5 h-3 w-3 shrink-0 accent-[var(--primary)]"
                            aria-label={`${title}: ${c.block}`}
                        />
                        <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-1.5">
                                <span
                                    className={cn(
                                        "font-mono text-xs",
                                        c.active ? "text-foreground" : "text-muted-foreground/60"
                                    )}
                                >
                                    {c.block}
                                </span>
                                {c.value !== undefined ? (
                                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                        {c.value}
                                    </span>
                                ) : null}
                            </span>
                            <span
                                className={cn(
                                    "block text-xs",
                                    c.active ? "text-muted-foreground" : "text-muted-foreground/50"
                                )}
                            >
                                {c.condition}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ── tab container ───────────────────────────────────────────────────────────

/** Thresholds and limits, shown so the run is not a black box. */
export function EvolutionRulesPanel({ className }: { className?: string }) {
    return (
        <TerminalPanel
            title="Survivor Rules &amp; Limits"
            icon={<Workflow className="size-3.5" />}
            className={className}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Survivor thresholds</p>
                    <StatRow
                        label="Minimum closed trades"
                        value={<span className="font-mono tabular-nums">{SURVIVOR_THRESHOLDS.minTrades}</span>}
                    />
                    <StatRow
                        label="Minimum expectancy"
                        value={
                            <span className="font-mono tabular-nums">
                                {SURVIVOR_THRESHOLDS.minExpectancyR}R
                            </span>
                        }
                    />
                    <StatRow
                        label="Minimum profit factor"
                        value={
                            <span className="font-mono tabular-nums">
                                {SURVIVOR_THRESHOLDS.minProfitFactor}
                            </span>
                        }
                    />
                    <StatRow
                        label="Maximum drawdown"
                        value={
                            <span className="font-mono tabular-nums">
                                {SURVIVOR_THRESHOLDS.maxDrawdownPct}%
                            </span>
                        }
                    />
                </div>
                <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Run limits</p>
                    <StatRow
                        label="Max seeds"
                        value={<span className="font-mono tabular-nums">{LIMITS.maxSeeds}</span>}
                    />
                    <StatRow
                        label="Max children / generation"
                        value={
                            <span className="font-mono tabular-nums">{LIMITS.maxChildrenPerGeneration}</span>
                        }
                    />
                    <StatRow
                        label="Max generations"
                        value={
                            <span className="font-mono tabular-nums">{LIMITS.maxGenerations}</span>
                        }
                    />
                </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
                The pipeline runs{" "}
                <span className="font-mono">{PIPELINE_STAGES.length} stages</span> per generation:
                feature extraction, candidate generation, backtest, risk evaluation, out-of-sample
                validation, scoring, selection, mutation and reporting. The random generator is seeded
                per run, so a rerun of the same inputs reproduces the same population.
            </p>
        </TerminalPanel>
    );
}

export { StrategyEvolution, StrategyEvolutionDetail };
