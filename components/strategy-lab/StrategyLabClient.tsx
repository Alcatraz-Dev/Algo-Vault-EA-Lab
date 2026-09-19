"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
    ArrowDownRight,
    ArrowUpRight,
    BarChart3,
    CheckCircle2,
    CircleAlert,
    Cpu,
    Download,
    FileCode2,
    FileSearch,
    FlaskConical,
    Gauge,
    Layers,
    LineChart as LineChartIcon,
    Loader2,
    Play,
    RefreshCw,
    Rocket,
    ShieldCheck,
    Sparkles,
    Store,
    TrendingUp,
    Trash2,
    Wand2,
} from "lucide-react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";

import { strategyLabApi } from "@/lib/strategy-lab/client-api";
import type { AnalysisApiResponse } from "@/lib/strategy-lab/client-api";
import { SUPPORTED_SYMBOLS, Timeframe } from "@/lib/market-data/types";
import {
    DEFAULT_HIERARCHY,
    AnalysisPeriod,
    BacktestResult,
    Deployment,
    ForwardTest,
    MarketAnalysisSet,
    OptimizationOutcome,
    OptimizeResult,
    Pattern,
    RobustnessScore,
    Strategy,
    TimeframeHierarchy,
    ValidationOutcome,
} from "@/lib/strategy-lab/types";

const SYMBOLS = [...SUPPORTED_SYMBOLS] as const;
const PERIODS: AnalysisPeriod[] = ["1M", "3M", "6M", "1Y"];
const TIMEFRAME_LABEL: Record<Timeframe, string> = {
    M1: "M1", M3: "M3", M5: "M5", M15: "M15", M30: "M30",
    H1: "H1", H4: "H4", D1: "D1",
};
// Keep the set of TFs we surface in the UI (biquote-supported for the chosen periods).
const UI_TFS: Timeframe[] = ["M5", "M15", "H1", "H4", "D1"];

type Lab = {
    token: string | null;
    symbol: (typeof SYMBOLS)[number];
    setSymbol: (s: (typeof SYMBOLS)[number]) => void;
    period: AnalysisPeriod;
    setPeriod: (p: AnalysisPeriod) => void;
    hierarchy: TimeframeHierarchy;
    setHierarchy: (h: TimeframeHierarchy) => void;
    patternTf: Timeframe;
    setPatternTf: (t: Timeframe) => void;

    analysis: MarketAnalysisSet | null;
    aiSummary: AnalysisApiResponse["aiSummary"];
    analysisBusy: boolean;

    patterns: Pattern[];
    patternsBusy: boolean;
    selectedPattern: Pattern | null;
    setSelectedPattern: (p: Pattern | null) => void;

    strategies: Strategy[];
    strategiesBusy: boolean;
    selectedStrategy: Strategy | null;
    setSelectedStrategy: (s: Strategy | null) => void;

    backtest: BacktestResult | null;
    backtestBusy: boolean;

    optimization: OptimizationOutcome | null;
    optimizeBusy: boolean;

    validation: ValidationOutcome | null;
    robustness: RobustnessScore | null;
    validateBusy: boolean;

    forwardTest: ForwardTest | null;
    deployments: Deployment[];
    deployBusy: boolean;
    setForwardTest: (ft: ForwardTest | null) => void;

    eas: EAView[];
    easBusy: boolean;
    selectedEA: EAView | null;
    setSelectedEA: (ea: EAView | null) => void;

    error: string | null;
    setError: (e: string | null) => void;
    running: boolean;
    setRunning: (r: boolean) => void;
};

/** Client-side projection of a generated MT5 EA (see ea-storage toEAView). */
type EAView = {
    eaId: string;
    strategyId: string;
    strategyVersion: string;
    strategyHash?: string;
    name: string;
    symbol: string;
    timeframe: string;
    magicNumber: number;
    generatorVersion?: string;
    sourceAvailable?: boolean;
    compiled: boolean;
    codeAvailable?: boolean;
    code?: string;
    createdAt: number;
    updatedAt: number;
    eaVersion?: string;
    executionModel?: string;
    configurationHash?: string;
    compileReport?: {
        compiled: boolean;
        errors: string[];
        warnings: string[];
        compilerOutput?: string;
        compiledAt?: number;
        method?: "metaeditor" | "static";
    } | null;
    parity?: {
        summary?: string;
        items?: Array<{ severity: "info" | "warning" | "divergence"; message: string }>;
        caveats?: string[];
    } | null;
    gateway?: { botId?: string; productId?: string | null; magicNumber?: string; symbol?: string; registeredAt?: number } | null;
    marketplace?: { productId?: string; status?: string; version?: string; fileName?: string; publishedAt?: number } | null;
    marketplaceProductId?: string | null;
};

const fmt = (n: number | undefined | null, digits = 2) =>
    n === undefined || n === null || Number.isNaN(n) ? "–" : (n as number).toFixed(digits);
const fmtPct = (n: number | undefined | null) => (n === undefined || n === null ? "–" : `${(n as number).toFixed(2)}%`);
const fmtUsd = (n: number | undefined | null) =>
    n === undefined || n === null ? "–" : `${(n as number) >= 0 ? "+" : ""}$${(n as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function Stat({ label, value, tone = "text-foreground" }: { label: string; value: React.ReactNode; tone?: string }) {
    return (
        <div className="rounded-xl border border-border/20 bg-background/50 p-4">
            <div className="text-[11px] uppercase tracking-widest text-foreground/70">{label}</div>
            <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
        </div>
    );
}

function ErrorBanner({ error, onClose }: { error: string | null; onClose: () => void }) {
    if (!error) return null;
    return (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">{error}</div>
            <button className="text-red-300 hover:text-foreground" onClick={onClose} aria-label="Dismiss">×</button>
        </div>
    );
}

function Btn({
    children, onClick, busy, disabled, variant = "primary", className = "",
}: {
    children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean;
    variant?: "primary" | "ghost" | "danger"; className?: string;
}) {
    const base =
        variant === "primary"
            ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
            : variant === "danger"
                ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "border-border/20 bg-foreground/10 text-foreground/70 hover:bg-background/20";
    return (
        <button
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${base} ${className}`}
            onClick={onClick}
            disabled={busy || disabled}
        >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {children}
        </button>
    );
}

