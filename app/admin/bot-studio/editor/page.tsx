"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Code2,
    Play,
    Save,
    ArrowLeft,
    CheckCircle2,
    AlertCircle,
    Info,
    RefreshCw,
    Terminal,
    Sparkles,
    Zap,
    Copy,
    BarChart3,
    X,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import type { Strategy } from "@/lib/strategy-lab/types";
import type { CompilerDiagnostic } from "@/lib/bot-studio/compiler/types";

const STARTER_AVSCRIPT = `// AlgoVault Bot Studio — AvScript Strategy
// Executed deterministically by StrategyEngine + AI Execution Gate

strategy({
    name: "EMA Trend Crossover",
    symbol: "EURUSD",
    timeframe: "H1",
    direction: "long",
    description: "EMA 20/50 golden cross entry with ATR stop loss and 1:2 R:R"
});

// 1. Indicators
const fast = indicators.ema(close, 20);
const slow = indicators.ema(slow, 50);
const rsiValue = indicators.rsi(close, 14);

// 2. Conditions & Entry Rules
// Golden Cross (fast crosses above slow) and RSI filter
crossesAbove(fast, slow);
rsiValue < 70;

// 3. Execution & Risk Parameters
enterLong({
    riskPercent: 1.0,
    stopLoss: {
        type: "atr",
        period: 14,
        multiplier: 2.0
    },
    takeProfit: {
        type: "riskReward",
        ratio: 2.0
    }
});
`;

