"use client";

import {
    Activity,
    BarChart3,
    CheckCircle2,
    Layers,
    ShieldCheck,
    Target,
    TrendingDown,
    TrendingUp,
} from "lucide-react";
import type { SignalAnalytics } from "@/lib/ai-signals/types";

type MetricCardProps = {
    label: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
    tone?: "default" | "success" | "warning" | "danger";
};

const toneClasses = {
    default: "text-foreground",
    success: "text-emerald-400",
    warning: "text-amber-400",
    danger: "text-red-400",
};

function MetricCard({ label, value, detail, icon, tone = "default" }: MetricCardProps) {
    return (
        <div className="rounded-xl border border-border/30 bg-background/60 p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{label}</span>
                <span className={tone === "default" ? "text-muted-foreground" : toneClasses[tone]}>{icon}</span>
            </div>
            <div className={`mt-2 text-2xl font-black ${toneClasses[tone]}`}>{value}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
        </div>
    );
}

function HitRateBar({ label, value, count, total }: { label: string; value: number; count: number; total: number }) {
    return (
        <div className="rounded-xl border border-border/20 bg-muted/5 p-4">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-muted-foreground">{label}</span>
                <span className="text-sm font-black text-emerald-400">{value.toFixed(1)}%</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min(value, 100)}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
                {count} of {total} signals
            </p>
        </div>
    );
}

export default function SignalAnalyticsDashboard({ analytics }: { analytics: SignalAnalytics }) {
    const total = analytics.totalSignals;
    const winRecord = `${analytics.winningSignals}W / ${analytics.losingSignals}L`;
    const outcomeTotal = analytics.winningSignals + analytics.losingSignals + analytics.breakevenSignals;
    const winPercent = outcomeTotal > 0 ? (analytics.winningSignals / outcomeTotal) * 100 : 0;
    const lossPercent = outcomeTotal > 0 ? (analytics.losingSignals / outcomeTotal) * 100 : 0;
    const breakevenPercent = outcomeTotal > 0 ? (analytics.breakevenSignals / outcomeTotal) * 100 : 0;

    return (
        <section className="mt-10 rounded-2xl border border-border/30 bg-card/60 p-6 backdrop-blur-xl" data-guide="analytics">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-amber-400" />
                        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Signal Analytics</h2>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Historical performance across all recorded signals
                    </p>
                </div>
                <span className="text-[11px] text-muted-foreground">
                    Updated {new Date(analytics.generatedAt).toLocaleString()}
                </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Total Signals"
                    value={total.toString()}
                    detail={`${analytics.activeSignals} currently active`}
                    icon={<Target className="h-4 w-4 text-amber-400" />}
                />
                <MetricCard
                    label="Currently Active Signals"
                    value={analytics.activeSignals.toString()}
                    detail="Ready, active, or progressing"
                    icon={<Activity className="h-4 w-4 text-emerald-400" />}
                    tone="success"
                />
                <MetricCard
                    label="Win Rate"
                    value={`${analytics.winRate.toFixed(1)}%`}
                    detail={winRecord}
                    icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    tone="success"
                />
                <MetricCard
                    label="Avg R:R"
                    value={`1:${analytics.averageRR.toFixed(1)}`}
                    detail="Average planned risk-to-reward"
                    icon={<Layers className="h-4 w-4 text-blue-400" />}
                />
                <MetricCard
                    label="Average Confidence Level"
                    value={`${analytics.averageConfidence.toFixed(0)}%`}
                    detail={`Across ${total} recorded signals`}
                    icon={<TrendingUp className="h-4 w-4 text-amber-400" />}
                />
                <MetricCard
                    label="TP1 Hit Rate"
                    value={`${analytics.tp1HitRate.toFixed(1)}%`}
                    detail={`${analytics.tp1Hits} signals reached TP1`}
                    icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
                    tone="success"
                />
                <MetricCard
                    label="TP2 Hit Rate"
                    value={`${analytics.tp2HitRate.toFixed(1)}%`}
                    detail={`${analytics.tp2Hits} signals reached TP2`}
                    icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
                    tone="success"
                />
                <MetricCard
                    label="SL Hit Rate"
                    value={`${analytics.slRate.toFixed(1)}%`}
                    detail={`${analytics.slHits} signals stopped out`}
                    icon={<TrendingDown className="h-4 w-4 text-red-400" />}
                    tone="danger"
                />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-5">
                <div className="rounded-xl border border-border/20 bg-background/60 p-4 lg:col-span-2">
                    <h3 className="text-xs font-bold text-foreground">Outcome Mix</h3>
                    <div className="mt-4 space-y-3">
                        <HitRateBar label="Wins" value={winPercent} count={analytics.winningSignals} total={outcomeTotal} />
                        <HitRateBar label="Losses" value={lossPercent} count={analytics.losingSignals} total={outcomeTotal} />
                        <HitRateBar label="Breakeven" value={breakevenPercent} count={analytics.breakevenSignals} total={outcomeTotal} />
                    </div>
                </div>
                <div className="rounded-xl border border-border/20 bg-background/60 p-4 lg:col-span-3">
                    <h3 className="text-xs font-bold text-foreground">Target Progression</h3>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <HitRateBar label="TP1" value={analytics.tp1HitRate} count={analytics.tp1Hits} total={total} />
                        <HitRateBar label="TP2" value={analytics.tp2HitRate} count={analytics.tp2Hits} total={total} />
                        <HitRateBar label="SL" value={analytics.slRate} count={analytics.slHits} total={total} />
                    </div>
                </div>
            </div>
        </section>
    );
}
