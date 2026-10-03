"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { Activity, AlertTriangle, Coins, Database, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

interface Diagnostics {
    generatedAt: number;
    executionEnabled: boolean;
    queue: {
        active: number;
        paused: number;
        completed: number;
        failed: number;
        cancelled: number;
        leasesHeld: number;
    };
    totals: {
        missions: number;
        aiRequests: number;
        backtests: number;
        hypotheses: number;
        candidates: number;
        rejected: number;
        survivors: number;
        dataQualityFailures: number;
    };
    failStates: Record<string, number>;
    failureDetails: Array<{
        missionId: string;
        uid: string;
        stage: string;
        failState: string | null;
        error: string | null;
        tail: Array<{ at: number; level: string; code: string | null; message: string }>;
    }>;
    recentMissions: Array<{
        id: string;
        uid: string;
        name: string;
        status: string;
        stage: string;
        failState: string | null;
        markets: string[];
        createdAt: number;
        updatedAt: number;
        budgetUsed: { hypotheses: number; backtests: number; aiRequests: number; startedAt: number } | null;
    }>;
}

export default function StrategyResearchAdminPage() {
    const [user, setUser] = useState<User | null>(null);
    const [data, setData] = useState<Diagnostics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        try {
            const res = await fetch("/api/strategy-research/diagnostics", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
            });
            const body = (await res.json()) as Diagnostics & { error?: string };
            if (!res.ok) throw new Error(body.error ?? "Diagnostics failed");
            setData(body);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Diagnostics failed");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (u) void load();
            else setLoading(false);
        });
        return () => unsub();
    }, [load]);

    return (
        <AdminShell title="Strategy Research" subtitle="Research jobs · queue health · costs · fail-closed states">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Live broker execution: <span className="font-semibold text-emerald-600">DISABLED (always)</span>
                    {data ? <Badge variant="outline">{new Date(data.generatedAt).toLocaleTimeString()}</Badge> : null}
                </div>
                <Button variant="outline" size="xs" onClick={() => { setLoading(true); void load(); }} disabled={!user}>
                    <RefreshCw className="mr-1 h-3 w-3" /> Refresh
                </Button>
            </div>

            {loading ? (
                <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Loading diagnostics…</div>
            ) : error ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">{error}</div>
            ) : !data ? (
                <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">No diagnostics available.</div>
            ) : (
                <>
                    {/* Queue health */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
                        {(
                            [
                                ["Active", data.queue.active, "text-emerald-600"],
                                ["Paused", data.queue.paused, "text-amber-600"],
                                ["Completed", data.queue.completed, ""],
                                ["Failed", data.queue.failed, data.queue.failed > 0 ? "text-rose-600" : ""],
                                ["Cancelled", data.queue.cancelled, ""],
                                ["Leases held", data.queue.leasesHeld, ""],
                            ] as const
                        ).map(([label, value, tone]) => (
                            <div key={label} className="rounded-xl border bg-card p-4 shadow-sm">
                                <div className="text-xs text-muted-foreground">{label}</div>
                                <div className={`font-semibold ${tone}`}>{value}</div>
                            </div>
                        ))}
                    </div>

                    {/* Usage / cost */}
                    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
                        {(
                            [
                                ["Missions", data.totals.missions, <Activity key="a" className="h-3.5 w-3.5" />],
                                ["Hypotheses", data.totals.hypotheses, <AlertTriangle key="b" className="h-3.5 w-3.5" />],
                                ["Candidates", data.totals.candidates, <Database key="c" className="h-3.5 w-3.5" />],
                                ["Rejected", data.totals.rejected, <AlertTriangle key="d" className="h-3.5 w-3.5" />],
                                ["Survivors", data.totals.survivors, <ShieldCheck key="e" className="h-3.5 w-3.5" />],
                                ["AI requests", data.totals.aiRequests, <Zap key="f" className="h-3.5 w-3.5" />],
                            ] as const
                        ).map(([label, value, icon]) => (
                            <div key={label} className="rounded-xl border bg-card p-4 shadow-sm">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
                                <div className="font-semibold">{value}</div>
                            </div>
                        ))}
                    </div>

                    <div className="mb-6 grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border bg-card p-4 shadow-sm">
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                                <Coins className="h-4 w-4" /> Research cost totals
                            </div>
                            <ul className="space-y-1 text-sm">
                                <li>Backtests executed: <span className="font-semibold">{data.totals.backtests}</span></li>
                                <li>AI requests made: <span className="font-semibold">{data.totals.aiRequests}</span></li>
                                <li>Data quality failures: <span className={`font-semibold ${data.totals.dataQualityFailures > 0 ? "text-rose-600" : ""}`}>{data.totals.dataQualityFailures}</span></li>
                            </ul>
                        </div>
                        <div className="rounded-xl border bg-card p-4 shadow-sm">
                            <div className="mb-2 text-sm font-semibold">Fail-closed states</div>
                            {Object.keys(data.failStates).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No fail-closed terminations.</p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(data.failStates).map(([state, count]) => (
                                        <Badge key={state} variant="outline" className="text-rose-600">{state}: {count}</Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Failed jobs */}
                    <div className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
                        <h3 className="mb-2 text-sm font-semibold">Failed research jobs (tail events)</h3>
                        {data.failureDetails.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No failed jobs.</p>
                        ) : (
                            <div className="space-y-3">
                                {data.failureDetails.map((f) => (
                                    <div key={f.missionId} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs dark:border-rose-900 dark:bg-rose-950/30">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold">{f.missionId}</span>
                                            <StatusBadge label={f.stage} tone="warning" />
                                            {f.failState ? <Badge variant="outline" className="text-rose-600">{f.failState}</Badge> : null}
                                            <span className="text-muted-foreground">uid {f.uid}</span>
                                        </div>
                                        {f.error ? <p className="mt-1">{f.error}</p> : null}
                                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                                            {f.tail.map((e, i) => (
                                                <li key={i}>
                                                    [{new Date(e.at).toLocaleTimeString()}] {e.code ?? e.level}: {e.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Recent missions */}
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                        <h3 className="mb-2 text-sm font-semibold">Recent missions</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b text-muted-foreground">
                                        <th className="px-2 py-1.5 font-medium">Mission</th>
                                        <th className="px-2 py-1.5 font-medium">User</th>
                                        <th className="px-2 py-1.5 font-medium">Markets</th>
                                        <th className="px-2 py-1.5 font-medium">Status</th>
                                        <th className="px-2 py-1.5 font-medium">Stage</th>
                                        <th className="px-2 py-1.5 font-medium">Fail state</th>
                                        <th className="px-2 py-1.5 font-medium">AI / BT</th>
                                        <th className="px-2 py-1.5 font-medium">Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.recentMissions.map((m) => (
                                        <tr key={m.id} className="border-b border-border/40">
                                            <td className="px-2 py-1.5">{m.name}</td>
                                            <td className="px-2 py-1.5 text-muted-foreground">{m.uid.slice(0, 10)}…</td>
                                            <td className="px-2 py-1.5">{m.markets.join(", ")}</td>
                                            <td className="px-2 py-1.5">
                                                <StatusBadge
                                                    label={m.status}
                                                    tone={
                                                        m.status === "completed"
                                                            ? "positive"
                                                            : m.status === "failed"
                                                                ? "negative"
                                                                : m.status === "running"
                                                                    ? "info"
                                                                    : "warning"
                                                    }
                                                />
                                            </td>
                                            <td className="px-2 py-1.5">{m.stage}</td>
                                            <td className="px-2 py-1.5 text-rose-600">{m.failState ?? "—"}</td>
                                            <td className="px-2 py-1.5">{m.budgetUsed?.aiRequests ?? 0} / {m.budgetUsed?.backtests ?? 0}</td>
                                            <td className="px-2 py-1.5 text-muted-foreground">{new Date(m.updatedAt).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </AdminShell>
    );
}
