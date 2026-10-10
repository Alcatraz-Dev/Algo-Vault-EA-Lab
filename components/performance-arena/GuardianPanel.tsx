"use client";

// Challenge Guardian — risk awareness panel (NOT a signal generator).
// Deterministic insights come from the rule/metrics engines; the AI pass is
// optional, costs 1 AI credit, and renders the five mandatory sections.

import { useState } from "react";
import { Brain, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArenaError } from "./primitives";
import type { GuardianAIAnalysis, GuardianInsight } from "@/lib/performance-arena/types";

const KIND_LABEL: Record<GuardianInsight["kind"], string> = {
    FACT: "Fact",
    INTERPRETATION: "Interpretation",
    RISK_WARNING: "Risk warning",
    GUIDANCE: "Guidance",
};

export function GuardianPanel({
    attemptId,
    insights,
    onStateChange,
}: {
    attemptId: string;
    insights: GuardianInsight[];
    onStateChange?: () => void;
}) {
    const [analysis, setAnalysis] = useState<GuardianAIAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const runAI = async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await import("@/lib/firebase").then((m) => m.auth.currentUser?.getIdToken());
            if (!token) throw new Error("Sign in required.");
            const res = await fetch(`/api/performance-arena/attempts/${attemptId}/guardian`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = (await res.json()) as { analysis?: GuardianAIAnalysis; error?: string };
            if (!res.ok) throw new Error(body.error ?? "AI analysis failed.");
            if (body.analysis) setAnalysis(body.analysis);
            onStateChange?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : "AI analysis failed.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 text-positive" /> Challenge Guardian
                </h3>
                <Button size="xs" variant="outline" disabled={loading} onClick={() => void runAI()}>
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                    {loading ? "Analyzing…" : "AI analysis · 1 credit"}
                </Button>
            </div>

            <div className="space-y-2 p-4">
                {insights.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        No risk observations right now — limits are comfortably used.
                    </p>
                ) : (
                    insights.map((insight) => (
                        <div
                            key={insight.id}
                            className={
                                insight.severity === "critical"
                                    ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs"
                                    : insight.severity === "warning"
                                      ? "rounded-md border border-warning/30 bg-warning/5 p-3 text-xs"
                                      : "rounded-md border border-border bg-muted/30 p-3 text-xs"
                            }
                        >
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <Badge variant="outline">{KIND_LABEL[insight.kind]}</Badge>
                                {insight.utilizationPct !== null ? (
                                    <span className="font-mono tabular-nums text-muted-foreground">
                                        {insight.utilizationPct.toFixed(0)}%
                                    </span>
                                ) : null}
                            </div>
                            <p className="text-foreground">{insight.message}</p>
                        </div>
                    ))
                )}
            </div>

            {error ? <div className="px-4 pb-4"><ArenaError message={error} /></div> : null}

            {analysis ? (
                <div className="border-t border-border p-4 text-xs">
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold">AI analysis</p>
                        <span className="font-mono text-micro text-muted-foreground">
                            {analysis.provider} / {analysis.model} · {analysis.creditsCharged} credit(s)
                        </span>
                    </div>
                    <div className="space-y-3">
                        <Section title="FACTS" tone="text-positive" items={analysis.facts} />
                        <Section title="INTERPRETATIONS" tone="text-info" items={analysis.interpretations} />
                        <Section title="RISK WARNINGS" tone="text-warning" items={analysis.riskWarnings} icon={<TriangleAlert className="h-3 w-3" />} />
                        <Section title="UNCERTAINTY" tone="text-muted-foreground" items={analysis.uncertainty} />
                        <Section title="LIMITATIONS" tone="text-muted-foreground" items={analysis.limitations} />
                    </div>
                    <p className="mt-3 text-micro text-muted-foreground">
                        AI analysis is informational, may be wrong, and never changes challenge accounting, rules or settlement.
                    </p>
                </div>
            ) : null}
        </div>
    );
}

function Section({ title, tone, items, icon }: { title: string; tone: string; items: string[]; icon?: React.ReactNode }) {
    if (items.length === 0) return null;
    return (
        <div>
            <p className={`mb-1 font-mono text-micro uppercase tracking-wide ${tone}`}>
                {icon ? <span className="mr-1 inline-flex align-[-2px]">{icon}</span> : null}
                {title}
            </p>
            <ul className="space-y-1">
                {items.map((item, index) => (
                    <li key={index} className="text-foreground">• {item}</li>
                ))}
            </ul>
        </div>
    );
}