function TabBtn({ active, icon: Icon, label, onClick }: { active: boolean; icon: React.ElementType; label: string; onClick: () => void }) {
    return (
        <button
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                active ? "border-amber-500/50 bg-amber-500/10 text-amber-300" : "border-border/20 bg-foreground/10 text-muted-foreground hover:bg-background/20 hover:text-foreground"
            }`}
            onClick={onClick}
        >
            <Icon className="h-4 w-4" />
            {label}
        </button>
    );
}

export function StrategyLabClient() {
    const [token, setToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [tab, setTab] = useState<"market" | "patterns" | "strategy" | "backtest" | "optimize" | "validate" | "deploy" | "ea">("market");

    const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("XAUUSD");
    const [period, setPeriod] = useState<AnalysisPeriod>("1M");
    const [hierarchy, setHierarchy] = useState<TimeframeHierarchy>({ ...DEFAULT_HIERARCHY });
    const [patternTf, setPatternTf] = useState<Timeframe>("M15");

    const [analysis, setAnalysis] = useState<MarketAnalysisSet | null>(null);
    const [aiSummary, setAiSummary] = useState<AnalysisApiResponse["aiSummary"]>(null);
    const [analysisBusy, setAnalysisBusy] = useState(false);

    const [patterns, setPatterns] = useState<Pattern[]>([]);
    const [patternsBusy, setPatternsBusy] = useState(false);
    const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);

    const [strategies, setStrategies] = useState<Strategy[]>([]);
    const [strategiesBusy, setStrategiesBusy] = useState(false);
    const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);

    const [backtest, setBacktest] = useState<BacktestResult | null>(null);
    const [backtestBusy, setBacktestBusy] = useState(false);

    const [optimization, setOptimization] = useState<OptimizationOutcome | null>(null);
    const [optimizeBusy, setOptimizeBusy] = useState(false);

    const [validation, setValidation] = useState<ValidationOutcome | null>(null);
    const [robustness, setRobustness] = useState<RobustnessScore | null>(null);
    const [validateBusy, setValidateBusy] = useState(false);

    const [deployments, setDeployments] = useState<Deployment[]>([]);
    const [forwardTest, setForwardTest] = useState<ForwardTest | null>(null);
    const [deployBusy, setDeployBusy] = useState(false);

    const [eas, setEAs] = useState<EAView[]>([]);
    const [easBusy, setEAsBusy] = useState(false);
    const [selectedEA, setSelectedEA] = useState<EAView | null>(null);

    const loadStrategies = useCallback(async (t: string) => {
        try {
            const res = await strategyLabApi.listStrategies(t);
            setStrategies(res.strategies);
            if (res.strategies.length > 0) {
                setSelectedStrategy((prev) => prev ?? res.strategies[0]);
            }
        } catch {
            // loaded later
        }
    }, []);

    const loadDeployments = useCallback(async (t: string) => {
        try {
            const res = await strategyLabApi.listDeployments(t);
            setDeployments(res.deployments);
        } catch {
            // non-fatal
        }
    }, []);

    const loadEAs = useCallback(async (t: string) => {
        try {
            const res = await strategyLabApi.listEAs(t);
            setEAs(res.eas as EAView[]);
            setSelectedEA((prev) => {
                if (prev) {
                    const fresh = (res.eas as EAView[]).find((e) => e.eaId === prev.eaId);
                    return fresh ?? prev;
                }
                return prev;
            });
        } catch {
            // non-fatal
        }
    }, []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const t = await user.getIdToken();
                setToken(t);
                void loadStrategies(t);
                void loadDeployments(t);
                void loadEAs(t);
            } else {
                setToken(null);
            }
        });
        return () => unsub();
    }, [loadStrategies, loadDeployments, loadEAs]);

    const lab: Lab = {
        token, setError, setRunning,
        symbol, setSymbol, period, setPeriod, hierarchy, setHierarchy, patternTf, setPatternTf,
        analysis, aiSummary, analysisBusy,
        patterns, patternsBusy, selectedPattern, setSelectedPattern,
        strategies, strategiesBusy, selectedStrategy, setSelectedStrategy,
        backtest, backtestBusy,
        optimization, optimizeBusy,
        validation, robustness, validateBusy,
        forwardTest, deployments, deployBusy, setForwardTest,
        eas, easBusy, selectedEA, setSelectedEA,
        error, running,
    };

    const run = async (fn: () => Promise<void>) => {
        if (!token) {
            setError("Please sign in to use the Strategy Lab.");
            return;
        }
        setRunning(true);
        try {
            await fn();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-400">
                        <FlaskConical className="h-4 w-4" />
                        AI STRATEGY LAB
                    </div>
                    <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Build, test &amp; deploy strategies</h1>
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                        Historical analysis, pattern discovery, AI-assisted strategy generation, backtesting, optimization,
                        validation and forward testing — with{" "}
                        <span className="text-foreground/70">no guarantee of future returns</span>.
                    </p>
                </div>
                {token && <ChipRow symbol={symbol} period={period} hierarchy={hierarchy} />}
            </div>

            <ErrorBanner error={error} onClose={() => setError(null)} />

            {!token ? (
                <div className="mt-8 rounded-2xl border border-border/20 bg-card p-10 text-center text-sm text-muted-foreground">
                    Sign in to start building strategies.
                </div>
            ) : (
                <>
                    <div className="mt-6 flex flex-wrap gap-2">
                        <TabBtn active={tab === "market"} icon={FileSearch} label="1 · Market" onClick={() => setTab("market")} />
                        <TabBtn active={tab === "patterns"} icon={Layers} label="2 · Patterns" onClick={() => setTab("patterns")} />
                        <TabBtn active={tab === "strategy"} icon={Wand2} label="3 · Strategy" onClick={() => setTab("strategy")} />
                        <TabBtn active={tab === "backtest"} icon={BarChart3} label="4 · Backtest" onClick={() => setTab("backtest")} />
                        <TabBtn active={tab === "optimize"} icon={Gauge} label="5 · Optimize" onClick={() => setTab("optimize")} />
                        <TabBtn active={tab === "validate"} icon={ShieldCheck} label="6 · Validate" onClick={() => setTab("validate")} />
                        <TabBtn active={tab === "deploy"} icon={Rocket} label="7 · Deploy" onClick={() => setTab("deploy")} />
                        <TabBtn active={tab === "ea"} icon={Cpu} label="8 · MT5 EA" onClick={() => setTab("ea")} />
                    </div>

                    <div className="mt-6">
                        {/* Market selector row — reused by several steps */}
                        <div className="mb-6 grid gap-3 rounded-2xl border border-border/20 bg-card p-4 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
                            <Field label="Symbol">
                                <select value={symbol} onChange={(e) => setSymbol(e.target.value as (typeof SYMBOLS)[number])} className={selCls}>
                                    {SYMBOLS.map((s) => <option key={s} value={s}>{s}{s === "XAUUSD" ? " (Gold)" : ""}</option>)}
                                </select>
                            </Field>
                            <Field label="Period">
                                <select value={period} onChange={(e) => setPeriod(e.target.value as AnalysisPeriod)} className={selCls}>
                                    {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </Field>
                            <Field label="Pattern TF">
                                <select value={patternTf} onChange={(e) => setPatternTf(e.target.value as Timeframe)} className={selCls}>
                                    {UI_TFS.map((t) => <option key={t} value={t}>{TIMEFRAME_LABEL[t]}</option>)}
                                </select>
                            </Field>
                        </div>

                        {tab === "market" && <MarketTab lab={lab} run={run} setAnalysis={setAnalysis} setAiSummary={setAiSummary} setAnalysisBusy={setAnalysisBusy} />}
                        {tab === "patterns" && <PatternsTab lab={lab} run={run} setPatterns={setPatterns} setPatternsBusy={setPatternsBusy} />}
                        {tab === "strategy" && <StrategyTab lab={lab} run={run} setStrategies={setStrategies} setStrategiesBusy={setStrategiesBusy} setSelected={setSelectedStrategy} />}
                        {tab === "backtest" && <BacktestTab lab={lab} run={run} setBacktest={setBacktest} setBacktestBusy={setBacktestBusy} />}
                        {tab === "optimize" && <OptimizeTab lab={lab} run={run} setOptimization={setOptimization} setOptimizeBusy={setOptimizeBusy} />}
                        {tab === "validate" && <ValidateTab lab={lab} run={run} setValidation={setValidation} setRobustness={setRobustness} setValidateBusy={setValidateBusy} />}
                        {tab === "deploy" && <DeployTab lab={lab} run={run} setDeployments={setDeployments} setDeployBusy={setDeployBusy} />}
                        {tab === "ea" && <EATab lab={lab} run={run} setEAs={setEAs} setEAsBusy={setEAsBusy} setStrategies={setStrategies} />}
                    </div>
                </>
            )}
        </div>
    );
}

const selCls =
    "rounded-xl border border-border/20 bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-amber-500/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-widest text-foreground/70">{label}</span>
            {children}
        </label>
    );
}

function ChipRow({ symbol, period, hierarchy }: { symbol: string; period: string; hierarchy: TimeframeHierarchy }) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-lg border border-border/20 bg-foreground/10 px-2.5 py-1">{symbol}</span>
            <span className="rounded-lg border border-border/20 bg-foreground/10 px-2.5 py-1">{period}</span>
            <span className="rounded-lg border border-border/20 bg-foreground/10 px-2.5 py-1">{hierarchy.macro}/{hierarchy.structure}/{hierarchy.setup}/{hierarchy.entry}</span>
        </div>
    );
}

function DirectionBadge({ dir }: { dir: "long" | "short" | "BUY" | "SELL" | "bullish" | "bearish" }) {
    const isUp = dir === "long" || dir === "BUY" || dir === "bullish";
    return (
        <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold ${
            isUp ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"
        }`}>
            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {isUp ? "Long" : "Short"}
        </span>
    );
}

// ───────────────────────────── Market Analysis ─────────────────────────────

