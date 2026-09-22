"use client";

import { useState, useMemo, useEffect } from "react";
import { Sparkles, Target, Shield, BarChart3, Zap, Loader2 } from "lucide-react";
import ProGate from "@/components/subscription/ProGate";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { SupportedSymbol } from "@/lib/market-data/types";
import type {
    OptimizeParam,
    OptimizeResult,
    Strategy,
} from "@/lib/strategy-lab/types";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical optimizer wiring.
//
// The optimizer runs through the Strategy Lab engine (`POST /api/strategy-lab/
// optimize`), which backtests a structured Strategy over REAL market candles
// (Biquote) and ranks every parameter combination by a transparent composite
// score. Nothing here is simulated — if the request fails or returns no data
// the user sees the honest error.
// ─────────────────────────────────────────────────────────────────────────────

const OPTIMIZE_PARAMS: {
    param: OptimizeParam;
    label: string;
    description: string;
    min: number;
    max: number;
    step: number;
}[] = [
    { param: "slAtr", label: "Stop Loss (ATR ×)", description: "Stop loss distance as a multiple of ATR", min: 0.5, max: 4, step: 0.5 },
    { param: "tp1R", label: "TP1 (R)", description: "First target in risk-reward multiples", min: 1, max: 3, step: 0.5 },
    { param: "tp2R", label: "TP2 (R)", description: "Second target in risk-reward multiples", min: 2, max: 5, step: 0.5 },
    { param: "tp3R", label: "TP3 (R)", description: "Third target in risk-reward multiples", min: 3, max: 8, step: 1 },
    { param: "riskPercent", label: "Risk %", description: "Account risk per trade", min: 0.5, max: 3, step: 0.5 },
];

// Round to 3 decimals to keep grid values clean (floating point safe).
function snap(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function buildParamValues(min: number, max: number, step: number, cap = 30): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0 || max <= min) {
        return [];
    }
    const values: number[] = [];
    for (let v = min; v <= max + step / 2 && values.length < cap; v += step) {
        values.push(snap(v));
    }
    return values;
}

function buildOptimizerStrategy(
    symbol: SupportedSymbol,
    direction: "long" | "short",
    timeframe: string
): Strategy {
    const bullish = direction === "long";
    const tf = timeframe as Strategy["timeframes"]["setup"];
    const now = Date.now();
    return {
        id: `optimizer_${symbol}_${now}`,
        name: `${symbol} ${bullish ? "Long" : "Short"} Optimizer`,
        description: "Ad-hoc direction strategy for the account Tools optimizer — evaluated on real market candles.",
        asset: symbol,
        direction,
        timeframes: { macro: tf, structure: tf, setup: tf, entry: tf },
        regimeFilter: [],
        entryRules: [
            {
                id: `opt_trend_${now}`,
                enabled: true,
                group: "trend",
                label: `EMA structure ${bullish ? "bullish" : "bearish"}`,
                operator: "eq",
                timeframe: tf,
                value: bullish ? "bullish" : "bearish",
                groupLogic: "AND",
            },
            {
                id: `opt_momentum_${now}`,
                enabled: true,
                group: "confirmation",
                label: bullish ? "Positive momentum" : "Negative momentum",
                operator: "eq",
                timeframe: tf,
                value: bullish ? "momentum_positive" : "momentum_negative",
                groupLogic: "AND",
            },
        ],
        confirmationRules: [],
        stopLoss: { mode: "atr", atrMultiple: 1.5, levelOffset: 0, useSwing: false },
        takeProfit: {
            mode: "r",
            r1: 2,
            r2: 3,
            r3: 5,
            fixedDistance: 0,
            partialCloses: [
                { atR: 1, closePercent: 33 },
                { atR: 2, closePercent: 33 },
            ],
            moveBeAfterTp1: true,
            lockAfterTp2: true,
            trailingEnabled: false,
            trailingStopAtr: 1.5,
        },
        risk: { mode: "percent", riskPercent: 1, fixedLot: 0.01, maxPositions: 1, dailyLossLimitPct: 5, maxDrawdownPct: 20 },
        filters: {
            sessions: [],
            daysOfWeek: [1, 2, 3, 4, 5],
            volatilityMinAtrPct: 0,
            volatilityMaxAtrPct: 0,
            maxTradesPerDay: 5,
            cooldownCandles: 0,
        },
        executionModel: "next_bar_open",
        costs: { spreadPips: 2.0, commissionPerLot: 4, slippagePips: 1 },
        sourcePatternId: null,
        whyp: {
            discovered: "",
            conditionsSelected: "",
            occurrenceFrequency: "",
            historicalPerformance: "",
            weaknesses: "",
            poorRegimes: "",
            generatedByProvider: "tools-optimizer",
        },
        version: "1.0.0",
        created: now,
        updated: now,
    };
}

