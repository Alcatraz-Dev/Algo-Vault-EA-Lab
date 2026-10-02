"use client";

/**
 * /verified-performance — audited trading performance derived from the user's
 * own trade journal (`tradeJournal/{uid}`). All numbers come from real,
 * server-side analytics computed in `/api/verified-performance`. With no
 * entries the page surfaces an explicit empty state instead of zeroes that
 * imply history.
 */

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AccountShell from "@/components/account/AccountShell";
import {
    Shield,
    TrendingUp,
    Activity,
    Target,
    BarChart3,
    Loader2,
    RefreshCw,
    Award,
    Crown,
    TrendingDown,
    Radio,
    Sparkles,
} from "lucide-react";

interface VerifiedData {
    verifiedAt: string;
    source: "tradeJournal";
    hasData: boolean;
    totalTrades: number;
    wins: number;
    losses: number;
    decided: number;
    winRate: number;
    netR: number;
    avgReturn: number;
    expectancy: number;
    profitFactor: number | null;
    profitFactorUnbounded: boolean;
    grossWin: number;
    grossLoss: number;
    sharpeLike: number;
    maxDrawdownR: number;
    maxDrawdownPct: number;
    largestWin: number;
    largestLoss: number;
    consecutiveWins: number;
    consecutiveLosses: number;
    maxWinStreak: number;
    maxLossStreak: number;
    tradingDays: number;
    weeksCovered: number;
    bestWeek: number;
    worstWeek: number;
    avgTradesPerWeek: number;
    totalPnlUsd: number | null;
    hasPnl: boolean;
    signalCorrelation: {
        userSignalsTotal: number;
        userSignalsWithTrades: number;
        tradesLinkedToSignal: number;
        coverage: number;
    };
    riskMetrics: {
        maxDrawdownR: number;
        maxDrawdownPct: number;
        profitFactor: number | null;
        expectancy: number;
        sharpeRatio: number;
        largestWin: number;
        largestLoss: number;
        maxWinStreak: number;
        maxLossStreak: number;
    };
}

function formatPF(pf: number | null, unbounded: boolean): string {
    if (pf === null) return unbounded ? "∞" : "—";
    return pf.toFixed(2);
}

