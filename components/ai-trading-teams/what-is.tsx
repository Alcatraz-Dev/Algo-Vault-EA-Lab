"use client";

import { BookOpen, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * In-product explainer: “What are AI Trading Teams?” (spec §49).
 * Written for traders, not engineers — and deliberately honest about what the
 * feature is and is not.
 */
export function WhatAreAITeams({ compact = false }: { compact?: boolean }) {
    return (
        <section className="rounded-xl border border-border/60 bg-card/60 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
                <BookOpen className="size-4 text-primary" /> What are AI Trading Teams?
            </h2>
            <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>
                    An AI Trading Team is a <strong className="text-foreground">private digital research desk</strong>: a group of
                    specialized AI agents — Market Regime, Smart Money, Technical, Liquidity, Macro, Quant, Risk,
                    Contrarian and a Chief Analyst — that analyze the <strong className="text-foreground">same AlgoVault
                    intelligence data</strong> and present their findings as structured evidence.
                </p>
                {!compact ? (
                    <ul className="grid gap-2 sm:grid-cols-2">
                        <InfoItem title="Not a chatbot">
                            Agents consume the deterministic Smart Money engine, regime/volatility analytics, setup memory
                            and research results. They interpret — they never replace the engines or invent market data.
                        </InfoItem>
                        <InfoItem title="Evidence-first">
                            Every observation is classified as FACT, INTERPRETATION, HYPOTHESIS, RISK, INVALIDATION or
                            UNKNOWN, with a source reference. Uncited claims can never be presented as facts.
                        </InfoItem>
                        <InfoItem title="Visible disagreement">
                            When agents disagree you see the conflict, the missing evidence and the critical risks — not a
                            single opaque “AI score”.
                        </InfoItem>
                        <InfoItem title="Chief Analyst synthesizes">
                            The final brief — market context, bullish/bearish cases, risks, invalidation levels, setup state
                            and a research next step — is built from the team’s evidence, never from a single model vote.
                        </InfoItem>
                    </ul>
                ) : null}
                <p className="flex items-start gap-1.5 rounded border border-border/60 bg-muted/30 p-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    AI Trading Teams provide analytical and research assistance. Outputs are research observations based
                    on the data available at the run timestamp — not financial advice, and never “guaranteed” or
                    “100% accurate” outcomes. Pro feature.
                </p>
            </div>
        </section>
    );
}

function InfoItem({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <li className="rounded border border-border/60 bg-background/40 p-2.5">
            <p className="mb-0.5 flex items-center gap-1.5 text-micro font-semibold text-foreground">
                <Badge variant="outline" className="text-micro">{title}</Badge>
            </p>
            <p className="text-micro leading-relaxed text-muted-foreground">{children}</p>
        </li>
    );
}
