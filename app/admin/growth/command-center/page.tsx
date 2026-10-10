"use client";

/**
 * Growth Command Center.
 *
 * Every figure on this page is computed server-side from real product events
 * and real records. There are no seeded, estimated, or placeholder numbers:
 * when a metric has no data behind it the cell reads "No data yet". If you
 * cannot measure something, showing zero would be a lie, so we don't.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { fmtNumber } from "@/components/growth/admin/format";

type FunnelStep = {
    stage: string;
    label: string;
    users: number;
    stepConversionPct: number | null;
    totalConversionPct: number;
    insufficient: boolean;
};

type FeatureCorrelation = {
    feature: string;
    users: number;
    converted: number;
    conversionPct: number;
    baselineUsers: number;
    baselineConversionPct: number;
    liftPctPoints: number;
    strength: "strong" | "medium" | "low" | "none";
    insufficient: boolean;
};

type TriggerReport = {
    trigger: string;
    users: number;
    reachedCheckout: number;
    subscribed: number;
    conversionPct: number | null;
    avgUsageActions: number;
    insufficient: boolean;
};

type CommandCenter = {
    generatedAt: number;
    windowDays: number;
    totals: {
        visitors: number | null;
        signups: number | null;
        activatedUsers: number | null;
        proUsers: number | null;
    };
    funnel: FunnelStep[];
    summary: {
        visitorToSignupPct: number | null;
        signupToActivationPct: number | null;
        activationToProPct: number | null;
        visitorToProPct: number | null;
    };
    activation: { ratePct: number | null; insufficient: boolean };
    retention: { wau: number; mau: number; ratioPct: number | null };
    featureAttribution: FeatureCorrelation[];
    upgradeIntents: TriggerReport[];
    dataQuality: {
        eventsScanned: number;
        scannedTruncated: boolean;
        hasProductEvents: boolean;
    };
};

/** Renders a number honestly: "No data yet" instead of a fabricated 0. */
function Metric({ value, suffix = "" }: { value: number | null; suffix?: string }) {
    if (value === null) {
        return <span className="text-muted-foreground">No data yet</span>;
    }
    return (
        <>
            {fmtNumber(value)}
            {suffix}
        </>
    );
}

function Pct({ value, digits = 1 }: { value: number | null; digits?: number }) {
    if (value === null) return <span className="text-muted-foreground">No data yet</span>;
    return <>{value.toFixed(digits)}%</>;
}

