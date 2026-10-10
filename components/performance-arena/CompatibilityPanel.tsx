"use client";

// "Test this strategy against the current challenge rules" — posts backtest
// metrics to the deterministic compatibility engine. The verdict always
// carries the no-guarantee disclaimer.

import { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArenaError } from "./primitives";
import { useAuthToken } from "@/lib/scalping/client";
import type { StrategyCompatibility } from "@/lib/performance-arena/compatibility";
import type { ChallengeDefinition } from "@/lib/performance-arena/types";

const VERDICT: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
    compatible: { label: "Compatible", variant: "success" },
    cautions: { label: "Cautions", variant: "warning" },
    incompatible: { label: "Incompatible", variant: "destructive" },
    insufficient_data: { label: "Insufficient data", variant: "secondary" },
};

export function CompatibilityPanel({
    definitionId,
    attemptId,
    compact = false,
}: {
    definitionId?: string;
    attemptId?: string;
    compact?: boolean;
}) {
    const token = useAuthToken();
    const [definitions, setDefinitions] = useState<ChallengeDefinition[]>([]);
    const [selectedDefinition, setSelectedDefinition] = useState<string>(definitionId ?? "");
    const [metrics, setMetrics] = useState({
        strategyName: "",
        backtestReturnPct: "",
        maxDrawdownPct: "",
        worstDayLossPct: "",
        tradeCount: "",
        avgTradesPerDay: "",
    });
    const [result, setResult] = useState<StrategyCompatibility | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Standalone mode (no definitionId/attemptId supplied): load the catalog
    // once so the panel can target any published challenge.
    useEffect(() => {
        if (definitionId || attemptId || !token) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/performance-arena/catalog", {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                const body = (await res.json()) as { items?: Array<{ definition: ChallengeDefinition }> };
                if (!res.ok) throw new Error("catalog load failed");
                const defs = (body.items ?? []).map((i) => i.definition);
                if (!cancelled) {
                    setDefinitions(defs);
                    setSelectedDefinition((current) => current || defs[0]?.id || "");
                }
            } catch {
                if (!cancelled) setDefinitions([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [definitionId, attemptId, token]);

    const targetDefinitionId = definitionId ?? selectedDefinition;

    const run = async () => {
        setBusy(true);
        setError(null);
        try {
            const token = await import("@/lib/firebase").then((m) => m.auth.currentUser?.getIdToken());
            if (!token) throw new Error("Sign in required.");
            const res = await fetch("/api/performance-arena/compatibility", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    definitionId: targetDefinitionId || undefined,
                    attemptId,
                    strategy: {
                        strategyName: metrics.strategyName || "Strategy",
                        backtestReturnPct: Number(metrics.backtestReturnPct) || 0,
                        maxDrawdownPct: Number(metrics.maxDrawdownPct) || 0,
                        worstDayLossPct: Number(metrics.worstDayLossPct) || 0,
                        tradeCount: Number(metrics.tradeCount) || 0,
                        avgTradesPerDay: Number(metrics.avgTradesPerDay) || 0,
                    },
                }),
            });
            const body = (await res.json()) as { compatibility?: StrategyCompatibility; error?: string };
            if (!res.ok) throw new Error(body.error ?? "Compatibility check failed.");
            if (body.compatibility) setResult(body.compatibility);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Compatibility check failed.");
        } finally {
            setBusy(false);
        }
    };

    const field = (key: keyof typeof metrics, label: string, placeholder: string) => (
        <label className="text-xs text-muted-foreground">
            {label}
            <input
                type="number"
                step="any"
                value={metrics[key]}
                placeholder={placeholder}
                onChange={(e) => setMetrics((m) => ({ ...m, [key]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm text-foreground"
            />
        </label>
    );

    return (
        <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <FlaskConical className="h-4 w-4" /> Challenge rule compatibility
                </h3>
                <Badge variant="outline">Deterministic</Badge>
            </div>

            <div className="space-y-3 p-4">
                {!definitionId && !attemptId ? (
                    <label className="block text-xs text-muted-foreground">
                        Challenge
                        <select
                            value={selectedDefinition}
                            onChange={(e) => setSelectedDefinition(e.target.value)}
                            disabled={definitions.length === 0}
                            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                        >
                            {definitions.length === 0 ? <option value="">Loading challenges…</option> : null}
                            {definitions.map((def) => (
                                <option key={def.id} value={def.id}>
                                    {def.name} (+{def.policy.profitTargetPct}% / {def.policy.maxDrawdownPct}% DD)
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
                <label className="block text-xs text-muted-foreground">
                    Strategy name
                    <input
                        type="text"
                        value={metrics.strategyName}
                        placeholder="e.g. London breakout v2"
                        onChange={(e) => setMetrics((m) => ({ ...m, strategyName: e.target.value }))}
                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    />
                </label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {field("backtestReturnPct", "Return %", "12.5")}
                    {field("maxDrawdownPct", "Max DD %", "6.2")}
                    {field("worstDayLossPct", "Worst day %", "-3.1")}
                    {field("tradeCount", "Trades", "40")}
                    {field("avgTradesPerDay", "Trades/day", "1.5")}
                </div>

                <Button size="sm" disabled={busy || !targetDefinitionId} onClick={() => void run()}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {busy ? "Checking…" : "Test against challenge rules"}
                </Button>

                {error ? <ArenaError message={error} /> : null}

                {result ? (
                    <div className="space-y-3 border-t border-border pt-3 text-xs">
                        <div className="flex items-center gap-2">
                            <Badge variant={VERDICT[result.verdict]?.variant ?? "secondary"}>
                                {VERDICT[result.verdict]?.label ?? result.verdict}
                            </Badge>
                            <span className="font-mono text-micro text-muted-foreground">{result.challengeRulesSummary}</span>
                        </div>
                        <ul className="space-y-1.5">
                            {result.findings.map((finding) => (
                                <li key={finding.key} className="flex items-start gap-2">
                                    <span
                                        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                                            finding.verdict === "pass" ? "bg-emerald-500" : finding.verdict === "warn" ? "bg-amber-500" : "bg-red-500"
                                        }`}
                                    />
                                    <span>
                                        <span className="font-medium">{finding.label}:</span> {finding.detail}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <p className="text-muted-foreground">{result.disclaimer}</p>
                    </div>
                ) : null}

                {!compact ? (
                    <p className="text-micro text-muted-foreground">
                        Feed metrics from your Strategy Research / Backtest results. Backtest results do not guarantee challenge or live results.
                    </p>
                ) : null}
            </div>
        </div>
    );
}
