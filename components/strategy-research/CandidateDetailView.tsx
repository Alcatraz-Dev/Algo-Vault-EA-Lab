"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import {
    ArrowLeft,
    BrainCircuit,
    CheckCircle2,
    CircleX,
    ExternalLink,
    GitBranch,
    MinusCircle,
    Network,
    ShieldAlert,
    Sparkles,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { strategyResearchApi, type LineageEntryView } from "@/lib/strategy-research/client-api";
import type { ResearchCandidate, ResearchEvent } from "@/lib/strategy-research/types";

const LINEAGE_ICON: Record<string, React.ReactNode> = {
    mission: <GitBranch className="h-3.5 w-3.5" />,
    hypothesis: <Sparkles className="h-3.5 w-3.5" />,
    strategy: <Network className="h-3.5 w-3.5" />,
    backtest: <ShieldAlert className="h-3.5 w-3.5" />,
    oos: <ShieldAlert className="h-3.5 w-3.5" />,
    walk_forward: <ShieldAlert className="h-3.5 w-3.5" />,
    monte_carlo: <ShieldAlert className="h-3.5 w-3.5" />,
    robustness: <ShieldAlert className="h-3.5 w-3.5" />,
    incubation: <CheckCircle2 className="h-3.5 w-3.5" />,
    forward_test: <CheckCircle2 className="h-3.5 w-3.5" />,
};

function lineageTone(status: LineageEntryView["status"]): "positive" | "negative" | "warning" | "neutral" {
    if (status === "completed") return "positive";
    if (status === "failed") return "negative";
    if (status === "pending") return "warning";
    return "neutral";
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" | "warning" }) {
    return (
        <div className="rounded-lg border border-border/40 bg-background px-3 py-2">
            <div className="text-micro uppercase tracking-wide text-muted-foreground">{label}</div>
            <div
                className={`text-sm font-semibold ${
                    tone === "positive" ? "text-positive" : tone === "negative" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground"
                }`}
            >
                {value}
            </div>
        </div>
    );
}

