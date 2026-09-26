"use client";

import { memo, useState } from "react";
import { ChevronDown, Filter, Radar, Radio, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
import { StatusBadge } from "@/components/ui/status-badge";
import {
    AwaitingState,
    ConfidenceMeter,
    SourceFooter,
    StatRow,
    TerminalPanel,
} from "@/components/scalping/TerminalPrimitives";
import { formatPrice, relativeTime } from "@/lib/scalping/client";

/**
 * Live trade intelligence.
 *
 * The important design constraint here: this panel never *invents* a setup. It
 * renders exactly what `scanSymbol` returned, and when the scanner found
 * nothing it says so and lists why each symbol was rejected. An empty terminal
 * with honest rejection reasons is the correct output of a disciplined scanner,
 * so it is presented as a normal state rather than an error.
 */

export type SignalScanPayload = {
    signals: TerminalSignal[];
    rejected: Array<{ symbol: string; reason: string }>;
    asOf: number;
    engine?: {
        mode: string;
        scanner?: string;
        configVersion?: string;
        minConfidence?: number;
        minRiskReward?: number;
    };
};

const SignalRow = memo(function SignalRow({
    signal,
    now,
}: {
    signal: TerminalSignal;
    now: number;
}) {
    const [open, setOpen] = useState(false);
    const isLong = signal.direction === "long";

    return (
        <article className="border-b border-border/60 last:border-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <span className="font-mono text-xs font-semibold text-foreground">
                    {signal.symbol}
                </span>
                <StatusBadge
                    tone={isLong ? "positive" : "negative"}
                    label={isLong ? "LONG" : "SHORT"}
                />
                <StatusBadge tone="neutral" label={signal.timeframe} />

                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    <span className="text-muted-foreground/70">entry</span>{" "}
                    <span className="text-foreground">{formatPrice(signal.entry)}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    <span className="text-muted-foreground/70">SL</span>{" "}
                    <span className="text-negative">{formatPrice(signal.stop)}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    <span className="text-muted-foreground/70">TP1</span>{" "}
                    <span className="text-positive">{formatPrice(signal.target)}</span>
                </span>
                <span
                    className="font-mono text-xs font-semibold tabular-nums text-foreground"
                    title="Risk/reward re-derived from the signal's own entry, stop and target prices."
                >
                    R:R {signal.riskReward.toFixed(2)}
                </span>

                <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {relativeTime(signal.createdAt, now)}
                </span>

                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                    <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
                    {signal.evidence.length} evidence
                </button>
            </div>

            {open ? (
                <div className="grid gap-4 border-t border-border/60 bg-muted/30 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="min-w-0">
                        <ConfidenceMeter
                            metric={{
                                value: signal.confidence,
                                status: "available",
                                source: signal.source,
                            }}
                            label="Scanner confidence"
                            label2={signal.strength}
                        />
                        <div className="mt-2">
                            <StatRow
                                label="Regime"
                                value={
                                    signal.regime === "unavailable" ? (
                                        <span className="text-xs text-muted-foreground italic">
                                            Data unavailable
                                        </span>
                                    ) : (
                                        <span className="font-mono">{signal.regime}</span>
                                    )
                                }
                            />
                            <StatRow label="Status" value={<span className="font-mono">{signal.status}</span>} />
                            <StatRow
                                label="Risk (price)"
                                value={<span className="font-mono tabular-nums">{formatPrice(signal.risk)}</span>}
                                hint="Absolute distance between entry and stop."
                            />
                        </div>
                    </div>

                    <div className="min-w-0 sm:col-span-1 lg:col-span-2">
                        <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Target className="size-3" />
                            Why the scanner fired
                        </p>
                        {signal.evidence.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">
                                The scanner returned no reasoning text for this setup.
                            </p>
                        ) : (
                            <ul className="space-y-1">
                                {signal.evidence.map((e, i) => (
                                    <li key={i} className="text-xs text-muted-foreground">
                                        {e}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            ) : null}
        </article>
    );
});

export function LiveSignalsPanel({
    payload,
    loading,
    now,
    className,
}: {
    payload: SignalScanPayload | null;
    loading: boolean;
    now: number;
    className?: string;
}) {
    const signals = payload?.signals ?? [];
    const rejected = payload?.rejected ?? [];

    return (
        <TerminalPanel
            title="Live Trade Intelligence"
            icon={<Radio className="size-3.5" />}
            meta={
                payload
                    ? `${signals.length} qualifying · ${rejected.length} rejected`
                    : loading
                      ? "scanning…"
                      : "awaiting engine data"
            }
            dense
            className={className}
        >
            {loading && signals.length === 0 ? (
                <div className="p-3">
                    <AwaitingState
                        compact
                        reason="Scanning the watchlist with the deterministic signal engine. This does not consume AI budget."
                    />
                </div>
            ) : signals.length === 0 ? (
                <div className="space-y-3 p-3">
                    <AwaitingState
                        compact
                        reason="No symbol on the watchlist met the configured signal gates. This is a normal scanner outcome, not a fault."
                    />
                    {rejected.length > 0 ? (
                        <RejectionList rejected={rejected} />
                    ) : null}
                </div>
            ) : (
                <div>
                    {signals.map((s) => (
                        <SignalRow key={s.id} signal={s} now={now} />
                    ))}
                    {rejected.length > 0 ? (
                        <div className="border-t border-border/60 px-3 py-2">
                            <RejectionList rejected={rejected} />
                        </div>
                    ) : null}
                </div>
            )}

            {payload?.engine ? (
                <div className="border-t border-border/60 px-3 py-2">
                    <SourceFooter
                        items={[
                            { label: "mode", value: <span className="font-mono">{payload.engine.mode}</span> },
                            {
                                label: "scanner",
                                value: (
                                    <span className="font-mono">
                                        {payload.engine.scanner ?? "ai-signals scanSymbol"}
                                    </span>
                                ),
                            },
                            payload.engine.configVersion
                                ? { label: "config", value: <span className="font-mono">{payload.engine.configVersion}</span> }
                                : { label: "config", value: <span className="text-muted-foreground italic">not reported</span> },
                            payload.engine.minConfidence !== undefined
                                ? {
                                      label: "min conf",
                                      value: <span className="font-mono tabular-nums">{payload.engine.minConfidence}</span>,
                                  }
                                : { label: "min conf", value: <span className="text-muted-foreground italic">not reported</span> },
                            payload.engine.minRiskReward !== undefined
                                ? {
                                      label: "min R:R",
                                      value: <span className="font-mono tabular-nums">{payload.engine.minRiskReward}</span>,
                                  }
                                : { label: "min R:R", value: <span className="text-muted-foreground italic">not reported</span> },
                        ]}
                    />
                </div>
            ) : null}
        </TerminalPanel>
    );
}

function RejectionList({ rejected }: { rejected: Array<{ symbol: string; reason: string }> }) {
    return (
        <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                <Filter className="size-3" />
                {rejected.length} symbol{rejected.length === 1 ? "" : "s"} did not qualify
                <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 space-y-1.5">
                {rejected.map((r) => (
                    <li key={r.symbol} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
                            <Radar className="size-3 text-muted-foreground" />
                            {r.symbol}
                        </span>
                        <span className="min-w-0 text-muted-foreground">{r.reason}</span>
                    </li>
                ))}
            </ul>
        </details>
    );
}
