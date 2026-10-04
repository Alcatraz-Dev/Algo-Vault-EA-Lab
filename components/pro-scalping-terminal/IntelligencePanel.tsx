"use client";

/**
 * Pro Scalping Terminal — Intelligence panel.
 *
 * Renders the Unified Intelligence Fabric decision state for the active
 * symbol: decision state, AI confidence, Jev validation, deterministic
 * factors, and an expandable "Why?" panel with concise evidence only (no
 * hidden chain-of-thought is ever displayed — the fabric does not store one).
 *
 * Panel degrades honestly: when the fabric is unavailable (no providers, flag
 * off, non-Pro account) it says exactly that instead of rendering fake data.
 */

import { useState } from "react";
import { BrainCircuit, ChevronDown, ChevronUp, ShieldCheck, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./ProTerminalPanels";

export interface TerminalIntelligencePayload {
    success: boolean;
    symbol: string;
    timeframe: string;
    decision: {
        state: string;
        direction: string;
        confidence: number;
        rationale: string;
        factors: Array<{ source: string; label: string; value: string; negative?: boolean }>;
        jev: { decision: string; confidence: number; status: string } | null;
        llm: { provider: string; model: string; summary: string; confidence?: number } | null;
        risk?: { approved: boolean; code: string; reason?: string } | null;
        validationStatus: string;
    } | null;
    error?: string;
}

const STATE_TONES: Record<string, string> = {
    READY: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    TRIGGERED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    WAITING: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    VALIDATING: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    HOLD: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    BLOCKED: "border-rose-500/40 bg-rose-500/10 text-rose-400",
    INVALID: "border-rose-500/40 bg-rose-500/10 text-rose-400",
    AI_UNAVAILABLE: "border-border bg-muted text-muted-foreground",
};

const SOURCE_LABELS: Record<string, string> = {
    market_facts: "Market",
    deterministic: "Structure",
    jev: "Jev",
    llm: "AI",
    risk: "Risk",
    memory: "Memory",
    policy: "Policy",
};

function StateChip({ state }: { state: string }) {
    const tone = STATE_TONES[state] ?? STATE_TONES.AI_UNAVAILABLE;
    return (
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", tone)}>
            {state.replace("_", " ")}
        </span>
    );
}

function FactorRow({ factor }: { factor: { source: string; label: string; value: string; negative?: boolean } }) {
    return (
        <li className="flex items-start justify-between gap-2 py-1">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {SOURCE_LABELS[factor.source] ?? factor.source}
            </span>
            <span className={cn("min-w-0 flex-1 text-right text-xs", factor.negative ? "text-rose-400" : "text-foreground")}>
                <span className="font-medium">{factor.label}</span>
                <span className="text-muted-foreground"> — {factor.value}</span>
            </span>
        </li>
    );
}

export function IntelligencePanel({
    payload,
    loading,
    pro,
}: {
    payload: TerminalIntelligencePayload | null;
    loading: boolean;
    pro: boolean;
}) {
    const [whyOpen, setWhyOpen] = useState(false);
    const decision = payload?.decision ?? null;

    return (
        <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
            <PanelHeader
                icon={<BrainCircuit className="h-3.5 w-3.5" />}
                title="Intelligence"
                meta={decision ? `${payload?.symbol} · ${payload?.timeframe}` : undefined}
                right={
                    decision ? (
                        <StateChip state={decision.state} />
                    ) : (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {loading ? "…" : !pro ? "PRO" : "OFF"}
                        </span>
                    )
                }
            />
            <div className="flex flex-col gap-2 px-3 py-2">
                {!pro ? (
                    <p className="text-xs italic text-muted-foreground">
                        Advanced AI intelligence is a Pro capability. Deterministic market intelligence remains available in all other panels.
                    </p>
                ) : !decision ? (
                    <p className="text-xs italic text-muted-foreground">
                        {loading
                            ? "Evaluating…"
                            : payload?.error === "AI_UNAVAILABLE" || payload?.error === "UNAVAILABLE"
                              ? "Intelligence unavailable — deterministic engines remain active."
                              : "No intelligence decision available for this symbol yet."}
                    </p>
                ) : (
                    <>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-baseline gap-2">
                                <span className="text-lg font-semibold tabular-nums text-foreground">{decision.confidence}%</span>
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">AI confidence</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-foreground">{decision.direction}</span>
                                {decision.jev ? (
                                    <span
                                        className={cn(
                                            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                                            decision.jev.status === "VALIDATED"
                                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                                : "border-border bg-muted text-muted-foreground",
                                        )}
                                        title={`Jev ${decision.jev.status}`}
                                    >
                                        JEV {decision.jev.confidence}%
                                    </span>
                                ) : (
                                    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                        JEV n/a
                                    </span>
                                )}
                            </div>
                        </div>

                        <p className="text-xs leading-snug text-muted-foreground">{decision.rationale}</p>

                        <button
                            type="button"
                            onClick={() => setWhyOpen((v) => !v)}
                            className="mt-0.5 flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-foreground transition hover:bg-muted"
                            aria-expanded={whyOpen}
                        >
                            <span className="font-medium">Why?</span>
                            {whyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                        {whyOpen ? (
                            <ul className="divide-y divide-border/60 rounded-md border border-border bg-background/60 px-2 py-1">
                                {decision.factors.length === 0 ? (
                                    <li className="py-1 text-xs italic text-muted-foreground">No factors recorded.</li>
                                ) : (
                                    decision.factors.map((f, i) => <FactorRow key={`${f.label}-${i}`} factor={f} />)
                                )}
                                {decision.risk ? (
                                    <li className="flex items-center gap-2 py-1 text-xs">
                                        {decision.risk.approved ? (
                                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                                        ) : (
                                            <ShieldX className="h-3.5 w-3.5 text-rose-400" />
                                        )}
                                        <span className="text-muted-foreground">
                                            Risk engine {decision.risk.approved ? "PASS" : "FAIL"} ({decision.risk.code})
                                        </span>
                                    </li>
                                ) : null}
                            </ul>
                        ) : null}
                    </>
                )}
            </div>
        </section>
    );
}
