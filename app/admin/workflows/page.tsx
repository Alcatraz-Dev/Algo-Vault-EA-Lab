"use client";
import { useState, useEffect, useCallback, ReactNode } from "react";
import Link from "next/link";
import { GitBranch, Play, Shield, Pause, Archive, X, RefreshCw } from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

interface WorkflowSummary {
    workflowCount: number;
    runsTotal: number;
    killSwitch: boolean;
    killSwitchReason?: string;
    statusBreakdown: {
        draft: number;
        active: number;
        paused: number;
        disabled: number;
        archived: number;
    };
    recentFailures: Array<{
        id: string;
        workflowId: string;
        workflowName: string;
        status: string;
        startedAt: number;
        finishedAt: number | null;
        error?: string;
    }>;
}

export default function AdminWorkflowsPage() {
    const [summary, setSummary] = useState<WorkflowSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) setLoading(false);
        });
        return () => unsub();
    }, []);

    const loadSummary = useCallback(() => {
        if (!user) return;
        user.getIdToken()
            .then((token) => fetch("/api/admin/workflows", { headers: { Authorization: `Bearer ${token}` } }))
            .then((r) => (r.ok ? r.json() : null))
            .then((data: WorkflowSummary | null) => data && setSummary(data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [user]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    const toggleKillSwitch = async () => {
        if (!user || !summary) return;
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/admin/workflows", {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ killSwitch: !summary.killSwitch, reason: "Admin kill switch toggled." }),
            });
            if (res.ok) {
                const data = await res.json();
                setSummary((prev) => prev ? { ...prev, killSwitch: data.killSwitchEnabled, killSwitchReason: data.killSwitchReason } : prev);
            }
        } catch {}
    };

    const statusBreakdown = summary?.statusBreakdown ?? { draft: 0, active: 0, paused: 0, disabled: 0, archived: 0 };
    const recentFailures = summary?.recentFailures || [];

    return (
        <AdminShell title="Workflow Studio" subtitle="Monitor runs, manage templates, configure kill switch.">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <StatCard icon={<GitBranch size={20} />} label="Workflows" value={summary?.workflowCount ?? "—"} />
                    <StatCard icon={<Play size={20} />} label="Total Runs" value={summary?.runsTotal ?? "—"} />
                    <StatCard icon={<Shield size={20} />} label="Status" value="Active" />
                </div>
                <div className="flex gap-2">
                    <Button
                        variant={summary?.killSwitch ? "default" : "outline"}
                        size="sm"
                        className={summary?.killSwitch ? "bg-rose-500 hover:bg-rose-600" : ""}
                        onClick={toggleKillSwitch}
                        disabled={loading}
                    >
                        <Shield size={13} className="mr-1.5" />
                        Kill Switch: {summary?.killSwitch ? "ON" : "OFF"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={loadSummary} disabled={loading}>
                        <RefreshCw size={13} className="mr-1.5" />
                        Refresh
                    </Button>
                </div>
            </div>

            {summary?.killSwitchReason && (
                <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-600">
                    {summary.killSwitchReason}
                </div>
            )}

            {/* Status breakdown */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <MiniStat label="Active" value={statusBreakdown.active ?? 0} icon={<Play size={14} className="text-emerald-400" />} />
                <MiniStat label="Paused" value={statusBreakdown.paused ?? 0} icon={<Pause size={14} className="text-amber-400" />} />
                <MiniStat label="Disabled" value={statusBreakdown.disabled ?? 0} icon={<X size={14} className="text-rose-400" />} />
                <MiniStat label="Drafts" value={statusBreakdown.draft ?? 0} icon={<Archive size={14} className="text-muted-foreground" />} />
                <MiniStat label="Archived" value={statusBreakdown.archived ?? 0} icon={<Archive size={14} className="text-muted-foreground/50" />} />
            </div>

            {/* Recent failures */}
            <div className="mb-6 rounded-2xl border">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                    <h3 className="font-medium">Recent Failures &amp; Partial Runs</h3>
                    <Link href="/admin/intelligence/executions" className="text-xs text-muted-foreground hover:text-foreground">
                        View all executions &rarr;
                    </Link>
                </div>
                {recentFailures.length === 0 ? (
                    <div className="p-5 text-center text-sm text-muted-foreground">
                        No recent failures. All workflows running normally.
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {recentFailures.map((run) => (
                            <div key={run.id} className="flex items-start justify-between px-5 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{run.workflowName || run.workflowId}</span>
                                        <StatusBadge label={run.status} tone={run.status === "failed" || run.status === "timeout" ? "negative" : "warning"} />
                                    </div>
                                    {run.error && (
                                        <p className="mt-1 text-xs text-muted-foreground truncate">
                                            {run.error}
                                        </p>
                                    )}
                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                        {new Date(run.startedAt).toLocaleString()}
                                    </p>
                                </div>
                                <Link
                                    href="/admin/intelligence/workflows"
                                    className="shrink-0 rounded-xl border border-border/30 bg-muted px-3 py-1.5 text-xs font-medium transition hover:bg-muted/50"
                                >
                                    Manage
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Admin actions */}
            <div className="rounded-2xl border p-6">
                <h3 className="font-medium mb-2">Admin Actions</h3>
                <div className="flex gap-3 flex-wrap">
                    <Link href="/admin/intelligence/workflows">
                        <button className="rounded-xl border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/50">
                            Workflow Definitions
                        </button>
                    </Link>
                    <Link href="/admin/intelligence/executions">
                        <button className="rounded-xl border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/50">
                            Execution Logs
                        </button>
                    </Link>
                    <Link href="/workflows">
                        <button className="rounded-xl border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/50">
                            User Workflows
                        </button>
                    </Link>
                </div>
            </div>
        </AdminShell>
    );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
    return <div className="rounded-2xl border bg-card p-5 flex items-center gap-3"><div className="text-2xl">{icon}</div><div><div className="text-3xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div></div>;
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
    return (
        <div className="flex items-center gap-3 rounded-xl border bg-muted/20 px-4 py-3">
            {icon}
            <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold">{value}</p>
            </div>
        </div>
    );
}