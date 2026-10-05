"use client";

/**
 * IntelligenceRail — Phase 5 §13 / §14 / §15 / §16.
 *
 * The unified right-hand intelligence surface. Every section is a projection
 * of `AdvancedAnalysisResult` (structure / MTF / liquidity / zones), the
 * deterministic scanner (signals → setup cards) or the AI decision fabric —
 * the same payloads the Pro terminal already renders, so no value is computed
 * twice and nothing here can disagree with the chart.
 *
 * The intelligence mode lives in TerminalContext, so switching
 * Structure → Liquidity is part of the workspace, not a local tab.
 */

import { useMemo } from "react";
import {
    Boxes,
    Radar as RadarIcon,
    Sparkles,
    Target,
    Radio,
    ShieldCheck,
    ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    LiquidityPanel,
    MtfPanel,
    RegimeStrip,
    SignalsMiniPanel,
} from "@/components/pro-scalping-terminal/ProTerminalPanels";
import { IntelligencePanel, type TerminalIntelligencePayload } from "@/components/pro-scalping-terminal/IntelligencePanel";
import { useThrottledAuthedFetch } from "@/lib/scalping/client";
import type { IntelligenceMode } from "@/lib/terminal/types";
import { useTerminal } from "./TerminalContext";
import { useTerminalData } from "./TerminalData";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

const TABS: Array<{ id: IntelligenceMode; label: string; icon: typeof Boxes }> = [
    { id: "structure", label: "Structure", icon: Boxes },
    { id: "liquidity", label: "Liquidity", icon: RadarIcon },
    { id: "setups", label: "Setups", icon: Target },
    { id: "signals", label: "Signals", icon: Radio },
    { id: "risk", label: "Risk", icon: ShieldCheck },
    { id: "ai", label: "AI", icon: Sparkles },
];

/* ── market structure block ──────────────────────────────────────────────── */

