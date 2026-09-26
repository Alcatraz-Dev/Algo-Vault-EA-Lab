"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthToken, useThrottledAuthedFetch } from "@/lib/scalping/client";
import {
    ArrowDownRight,
    ArrowUpRight,
    BarChart3,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    CircleDashed,
    Cpu,
    Dna,
    Download,
    FileCode2,
    FileSearch,
    FlaskConical,
    Gauge,
    Layers,
    LineChart as LineChartIcon,
    Loader2,
    Pencil,
    Play,
    RefreshCw,
    Rocket,
    ShieldCheck,
    Sparkles,
    Store,
    Trash2,
    TrendingUp,
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
import type { EvolutionRun } from "@/lib/ai/strategy-lab/evolution";
import {
    DnaInspector,
    EvolutionRulesPanel,
    PipelineView,
    StrategyEvolution,
    StrategyEvolutionDetail,
} from "@/components/strategy-lab/StrategyDnaPanel";
import { SUPPORTED_SYMBOLS, Timeframe } from "@/lib/market-data/types";
import {
    AnalysisPeriod,
    BacktestResult,
    DataCoverage,
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
    DEFAULT_HIERARCHY,
} from "@/lib/strategy-lab/types";

const SYMBOLS = [...SUPPORTED_SYMBOLS] as const;
const PERIODS: AnalysisPeriod[] = ["1M", "3M", "6M", "1Y", "3Y"];
const TIMEFRAME_LABEL: Record<Timeframe, string> = {
    M1: "M1", M3: "M3", M5: "M5", M15: "M15", M30: "M30",
    H1: "H1", H4: "H4", D1: "D1",
};
// Timeframes surfaced in the UI (biquote-supported for the chosen periods).
const UI_TFS: Timeframe[] = ["M5", "M15", "H1", "H4", "D1"];

// ─────────────────────────── workspace steps ───────────────────────────────

type Step =
    | "market" | "patterns" | "strategy" | "backtest" | "optimize"
    | "validate" | "deploy" | "ea" | "dna";

const STEP_ORDER: Step[] = [
    "market", "patterns", "strategy", "backtest", "optimize",
    "validate", "deploy", "ea", "dna",
];

const STEP_META: Record<Step, { n: number; label: string; icon: React.ElementType; hint: string }> = {
    market: { n: 1, label: "Market", icon: FileSearch, hint: "Read the market across timeframes" },
    patterns: { n: 2, label: "Patterns", icon: Layers, hint: "Find statistically measured setups" },
    strategy: { n: 3, label: "Strategy", icon: Wand2, hint: "Generate or pick a strategy" },
    backtest: { n: 4, label: "Backtest", icon: BarChart3, hint: "Simulate it on historical data" },
    optimize: { n: 5, label: "Optimize", icon: Gauge, hint: "Tune risk & management params" },
    validate: { n: 6, label: "Validate", icon: ShieldCheck, hint: "Walk-forward out-of-sample test" },
    deploy: { n: 7, label: "Deploy", icon: Rocket, hint: "Forward test & go near-live" },
    ea: { n: 8, label: "MT5 EA", icon: Cpu, hint: "Compile an Expert Advisor" },
    dna: { n: 9, label: "DNA & Evolution", icon: Dna, hint: "Evolve strategies automatically" },
};

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };

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

// ─────────────────────────── formatting helpers ────────────────────────────

const fmt = (n: number | undefined | null, digits = 2) =>
    n === undefined || n === null || Number.isNaN(n) ? "–" : (n as number).toFixed(digits);