export default function AvScriptEditorPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const strategyId = searchParams.get("id");

    const [source, setSource] = useState(STARTER_AVSCRIPT);
    const [strategyName, setStrategyName] = useState("EMA Trend Crossover");
    const [compiling, setCompiling] = useState(false);
    const [saving, setSaving] = useState(false);
    const [backtesting, setBacktesting] = useState(false);
    const [backtestResult, setBacktestResult] = useState<any>(null);
    const [backtestModalOpen, setBacktestModalOpen] = useState(false);
    const [compiledStrategy, setCompiledStrategy] = useState<Strategy | null>(null);
    const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
    const [compileError, setCompileError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const user = auth.currentUser;
        if (!user) return {};
        const token = await user.getIdToken();
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        };
    }, []);

    // If strategyId provided, load existing
    useEffect(() => {
        if (!strategyId) return;
        (async () => {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.strategy) {
                        setStrategyName(data.strategy.name);
                        if (data.strategy.source?.kind === "avscript") {
                            setSource(data.strategy.source.source);
                        }
                        if (data.strategy.definition) {
                            setCompiledStrategy(data.strategy.definition);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to load strategy:", e);
            }
        })();
    }, [strategyId, getAuthHeaders]);

    const handleCompile = useCallback(async () => {
        setCompiling(true);
        setCompileError(null);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/bot-studio/compile/avscript", {
                method: "POST",
                headers,
                body: JSON.stringify({ source }),
            });
            const data = await res.json();
            if (data.ok) {
                setCompiledStrategy(data.value);
                setDiagnostics(data.diagnostics || []);
            } else {
                setCompiledStrategy(null);
                setDiagnostics(data.diagnostics || []);
                setCompileError(data.error || "Compilation returned errors.");
            }
        } catch (e) {
            setCompileError(e instanceof Error ? e.message : "Compilation failed");
        } finally {
            setCompiling(false);
        }
    }, [source, getAuthHeaders]);

    // Auto compile on first load
    useEffect(() => {
        handleCompile();
    }, [handleCompile]);

    const handleSave = async (): Promise<string | null> => {
        if (!compiledStrategy) {
            await handleCompile();
        }
        setSaving(true);
        setSaveSuccess(false);
        try {
            const headers = await getAuthHeaders();
            // Re-compile to be certain we have the latest version
            const compRes = await fetch("/api/bot-studio/compile/avscript", {
                method: "POST",
                headers,
                body: JSON.stringify({ source }),
            });
            const compData = await compRes.json();
            if (!compData.ok || !compData.value) {
                alert(`Cannot save: compiler errors exist.\n${compData.diagnostics?.map((d: any) => d.message).join("\n")}`);
                return null;
            }

            const res = await fetch("/api/bot-studio/strategies", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    id: strategyId || undefined,
                    name: strategyName,
                    sourceType: "avscript",
                    avScriptSource: source,
                    canonicalStrategy: compData.value,
                }),
            });
            const data = await res.json();
            if (data.ok) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 3000);
                if (!strategyId) {
                    router.push(`/admin/bot-studio/editor?id=${data.strategy.id}`);
                }
                return data.strategy.id;
            } else {
                alert(`Failed to save: ${data.error}`);
                return null;
            }
        } catch (e) {
            alert(`Error saving strategy: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        } finally {
            setSaving(false);
        }
    };

    const handleBacktest = async () => {
        let targetId = strategyId;
        if (!targetId) {
            targetId = await handleSave();
            if (!targetId) return;
        }
        setBacktesting(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${targetId}/backtest`, {
                method: "POST",
                headers,
                body: JSON.stringify({ period: "1Y" }),
            });
            const data = await res.json();
            if (data.ok) {
                setBacktestResult(data.backtest);
                setBacktestModalOpen(true);
            } else {
                alert(`Backtest failed: ${data.error}`);
            }
        } catch (e) {
            alert(`Backtest error: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBacktesting(false);
        }
    };

    return (
        <AdminShell title="AvScript Strategy Editor">
            <div className="p-6 max-w-7xl mx-auto space-y-5">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin/bot-studio"
                            className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground transition"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                        <div>
                            <div className="flex items-center gap-2">
                                <Code2 className="h-5 w-5 text-purple-400" />
                                <input
                                    type="text"
                                    value={strategyName}
                                    onChange={(e) => setStrategyName(e.target.value)}
                                    placeholder="Strategy Name"
                                    className="text-xl font-bold bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-1"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                AvScript DSL Compiler & Canonical Strategy Generator
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCompile}
                            disabled={compiling}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted text-sm font-medium transition"
                        >
                            <RefreshCw className={`h-4 w-4 ${compiling ? "animate-spin" : ""}`} />
                            Compile
                        </button>
                        <button
                            onClick={handleBacktest}
                            disabled={backtesting || compiling}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition"
                        >
                            <BarChart3 className={`h-4 w-4 ${backtesting ? "animate-spin" : ""}`} />
                            {backtesting ? "Backtesting..." : "Run Backtest"}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition ${
                                saveSuccess
                                    ? "bg-emerald-600 text-white"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                            }`}
                        >
                            {saveSuccess ? (
                                <>
                                    <CheckCircle2 className="h-4 w-4" />
                                    Saved!
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4" />
                                    {saving ? "Saving..." : "Save Strategy"}
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Editor & Diagnostics Split View */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[600px]">
                    {/* Left: Code Editor */}
                    <div className="lg:col-span-7 flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                        <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center justify-between text-xs font-mono text-muted-foreground">
                            <span>AvScript Source Code</span>
                            <span>DSL v1.0</span>
                        </div>
                        <div className="flex-1 p-3 font-mono text-xs">
                            <textarea
                                value={source}
                                onChange={(e) => setSource(e.target.value)}
                                spellCheck={false}
                                className="w-full h-full min-h-[500px] bg-transparent resize-none focus:outline-none font-mono text-xs leading-relaxed text-foreground"
                            />
                        </div>
                    </div>

                    {/* Right: Compiler Output & Canonical Strategy View */}
                    <div className="lg:col-span-5 flex flex-col space-y-4">
                        {/* Diagnostics Banner */}
                        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Compiler Status
                                </span>
                                <span
                                    className={`text-xs px-2 py-0.5 rounded font-semibold ${
                                        compiledStrategy
                                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                            : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                                    }`}
                                >
                                    {compiledStrategy ? "Compilation Succeeded" : "Errors Detected"}
                                </span>
                            </div>

                            {compileError && (
                                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                    <div>{compileError}</div>
                                </div>
                            )}

                            {diagnostics.length > 0 && (
                                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                    {diagnostics.map((d, i) => (
                                        <div
                                            key={i}
                                            className={`p-2 rounded text-xs flex items-start gap-2 ${
                                                d.severity === "error"
                                                    ? "bg-destructive/10 text-destructive"
                                                    : "bg-amber-500/10 text-amber-500"
                                            }`}
                                        >
                                            {d.severity === "error" ? (
                                                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                            ) : (
                                                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                            )}
                                            <span>{d.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Compiled Canonical Strategy Details */}
                        {compiledStrategy && (
                            <div className="rounded-xl border border-border bg-card p-4 space-y-4 flex-1">
                                <div className="flex items-center justify-between border-b border-border pb-2">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Canonical Strategy Preview
                                    </span>
                                    <span className="text-xs font-mono text-emerald-500">
                                        {compiledStrategy.asset} • {compiledStrategy.timeframes.entry}
                                    </span>
                                </div>

                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between py-1 border-b border-border/50">
                                        <span className="text-muted-foreground">Execution Model</span>
                                        <span className="font-mono font-semibold">{compiledStrategy.executionModel}</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-border/50">
                                        <span className="text-muted-foreground">Risk per Trade</span>
                                        <span className="font-semibold">{compiledStrategy.risk.riskPercent}%</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-border/50">
                                        <span className="text-muted-foreground">Stop Loss Mode</span>
                                        <span className="font-semibold">{compiledStrategy.stopLoss.mode} (x{compiledStrategy.stopLoss.atrMultiple})</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-border/50">
                                        <span className="text-muted-foreground">Take Profit Mode</span>
                                        <span className="font-semibold">R:R (1:{compiledStrategy.takeProfit.r1})</span>
                                    </div>
                                </div>

                                <div>
                                    <span className="text-xs font-semibold text-muted-foreground block mb-1.5">
                                        Entry Rules ({compiledStrategy.entryRules.length})
                                    </span>
                                    <div className="space-y-1.5">
                                        {compiledStrategy.entryRules.map((r, i) => (
                                            <div key={i} className="p-2 rounded bg-muted/60 text-xs font-mono">
                                                {r.label || `${r.group} (${r.operator})`}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <span className="text-[11px] text-muted-foreground">
                                        Compiled strategies run deterministically in the StrategyEngine and pass through the AI Execution Gate before broker submission.
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Backtest Results Modal */}
                {backtestModalOpen && backtestResult && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
                        <div className="bg-card border border-border rounded-2xl w-full max-w-3xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200 my-8 max-h-[90vh] flex flex-col">
                            <div className="flex items-center justify-between pb-3 border-b border-border">
                                <div className="flex items-center gap-2">
                                    <BarChart3 className="h-5 w-5 text-emerald-400" />
                                    <div>
                                        <h3 className="text-lg font-bold">Backtest Simulation Report</h3>
                                        <p className="text-xs text-muted-foreground">
                                            {backtestResult.symbol} · {backtestResult.timeframe} · {backtestResult.strategyName || strategyName}
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
                                        <span className="text-[10px] text-muted-foreground">
                                            Return: {backtestResult.metrics.returnPct?.toFixed(2)}%
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Win Rate</span>
                                        <div className="text-xl font-bold mt-1 text-foreground">
                                            {backtestResult.metrics.winRate?.toFixed(1)}%
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">
                                            {backtestResult.metrics.longTrades + backtestResult.metrics.shortTrades} total trades
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Profit Factor</span>
                                        <div className="text-xl font-bold mt-1 text-foreground">
                                            {backtestResult.metrics.profitFactor?.toFixed(2)}
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">
                                            Exp: {backtestResult.metrics.expectancy?.toFixed(2)}
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Max Drawdown</span>
                                        <div className="text-xl font-bold mt-1 text-rose-400">
                                            {backtestResult.metrics.maxDrawdownPct?.toFixed(2)}%
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">
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
                                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
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
                                                            <td className="p-2.5 text-muted-foreground font-sans text-[10px]">{t.exitReason || "manual"}</td>
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
                                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
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
