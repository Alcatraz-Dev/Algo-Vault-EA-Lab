"use client";

// Challenge context layer for the Scalping Terminal — an OPTIONAL, read-only
// strip that shows the active challenge's status, daily loss, drawdown,
// remaining risk and target progress. It does not modify or duplicate any
// terminal behaviour; without an active attempt it renders nothing.

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { useAuthToken } from "@/lib/scalping/client";
import { ChallengeStatusBadge, LimitBar, Money } from "./primitives";
import type { ChallengeMetrics, ChallengeStatus } from "@/lib/performance-arena/types";

interface ContextState {
    attemptId: string;
    definitionKey: string;
    status: ChallengeStatus;
    metrics: ChallengeMetrics;
}

const POLL_MS = 15_000;

export function ChallengeContextBar() {
    const token = useAuthToken();
    const [state, setState] = useState<ContextState | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const load = async () => {
            try {
                const res = await fetch("/api/performance-arena/attempts", {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                if (!res.ok) throw new Error("attempts fetch failed");
                const body = (await res.json()) as {
                    attempts?: Array<{ attempt: { id: string; definitionKey: string; status: ChallengeStatus }; metrics: ChallengeMetrics | null }>;
                };
                const active = (body.attempts ?? []).find(
                    (a) => a.metrics && (a.attempt.status === "ACTIVE" || a.attempt.status === "PAUSED")
                );
                if (!cancelled) {
                    if (active?.metrics) {
                        setState({
                            attemptId: active.attempt.id,
                            definitionKey: active.attempt.definitionKey,
                            status: active.attempt.status,
                            metrics: active.metrics,
                        });
                        setFailed(false);
                    } else {
                        setState(null);
                    }
                }
            } catch {
                if (!cancelled) setFailed(true);
            } finally {
                if (!cancelled) timer = setTimeout(load, POLL_MS);
            }
        };

        void load();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [token]);

    if (failed || !state) return null;

    const { metrics } = state;
    const riskRemainingPct = Math.max(0, 100 - metrics.dailyLossUsedPct);

    return (
        <div className="mb-4 rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                    <Trophy className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium">Active challenge</span>
                    <span className="font-mono text-muted-foreground">{state.definitionKey}</span>
                    <ChallengeStatusBadge status={state.status} />
                </div>
                <a href={`/account/performance-arena/attempts/${state.attemptId}`} className="text-xs text-primary hover:underline">
                    Open dashboard →
                </a>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="text-micro text-muted-foreground">Daily loss</p>
                    <p className="font-mono text-sm font-medium">
                        <Money cents={Math.min(0, metrics.dailyPnLCcents)} signed />
                        <span className="ml-1 text-micro text-muted-foreground">
                            {metrics.dailyLossUsedPct.toFixed(0)}% used
                        </span>
                    </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="text-micro text-muted-foreground">Drawdown</p>
                    <p className="font-mono text-sm font-medium">
                        {metrics.currentDrawdownPct.toFixed(2)}%
                        <span className="ml-1 text-micro text-muted-foreground">
                            {metrics.drawdownUsedPct.toFixed(0)}% of limit
                        </span>
                    </p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="text-micro text-muted-foreground">Risk remaining today</p>
                    <p className="font-mono text-sm font-medium text-emerald-600">{riskRemainingPct.toFixed(0)}%</p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2">
                    <p className="text-micro text-muted-foreground">Target progress</p>
                    <p className="font-mono text-sm font-medium">{metrics.targetProgressPct.toFixed(0)}%</p>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <LimitBar label="Profit target" usedPct={metrics.targetProgressPct} tone="positive" />
                <LimitBar label="Daily loss limit" usedPct={metrics.dailyLossUsedPct} tone="warning" />
                <LimitBar label="Max drawdown" usedPct={metrics.drawdownUsedPct} tone="negative" />
            </div>
        </div>
    );
}
