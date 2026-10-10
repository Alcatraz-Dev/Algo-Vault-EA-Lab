"use client";

/**
 * Admin → AI Intelligence Monitor.
 *
 * Two monitors on one page:
 *  1. Provider Monitor  — per-provider health from the fabric: circuit state,
 *     latency EMA, success rate, fallbacks, cost class, kill-switch state.
 *  2. Decision Monitor  — recent orchestrated decisions from ai/decisions in
 *     Realtime Database: signal, Jev decision, LLM provider, risk verdict,
 *     final state. Concise rationale only — never chain-of-thought.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, BrainCircuit, RefreshCw } from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

interface ProviderRow {
    id: string;
    name: string;
    type: string;
    costClass: string;
    commercialUse: boolean;
    enabled: boolean;
    verified: boolean;
    credentialsConfigured: boolean;
    capabilities: string[];
    priority: number;
    health: {
        circuitState: string;
        avgLatencyMs: number | null;
        successRate: number | null;
        failures: number;
        rateLimitErrors: number;
        lastErrorAt: number | null;
        lastErrorCode: string | null;
        lastSuccessAt: number | null;
    } | null;
}

interface DecisionRow {
    requestId: string;
    symbol: string;
    timeframe: string;
    direction: string;
    state: string;
    confidence: number;
    validationStatus: string;
    rationale: string;
    timestamp: number;
    jev?: { decision: string; confidence: number; status: string } | null;
    llm?: { provider: string; model: string } | null;
    risk?: { approved: boolean; code: string } | null;
}

function fmtTime(ts: number | null | undefined): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StateBadge({ value }: { value: string }) {
    const tone =
        value === "healthy" || value === "closed" || value === "READY" || value === "VALIDATED" || value === "APPROVED"
            ? "border-positive/40 bg-positive/10 text-positive"
            : value === "open" || value === "BLOCKED" || value === "RISK_BLOCKED"
              ? "border-negative/40 bg-negative/10 text-negative"
              : value === "half_open" || value === "degraded" || value === "WAITING"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border bg-muted text-muted-foreground";
    return (
        <span className={`rounded-full border px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide ${tone}`}>
            {value.replace(/_/g, " ")}
        </span>
    );
}

export default function AdminAIMonitorPage() {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [providers, setProviders] = useState<ProviderRow[] | null>(null);
    const [decisions, setDecisions] = useState<DecisionRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (u: FirebaseUser) => {
        try {
            const token = await u.getIdToken();
            setError(null);
            const [provRes, decRes] = await Promise.all([
                fetch("/api/ai/providers", { headers: { Authorization: `Bearer ${token}` } }),
                fetch("/api/admin/ai/intelligence/decisions", { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            const prov = await provRes.json().catch(() => null);
            const dec = await decRes.json().catch(() => null);
            setProviders(prov?.providers ?? null);
            setDecisions(dec?.decisions ?? null);
            if (!provRes.ok && !decRes.ok) setError("Neither providers nor decisions could be loaded.");
        } catch {
            setError("Failed to load AI monitor data.");
        }
    }, []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
            if (u) void load(u);
        });
        return () => unsub();
    }, [load]);

    return (
        <AdminShell title="AI Intelligence Monitor" subtitle="Provider health, routing and decision audit for the Unified Intelligence Fabric">
            {loading ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Activity className="mr-2 size-4 animate-pulse" /> Loading…
                </div>
            ) : !user ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-10 text-center">
                    <BrainCircuit className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Admin sign-in required</p>
                    <a
                        href="/login?redirect=/admin/ai/monitor"
                        className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
                    >
                        Sign In
                    </a>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-foreground">Provider Monitor</h2>
                        <button
                            type="button"
                            onClick={() => user && void load(user)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs transition hover:bg-muted"
                        >
                            <RefreshCw className="size-3" /> Refresh
                        </button>
                    </div>
                    {error ? <p className="text-xs text-negative">{error}</p> : null}
                    <div className="overflow-x-auto rounded-lg border border-border bg-card">
                        <table className="w-full min-w-[760px] text-left text-xs">
                            <thead className="border-b border-border text-micro uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2">Provider</th>
                                    <th className="px-3 py-2">Type</th>
                                    <th className="px-3 py-2">Cost</th>
                                    <th className="px-3 py-2">Circuit</th>
                                    <th className="px-3 py-2">Latency</th>
                                    <th className="px-3 py-2">Success</th>
                                    <th className="px-3 py-2">Failures</th>
                                    <th className="px-3 py-2">Rate-limited</th>
                                    <th className="px-3 py-2">Last used</th>
                                    <th className="px-3 py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {(providers ?? []).map((p) => (
                                    <tr key={p.id}>
                                        <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{p.type}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{p.costClass}</td>
                                        <td className="px-3 py-2">{p.health ? <StateBadge value={p.health.circuitState} /> : <span className="text-muted-foreground">idle</span>}</td>
                                        <td className="px-3 py-2 font-numeric tabular-nums text-muted-foreground">{p.health?.avgLatencyMs != null ? `${p.health.avgLatencyMs} ms` : "—"}</td>
                                        <td className="px-3 py-2 font-numeric tabular-nums text-muted-foreground">{p.health?.successRate != null ? `${Math.round(p.health.successRate * 100)}%` : "—"}</td>
                                        <td className="px-3 py-2 font-numeric tabular-nums text-muted-foreground">{p.health?.failures ?? 0}</td>
                                        <td className="px-3 py-2 font-numeric tabular-nums text-muted-foreground">{p.health?.rateLimitErrors ?? 0}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{fmtTime(p.health?.lastSuccessAt ?? p.health?.lastErrorAt ?? null)}</td>
                                        <td className="px-3 py-2">
                                            {!p.enabled ? (
                                                <StateBadge value="disabled" />
                                            ) : !p.verified ? (
                                                <StateBadge value="unverified" />
                                            ) : !p.credentialsConfigured ? (
                                                <StateBadge value="no key" />
                                            ) : (
                                                <StateBadge value="enabled" />
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {providers && providers.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No providers registered.</td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>

                    <h2 className="mt-4 text-sm font-semibold text-foreground">Decision Monitor</h2>
                    <p className="-mt-2 text-micro text-muted-foreground">
                        Recent orchestrated decisions from ai/decisions. Concise rationale and evidence only — no hidden reasoning traces are stored or displayed.
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border bg-card">
                        <table className="w-full min-w-[720px] text-left text-xs">
                            <thead className="border-b border-border text-micro uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2">Time</th>
                                    <th className="px-3 py-2">Symbol</th>
                                    <th className="px-3 py-2">Direction</th>
                                    <th className="px-3 py-2">Jev</th>
                                    <th className="px-3 py-2">LLM</th>
                                    <th className="px-3 py-2">Risk</th>
                                    <th className="px-3 py-2">Final</th>
                                    <th className="px-3 py-2">Confidence</th>
                                    <th className="px-3 py-2">Rationale</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {(decisions ?? []).map((d) => (
                                    <tr key={d.requestId}>
                                        <td className="px-3 py-2 font-numeric tabular-nums text-muted-foreground">{fmtTime(d.timestamp)}</td>
                                        <td className="px-3 py-2 font-medium text-foreground">{d.symbol} {d.timeframe}</td>
                                        <td className="px-3 py-2 text-foreground">{d.direction}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{d.jev ? `${d.jev.decision} ${d.jev.confidence}%` : "—"}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{d.llm ? d.llm.provider : "—"}</td>
                                        <td className="px-3 py-2">{d.risk ? (d.risk.approved ? <StateBadge value="APPROVED" /> : <StateBadge value="BLOCKED" />) : <span className="text-muted-foreground">—</span>}</td>
                                        <td className="px-3 py-2"><StateBadge value={d.state} /></td>
                                        <td className="px-3 py-2 font-numeric tabular-nums text-muted-foreground">{d.confidence}%</td>
                                        <td className="max-w-[280px] truncate px-3 py-2 text-muted-foreground" title={d.rationale}>{d.rationale}</td>
                                    </tr>
                                ))}
                                {decisions && decisions.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                                            No decisions recorded yet. Decisions appear here once the fabric runs (audit flag: AI_INTELLIGENCE_AUDIT).
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </AdminShell>
    );
}
