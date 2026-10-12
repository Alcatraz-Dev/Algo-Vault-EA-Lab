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

    const handleSave = async () => {
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
                return;
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
            } else {
                alert(`Failed to save: ${data.error}`);
            }
        } catch (e) {
            alert(`Error saving strategy: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setSaving(false);
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
            </div>
        </AdminShell>
    );
}
