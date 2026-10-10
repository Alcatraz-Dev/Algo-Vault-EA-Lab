"use client";

/**
 * AlgoVault — Portfolio Intelligence Command Center (Phase 15 §25).
 *
 * One projection of the canonical snapshot, shared by the desktop page and the
 * mobile view. Sections: Overview · Risk Map · Correlation Matrix · Strategy
 * Allocation · Warnings · Stress Test · Health.
 *
 * Design constraints carried over from the platform system: compact SaaS
 * density, 1px borders, no gradients, no fake AI animations, no meaningless
 * scores. Every number on screen has a formula behind it and a label saying so.
 */

import { useMemo, useState } from "react";
import {
    Activity,
    AlertTriangle,
    BarChart3,
    Boxes,
    Loader2,
    RefreshCw,
    ShieldAlert,
    TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    fmtAge,
    fmtMoney,
    fmtPct,
    usePortfolioAction,
    usePortfolioQuery,
    type PortfolioSnapshotPayload,
} from "./client";

/* ── Primitives ───────────────────────────────────────────────────────────── */

function Card({
    title,
    icon: Icon,
    action,
    children,
    className,
}: {
    title: string;
    icon?: typeof Activity;
    action?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("rounded-xl border border-border bg-card", className)}>
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-foreground">
                    {Icon ? <Icon className="size-3 text-primary" /> : null}
                    {title}
                </h2>
                {action}
            </header>
            <div className="p-3">{children}</div>
        </section>
    );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "warn" | "bad" }) {
    return (
        <div className="rounded-md border border-border/70 bg-background px-2.5 py-2">
            <div className="text-micro uppercase tracking-wide text-muted-foreground">{label}</div>
            <div
                className={cn(
                    "font-mono text-sm tabular-nums",
                    tone === "good" ? "text-positive" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-negative" : "text-foreground"
                )}
            >
                {value}
            </div>
            {hint ? <div className="mt-0.5 text-micro text-muted-foreground">{hint}</div> : null}
        </div>
    );
}

function ProGate({ message }: { message: string | null }) {
    return (
        <div className="rounded-lg border border-warning/30 bg-warning/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                <ShieldAlert className="size-4" /> Pro capability
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
                {message ?? "This portfolio intelligence surface requires a Pro plan."}
            </p>
        </div>
    );
}

function Empty({ message }: { message: string }) {
    return <p className="py-4 text-center text-xs italic text-muted-foreground">{message}</p>;
}

const RATING_TONE: Record<string, string> = {
    GOOD: "text-positive border-positive/40 bg-positive/10",
    WATCH: "text-warning border-warning/40 bg-warning/10",
    WARNING: "text-warning border-warning/40 bg-warning/10",
    CRITICAL: "text-negative border-negative/40 bg-negative/10",
    UNKNOWN: "text-muted-foreground border-border bg-muted/40",
};

/* ── Correlation matrix ───────────────────────────────────────────────────── */

