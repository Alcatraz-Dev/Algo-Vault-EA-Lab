"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Activity,
    AlertCircle,
    ArrowRight,
    Bot,
    CheckCircle2,
    Clock,
    Loader2,
    Plug,
    RefreshCw,
    Settings2,
    Zap,
} from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { PluginRecord, PluginConfig, PluginRuntimeState, PluginInstallation, PluginExecutionRecord } from "@/lib/plugins/types";
import { CATEGORY_LABELS, formatDate, installStatusTone, nextRunLabel, pluginFetchJSON, timeAgo } from "@/lib/plugins/ui";

type AgentRow = {
    install: PluginInstallation;
    plugin: PluginRecord | null;
    config: PluginConfig | null;
    runtime: PluginRuntimeState | null;
    recent: PluginExecutionRecord[];
    alertCount: number;
};

export default function AccountAgentsPage() {
    const router = useRouter();
    const [agents, setAgents] = useState<AgentRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        setRefreshing(true);
        try {
            const data = await pluginFetchJSON<{ agents: AgentRow[] }>("/api/plugins/agents");
            setAgents(Array.isArray(data.agents) ? data.agents : []);
            setLoadError("");
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Unable to load your agents.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const active = agents.filter((a) => a.install?.status === "active").length;
    const totalExecutions = agents.reduce((s, a) => s + Number(a.install?.executions || 0), 0);
    const totalAlerts = agents.reduce((s, a) => s + Number(a.alertCount || 0), 0);

    return (
        <AccountShell
            title="Active Agents"
            subtitle="Background intelligence agents running on your trading data."
            onBack={() => router.push("/account")}
        >
            {loadError && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
                    <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-300" />
                    <p className="text-sm text-red-300">{loadError}</p>
                </div>
            )}

            {/* Summary */}
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
                <SummaryCard icon={<Activity size={16} />} label="Active agents" value={active} />
                <SummaryCard icon={<Zap size={16} />} label="Executions" value={totalExecutions} />
                <SummaryCard icon={<AlertCircle size={16} />} label="Alerts generated" value={totalAlerts} />
            </div>

            {loading ? (
                <div className="grid gap-4">
                    {[1, 2].map((n) => (
                        <div key={n} className="h-40 animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    ))}
                </div>
            ) : agents.length === 0 ? (
                <EmptyState
                    icon={<Bot size={18} />}
                    title="No active agents running"
                    description="Install a plugin, configure it, and activate it — it will start running as a background agent on the schedule you choose."
                    action={
                        <Link href="/marketplace/plugins" className="inline-flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
                            Browse Plugins <ArrowRight size={14} />
                        </Link>
                    }
                />
            ) : (
                <div className="grid gap-4">
                    {agents.map(({ install, plugin, config, runtime, recent, alertCount }) => {
                        if (!plugin) return null;
                        const isActive = install.status === "active";
                        return (
                            <div key={install.pluginId} className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                                            <Plug size={20} className="text-violet-300" />
                                        </div>
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-semibold text-foreground">{plugin.displayName}</span>
                                                <StatusBadge tone={installStatusTone(install.status)} label={install.status} dot={isActive} pulse={isActive} />
                                                <span className="rounded-lg border border-border/30 bg-muted/5 px-2 py-0.5 text-[10px] text-muted-foreground">
                                                    {CATEGORY_LABELS[plugin.category]}
                                                </span>
                                            </div>
                                            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground line-clamp-1">{plugin.description}</p>
                                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                                <span>Interval: {config?.interval || plugin.manifest?.runtime?.interval || "manual"}</span>
                                                <span>Next run: {nextRunLabel(runtime?.nextRunAt, runtime?.status)}</span>
                                                <span>Last run: {runtime?.lastRunAt ? timeAgo(runtime.lastRunAt) : "never"}</span>
                                                <span>Executions: {install.executions || 0}</span>
                                                <span>Alerts: {alertCount}</span>
                                                {runtime?.failures ? <span className="text-amber-400">Failures: {runtime.failures}</span> : null}
                                            </div>
                                        </div>
                                    </div>
                                    <Link
                                        href={`/account/plugins/${install.pluginId}`}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                                    >
                                        <Settings2 size={13} />
                                        Manage Agent
                                    </Link>
                                </div>

                                {recent && recent.length > 0 && (
                                    <div className="mt-4 rounded-xl border border-border/30 bg-muted/20 p-4">
                                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent runs</p>
                                        <div className="mt-2 space-y-2">
                                            {recent.slice(0, 3).map((exec) => (
                                                <div key={exec.id} className="flex items-start justify-between gap-3 text-xs">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <StatusBadge tone={exec.status === "success" ? "positive" : "error"} label={exec.status} dot />
                                                        <span className="truncate text-muted-foreground">
                                                            {exec.summary || exec.error || "No summary"}
                                                        </span>
                                                    </div>
                                                    <span className="shrink-0 text-muted-foreground">
                                                        {exec.finishedAt ? formatDate(exec.finishedAt) : ""} · {exec.durationMs}ms
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="mt-8 flex items-center justify-center">
                <button
                    type="button"
                    onClick={load}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                    {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Refresh
                </button>
            </div>
        </AccountShell>
    );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
    return (
        <div className="flex items-center gap-4 rounded-2xl border border-border/30 bg-muted/50 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/30 bg-muted/5 text-muted-foreground">
                {icon}
            </div>
            <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-xl font-semibold">{value}</p>
            </div>
        </div>
    );
}