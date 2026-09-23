"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
    Activity,
    BarChart3,
    Coins,
    Eye,
    FileText,
    Megaphone,
    MousePointerClick,
    Radio,
    TrendingUp,
    Users,
    Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtCurrency, fmtNumber, fmtRelative } from "@/components/growth/admin/format";
import { CAMPAIGN_OBJECTIVE_LABELS, MARKETING_TASK_STATES, CHANNEL_LABELS, REVENUE_LABELS } from "@/lib/growth/constants";

type OverviewMetrics = {
    totalEvents: number;
    impressions: number;
    clicks: number;
    conversions: number;
    signups: number;
    revenueTotal: number;
    revenueAds: number;
    revenueAffiliate: number;
    revenueSponsored: number;
    revenueSubscription: number;
    revenueMarketplace: number;
    campaignCount: number;
    activeCampaigns: number;
    metricCount: number;
    placementCount: number;
    insufficient: boolean;
};

type CampaignRow = {
    id: string;
    name: string;
    objective?: string;
    status?: string;
    channels?: string[];
    startDate?: number;
    endDate?: number;
    createdAt: number;
};

type ContentRow = { id: string; state: string; type: string; channels: string[]; updatedAt?: number };

type RevenueEntry = {
    id?: string;
    type: string;
    amount: number;
    currency?: string;
    recordedAt: number;
    estimated?: boolean;
    campaignId?: string;
    offerId?: string;
};

type RevenuePayload = {
    ads: number;
    affiliate: number;
    sponsored: number;
    subscriptions: number;
    marketplace: number;
    total: number;
    entries: RevenueEntry[];
};

type ChannelStatus = { type: string; state: string };

const RANGE_MS: Record<string, number> = { all: 0, "30": 30 * 86_400_000, "90": 90 * 86_400_000 };