export default function CandidateDetailView({
    missionId,
    candidateId,
}: {
    missionId: string;
    candidateId: string;
}) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<Awaited<ReturnType<typeof strategyResearchApi.getCandidate>> | null>(null);
    const [events, setEvents] = useState<ResearchEvent[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [explanation, setExplanation] = useState<string | null>(null);
    const [explaining, setExplaining] = useState(false);

    const navGroups: NavGroup[] = APP_NAV.map((g) => ({ ...g }));

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => setUser(u));
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        // Async load: all setState happens after awaits, never synchronously
        // in the effect body (react-hooks/set-state-in-effect).
        void (async () => {
            const token = await auth.currentUser?.getIdToken();
            if (!token || cancelled) return;
            try {
                const detail = await strategyResearchApi.getCandidate(token, missionId, candidateId, true);
                if (cancelled) return;
                setData(detail);
                setEvents(detail.events);
                setError(null);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Failed to load candidate.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user, missionId, candidateId]);

    const explain = async () => {
        setExplaining(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error("Sign in required.");
            const res = await fetch(
                `/api/strategy-research/missions/${encodeURIComponent(missionId)}/candidates/${encodeURIComponent(candidateId)}/explain`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    cache: "no-store",
                }
            );
            const body = (await res.json()) as { explanation?: string; error?: string };
            if (!res.ok) throw new Error(body.error ?? "Explanation failed.");
            setExplanation(body.explanation ?? null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Explanation failed.");
        } finally {
            setExplaining(false);
        }
    };

    const candidate: ResearchCandidate | null = data?.candidate ?? null;
    const backtest = (data?.backtest ?? null) as {
        metrics?: Record<string, number>;
        equity?: Array<{ time: number; balance: number }>;
        trades?: Array<Record<string, unknown>>;
    } | null;
    const metrics = candidate?.evaluation?.backtest?.metrics ?? null;
    const validation = candidate?.evaluation?.validation?.outcome ?? null;
    const mc = candidate?.evaluation?.monteCarlo?.summary ?? null;
    const robustness = candidate?.robustnessReport ?? null;
    const score = candidate?.score ?? null;

    return (
        <AppShell
            navGroups={navGroups}
            title="Research Candidate"
            subtitle="Specification · Evidence · Validation · Lineage"
            maxWidth="max-w-[1400px]"
        >
            <div className="space-y-6">
                <Link
                    href="/strategy-research"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to Strategy Research
                </Link>

                {loading ? (
                    <div className="rounded-lg border border-border/30 bg-card/40 p-10 text-center text-sm text-muted-foreground">
                        Loading candidate…
                    </div>
                ) : error && !candidate ? (
                    <EmptyState
                        icon={<CircleX className="h-5 w-5" />}
                        title="Candidate unavailable"
                        description={error}
                        action={
                            <Link href="/strategy-research">
                                <Button variant="outline" size="sm">Back to Research</Button>
                            </Link>
                        }
                    />
                ) : candidate ? (
                    <>
                        {/* Header */}
                        <section className="rounded-lg border border-border/30 bg-card/40 p-5 backdrop-blur-xl">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h1 className="text-lg font-bold tracking-tight">
                                        {candidate.strategy?.name ?? "Candidate"}
                                    </h1>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span>{candidate.hypothesis.market}</span>
                                        <span>· {candidate.strategy?.timeframes.setup ?? candidate.hypothesis.timeframes[0]}</span>
                                        <span>· {candidate.hypothesis.direction}</span>
                                        <span>· source: {candidate.hypothesis.source}</span>
                                        <StatusBadge label={candidate.lifecycle} tone={candidate.rejectedReason ? "negative" : candidate.lifecycle === "survivor" || candidate.lifecycle === "incubated" || candidate.lifecycle === "forward_testing" ? "positive" : "info"} />
                                        {score ? <Badge variant="outline">research score {score.total}/100</Badge> : null}
                                        {candidate.linkedTo ? <Badge variant="outline">duplicate of {candidate.linkedTo}</Badge> : null}
                                    </div>
                                    {candidate.hypothesis.rationale ? (
                                        <p className="mt-2 max-w-3xl text-xs text-muted-foreground">{candidate.hypothesis.rationale}</p>
                                    ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button size="sm" variant="outline" onClick={explain} disabled={explaining}>
                                        <BrainCircuit className="mr-1 h-3.5 w-3.5" />
                                        {explaining ? "Explaining…" : "AI explanation"}
                                    </Button>
                                </div>
                            </div>
                            {explanation ? (
                                <div className="mt-3 whitespace-pre-wrap rounded-lg border border-border/40 bg-background p-4 text-xs leading-relaxed">
                                    {explanation}
                                </div>
                            ) : null}
                            {candidate.rejectedReason ? (
                                <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                                    <span className="font-semibold">Rejected: {candidate.rejectedReason}</span>
                                    <ul className="mt-1 list-inside list-disc">
                                        {candidate.rejectedNotes.map((n, i) => (
                                            <li key={i}>{n}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                        </section>

                        <div className="grid gap-6 lg:grid-cols-3">
                            {/* Backtest + OOS metrics */}
                            <section className="rounded-lg border border-border/30 bg-card/40 p-5 backdrop-blur-xl lg:col-span-2">
                                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                    <ShieldAlert className="h-4 w-4 text-primary" /> Validation Evidence
                                </h2>
                                {metrics ? (
                                    <>
                                        <div className="mb-2 text-micro uppercase tracking-wide text-muted-foreground">Backtest (full window)</div>
                                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                                            <Metric label="Trades" value={String(metrics.totalTrades)} />
                                            <Metric label="Win rate" value={`${metrics.winRate.toFixed(1)}%`} />
                                            <Metric label="Profit factor" value={metrics.profitFactor.toFixed(2)} tone={metrics.profitFactor >= 1.2 ? "positive" : metrics.profitFactor < 1 ? "negative" : undefined} />
                                            <Metric label="Max DD" value={`${metrics.maxDrawdownPct.toFixed(1)}%`} tone={metrics.maxDrawdownPct > 20 ? "negative" : undefined} />
                                            <Metric label="Net profit" value={metrics.netProfit.toFixed(2)} tone={metrics.netProfit > 0 ? "positive" : "negative"} />
                                        </div>
                                        {candidate.evaluation?.backtest?.window ? (
                                            <p className="mt-2 text-micro text-muted-foreground">
                                                Window {new Date(candidate.evaluation.backtest.window.from).toLocaleDateString()} →{" "}
                                                {new Date(candidate.evaluation.backtest.window.to).toLocaleDateString()} ·{" "}
                                                {candidate.evaluation.backtest.window.bars} bars · source {candidate.evaluation.backtest.window.dataSource ?? "—"} ·
                                                execution {candidate.evaluation.backtest.config.executionModel} · spread{" "}
                                                {candidate.evaluation.backtest.config.spreadPips}p · slippage{" "}
                                                {candidate.evaluation.backtest.config.slippagePips}p
                                            </p>
                                        ) : null}
                                    </>
                                ) : (
                                    <p className="text-xs text-muted-foreground">No backtest evidence yet.</p>
                                )}

                                {validation ? (
                                    <>
                                        <div className="mb-2 mt-4 text-micro uppercase tracking-wide text-muted-foreground">
                                            Out-of-sample · verdict{" "}
                                            <span
                                                className={
                                                    validation.verdict === "robust"
                                                        ? "text-positive"
                                                        : validation.verdict === "fragile"
                                                            ? "text-destructive"
                                                            : "text-warning"
                                                }
                                            >
                                                {validation.verdict}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                            <Metric label="IS trades" value={String(validation.inSample.metrics.totalTrades)} />
                                            <Metric label="OOS trades" value={String(validation.outOfSample.metrics.totalTrades)} />
                                            <Metric label="Degradation" value={validation.degradation.overall.toFixed(1)} tone={validation.degradation.overall >= 12 ? "negative" : validation.degradation.overall >= 5 ? "warning" : "positive"} />
                                            <Metric label="OOS win rate" value={`${validation.outOfSample.metrics.winRate.toFixed(1)}%`} />
                                        </div>
                                    </>
                                ) : null}

                                {validation?.walkForward.enabled ? (
                                    <>
                                        <div className="mb-2 mt-4 text-micro uppercase tracking-wide text-muted-foreground">
                                            Walk-forward · {validation.walkForward.windows.length} window(s) ·{" "}
                                            {validation.walkForward.stable ? "stable" : "unstable"}
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-micro">
                                                <thead>
                                                    <tr className="text-muted-foreground">
                                                        <th className="px-2 py-1 text-left font-medium">Train</th>
                                                        <th className="px-2 py-1 text-left font-medium">Test</th>
                                                        <th className="px-2 py-1 text-right font-medium">Train PF</th>
                                                        <th className="px-2 py-1 text-right font-medium">Test PF</th>
                                                        <th className="px-2 py-1 text-right font-medium">Degradation</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {validation.walkForward.windows.map((w, i) => (
                                                        <tr key={i} className="border-t border-border/20">
                                                            <td className="px-2 py-1">{new Date(w.train.from).toLocaleDateString()} → {new Date(w.train.to).toLocaleDateString()}</td>
                                                            <td className="px-2 py-1">{new Date(w.test.from).toLocaleDateString()} → {new Date(w.test.to).toLocaleDateString()}</td>
                                                            <td className="px-2 py-1 text-right">{w.trainMetrics.profitFactor.toFixed(2)}</td>
                                                            <td className="px-2 py-1 text-right">{w.testMetrics.profitFactor.toFixed(2)}</td>
                                                            <td className={`px-2 py-1 text-right ${w.degradationPct >= 12 ? "text-destructive" : ""}`}>
                                                                {w.degradationPct.toFixed(1)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : null}

                                {mc ? (
                                    <>
                                        <div className="mb-2 mt-4 text-micro uppercase tracking-wide text-muted-foreground">Monte Carlo (seeded bootstrap)</div>
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                            <Metric label="Simulations" value={String(mc.simulations)} />
                                            <Metric
                                                label="Profit probability"
                                                value={mc.profitProbability !== null ? `${(mc.profitProbability * 100).toFixed(0)}%` : "n/a"}
                                                tone={mc.profitProbability !== null ? (mc.profitProbability >= 0.6 ? "positive" : mc.profitProbability < 0.35 ? "negative" : "warning") : undefined}
                                            />
                                            <Metric
                                                label="Drawdown P95"
                                                value={mc.drawdownP95 !== null ? `${(mc.drawdownP95 * 100).toFixed(0)}%` : "n/a"}
                                            />
                                            <Metric
                                                label="Return P5"
                                                value={mc.returnP5 !== null ? `${(mc.returnP5 * 100).toFixed(1)}%` : "n/a"}
                                            />
                                        </div>
                                        {mc.limitations.length > 0 ? (
                                            <p className="mt-1.5 text-micro text-muted-foreground">Limitations: {mc.limitations.join("; ")}</p>
                                        ) : null}
                                    </>
                                ) : null}

                                {/* Trade-level evidence */}
                                {backtest?.trades && backtest.trades.length > 0 ? (
                                    <>
                                        <div className="mb-2 mt-4 text-micro uppercase tracking-wide text-muted-foreground">
                                            Trades ({backtest.trades.length})
                                        </div>
                                        <div className="max-h-56 overflow-y-auto rounded-lg border border-border/40">
                                            <table className="w-full text-micro">
                                                <thead className="sticky top-0 bg-background">
                                                    <tr className="text-muted-foreground">
                                                        <th className="px-2 py-1 text-left font-medium">Opened</th>
                                                        <th className="px-2 py-1 text-left font-medium">Side</th>
                                                        <th className="px-2 py-1 text-right font-medium">Entry</th>
                                                        <th className="px-2 py-1 text-right font-medium">Exit</th>
                                                        <th className="px-2 py-1 text-right font-medium">PnL</th>
                                                        <th className="px-2 py-1 text-right font-medium">R</th>
                                                        <th className="px-2 py-1 text-right font-medium">Reason</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {backtest.trades.slice(-100).map((t, i) => (
                                                        <tr key={i} className="border-t border-border/20">
                                                            <td className="px-2 py-1">{new Date(Number(t.openedAt)).toLocaleString()}</td>
                                                            <td className="px-2 py-1">{String(t.direction)}</td>
                                                            <td className="px-2 py-1 text-right">{String(t.entry)}</td>
                                                            <td className="px-2 py-1 text-right">{String(t.exit)}</td>
                                                            <td className={`px-2 py-1 text-right ${Number(t.profit) >= 0 ? "text-positive" : "text-destructive"}`}>
                                                                {Number(t.profit).toFixed(2)}
                                                            </td>
                                                            <td className="px-2 py-1 text-right">{Number(t.profitR ?? 0).toFixed(2)}</td>
                                                            <td className="px-2 py-1 text-right">{String(t.exitReason)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : null}
                            </section>

                            {/* Lineage */}
                            <section className="rounded-lg border border-border/30 bg-card/40 p-5 backdrop-blur-xl">
                                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                    <GitBranch className="h-4 w-4 text-primary" /> Strategy Lineage
                                </h2>
                                <ol className="space-y-2">
                                    {(data?.lineage ?? []).map((entry) => (
                                        <li key={`${entry.kind}-${entry.id}`} className="flex items-start gap-2 text-xs">
                                            <span
                                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                                    entry.status === "completed"
                                                        ? "border-positive/40 text-positive"
                                                        : entry.status === "failed"
                                                            ? "border-destructive/40 text-destructive"
                                                            : entry.status === "skipped"
                                                                ? "border-border text-muted-foreground/50"
                                                                : "border-warning/40 text-warning"
                                                }`}
                                            >
                                                {LINEAGE_ICON[entry.kind] ?? <MinusCircle className="h-3.5 w-3.5" />}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-medium">{entry.label}</span>
                                                    <StatusBadge label={entry.status} tone={lineageTone(entry.status)} />
                                                </div>
                                                {entry.detail ? (
                                                    <p className="break-words text-micro text-muted-foreground">{entry.detail}</p>
                                                ) : null}
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                                <p className="mt-3 rounded-lg border border-border/40 bg-background p-2 text-micro leading-relaxed text-muted-foreground">
                                    {data?.mission.lineageNote}
                                </p>
                            </section>
                        </div>

                        {/* Robustness + warnings + score */}
                        <div className="grid gap-6 lg:grid-cols-2">
                            <section className="rounded-lg border border-border/30 bg-card/40 p-5 backdrop-blur-xl">
                                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                    <ShieldAlert className="h-4 w-4 text-primary" /> Robustness Report
                                </h2>
                                {robustness ? (
                                    <>
                                        <div className="mb-3 flex items-center gap-2">
                                            <Badge
                                                variant="outline"
                                                className={
                                                    robustness.status === "robust"
                                                        ? "border-positive/50 text-positive"
                                                        : robustness.status === "fragile"
                                                            ? "border-destructive/50 text-destructive"
                                                            : "border-warning/50 text-warning"
                                                }
                                            >
                                                {robustness.status}
                                            </Badge>
                                            <span className="text-micro text-muted-foreground">
                                                generated {new Date(robustness.generatedAt).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {robustness.dimensions.map((d) => (
                                                <div key={d.dimension} className="rounded-lg border border-border/40 bg-background px-3 py-2 text-xs">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="font-medium">{d.dimension.replace(/_/g, " ")}</span>
                                                        <StatusBadge
                                                            label={d.status}
                                                            tone={
                                                                d.status === "pass"
                                                                    ? "positive"
                                                                    : d.status === "fail"
                                                                        ? "negative"
                                                                        : d.status === "concern"
                                                                            ? "warning"
                                                                            : "neutral"
                                                            }
                                                        />
                                                    </div>
                                                    <p className="mt-0.5 text-micro text-muted-foreground">{d.detail}</p>
                                                    {d.evidence.length > 0 ? (
                                                        <p className="mt-0.5 break-words text-micro text-muted-foreground/70">
                                                            evidence: {d.evidence.join(" · ")}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-xs text-muted-foreground">Robustness analysis not run yet.</p>
                                )}

                                {score ? (
                                    <div className="mt-4 rounded-lg border border-border/40 bg-background p-3">
                                        <div className="mb-2 flex items-center justify-between text-xs">
                                            <span className="font-semibold">Research score components</span>
                                            <span>{score.total}/100 · {score.verdict}</span>
                                        </div>
                                        <div className="space-y-1">
                                            {Object.entries(score.factors).map(([key, value]) => (
                                                <div key={key} className="flex items-center gap-2 text-micro">
                                                    <span className="w-36 text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</span>
                                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, value)}%` }} />
                                                    </div>
                                                    <span className="w-8 text-right">{value}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <p className="mt-2 text-micro text-muted-foreground">
                                            Transparent internal research aid — not a performance prediction.
                                        </p>
                                    </div>
                                ) : null}
                            </section>

                            <section className="rounded-lg border border-border/30 bg-card/40 p-5 backdrop-blur-xl">
                                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                    <AlertTriangleIcon /> Research Warnings
                                </h2>
                                {(candidate.warnings ?? []).length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No deterministic warnings raised.</p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {candidate.warnings.map((w, i) => (
                                            <div
                                                key={i}
                                                className={`rounded-lg border px-3 py-2 text-xs ${
                                                    w.severity === "high"
                                                        ? "border-destructive/40 bg-destructive/5"
                                                        : w.severity === "medium"
                                                            ? "border-warning/40 bg-warning/5"
                                                            : "border-border/40 bg-background"
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-medium">{w.type.replace(/_/g, " ")}</span>
                                                    <Badge variant="outline">{w.severity}</Badge>
                                                </div>
                                                <p className="mt-0.5 text-muted-foreground">{w.message}</p>
                                                {w.evidence.length > 0 ? (
                                                    <p className="mt-0.5 break-words text-micro text-muted-foreground/70">
                                                        evidence: {w.evidence.join(" · ")}
                                                    </p>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <h2 className="mb-2 mt-5 flex items-center gap-2 text-sm font-semibold">
                                    <Network className="h-4 w-4 text-primary" /> Knowledge Graph
                                </h2>
                                {(data?.knowledgeEdges ?? []).length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No graph relationships recorded yet.</p>
                                ) : (
                                    <ul className="space-y-1 text-micro">
                                        {(data?.knowledgeEdges ?? []).map((edge) => {
                                            const e = edge as { id: string; from: { type: string; id: string }; to: { type: string; id: string }; type: string };
                                            return (
                                                <li key={e.id} className="rounded-md border border-border/40 bg-background px-3 py-1.5">
                                                    <span className="font-medium text-primary">{e.type}</span>
                                                    <span className="text-muted-foreground">
                                                        {" "}{e.from.type}:{e.from.id.slice(0, 26)} → {e.to.type}:{e.to.id.slice(0, 26)}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}

                                {candidate.incubationStrategyId ? (
                                    <a
                                        href={`/strategy-lab`}
                                        className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                    >
                                        Open in Strategy Lab (incubation) <ExternalLink className="h-3 w-3" />
                                    </a>
                                ) : null}
                            </section>
                        </div>

                        {/* Candidate-scoped research log */}
                        <section className="rounded-lg border border-border/30 bg-card/40 p-5 backdrop-blur-xl">
                            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                                <Sparkles className="h-4 w-4 text-primary" /> Candidate Research Log
                            </h2>
                            {events.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No events reference this candidate.</p>
                            ) : (
                                <ul className="space-y-1 text-micro">
                                    {events.map((e) => (
                                        <li key={e.id} className="flex items-start justify-between gap-3 rounded-md border border-border/30 bg-background px-3 py-1.5">
                                            <span className={e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-warning" : "text-foreground"}>
                                                {e.code ? <span className="mr-1.5 text-muted-foreground">{e.code}</span> : null}
                                                {e.message}
                                            </span>
                                            <span className="shrink-0 text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                ) : null}
            </div>
        </AppShell>
    );
}

function AlertTriangleIcon() {
    return (
        <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
    );
}
