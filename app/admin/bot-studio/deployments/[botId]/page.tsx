"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
    Bot,
    ArrowLeft,
    Play,
    Pause,
    Square,
    RefreshCw,
    Terminal,
    Shield,
    Activity,
    AlertCircle,
    CheckCircle2,
    Clock,
    Zap,
    ExternalLink,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import type {
    BotDeployment,
    BotStrategy,
    BotLogEntry,
    BotSignal,
    BotExecution,
} from "@/lib/bot-studio/types";
import { STATE_LABELS } from "@/lib/bot-studio/lifecycle";

export default function BotDeploymentMonitorPage() {
    const params = useParams();
    const router = useRouter();
    const botId = params?.botId as string;

    const [deployment, setDeployment] = useState<BotDeployment | null>(null);
    const [strategy, setStrategy] = useState<BotStrategy | null>(null);
    const [logs, setLogs] = useState<BotLogEntry[]>([]);
    const [signals, setSignals] = useState<BotSignal[]>([]);
    const [executions, setExecutions] = useState<BotExecution[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"logs" | "signals" | "executions">("logs");

    const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const user = auth.currentUser;
        if (!user) return {};
        const token = await user.getIdToken();
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        };
    }, []);

    const loadData = useCallback(async () => {
        if (!botId) return;
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/deployments/${botId}`, { headers });
            const data = await res.json();
            if (data.ok) {
                setDeployment(data.deployment);
                setStrategy(data.strategy);
                setLogs(data.logs || []);
                setSignals(data.signals || []);
                setExecutions(data.executions || []);
            } else {
                setError(data.error || "Failed to load deployment monitor data");
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Network error");
        } finally {
            setLoading(false);
        }
    }, [botId, getAuthHeaders]);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 10000); // 10s auto refresh
        return () => clearInterval(interval);
    }, [loadData]);

    const handleLifecycle = async (targetState: string) => {
        setActionLoading(targetState);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/deployments/${botId}/lifecycle`, {
                method: "POST",
                headers,
                body: JSON.stringify({ targetState }),
            });
            const data = await res.json();
            if (!data.ok) {
                alert(`Error: ${data.error}`);
            } else {
                await loadData();
            }
        } catch (e) {
            alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleTick = async () => {
        setActionLoading("tick");
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/deployments/${botId}/tick`, {
                method: "POST",
                headers,
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!data.ok) {
                alert(`Tick Error: ${data.error}`);
            } else {
                alert(
                    `Tick Finished!\nSignal: ${data.tickResult?.signalGenerated ? "YES" : "NO"}\nGate: ${data.tickResult?.gateApproved ? "APPROVED" : data.tickResult?.gateCode || "PASS"}`
                );
                await loadData();
            }
        } catch (e) {
            alert(`Tick Failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    if (loading && !deployment) {
        return (
            <AdminShell title="Bot Deployment Monitor">
                <div className="p-12 text-center text-muted-foreground">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading bot monitor...
                </div>
            </AdminShell>
        );
    }

    if (error || !deployment) {
        return (
            <AdminShell title="Bot Deployment Monitor">
                <div className="p-6 max-w-4xl mx-auto space-y-4">
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                        <AlertCircle className="h-5 w-5" />
                        {error || "Deployment not found."}
                    </div>
                    <Link
                        href="/admin/bot-studio"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
                    >
                        <ArrowLeft className="h-4 w-4" /> Back to Bot Studio
                    </Link>
                </div>
            </AdminShell>
        );
    }

    const isRunning = deployment.runtimeState === "running";
    const isPaused = deployment.runtimeState === "paused";

    return (
        <AdminShell title="Bot Deployment Monitor">
            <div className="p-6 max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin/bot-studio"
                            className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground transition"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold tracking-tight">
                                    {strategy?.name || deployment.strategyId}
                                </h1>
                                <span
                                    className={`text-xs px-2.5 py-0.5 rounded-full font-semibold transition-colors ${
                                        isRunning
                                            ? "bg-positive/10 text-positive border border-positive/20"
                                            : isPaused
                                            ? "bg-warning/10 text-warning border border-warning/20"
                                            : "bg-muted text-muted-foreground"
                                    }`}
                                >
                                    {STATE_LABELS[deployment.runtimeState] || deployment.runtimeState}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                    {deployment.accountMode.toUpperCase()}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                <span>Bot ID: <code className="font-mono">{deployment.id}</code></span>
                                <span>Magic Number: <code className="font-mono">{strategy?.magicNumber || "—"}</code></span>
                                <span>Account: <code className="font-mono">{deployment.mt5Account}</code></span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Lifecycle controls */}
                        {!isRunning && (
                            <button
                                onClick={() => handleLifecycle("running")}
                                disabled={actionLoading === "running"}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors"
                            >
                                <Play className="h-4 w-4" />
                                Start Bot
                            </button>
                        )}
                        {isRunning && (
                            <button
                                onClick={() => handleLifecycle("paused")}
                                disabled={actionLoading === "paused"}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-sm transition-colors"
                            >
                                <Pause className="h-4 w-4" />
                                Pause Bot
                            </button>
                        )}
                        {deployment.runtimeState !== "stopped" && (
                            <button
                                onClick={() => handleLifecycle("stopped")}
                                disabled={actionLoading === "stopped"}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm transition-colors"
                            >
                                <Square className="h-4 w-4" />
                                Stop Bot
                            </button>
                        )}
                        <button
                            onClick={handleTick}
                            disabled={actionLoading === "tick"}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold transition-colors"
                        >
                            <Activity className={`h-4 w-4 ${actionLoading === "tick" ? "animate-spin" : ""}`} />
                            Evaluate Tick
                        </button>
                    </div>
                </div>

                {/* Metrics row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Signals Produced</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-base font-semibold font-bold">{deployment.signalCount || 0}</span>
                            <span className="text-xs text-muted-foreground">
                                Last: {deployment.lastSignalAt ? new Date(deployment.lastSignalAt).toLocaleTimeString() : "Never"}
                            </span>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Gateway Orders</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-base font-semibold font-bold">{deployment.executionCount || 0}</span>
                            <span className="text-xs text-emerald-500 font-medium">ACKed by MT5</span>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Gate Rejections</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-base font-semibold font-bold">{deployment.rejectionCount || 0}</span>
                            <span className="text-xs text-rose-500 font-medium">Fail-closed guards</span>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Last Engine Tick</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-lg font-bold font-mono">
                                {deployment.lastTickAt ? new Date(deployment.lastTickAt).toLocaleTimeString() : "Never"}
                            </span>
                            <span className="text-xs text-muted-foreground">Live loop</span>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border gap-6">
                    <button
                        onClick={() => setActiveTab("logs")}
                        className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
                            activeTab === "logs"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Runtime Logs ({logs.length})
                    </button>
                    <button
                        onClick={() => setActiveTab("signals")}
                        className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
                            activeTab === "signals"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Generated Signals ({signals.length})
                    </button>
                    <button
                        onClick={() => setActiveTab("executions")}
                        className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
                            activeTab === "executions"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Gateway Executions ({executions.length})
                    </button>
                </div>

                {/* Tab: Logs */}
                {activeTab === "logs" && (
                    <div className="rounded-xl border border-border bg-card p-4 space-y-2 shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        {logs.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                No logs recorded yet.
                            </div>
                        ) : (
                            <div className="space-y-1.5 font-mono text-xs max-h-[500px] overflow-y-auto">
                                {logs.map((log) => (
                                    <div
                                        key={log.id}
                                        className="p-2 rounded bg-muted/40 flex items-start gap-3 border border-border/40"
                                    >
                                        <span className="text-muted-foreground shrink-0">
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </span>
                                        <span
                                            className={`uppercase font-bold text-[8px] px-1.5 py-0.5 rounded ${
                                                log.level === "error"
                                                    ? "bg-rose-500/10 text-rose-500"
                                                    : log.level === "warn"
                                                    ? "bg-amber-500/10 text-amber-500"
                                                    : log.level === "signal"
                                                    ? "bg-purple-500/10 text-purple-500"
                                                    : log.level === "execution"
                                                    ? "bg-emerald-500/10 text-emerald-500"
                                                    : "bg-muted text-foreground"
                                            }`}
                                        >
                                            {log.level}
                                        </span>
                                        <span className="flex-1 text-foreground">{log.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Tab: Signals */}
                {activeTab === "signals" && (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        {signals.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                No signals recorded.
                            </div>
                        ) : (
                            <table className="w-full text-xs text-left">
                                <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                                    <tr>
                                        <th className="p-3">Time</th>
                                        <th className="p-3">Direction</th>
                                        <th className="p-3">Proposed Entry</th>
                                        <th className="p-3">Stop Loss</th>
                                        <th className="p-3">Take Profit</th>
                                        <th className="p-3">Outcome</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {signals.map((sig) => (
                                        <tr key={sig.id} className="hover:bg-muted/30">
                                            <td className="p-3 font-mono text-muted-foreground">
                                                {new Date(sig.generatedAt).toLocaleTimeString()}
                                            </td>
                                            <td className="p-3 font-bold">
                                                <span
                                                    className={
                                                        sig.direction === "BUY"
                                                            ? "text-emerald-500"
                                                            : "text-rose-500"
                                                    }
                                                >
                                                    {sig.direction}
                                                </span>
                                            </td>
                                            <td className="p-3 font-mono">{sig.proposedEntry}</td>
                                            <td className="p-3 font-mono">{sig.proposedSl || "—"}</td>
                                            <td className="p-3 font-mono">{sig.proposedTp || "—"}</td>
                                            <td className="p-3">
                                                <span
                                                    className={`px-2 py-0.5 rounded font-semibold ${
                                                        sig.outcome === "submitted"
                                                            ? "bg-emerald-500/10 text-emerald-500"
                                                            : sig.outcome === "rejected"
                                                            ? "bg-rose-500/10 text-rose-500"
                                                            : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    {sig.outcome}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* Tab: Executions */}
                {activeTab === "executions" && (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        {executions.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                No gateway executions recorded.
                            </div>
                        ) : (
                            <table className="w-full text-xs text-left">
                                <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                                    <tr>
                                        <th className="p-3">Client Order ID</th>
                                        <th className="p-3">MT5 Ticket</th>
                                        <th className="p-3">Direction</th>
                                        <th className="p-3">Volume</th>
                                        <th className="p-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {executions.map((ex) => (
                                        <tr key={ex.id} className="hover:bg-muted/30 font-mono">
                                            <td className="p-3">{ex.clientOrderId || ex.id}</td>
                                            <td className="p-3">{ex.mt5Ticket || "Pending"}</td>
                                            <td className="p-3 font-bold">{ex.direction}</td>
                                            <td className="p-3">{ex.volume ?? "—"} lots</td>
                                            <td className="p-3 font-sans">
                                                <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">
                                                    {ex.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>
        </AdminShell>
    );
}