function MarketTab({
    lab, run, setAnalysis, setAiSummary, setAnalysisBusy,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setAnalysis: (a: MarketAnalysisSet | null) => void;
    setAiSummary: (s: AnalysisApiResponse["aiSummary"]) => void;
    setAnalysisBusy: (b: boolean) => void;
}) {
    const doAnalyze = () =>
        run(async () => {
            if (!lab.token) return;
            setAnalysisBusy(true);
            try {
                const res = await strategyLabApi.analyze(lab.token, lab.symbol, lab.period, lab.hierarchy);
                setAnalysis(res.analysis ?? null);
                setAiSummary(res.aiSummary);
            } finally {
                setAnalysisBusy(false);
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    Analyzes macro → structure → setup → entry alignment, liquidity, volatility and session behavior.
                </div>
                <Btn onClick={doAnalyze} busy={lab.analysisBusy}>
                    <Sparkles className="h-4 w-4" /> Analyze Market
                </Btn>
            </div>

            {lab.analysis && (
                <div className="flex flex-col gap-6">
                    {lab.aiSummary && (
                        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-background/40 to-background p-5">
                            <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                                <Sparkles className="h-4 w-4" /> AI Summary {lab.aiSummary.generatedBy === "openai" ? "(GPT)" : "(local)"}
                            </div>
                            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/70">{lab.aiSummary.summary}</p>
                        </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {lab.analysis.byTimeframe && Object.entries(lab.analysis.byTimeframe).map(([tf, r]) => r && (
                            <div key={tf} className="rounded-2xl border border-border/20 bg-card p-4">
                                <div className="flex items-center justify-between">
                                    <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{tf}</div>
                                    <DirectionBadge dir={(r.trend?.bias ?? "neutral") as "long" | "short"} />
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                    <div><div className="text-[10px] uppercase text-foreground/70">Regime</div><div className="font-semibold text-foreground">{r.trend?.regime ?? "–"}</div></div>
                                    <div><div className="text-[10px] uppercase text-foreground/70">ATR %</div><div className="font-semibold text-foreground">{fmtPct(r.volatility?.atrPercent)}</div></div>
                                    <div><div className="text-[10px] uppercase text-foreground/70">Structure</div><div className="font-semibold text-foreground capitalize">{r.structure?.overall ?? "–"}</div></div>
                                    <div><div className="text-[10px] uppercase text-foreground/70">BOS / CHOCH</div><div className="font-semibold text-foreground">{r.structure?.bosCount ?? 0} / {r.structure?.chochCount ?? 0}</div></div>
                                    <div><div className="text-[10px] uppercase text-foreground/70">Market Score</div><div className="font-semibold text-foreground">{r.score?.total ?? "–"}/100</div></div>
                                    <div><div className="text-[10px] uppercase text-foreground/70">Sweeps</div><div className="font-semibold text-foreground">{r.liquidity?.sweeps?.length ?? 0}</div></div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-xl border border-border/20 bg-card p-4 text-sm text-muted-foreground">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/70">Cross-timeframe reads</div>
                        {lab.analysis.relationships?.length ? (
                            <ul className="flex flex-col gap-2">
                                {lab.analysis.relationships.map((rel, i) => <li key={i}>• {rel}</li>)}
                            </ul>
                        ) : (
                            <div>No cross-timeframe reads available for this period.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────── Pattern Discovery ───────────────────────────

function PatternsTab({
    lab, run, setPatterns, setPatternsBusy,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setPatterns: (p: Pattern[]) => void;
    setPatternsBusy: (b: boolean) => void;
}) {
    const discover = () =>
        run(async () => {
            if (!lab.token) return;
            setPatternsBusy(true);
            try {
                const res = await strategyLabApi.patterns(lab.token, lab.symbol, lab.period, lab.patternTf, 10);
                setPatterns(res.patterns);
                if (res.patterns.length === 0) {
                    lab.setError(`No statistically viable patterns on ${lab.symbol} ${lab.patternTf}. Try another timeframe or period.`);
                }
            } finally {
                setPatternsBusy(false);
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    Discovers recurring market structures with measured outcomes — win rate, average R, profit factor — never theoretical setups.
                </div>
                <Btn onClick={discover} busy={lab.patternsBusy}>
                    <Layers className="h-4 w-4" /> Discover Patterns
                </Btn>
            </div>

            {lab.patterns.length === 0 && !lab.patternsBusy ? (
                <div className="rounded-2xl border border-border/20 bg-card p-10 text-center text-sm text-foreground/70">
                    Run discovery on a timeframe to see statistically measured setups for {lab.symbol}.
                </div>
            ) : (
<div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-sm">
                    <thead>
                        <tr className="text-left text-[11px] uppercase tracking-widest text-foreground/70">
                            <th className="px-3 py-2">Pattern</th>
                            <th className="px-3 py-2">Direction</th>
                            <th className="px-3 py-2">Avg R</th>
                            <th className="px-3 py-2">Win Rate</th>
                            <th className="px-3 py-2">Profit Factor</th>
                            <th className="px-3 py-2">Trades</th>
                            <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(lab.patterns ?? []).map((p) => (
                            <tr key={p.id} className={`border border-border/20 bg-card ${lab.selectedPattern?.id === p.id ? "ring-1 ring-amber-500/50" : ""}`}>
                                <td className="rounded-l-xl px-3 py-3">
                                    <div className="font-semibold text-foreground">{p.name}</div>
                                    <div className="text-xs text-foreground/70">{p.kind.replace(/_/g, " ")}</div>
                                </td>
                                <td className="px-3 py-3"><DirectionBadge dir={p.direction} /></td>
                                <td className="px-3 py-3 font-semibold text-foreground">{p.stats ? fmt(p.stats.averageR, 2) : "–"}</td>
                                <td className="px-3 py-3 text-emerald-300">{p.stats ? fmtPct(p.stats.winRate) : "–"}</td>
                                <td className="px-3 py-3 text-foreground">{p.stats ? fmt(p.stats.profitFactor) : "–"}</td>
                                <td className="px-3 py-3 text-foreground/70">{p.stats ? p.stats.occurrences : p.matchCount}</td>
                                <td className="rounded-r-xl px-3 py-3 text-right">
                                    <button
                                        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
                                        onClick={() => lab.setSelectedPattern(lab.selectedPattern?.id === p.id ? null : p)}
                                    >
                                        {lab.selectedPattern?.id === p.id ? "Selected" : "Select"}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            )}

            {lab.selectedPattern && (
<div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground/70">
                <span className="font-semibold text-amber-300">{lab.selectedPattern.name}</span> selected
                ({lab.selectedPattern.stats?.occurrences ?? lab.selectedPattern.matchCount} occurrences on {lab.selectedPattern.timeframe}). Head to{" "}
                <span className="font-semibold text-foreground">Strategy</span> to generate a strategy from it.
                <div className="mt-2 text-xs text-foreground/70">Outcomes are measured on live historical data — always validate with a walk-forward test before deploying.</div>
            </div>
            )}
        </div>
    );
}

// ───────────────────────────── Strategy Generation ─────────────────────────

function StrategyTab({
    lab, run, setStrategies, setStrategiesBusy, setSelected,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setStrategies: (s: Strategy[]) => void;
    setStrategiesBusy: (b: boolean) => void;
    setSelected: (s: Strategy | null) => void;
}) {
    const [direction, setDirection] = useState<"long" | "short">("long");
    const [generating, setGenerating] = useState(false);

    const refresh = async (t: string) => {
        const res = await strategyLabApi.listStrategies(t);
        setStrategies(res.strategies);
    };

    const generate = () =>
        run(async () => {
            if (!lab.token) return;
            setGenerating(true);
            try {
                const res = await strategyLabApi.generateStrategy(lab.token, {
                    symbol: lab.symbol,
                    period: lab.period,
                    pattern: lab.selectedPattern,
                    direction: lab.selectedPattern ? undefined : direction,
                });
                setStrategiesBusy(true);
                await refresh(lab.token);
                setSelected(res.strategy);
                setStrategiesBusy(false);
                lab.setSelectedPattern(null);
            } finally {
                setGenerating(false);
            }
        });

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <h3 className="text-base font-bold text-foreground">Generate a strategy</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {lab.selectedPattern
                            ? `Based on the selected pattern: ${lab.selectedPattern.name}`
                            : "Generate from the market bias discovered in the analysis, or pick a pattern first."}
                    </p>
                    <div className="mt-4 flex items-center gap-4">
                        <div className="flex gap-2">
                            <button
                                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${direction === "long" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-border/20 bg-foreground/10 text-muted-foreground"}`}
                                onClick={() => setDirection("long")}
                                disabled={!!lab.selectedPattern}
                            >
                                Long
                            </button>
                            <button
                                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${direction === "short" ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-border/20 bg-foreground/10 text-muted-foreground"}`}
                                onClick={() => setDirection("short")}
                                disabled={!!lab.selectedPattern}
                            >
                                Short
                            </button>
                        </div>
                        <Btn onClick={generate} busy={generating}>
                            <Wand2 className="h-4 w-4" /> Generate
                        </Btn>
                    </div>
                </div>

                {lab.selectedStrategy && (
                    <StrategyDetail strategy={lab.selectedStrategy} />
                )}
            </div>

            <div className="rounded-2xl border border-border/20 bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-bold text-foreground">Saved strategies</h3>
                    <span className="text-xs text-foreground/70">{lab.strategies.length}</span>
                </div>
                <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-1">
                    {lab.strategies.length === 0 && !lab.strategiesBusy ? (
                        <div className="rounded-xl border border-dashed border-border/20 p-6 text-center text-sm text-foreground/70">
                            No strategies saved yet. Generate one on the left.
                        </div>
                    ) : (
                        lab.strategies.map((s) => (
                            <button
                                key={s.id}
                                className={`rounded-xl border p-3 text-left transition ${
                                    lab.selectedStrategy?.id === s.id ? "border-amber-500/50 bg-amber-500/10" : "border-border/20 bg-foreground/10 hover:bg-background/20"
                                }`}
                                onClick={() => setSelected(s)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate font-semibold text-foreground">{s.name}</span>
                                    <DirectionBadge dir={s.direction} />
                                </div>
                                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-foreground/70">
                                    <span>{s.asset}</span>
                                    <span>{s.timeframes.setup}</span>
                                    <span>{s.entryRules.filter((r) => r.enabled).length} entry rules</span>
                                    <span>{s.regimeFilter.join(", ") || "any regime"}</span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function RuleRow({ rule }: { rule: Strategy["entryRules"][number] }) {
    return (
        <div className="flex items-center justify-between rounded-lg border border-border/10 bg-foreground/10 px-3 py-2 text-xs">
            <div>
                <span className="font-semibold text-foreground/80">{rule.label}</span>
                {rule.timeframe && <span className="ml-2 rounded bg-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{rule.timeframe}</span>}
            </div>
            <div className="text-foreground/70">{rule.group}</div>
        </div>
    );
}

function StrategyDetail({ strategy }: { strategy: Strategy }) {
    const rr = strategy.takeProfit.r1;
    return (
        <div className="rounded-2xl border border-border/20 bg-card p-5">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="text-base font-bold text-foreground">{strategy.name}</h3>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-foreground/70">
                        <span>{strategy.asset}</span>
                        <span>{strategy.timeframes.macro}/{strategy.timeframes.structure}/{strategy.timeframes.setup}/{strategy.timeframes.entry}</span>
                        <span>SL {strategy.stopLoss.atrMultiple}×ATR</span>
                        <span>TP {rr}R</span>
                    </div>
                </div>
                <DirectionBadge dir={strategy.direction} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{strategy.description}</p>

            <div className="mt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-foreground/70">Entry rules</div>
                <div className="flex flex-col gap-1.5">
                    {(strategy.entryRules ?? []).filter((r) => r.enabled).map((r) => <RuleRow key={r.id} rule={r} />)}
                </div>
            </div>

            {(strategy.confirmationRules ?? []).some((r) => r.enabled) && (
                <div className="mt-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-foreground/70">Confirmation rules</div>
                    <div className="flex flex-col gap-1.5">
                        {(strategy.confirmationRules ?? []).filter((r) => r.enabled).map((r) => <RuleRow key={r.id} rule={r} />)}
                    </div>
                </div>
            )}

            <div className="mt-4 border-t border-border/10 pt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-foreground/70">Why this strategy</div>
                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    <div><dt className="text-foreground/70">Discovered</dt><dd className="text-foreground/70">{strategy.whyp.discovered}</dd></div>
                    <div><dt className="text-foreground/70">Conditions</dt><dd className="text-foreground/70">{strategy.whyp.conditionsSelected}</dd></div>
                    <div><dt className="text-foreground/70">Frequency</dt><dd className="text-foreground/70">{strategy.whyp.occurrenceFrequency}</dd></div>
                    <div><dt className="text-foreground/70">Historical performance</dt><dd className="text-foreground/70">{strategy.whyp.historicalPerformance}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-foreground/70">Weaknesses</dt><dd className="text-foreground/70">{strategy.whyp.weaknesses}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-foreground/70">Poor regimes</dt><dd className="text-foreground/70">{strategy.whyp.poorRegimes}</dd></div>
                </dl>
            </div>
        </div>
    );
}

// ───────────────────────────── Backtest ─────────────────────────────────

function BacktestTab({
    lab, run, setBacktest, setBacktestBusy,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setBacktest: (b: BacktestResult | null) => void;
    setBacktestBusy: (b: boolean) => void;
}) {
    const launch = () =>
        run(async () => {
            if (!lab.token) return;
            if (!lab.selectedStrategy) {
                lab.setError("Select or generate a strategy first.");
                return;
            }
            setBacktestBusy(true);
            try {
                const res = await strategyLabApi.backtest(lab.token, {
                    symbol: lab.symbol,
                    strategy: lab.selectedStrategy,
                });
                setBacktest(res.backtest);
            } finally {
                setBacktestBusy(false);
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="max-w-2xl text-sm text-muted-foreground">
                    {lab.selectedStrategy
                        ? `Backtesting ${lab.selectedStrategy.name} on ${lab.symbol} using the ${lab.selectedStrategy.timeframes.setup} timeframe.`
                        : "Select a strategy to backtest."}
                </div>
                <Btn onClick={launch} busy={lab.backtestBusy} disabled={!lab.selectedStrategy}>
                    <Play className="h-4 w-4" /> Run Backtest
                </Btn>
            </div>

            {lab.backtest && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Net profit" value={fmtUsd(lab.backtest.metrics.netProfit)} tone={lab.backtest.metrics.netProfit >= 0 ? "text-emerald-300" : "text-red-300"} />
                        <Stat label="Win rate" value={fmtPct(lab.backtest.metrics.winRate)} tone="text-foreground" />
                        <Stat label="Profit factor" value={fmt(lab.backtest.metrics.profitFactor)} tone="text-foreground" />
                        <Stat label="Total trades" value={lab.backtest.metrics.totalTrades} tone="text-foreground" />
                        <Stat label="Expectancy (R)" value={fmt(lab.backtest.metrics.expectancyR)} tone="text-foreground" />
                        <Stat label="Max drawdown" value={fmtPct(lab.backtest.metrics.maxDrawdownPct)} tone="text-red-300" />
                        <Stat label="Return" value={fmtPct(lab.backtest.metrics.returnPct)} tone={lab.backtest.metrics.returnPct >= 0 ? "text-emerald-300" : "text-red-300"} />
                        <Stat label="Final balance" value={fmtUsd(lab.backtest.metrics.finalBalance)} tone="text-foreground" />
                    </div>

                    {lab.backtest.equity.length > 1 && <EquityCurve equity={lab.backtest.equity} />}

                    <div className="overflow-x-auto rounded-xl border border-border/20 bg-card p-0">
                        <table className="w-full text-left text-xs">
                            <thead className="border-b border-border/20 text-[11px] uppercase tracking-widest text-foreground/70">
                                <tr>
                                    <th className="px-3 py-2">Open</th>
                                    <th className="px-3 py-2">Dir</th>
                                    <th className="px-3 py-2">Entry</th>
                                    <th className="px-3 py-2">Exit</th>
                                    <th className="px-3 py-2">Exit reason</th>
                                    <th className="px-3 py-2">R</th>
                                    <th className="px-3 py-2">P/L</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lab.backtest.trades.slice(0, 40).map((t) => (
                                    <tr key={t.id || t.ticket} className="border-b border-border/10">
                                        <td className="px-3 py-2 text-muted-foreground">{new Date(t.openedAt).toLocaleString()}</td>
                                        <td className="px-3 py-2"><DirectionBadge dir={t.direction} /></td>
                                        <td className="px-3 py-2 text-foreground">{fmt(t.entry, 2)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmt(t.exit, 2)}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{t.exitReason}</td>
                                        <td className="px-3 py-2 text-foreground">{fmt(t.profitR)}</td>
                                        <td className={`px-3 py-2 font-semibold ${t.pnlGross >= 0 ? "text-emerald-300" : "text-red-300"}`}>{fmtUsd(t.pnlGross)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

function EquityCurve({ equity }: { equity: { time: number; balance: number }[] }) {
    const data = equity.map((p) => ({ ...p, label: new Date(p.time).toLocaleDateString() }));
    return (
        <div className="rounded-2xl border border-border/20 bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <LineChartIcon className="h-4 w-4 text-amber-400" /> Equity curve
            </div>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#ffffff10" vertical={false} />
                        <XAxis dataKey="label" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} minTickGap={40} />
                        <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} width={70} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 10, fontSize: 12 }} />
                        <Area type="monotone" dataKey="balance" stroke="#f59e0b" strokeWidth={2} fill="url(#eq)" name="Balance" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// ───────────────────────────── Optimize ────────────────────────────────

function OptimizeTab({
    lab, run, setOptimization, setOptimizeBusy,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setOptimization: (o: OptimizationOutcome | null) => void;
    setOptimizeBusy: (b: boolean) => void;
}) {
    const launch = () =>
        run(async () => {
            if (!lab.token) return;
            if (!lab.selectedStrategy) {
                lab.setError("Select or generate a strategy first.");
                return;
            }
            setOptimizeBusy(true);
            try {
                const res = await strategyLabApi.optimize(lab.token, {
                    symbol: lab.symbol,
                    strategy: lab.selectedStrategy,
                });
                setOptimization(res.optimization);
            } finally {
                setOptimizeBusy(false);
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="max-w-2xl text-sm text-muted-foreground">
                    Optimizes the strategy&apos;s risk and trade-management parameters across a bounded grid (max 80 runs). Results are ranked by a composite score — always validate the best parameters out-of-sample.
                </div>
                <Btn onClick={launch} busy={lab.optimizeBusy} disabled={!lab.selectedStrategy}>
                    <Gauge className="h-4 w-4" /> Run Optimization
                </Btn>
            </div>

            {lab.optimization && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Combinations tested" value={lab.optimization.results.length} tone="text-foreground" />
                        {lab.optimization.best && (
                            <>
                                <Stat label="Best score" value={fmt(lab.optimization.best.score)} tone="text-amber-300" />
                                <Stat label="Best win rate" value={fmtPct(lab.optimization.best.metrics.winRate)} tone="text-foreground" />
                                <Stat label="Best PF" value={fmt(lab.optimization.best.metrics.profitFactor)} tone="text-foreground" />
                            </>
                        )}
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-border/20 bg-card">
                        <table className="w-full text-left text-xs">
                            <thead className="border-b border-border/20 text-[11px] uppercase tracking-widest text-foreground/70">
                                <tr>
                                    <th className="px-3 py-2">#</th>
                                    <th className="px-3 py-2">Score</th>
                                    <th className="px-3 py-2">Win rate</th>
                                    <th className="px-3 py-2">Profit factor</th>
                                    <th className="px-3 py-2">Return</th>
                                    <th className="px-3 py-2">Max DD</th>
                                    <th className="px-3 py-2">Expectancy R</th>
                                    <th className="px-3 py-2">Trades</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lab.optimization.results.slice(0, 25).map((r: OptimizeResult, i: number) => (
                                    <tr key={i} className="border-b border-border/10">
                                        <td className="px-3 py-2 text-foreground/70">{i + 1}</td>
                                        <td className="px-3 py-2 font-semibold text-amber-300">{fmt(r.score)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmtPct(r.metrics.winRate)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmt(r.metrics.profitFactor)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmtPct(r.metrics.returnPct)}</td>
                                        <td className="px-3 py-2 text-red-300">{fmtPct(r.metrics.maxDrawdownPct)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmt(r.metrics.expectancyR)}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{r.metrics.totalTrades}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

// ───────────────────────────── Validate ────────────────────────────────

function ValidateTab({
    lab, run, setValidation, setRobustness, setValidateBusy,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setValidation: (v: ValidationOutcome | null) => void;
    setRobustness: (r: RobustnessScore | null) => void;
    setValidateBusy: (b: boolean) => void;
}) {
    const launch = () =>
        run(async () => {
            if (!lab.token) return;
            if (!lab.selectedStrategy) {
                lab.setError("Select or generate a strategy first.");
                return;
            }
            setValidateBusy(true);
            try {
                const res = await strategyLabApi.validate(lab.token, {
                    symbol: lab.symbol,
                    strategy: lab.selectedStrategy,
                });
                setValidation(res.validation);
                setRobustness(res.robustness);
            } finally {
                setValidateBusy(false);
            }
        });

    const verdictTone: Record<string, string> = {
        robust: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        marginal: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        fragile: "border-orange-500/40 bg-orange-500/10 text-orange-300",
        inconclusive: "border-border/40 bg-muted/10 text-foreground/70",
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="max-w-2xl text-sm text-muted-foreground">
                    Walk-forward validation splits history into in-sample / out-of-sample windows to check the strategy&apos;s edge is real and stable — not curve-fitted.
                </div>
                <Btn onClick={launch} busy={lab.validateBusy} disabled={!lab.selectedStrategy}>
                    <ShieldCheck className="h-4 w-4" /> Validate Strategy
                </Btn>
            </div>

            {lab.validation && (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-wrap items-center gap-4">
                        <span className={`rounded-xl border px-4 py-2 text-sm font-bold uppercase tracking-widest ${verdictTone[lab.validation.verdict] ?? verdictTone.inconclusive}`}>
                            {lab.validation.verdict}
                        </span>
                        {lab.robustness && (
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl border border-border/20 bg-card px-4 py-2 text-sm">
                                    <span className="text-foreground/70">Robustness </span>
                                    <span className="font-bold text-foreground">{fmt(lab.robustness.score)}</span>
                                    <span className={`ml-2 rounded-lg border px-2 py-0.5 text-xs font-bold ${
                                        lab.robustness.grade === "A" ? "border-emerald-500/40 text-emerald-300" :
                                        lab.robustness.grade === "B" ? "border-amber-500/40 text-amber-300" :
                                        lab.robustness.grade === "C" ? "border-orange-500/40 text-orange-300" : "border-red-500/40 text-red-300"
                                    }`}>{lab.robustness.grade}</span>
                                </div>
                                <div className="max-w-md text-xs text-foreground/70">{lab.robustness.notes[0]}</div>
                            </div>
                        )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-2xl border border-border/20 bg-card p-5">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-400">In-sample</div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div><div className="text-[10px] uppercase text-foreground/70">Trades</div><div className="font-semibold text-foreground">{lab.validation.inSample.trades}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Win rate</div><div className="font-semibold text-foreground">{fmtPct(lab.validation.inSample.metrics.winRate)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Profit factor</div><div className="font-semibold text-foreground">{fmt(lab.validation.inSample.metrics.profitFactor)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Return</div><div className="font-semibold text-foreground">{fmtPct(lab.validation.inSample.metrics.returnPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Max DD</div><div className="font-semibold text-red-300">{fmtPct(lab.validation.inSample.metrics.maxDrawdownPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Expectancy R</div><div className="font-semibold text-foreground">{fmt(lab.validation.inSample.metrics.expectancyR)}</div></div>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-border/20 bg-card p-5">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-400">Out-of-sample</div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div><div className="text-[10px] uppercase text-foreground/70">Trades</div><div className="font-semibold text-foreground">{lab.validation.outOfSample.trades}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Win rate</div><div className="font-semibold text-foreground">{fmtPct(lab.validation.outOfSample.metrics.winRate)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Profit factor</div><div className="font-semibold text-foreground">{fmt(lab.validation.outOfSample.metrics.profitFactor)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Return</div><div className="font-semibold text-foreground">{fmtPct(lab.validation.outOfSample.metrics.returnPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Max DD</div><div className="font-semibold text-red-300">{fmtPct(lab.validation.outOfSample.metrics.maxDrawdownPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Expectancy R</div><div className="font-semibold text-foreground">{fmt(lab.validation.outOfSample.metrics.expectancyR)}</div></div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border/20 bg-card p-5">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Degradation (in → out of sample)</div>
                        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                            <div className="text-muted-foreground">Win rate <span className="text-foreground">{fmt(lab.validation.degradation.winRateDiff)}pp</span></div>
                            <div className="text-muted-foreground">Profit factor <span className="text-foreground">{fmt(lab.validation.degradation.profitFactorDiff)}</span></div>
                            <div className="text-muted-foreground">Return <span className="text-foreground">{fmt(lab.validation.degradation.returnDiff)}</span></div>
                            <div className="text-muted-foreground">Max DD <span className="text-foreground">{fmt(lab.validation.degradation.maxDrawdownDiff)}</span></div>
                            <div className="text-muted-foreground">Overall <span className="text-foreground">{fmt(lab.validation.degradation.overall)}%</span></div>
                        </div>
                        <div className="mt-3 text-sm text-muted-foreground">
                            Walk-forward windows: <span className="text-foreground">{lab.validation.walkForward.windows.length}</span> · stable:{" "}
                            <span className={lab.validation.walkForward.stable ? "text-emerald-300" : "text-red-300"}>{lab.validation.walkForward.stable ? "yes" : "no"}</span> · stability score:{" "}
                            <span className="text-foreground">{fmt(lab.validation.walkForward.stabilityScore)}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────── Deploy ──────────────────────────────────

function DeployTab({
    lab, run, setDeployments, setDeployBusy,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setDeployments: (d: Deployment[]) => void;
    setDeployBusy: (b: boolean) => void;
}) {
    const [mode, setMode] = useState<"alerts_only" | "manual_confirmation" | "demo" | "live">("alerts_only");
    const [terms, setTerms] = useState(false);
    const [forwardBusy, setForwardBusy] = useState(false);

    const MODES: { key: typeof mode; label: string; desc: string }[] = [
        { key: "alerts_only", label: "Alerts Only", desc: "Signals stay in the lab and are notified — nothing touches your broker." },
        { key: "manual_confirmation", label: "Manual Confirmation", desc: "A trade request is created but requires your confirmation before execution." },
        { key: "demo", label: "Demo", desc: "Order requests are written to the demo account linked to your license." },
        { key: "live", label: "Live", desc: "Order requests written to your live MT5 account via the gateway. High risk." },
    ];

    const deploy = () =>
        run(async () => {
            if (!lab.token) return;
            if (!lab.selectedStrategy) {
                lab.setError("Select or generate a strategy first.");
                return;
            }
            setDeployBusy(true);
            try {
                const res = await strategyLabApi.deploy(lab.token, {
                    strategyId: lab.selectedStrategy.id,
                    symbol: lab.symbol,
                    mode,
                    termsAccepted: terms,
                });
                lab.setForwardTest(res.forwardTest);
                const d = await strategyLabApi.listDeployments(lab.token);
                setDeployments(d.deployments);
            } finally {
                setDeployBusy(false);
            }
        });

    const tick = () =>
        run(async () => {
            if (!lab.token) return;
            if (!lab.forwardTest) {
                lab.setError("Deploy a strategy first.");
                return;
            }
            setForwardBusy(true);
            try {
                const res = await strategyLabApi.forwardMonitor(lab.token, {
                    forwardTestId: lab.forwardTest.id,
                    symbol: lab.symbol,
                });
                lab.setForwardTest(res.forwardTest);
                if (res.newSignal) {
                    lab.setError(null);
                    lab.setRunning(true);
                    // a brief toast-style status
                }
            } finally {
                setForwardBusy(false);
                lab.setRunning(false);
            }
        });

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <h3 className="text-base font-bold text-foreground">Deploy strategy</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {lab.selectedStrategy ? `Deploying: ${lab.selectedStrategy.name} (${lab.symbol})` : "Select a strategy to deploy."}
                    </p>

                    <div className="mt-4 flex flex-col gap-3">
                        {MODES.map((m) => (
                            <label
                                key={m.key}
                                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                                    mode === m.key ? "border-amber-500/50 bg-amber-500/10" : "border-border/20 bg-foreground/10 hover:bg-background/20"
                                }`}
                            >
                                <input type="radio" name="mode" className="mt-1 accent-amber-500" checked={mode === m.key} onChange={() => setMode(m.key)} />
                                <span>
                                    <span className="block text-sm font-semibold text-foreground">{m.label}</span>
                                    <span className="text-xs text-muted-foreground">{m.desc}</span>
                                </span>
                            </label>
                        ))}
                    </div>

                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border/20 bg-foreground/10 p-3.5">
                        <input type="checkbox" className="mt-1 accent-amber-500" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                        <span className="text-xs leading-relaxed text-muted-foreground">
                            I understand the Strategy Lab runs on historical market data, live signals involve real risk,
                            that paper/demo/live outcomes differ, and that backtested performance{" "}
                            <span className="font-semibold text-foreground/80">does not guarantee future returns</span>.
                        </span>
                    </label>

                    <div className="mt-4 flex items-center gap-3">
                        <Btn onClick={deploy} busy={lab.deployBusy} disabled={!lab.selectedStrategy || !terms}>
                            <Rocket className="h-4 w-4" /> Deploy
                        </Btn>
                        <span className="text-xs text-foreground/70">Creates a forward test (paper) + deployment record.</span>
                    </div>
                </div>

                {lab.forwardTest && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                        <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                            <CheckCircle2 className="h-4 w-4" /> Forward test running
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div><span className="text-foreground/70">ID </span><span className="text-foreground">{lab.forwardTest.id}</span></div>
                            <div><span className="text-foreground/70">Mode </span><span className="capitalize text-foreground">{lab.forwardTest.mode.replace("_", " ")}</span></div>
                            <div><span className="text-foreground/70">Signals </span><span className="text-foreground">{lab.forwardTest.signals.length}</span></div>
                            <div><span className="text-foreground/70">Closed / wins </span><span className="text-foreground">{lab.forwardTest.signals.filter((s) => s.status === "closed").length} / {lab.forwardTest.tradeCount}</span></div>
                        </div>
                        <div className="mt-3 flex gap-2">
                            <Btn onClick={tick} busy={forwardBusy} variant="ghost">
                                <RefreshCw className="h-4 w-4" /> Refresh with latest data
                            </Btn>
                        </div>
                    </div>
                )}

                {lab.deployments.length > 0 && (
                    <div className="rounded-2xl border border-border/20 bg-card p-5">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Active deployments</div>
                        <div className="flex flex-col gap-2">
                            {lab.deployments.map((d) => (
                                <div key={d.id} className="flex items-center justify-between rounded-xl border border-border/20 bg-foreground/10 p-3 text-sm">
                                    <div>
                                        <span className="font-semibold text-foreground">{d.strategyName}</span>
                                        <span className="ml-2 text-xs text-foreground/70">{d.symbol} · {d.mode.replace("_", " ")}</span>
                                    </div>
                                    <span className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${
                                        d.status === "active" || d.status === "live" ? "border-emerald-500/40 text-emerald-300" : "border-border/40 text-muted-foreground"
                                    }`}>{d.status}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <h3 className="flex items-center gap-2 text-base font-bold text-foreground"><TrendingUp className="h-4 w-4 text-amber-400" /> Forward test signals</h3>
                    <div className="mt-3 flex flex-col gap-2">
                        {!lab.forwardTest || lab.forwardTest.signals.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/20 p-6 text-center text-sm text-foreground/70">
                                Signals appear here once the strategy fires on live (polled) data.
                            </div>
                        ) : (
                            lab.forwardTest.signals.slice().reverse().map((s) => (
                                <div key={s.id} className="rounded-xl border border-border/20 bg-foreground/10 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-foreground">{s.direction} {s.symbol}</span>
                                        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                            s.status === "open" ? "border-amber-500/40 text-amber-300" : "border-emerald-500/40 text-emerald-300"
                                        }`}>{s.status}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        Entry {fmt(s.entry, 2)} · SL {fmt(s.sl, 2)} · TP1 {fmt(s.tp1, 2)} · {new Date(s.openedAt).toLocaleString()}
                                    </div>
                                    <div className="mt-1 text-xs text-foreground/70">R: {s.profitR !== undefined ? fmt(s.profitR) : "open"} · {s.reasoning}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ───────────────────────────── MT5 EA ─────────────────────────────────

function EATab({
    lab, run, setEAs, setEAsBusy, setStrategies,
}: {
    lab: Lab;
    run: (fn: () => Promise<void>) => Promise<void>;
    setEAs: (eas: EAView[]) => void;
    setEAsBusy: (b: boolean) => void;
    setStrategies?: (s: Strategy[]) => void;
}) {
    const [generating, setGenerating] = useState(false);
    const [compileOnGenerate, setCompileOnGenerate] = useState(true);
    const [viewing, setViewing] = useState<EAView | null>(null);
    const [recompiling, setRecompiling] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [mt5Account, setMt5Account] = useState("");
    const [publishing, setPublishing] = useState(false);
    const [pubOpen, setPubOpen] = useState(false);
    const [pubPrice, setPubPrice] = useState("49");
    const [pubDesc, setPubDesc] = useState("");
    const [interpreting, setInterpreting] = useState(false);
    const [nlPrompt, setNlPrompt] = useState("");
    const [localMsg, setLocalMsg] = useState<string | null>(null);

    const flash = (msg: string) => {
        setLocalMsg(msg);
        window.setTimeout(() => setLocalMsg(null), 6000);
    };

    const refresh = async (t: string, selectId?: string) => {
        const res = await strategyLabApi.listEAs(t);
        setEAs(res.eas as EAView[]);
        const target = selectId ? (res.eas as EAView[]).find((e) => e.eaId === selectId) : undefined;
        if (target) lab.setSelectedEA(target);
    };

    const generate = () =>
        run(async () => {
            if (!lab.token) return;
            if (!lab.selectedStrategy) {
                lab.setError("Select or generate a strategy first (tabs 2–3).");
                return;
            }
            setGenerating(true);
            try {
                setEAsBusy(true);
                const res = await strategyLabApi.generateEA(lab.token, {
                    strategyId: lab.selectedStrategy.id,
                    options: { compile: compileOnGenerate },
                });
                await refresh(lab.token, res.eaId);
                setEAsBusy(false);
                flash(`EA generated (${res.eaId}). Compiled: ${String((res.ea as { compiled?: boolean }).compiled ?? false)}`);
            } finally {
                setGenerating(false);
            }
        });

    const openCode = async (ea: EAView) => {
        if (!lab.token) return;
        setViewing(ea);
        if (!ea.code) {
            try {
                const res = await strategyLabApi.getEA(lab.token, ea.eaId, true);
                setViewing({ ...ea, ...(res.ea as EAView) });
            } catch (err) {
                lab.setError(err instanceof Error ? err.message : "Could not load EA source.");
            }
        }
    };

    const download = (ea: EAView) =>
        run(async () => {
            if (!lab.token) return;
            setDownloading(true);
            try {
                const { fileName, code } = await strategyLabApi.downloadEA(lab.token, ea.eaId);
                const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
                flash(`Downloaded ${fileName}`);
            } finally {
                setDownloading(false);
            }
        });

    const recompile = (ea: EAView) =>
        run(async () => {
            if (!lab.token) return;
            setRecompiling(true);
            try {
                const res = await strategyLabApi.compileEA(lab.token, ea.eaId);
                await refresh(lab.token, ea.eaId);
                flash(res.success
                    ? `Compiled with 0 errors (${res.method}, ${res.warnings.length} warning(s)).`
                    : `Compilation failed (${res.errors.slice(0, 3).join(" | ")}).`);
            } finally {
                setRecompiling(false);
            }
        });

    const deploy = (ea: EAView) =>
        run(async () => {
            if (!lab.token) return;
            setDeploying(true);
            try {
                const res = await strategyLabApi.deployEA(lab.token, ea.eaId, mt5Account.trim() || undefined);
                await refresh(lab.token, ea.eaId);
                flash(`Deployed as ${res.botId} — Gateway will monitor magic ${res.magicNumber}.`);
            } finally {
                setDeploying(false);
            }
        });

    const publish = (ea: EAView) =>
        run(async () => {
            if (!lab.token) return;
            setPublishing(true);
            try {
                const res = await strategyLabApi.publishEA(lab.token, ea.eaId, {
                    description: pubDesc.trim(),
                    price: Number(pubPrice) || 0,
                });
                await refresh(lab.token, ea.eaId);
                setPubOpen(false);
                flash(`Published to the Marketplace as ${res.productId} (v${res.version}).`);
            } finally {
                setPublishing(false);
            }
        });

    const remove = (ea: EAView) =>
        run(async () => {
            if (!lab.token) return;
            if (!window.confirm(`Delete generated EA ${ea.eaId}? This does not stop any deployed bot.`)) return;
            await strategyLabApi.deleteEA(lab.token, ea.eaId);
            if (lab.selectedEA?.eaId === ea.eaId) lab.setSelectedEA(null);
            await refresh(lab.token);
        });

    const interpret = () =>
        run(async () => {
            if (!lab.token) return;
            setInterpreting(true);
            try {
                setEAsBusy(true);
                const res = await strategyLabApi.interpretStrategy(lab.token, {
                    prompt: nlPrompt,
                    symbol: lab.symbol,
                    hierarchy: lab.hierarchy,
                    save: true,
                });
                if (res.strategy) {
                    lab.setSelectedStrategy(res.strategy);
                    if (setStrategies) {
                        const list = await strategyLabApi.listStrategies(lab.token);
                        setStrategies(list.strategies);
                    }
                }
                setEAsBusy(false);
                flash(res.message);
            } finally {
                setInterpreting(false);
            }
        });

    const sel = lab.selectedEA;

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                        <Wand2 className="h-4 w-4 text-amber-400" /> Describe a strategy (optional)
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Natural language → structured draft → saved strategy. Rules you can review before generating the EA.
                    </p>
                    <textarea
                        className="mt-3 w-full resize-y rounded-xl border border-border/20 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/50"
                        rows={2}
                        placeholder="e.g. Buy XAUUSD on M15 when H4 trend is bullish, on a London/NY session break with a bullish BOS and positive momentum; ATR stop, 1:3 target."
                        value={nlPrompt}
                        onChange={(e) => setNlPrompt(e.target.value)}
                    />
                    <div className="mt-2 flex gap-2">
                        <Btn onClick={interpret} busy={interpreting} disabled={nlPrompt.trim().length < 4}>
                            <Sparkles className="h-4 w-4" /> Interpret
                        </Btn>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <h3 className="text-base font-bold text-foreground">Generate MT5 Expert Advisor</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {lab.selectedStrategy
                            ? `Strategy: ${lab.selectedStrategy.name} (${lab.selectedStrategy.asset} · setup ${lab.selectedStrategy.timeframes.setup} · ${lab.selectedStrategy.entryRules.filter((r) => r.enabled).length} entry rules)`
                            : "Select or generate a strategy first (tabs 2–3)."}
                    </p>
                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border/20 bg-foreground/10 p-3.5">
                        <input type="checkbox" className="mt-1 accent-amber-500" checked={compileOnGenerate} onChange={(e) => setCompileOnGenerate(e.target.checked)} />
                        <span className="text-xs leading-relaxed text-muted-foreground">
                            Compile with MetaEditor during generation. When no local compiler exists, a{" "}
                            <span className="font-semibold text-foreground/80">strict static validation</span> is used and labeled as such —
                            compilation is never faked.
                        </span>
                    </label>
                    <div className="mt-4">
                        <Btn onClick={generate} busy={generating || lab.easBusy} disabled={!lab.selectedStrategy}>
                            <Cpu className="h-4 w-4" /> Generate EA
                        </Btn>
                        <span className="ml-3 text-xs text-foreground/70">
                            Magic number assigned deterministically per strategy/version/symbol.
                        </span>
                    </div>
                </div>

                {localMsg && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200">{localMsg}</div>
                )}

                {sel && (
                    <div className="rounded-2xl border border-border/20 bg-card p-5">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h3 className="text-base font-bold text-foreground">{sel.name}</h3>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-foreground/70">
                                    <span>{sel.symbol}</span>
                                    <span>{sel.timeframe}</span>
                                    <span>magic {sel.magicNumber}</span>
                                    <span>EA v{sel.eaVersion ?? sel.strategyVersion}</span>
                                    <span>{sel.executionModel === "same_bar_close" ? "same-bar close" : "next-bar open"}</span>
                                </div>
                            </div>
                            <span className={`rounded-lg border px-2 py-0.5 text-xs font-bold uppercase ${
                                sel.compiled
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            }`}>
                                {sel.compiled ? "Compiled" : "Static checked"}
                            </span>
                        </div>

                        {sel.compileReport && (
                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                <div className="rounded-lg border border-border/10 bg-foreground/10 p-2">
                                    <div className="text-foreground/70">Method</div>
                                    <div className="font-semibold text-foreground">{sel.compileReport.method === "metaeditor" ? "MetaEditor" : "static"}</div>
                                </div>
                                <div className="rounded-lg border border-border/10 bg-foreground/10 p-2">
                                    <div className="text-foreground/70">Errors</div>
                                    <div className={`font-semibold ${sel.compileReport.errors.length ? "text-red-300" : "text-emerald-300"}`}>{sel.compileReport.errors.length}</div>
                                </div>
                                <div className="rounded-lg border border-border/10 bg-foreground/10 p-2">
                                    <div className="text-foreground/70">Warnings</div>
                                    <div className="font-semibold text-foreground">{sel.compileReport.warnings.length}</div>
                                </div>
                            </div>
                        )}

                        {sel.parity && sel.parity.summary && (
                            <div className="mt-3 rounded-lg border border-border/10 bg-foreground/10 p-3 text-xs leading-relaxed text-muted-foreground">
                                <span className="font-semibold text-foreground/80">Parity vs backtest: </span>
                                {sel.parity.summary}
                            </div>
                        )}

                        {sel.gateway && (
                            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                                <span className="font-semibold text-emerald-300">Gateway </span>
                                <span className="text-emerald-200/80">bot {sel.gateway.botId} · magic {sel.gateway.magicNumber ?? sel.magicNumber} · monitored by the MT5 Gateway</span>
                            </div>
                        )}

                        {sel.marketplace && (
                            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                                <span className="font-semibold text-amber-300">Marketplace </span>
                                <span className="text-amber-200/80">{sel.marketplace.productId} · v{sel.marketplace.version} · {sel.marketplace.status}</span>
                            </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                            <Btn onClick={() => openCode(sel)} variant="ghost">
                                <FileCode2 className="h-4 w-4" /> View code
                            </Btn>
                            <Btn onClick={() => download(sel)} busy={downloading} variant="ghost">
                                <Download className="h-4 w-4" /> Download .mq5
                            </Btn>
                            <Btn onClick={() => recompile(sel)} busy={recompiling} variant="ghost">
                                <RefreshCw className="h-4 w-4" /> Recompile
                            </Btn>
                            <Btn onClick={() => deploy(sel)} busy={deploying} variant={sel.gateway ? "ghost" : "primary"}>
                                <Rocket className="h-4 w-4" /> {sel.gateway ? "Re-deploy" : "Deploy"}
                            </Btn>
                            <Btn onClick={() => setPubOpen((v) => !v)} variant="ghost">
                                <Store className="h-4 w-4" /> {sel.marketplace ? "Re-publish" : "Publish"}
                            </Btn>
                            <Btn onClick={() => remove(sel)} variant="danger">
                                <Trash2 className="h-4 w-4" />
                            </Btn>
                        </div>

                        {!sel.gateway && (
                            <div className="mt-3 flex items-center gap-2 text-xs text-foreground/70">
                                <span>MT5 account (optional):</span>
                                <input
                                    className="w-40 rounded-lg border border-border/20 bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-amber-500/50"
                                    placeholder="e.g. 50012345"
                                    value={mt5Account}
                                    onChange={(e) => setMt5Account(e.target.value)}
                                />
                            </div>
                        )}

                        {pubOpen && (
                            <div className="mt-3 rounded-xl border border-border/20 bg-background/60 p-4">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/70">Publish to marketplace</div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-[11px] uppercase tracking-widest text-foreground/70">Price (USD)</span>
                                        <input
                                            className={selCls}
                                            type="number"
                                            min={0}
                                            value={pubPrice}
                                            onChange={(e) => setPubPrice(e.target.value)}
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-[11px] uppercase tracking-widest text-foreground/70">Description</span>
                                        <input
                                            className={selCls}
                                            placeholder="Optional marketing copy"
                                            value={pubDesc}
                                            onChange={(e) => setPubDesc(e.target.value)}
                                        />
                                    </label>
                                </div>
                                <div className="mt-3">
                                    <Btn onClick={() => publish(sel)} busy={publishing}>
                                        <Store className="h-4 w-4" /> Publish now
                                    </Btn>
                                    <span className="ml-2 text-xs text-foreground/70">
                                        Buyers get the .mq5 via the existing license-gated download.
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="rounded-2xl border border-border/20 bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-bold text-foreground">Generated EAs</h3>
                    <span className="text-xs text-foreground/70">{lab.eas.length}</span>
                </div>
                <div className="flex max-h-[640px] flex-col gap-2 overflow-y-auto pr-1">
                    {lab.eas.length === 0 && !lab.easBusy ? (
                        <div className="rounded-xl border border-dashed border-border/20 p-6 text-center text-sm text-foreground/70">
                            No EAs generated yet. Pick a strategy and generate your first MT5 Expert Advisor.
                        </div>
                    ) : (
                        lab.eas.map((ea) => (
                            <button
                                key={ea.eaId}
                                className={`rounded-xl border p-3 text-left transition ${
                                    lab.selectedEA?.eaId === ea.eaId ? "border-amber-500/50 bg-amber-500/10" : "border-border/20 bg-foreground/10 hover:bg-background/20"
                                }`}
                                onClick={() => lab.setSelectedEA(ea)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate font-semibold text-foreground">{ea.name}</span>
                                    <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                        ea.compiled ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"
                                    }`}>
                                        {ea.compiled ? "OK" : "static"}
                                    </span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-foreground/70">
                                    <span>{ea.symbol}</span>
                                    <span>{ea.timeframe}</span>
                                    <span>magic {ea.magicNumber}</span>
                                    {ea.gateway && <span className="text-emerald-300">deployed</span>}
                                    {ea.marketplace && <span className="text-amber-300">marketplace</span>}
                                    <span>{new Date(ea.createdAt).toLocaleDateString()}</span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {viewing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setViewing(null)}>
                    <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-border/30 bg-card" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-border/10 px-5 py-3">
                            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                                <FileCode2 className="h-4 w-4 text-amber-400" />
                                {viewing.name}_{viewing.symbol}.mq5
                                <span className="rounded-lg border border-border/20 px-2 py-0.5 text-[10px] font-semibold text-foreground/70">
                                    magic {viewing.magicNumber}
                                </span>
                            </div>
                            <button className="text-foreground/70 hover:text-foreground" onClick={() => setViewing(null)} aria-label="Close">×</button>
                        </div>
                        {viewing.code ? (
                            <pre className="flex-1 overflow-auto bg-background p-5 text-[11px] leading-relaxed text-foreground/90">{viewing.code}</pre>
                        ) : (
                            <div className="p-10 text-center text-sm text-foreground/70">Loading source…</div>
                        )}
                        <div className="flex items-center justify-between border-t border-border/10 px-5 py-3 text-xs text-foreground/70">
                            <span>Generated by AlgoVault EA Generator v{viewing.generatorVersion ?? "1.0.0"} · attach to a {viewing.symbol} chart on {viewing.timeframe}.</span>
                            <Btn onClick={() => download(viewing)} busy={downloading} variant="ghost">
                                <Download className="h-4 w-4" /> Download
                            </Btn>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}