function formatSigned(n: number, digits = 2): string {
    if (!Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function formatR(n: number, digits = 2): string {
    if (!Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}R`;
}

export default function VerifiedPerformancePage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [data, setData] = useState<VerifiedData | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchPerformance = async () => {
        if (!user) return;
        setLoading(true);
        setError("");
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/verified-performance", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
            const json = await res.json();
            if (json.success) setData(json.verifiedPerformance);
            else setError(json.error || "Failed to load performance data");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to reach the verified-performance endpoint.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (!authLoading && user) void Promise.resolve().then(() => fetchPerformance()); }, [authLoading, user]);

    if (authLoading) {
        return (
            <AccountShell title="Verified Performance" subtitle="Audited trading performance metrics">
                <div className="flex flex-1 items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell
            title="Verified Performance"
            subtitle="Audited trading performance from your trade journal"
            onBack={() => router.push("/account")}
        >
            <div className="space-y-6" data-guide="page-header">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm text-violet-400 font-medium">
                        <Shield className="h-4 w-4" />
                        Real metrics · source: tradeJournal
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            href="/live-performance"
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10"
                        >
                            <Radio className="h-4 w-4 text-emerald-400" />
                            Live Performance
                        </Link>
                        <button
                            type="button"
                            onClick={() => void fetchPerformance()}
                            disabled={loading}
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/10 disabled:opacity-60"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                            {loading ? "Refreshing…" : "Refresh"}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
                )}

                {!data ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                    </div>
                ) : !data.hasData ? (
                    <EmptyJournalState />
                ) : (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-guide="stats">
                            <StatCard
                                icon={<Activity className="h-5 w-5 text-emerald-400" />}
                                label="Total Trades"
                                value={data.totalTrades.toString()}
                                sub={`${data.wins}W · ${data.losses}L`}
                            />
                            <StatCard
                                icon={<Target className="h-5 w-5 text-violet-400" />}
                                label="Trading Days"
                                value={data.tradingDays.toString()}
                                sub={data.weeksCovered > 0 ? `${data.weeksCovered} weeks covered` : "—"}
                            />
                            <StatCard
                                icon={<TrendingUp className="h-5 w-5 text-amber-400" />}
                                label="Avg Return"
                                value={formatR(data.avgReturn, 2)}
                                sub={`Net ${formatR(data.netR, 2)}`}
                            />
                            <StatCard
                                icon={<Shield className="h-5 w-5 text-rose-400" />}
                                label="Max Drawdown"
                                value={`-${data.maxDrawdownPct.toFixed(1)}%`}
                                sub={data.maxDrawdownR > 0 ? `${data.maxDrawdownR.toFixed(2)}R peak-to-trough` : "No drawdown yet"}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard
                                icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
                                label="Win Rate"
                                value={data.decided > 0 ? `${data.winRate.toFixed(1)}%` : "—"}
                                sub={`${data.wins}W / ${data.losses}L (decided)`}
                            />
                            <StatCard
                                icon={<TrendingDown className="h-5 w-5 text-rose-400" />}
                                label="Expectancy"
                                value={formatR(data.expectancy, 2)}
                                sub={data.decided > 0 ? `${data.decided} decided trades` : "Awaiting decided trades"}
                            />
                            <StatCard
                                icon={<BarChart3 className="h-5 w-5 text-violet-400" />}
                                label="Profit Factor"
                                value={formatPF(data.profitFactor, data.profitFactorUnbounded)}
                                sub={`${data.grossWin.toFixed(2)}R won · ${data.grossLoss.toFixed(2)}R lost`}
                            />
                            <StatCard
                                icon={<Award className="h-5 w-5 text-amber-400" />}
                                label="Largest Win / Loss"
                                value={`${formatSigned(data.largestWin, 2)} / ${formatSigned(data.largestLoss, 2)}`}
                                sub="single-trade extremes"
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <TrendingUp className="h-4 w-4" />Sharpe (R-distribution)
                                </div>
                                <p className="mt-2 text-2xl font-bold text-foreground">
                                    {data.totalTrades > 1 ? data.sharpeLike.toFixed(2) : "—"}
                                </p>
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                    {data.totalTrades > 1 ? "mean R / std-dev R" : "needs ≥ 2 trades"}
                                </p>
                            </div>

                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
                                <div className="flex items-center gap-2 text-emerald-400">
                                    <Shield className="h-5 w-5" />
                                    <span className="text-sm font-semibold">Risk Assessment</span>
                                </div>
                                <div className="mt-3 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Max Drawdown</span>
                                        <span className="text-foreground">{data.maxDrawdownPct.toFixed(1)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Profit Factor</span>
                                        <span className="text-foreground">{formatPF(data.profitFactor, data.profitFactorUnbounded)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Expectancy</span>
                                        <span className="text-foreground">{formatR(data.expectancy, 2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Sharpe</span>
                                        <span className="text-foreground">{data.totalTrades > 1 ? data.sharpeLike.toFixed(2) : "—"}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-5">
                                <div className="flex items-center gap-2 text-violet-400">
                                    <Target className="h-5 w-5" />
                                    <span className="text-sm font-semibold">Consistency</span>
                                </div>
                                <div className="mt-3 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Avg Trades / Week</span>
                                        <span className="text-foreground">{data.avgTradesPerWeek.toFixed(1)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Best Week</span>
                                        <span className="text-foreground">{formatR(data.bestWeek, 2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Worst Week</span>
                                        <span className="text-foreground">{formatR(data.worstWeek, 2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Weeks Covered</span>
                                        <span className="text-foreground">{data.weeksCovered}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
                                <div className="flex items-center gap-2 text-amber-400">
                                    <Crown className="h-5 w-5" />
                                    <span className="text-sm font-semibold">Signal Stats</span>
                                </div>
                                <div className="mt-3 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Trades Linked to Signal</span>
                                        <span className="text-foreground">{data.signalCorrelation.tradesLinkedToSignal}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Signal Coverage</span>
                                        <span className="text-foreground">
                                            {data.totalTrades > 0 ? `${data.signalCorrelation.coverage.toFixed(1)}%` : "—"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">User Signals</span>
                                        <span className="text-foreground">{data.signalCorrelation.userSignalsTotal}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">With Trades</span>
                                        <span className="text-foreground">{data.signalCorrelation.userSignalsWithTrades}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard
                                icon={<Sparkles className="h-5 w-5 text-emerald-400" />}
                                label="Current Streak"
                                value={data.consecutiveWins > 0
                                    ? `${data.consecutiveWins}W`
                                    : data.consecutiveLosses > 0
                                        ? `${data.consecutiveLosses}L`
                                        : "—"}
                                sub="newest first"
                            />
                            <StatCard
                                icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
                                label="Max Win Streak"
                                value={data.maxWinStreak > 0 ? `${data.maxWinStreak}W` : "—"}
                                sub="longest run"
                            />
                            <StatCard
                                icon={<TrendingDown className="h-5 w-5 text-rose-400" />}
                                label="Max Loss Streak"
                                value={data.maxLossStreak > 0 ? `${data.maxLossStreak}L` : "—"}
                                sub="longest run"
                            />
                            <StatCard
                                icon={<BarChart3 className="h-5 w-5 text-violet-400" />}
                                label="Total P/L"
                                value={data.hasPnl && data.totalPnlUsd !== null
                                    ? `${data.totalPnlUsd > 0 ? "+" : ""}$${data.totalPnlUsd.toFixed(2)}`
                                    : "—"}
                                sub={data.hasPnl ? "USD, journal-reported" : "no USD field in journal"}
                            />
                        </div>

                        <div className="rounded-2xl border border-border/30 bg-card/40 p-4 text-xs text-muted-foreground">
                            Verified at {new Date(data.verifiedAt).toLocaleString()} · source: <code className="text-foreground">tradeJournal/{`{uid}`}</code> · {data.totalTrades} trade{data.totalTrades === 1 ? "" : "s"} aggregated
                        </div>
                    </>
                )}
            </div>
        </AccountShell>
    );
}

function StatCard({
    icon,
    label,
    value,
    sub,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub?: string;
}) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {icon}
                <span>{label}</span>
            </div>
            <p className="mt-2 text-lg font-bold text-foreground">{value}</p>
            {sub && <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>}
        </div>
    );
}

function EmptyJournalState() {
    return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12">
            <div className="flex flex-col items-center text-center">
                <Shield className="h-10 w-10 text-violet-400" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">No journal trades yet</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    Verified performance is computed live from your trade journal. Log a WIN or LOSS trade and the
                    stats below will populate from real data — win rate, drawdown, expectancy, streaks, and signal
                    coverage are all driven off what you actually record.
                </p>
                <div className="mt-6 grid gap-2 text-left text-xs text-muted-foreground sm:grid-cols-2">
                    <div>· Win rate from decided trades (WIN/LOSS)</div>
                    <div>· Max drawdown from synthetic R-equity</div>
                    <div>· Expectancy = mean R per trade</div>
                    <div>· Profit factor = gross W / gross L</div>
                    <div>· Sharpe = mean R / std-dev R</div>
                    <div>· Signal coverage = trades linked to a signal</div>
                </div>
            </div>
        </div>
    );
}