function StrengthBadge({ strength, insufficient }: { strength: FeatureCorrelation["strength"]; insufficient: boolean }) {
    if (insufficient) {
        return <span className="text-xs text-muted-foreground">Not enough users</span>;
    }
    const styles: Record<FeatureCorrelation["strength"], string> = {
        strong: "bg-positive/10 text-positive dark:text-positive",
        medium: "bg-warning/10 text-warning dark:text-warning",
        low: "bg-muted text-muted-foreground",
        none: "bg-muted text-muted-foreground",
    };
    const labels: Record<FeatureCorrelation["strength"], string> = {
        strong: "Strong correlation",
        medium: "Medium correlation",
        low: "Low correlation",
        none: "No clear signal",
    };
    return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[strength]}`}>{labels[strength]}</span>;
}

export default function GrowthCommandCenterPage() {
    const [days, setDays] = useState("30");
    const { data, loading, error, refresh } = useAdminFetch<CommandCenter>(`/api/analytics/command-center?days=${days}`, [days]);

    const maxFunnelUsers = useMemo(
        () => (data?.funnel ? Math.max(...data.funnel.map((f) => f.users), 1) : 1),
        [data]
    );

    if (loading) {
        return (
            <div className="space-y-4">
                <PageHeader title="Growth Command Center" subtitle="Acquisition, activation, conversion and retention" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-24" />
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Could not load growth data"
                description={error}
                action={
                    <button type="button" onClick={refresh} className="text-sm text-primary underline-offset-4 hover:underline">
                        Try again
                    </button>
                }
            />
        );
    }
    if (!data) return null;

    const noData = !data.dataQuality.hasProductEvents;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Growth Command Center"
                subtitle={`Real product data over the last ${data.windowDays} days. Generated ${new Date(data.generatedAt).toLocaleString()}.`}
                actions={
                    <div className="flex items-center gap-2">
                        <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Time window" className="w-36">
                            <option value="7">Last 7 days</option>
                            <option value="30">Last 30 days</option>
                            <option value="90">Last 90 days</option>
                        </Select>
                        <RefreshButton onRefresh={refresh} loading={loading} />
                    </div>
                }
            />

            {noData ? (
                <EmptyState
                    title="No product events recorded yet"
                    description="The command center populates from real user actions in the product. Once users start using the Terminal, Research and Paper Trading, acquisition and activation data will appear here."
                    action={
                        <Link href="/admin/growth" className="text-sm text-primary underline-offset-4 hover:underline">
                            Back to growth overview
                        </Link>
                    }
                />
            ) : null}


            {data.dataQuality.scannedTruncated ? (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning dark:text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <p>
                        Only the most recent {fmtNumber(data.dataQuality.eventsScanned)} events were scanned. Older
                        events exist but were not included in this view.
                    </p>
                </div>
            ) : null}

            {/* ── Acquisition & activation ───────────────────────────────── */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Visitors"
                    value={<Metric value={data.totals.visitors} />}
                    footnote="Distinct anonymous visitors recorded in-window"
                />
                <MetricCard
                    label="Signups"
                    value={<Metric value={data.totals.signups} />}
                    footnote={
                        data.summary.visitorToSignupPct === null
                            ? "Not enough visitors to compute a rate"
                            : `${data.summary.visitorToSignupPct.toFixed(2)}% of visitors`
                    }
                />
                <MetricCard
                    label="Activated users"
                    value={<Metric value={data.totals.activatedUsers} />}
                    footnote={
                        data.activation.ratePct === null
                            ? "No signups to measure activation against"
                            : `${data.activation.ratePct.toFixed(1)}% activation${data.activation.insufficient ? " (small sample)" : ""}`
                    }
                />
                <MetricCard
                    label="Pro subscribers"
                    value={<Metric value={data.totals.proUsers} />}
                    footnote={
                        data.summary.activationToProPct === null
                            ? "Not enough activated users to compute a rate"
                            : `${data.summary.activationToProPct.toFixed(1)}% of activated users`
                    }
                />
            </section>

            {/* ── Funnel ─────────────────────────────────────────────────── */}
            <section className="rounded-lg border border-border p-4">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold text-foreground">Product funnel</h2>
                    <p className="text-xs text-muted-foreground">
                        Distinct users per stage. A stage with no data shows 0 rather than an estimated number.
                    </p>
                </div>
                <ol className="space-y-1.5">
                    {data.funnel.map((step) => {
                        const width = Math.max((step.users / maxFunnelUsers) * 100, step.users > 0 ? 2 : 0);
                        return (
                            <li key={step.stage} className="grid grid-cols-[10rem_1fr_auto] items-center gap-3 text-sm">
                                <span className="truncate text-muted-foreground">{step.label}</span>
                                <div className="h-6 overflow-hidden rounded bg-muted/40">
                                    <div
                                        className="h-full rounded bg-primary/70 transition-[width]"
                                        style={{ width: `${width}%` }}
                                    />
                                </div>
                                <span className="flex items-center justify-end gap-3 tabular-nums">
                                    <span className="w-16 text-right font-medium text-foreground">
                                        <Metric value={step.users} />
                                    </span>
                                    <span className="w-20 text-right text-xs text-muted-foreground">
                                        {step.stepConversionPct === null
                                            ? "—"
                                            : `${step.stepConversionPct.toFixed(1)}%`}
                                    </span>
                                </span>
                            </li>
                        );
                    })}
                </ol>
            </section>

            {/* ── Retention ──────────────────────────────────────────────── */}
            <section className="grid gap-4 sm:grid-cols-3">
                <MetricCard
                    label="Weekly active users"
                    value={fmtNumber(data.retention.wau)}
                    footnote="Meaningful product action in the last 7 days"
                />
                <MetricCard
                    label="Monthly active users"
                    value={fmtNumber(data.retention.mau)}
                    footnote="Meaningful product action in the last 30 days"
                />
                <MetricCard
                    label="Stickiness (WAU/MAU)"
                    value={<Pct value={data.retention.ratioPct} />}
                    mono={false}
                    footnote="Share of monthly actives who returned this week"
                />
            </section>

            {/* ── Feature ↔ Pro correlation ──────────────────────────────── */}
            <section className="rounded-lg border border-border p-4">
                <h2 className="text-sm font-semibold text-foreground">Which workflows correlate with Pro</h2>
                <p className="mb-4 mt-1 text-xs text-muted-foreground">
                    This is <strong>correlation, not causation</strong>. Users who use a workflow may also be power users
                    in every other sense. Treat it as a prioritisation signal, never as proof a feature causes upgrades.
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="pb-2 pr-4 font-medium">Workflow</th>
                                <th className="pb-2 pr-4 text-right font-medium">Users</th>
                                <th className="pb-2 pr-4 text-right font-medium">Activated</th>
                                <th className="pb-2 pr-4 text-right font-medium">vs. baseline</th>
                                <th className="pb-2 font-medium">Signal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.featureAttribution.map((f) => (
                                <tr key={f.feature} className="border-b border-border/50 last:border-0">
                                    <td className="py-2 pr-4 text-foreground">{f.feature}</td>
                                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                                        {fmtNumber(f.users)}
                                    </td>
                                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                                        {f.insufficient ? "—" : `${f.conversionPct.toFixed(1)}%`}
                                    </td>
                                    <td className="py-2 pr-4 text-right tabular-nums">
                                        {f.insufficient ? (
                                            <span className="text-muted-foreground">—</span>
                                        ) : (
                                            <span
                                                className={`inline-flex items-center gap-1 ${
                                                    f.liftPctPoints > 0
                                                        ? "text-positive dark:text-positive"
                                                        : f.liftPctPoints < 0
                                                          ? "text-muted-foreground"
                                                          : "text-muted-foreground"
                                                }`}
                                            >
                                                {f.liftPctPoints > 0 ? (
                                                    <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                                                ) : f.liftPctPoints < 0 ? (
                                                    <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                                                ) : (
                                                    <Minus className="h-3.5 w-3.5" aria-hidden />
                                                )}
                                                {f.liftPctPoints > 0 ? "+" : ""}
                                                {f.liftPctPoints.toFixed(1)} pts
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-2">
                                        <StrengthBadge strength={f.strength} insufficient={f.insufficient} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── What triggers upgrades ────────────────────────────────── */}
            <section className="rounded-lg border border-border p-4">
                <h2 className="text-sm font-semibold text-foreground">What users hit before upgrading</h2>
                <p className="mb-4 mt-1 text-xs text-muted-foreground">
                    The Pro capability that triggered the gate, and how many of those users went on to subscribe.
                </p>
                {data.upgradeIntents.length === 0 ? (
                    <EmptyState
                        compact
                        title="No upgrade intent recorded yet"
                        description="Upgrade intent is captured when a Free user reaches a Pro capability. Nothing recorded in this window."
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    <th className="pb-2 pr-4 font-medium">Trigger</th>
                                    <th className="pb-2 pr-4 text-right font-medium">Users</th>
                                    <th className="pb-2 pr-4 text-right font-medium">Reached checkout</th>
                                    <th className="pb-2 pr-4 text-right font-medium">Subscribed</th>
                                    <th className="pb-2 text-right font-medium">Conversion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.upgradeIntents.map((t) => (
                                    <tr key={t.trigger} className="border-b border-border/50 last:border-0">
                                        <td className="py-2 pr-4 text-foreground">{t.trigger}</td>
                                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                                            {fmtNumber(t.users)}
                                        </td>
                                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                                            {fmtNumber(t.reachedCheckout)}
                                        </td>
                                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                                            {fmtNumber(t.subscribed)}
                                        </td>
                                        <td className="py-2 text-right tabular-nums">
                                            {t.insufficient ? (
                                                <span className="text-xs text-muted-foreground">Not enough users</span>
                                            ) : (
                                                <Pct value={t.conversionPct} />
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <p className="text-xs text-muted-foreground">
                Activation measures product engagement — opening a chart, running an analysis, creating a setup,
                backtesting, researching, paper trading and reviewing a journal. It is not a measure of trading skill,
                profitability, or probability of success.
            </p>
        </div>
    );
}