function pct(part: number, whole: number): string {
    return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

export default function AdminGrowthOverviewPage() {
    const [range, setRange] = useState<"all" | "30" | "90">("30");
    // Stable "now" for the revenue window — refreshed on range change (never mid-render).
    const [now, setNow] = useState(() => Date.now());

    const changeRange = (r: "all" | "30" | "90") => {
        setRange(r);
        setNow(Date.now());
    };

    const overview = useAdminFetch<OverviewMetrics>("/api/growth/overview");
    const campaigns = useAdminFetch<CampaignRow[]>("/api/growth/campaigns");
    const content = useAdminFetch<ContentRow[]>("/api/growth/content");
    const channels = useAdminFetch<ChannelStatus[]>("/api/growth/channels/status");
    const revenue = useAdminFetch<RevenuePayload>("/api/growth/revenue");

    const anyLoading = overview.loading || campaigns.loading || content.loading || channels.loading || revenue.loading;
    const anyError = overview.error || campaigns.error || content.error || channels.error || revenue.error;

    const refreshAll = () => {
        overview.refresh();
        campaigns.refresh();
        content.refresh();
        channels.refresh();
        revenue.refresh();
    };

    // Revenue section respects the selected range (real, client-side filter on recordedAt).
    const revenueForRange = useMemo(() => {
        const cutoff = RANGE_MS[range];
        const entries = revenue.data?.entries || [];
        const scoped = cutoff ? entries.filter((e) => (e.recordedAt || 0) >= now - cutoff) : entries;
        const sum = (type: string) => scoped.filter((e) => e.type === type).reduce((acc, e) => acc + Number(e.amount || 0), 0);
        return {
            entries: scoped,
            ads: sum("AD"),
            affiliate: sum("AFFILIATE"),
            sponsored: sum("SPONSORED"),
            subscriptions: sum("SUBSCRIPTION"),
            marketplace: sum("MARKETPLACE"),
            estimated: scoped.filter((e) => e.estimated).reduce((acc, e) => acc + Number(e.amount || 0), 0),
        };
    }, [revenue.data, range, now]);

    const taskStateCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const t of content.data || []) counts[t.state] = (counts[t.state] || 0) + 1;
        return counts;
    }, [content.data]);

    if (anyLoading) {
        return (
            <div className="space-y-6" role="status" aria-label="Loading growth overview">
                <PageHeader title="Growth overview" subtitle="Operational view across campaigns, content, channels and revenue." />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-28" />
                    ))}
                </div>
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
            </div>
        );
    }

    if (anyError) {
        return (
            <ErrorState
                title="Couldn't load growth data"
                description={anyError}
                action={<Button type="button" variant="outline" onClick={refreshAll}>Retry</Button>}
            />
        );
    }

    const m = overview.data;
    const hasEvents = Boolean(m && m.impressions >= 0 && m.totalEvents > 0);
    const insufficientTraffic = Boolean(m && m.impressions < 50);
    const insufficientRevenue = Boolean(m && m.revenueTotal <= 0);

    const metricCards = m
        ? [
              { label: "Impressions", value: fmtNumber(m.impressions), icon: <Eye size={16} /> },
              { label: "Clicks", value: fmtNumber(m.clicks), icon: <MousePointerClick size={16} /> },
              { label: "CTR", value: pct(m.clicks, m.impressions), icon: <TrendingUp size={16} /> },
              { label: "Active campaigns", value: fmtNumber(m.activeCampaigns), icon: <Megaphone size={16} /> },
              { label: "Conversions", value: fmtNumber(m.conversions), icon: <Activity size={16} /> },
              { label: "Total events", value: fmtNumber(m.totalEvents), icon: <BarChart3 size={16} /> },
          ]
        : [];

    return (
        <div className="space-y-6">
            <PageHeader
                title="Growth overview"
                subtitle="Operational view across campaigns, content, channels and revenue."
                actions={
                    <>
                        <select
                            aria-label="Revenue date range"
                            value={range}
                            onChange={(e) => changeRange(e.target.value as "all" | "30" | "90")}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <option value="30">Revenue · last 30 days</option>
                            <option value="90">Revenue · last 90 days</option>
                            <option value="all">Revenue · all time</option>
                        </select>
                        <RefreshButton onRefresh={refreshAll} loading={anyLoading} />
                    </>
                }
            />

            {!hasEvents ? (
                <EmptyState
                    icon={<Wallet size={18} />}
                    title="No growth data yet"
                    description="Ad impressions, clicks and revenue will appear here once the placements and campaigns go live. Create a campaign or publish content to get started."
                    action={
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" render={<Link href="/admin/growth/campaigns" />}>
                                Create a campaign
                            </Button>
                            <Button type="button" variant="outline" size="sm" render={<Link href="/admin/growth/content" />}>
                                Manage content
                            </Button>
                        </div>
                    }
                />
            ) : (
                <>
                    {/* ── Metric cards ── */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        {metricCards.map((c) => (
                            <MetricCard key={c.label} label={c.label} value={c.value} icon={c.icon} />
                        ))}
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        {/* ── Traffic ── */}
                        <div className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-medium text-foreground">Traffic</h2>
                                <TrendingUp size={15} className="text-muted-foreground" />
                            </div>
                            {insufficientTraffic ? (
                                <EmptyState
                                    compact
                                    icon={<TrendingUp size={16} />}
                                    title="Insufficient data"
                                    description="Traffic metrics need at least 50 recorded impressions before they are meaningful."
                                />
                            ) : (
                                <div className="grid grid-cols-3 gap-3">
                                    {[
                                        { label: "Impressions", value: fmtNumber(m?.impressions ?? 0) },
                                        { label: "Clicks", value: fmtNumber(m?.clicks ?? 0) },
                                        { label: "CTR", value: pct(m?.clicks ?? 0, m?.impressions ?? 0) },
                                    ].map((s) => (
                                        <div key={s.label} className="rounded-md border border-border bg-background p-3">
                                            <p className="text-xs text-muted-foreground">{s.label}</p>
                                            <p className="mt-1 text-lg font-semibold text-foreground">{s.value}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* ── Conversion ── */}
                        <div className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-medium text-foreground">Conversion</h2>
                                <Activity size={15} className="text-muted-foreground" />
                            </div>
                            {m && m.conversions === 0 && m.signups === 0 ? (
                                <EmptyState
                                    compact
                                    icon={<Activity size={16} />}
                                    title="No conversions yet"
                                    description="Affiliate conversions and signups recorded through tracked links will appear here."
                                />
                            ) : (
                                <div className="grid grid-cols-3 gap-3">
                                    {[
                                        { label: "Conversions", value: fmtNumber(m?.conversions ?? 0) },
                                        { label: "Affiliate signups", value: fmtNumber(m?.signups ?? 0) },
                                        { label: "Conv. rate", value: pct(m?.conversions ?? 0, m?.impressions ?? 0) },
                                    ].map((s) => (
                                        <div key={s.label} className="rounded-md border border-border bg-background p-3">
                                            <p className="text-xs text-muted-foreground">{s.label}</p>
                                            <p className="mt-1 text-lg font-semibold text-foreground">{s.value}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="mt-3 text-xs text-muted-foreground">
                                Platform registrations are not tracked by the growth engine yet — use affiliate signups as the conversion signal.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-3">
                        {/* ── Campaign performance ── */}
                        <section className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-medium text-foreground">Campaign performance</h2>
                                <Megaphone size={15} className="text-muted-foreground" />
                            </div>
                            {(campaigns.data || []).length === 0 ? (
                                <EmptyState compact icon={<Megaphone size={16} />} title="No campaigns" description="Create a campaign to track its performance here." />
                            ) : (
                                <>
                                    <div className="mb-3 flex flex-wrap gap-1.5">
                                        {["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"].map((st) => {
                                            const count = (campaigns.data || []).filter((c) => (c.status || "DRAFT") === st).length;
                                            if (count === 0) return null;
                                            return <GrowthStatusBadge key={st} kind="campaign" value={st} />;
                                        })}
                                    </div>
                                    <ul className="space-y-2">
                                        {(campaigns.data || []).slice(0, 6).map((c) => (
                                            <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                                                <Link href={`/admin/growth/campaigns/${c.id}`} className="truncate font-medium text-foreground hover:text-primary">
                                                    {c.name}
                                                </Link>
                                                <span className="shrink-0 text-muted-foreground">
                                                    {c.objective ? CAMPAIGN_OBJECTIVE_LABELS[c.objective as keyof typeof CAMPAIGN_OBJECTIVE_LABELS] || c.objective : "—"}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </section>

                        {/* ── Content performance ── */}
                        <section className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-medium text-foreground">Content performance</h2>
                                <FileText size={15} className="text-muted-foreground" />
                            </div>
                            {content.data && content.data.length === 0 ? (
                                <EmptyState compact icon={<FileText size={16} />} title="No content yet" description="Generated content will appear here by state." />
                            ) : (
                                <div className="flex flex-wrap gap-1.5">
                                    {MARKETING_TASK_STATES.map((st) => {
                                        const count = taskStateCounts[st] || 0;
                                        if (count === 0) return null;
                                        return (
                                            <span key={st} className="inline-flex items-center gap-1.5">
                                                <GrowthStatusBadge kind="task" value={st} />
                                                <span className="text-xs text-muted-foreground">{count}</span>
                                            </span>
                                        );
                                    })}
                                </div>
                            )}
                            {m && m.metricCount > 0 && (
                                <p className="mt-3 text-xs text-muted-foreground">Analytics snapshots recorded: {fmtNumber(m.metricCount)}</p>
                            )}
                        </section>

                        {/* ── Channel performance ── */}
                        <section className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-medium text-foreground">Channel performance</h2>
                                <Radio size={15} className="text-muted-foreground" />
                            </div>
                            {(channels.data || []).length === 0 ? (
                                <EmptyState compact icon={<Radio size={16} />} title="No channel status" description="Channel configuration state appears here once checked." />
                            ) : (
                                <ul className="space-y-2">
                                    {(channels.data || []).map((c) => (
                                        <li key={c.type} className="flex items-center justify-between gap-2 text-xs">
                                            <span className="truncate font-medium text-foreground">{CHANNEL_LABELS[c.type as keyof typeof CHANNEL_LABELS] || c.type}</span>
                                            <GrowthStatusBadge kind="channel" value={c.state} />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </div>

                    {/* ── Revenue summary ── */}
                    <section className="rounded-lg border border-border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-medium text-foreground">Revenue summary</h2>
                            <Coins size={15} className="text-muted-foreground" />
                        </div>
                        {insufficientRevenue && revenueForRange.entries.length === 0 ? (
                            <EmptyState
                                compact
                                icon={<Coins size={16} />}
                                title="No revenue recorded"
                                description="Revenue is only shown from real recorded entries (ad network, affiliate conversions, sponsored contracts, subscriptions, marketplace). Nothing is estimated."
                            />
                        ) : (
                            <>
                                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                                    {[
                                        { label: REVENUE_LABELS.AD, value: revenueForRange.ads },
                                        { label: REVENUE_LABELS.AFFILIATE, value: revenueForRange.affiliate },
                                        { label: REVENUE_LABELS.SPONSORED, value: revenueForRange.sponsored },
                                        { label: REVENUE_LABELS.SUBSCRIPTION, value: revenueForRange.subscriptions },
                                        { label: REVENUE_LABELS.MARKETPLACE, value: revenueForRange.marketplace },
                                        { label: "Total", value: revenueForRange.ads + revenueForRange.affiliate + revenueForRange.sponsored + revenueForRange.subscriptions + revenueForRange.marketplace },
                                    ].map((r) => (
                                        <div key={r.label} className="rounded-md border border-border bg-background p-3">
                                            <p className="text-xs text-muted-foreground">{r.label}</p>
                                            <p className="mt-1 text-lg font-semibold text-foreground">{fmtCurrency(r.value)}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                    <span>
                                        Records in period: <b className="text-foreground">{revenueForRange.entries.length}</b>
                                    </span>
                                    {revenueForRange.estimated > 0 && (
                                        <span className="text-amber-600">
                                            Estimated portion: <b>{fmtCurrency(revenueForRange.estimated)}</b> (derived from eCPM/contracts — never presented as confirmed)
                                        </span>
                                    )}
                                    <span className="ml-auto inline-flex items-center gap-1.5">
                                        <Users size={13} /> Placements configured: <b className="text-foreground">{fmtNumber(m?.placementCount ?? 0)}</b>
                                    </span>
                                </div>
                            </>
                        )}
                    </section>

                    {/* ── Recent revenue entries ── */}
                    {revenueForRange.entries.length > 0 && (
                        <section className="rounded-lg border border-border bg-card p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h2 className="text-sm font-medium text-foreground">Recent revenue</h2>
                                <span className="text-xs text-muted-foreground">Latest {Math.min(revenueForRange.entries.length, 8)} entries</span>
                            </div>
                            <ul className="space-y-2">
                                {[...revenueForRange.entries]
                                    .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
                                    .slice(0, 8)
                                    .map((e, i) => (
                                        <li key={e.id || i} className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 text-xs last:border-0 last:pb-0">
                                            <span className="inline-flex items-center gap-2">
                                                <GrowthStatusBadge kind="revenue" value={e.type} />
                                                {e.estimated && <span className="rounded bg-warning-muted px-1.5 py-0.5 text-[10px] text-warning-foreground">estimate</span>}
                                            </span>
                                            <span className="truncate text-muted-foreground">
                                                {e.type === "AFFILIATE" && e.offerId ? `offer ${e.offerId.slice(-6)}` : e.type === "SPONSORED" ? "sponsored contract" : e.type}
                                                {e.recordedAt ? ` · ${fmtRelative(e.recordedAt)}` : ""}
                                            </span>
                                            <span className="font-semibold text-foreground">{fmtCurrency(e.amount, e.currency)}</span>
                                        </li>
                                    ))}
                            </ul>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}