function CorrelationMatrixPanel({ snapshot }: { snapshot: PortfolioSnapshotPayload }) {
    const matrix = snapshot.correlationMatrix;
    if (!matrix || matrix.matrix.length === 0) {
        return (
            <Empty message="Correlation is UNAVAILABLE — no aligned price history for the held symbols. Reported as unavailable, never as zero." />
        );
    }

    const cell = (v: number | null) => {
        if (v === null) return { bg: "bg-muted/30", text: "unavailable" };
        const alpha = Math.min(0.75, Math.abs(v) * 0.75);
        const positive = v >= 0;
        return {
            bg: positive ? `rgba(16,185,129,${alpha.toFixed(2)})` : `rgba(244,63,94,${alpha.toFixed(2)})`,
            text: v.toFixed(2),
        };
    };

    return (
        <div className="space-y-2">
            {/* Horizontal scrolling on narrow screens rather than shrinking the cells. */}
            <div className="overflow-x-auto">
                <table className="min-w-[420px] border-separate border-spacing-0.5 text-micro">
                    <caption className="sr-only">Rolling {matrix.window}-bar {matrix.timeframe} {matrix.method} correlation of held symbols</caption>
                    <thead>
                        <tr>
                            <th className="sticky left-0 bg-card" />
                            {matrix.symbols.map((s) => (
                                <th key={s} className="px-1.5 py-1 text-left font-mono font-semibold text-muted-foreground">
                                    {s}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {matrix.symbols.map((rowSymbol, i) => (
                            <tr key={rowSymbol}>
                                <th className="sticky left-0 bg-card px-1.5 py-1 text-right font-mono font-semibold text-muted-foreground">
                                    {rowSymbol}
                                </th>
                                {matrix.symbols.map((colSymbol, j) => {
                                    const c = cell(matrix.matrix[i]?.[j] ?? null);
                                    return (
                                        <td
                                            key={colSymbol}
                                            className="rounded px-1.5 py-1 text-center font-mono tabular-nums"
                                            style={{ backgroundColor: c.bg === "bg-muted/30" ? undefined : c.bg }}
                                            title={`${rowSymbol} vs ${colSymbol}: ${c.text}`}
                                        >
                                            <span className={c.text === "unavailable" ? "italic text-muted-foreground" : "text-foreground"}>
                                                {c.text}
                                            </span>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-micro leading-4 text-muted-foreground">
                Measured over the last {matrix.window} {matrix.timeframe} bars using {matrix.method} correlation. A correlation
                value is a measured property of past returns — it is not a trading signal and it can break without warning.
            </p>
        </div>
    );
}

/* ── Risk map ─────────────────────────────────────────────────────────────── */

function RiskMapPanel({ snapshot }: { snapshot: PortfolioSnapshotPayload }) {
    const rows = [
        { axis: "Symbol", slices: snapshot.exposure.bySymbol },
        { axis: "Strategy", slices: snapshot.exposure.byStrategy },
        { axis: "Asset class", slices: snapshot.exposure.byAssetClass },
        { axis: "Currency", slices: snapshot.exposure.byCurrency },
    ].filter((r) => r.slices.length > 0);

    if (rows.length === 0) return <Empty message="No open positions — there is no exposure to map." />;

    return (
        <div className="space-y-3">
            {rows.map((row) => {
                const total = row.slices.reduce((a, s) => a + s.grossWeight, 0) || 1;
                return (
                    <div key={row.axis}>
                        <div className="mb-1 text-micro uppercase tracking-wide text-muted-foreground">{row.axis}</div>
                        <div className="flex h-5 w-full overflow-hidden rounded border border-border">
                            {row.slices
                                .filter((s) => s.status === "AVAILABLE" && s.grossWeight > 0)
                                .map((s) => (
                                    <div
                                        key={s.key}
                                        className="flex items-center justify-center overflow-hidden border-r border-card/60 bg-primary/70 text-micro font-semibold text-primary-foreground last:border-r-0"
                                        style={{ width: `${(s.grossWeight / total) * 100}%` }}
                                        title={`${s.key}: ${fmtPct(s.grossWeight)}`}
                                    >
                                        {s.grossWeight > 0.12 ? s.key : ""}
                                    </div>
                                ))}
                        </div>
                    </div>
                );
            })}
            <p className="text-micro leading-4 text-muted-foreground">
                Bar width is each slice&apos;s share of gross notional on that axis. Asset-class slices with no determinable
                instrument are reported as UNAVAILABLE, never redistributed.
            </p>
        </div>
    );
}

/* ── Allocation ───────────────────────────────────────────────────────────── */

interface AllocationRecommendationRow {
    strategyId: string;
    action: string;
    targetWeight: number;
    currentWeight: number;
    confidence: number;
    rationale: string[];
}

interface AllocationResult {
    recommendations: AllocationRecommendationRow[];
    limitations: string[];
}

function AllocationPanel() {
    const [result, setResult] = useState<AllocationResult | null>(null);
    const { run, loading, error, message } = usePortfolioAction<{ method: string }, AllocationResult>(
        "/api/portfolio/allocation/recommend"
    );

    return (
        <Card
            title="Strategy allocation"
            icon={BarChart3}
            action={
                <button
                    type="button"
                    onClick={async () => {
                        const res = await run({ method: "RISK_PARITY" });
                        if (res.data) setResult(res.data);
                    }}
                    disabled={loading}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-micro text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                >
                    {loading ? <Loader2 className="size-3 animate-spin" /> : null}
                    Compute recommendations
                </button>
            }
        >
            {error ? <p className="text-xs text-warning">{message ?? error}</p> : null}
            {!result ? (
                <Empty message="Compute recommendations from measured strategy evidence. Recommendations never move capital — applying one requires your explicit approval." />
            ) : result.recommendations.length === 0 ? (
                <Empty message="No strategies are attributed to this portfolio, so no allocation recommendation was produced." />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-micro">
                        <thead>
                            <tr className="border-b border-border text-micro uppercase text-muted-foreground">
                                <th className="px-2 py-1.5 text-left">Strategy</th>
                                <th className="px-2 py-1.5 text-left">Action</th>
                                <th className="px-2 py-1.5 text-right">Current</th>
                                <th className="px-2 py-1.5 text-right">Target</th>
                                <th className="px-2 py-1.5 text-right">Confidence</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {result.recommendations.map((r) => (
                                <tr key={r.strategyId} title={r.rationale.join(" ")}>
                                    <td className="px-2 py-1.5 font-mono text-foreground">{r.strategyId}</td>
                                    <td className="px-2 py-1.5">
                                        <span
                                            className={cn(
                                                "rounded border px-1.5 py-0.5 text-micro font-semibold",
                                                r.action === "INCREASE"
                                                    ? "border-positive/40 text-positive"
                                                    : r.action === "REDUCE" || r.action === "PAUSE"
                                                      ? "border-negative/40 text-negative"
                                                      : r.action === "REVIEW"
                                                        ? "border-warning/40 text-warning"
                                                        : "border-border text-muted-foreground"
                                            )}
                                        >
                                            {r.action}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmtPct(r.currentWeight)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-foreground">{fmtPct(r.targetWeight)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{(r.confidence * 100).toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-2 text-micro leading-4 text-muted-foreground">
                        Advisory only. AlgoVault never moves live capital automatically — every recommendation requires approval
                        and passes the existing Risk Engine and Execution Supervisor gates.
                    </p>
                </div>
            )}
        </Card>
    );
}

/* ── Stress test ──────────────────────────────────────────────────────────── */

function StressPanel({ snapshot }: { snapshot: PortfolioSnapshotPayload }) {
    const { data, run, loading, error, message } = usePortfolioAction<{ kind: string }, {
        method: string;
        worstCase: { scenarioId: string; pnlImpact: number; pnlImpactPercent: number } | null;
        scenarios: Array<{
            scenario: { scenarioId: string; name: string; basis: string; methodology: string };
            pnlImpact: number;
            pnlImpactPercent: number;
            breach: boolean;
            breaches: string[];
        }>;
        limitations: string[];
    }>("/api/portfolio/stress-test");

    return (
        <Card
            title="Portfolio stress test"
            icon={TriangleAlert}
            action={
                <button
                    type="button"
                    disabled={loading || snapshot.positionCount === 0}
                    onClick={() => void run({ kind: "CORRELATION_SPIKE" })}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-micro text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                >
                    {loading ? <Loader2 className="size-3 animate-spin" /> : null}
                    Run correlation spike
                </button>
            }
        >
            {snapshot.positionCount === 0 ? (
                <Empty message="No open positions — every scenario is a no-op." />
            ) : error ? (
                <p className="text-xs text-warning">{message ?? error}</p>
            ) : !data ? (
                <Empty message="Run a deterministic scenario. Historical shocks are measured from real candles; everything else is explicitly labelled SIMULATED." />
            ) : (
                <div className="space-y-2">
                    {data.scenarios.map((s) => (
                        <div key={s.scenario.scenarioId} className="rounded border border-border bg-background p-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-foreground">{s.scenario.name}</span>
                                <span
                                    className={cn(
                                        "rounded border px-1.5 py-0.5 text-micro font-bold tracking-wide",
                                        s.scenario.basis === "HISTORICAL"
                                            ? "border-positive/40 text-positive"
                                            : "border-warning/40 text-warning"
                                    )}
                                    title={s.scenario.methodology}
                                >
                                    {s.scenario.basis}
                                </span>
                            </div>
                            <div className="mt-1 flex items-baseline gap-2">
                                <span
                                    className={cn(
                                        "font-mono text-sm tabular-nums",
                                        s.pnlImpact < 0 ? "text-negative" : "text-positive"
                                    )}
                                >
                                    {fmtMoney(s.pnlImpact)}
                                </span>
                                <span className="font-mono text-micro text-muted-foreground">{s.pnlImpactPercent.toFixed(2)}% of equity</span>
                            </div>
                            {s.breaches.length > 0 ? (
                                <ul className="mt-1 space-y-0.5">
                                    {s.breaches.map((b) => (
                                        <li key={b} className="text-micro leading-4 text-warning">
                                            • {b}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    ))}
                    <p className="text-micro leading-4 text-muted-foreground">
                        SIMULATED scenarios are labelled as such and must not be read as historical fact.
                    </p>
                </div>
            )}
        </Card>
    );
}

/* ── Main component ───────────────────────────────────────────────────────── */

export function PortfolioIntelligence({ portfolioId }: { portfolioId?: string }) {
    const { data, loading, error, message, proRequired, freshness, limitations, reload } = usePortfolioQuery<PortfolioSnapshotPayload>(
        "/api/portfolio/snapshot",
        { portfolioId }
    );

    const warnings = useMemo(() => data?.risk.warnings ?? [], [data]);

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="space-y-3">
                <div className="rounded-xl border border-warning/30 bg-warning/[0.04] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                        <TriangleAlert className="size-4" /> Portfolio intelligence unavailable
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Reason: {message ?? error}. AlgoVault fails closed rather than guessing — automated live action is not
                        authorised in this state.
                    </p>
                    <button
                        type="button"
                        onClick={reload}
                        className="mt-3 inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-micro text-muted-foreground transition hover:bg-muted"
                    >
                        <RefreshCw className="size-3" /> Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!data) return <Empty message="No portfolio data." />;

    const dd = data.risk.drawdownPercent;
    const exposureTone = data.exposure.grossToEquity !== null && data.exposure.grossToEquity > 6 ? "warn" : undefined;

    return (
        <div className="space-y-3">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <Boxes className="size-4 text-primary" />
                    <h1 className="text-sm font-semibold text-foreground">Portfolio Intelligence</h1>
                    <span
                        className={cn(
                            "rounded border px-1.5 py-0.5 text-micro font-bold tracking-wide",
                            freshness?.freshness === "FRESH"
                                ? "border-positive/40 text-positive"
                                : freshness?.freshness === "STALE"
                                  ? "border-warning/40 text-warning"
                                  : "border-border text-muted-foreground"
                        )}
                    >
                        {freshness?.freshness === "STALE" ? "STALE DATA" : freshness?.freshness === "UNAVAILABLE" ? "UNAVAILABLE" : "LIVE"}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="font-mono text-micro text-muted-foreground">Updated {fmtAge(freshness)}</span>
                    <span className="rounded border border-border px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                        Regime {data.regime} · {(data.regimeState.confidence * 100).toFixed(0)}%
                    </span>
                    <button
                        type="button"
                        onClick={reload}
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-micro text-muted-foreground transition hover:bg-muted"
                    >
                        <RefreshCw className={cn("size-3", loading && "animate-spin")} />
                        Refresh
                    </button>
                </div>
            </header>

            {proRequired ? <ProGate message={message} /> : null}

            {/* ── Overview ───────────────────────────────────────────────── */}
            <Card title="Overview">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <Stat label="Equity" value={fmtMoney(data.equity, data.baseCurrency)} />
                    <Stat label="Balance" value={fmtMoney(data.balance, data.baseCurrency)} />
                    <Stat
                        label="Floating P&L"
                        value={fmtMoney(data.unrealizedPnL, data.baseCurrency)}
                        tone={data.unrealizedPnL > 0 ? "good" : data.unrealizedPnL < 0 ? "bad" : undefined}
                    />
                    <Stat
                        label="Gross / Net exposure"
                        value={`${fmtMoney(data.grossExposure, data.baseCurrency, 0)} / ${fmtMoney(data.netExposure, data.baseCurrency, 0)}`}
                        hint={`${(data.exposure.grossToEquity ?? 0).toFixed(2)}× equity`}
                        tone={exposureTone}
                    />
                    <Stat
                        label="Drawdown"
                        value={dd === null ? "unavailable" : `${dd.toFixed(2)}%`}
                        tone={dd !== null && dd >= 10 ? "bad" : dd !== null && dd >= 5 ? "warn" : "good"}
                    />
                    <Stat label="Margin used" value={fmtMoney(data.risk.marginUsed, data.baseCurrency, 0)} hint={`${fmtMoney(data.risk.freeMargin, data.baseCurrency, 0)} free`} />
                    <Stat
                        label="Open risk at stop"
                        value={data.risk.openRiskPercent === null ? "unavailable" : `${data.risk.openRiskPercent.toFixed(2)}%`}
                        hint={data.risk.openRiskPercent === null ? "no position carries a stop loss" : `${fmtMoney(data.risk.openRisk, data.baseCurrency, 0)} at risk`}
                    />
                    <Stat label="Positions" value={String(data.positionCount)} hint={`${data.strategyCount} strategies · ${data.assetCount} asset classes`} />
                    <Stat
                        label="Concentration"
                        value={data.concentration.concentrationScore.toFixed(3)}
                        hint={`HHI · worst axis ${data.concentration.maxAxis ?? "n/a"}`}
                        tone={data.concentration.severity === "HIGH" ? "bad" : data.concentration.severity === "MODERATE" ? "warn" : "good"}
                    />
                    <Stat
                        label="Correlated cluster"
                        value={fmtPct(data.correlation.clusteredExposureWeight)}
                        hint={`mean ρ ${data.correlation.meanCorrelation.toFixed(2)}`}
                        tone={data.correlation.severity === "HIGH" ? "bad" : data.correlation.severity === "MODERATE" ? "warn" : "good"}
                    />
                </div>
            </Card>

            {/* ── Warnings ───────────────────────────────────────────────── */}
            {warnings.length > 0 ? (
                <Card title={`Active warnings (${warnings.length})`} icon={AlertTriangle}>
                    <ul className="space-y-1.5">
                        {warnings.slice(0, 8).map((w, i) => (
                            <li key={`${w.code}-${i}`} className="flex items-start gap-2 rounded border border-border bg-background px-2.5 py-2">
                                <span
                                    className={cn(
                                        "mt-0.5 rounded px-1.5 py-0.5 text-micro font-bold tracking-wide",
                                        w.severity === "CRITICAL"
                                            ? "bg-negative/15 text-negative"
                                            : w.severity === "WARNING"
                                              ? "bg-warning/15 text-warning"
                                              : w.severity === "WATCH"
                                                ? "bg-warning/15 text-warning"
                                                : "bg-muted text-muted-foreground"
                                    )}
                                >
                                    {w.severity}
                                </span>
                                <div className="min-w-0">
                                    <div className="font-mono text-micro uppercase tracking-wide text-muted-foreground">{w.code}</div>
                                    <p className="text-xs text-foreground">{w.message}</p>
                                    {w.detail ? <p className="mt-0.5 text-micro leading-4 text-muted-foreground">{w.detail}</p> : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                </Card>
            ) : null}

            {/* ── Health ─────────────────────────────────────────────────── */}
            <Card title="Portfolio health" icon={Activity}>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
                    {data.health.components.map((c) => (
                        <div
                            key={c.component}
                            className={cn("rounded border px-2 py-1.5", RATING_TONE[c.rating] ?? RATING_TONE.UNKNOWN)}
                            title={c.reasons.join(" ")}
                        >
                            <div className="text-micro uppercase tracking-wide opacity-80">{c.component}</div>
                            <div className="text-xs font-bold">{c.rating}</div>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-micro leading-4 text-muted-foreground">
                    Nine components, each with its own documented formula. The overall rating is the worst measured component —
                    it is deliberately not collapsed into a single score you are meant to optimise.
                </p>
            </Card>

            {/* ── Risk map ───────────────────────────────────────────────── */}
            <Card title="Risk map — symbol → strategy → asset → currency" icon={Boxes}>
                <RiskMapPanel snapshot={data} />
            </Card>

            {/* ── Correlation ────────────────────────────────────────────── */}
            <Card title="Correlation matrix" icon={BarChart3}>
                <CorrelationMatrixPanel snapshot={data} />
                {data.correlation.evidence.length > 0 ? (
                    <ul className="mt-2 space-y-1 border-t border-border pt-2">
                        {data.correlation.evidence.map((e, i) => (
                            <li key={i} className="text-micro leading-4 text-muted-foreground">
                                <span className="font-semibold text-foreground">[{e.kind}]</span> {e.text}
                            </li>
                        ))}
                    </ul>
                ) : null}
            </Card>

            {/* ── Allocation ─────────────────────────────────────────────── */}
            <AllocationPanel />

            {/* ── Stress ─────────────────────────────────────────────────── */}
            <StressPanel snapshot={data} />

            {/* ── Limitations ────────────────────────────────────────────── */}
            {limitations.length > 0 ? (
                <Card title="Limitations & data quality">
                    <ul className="space-y-1">
                        {limitations.slice(0, 10).map((l, i) => (
                            <li key={i} className="text-micro leading-4 text-muted-foreground">
                                • {l}
                            </li>
                        ))}
                    </ul>
                </Card>
            ) : null}
        </div>
    );
}

export default PortfolioIntelligence;