function StructureBlock() {
    const { state } = useTerminal();
    const { analysis, analysisLoading, analysisError } = useTerminalData();

    const events = analysis
        ? [...(analysis.structure.bosEvents ?? []), ...(analysis.structure.chochEvents ?? [])]
              .slice(-6)
              .reverse()
        : [];
    const bias = analysis?.structure.trend.value ?? null;

    if (analysisError) {
        return <p className="p-3 text-xs text-amber-400">{analysisError}</p>;
    }
    if (!analysis) {
        return (
            <p className="p-3 text-xs italic text-muted-foreground">
                {analysisLoading ? "Running the structure engine…" : "No structure analysis for this symbol yet."}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-2 p-3">
            <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-md border border-border/70 bg-background px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Structure bias</div>
                    <div
                        className={cn(
                            "text-xs font-semibold capitalize",
                            bias === "bullish" ? "text-emerald-400" : bias === "bearish" ? "text-rose-400" : "text-muted-foreground"
                        )}
                    >
                        {bias ?? "unavailable"}
                    </div>
                </div>
                <div className="rounded-md border border-border/70 bg-background px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Reversal setup</div>
                    <div className="text-xs font-semibold text-foreground">
                        {analysis.structure.reversalSetup.value?.detected
                            ? `${analysis.structure.reversalSetup.value.priorBias} → ${analysis.structure.reversalSetup.value.currentBias}`
                            : "none detected"}
                    </div>
                </div>
            </div>

            <div className="rounded-md border border-border/70">
                <div className="border-b border-border/60 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Recent breaks
                </div>
                {events.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs italic text-muted-foreground">
                        No BOS/CHOCH events in the analysed window.
                    </p>
                ) : (
                    <ul className="divide-y divide-border/50">
                        {events.map((e) => (
                            <li key={e.id} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <span
                                        className={cn(
                                            "rounded border px-1 font-mono text-[9px] font-bold",
                                            e.type === "BOS" ? "border-sky-500/40 text-sky-400" : "border-amber-500/40 text-amber-400"
                                        )}
                                    >
                                        {e.type}
                                    </span>
                                    <span className={cn("capitalize", e.direction === "bullish" ? "text-emerald-400" : "text-rose-400")}>
                                        {e.direction}
                                    </span>
                                    <span className="font-mono text-[10px] text-muted-foreground">{e.timeframe}</span>
                                </span>
                                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                                    {new Date(e.timestamp).toISOString().slice(11, 16)} · {e.price}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <p className="text-[10px] leading-4 text-muted-foreground">
                {analysis.multiTimeframe.summary.value ?? analysis.multiTimeframe.summary.reason ?? ""}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/70">
                Active chart: {state.symbol} {state.timeframe}
            </p>
        </div>
    );
}

/* ── setup card (Phase 5 §15 / §16) ──────────────────────────────────────── */

const LIFECYCLE = ["WAITING", "DETECTED", "VALIDATED", "TRIGGERED", "EXECUTED", "MONITORED", "COMPLETED"] as const;

function lifecycleIndex(status: string): number {
    const s = status.toUpperCase();
    if (s.includes("INVALID")) return -1;
    if (s.includes("COMPLETED") || s.includes("CLOSED") || s.includes("EXPIRED")) return 6;
    if (s.includes("EXECUT")) return 4;
    if (s.includes("TRIGGER") || s.includes("ACTIVE") || s.includes("CONFIRM")) return 3;
    if (s.includes("VALID")) return 2;
    if (s.includes("DETECT") || s.includes("FORM") || s.includes("NEW")) return 1;
    return 0;
}

function SetupCard() {
    const { state } = useTerminal();
    const { signals, analysis } = useTerminalData();

    const active = useMemo(
        () => [...signals].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3),
        [signals]
    );
    const htfBias = analysis?.multiTimeframe.dominantBias.value ?? null;

    if (active.length === 0) {
        return (
            <p className="p-3 text-xs italic text-muted-foreground">
                No validated setup on {state.symbol}. The scanner only reports a setup once its confidence and R:R
                gates pass.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-2 p-3">
            {active.map((s) => {
                const idx = lifecycleIndex(s.status);
                const invalid = idx < 0;
                const rr = s.riskReward;
                return (
                    <article
                        key={s.id}
                        className="rounded-lg border border-border/70 bg-background p-2.5"
                        aria-label={`${s.symbol} ${s.timeframe} setup`}
                    >
                        <header className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-bold text-foreground">
                                {s.symbol} {s.timeframe}
                            </span>
                            <span
                                className={cn(
                                    "rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider",
                                    invalid
                                        ? "border-rose-500/50 text-rose-400"
                                        : s.direction === "long"
                                          ? "border-emerald-500/50 text-emerald-400"
                                          : "border-rose-500/50 text-rose-400"
                                )}
                            >
                                {s.direction === "long" ? "LONG SETUP" : "SHORT SETUP"}
                            </span>
                        </header>

                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Entry</dt>
                                <dd className="font-mono tabular-nums text-foreground">{s.entry}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Invalidation</dt>
                                <dd className="font-mono tabular-nums text-rose-400">{s.stop}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Target</dt>
                                <dd className="font-mono tabular-nums text-emerald-400">{s.target}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Risk / Reward</dt>
                                <dd className="font-mono tabular-nums text-foreground">1 : {rr}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">HTF bias</dt>
                                <dd className="capitalize text-foreground">{htfBias ?? "unavailable"}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Confidence</dt>
                                <dd className="text-foreground">
                                    {s.confidenceLabel} ({s.confidence}%)
                                </dd>
                            </div>
                        </dl>

                        <ul className="mt-2 space-y-0.5 border-t border-border pt-1.5">
                            {s.evidence.slice(0, 4).map((ev, i) => (
                                <li key={i} className="flex gap-1.5 text-[10px] leading-4 text-muted-foreground">
                                    <span className="text-emerald-400">✓</span>
                                    <span className="min-w-0">{ev}</span>
                                </li>
                            ))}
                        </ul>

                        {/* Lifecycle strip (Phase 5 §16) */}
                        <div className="mt-2 flex items-center gap-1 overflow-x-auto border-t border-border pt-2">
                            {LIFECYCLE.map((stage, i) => (
                                <span key={stage} className="flex items-center gap-1">
                                    <span
                                        className={cn(
                                            "rounded px-1 py-0.5 text-[8px] font-bold tracking-wide",
                                            !invalid && i <= idx
                                                ? "bg-primary/15 text-primary"
                                                : "bg-muted text-muted-foreground/60"
                                        )}
                                        title={stage}
                                    >
                                        {stage}
                                    </span>
                                    {i < LIFECYCLE.length - 1 ? (
                                        <span className="text-[8px] text-muted-foreground/50">→</span>
                                    ) : null}
                                </span>
                            ))}
                        </div>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                            status: {invalid ? "INVALIDATED" : s.status}
                        </p>
                    </article>
                );
            })}
        </div>
    );
}

/* ── risk summary ────────────────────────────────────────────────────────── */

function RiskSummary() {
    const { risk, riskError, riskLoading } = useTerminalData();
    if (riskError) return <p className="p-3 text-xs text-amber-400">{riskError}</p>;
    if (riskLoading && !risk) return <p className="p-3 text-xs italic text-muted-foreground">Loading risk state…</p>;
    if (!risk || !risk.status) {
        return <p className="p-3 text-xs italic text-muted-foreground">No connected account — risk state unavailable.</p>;
    }
    const m = risk.metrics;
    const rows: Array<[string, string]> = [
        ["Status", risk.status],
        ["Balance", m?.balance !== null && m?.balance !== undefined ? m.balance.toFixed(2) : "unavailable"],
        ["Equity", m?.equity !== null && m?.equity !== undefined ? m.equity.toFixed(2) : "unavailable"],
        ["Floating P&L", m?.floatingPnL !== null && m?.floatingPnL !== undefined ? m.floatingPnL.toFixed(2) : "unavailable"],
        ["Drawdown", m?.drawdownPct !== null && m?.drawdownPct !== undefined ? `${m.drawdownPct.toFixed(2)}%` : "unavailable"],
        ["Open positions", m?.openPositions !== null && m?.openPositions !== undefined ? String(m.openPositions) : "unavailable"],
        ["Daily loss limit", risk.limits?.maxDailyLossPercent !== null && risk.limits?.maxDailyLossPercent !== undefined ? `${risk.limits.maxDailyLossPercent}%` : "not configured"],
    ];
    return (
        <div className="flex flex-col gap-2 p-3">
            <div
                className={cn(
                    "rounded-md border px-2 py-1.5 text-center text-xs font-bold tracking-wider",
                    risk.status === "SAFE" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                    risk.status === "WARNING" && "border-amber-500/40 bg-amber-500/10 text-amber-400",
                    risk.status === "RESTRICTED" && "border-orange-500/40 bg-orange-500/10 text-orange-400",
                    risk.status === "HALTED" && "border-red-600/50 bg-red-600/10 text-red-400"
                )}
            >
                {risk.status}
            </div>
            <dl className="space-y-1 text-[11px]">
                {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className={cn("font-mono tabular-nums", v === "unavailable" || v === "not configured" ? "italic text-muted-foreground" : "text-foreground")}>
                            {v}
                        </dd>
                    </div>
                ))}
            </dl>
            {risk.reasons.length > 0 ? (
                <ul className="space-y-0.5 border-t border-border pt-1.5">
                    {risk.reasons.map((r) => (
                        <li key={r} className="text-[10px] leading-4 text-amber-400">
                            • {r}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

/* ── AI interpretation ───────────────────────────────────────────────────── */

function AiInterpretation({ now }: { now: number }) {
    const { state } = useTerminal();
    const { token } = useTerminalData();
    const tick = Math.floor(now / 180_000);
    const url = `/api/scalping/intelligence?symbol=${encodeURIComponent(state.symbol)}&timeframe=${encodeURIComponent(state.timeframe)}&t=${tick}`;
    const iq = useThrottledAuthedFetch<TerminalIntelligencePayload>(url, { minIntervalMs: 180_000, enabled: !!token });

    return (
        <IntelligencePanel
            payload={iq.data ?? null}
            loading={iq.loading}
            pro={!iq.error || !/PRO_REQUIRED|UNAUTHENTICATED|403|401/.test(iq.error)}
        />
    );
}

/* ── rail ────────────────────────────────────────────────────────────────── */

export function IntelligenceRail({ now }: { now: number }) {
    const { state, setIntelligenceMode } = useTerminal();
    const { analysis, analysisLoading, signals, signalsError, token } = useTerminalData();
    const mode = state.intelligenceMode;

    return (
        <section className="flex min-w-0 flex-col gap-2" aria-label="Intelligence">
            <div className="rounded-xl border border-border bg-card p-2">
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Intelligence mode">
                    {TABS.map((t) => {
                        const Icon = t.icon;
                        const active = mode === t.id;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setIntelligenceMode(t.id)}
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                                )}
                            >
                                <Icon className="size-3" />
                                {t.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <PanelErrorBoundary name="Intelligence">
                <div className="rounded-xl border border-border bg-card">
                    <div className="border-b border-border px-3 py-2">
                        <h2 className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-foreground">
                            <span className="flex items-center gap-1.5">
                                {mode === "ai" ? <Sparkles className="size-3 text-primary" /> : <ListChecks className="size-3 text-primary" />}
                                {TABS.find((t) => t.id === mode)?.label}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                                {state.symbol} {state.timeframe}
                            </span>
                        </h2>
                    </div>

                    {mode === "structure" ? <StructureBlock /> : null}

                    {mode === "liquidity" ? (
                        <>
                            <RegimeStrip analysis={analysis} loading={analysisLoading} />
                            <div className="border-t border-border">
                                <MtfPanel analysis={analysis} loading={analysisLoading} error={null} />
                            </div>
                            <div className="border-t border-border">
                                <LiquidityPanel analysis={analysis} loading={analysisLoading} />
                            </div>
                        </>
                    ) : null}

                    {mode === "setups" ? <SetupCard /> : null}

                    {mode === "signals" ? (
                        signalsError ? (
                            <p className="p-3 text-xs text-amber-400">{signalsError}</p>
                        ) : (
                            <SignalsMiniPanel signals={signals} rejected={[]} loading={signals.length === 0} now={now} token={token} />
                        )
                    ) : null}

                    {mode === "risk" ? <RiskSummary /> : null}

                    {mode === "ai" ? <AiInterpretation now={now} /> : null}
                </div>
            </PanelErrorBoundary>
        </section>
    );
}
