"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Bot,
    Plus,
    Play,
    Pause,
    Square,
    Activity,
    Code2,
    Layers,
    Clock,
    Shield,
    Terminal,
    ArrowUpRight,
    RefreshCw,
    Trash2,
    CheckCircle2,
    AlertTriangle,
    Sliders,
    Zap,
    BarChart3,
    X,
    MoreHorizontal,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { auth } from "@/lib/firebase";
import type { BotStrategy, BotDeployment } from "@/lib/bot-studio/types";
import { STATE_LABELS } from "@/lib/bot-studio/lifecycle";

export default function BotStudioDashboard() {
    const router = useRouter();
    const [strategies, setStrategies] = useState<BotStrategy[]>([]);
    const [deployments, setDeployments] = useState<BotDeployment[]>([]);
    const [activeTab, setActiveTab] = useState<"deployments" | "strategies">("deployments");
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Deploy Modal State
    const [deployModalOpen, setDeployModalOpen] = useState(false);
    const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
    const [accountMode, setAccountMode] = useState<"demo" | "live">("demo");
    const [mt5Account, setMt5Account] = useState("default");

    // Backtest Modal State
    const [backtestResult, setBacktestResult] = useState<any>(null);
    const [backtestModalOpen, setBacktestModalOpen] = useState(false);

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
        setLoading(true);
        setError(null);
        try {
            const headers = await getAuthHeaders();
            const [stratRes, depRes] = await Promise.all([
                fetch("/api/bot-studio/strategies", { headers }),
                fetch("/api/bot-studio/deployments", { headers }),
            ]);

            if (stratRes.ok) {
                const sData = await stratRes.json();
                if (sData.ok) setStrategies(sData.strategies || []);
            }
            if (depRes.ok) {
                const dData = await depRes.json();
                if (dData.ok) setDeployments(dData.deployments || []);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load Bot Studio data");
        } finally {
            setLoading(false);
        }
    }, [getAuthHeaders]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleLifecycleTransition = async (botId: string, targetState: string) => {
        setActionLoading(botId);
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

    const handleTriggerTick = async (botId: string) => {
        setActionLoading(`tick-${botId}`);
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
                    `Tick Evaluated!\nSignal Generated: ${data.tickResult?.signalGenerated}\nGate: ${data.tickResult?.gateApproved ? "Approved" : data.tickResult?.gateCode || "No Signal"}`
                );
                await loadData();
            }
        } catch (e) {
            alert(`Tick Failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleRename = async (strategyId: string, currentName: string) => {
        const name = prompt("Rename strategy", currentName);
        if (!name || name.trim() === currentName) return;
        setActionLoading(`rename-${strategyId}`);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ name: name.trim() }),
            });
            const data = await res.json();
            if (!data.ok) alert(`Rename failed: ${data.error}`);
            await loadData();
        } catch (e) {
            alert(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDuplicate = async (strategyId: string) => {
        setActionLoading(`dup-${strategyId}`);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, {
                method: "POST",
                headers,
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!data.ok) alert(`Duplicate failed: ${data.error}`);
            await loadData();
        } catch (e) {
            alert(`Duplicate failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeploy = async () => {
        if (!selectedStrategyId) return;
        setActionLoading("deploying");
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/bot-studio/deployments", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    strategyId: selectedStrategyId,
                    accountMode,
                    mt5Account,
                }),
            });
            const data = await res.json();
            if (!data.ok) {
                alert(`Deploy failed: ${data.error}`);
            } else {
                setDeployModalOpen(false);
                await loadData();
                router.push(`/admin/bot-studio/deployments/${data.deployment.id}`);
            }
        } catch (e) {
            alert(`Deploy error: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeleteStrategy = async (strategyId: string) => {
        if (!confirm("Are you sure you want to delete this strategy?")) return;
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, {
                method: "DELETE",
                headers,
            });
            const data = await res.json();
            if (data.ok) {
                await loadData();
            } else {
                alert(`Delete failed: ${data.error}`);
            }
        } catch (e) {
            alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    const handleRunBacktest = async (strategyId: string) => {
        setActionLoading(`backtest-${strategyId}`);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${strategyId}/backtest`, {
                method: "POST",
                headers,
                body: JSON.stringify({ period: "1Y" }),
            });
            const data = await res.json();
            if (data.ok) {
                setBacktestResult(data.backtest);
                setBacktestModalOpen(true);
                await loadData();
            } else {
                alert(`Backtest failed: ${data.error}`);
            }
        } catch (e) {
            alert(`Backtest error: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <AdminShell title="AlgoVault Bot Studio">
            <div className="p-6 max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                                <Bot className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight">AlgoVault Bot Studio</h1>
                                <p className="text-sm text-muted-foreground">
                                    Algorithmic trading strategy runtime, visual builder & MT5 gateway deployment
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={loadData}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted text-sm font-medium transition-colors"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </button>
                        <Link
                            href="/admin/bot-studio/builder"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition-colors"
                        >
                            <Layers className="h-4 w-4" />
                            Visual Builder
                        </Link>
                        <Link
                            href="/admin/bot-studio/editor"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition-colors"
                        >
                            <Code2 className="h-4 w-4" />
                            AvScript Editor
                        </Link>
                        <button
                            onClick={() => {
                                if (strategies.length > 0) {
                                    setSelectedStrategyId(strategies[0].id);
                                    setDeployModalOpen(true);
                                } else {
                                    alert("Please create a strategy first before deploying.");
                                }
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 text-sm font-semibold shadow-sm transition-colors"
                        >
                            <Zap className="h-4 w-4" />
                            Deploy Bot
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        {error}
                    </div>
                )}

                {/* Metrics Bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Active Deployments</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-base font-semibold font-bold">
                                {deployments.filter((d) => d.runtimeState === "running").length}
                            </span>
                            <span className="text-xs text-muted-foreground">of {deployments.length} bots</span>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Saved Strategies</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-base font-semibold font-bold">{strategies.length}</span>
                            <span className="text-xs text-emerald-500 font-medium">Production ready</span>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Signals Generated</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-base font-semibold font-bold">
                                {deployments.reduce((acc, d) => acc + (d.signalCount || 0), 0)}
                            </span>
                            <span className="text-xs text-muted-foreground">across sessions</span>
                        </div>
                    </div>
                    <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <span className="text-xs font-medium text-muted-foreground">Gateway Executions</span>
                        <div className="mt-1 flex items-baseline justify-between">
                            <span className="font-numeric text-base font-semibold font-bold">
                                {deployments.reduce((acc, d) => acc + (d.executionCount || 0), 0)}
                            </span>
                            <span className="text-xs text-primary font-medium">MT5 ACKed</span>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border gap-6">
                    <button
                        onClick={() => setActiveTab("deployments")}
                        className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
                            activeTab === "deployments"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Active Bot Deployments ({deployments.length})
                    </button>
                    <button
                        onClick={() => setActiveTab("strategies")}
                        className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
                            activeTab === "strategies"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Strategy Repository ({strategies.length})
                    </button>
                </div>

                {/* Content: Deployments */}
                {activeTab === "deployments" && (
                    <div className="space-y-4">
                        {deployments.length === 0 ? (
                            <div className="text-center py-16 border border-dashed border-border rounded-xl bg-card/50">
                                <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-3 opacity-60" />
                                <h3 className="text-lg font-semibold">No Bot Deployments Yet</h3>
                                <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-4">
                                    Deploy a visual or AvScript strategy to monitor live execution and MT5 order flow.
                                </p>
                                <button
                                    onClick={() => {
                                        if (strategies.length > 0) {
                                            setSelectedStrategyId(strategies[0].id);
                                            setDeployModalOpen(true);
                                        } else {
                                            router.push("/admin/bot-studio/builder");
                                        }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
                                >
                                    <Plus className="h-4 w-4" />
                                    {strategies.length > 0 ? "Deploy Strategy" : "Create First Strategy"}
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4">
                                {deployments.map((bot) => {
                                    const strat = strategies.find((s) => s.id === bot.strategyId);
                                    const isRunning = bot.runtimeState === "running";
                                    const isPaused = bot.runtimeState === "paused";

                                    return (
                                        <div
                                            key={bot.id}
                                            className="p-5 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] flex flex-col md:flex-row md:items-center justify-between gap-4"
                                        >
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-bold text-base">
                                                        {strat?.name || bot.strategyId}
                                                    </span>
                                                    <span
                                                        className={`text-xs px-2.5 py-0.5 rounded-full font-semibold transition-colors ${
                                                            isRunning
                                                                ? "bg-positive/10 text-positive border border-positive/20"
                                                                : isPaused
                                                                ? "bg-warning/10 text-warning border border-warning/20"
                                                                : "bg-muted text-muted-foreground"
                                                        }`}
                                                    >
                                                        {STATE_LABELS[bot.runtimeState] || bot.runtimeState}
                                                    </span>
                                                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                                        {bot.accountMode.toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                                                    <span>Bot ID: <code className="font-mono">{bot.id}</code></span>
                                                    <span>Symbol: <strong className="text-foreground">{strat?.definition?.asset || "EURUSD"}</strong></span>
                                                    <span>Magic Number: <code className="font-mono">{strat?.magicNumber || "—"}</code></span>
                                                    <span>Signals: {bot.signalCount || 0}</span>
                                                    <span>Executions: {bot.executionCount || 0}</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {/* State Transition Actions */}
                                                {!isRunning && (
                                                    <button
                                                        onClick={() => handleLifecycleTransition(bot.id, "running")}
                                                        disabled={actionLoading === bot.id}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                                                    >
                                                        <Play className="h-3.5 w-3.5" />
                                                        Start
                                                    </button>
                                                )}
                                                {isRunning && (
                                                    <button
                                                        onClick={() => handleLifecycleTransition(bot.id, "paused")}
                                                        disabled={actionLoading === bot.id}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
                                                    >
                                                        <Pause className="h-3.5 w-3.5" />
                                                        Pause
                                                    </button>
                                                )}
                                                {bot.runtimeState !== "stopped" && (
                                                    <button
                                                        onClick={() => handleLifecycleTransition(bot.id, "stopped")}
                                                        disabled={actionLoading === bot.id}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
                                                    >
                                                        <Square className="h-3.5 w-3.5" />
                                                        Stop
                                                    </button>
                                                )}

                                                {/* Test Tick Button */}
                                                <button
                                                    onClick={() => handleTriggerTick(bot.id)}
                                                    disabled={actionLoading === `tick-${bot.id}`}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-muted/60 hover:bg-muted text-xs font-medium transition-colors"
                                                    title="Trigger market candle evaluation tick"
                                                >
                                                    <Activity className={`h-3.5 w-3.5 ${actionLoading === `tick-${bot.id}` ? "animate-spin" : ""}`} />
                                                    Tick
                                                </button>

                                                {/* View Monitor Link */}
                                                <Link
                                                    href={`/admin/bot-studio/deployments/${bot.id}`}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-card border border-border hover:bg-muted text-xs font-semibold transition-colors"
                                                >
                                                    <Terminal className="h-3.5 w-3.5" />
                                                    Monitor
                                                </Link>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Content: Strategies */}
                {activeTab === "strategies" && (
                    <div className="space-y-4">
                        {strategies.length === 0 ? (
                            <div className="text-center py-16 border border-dashed border-border rounded-xl bg-card/50">
                                <Layers className="h-12 w-12 mx-auto text-muted-foreground mb-3 opacity-60" />
                                <h3 className="text-lg font-semibold">No Strategies in Repository</h3>
                                <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-4">
                                    Create a strategy using the visual node editor or AvScript DSL compiler.
                                </p>
                                <div className="flex justify-center gap-3">
                                    <Link
                                        href="/admin/bot-studio/builder"
                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
                                    >
                                        <Layers className="h-4 w-4" />
                                        Visual Builder
                                    </Link>
                                    <Link
                                        href="/admin/bot-studio/editor"
                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium"
                                    >
                                        <Code2 className="h-4 w-4" />
                                        AvScript Editor
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {strategies.map((strat) => {
                                    const isVisual = strat.source.kind === "visual_builder";
                                    return (
                                        <div
                                            key={strat.id}
                                            className="p-5 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] flex flex-col justify-between space-y-4 min-w-0"
                                        >
                                            <div>
                                                <div className="flex items-start justify-between gap-2 min-w-0">
                                                    <div className="min-w-0">
                                                        <h3 className="font-bold text-base leading-snug break-words">
                                                            {strat.name}
                                                        </h3>
                                                        <span className="text-xs text-muted-foreground font-mono break-all">
                                                            {strat.id}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                                                        <span
                                                            className={`text-xs px-2 py-0.5 rounded font-semibold ${
                                                                isVisual
                                                                    ? "bg-sky-500/10 text-sky-500 border border-sky-500/20"
                                                                    : "bg-purple-500/10 text-purple-500 border border-purple-500/20"
                                                            }`}
                                                        >
                                                            {isVisual ? "Visual Graph" : "AvScript"}
                                                        </span>
                                                    </div>
                                                </div>

                                                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                                                    {strat.description || "No description provided."}
                                                </p>

                                                <div className="mt-4 pt-3 border-t border-border/60 grid grid-cols-2 gap-2 text-xs">
                                                    <div className="min-w-0">
                                                        <span className="text-muted-foreground">Asset: </span>
                                                        <span className="font-semibold break-all">{strat.definition.asset}</span>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="text-muted-foreground">Timeframe: </span>
                                                        <span className="font-semibold">{strat.definition.timeframes.entry}</span>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="text-muted-foreground">Magic: </span>
                                                        <span className="font-mono break-all">{strat.magicNumber}</span>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="text-muted-foreground">Rules: </span>
                                                        <span>{strat.definition.entryRules?.length || 0} entry</span>
                                                    </div>
                                                </div>

                                                <div className="mt-3 pt-2.5 border-t border-border/40 flex flex-wrap items-center gap-2 justify-between min-w-0">
                                                    <span className="text-[11px] text-muted-foreground shrink-0">Backtest:</span>
                                                    {strat.lastBacktestAt ? (
                                                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded whitespace-normal break-words ${
                                                            (strat.lastBacktestNetPnl ?? 0) >= 0 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                                        }`}>
                                                            <BarChart3 className="h-3 w-3" />
                                                            {(strat.lastBacktestNetPnl ?? 0) >= 0 ? "+" : ""}${(strat.lastBacktestNetPnl ?? 0).toFixed(2)} ({strat.lastBacktestWinRate?.toFixed(0)}% WR · {strat.lastBacktestTrades} trades)
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-[8px] text-muted-foreground px-2 py-0.5 rounded bg-muted/40 border border-border/40">
                                                            <BarChart3 className="h-3 w-3 opacity-60" />
                                                            Not Backtested
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border min-w-0">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <Link
                                                        href={
                                                            isVisual
                                                                ? `/admin/bot-studio/builder?id=${strat.id}`
                                                                : `/admin/bot-studio/editor?id=${strat.id}`
                                                        }
                                                        className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium transition-colors shrink-0"
                                                    >
                                                        Edit
                                                    </Link>
                                                    <button
                                                        onClick={() => handleRunBacktest(strat.id)}
                                                        disabled={actionLoading === `backtest-${strat.id}`}
                                                        className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium transition-colors inline-flex items-center gap-1 shrink-0"
                                                    >
                                                        <BarChart3 className={`h-3 w-3 ${actionLoading === `backtest-${strat.id}` ? "animate-spin" : ""}`} />
                                                        {actionLoading === `backtest-${strat.id}` ? "Testing..." : "Backtest"}
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger
                                                            render={
                                                                <button
                                                                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium transition-colors"
                                                                    title="More actions"
                                                                />
                                                            }
                                                        >
                                                            <MoreHorizontal className="h-3 w-3" />
                                                            <span className="hidden sm:inline">More</span>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="min-w-[140px]">
                                                            <DropdownMenuItem
                                                                onClick={() => handleRename(strat.id, strat.name)}
                                                                disabled={actionLoading === `rename-${strat.id}`}
                                                            >
                                                                Rename
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleDuplicate(strat.id)}
                                                                disabled={actionLoading === `dup-${strat.id}`}
                                                            >
                                                                Duplicate
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                onClick={() => handleDeleteStrategy(strat.id)}
                                                                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                                            >
                                                                Delete
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                    <button
                                                        onClick={() => {
                                                            setSelectedStrategyId(strat.id);
                                                            setDeployModalOpen(true);
                                                        }}
                                                        className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors shrink-0"
                                                    >
                                                        Deploy
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Deploy Modal */}
                {deployModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="bg-card border border-border rounded-xl w-full max-w-md p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
                            <div>
                                <h3 className="text-lg font-bold">Deploy Bot to MT5 Runtime</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Configures position isolation via dedicated Magic Number and Execution Gate policy.
                                </p>
                            </div>

                            <div className="space-y-4 text-sm">
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                                        Select Strategy
                                    </label>
                                    <select
                                        value={selectedStrategyId}
                                        onChange={(e) => setSelectedStrategyId(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                                    >
                                        {strategies.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name} ({s.definition.asset} {s.definition.timeframes.entry})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                                        Account Environment
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setAccountMode("demo")}
                                            className={`py-2 px-3 rounded-lg border text-xs font-semibold text-center transition-colors ${
                                                accountMode === "demo"
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            Demo / Paper Trading
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAccountMode("live")}
                                            className={`py-2 px-3 rounded-lg border text-xs font-semibold text-center transition-colors ${
                                                accountMode === "live"
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            Live Broker Account
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                                        MT5 Connected Account
                                    </label>
                                    <input
                                        type="text"
                                        value={mt5Account}
                                        onChange={(e) => setMt5Account(e.target.value)}
                                        placeholder="e.g. gateway_12345 or default"
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                                    />
                                    <span className="text-[11px] text-muted-foreground mt-1 block">
                                        Target MT5 account identifier registered with the Gateway EA.
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                                <button
                                    type="button"
                                    onClick={() => setDeployModalOpen(false)}
                                    className="px-4 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeploy}
                                    disabled={actionLoading === "deploying"}
                                    className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90"
                                >
                                    {actionLoading === "deploying" ? "Deploying..." : "Confirm Deployment"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Backtest Results Modal */}
                {backtestModalOpen && backtestResult && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
                        <div className="bg-card border border-border rounded-xl w-full max-w-3xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200 my-8 max-h-[90vh] flex flex-col">
                            <div className="flex items-center justify-between pb-3 border-b border-border">
                                <div className="flex items-center gap-2">
                                    <BarChart3 className="h-5 w-5 text-emerald-400" />
                                    <div>
                                        <h3 className="text-lg font-bold">Backtest Simulation Report</h3>
                                        <p className="text-xs text-muted-foreground">
                                            {backtestResult.symbol} · {backtestResult.timeframe} · {backtestResult.strategyName || "Strategy Report"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setBacktestModalOpen(false)}
                                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="overflow-y-auto space-y-5 flex-1 pr-1">
                                {/* Key Metrics Cards */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Net PnL</span>
                                        <div className={`text-xl font-bold mt-1 ${
                                            backtestResult.metrics.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                                        }`}>
                                            ${backtestResult.metrics.netProfit.toFixed(2)}
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            Return: {backtestResult.metrics.returnPct?.toFixed(2)}%
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Win Rate</span>
                                        <div className="text-xl font-bold mt-1 text-foreground">
                                            {backtestResult.metrics.winRate?.toFixed(1)}%
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            {backtestResult.metrics.longTrades + backtestResult.metrics.shortTrades} total trades
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Profit Factor</span>
                                        <div className="text-xl font-bold mt-1 text-foreground">
                                            {backtestResult.metrics.profitFactor?.toFixed(2)}
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            Exp: {backtestResult.metrics.expectancy?.toFixed(2)}
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Max Drawdown</span>
                                        <div className="text-xl font-bold mt-1 text-rose-400">
                                            {backtestResult.metrics.maxDrawdownPct?.toFixed(2)}%
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            ${backtestResult.metrics.maxDrawdownAbs?.toFixed(2)}
                                        </span>
                                    </div>
                                </div>

                                {/* Rule Diagnostics */}
                                {backtestResult.diagnostics && (
                                    <div className="p-4 rounded-xl border border-border bg-muted/10 space-y-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            Bar Diagnostics & Rule Evaluator
                                        </span>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="p-2 rounded bg-card border border-border/40">
                                                <span className="text-muted-foreground">Scanned Bars:</span>
                                                <div className="font-bold">{backtestResult.diagnostics.loopBars}</div>
                                            </div>
                                            <div className="p-2 rounded bg-card border border-border/40">
                                                <span className="text-muted-foreground">Session Bars:</span>
                                                <div className="font-bold">{backtestResult.diagnostics.sessionBars}</div>
                                            </div>
                                            <div className="p-2 rounded bg-card border border-border/40">
                                                <span className="text-muted-foreground">Regime Bars:</span>
                                                <div className="font-bold">{backtestResult.diagnostics.regimeBars}</div>
                                            </div>
                                        </div>
                                        {backtestResult.diagnostics.blockingRuleIds?.length > 0 && (
                                            <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                                                <strong>Blocking Rules Detected:</strong> {backtestResult.diagnostics.blockingRuleIds.join(", ")}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Recent Trades Snippet */}
                                <div className="space-y-2">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Executed Trades ({backtestResult.trades?.length || 0})
                                    </span>
                                    {(!backtestResult.trades || backtestResult.trades.length === 0) ? (
                                        <div className="p-4 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                                            Zero trades triggered in the tested historical window. Check indicators and threshold conditions.
                                        </div>
                                    ) : (
                                        <div className="border border-border rounded-xl overflow-hidden text-xs">
                                            <table className="w-full text-left">
                                                <thead className="bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground">
                                                    <tr>
                                                        <th className="p-2.5">Side</th>
                                                        <th className="p-2.5">Entry Price</th>
                                                        <th className="p-2.5">Exit Price</th>
                                                        <th className="p-2.5">Profit</th>
                                                        <th className="p-2.5">R Return</th>
                                                        <th className="p-2.5">Exit Reason</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                                                    {backtestResult.trades.slice(0, 8).map((t: any, idx: number) => (
                                                        <tr key={idx} className="hover:bg-muted/20">
                                                            <td className="p-2.5">
                                                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
                                                                    t.direction === "long" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                                                                }`}>
                                                                    {t.direction.toUpperCase()}
                                                                </span>
                                                            </td>
                                                            <td className="p-2.5">{t.entryPrice?.toFixed(2)}</td>
                                                            <td className="p-2.5">{t.exitPrice?.toFixed(2)}</td>
                                                            <td className={`p-2.5 font-bold ${t.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                                ${t.pnl?.toFixed(2)}
                                                            </td>
                                                            <td className="p-2.5">{t.rMultiple ? `${t.rMultiple.toFixed(2)}R` : "-"}</td>
                                                            <td className="p-2.5 text-muted-foreground font-sans text-[8px]">{t.exitReason || "manual"}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-border flex justify-end">
                                <button
                                    onClick={() => setBacktestModalOpen(false)}
                                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90"
                                >
                                    Close Report
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminShell>
    );
}