export function StrategyOptimizer() {
    const [user, setUser] = useState<User | null>(null);
    const [symbol, setSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [timeframe, setTimeframe] = useState("H1");
    const [direction, setDirection] = useState<"long" | "short">("long");
    const [paramKey, setParamKey] = useState<OptimizeParam>("slAtr");
    const [min, setMin] = useState("0.5");
    const [max, setMax] = useState("3");
    const [step, setStep] = useState("0.5");
    const [optimizationRunning, setOptimizationRunning] = useState(false);
    const [results, setResults] = useState<OptimizeResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, setUser);
        return () => unsubscribe();
    }, []);

    const activeParam = OPTIMIZE_PARAMS.find((p) => p.param === paramKey) ?? OPTIMIZE_PARAMS[0];

    const selectParam = (key: OptimizeParam) => {
        const meta = OPTIMIZE_PARAMS.find((p) => p.param === key);
        setParamKey(key);
        setResults(null);
        setError(null);
        if (meta) {
            setMin(String(meta.min));
            setMax(String(meta.max));
            setStep(String(meta.step));
        }
    };

    const values = useMemo(
        () => buildParamValues(Number(min), Number(max), Number(step)),
        [min, max, step]
    );

    const runOptimization = async () => {
        if (!user) return;
        setError(null);
        setResults(null);
        if (values.length < 2) {
            setError("Enter a valid range with at least 2 values (min < max, step > 0).");
            return;
        }
        setOptimizationRunning(true);
        try {
            const token = await user.getIdToken();
            const strategy = buildOptimizerStrategy(symbol, direction, timeframe);
            const res = await fetch("/api/strategy-lab/optimize", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                cache: "no-store",
                body: JSON.stringify({
                    symbol,
                    strategy,
                    timeframe,
                    ranges: [{ param: paramKey, values }],
                    maxRuns: values.length,
                }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                optimization?: { results: OptimizeResult[]; best: OptimizeResult | null; worst: OptimizeResult | null; symbol: SupportedSymbol };
                error?: string;
            };
            if (!res.ok || !data?.optimization?.results?.length) {
                setError(data?.error ?? "Optimization failed — no results returned.");
                return;
            }
            setResults(data.optimization.results);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Optimization failed");
        } finally {
            setOptimizationRunning(false);
        }
    };

    const best = results?.[0] ?? null;

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="flex items-center gap-2 font-semibold">
                        <Sparkles size={16} className="text-violet-400" />
                        Strategy Optimizer
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Grid-search backed by real market-data backtests (Strategy Lab engine)
                    </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <BarChart3 size={16} />
                        <span>{symbol}</span>
                        <span className="text-xs">·</span>
                        <span>{timeframe}</span>
                        <span className="text-xs">·</span>
                        <span>{direction === "long" ? "Long" : "Short"}</span>
                    </div>
                </div>
                <div className="rounded-2xl border border-violet-500/25 bg-violet-500/10 p-5">
                    <div className="flex items-center gap-2 text-sm text-violet-300">
                        <Zap size={16} />
                        <span>Pro Feature</span>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="font-semibold mb-4">Configuration</h3>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-muted-foreground">Symbol</label>
                                <select value={symbol} onChange={(e) => { setSymbol(e.target.value as SupportedSymbol); setResults(null); setError(null); }} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                    <option value="EURUSD">EUR/USD</option>
                                    <option value="GBPUSD">GBP/USD</option>
                                    <option value="XAUUSD">XAU/USD</option>
                                    <option value="BTCUSD">BTC/USD</option>
                                    <option value="ETHUSD">ETH/USD</option>
                                    <option value="US30">US30</option>
                                </select>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-muted-foreground">Timeframe</label>
                                <select value={timeframe} onChange={(e) => { setTimeframe(e.target.value); setResults(null); setError(null); }} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                    <option value="M5">M5</option>
                                    <option value="M15">M15</option>
                                    <option value="M30">M30</option>
                                    <option value="H1">H1</option>
                                    <option value="H4">H4</option>
                                    <option value="D1">D1</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">Direction</label>
                            <div className="grid grid-cols-2 gap-2">
                                {(["long", "short"] as const).map((d) => (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={() => { setDirection(d); setResults(null); setError(null); }}
                                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                                            direction === d
                                                ? d === "long"
                                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                                    : "border-rose-500/40 bg-rose-500/10 text-rose-400"
                                                : "border-border bg-muted text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {d === "long" ? "Long (Bullish)" : "Short (Bearish)"}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-muted-foreground">Optimize Parameter</label>
                            <select value={paramKey} onChange={(e) => selectParam(e.target.value as OptimizeParam)} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                {OPTIMIZE_PARAMS.map((p) => (
                                    <option key={p.param} value={p.param}>{p.label}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-[11px] text-muted-foreground">{activeParam.description}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-muted-foreground">Min</label>
                                <input type="number" step={activeParam.step} value={min} onChange={(e) => setMin(e.target.value)} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-muted-foreground">Max</label>
                                <input type="number" step={activeParam.step} value={max} onChange={(e) => setMax(e.target.value)} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-muted-foreground">Step</label>
                                <input type="number" step="0.1" value={step} onChange={(e) => setStep(e.target.value)} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                            </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            {values.length > 0
                                ? `Grid: ${values.length} combination${values.length === 1 ? "" : "s"} (${values[0]} → ${values[values.length - 1]}).`
                                : "Invalid range — the grid is empty."}{" "}
                            Each point is a full backtest on real OHLC data.
                        </p>
                        <button
                            onClick={runOptimization}
                            disabled={optimizationRunning || !user}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-violet-500 disabled:opacity-50"
                        >
                            {optimizationRunning ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Running backtest grid...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    Run AI Optimization
                                </>
                            )}
                        </button>
                        {!user && (
                            <p className="text-center text-[11px] text-muted-foreground">Sign in to run optimizations.</p>
                        )}
                        {error && (
                            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-300">
                                {error}
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="font-semibold mb-4">Optimization Results</h3>
                    {results === null ? (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                            Run optimization to see results
                        </div>
                    ) : results.length === 0 ? (
                        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                            No tradable parameter combinations found in this range.
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1">
                            {results.slice(0, 12).map((result, i) => {
                                const comboValue = result.config?.[paramKey];
                                const bestValue = best?.score ?? 0;
                                const pct = result.score !== undefined && bestValue > 0
                                    ? (result.score / bestValue) * 100
                                    : 100;
                                return (
                                    <div
                                        key={i}
                                        className={`rounded-xl border p-3 ${i === 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/30"}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium">{activeParam.label} = {String(comboValue ?? "—")}</span>
                                            <span className="flex items-center gap-1.5">
                                                {i === 0 && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-foreground">BEST</span>}
                                                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">score {result.score?.toFixed(1) ?? "—"}</span>
                                            </span>
                                        </div>
                                        {bestValue > 0 && (
                                            <div className="mt-1.5 h-1 w-full rounded-full bg-muted">
                                                <div className="h-1 rounded-full bg-violet-500/80" style={{ width: `${pct}%` }} />
                                            </div>
                                        )}
                                        <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                                            <div>
                                                <p className="text-muted-foreground">Win Rate</p>
                                                <p className="font-semibold">{result.metrics?.winRate?.toFixed(1) ?? "—"}%</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground">Profit Factor</p>
                                                <p className="font-semibold">{Number.isFinite(result.metrics?.profitFactor) ? result.metrics.profitFactor.toFixed(2) : "—"}</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground">Net P/L</p>
                                                <p className={`font-semibold ${(result.metrics?.netProfit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                    {result.metrics?.netProfit !== undefined ? (result.metrics.netProfit >= 0 ? "+" : "") + `${result.metrics.netProfit.toFixed(0)}` : "—"}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground">Max DD</p>
                                                <p className="font-semibold">{result.metrics?.maxDrawdownPct?.toFixed(1) ?? "—"}%</p>
                                            </div>
                                        </div>
                                        {result.metrics?.totalTrades !== undefined && (
                                            <p className="mt-2 text-[10px] text-muted-foreground">
                                                {result.metrics.totalTrades} trades · return {result.metrics.returnPct?.toFixed(1) ?? "—"}% · expectancy {result.metrics.expectancyR?.toFixed(2) ?? "—"}R
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {best && (
                <ProGate>
                    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6">
                        <h3 className="flex items-center gap-2 font-semibold text-violet-300">
                            <Target size={18} />
                            Recommended Strategy Configuration
                        </h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Best parameters found by the backtest grid for {symbol} {timeframe}{" "}
                            ({direction === "long" ? "long" : "short"}): {activeParam.label} = {String(best.config?.[paramKey] ?? "—")} —{" "}
                            win rate {best.metrics?.winRate?.toFixed(1) ?? "—"}%, profit factor{" "}
                            {Number.isFinite(best.metrics?.profitFactor) ? best.metrics.profitFactor.toFixed(2) : "—"} over{" "}
                            {best.metrics?.totalTrades ?? 0} trades.
                        </p>
                        <button className="mt-4 flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-violet-500">
                            <Zap size={14} />
                            Apply to Strategy
                        </button>
                    </div>
                </ProGate>
            )}
        </div>
    );
}

export function RiskManager() {
    const [accountSize, setAccountSize] = useState(10000);
    const [riskPerTrade, setRiskPerTrade] = useState(1);
    const [maxDailyLoss, setMaxDailyLoss] = useState(5);
    const [maxDrawdown, setMaxDrawdown] = useState(10);

    const riskMetrics = useMemo(() => {
        const riskPerTradeAmount = accountSize * (riskPerTrade / 100);
        const maxDailyLossAmount = accountSize * (maxDailyLoss / 100);
        const maxDrawdownAmount = accountSize * (maxDrawdown / 100);
        const maxTradesPerDay = Math.floor(maxDailyLossAmount / riskPerTradeAmount);
        const positionSize = riskPerTradeAmount / (20 * 10);

        return {
            riskPerTradeAmount,
            maxDailyLossAmount,
            maxDrawdownAmount,
            maxTradesPerDay,
            positionSize,
            riskRewardRatio: maxDrawdown / riskPerTrade,
            safetyScore: Math.max(0, 100 - (maxDailyLoss + maxDrawdown)),
        };
    }, [accountSize, riskPerTrade, maxDailyLoss, maxDrawdown]);

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
                <Shield size={20} className="text-emerald-400" />
                Risk Manager (Pro)
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-5">
                    <h4 className="font-semibold mb-4">Risk Parameters</h4>
                    <div className="space-y-4">
                        <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Account Size ($)</label>
                            <input type="number" value={accountSize} onChange={(e) => setAccountSize(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Risk Per Trade (%)</label>
                            <input type="number" step="0.1" value={riskPerTrade} onChange={(e) => setRiskPerTrade(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Max Daily Loss (%)</label>
                            <input type="number" step="0.1" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Max Drawdown (%)</label>
                            <input type="number" step="0.1" value={maxDrawdown} onChange={(e) => setMaxDrawdown(Number(e.target.value))} className="w-full rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none" />
                        </div>
                    </div>
                </div>
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
                    <h4 className="font-semibold mb-4">Risk Metrics</h4>
                    <div className="grid gap-3">
                        <div className="rounded-lg bg-muted/30 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Risk per Trade</p>
                            <p className="text-xl font-bold text-emerald-400">${riskMetrics.riskPerTradeAmount.toFixed(2)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Max Daily Loss</p>
                            <p className="text-xl font-bold text-amber-400">${riskMetrics.maxDailyLossAmount.toFixed(2)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Max Trades/Day</p>
                            <p className="text-xl font-bold text-foreground">{riskMetrics.maxTradesPerDay}</p>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Position Size</p>
                            <p className="text-xl font-bold text-foreground">{riskMetrics.positionSize.toFixed(2)} lots</p>
                        </div>
                        <div className="rounded-lg bg-emerald-500/10 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Safety Score</p>
                            <p className={`text-xl font-bold ${riskMetrics.safetyScore > 70 ? "text-emerald-400" : "text-amber-400"}`}>
                                {riskMetrics.safetyScore}/100
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}