const fmtPct = (n: number | undefined | null) => (n === undefined || n === null ? "–" : `${(n as number).toFixed(2)}%`);
const fmtUsd = (n: number | undefined | null) =>
    n === undefined || n === null ? "–" : `${(n as number) >= 0 ? "+" : ""}$${(n as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// ─────────────────────────── tiny UI primitives ────────────────────────────

function Stat({ label, value, tone = "text-foreground", sub }: { label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border/20 bg-background/50 p-4">
            <div className="text-[11px] uppercase tracking-widest text-foreground/70">{label}</div>
            <div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div>
            {sub !== undefined && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
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

function EmptyState({ icon: Icon, title, body, cta }: { icon: React.ElementType; title: string; body: string; cta?: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-dashed border-border/20 bg-card/40 p-10 text-center">
            <Icon className="mx-auto h-8 w-8 text-foreground/40" />
            <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
            {cta && <div className="mt-4 flex justify-center">{cta}</div>}
        </div>
    );
}

function Btn({
    children, onClick, busy, disabled, variant = "primary", className = "", title,
}: {
    children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean;
    variant?: "primary" | "ghost" | "danger"; className?: string; title?: string;
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
            title={title}
        >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {children}
        </button>
    );
}

const selCls =
    "rounded-xl border border-border/20 bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-amber-500/50";

const inputCls =
    "rounded-xl border border-border/20 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-amber-500/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-widest text-foreground/70">{label}</span>
            {children}
        </label>
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

function SectionHeader({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <h3 className="text-base font-bold text-foreground">{title}</h3>
                {desc && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{desc}</p>}
            </div>
            {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
    );
}

// ─────────────────────────── main component ────────────────────────────────

export function StrategyLabClient() {
    const token = useAuthToken();
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [step, setStep] = useState<Step>("market");

    // Shared workspace context — every tab operates on this.
    const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("XAUUSD");
    const [period, setPeriod] = useState<AnalysisPeriod>("1M");
    const [hierarchy] = useState<TimeframeHierarchy>({ ...DEFAULT_HIERARCHY });
    const [patternTf, setPatternTf] = useState<Timeframe>("M15");

    const [analysis, setAnalysis] = useState<MarketAnalysisSet | null>(null);
    const [aiSummary, setAiSummary] = useState<AnalysisApiResponse["aiSummary"]>(null);
    const [analysisBusy, setAnalysisBusy] = useState(false);
    const [dataCoverage, setDataCoverage] = useState<DataCoverage[]>([]);

    const [patterns, setPatterns] = useState<Pattern[]>([]);
    const [patternsBusy, setPatternsBusy] = useState(false);
    const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);

    const [strategies, setStrategies] = useState<Strategy[]>([]);
    const [strategiesBusy, setStrategiesBusy] = useState(true);
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
    const [easBusy, setEAsBusy] = useState(true);
    const [selectedEA, setSelectedEA] = useState<EAView | null>(null);

    // Toasts (success / error / info). Newest last; auto-expire.
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastSeq = useRef(0);
    const pushToast = useCallback((kind: Toast["kind"], text: string) => {
        const id = ++toastSeq.current;
        setToasts((t) => [...t.slice(-3), { id, kind, text }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    }, []);

    const selectStrategy = useCallback((s: Strategy | null) => {
        setSelectedStrategy(s);
    }, []);

    const upsertStrategyInList = useCallback((s: Strategy) => {
        setStrategies((list) => {
            const i = list.findIndex((x) => x.id === s.id);
            if (i === -1) return [s, ...list];
            const next = [...list];
            next[i] = s;
            return next;
        });
    }, []);

    // ── initial loads ──
    // NOTE: no synchronous setState before the first await — these are called
    // from an effect, so the loading flags start `true` (declared above) and
    // are cleared after the fetches resolve.
    const loadStrategies = useCallback(async (t: string) => {
        try {
            const res = await strategyLabApi.listStrategies(t);
            setStrategies(res.strategies);
            setSelectedStrategy((prev) => {
                if (prev) {
                    const fresh = res.strategies.find((s) => s.id === prev.id);
                    return fresh ?? prev;
                }
                return res.strategies[0] ?? null;
            });
        } catch {
            // loaded later
        } finally {
            setStrategiesBusy(false);
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
        } finally {
            setEAsBusy(false);
        }
    }, []);

    useEffect(() => {
        if (!token) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; the setStates fire in fetch continuations after awaits, never synchronously in the effect body
        void Promise.all([loadStrategies(token), loadDeployments(token), loadEAs(token)]);
    }, [token, loadStrategies, loadDeployments, loadEAs]);

    // ── action wrapper: global running flag + error toast ──
    const run = useCallback(async (fn: () => Promise<void>) => {
        if (!token) {
            setError("Please sign in to use the Strategy Lab.");
            return;
        }
        setRunning(true);
        try {
            await fn();
        } catch (err) {
            pushToast("error", err instanceof Error ? err.message : "Something went wrong.");
        } finally {
            setRunning(false);
        }
    }, [token, pushToast]);

    // ── step completion (drives the rail) ──
    const stepDone: Record<Step, boolean> = {
        market: !!analysis,
        patterns: patterns.length > 0,
        strategy: !!selectedStrategy,
        backtest: !!backtest,
        optimize: !!optimization,
        validate: !!validation,
        deploy: deployments.length > 0,
        ea: eas.length > 0,
        dna: false,
    };

    const goTo = useCallback((s: Step) => {
        setStep(s);
        setError(null);
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    }, []);

    const stepIndex = STEP_ORDER.indexOf(step);
    const goNext = () => stepIndex < STEP_ORDER.length - 1 && goTo(STEP_ORDER[stepIndex + 1]);
    const goPrev = () => stepIndex > 0 && goTo(STEP_ORDER[stepIndex - 1]);

    return (
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {/* Header */}
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
                {token && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-lg border border-border/20 bg-foreground/10 px-2.5 py-1">{symbol}</span>
                        <span className="rounded-lg border border-border/20 bg-foreground/10 px-2.5 py-1">{period}</span>
                        <span className="rounded-lg border border-border/20 bg-foreground/10 px-2.5 py-1">
                            {hierarchy.macro}/{hierarchy.structure}/{hierarchy.setup}/{hierarchy.entry}
                        </span>
                    </div>
                )}
            </div>

            <ErrorBanner error={error} onClose={() => setError(null)} />

            {!token ? (
                <div className="mt-8 rounded-2xl border border-border/20 bg-card p-10 text-center text-sm text-muted-foreground">
                    Sign in to start building strategies.
                </div>
            ) : (
                <>
                    {/* Pipeline rail */}
                    <div className="mt-6 rounded-2xl border border-border/20 bg-card p-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                            {STEP_ORDER.map((s, i) => {
                                const meta = STEP_META[s];
                                const Icon = meta.icon;
                                const active = step === s;
                                const done = stepDone[s] && !active;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => goTo(s)}
                                        title={meta.hint}
                                        className={`group inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                                            active
                                                ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                                                : done
                                                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300/90 hover:bg-emerald-500/10"
                                                    : "border-transparent text-muted-foreground hover:bg-background/20 hover:text-foreground"
                                        }`}
                                    >
                                        {done ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                        ) : active ? (
                                            <Icon className="h-4 w-4" />
                                        ) : (
                                            <CircleDashed className="h-4 w-4 opacity-50" />
                                        )}
                                        <span className="hidden lg:inline">{meta.n} · {meta.label}</span>
                                        <span className="lg:hidden">{meta.n}</span>
                                        {i < STEP_ORDER.length - 1 && <ChevronRight className="hidden h-3 w-3 opacity-30 xl:inline" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Shared market context — visible on every step so the workspace never loses its anchors */}
                    <div className="mt-4 grid gap-3 rounded-2xl border border-border/20 bg-card p-4 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
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
                        <Field label="Pattern / Setup TF">
                            <select value={patternTf} onChange={(e) => setPatternTf(e.target.value as Timeframe)} className={selCls}>
                                {UI_TFS.map((t) => <option key={t} value={t}>{TIMEFRAME_LABEL[t]}</option>)}
                            </select>
                        </Field>
                        <div className="flex items-end">
                            {selectedStrategy ? (
                                <StrategyPill
                                    strategy={selectedStrategy}
                                    onOpen={() => goTo("strategy")}
                                    mismatch={selectedStrategy.asset !== symbol}
                                />
                            ) : (
                                <button
                                    onClick={() => goTo("strategy")}
                                    className="w-full rounded-xl border border-dashed border-border/20 px-3 py-2 text-left text-xs text-muted-foreground transition hover:border-amber-500/40 hover:text-foreground"
                                >
                                    No strategy selected — pick or generate one →
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Step content */}
                    <div className="mt-6">
                        {step === "market" && (
                            <MarketTab
                                token={token} symbol={symbol} period={period} hierarchy={hierarchy}
                                analysis={analysis} aiSummary={aiSummary} busy={analysisBusy} running={running}
                                coverage={dataCoverage} setCoverage={setDataCoverage}
                                setAnalysis={setAnalysis} setAiSummary={setAiSummary} setBusy={setAnalysisBusy}
                                run={run} pushToast={pushToast}
                            />
                        )}
                        {step === "patterns" && (
                            <PatternsTab
                                token={token} symbol={symbol} period={period} patternTf={patternTf}
                                patterns={patterns} busy={patternsBusy} running={running}
                                selectedPattern={selectedPattern} setSelectedPattern={setSelectedPattern}
                                setPatterns={setPatterns} setBusy={setPatternsBusy}
                                run={run} pushToast={pushToast} goTo={goTo}
                            />
                        )}
                        {step === "strategy" && (
                            <StrategyTab
                                token={token} symbol={symbol} period={period}
                                selectedPattern={selectedPattern} clearPattern={() => setSelectedPattern(null)}
                                strategies={strategies} strategiesBusy={strategiesBusy}
                                selectedStrategy={selectedStrategy} setSelectedStrategy={selectStrategy}
                                setStrategies={setStrategies} upsert={upsertStrategyInList}
                                running={running} run={run} pushToast={pushToast} goTo={goTo}
                            />
                        )}
                        {step === "backtest" && (
                            <BacktestTab
                                token={token} symbol={symbol}
                                selectedStrategy={selectedStrategy} goTo={goTo}
                                backtest={backtest} busy={backtestBusy} running={running}
                                setBacktest={setBacktest} setBusy={setBacktestBusy}
                                run={run} pushToast={pushToast}
                            />
                        )}
                        {step === "optimize" && (
                            <OptimizeTab
                                token={token} symbol={symbol}
                                selectedStrategy={selectedStrategy} goTo={goTo}
                                optimization={optimization} busy={optimizeBusy} running={running}
                                setOptimization={setOptimization} setBusy={setOptimizeBusy}
                                upsert={upsertStrategyInList} setSelectedStrategy={selectStrategy}
                                run={run} pushToast={pushToast}
                            />
                        )}
                        {step === "validate" && (
                            <ValidateTab
                                token={token} symbol={symbol}
                                selectedStrategy={selectedStrategy} goTo={goTo}
                                validation={validation} robustness={robustness} busy={validateBusy} running={running}
                                setValidation={setValidation} setRobustness={setRobustness} setBusy={setValidateBusy}
                                run={run}
                            />
                        )}
                        {step === "deploy" && (
                            <DeployTab
                                token={token} symbol={symbol}
                                selectedStrategy={selectedStrategy} goTo={goTo}
                                forwardTest={forwardTest} setForwardTest={setForwardTest}
                                deployments={deployments} refreshDeployments={loadDeployments}
                                deployBusy={deployBusy} setDeployBusy={setDeployBusy}
                                running={running} run={run} pushToast={pushToast}
                            />
                        )}
                        {step === "ea" && (
                            <EATab
                                token={token} symbol={symbol} hierarchy={hierarchy}
                                setStrategies={setStrategies}
                                selectedStrategy={selectedStrategy} setSelectedStrategy={selectStrategy}
                                eas={eas} easBusy={easBusy} selectedEA={selectedEA} setSelectedEA={setSelectedEA}
                                setEAs={setEAs} setEAsBusy={setEAsBusy}
                                running={running} run={run} pushToast={pushToast} goTo={goTo}
                            />
                        )}
                        {step === "dna" && (
                            <DnaEvolutionTab token={token} symbol={symbol} period={period} run={run} />
                        )}
                    </div>

                    {/* Step navigation */}
                    <div className="mt-8 flex items-center justify-between border-t border-border/10 pt-4">
                        <Btn onClick={goPrev} disabled={stepIndex === 0} variant="ghost">
                            <ChevronLeft className="h-4 w-4" /> {stepIndex > 0 ? STEP_META[STEP_ORDER[stepIndex - 1]].label : "Start"}
                        </Btn>
                        <span className="text-xs text-muted-foreground">
                            Step {STEP_META[step].n} of {STEP_ORDER.length} — {STEP_META[step].hint}
                        </span>
                        <Btn onClick={goNext} disabled={stepIndex === STEP_ORDER.length - 1} variant="ghost">
                            {stepIndex < STEP_ORDER.length - 1 ? STEP_META[STEP_ORDER[stepIndex + 1]].label : "Done"} <ChevronRight className="h-4 w-4" />
                        </Btn>
                    </div>
                </>
            )}

            {/* Toasts */}
            <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        className={`pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-sm shadow-lg backdrop-blur ${
                            t.kind === "success"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                : t.kind === "error"
                                    ? "border-red-500/40 bg-red-500/10 text-red-200"
                                    : "border-border/30 bg-card text-foreground/80"
                        }`}
                    >
                        {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                        <span className="flex-1">{t.text}</span>
                        <button
                            className="text-foreground/50 hover:text-foreground"
                            onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
                            aria-label="Dismiss"
                        >×</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─────────────────────────── shared bits ───────────────────────────────────

function StrategyPill({ strategy, onOpen, mismatch }: { strategy: Strategy; onOpen: () => void; mismatch?: boolean }) {
    return (
        <button
            onClick={onOpen}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-left transition hover:bg-amber-500/10"
            title="Open in Strategy step"
        >
            <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-amber-300">{strategy.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                    {strategy.asset} · {strategy.direction} · {strategy.timeframes.setup}
                    {mismatch ? " · ⚠ different symbol" : ""}
                </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-amber-400" />
        </button>
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

function StrategyDetail({
    strategy, onRename,
}: {
    strategy: Strategy;
    onRename?: (name: string) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(strategy.name);
    const [saving, setSaving] = useState(false);
    const rr = strategy.takeProfit.r1;

    const save = async () => {
        const trimmed = name.trim();
        setEditing(false);
        if (!trimmed || trimmed === strategy.name || !onRename) return;
        setSaving(true);
        try { await onRename(trimmed); } finally { setSaving(false); }
    };

    return (
        <div className="rounded-2xl border border-border/20 bg-card p-5">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    {editing ? (
                        <div className="flex items-center gap-2">
                            <input
                                className={inputCls}
                                value={name}
                                autoFocus
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
                            />
                            <Btn onClick={() => void save()} busy={saving} variant="ghost">Save</Btn>
                        </div>
                    ) : (
                        <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                            {strategy.name}
                            {onRename && (
                                <button
                                    className="text-foreground/40 transition hover:text-amber-300"
                                    onClick={() => { setName(strategy.name); setEditing(true); }}
                                    aria-label="Rename strategy"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </h3>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-foreground/70">
                        <span>{strategy.asset}</span>
                        <span>{strategy.timeframes.macro}/{strategy.timeframes.structure}/{strategy.timeframes.setup}/{strategy.timeframes.entry}</span>
                        <span>SL {strategy.stopLoss.atrMultiple}×ATR</span>
                        <span>TP {rr}R</span>
                        <span>risk {strategy.risk.riskPercent}%</span>
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

/**
 * Shows exactly how much real history the feed returned per timeframe, so the
 * partial-window reality of the upstream data is visible instead of hidden.
 */
function DataCoveragePanel({ coverage, symbol }: { coverage: DataCoverage[]; symbol: string }) {
    if (coverage.length === 0) return null;
    return (
        <div className="rounded-2xl border border-border/20 bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-widest text-foreground/70">Data coverage — {symbol}</div>
                <div className="text-[11px] text-muted-foreground">Feed caps history per timeframe; the lab runs on the real bars it returns.</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {coverage.map((c) => (
                    <div key={c.timeframe} className="rounded-xl border border-border/10 bg-foreground/10 p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-foreground">{c.timeframe}</span>
                            <span className={`rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                c.availableBars === 0
                                    ? "border-red-500/40 text-red-300"
                                    : c.fullyCoversRequest
                                        ? "border-emerald-500/40 text-emerald-300"
                                        : "border-amber-500/40 text-amber-300"
                            }`}>
                                {c.availableBars === 0 ? "no data" : c.fullyCoversRequest ? "full window" : "partial"}
                            </span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                            <span>Bars <span className="font-mono text-foreground">{c.availableBars}</span></span>
                            <span>Span <span className="font-mono text-foreground">{fmt(c.spanDays, 1)}d</span></span>
                            <span className="col-span-2 truncate" title={c.availableFrom ? new Date(c.availableFrom).toLocaleString() : ""}>
                                {c.availableFrom ? `${new Date(c.availableFrom).toLocaleDateString()} → ${new Date(c.availableTo).toLocaleDateString()}` : "—"}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function EquityCurve({ equity }: { equity: { time: number; balance: number; equity: number }[] }) {
    const data = useMemo(
        () => equity.map((p) => ({ ...p, label: new Date(p.time).toLocaleDateString() })),
        [equity]
    );
    return (
        <div className="rounded-2xl border border-border/20 bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <LineChartIcon className="h-4 w-4 text-amber-400" /> Equity curve
                <span className="text-xs font-normal text-muted-foreground">— balance vs equity incl. open risk</span>
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
                        <Area type="monotone" dataKey="equity" stroke="#818cf8" strokeWidth={1} fillOpacity={0} name="Equity" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// ───────────────────────────── 1 · Market Analysis ─────────────────────────────

function MarketTab({
    token, symbol, period, hierarchy,
    analysis, aiSummary, busy, running,
    coverage, setCoverage,
    setAnalysis, setAiSummary, setBusy, run, pushToast,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    period: AnalysisPeriod;
    hierarchy: TimeframeHierarchy;
    analysis: MarketAnalysisSet | null;
    aiSummary: AnalysisApiResponse["aiSummary"];
    busy: boolean;
    running: boolean;
    coverage: DataCoverage[];
    setCoverage: (c: DataCoverage[]) => void;
    setAnalysis: (a: MarketAnalysisSet | null) => void;
    setAiSummary: (s: AnalysisApiResponse["aiSummary"]) => void;
    setBusy: (b: boolean) => void;
    run: (fn: () => Promise<void>) => Promise<void>;
    pushToast: (kind: Toast["kind"], text: string) => void;
}) {
    const doAnalyze = () =>
        run(async () => {
            setBusy(true);
            try {
                const res = await strategyLabApi.analyze(token, symbol, period, hierarchy);
                if (!res.analysis) {
                    // Server replied 200 but with no analysis (feed down / empty).
                    pushToast("error", res.error ?? "No historical data available from the market data feed.");
                    setAnalysis(null);
                    setAiSummary(null);
                    setCoverage(res.coverage ?? []);
                    return;
                }
                setAnalysis(res.analysis ?? null);
                setAiSummary(res.aiSummary);
                setCoverage(res.coverage ?? []);
                const tfs = Object.keys(res.analysis.byTimeframe ?? {});
                pushToast(
                    "success",
                    tfs.length > 0
                        ? `Analysis ready for ${tfs.join(" · ")} (partial history — see coverage).`
                        : "Analysis complete."
                );
            } finally {
                setBusy(false);
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Multi-timeframe market analysis"
                desc="Analyzes macro → structure → setup → entry alignment, liquidity, volatility and session behavior on real candles."
                action={<Btn onClick={doAnalyze} busy={busy || running}><Sparkles className="h-4 w-4" /> {analysis ? "Re-analyze" : "Analyze"} {symbol} {period}</Btn>}
            />

            {coverage.length > 0 && (
                <DataCoveragePanel coverage={coverage} symbol={symbol} />
            )}

            {!analysis && !busy ? (
                <EmptyState
                    icon={FileSearch}
                    title={`No analysis yet for ${symbol} ${period}`}
                    body="Run the analyzer to build the multi-timeframe read this lab works from. Every later step uses the same candles."
                    cta={<Btn onClick={doAnalyze}><Sparkles className="h-4 w-4" /> Analyze Market</Btn>}
                />
            ) : (
                analysis && (
                    <div className="flex flex-col gap-6">
                        {aiSummary && (
                            <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-background/40 to-background p-5">
                                <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                                    <Sparkles className="h-4 w-4" /> AI Summary {aiSummary.generatedBy === "openai" ? "(GPT)" : "(local)"}
                                </div>
                                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/70">{aiSummary.summary}</p>
                            </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {analysis.byTimeframe && Object.entries(analysis.byTimeframe).map(([tf, r]) => r && (
                                <div key={tf} className="rounded-2xl border border-border/20 bg-card p-4">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{tf}</div>
                                        <DirectionBadge dir={(r.trend?.bias ?? "neutral") as "long" | "short"} />
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                        <div><div className="text-[10px] uppercase text-foreground/70">Regime</div><div className="font-semibold text-foreground">{r.trend?.regime ?? "–"}</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">ATR %</div><div className="font-semibold text-foreground">{fmtPct(r.volatility?.atrPercent)}</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">Structure</div><div className="font-semibold capitalize text-foreground">{r.structure?.overall ?? "–"}</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">BOS / CHOCH</div><div className="font-semibold text-foreground">{r.structure?.bosCount ?? 0} / {r.structure?.chochCount ?? 0}</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">Market Score</div><div className="font-semibold text-foreground">{r.score?.total ?? "–"}/100</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">Sweeps</div><div className="font-semibold text-foreground">{r.liquidity?.sweeps?.length ?? 0}</div></div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-xl border border-border/20 bg-card p-4 text-sm text-muted-foreground">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/70">Cross-timeframe reads</div>
                            {analysis.relationships?.length ? (
                                <ul className="flex flex-col gap-2">
                                    {analysis.relationships.map((rel, i) => <li key={i}>• {rel}</li>)}
                                </ul>
                            ) : (
                                <div>No cross-timeframe reads available for this period.</div>
                            )}
                        </div>
                    </div>
                )
            )}
        </div>
    );
}

// ───────────────────────────── 2 · Pattern Discovery ───────────────────────────

function PatternsTab({
    token, symbol, period, patternTf,
    patterns, busy, running,
    selectedPattern, setSelectedPattern,
    setPatterns, setBusy, run, pushToast, goTo,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    period: AnalysisPeriod;
    patternTf: Timeframe;
    patterns: Pattern[];
    busy: boolean;
    running: boolean;
    selectedPattern: Pattern | null;
    setSelectedPattern: (p: Pattern | null) => void;
    setPatterns: (p: Pattern[]) => void;
    setBusy: (b: boolean) => void;
    run: (fn: () => Promise<void>) => Promise<void>;
    pushToast: (kind: Toast["kind"], text: string) => void;
    goTo: (s: Step) => void;
}) {
    const discover = () =>
        run(async () => {
            setBusy(true);
            try {
                const res = await strategyLabApi.patterns(token, symbol, period, patternTf, 10);
                setPatterns(res.patterns);
                if (res.patterns.length === 0) {
                    pushToast("info", `No statistically viable patterns on ${symbol} ${patternTf}. Try another timeframe or period.`);
                } else {
                    pushToast("success", `Found ${res.patterns.length} pattern${res.patterns.length === 1 ? "" : "s"} on ${symbol} ${patternTf}.`);
                }
            } finally {
                setBusy(false);
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Pattern discovery"
                desc="Discovers recurring market structures with measured outcomes — win rate, average R, profit factor — never theoretical setups."
                action={<Btn onClick={discover} busy={busy || running}><Layers className="h-4 w-4" /> Discover on {symbol} {patternTf}</Btn>}
            />

            {patterns.length === 0 && !busy ? (
                <EmptyState
                    icon={Layers}
                    title={`No patterns discovered yet`}
                    body={`Run discovery to scan ${symbol} ${patternTf} history for recurring structures with measured outcomes.`}
                    cta={<Btn onClick={discover}><Layers className="h-4 w-4" /> Discover Patterns</Btn>}
                />
            ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {patterns.map((p) => {
                        const selected = selectedPattern?.id === p.id;
                        return (
                            <button
                                key={p.id}
                                onClick={() => setSelectedPattern(selected ? null : p)}
                                className={`rounded-2xl border p-4 text-left transition ${
                                    selected
                                        ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/40"
                                        : "border-border/20 bg-card hover:bg-background/20"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="truncate font-semibold text-foreground">{p.name}</div>
                                        <div className="text-xs capitalize text-foreground/70">{p.kind.replace(/_/g, " ")} · {p.timeframe}</div>
                                    </div>
                                    <DirectionBadge dir={p.direction} />
                                </div>
                                {p.stats ? (
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                        <div><div className="text-[10px] uppercase text-foreground/70">Win rate</div><div className="font-semibold text-emerald-300">{fmtPct(p.stats.winRate)}</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">Avg R</div><div className="font-semibold text-foreground">{fmt(p.stats.averageR)}</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">Profit factor</div><div className="font-semibold text-foreground">{fmt(p.stats.profitFactor)}</div></div>
                                        <div><div className="text-[10px] uppercase text-foreground/70">Occurrences</div><div className="font-semibold text-foreground/70">{p.stats.occurrences}</div></div>
                                    </div>
                                ) : (
                                    <div className="mt-3 text-xs text-muted-foreground">{p.matchCount} raw matches — below the statistical threshold.</div>
                                )}
                                {selected && (
                                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
                                        Selected — generate a strategy from this pattern in step 3.
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {selectedPattern && (
                <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-foreground/70">
                        <span className="font-semibold text-amber-300">{selectedPattern.name}</span> selected
                        ({selectedPattern.stats?.occurrences ?? selectedPattern.matchCount} occurrences on {selectedPattern.timeframe}).
                        <div className="mt-1 text-xs text-foreground/60">Outcomes are measured on live historical data — always validate before deploying.</div>
                    </div>
                    <Btn onClick={() => goTo("strategy")}><Wand2 className="h-4 w-4" /> Generate strategy →</Btn>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────── 3 · Strategy ────────────────────────────────────

function StrategyTab({
    token, symbol, period,
    selectedPattern, clearPattern,
    strategies, strategiesBusy,
    selectedStrategy, setSelectedStrategy,
    setStrategies, upsert,
    running, run, pushToast, goTo,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    period: AnalysisPeriod;
    selectedPattern: Pattern | null;
    clearPattern: () => void;
    strategies: Strategy[];
    strategiesBusy: boolean;
    selectedStrategy: Strategy | null;
    setSelectedStrategy: (s: Strategy | null) => void;
    setStrategies: (s: Strategy[]) => void;
    upsert: (s: Strategy) => void;
    running: boolean;
    run: (fn: () => Promise<void>) => Promise<void>;
    pushToast: (kind: Toast["kind"], text: string) => void;
    goTo: (s: Step) => void;
}) {
    const [direction, setDirection] = useState<"long" | "short">("long");
    const [generating, setGenerating] = useState(false);

    const refresh = async (t: string) => {
        const res = await strategyLabApi.listStrategies(t);
        setStrategies(res.strategies);
    };

    const generate = () =>
        run(async () => {
            setGenerating(true);
            try {
                const res = await strategyLabApi.generateStrategy(token, {
                    symbol,
                    period,
                    pattern: selectedPattern,
                    direction: selectedPattern ? undefined : direction,
                });
                await refresh(token);
                upsert(res.strategy);
                setSelectedStrategy(res.strategy);
                clearPattern();
                pushToast("success", `Strategy generated: ${res.strategy.name}`);
                goTo("backtest");
            } finally {
                setGenerating(false);
            }
        });

    const rename = async (s: Strategy, name: string) => {
        await run(async () => {
            const res = await strategyLabApi.updateStrategy(token, s.id, { name });
            upsert(res.strategy);
            if (selectedStrategy?.id === s.id) setSelectedStrategy(res.strategy);
            pushToast("success", "Strategy renamed.");
        });
    };

    const remove = async (s: Strategy) => {
        if (!window.confirm(`Delete strategy "${s.name}"? Backtests and deployments referencing it are kept.`)) return;
        await run(async () => {
            await strategyLabApi.deleteStrategy(token, s.id);
            setStrategies(strategies.filter((x) => x.id !== s.id));
            if (selectedStrategy?.id === s.id) setSelectedStrategy(null);
            pushToast("success", `Deleted ${s.name}.`);
        });
    };

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <SectionHeader
                        title="Generate a strategy"
                        desc={selectedPattern
                            ? `Based on the selected pattern: ${selectedPattern.name}`
                            : "Generate from the market bias discovered in the analysis, or pick a pattern first in step 2."}
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-4">
                        <div className="flex gap-2">
                            <button
                                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${direction === "long" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-border/20 bg-foreground/10 text-muted-foreground"}`}
                                onClick={() => setDirection("long")}
                                disabled={!!selectedPattern}
                            >
                                Long
                            </button>
                            <button
                                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${direction === "short" ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-border/20 bg-foreground/10 text-muted-foreground"}`}
                                onClick={() => setDirection("short")}
                                disabled={!!selectedPattern}
                            >
                                Short
                            </button>
                        </div>
                        <Btn onClick={generate} busy={generating || running}>
                            <Wand2 className="h-4 w-4" /> Generate {symbol} strategy
                        </Btn>
                    </div>
                </div>

                {selectedStrategy && (
                    <StrategyDetail
                        strategy={selectedStrategy}
                        onRename={(name) => rename(selectedStrategy, name)}
                    />
                )}
            </div>

            <div className="rounded-2xl border border-border/20 bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-bold text-foreground">Saved strategies</h3>
                    <span className="text-xs text-foreground/70">{strategies.length}</span>
                </div>
                <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1">
                    {strategies.length === 0 && !strategiesBusy ? (
                        <EmptyState
                            icon={Wand2}
                            title="No strategies saved yet"
                            body="Generate your first strategy — from the market bias or from a discovered pattern."
                        />
                    ) : (
                        strategies.map((s) => (
                            <div
                                key={s.id}
                                className={`group rounded-xl border p-3 transition ${
                                    selectedStrategy?.id === s.id ? "border-amber-500/50 bg-amber-500/10" : "border-border/20 bg-foreground/10 hover:bg-background/20"
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedStrategy(s)}>
                                        <span className="block truncate font-semibold text-foreground">{s.name}</span>
                                        <span className="mt-1 flex flex-wrap gap-2 text-[11px] text-foreground/70">
                                            <span>{s.asset}</span>
                                            <span>{s.timeframes.setup}</span>
                                            <span>{s.entryRules.filter((r) => r.enabled).length} entry rules</span>
                                            <span>{s.regimeFilter.join(", ") || "any regime"}</span>
                                        </span>
                                    </button>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <DirectionBadge dir={s.direction} />
                                        <button
                                            className="rounded-lg p-1.5 text-foreground/30 opacity-0 transition hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                                            onClick={() => void remove(s)}
                                            aria-label={`Delete ${s.name}`}
                                            title="Delete strategy"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// ───────────────────────────── 4 · Backtest ────────────────────────────────────

function BacktestTab({
    token, symbol, selectedStrategy, goTo,
    backtest, busy, running,
    setBacktest, setBusy, run, pushToast,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    selectedStrategy: Strategy | null;
    goTo: (s: Step) => void;
    backtest: BacktestResult | null;
    busy: boolean;
    running: boolean;
    setBacktest: (b: BacktestResult | null) => void;
    setBusy: (b: boolean) => void;
    run: (fn: () => Promise<void>) => Promise<void>;
    pushToast: (kind: Toast["kind"], text: string) => void;
}) {
    const [cfg, setCfg] = useState({ initialBalance: 10000, riskPercent: 1, spreadPips: 20, commissionPerLot: 7, slippagePips: 1 });
    const [showCfg, setShowCfg] = useState(false);

    const launch = () =>
        run(async () => {
            if (!selectedStrategy) return;
            setBusy(true);
            try {
                const res = await strategyLabApi.backtest(token, {
                    symbol,
                    strategy: selectedStrategy,
                    config: cfg,
                });
                setBacktest(res.backtest);
                pushToast("success", `Backtest done — ${res.backtest.metrics.totalTrades} trades, ${fmtPct(res.backtest.metrics.returnPct)} return.`);
            } finally {
                setBusy(false);
            }
        });

    const exportCsv = () => {
        if (!backtest) return;
        const header = "ticket,openedAt,closedAt,direction,entry,exit,exitReason,R,pnl\n";
        const rows = backtest.trades
            .map((t) => [t.ticket, new Date(t.openedAt).toISOString(), new Date(t.closedAt).toISOString(), t.direction, t.entry, t.exit, t.exitReason, t.profitR, t.pnlGross].join(","))
            .join("\n");
        const blob = new Blob([header + rows], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${backtest.strategyName.replace(/\s+/g, "-")}-${symbol}-backtest.csv`;
        a.click();
        URL.revokeObjectURL(url);
        pushToast("success", "Trades exported as CSV.");
    };

    const m = backtest?.metrics;
    const beatsBuyHold = !!m && m.returnPct >= m.buyHoldReturnPct;

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Backtest"
                desc={selectedStrategy
                    ? `Runs ${selectedStrategy.name} on real ${symbol} candles (${selectedStrategy.timeframes.setup} entries, ${selectedStrategy.executionModel.replace("_", " ")}).`
                    : "Select a strategy in step 3 to backtest."}
                action={
                    <div className="flex items-center gap-2">
                        <Btn onClick={() => setShowCfg((v) => !v)} variant="ghost">⚙ Cost &amp; risk</Btn>
                        <Btn onClick={launch} busy={busy || running} disabled={!selectedStrategy}>
                            <Play className="h-4 w-4" /> Run Backtest
                        </Btn>
                    </div>
                }
            />

            {!selectedStrategy && (
                <EmptyState
                    icon={BarChart3}
                    title="No strategy selected"
                    body="Generate a strategy from the market analysis or from a discovered pattern, then come back here."
                    cta={<Btn onClick={() => goTo("strategy")}><Wand2 className="h-4 w-4" /> Go to Strategy</Btn>}
                />
            )}

            {showCfg && selectedStrategy && (
                <div className="grid gap-3 rounded-2xl border border-border/20 bg-card p-4 sm:grid-cols-3 lg:grid-cols-5">
                    <Field label="Initial balance ($)">
                        <input type="number" min={100} className={inputCls} value={cfg.initialBalance} onChange={(e) => setCfg({ ...cfg, initialBalance: Number(e.target.value) || 10000 })} />
                    </Field>
                    <Field label="Risk / trade (%)">
                        <input type="number" min={0.1} step={0.1} className={inputCls} value={cfg.riskPercent} onChange={(e) => setCfg({ ...cfg, riskPercent: Number(e.target.value) || 1 })} />
                    </Field>
                    <Field label="Spread (pips)">
                        <input type="number" min={0} className={inputCls} value={cfg.spreadPips} onChange={(e) => setCfg({ ...cfg, spreadPips: Number(e.target.value) || 0 })} />
                    </Field>
                    <Field label="Commission ($/lot)">
                        <input type="number" min={0} className={inputCls} value={cfg.commissionPerLot} onChange={(e) => setCfg({ ...cfg, commissionPerLot: Number(e.target.value) || 0 })} />
                    </Field>
                    <Field label="Slippage (pips)">
                        <input type="number" min={0} className={inputCls} value={cfg.slippagePips} onChange={(e) => setCfg({ ...cfg, slippagePips: Number(e.target.value) || 0 })} />
                    </Field>
                </div>
            )}

            {backtest && m && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Net profit" value={fmtUsd(m.netProfit)} tone={m.netProfit >= 0 ? "text-emerald-300" : "text-red-300"} sub={`final ${fmtUsd(m.finalBalance)}`} />
                        <Stat label="Return" value={fmtPct(m.returnPct)} tone={m.returnPct >= 0 ? "text-emerald-300" : "text-red-300"} sub={`buy & hold ${fmtPct(m.buyHoldReturnPct)} ${beatsBuyHold ? "· beaten ✓" : ""}`} />
                        <Stat label="Win rate" value={fmtPct(m.winRate)} sub={`${m.winningTrades}W / ${m.losingTrades}L / ${m.breakevenTrades}BE`} />
                        <Stat label="Profit factor" value={fmt(m.profitFactor)} tone={m.profitFactor >= 1.3 ? "text-emerald-300" : m.profitFactor >= 1 ? "text-amber-300" : "text-red-300"} />
                        <Stat label="Expectancy" value={`${fmt(m.expectancyR)}R`} sub={fmtUsd(m.expectancy)} />
                        <Stat label="Max drawdown" value={fmtPct(m.maxDrawdownPct)} tone="text-red-300" sub={fmtUsd(-m.maxDrawdownAbs)} />
                        <Stat label="Trades" value={m.totalTrades} sub={`${m.longTrades} long · ${m.shortTrades} short`} />
                        <Stat label="Sharpe-like" value={fmt(m.sharpeLike)} sub={`recovery ${fmt(m.recoveryFactor)}`} />
                    </div>

                    {backtest.equity.length > 1 && <EquityCurve equity={backtest.equity} />}

                    {m.totalTrades === 0 && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground/70">
                            <span className="font-semibold text-amber-300">No trades fired.</span>{" "}
                            The strategy entries on {backtest.timeframe}, and the feed only provides{" "}
                            {backtest.coverage.availableBars} bars (~{fmt(backtest.coverage.spanDays, 1)} days) for that timeframe —
                            the regime/entry filters may simply not trigger in such a short window. Options: generate a{" "}
                            <span className="font-semibold text-foreground">D1</span> strategy (deepest history), pick a pattern on a
                            higher timeframe in step 2, or relax the entry rules.
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">
                            Showing {Math.min(backtest.trades.length, 50)} of {backtest.trades.length} trades ·
                            streaks {m.maxConsecutiveWins}W / {m.maxConsecutiveLosses}L ·
                            avg win {fmtUsd(m.averageWin)} / avg loss {fmtUsd(-m.averageLoss)}
                        </div>
                        <Btn onClick={exportCsv} variant="ghost"><Download className="h-4 w-4" /> Export CSV</Btn>
                    </div>

                    <div className="max-h-[420px] overflow-auto rounded-xl border border-border/20 bg-card">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 border-b border-border/20 bg-card text-[11px] uppercase tracking-widest text-foreground/70">
                                <tr>
                                    <th className="px-3 py-2">Opened</th>
                                    <th className="px-3 py-2">Dir</th>
                                    <th className="px-3 py-2">Entry</th>
                                    <th className="px-3 py-2">Exit</th>
                                    <th className="px-3 py-2">Exit reason</th>
                                    <th className="px-3 py-2">R</th>
                                    <th className="px-3 py-2">P/L</th>
                                </tr>
                            </thead>
                            <tbody>
                                {backtest.trades.slice(0, 50).map((t) => (
                                    <tr key={t.id || t.ticket} className="border-b border-border/10">
                                        <td className="px-3 py-2 text-muted-foreground">{new Date(t.openedAt).toLocaleString()}</td>
                                        <td className="px-3 py-2"><DirectionBadge dir={t.direction} /></td>
                                        <td className="px-3 py-2 text-foreground">{fmt(t.entry, 2)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmt(t.exit, 2)}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{t.exitReason}</td>
                                        <td className={`px-3 py-2 text-foreground ${t.profitR >= 0 ? "text-emerald-300" : "text-red-300"}`}>{fmt(t.profitR)}</td>
                                        <td className={`px-3 py-2 font-semibold ${t.pnlGross >= 0 ? "text-emerald-300" : "text-red-300"}`}>{fmtUsd(t.pnlGross)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {selectedStrategy && !backtest && !busy && (
                <EmptyState
                    icon={BarChart3}
                    title={`Ready to backtest ${selectedStrategy.name}`}
                    body="The engine replays every closed bar with realistic spread, commission and slippage. Tune the cost model via ⚙ Cost & risk."
                    cta={<Btn onClick={launch}><Play className="h-4 w-4" /> Run Backtest</Btn>}
                />
            )}
        </div>
    );
}

// ───────────────────────────── 5 · Optimize ────────────────────────────────────

type GridParam = "slAtr" | "tp1R" | "tp2R" | "tp3R" | "riskPercent";

const PARAM_META: Record<GridParam, { label: string; min: number; max: number; step: number }> = {
    slAtr: { label: "Stop (× ATR)", min: 0.5, max: 4, step: 0.5 },
    tp1R: { label: "TP1 (R)", min: 0.5, max: 4, step: 0.5 },
    tp2R: { label: "TP2 (R)", min: 1, max: 6, step: 1 },
    tp3R: { label: "TP3 (R)", min: 2, max: 10, step: 1 },
    riskPercent: { label: "Risk (%)", min: 0.25, max: 2, step: 0.25 },
};

function buildValues(min: number, max: number, step: number): number[] {
    const out: number[] = [];
    for (let v = min; v <= max + 1e-9 && out.length < 8; v += step) out.push(Number(v.toFixed(4)));
    return out.length ? out : [min];
}

function applyBestParams(base: Strategy, config: Record<string, unknown>): Strategy {
    const next = JSON.parse(JSON.stringify(base)) as Strategy;
    for (const [k, raw] of Object.entries(config)) {
        const v = Number(raw);
        if (Number.isNaN(v)) continue;
        switch (k) {
            case "slAtr": next.stopLoss.atrMultiple = v; break;
            case "tp1R":
                next.takeProfit.r1 = v;
                next.takeProfit.partialCloses = next.takeProfit.partialCloses.map((p) => (p.atR > 0 ? { ...p, atR: v } : p));
                break;
            case "tp2R": next.takeProfit.r2 = v; break;
            case "tp3R": next.takeProfit.r3 = v; break;
            case "riskPercent": next.risk.riskPercent = v; next.risk.mode = "percent"; break;
        }
    }
    return next;
}

function OptimizeTab({
    token, symbol, selectedStrategy, goTo,
    optimization, busy, running,
    setOptimization, setBusy,
    upsert, setSelectedStrategy,
    run, pushToast,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    selectedStrategy: Strategy | null;
    goTo: (s: Step) => void;
    optimization: OptimizationOutcome | null;
    busy: boolean;
    running: boolean;
    setOptimization: (o: OptimizationOutcome | null) => void;
    setBusy: (b: boolean) => void;
    upsert: (s: Strategy) => void;
    setSelectedStrategy: (s: Strategy | null) => void;
    run: (fn: () => Promise<void>) => Promise<void>;
    pushToast: (kind: Toast["kind"], text: string) => void;
}) {
    const [enabled, setEnabled] = useState<Record<GridParam, boolean>>({ slAtr: true, tp1R: true, tp2R: false, tp3R: false, riskPercent: false });
    const [grid, setGrid] = useState<Record<GridParam, { min: number; max: number; step: number }>>({
        slAtr: { min: 1, max: 3, step: 0.5 },
        tp1R: { min: 1, max: 3, step: 0.5 },
        tp2R: { min: 2, max: 4, step: 1 },
        tp3R: { min: 3, max: 6, step: 1 },
        riskPercent: { min: 0.5, max: 1.5, step: 0.5 },
    });
    const [maxRuns, setMaxRuns] = useState(80);
    const [applying, setApplying] = useState(false);

    const launch = () =>
        run(async () => {
            if (!selectedStrategy) return;
            setBusy(true);
            try {
                const ranges = (Object.keys(PARAM_META) as GridParam[])
                    .filter((p) => enabled[p])
                    .map((p) => ({ param: p, values: buildValues(grid[p].min, grid[p].max, grid[p].step) }));
                if (ranges.length === 0) {
                    pushToast("error", "Enable at least one parameter to optimize.");
                    return;
                }
                const res = await strategyLabApi.optimize(token, { symbol, strategy: selectedStrategy, ranges, maxRuns });
                setOptimization(res.optimization);
                pushToast("success", `Optimization finished — ${res.optimization.results.length} combinations tested.`);
            } finally {
                setBusy(false);
            }
        });

    const applyBest = (best: OptimizeResult) =>
        run(async () => {
            if (!selectedStrategy) return;
            setApplying(true);
            try {
                const updated = applyBestParams(selectedStrategy, best.config);
                const res = await strategyLabApi.updateStrategy(token, selectedStrategy.id, updated);
                upsert(res.strategy);
                setSelectedStrategy(res.strategy);
                pushToast("success", "Best parameters applied to the strategy. Re-run the backtest, then validate.");
            } finally {
                setApplying(false);
            }
        });

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Parameter optimization"
                desc="Grid search over risk & trade-management parameters, ranked by a transparent composite score. Always re-validate the winner out-of-sample before trusting it."
                action={<Btn onClick={launch} busy={busy || running} disabled={!selectedStrategy}><Gauge className="h-4 w-4" /> Run Optimization</Btn>}
            />

            {!selectedStrategy ? (
                <EmptyState
                    icon={Gauge}
                    title="No strategy selected"
                    body="Pick or generate a strategy first — the optimizer varies its parameters."
                    cta={<Btn onClick={() => goTo("strategy")}><Wand2 className="h-4 w-4" /> Go to Strategy</Btn>}
                />
            ) : (
                <div className="rounded-2xl border border-border/20 bg-card p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-foreground/70">Grid — toggled parameters are varied</div>
                    <div className="flex flex-col gap-2">
                        {(Object.keys(PARAM_META) as GridParam[]).map((p) => {
                            const meta = PARAM_META[p];
                            const g = grid[p];
                            return (
                                <div key={p} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/10 bg-foreground/10 p-3">
                                    <label className="flex w-44 cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
                                        <input type="checkbox" className="accent-amber-500" checked={enabled[p]} onChange={(e) => setEnabled({ ...enabled, [p]: e.target.checked })} />
                                        {meta.label}
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        min
                                        <input type="number" className={`${inputCls} w-20`} value={g.min} step={meta.step} onChange={(e) => setGrid({ ...grid, [p]: { ...g, min: Number(e.target.value) } })} />
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        max
                                        <input type="number" className={`${inputCls} w-20`} value={g.max} step={meta.step} onChange={(e) => setGrid({ ...grid, [p]: { ...g, max: Number(e.target.value) } })} />
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        step
                                        <input type="number" className={`${inputCls} w-20`} value={g.step} step={meta.step / 2 || 0.1} onChange={(e) => setGrid({ ...grid, [p]: { ...g, step: Number(e.target.value) || meta.step } })} />
                                    </label>
                                    <span className="ml-auto text-xs text-foreground/60">{buildValues(g.min, g.max, g.step).length} values</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            Max runs
                            <select className={selCls} value={maxRuns} onChange={(e) => setMaxRuns(Number(e.target.value))}>
                                {[24, 48, 80, 120, 240].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </label>
                        <span className="text-xs text-foreground/60">Grids above the cap are randomly sampled.</span>
                    </div>
                </div>
            )}

            {optimization && (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="Combinations tested" value={optimization.results.length} sub={`score σ ${fmt(optimization.stabilityStdDev)}`} />
                        {optimization.best && (
                            <>
                                <Stat label="Best score" value={fmt(optimization.best.score)} tone="text-amber-300" />
                                <Stat label="Best win rate" value={fmtPct(optimization.best.metrics.winRate)} sub={`PF ${fmt(optimization.best.metrics.profitFactor)}`} />
                                <Stat label="Best return" value={fmtPct(optimization.best.metrics.returnPct)} tone={optimization.best.metrics.returnPct >= 0 ? "text-emerald-300" : "text-red-300"} sub={`max DD ${fmtPct(optimization.best.metrics.maxDrawdownPct)}`} />
                            </>
                        )}
                    </div>

                    {optimization.best && selectedStrategy && (
                        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm text-foreground/70">
                                Best combo:{" "}
                                <span className="font-mono font-semibold text-amber-300">
                                    {Object.entries(optimization.best.config).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}
                                </span>
                            </div>
                            <Btn onClick={() => void applyBest(optimization.best!)} busy={applying || running}>
                                <CheckCircle2 className="h-4 w-4" /> Apply to strategy
                            </Btn>
                        </div>
                    )}

                    <div className="max-h-[460px] overflow-auto rounded-xl border border-border/20 bg-card">
                        <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 border-b border-border/20 bg-card text-[11px] uppercase tracking-widest text-foreground/70">
                                <tr>
                                    <th className="px-3 py-2">#</th>
                                    <th className="px-3 py-2">Params</th>
                                    <th className="px-3 py-2">Score</th>
                                    <th className="px-3 py-2">Win rate</th>
                                    <th className="px-3 py-2">PF</th>
                                    <th className="px-3 py-2">Return</th>
                                    <th className="px-3 py-2">Max DD</th>
                                    <th className="px-3 py-2">Exp. R</th>
                                    <th className="px-3 py-2">Trades</th>
                                    <th className="px-3 py-2 text-right"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {optimization.results.slice(0, 25).map((r, i) => (
                                    <tr key={i} className="border-b border-border/10">
                                        <td className="px-3 py-2 text-foreground/70">{i + 1}</td>
                                        <td className="px-3 py-2 font-mono text-[11px] text-foreground/70">
                                            {Object.entries(r.config).map(([k, v]) => `${k}=${String(v)}`).join(" ")}
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-amber-300">{fmt(r.score)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmtPct(r.metrics.winRate)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmt(r.metrics.profitFactor)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmtPct(r.metrics.returnPct)}</td>
                                        <td className="px-3 py-2 text-red-300">{fmtPct(r.metrics.maxDrawdownPct)}</td>
                                        <td className="px-3 py-2 text-foreground">{fmt(r.metrics.expectancyR)}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{r.metrics.totalTrades}</td>
                                        <td className="px-3 py-2 text-right">
                                            {i === 0 && selectedStrategy && (
                                                <button
                                                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20"
                                                    onClick={() => void applyBest(r)}
                                                    disabled={applying}
                                                >
                                                    Apply
                                                </button>
                                            )}
                                        </td>
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

// ───────────────────────────── 6 · Validate ────────────────────────────────

function ValidateTab({
    token, symbol, selectedStrategy, goTo,
    validation, robustness, busy, running,
    setValidation, setRobustness, setBusy, run,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    selectedStrategy: Strategy | null;
    goTo: (s: Step) => void;
    validation: ValidationOutcome | null;
    robustness: RobustnessScore | null;
    busy: boolean;
    running: boolean;
    setValidation: (v: ValidationOutcome | null) => void;
    setRobustness: (r: RobustnessScore | null) => void;
    setBusy: (b: boolean) => void;
    run: (fn: () => Promise<void>) => Promise<void>;
}) {
    const launch = () =>
        run(async () => {
            if (!selectedStrategy) return;
            setBusy(true);
            try {
                const res = await strategyLabApi.validate(token, { symbol, strategy: selectedStrategy });
                setValidation(res.validation);
                setRobustness(res.robustness);
            } finally {
                setBusy(false);
            }
        });

    const verdictTone: Record<string, string> = {
        robust: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        marginal: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        fragile: "border-orange-500/40 bg-orange-500/10 text-orange-300",
        inconclusive: "border-border/40 bg-muted/10 text-foreground/70",
    };

    const gradeTone = (g: string) =>
        g === "A" ? "border-emerald-500/40 text-emerald-300"
        : g === "B" ? "border-amber-500/40 text-amber-300"
        : g === "C" ? "border-orange-500/40 text-orange-300"
        : "border-red-500/40 text-red-300";

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader
                title="Walk-forward validation"
                desc="Splits history into in-sample / out-of-sample windows to check the strategy's edge is real and stable — not curve-fitted. This is the gate before deploying anything."
                action={<Btn onClick={launch} busy={busy || running} disabled={!selectedStrategy}><ShieldCheck className="h-4 w-4" /> Validate Strategy</Btn>}
            />

            {!selectedStrategy ? (
                <EmptyState
                    icon={ShieldCheck}
                    title="No strategy selected"
                    body="Validation runs the current strategy through unseen data — select one in step 3."
                    cta={<Btn onClick={() => goTo("strategy")}><Wand2 className="h-4 w-4" /> Go to Strategy</Btn>}
                />
            ) : !validation ? (
                <EmptyState
                    icon={ShieldCheck}
                    title={`Ready to validate ${selectedStrategy.name}`}
                    body="60/40 in-sample / out-of-sample split plus rolling walk-forward windows. A robust verdict here is the minimum bar for deployment."
                    cta={<Btn onClick={launch}><ShieldCheck className="h-4 w-4" /> Validate Strategy</Btn>}
                />
            ) : (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-wrap items-center gap-4">
                        <span className={`rounded-xl border px-4 py-2 text-sm font-bold uppercase tracking-widest ${verdictTone[validation.verdict] ?? verdictTone.inconclusive}`}>
                            {validation.verdict}
                        </span>
                        {robustness && (
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl border border-border/20 bg-card px-4 py-2 text-sm">
                                    <span className="text-foreground/70">Robustness </span>
                                    <span className="font-bold text-foreground">{fmt(robustness.score)}</span>
                                    <span className={`ml-2 rounded-lg border px-2 py-0.5 text-xs font-bold ${gradeTone(robustness.grade)}`}>{robustness.grade}</span>
                                </div>
                                {robustness.notes[0] && <div className="max-w-md text-xs text-foreground/70">{robustness.notes[0]}</div>}
                            </div>
                        )}
                    </div>

                    {robustness && (
                        <div className="grid gap-2 rounded-2xl border border-border/20 bg-card p-4 sm:grid-cols-4 lg:grid-cols-7">
                            {Object.entries(robustness.factors).map(([k, v]) => (
                                <div key={k} className="rounded-xl border border-border/10 bg-foreground/10 p-3">
                                    <div className="text-[10px] uppercase tracking-widest text-foreground/70">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className="font-mono text-sm font-bold text-foreground">{fmt(v, 0)}</span>
                                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                                            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-2xl border border-border/20 bg-card p-5">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-400">In-sample</div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div><div className="text-[10px] uppercase text-foreground/70">Trades</div><div className="font-semibold text-foreground">{validation.inSample.trades}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Win rate</div><div className="font-semibold text-foreground">{fmtPct(validation.inSample.metrics.winRate)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Profit factor</div><div className="font-semibold text-foreground">{fmt(validation.inSample.metrics.profitFactor)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Return</div><div className="font-semibold text-foreground">{fmtPct(validation.inSample.metrics.returnPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Max DD</div><div className="font-semibold text-red-300">{fmtPct(validation.inSample.metrics.maxDrawdownPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Expectancy R</div><div className="font-semibold text-foreground">{fmt(validation.inSample.metrics.expectancyR)}</div></div>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-border/20 bg-card p-5">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-400">Out-of-sample</div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div><div className="text-[10px] uppercase text-foreground/70">Trades</div><div className="font-semibold text-foreground">{validation.outOfSample.trades}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Win rate</div><div className="font-semibold text-foreground">{fmtPct(validation.outOfSample.metrics.winRate)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Profit factor</div><div className="font-semibold text-foreground">{fmt(validation.outOfSample.metrics.profitFactor)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Return</div><div className="font-semibold text-foreground">{fmtPct(validation.outOfSample.metrics.returnPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Max DD</div><div className="font-semibold text-red-300">{fmtPct(validation.outOfSample.metrics.maxDrawdownPct)}</div></div>
                                <div><div className="text-[10px] uppercase text-foreground/70">Expectancy R</div><div className="font-semibold text-foreground">{fmt(validation.outOfSample.metrics.expectancyR)}</div></div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border/20 bg-card p-5">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Degradation (in → out of sample)</div>
                        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                            <div className="text-muted-foreground">Win rate <span className="text-foreground">{fmt(validation.degradation.winRateDiff)}pp</span></div>
                            <div className="text-muted-foreground">Profit factor <span className="text-foreground">{fmt(validation.degradation.profitFactorDiff)}</span></div>
                            <div className="text-muted-foreground">Return <span className="text-foreground">{fmt(validation.degradation.returnDiff)}</span></div>
                            <div className="text-muted-foreground">Max DD <span className="text-foreground">{fmt(validation.degradation.maxDrawdownDiff)}</span></div>
                            <div className="text-muted-foreground">Overall <span className="text-foreground">{fmt(validation.degradation.overall)}%</span></div>
                        </div>
                        <div className="mt-3 text-sm text-muted-foreground">
                            Walk-forward windows: <span className="text-foreground">{validation.walkForward.windows.length}</span> · stable:{" "}
                            <span className={validation.walkForward.stable ? "text-emerald-300" : "text-red-300"}>{validation.walkForward.stable ? "yes" : "no"}</span> · stability score:{" "}
                            <span className="text-foreground">{fmt(validation.walkForward.stabilityScore)}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────── 7 · Deploy ──────────────────────────────────

function DeployTab({
    token, symbol, selectedStrategy, goTo,
    forwardTest, setForwardTest,
    deployments, refreshDeployments,
    deployBusy, setDeployBusy,
    running, run, pushToast,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    selectedStrategy: Strategy | null;
    goTo: (s: Step) => void;
    forwardTest: ForwardTest | null;
    setForwardTest: (ft: ForwardTest | null) => void;
    deployments: Deployment[];
    refreshDeployments: (t: string) => Promise<void>;
    deployBusy: boolean;
    setDeployBusy: (b: boolean) => void;
    running: boolean;
    run: (fn: () => Promise<void>) => Promise<void>;
    pushToast: (kind: Toast["kind"], text: string) => void;
}) {
    const [mode, setMode] = useState<"alerts_only" | "manual_confirmation" | "demo" | "live">("alerts_only");
    const [terms, setTerms] = useState(false);
    const [autoPoll, setAutoPoll] = useState(false);
    const [pollBusy, setPollBusy] = useState(false);

    const MODES: { key: typeof mode; label: string; desc: string }[] = [
        { key: "alerts_only", label: "Alerts Only", desc: "Signals stay in the lab and are notified — nothing touches your broker." },
        { key: "manual_confirmation", label: "Manual Confirmation", desc: "A trade request is created but requires your confirmation before execution." },
        { key: "demo", label: "Demo", desc: "Order requests are written to the demo account linked to your license." },
        { key: "live", label: "Live", desc: "Order requests written to your live MT5 account via the gateway. High risk." },
    ];

    const deploy = () =>
        run(async () => {
            if (!selectedStrategy) return;
            setDeployBusy(true);
            try {
                const res = await strategyLabApi.deploy(token, {
                    strategyId: selectedStrategy.id,
                    symbol,
                    mode,
                    termsAccepted: terms,
                });
                setForwardTest(res.forwardTest);
                await refreshDeployments(token);
                pushToast("success", `Deployed ${selectedStrategy.name} (${mode.replace("_", " ")}). Forward test is running.`);
            } finally {
                setDeployBusy(false);
            }
        });

    const poll = useCallback(
        async (manual: boolean) => {
            if (!forwardTest) return;
            setPollBusy(true);
            try {
                const res = await strategyLabApi.forwardMonitor(token, {
                    forwardTestId: forwardTest.id,
                    symbol,
                });
                setForwardTest(res.forwardTest);
                if (manual) pushToast("info", `Forward test refreshed — ${res.forwardTest.signals.length} signals.`);
                if (res.newSignal) pushToast("success", "New forward-test signal.");
            } catch (err) {
                if (manual) pushToast("error", err instanceof Error ? err.message : "Refresh failed.");
            } finally {
                setPollBusy(false);
            }
        },
        [forwardTest, token, symbol, setForwardTest, pushToast]
    );

    // Auto-refresh the forward test every 30s while enabled.
    useEffect(() => {
        if (!autoPoll || !forwardTest) return;
        const id = setInterval(() => void poll(false), 30_000);
        return () => clearInterval(id);
    }, [autoPoll, forwardTest, poll]);

    const closedSignals = forwardTest?.signals.filter((s) => s.status === "closed") ?? [];
    const wins = closedSignals.filter((s) => (s.profitR ?? 0) > 0).length;
    const winRate = closedSignals.length > 0 ? (wins / closedSignals.length) * 100 : null;
    const totalR = forwardTest?.signals.reduce((acc, s) => acc + (s.profitR ?? 0), 0) ?? null;

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <SectionHeader
                        title="Deploy strategy"
                        desc={selectedStrategy ? `Deploying: ${selectedStrategy.name} (${symbol})` : "Select a strategy to deploy."}
                    />

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
                        <Btn onClick={deploy} busy={deployBusy || running} disabled={!selectedStrategy || !terms}>
                            <Rocket className="h-4 w-4" /> Deploy
                        </Btn>
                        <span className="text-xs text-foreground/70">Creates a forward test (paper) + deployment record.</span>
                    </div>
                </div>

                {!selectedStrategy && (
                    <EmptyState
                        icon={Rocket}
                        title="No strategy selected"
                        body="Deploy always works on the strategy selected in step 3."
                        cta={<Btn onClick={() => goTo("strategy")}><Wand2 className="h-4 w-4" /> Go to Strategy</Btn>}
                    />
                )}

                {forwardTest && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                                <CheckCircle2 className="h-4 w-4" /> Forward test running
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                <input type="checkbox" className="accent-emerald-500" checked={autoPoll} onChange={(e) => setAutoPoll(e.target.checked)} />
                                Auto-refresh (30s)
                            </label>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                            <div><span className="text-foreground/70">Mode </span><span className="capitalize text-foreground">{forwardTest.mode.replace("_", " ")}</span></div>
                            <div><span className="text-foreground/70">Signals </span><span className="text-foreground">{forwardTest.signals.length}</span></div>
                            <div><span className="text-foreground/70">Open </span><span className="text-amber-300">{forwardTest.signals.filter((s) => s.status === "open").length}</span></div>
                            <div><span className="text-foreground/70">Closed / wins </span><span className="text-foreground">{closedSignals.length} / {forwardTest.tradeCount}</span></div>
                            <div><span className="text-foreground/70">Hit rate </span><span className="text-foreground">{winRate === null ? "–" : fmtPct(winRate)}</span></div>
                            <div><span className="text-foreground/70">Cumulative R </span><span className={totalR !== null && totalR >= 0 ? "text-emerald-300" : "text-red-300"}>{totalR === null ? "–" : fmt(totalR)}</span></div>
                        </div>
                        <div className="mt-3">
                            <Btn onClick={() => void poll(true)} busy={pollBusy} variant="ghost">
                                <RefreshCw className="h-4 w-4" /> Refresh with latest data
                            </Btn>
                        </div>
                    </div>
                )}

                {deployments.length > 0 && (
                    <div className="rounded-2xl border border-border/20 bg-card p-5">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Active deployments</div>
                        <div className="flex flex-col gap-2">
                            {deployments.map((d) => (
                                <div key={d.id} className="flex items-center justify-between rounded-xl border border-border/20 bg-foreground/10 p-3 text-sm">
                                    <div className="min-w-0">
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
                    <div className="mt-3 flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1">
                        {!forwardTest || forwardTest.signals.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/20 p-6 text-center text-sm text-foreground/70">
                                Signals appear here once the strategy fires on live (polled) data. Enable auto-refresh after deploying.
                            </div>
                        ) : (
                            forwardTest.signals.slice().reverse().map((s) => (
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

// ───────────────────────────── 8 · MT5 EA ─────────────────────────────────

function EATab({
    token, symbol, hierarchy,
    setStrategies,
    selectedStrategy, setSelectedStrategy,
    eas, easBusy, selectedEA, setSelectedEA,
    setEAs, setEAsBusy,
    running, run, pushToast, goTo,
}: {
    token: string;
    symbol: (typeof SYMBOLS)[number];
    hierarchy: TimeframeHierarchy;
    setStrategies: (s: Strategy[]) => void;
    selectedStrategy: Strategy | null;
    setSelectedStrategy: (s: Strategy | null) => void;
    eas: EAView[];
    easBusy: boolean;
    selectedEA: EAView | null;
    setSelectedEA: (ea: EAView | null) => void;
    setEAs: (eas: EAView[]) => void;
    setEAsBusy: (b: boolean) => void;
    running: boolean;
    run: (fn: () => Promise<void>) => Promise<void>;
    pushToast: (kind: Toast["kind"], text: string) => void;
    goTo: (s: Step) => void;
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

    const refresh = async (t: string, selectId?: string) => {
        const res = await strategyLabApi.listEAs(t);
        setEAs(res.eas as EAView[]);
        const target = selectId ? (res.eas as EAView[]).find((e) => e.eaId === selectId) : undefined;
        if (target) setSelectedEA(target);
    };

    const generate = () =>
        run(async () => {
            if (!selectedStrategy) return;
            setGenerating(true);
            try {
                setEAsBusy(true);
                const res = await strategyLabApi.generateEA(token, {
                    strategyId: selectedStrategy.id,
                    options: { compile: compileOnGenerate },
                });
                await refresh(token, res.eaId);
                setEAsBusy(false);
                pushToast("success", `EA generated — compiled: ${String((res.ea as { compiled?: boolean }).compiled ?? false)}`);
            } finally {
                setGenerating(false);
            }
        });

    const openCode = async (ea: EAView) => {
        setViewing(ea);
        if (!ea.code) {
            try {
                const res = await strategyLabApi.getEA(token, ea.eaId, true);
                setViewing({ ...ea, ...(res.ea as EAView) });
            } catch (err) {
                pushToast("error", err instanceof Error ? err.message : "Could not load EA source.");
            }
        }
    };

    const download = (ea: EAView) =>
        run(async () => {
            setDownloading(true);
            try {
                const { fileName, code } = await strategyLabApi.downloadEA(token, ea.eaId);
                const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
                pushToast("success", `Downloaded ${fileName}`);
            } finally {
                setDownloading(false);
            }
        });

    const recompile = (ea: EAView) =>
        run(async () => {
            setRecompiling(true);
            try {
                const res = await strategyLabApi.compileEA(token, ea.eaId);
                await refresh(token, ea.eaId);
                pushToast(
                    res.success ? "success" : "error",
                    res.success
                        ? `Compiled with 0 errors (${res.method}, ${res.warnings.length} warning(s)).`
                        : `Compilation failed (${res.errors.slice(0, 3).join(" | ")}).`
                );
            } finally {
                setRecompiling(false);
            }
        });

    const deploy = (ea: EAView) =>
        run(async () => {
            setDeploying(true);
            try {
                const res = await strategyLabApi.deployEA(token, ea.eaId, mt5Account.trim() || undefined);
                await refresh(token, ea.eaId);
                pushToast("success", `Deployed as ${res.botId} — Gateway will monitor magic ${res.magicNumber}.`);
            } finally {
                setDeploying(false);
            }
        });

    const publish = (ea: EAView) =>
        run(async () => {
            setPublishing(true);
            try {
                const res = await strategyLabApi.publishEA(token, ea.eaId, {
                    description: pubDesc.trim(),
                    price: Number(pubPrice) || 0,
                });
                await refresh(token, ea.eaId);
                setPubOpen(false);
                pushToast("success", `Published to the Marketplace as ${res.productId} (v${res.version}).`);
            } finally {
                setPublishing(false);
            }
        });

    const remove = (ea: EAView) =>
        run(async () => {
            if (!window.confirm(`Delete generated EA ${ea.eaId}? This does not stop any deployed bot.`)) return;
            await strategyLabApi.deleteEA(token, ea.eaId);
            if (selectedEA?.eaId === ea.eaId) setSelectedEA(null);
            await refresh(token);
            pushToast("success", "EA deleted.");
        });

    const interpret = () =>
        run(async () => {
            setInterpreting(true);
            try {
                setEAsBusy(true);
                const res = await strategyLabApi.interpretStrategy(token, {
                    prompt: nlPrompt,
                    symbol,
                    hierarchy,
                    save: true,
                });
                if (res.strategy) {
                    setSelectedStrategy(res.strategy);
                    const list = await strategyLabApi.listStrategies(token);
                    setStrategies(list.strategies);
                }
                setEAsBusy(false);
                pushToast("success", res.message);
            } finally {
                setInterpreting(false);
            }
        });

    const sel = selectedEA;

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
                    <div className="mt-2">
                        <Btn onClick={interpret} busy={interpreting || running} disabled={nlPrompt.trim().length < 4}>
                            <Sparkles className="h-4 w-4" /> Interpret
                        </Btn>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/20 bg-card p-5">
                    <SectionHeader
                        title="Generate MT5 Expert Advisor"
                        desc={selectedStrategy
                            ? `Strategy: ${selectedStrategy.name} (${selectedStrategy.asset} · setup ${selectedStrategy.timeframes.setup} · ${selectedStrategy.entryRules.filter((r) => r.enabled).length} entry rules)`
                            : "Select or generate a strategy first (steps 2–3)."}
                        action={
                            !selectedStrategy ? (
                                <Btn onClick={() => goTo("strategy")} variant="ghost"><Wand2 className="h-4 w-4" /> Pick strategy</Btn>
                            ) : undefined
                        }
                    />
                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border/20 bg-foreground/10 p-3.5">
                        <input type="checkbox" className="mt-1 accent-amber-500" checked={compileOnGenerate} onChange={(e) => setCompileOnGenerate(e.target.checked)} />
                        <span className="text-xs leading-relaxed text-muted-foreground">
                            Compile with MetaEditor during generation. When no local compiler exists, a{" "}
                            <span className="font-semibold text-foreground/80">strict static validation</span> is used and labeled as such —
                            compilation is never faked.
                        </span>
                    </label>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Btn onClick={generate} busy={generating || easBusy || running} disabled={!selectedStrategy}>
                            <Cpu className="h-4 w-4" /> Generate EA
                        </Btn>
                        <span className="text-xs text-foreground/70">
                            Magic number assigned deterministically per strategy/version/symbol.
                        </span>
                    </div>
                </div>

                {sel && (
                    <div className="rounded-2xl border border-border/20 bg-card p-5">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
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
                            <Btn onClick={() => void openCode(sel)} variant="ghost">
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
                            <Btn onClick={() => remove(sel)} variant="danger" title="Delete EA">
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
                                    <Field label="Price (USD)">
                                        <input className={inputCls} type="number" min={0} value={pubPrice} onChange={(e) => setPubPrice(e.target.value)} />
                                    </Field>
                                    <Field label="Description">
                                        <input className={inputCls} placeholder="Optional marketing copy" value={pubDesc} onChange={(e) => setPubDesc(e.target.value)} />
                                    </Field>
                                </div>
                                <div className="mt-3">
                                    <Btn onClick={() => publish(sel)} busy={publishing || running}>
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
                    <span className="text-xs text-foreground/70">{eas.length}</span>
                </div>
                <div className="flex max-h-[640px] flex-col gap-2 overflow-y-auto pr-1">
                    {eas.length === 0 && !easBusy ? (
                        <EmptyState
                            icon={Cpu}
                            title="No EAs generated yet"
                            body="Pick a strategy and generate your first MT5 Expert Advisor — source code, compile report and parity check included."
                        />
                    ) : (
                        eas.map((ea) => (
                            <button
                                key={ea.eaId}
                                className={`rounded-xl border p-3 text-left transition ${
                                    selectedEA?.eaId === ea.eaId ? "border-amber-500/50 bg-amber-500/10" : "border-border/20 bg-foreground/10 hover:bg-background/20"
                                }`}
                                onClick={() => setSelectedEA(ea)}
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

// ───────────────────────── 9 · DNA & Evolution ────────────────────────────

/**
 * Strategy DNA & evolution tab.
 *
 * Runs the real generation pipeline on the server: the browser only posts the
 * requested shape (symbol, period, generations, seed size) and renders what
 * comes back. Every count in the funnel is a real count of candidates that were
 * generated, backtested and survived — nothing is simulated in the client.
 */
function DnaEvolutionTab({
    token,
    symbol,
    period,
    run,
}: {
    token: string | null;
    symbol: (typeof SYMBOLS)[number];
    period: AnalysisPeriod;
    run: (fn: () => Promise<void>) => Promise<void>;
}) {
    const [evolution, setEvolution] = useState<EvolutionRun | null>(null);
    const [generations, setGenerations] = useState(4);
    const [seedPopulation, setSeedPopulation] = useState(12);
    const [busy, setBusy] = useState(false);
    const [generation, setGeneration] = useState(1);
    const [selectedDnaId, setSelectedDnaId] = useState<string | null>(null);
    const [localError, setLocalError] = useState<string | null>(null);

    // Run history is read through the shared authed/throttled fetch hook rather
    // than a bespoke effect, so it inherits the same token handling, request
    // abortion and cache policy as the rest of the module.
    const runsUrl = token ? `/api/strategy-lab/evolution?limit=10` : null;
    const { data: runsData, refresh: refreshRuns } = useThrottledAuthedFetch<{
        runs?: EvolutionRun[];
    }>(runsUrl, { enabled: !!token });

    const runs = runsData?.runs ?? [];

    const selectedDna = useMemo(() => {
        const newest = evolution?.generationReports[evolution.generationReports.length - 1];
        const details = newest?.details ?? [];
        if (selectedDnaId) {
            const found = details.find((d) => d.dna.id === selectedDnaId);
            if (found) return found.dna;
        }
        return details[0]?.dna ?? null;
    }, [evolution, selectedDnaId]);

    const doRun = () =>
        run(async () => {
            if (!token) return;
            setBusy(true);
            setLocalError(null);
            try {
                const res = await strategyLabApi.runEvolution(token, {
                    symbol,
                    period,
                    generations,
                    seedPopulation,
                });
                if (res.unavailable) {
                    setLocalError(res.unavailable);
                    setEvolution(res.run ?? null);
                } else if (res.run) {
                    setEvolution(res.run);
                    setGeneration(res.run.generations);
                    setSelectedDnaId(null);
                }
                refreshRuns();
            } finally {
                setBusy(false);
            }
        });

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-border/20 bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold">Strategy DNA &amp; Evolution</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Generates candidate genomes from a seed template, converts each one into a
                            runnable strategy, backtests it on real candles, validates it
                            out-of-sample, then breeds the survivors. Every number below is a real
                            count from that pipeline.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                        <Field label="Generations">
                            <select
                                value={generations}
                                onChange={(e) => setGenerations(Number(e.target.value))}
                                className={selCls}
                            >
                                {[1, 2, 3, 4, 5, 6].map((g) => (
                                    <option key={g} value={g}>
                                        {g}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Seeds">
                            <select
                                value={seedPopulation}
                                onChange={(e) => setSeedPopulation(Number(e.target.value))}
                                className={selCls}
                            >
                                {[4, 8, 12, 16, 24].map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <button
                            onClick={doRun}
                            disabled={busy}
                            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
                        >
                            <Play className="h-4 w-4" />
                            {busy ? "Evolving…" : "Run evolution"}
                        </button>
                    </div>
                </div>

                {localError ? <p className="mt-3 text-xs text-amber-300">{localError}</p> : null}

                {runs.length > 0 ? (
                    <div className="mt-4 border-t border-border/20 pt-3">
                        <p className="text-xs font-semibold uppercase tracking-widest text-foreground/70">
                            Previous runs
                        </p>
                        <ul className="mt-2 space-y-1">
                            {runs.map((r) => (
                                <li
                                    key={r.id}
                                    className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground"
                                >
                                    <span className="font-mono text-foreground">{r.id}</span>
                                    <span>
                                        {r.symbol} {r.timeframe} · {r.generations} gen
                                    </span>
                                    <span className="font-mono tabular-nums">
                                        {r.totals.candidates} cand · {r.totals.evaluated} eval ·{" "}
                                        {r.totals.survivors} surv
                                    </span>
                                    <span>{new Date(r.asOf).toLocaleString()}</span>
                                    {r.unavailable ? (
                                        <span className="text-amber-300">unavailable</span>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                    <StrategyEvolution run={evolution} loading={busy} onRun={doRun} running={busy} />
                    <PipelineView
                        run={evolution}
                        generation={generation}
                        onSelectGeneration={setGeneration}
                    />
                </div>
                <div className="space-y-4">
                    <StrategyEvolutionDetail
                        run={evolution}
                        selectedId={selectedDna?.id ?? null}
                        onSelect={setSelectedDnaId}
                    />
                    <DnaInspector dna={selectedDna} />
                    <EvolutionRulesPanel />
                </div>
            </div>
        </div>
    );
}
