"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
    Coins,
    CreditCard,
    DollarSign,
    Globe,
    Megaphone,
    MousePointer,
    Settings as SettingsIcon,
    Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtCurrency, fmtNumber, fmtRelative } from "@/components/growth/admin/format";
import { REVENUE_LABELS, RevenueType } from "@/lib/growth/constants";

type RevenueEntry = {
    id?: string;
    type: RevenueType;
    amount: number;
    currency?: string;
    recordedAt: number;
    estimated?: boolean;
    offerId?: string;
    campaignId?: string;
    placementKey?: string;
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

type NetworkStatus = {
    type: "ADSENSE" | "ADMOB" | "CUSTOM";
    platform: "WEB" | "IOS" | "ANDROID";
    enabled: boolean;
    configured: boolean;
    testMode: boolean;
    note?: string;
    reason?: string;
};

type Settings = {
    enabled: boolean;
    premiumMode: "SHOW" | "REDUCED" | "HIDE";
    premiumReductionRatio?: number;
    globalDailyCap?: number;
    currency?: string;
};

const RANGE_MS: Record<string, number> = { all: 0, "30": 30 * 86_400_000, "90": 90 * 86_400_000 };
const REVENUE_TYPES_LIST: RevenueType[] = ["AD", "AFFILIATE", "SPONSORED", "SUBSCRIPTION", "MARKETPLACE"];

export default function AdminMonetizationPage() {
    const revenue = useAdminFetch<RevenuePayload>("/api/growth/revenue");
    const networks = useAdminFetch<NetworkStatus[]>("/api/growth/ad-networks");
    const settings = useAdminFetch<Settings | null>("/api/growth/settings");
    const placements = useAdminFetch<Record<string, unknown>[]>("/api/growth/placements");
    const ads = useAdminFetch<Record<string, unknown>[]>("/api/growth/ads");

    const [range, setRange] = useState<"all" | "30" | "90">("30");
    // Stable "now" for revenue windows; refreshed on range change (never mid-render).
    const [now, setNow] = useState(() => Date.now());

    const changeRange = (r: "all" | "30" | "90") => {
        setRange(r);
        setNow(Date.now());
    };

    const anyLoading = revenue.loading || networks.loading || settings.loading;
    const anyError = revenue.error || networks.error || settings.error;

    const refreshAll = () => {
        revenue.refresh();
        networks.refresh();
        settings.refresh();
        placements.refresh();
        ads.refresh();
    };

    const scoped = useMemo(() => {
        const cutoff = RANGE_MS[range];
        const entries = (revenue.data?.entries || []).filter((e) => !cutoff || (e.recordedAt || 0) >= now - cutoff);
        const sum = (type: RevenueType) => entries.filter((e) => e.type === type).reduce((acc, e) => acc + Number(e.amount || 0), 0);
        const total = entries.reduce((acc, e) => acc + Number(e.amount || 0), 0);
        const estimated = entries.filter((e) => e.estimated).reduce((acc, e) => acc + Number(e.amount || 0), 0);
        return { entries, total, estimated, byType: Object.fromEntries(REVENUE_TYPES_LIST.map((t) => [t, sum(t)])) as Record<RevenueType, number> };
    }, [revenue.data, range, now]);

    if (anyLoading) {
        return (
            <div className="space-y-6" role="status" aria-label="Loading monetization overview">
                <PageHeader title="Monetization" subtitle="Revenue, ad networks and placements at a glance." />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-24" />
                    ))}
                </div>
                <Skeleton className="h-48" />
            </div>
        );
    }

    if (anyError) {
        return (
            <ErrorState
                title="Couldn't load monetization data"
                description={anyError}
                action={<Button type="button" variant="outline" onClick={refreshAll}>Retry</Button>}
            />
        );
    }

    const hasEntries = scoped.entries.length > 0;
    const configuredNetworks = (networks.data || []).filter((n) => n.configured);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Monetization"
                subtitle="Revenue, ad networks and placements at a glance."
                actions={
                    <>
                        <select
                            aria-label="Revenue date range"
                            value={range}
                            onChange={(e) => changeRange(e.target.value as "all" | "30" | "90")}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <option value="30">Last 30 days</option>
                            <option value="90">Last 90 days</option>
                            <option value="all">All time</option>
                        </select>
                        <RefreshButton onRefresh={refreshAll} loading={anyLoading} />
                    </>
                }
            />

            {/* ── Metric cards ── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <MetricCard label={`Total revenue · ${range === "all" ? "all time" : `${range}d`}`} value={fmtCurrency(scoped.total)} icon={<Wallet size={16} />} />
                <MetricCard label={REVENUE_LABELS.AD} value={fmtCurrency(scoped.byType.AD)} icon={<Globe size={16} />} />
                <MetricCard label={REVENUE_LABELS.AFFILIATE} value={fmtCurrency(scoped.byType.AFFILIATE)} icon={<Coins size={16} />} />
                <MetricCard label={REVENUE_LABELS.SPONSORED} value={fmtCurrency(scoped.byType.SPONSORED)} icon={<Megaphone size={16} />} />
                <MetricCard label={REVENUE_LABELS.SUBSCRIPTION} value={fmtCurrency(scoped.byType.SUBSCRIPTION)} icon={<CreditCard size={16} />} />
                <MetricCard label={REVENUE_LABELS.MARKETPLACE} value={fmtCurrency(scoped.byType.MARKETPLACE)} icon={<DollarSign size={16} />} />
            </div>

            {!hasEntries ? (
                <EmptyState
                    icon={<Coins size={18} />}
                    title="No revenue recorded yet"
                    description="Revenue appears here only from real recorded entries — ad network payouts, affiliate conversions, sponsored contracts, subscriptions and marketplace sales. Nothing is estimated to fill this space."
                    action={
                        <div className="flex flex-wrap justify-center gap-2">
                            <Button type="button" variant="outline" size="sm" render={<Link href="/admin/monetization/placements" />}>
                                <MousePointer /> Configure placements
                            </Button>
                            <Button type="button" variant="outline" size="sm" render={<Link href="/admin/monetization/ad-networks" />}>
                                <Globe /> Check ad networks
                            </Button>
                        </div>
                    }
                />
            ) : (
                <section className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">Revenue records</h2>
                        <span className="text-xs text-muted-foreground">
                            {scoped.entries.length} record(s) in period
                        </span>
                    </div>
                    <ul className="space-y-2">
                        {[...scoped.entries]
                            .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
                            .slice(0, 10)
                            .map((e, i) => (
                                <li key={e.id || i} className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 text-xs last:border-0 last:pb-0">
                                    <span className="inline-flex items-center gap-2">
                                        <GrowthStatusBadge kind="revenue" value={e.type} />
                                        {e.estimated && (
                                            <span className="rounded bg-warning-muted px-1.5 py-0.5 text-xs text-warning-foreground">estimate</span>
                                        )}
                                    </span>
                                    <span className="truncate text-muted-foreground">
                                        {e.offerId ? `offer ${e.offerId.slice(-6)}` : e.campaignId ? `campaign ${e.campaignId.slice(-6)}` : e.placementKey || REVENUE_LABELS[e.type]}
                                        {e.recordedAt ? ` · ${fmtRelative(e.recordedAt)}` : ""}
                                    </span>
                                    <span className="font-semibold text-foreground">{fmtCurrency(e.amount, e.currency || "USD")}</span>
                                </li>
                            ))}
                    </ul>
                    {scoped.estimated > 0 && (
                        <p className="mt-3 text-xs text-warning">
                            Estimated portion in period: {fmtCurrency(scoped.estimated)} — derived from eCPM/contracts, never presented as confirmed revenue.
                        </p>
                    )}
                    <div className="mt-3">
                        <Button type="button" variant="outline" size="sm" render={<Link href="/admin/monetization/revenue" />}>
                            View all revenue
                        </Button>
                    </div>
                </section>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                {/* ── Ad networks ── */}
                <section className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">Ad networks</h2>
                        <Globe size={15} className="text-muted-foreground" />
                    </div>
                    {!networks.data || networks.data.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No network status available.</p>
                    ) : (
                        <ul className="space-y-2">
                            {[...new Map((networks.data || []).map((n) => [`${n.type}-${n.platform}`, n])).values()].map((n) => (
                                <li key={`${n.type}-${n.platform}`} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="font-medium text-foreground">
                                        {n.type} <span className="text-muted-foreground">· {n.platform}</span>
                                    </span>
                                    <GrowthStatusBadge kind="network" value={n.configured ? "CONFIGURED" : "NOT_CONFIGURED"} />
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                        {configuredNetworks.length} of {new Set((networks.data || []).map((n) => n.type)).size} network(s) configured · AdMob is mobile-only and never renders in the web app.
                    </p>
                    <div className="mt-3">
                        <Button type="button" variant="outline" size="sm" render={<Link href="/admin/monetization/ad-networks" />}>
                            Manage networks
                        </Button>
                    </div>
                </section>

                {/* ── Placements & ads ── */}
                <section className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">Placements & ads</h2>
                        <MousePointer size={15} className="text-muted-foreground" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-md border border-border bg-background p-3">
                            <p className="text-xs text-muted-foreground">Placements</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{fmtNumber((placements.data || []).length)}</p>
                        </div>
                        <div className="rounded-md border border-border bg-background p-3">
                            <p className="text-xs text-muted-foreground">Ads</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{fmtNumber((ads.data || []).length)}</p>
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" render={<Link href="/admin/monetization/placements" />}>
                            Placements
                        </Button>
                        <Button type="button" variant="outline" size="sm" render={<Link href="/admin/monetization/ads" />}>
                            Ads
                        </Button>
                    </div>
                </section>

                {/* ── Settings summary ── */}
                <section className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">Settings</h2>
                        <SettingsIcon size={15} className="text-muted-foreground" />
                    </div>
                    {settings.data ? (
                        <dl className="space-y-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <dt className="text-muted-foreground">Monetization</dt>
                                <dd>
                                    <GrowthStatusBadge kind="network" value={settings.data.enabled ? "ENABLED" : "NOT_CONFIGURED"} />
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <dt className="text-muted-foreground">Premium mode</dt>
                                <dd className="font-medium text-foreground">{settings.data.premiumMode}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <dt className="text-muted-foreground">Daily cap (anon)</dt>
                                <dd className="font-medium text-foreground">{settings.data.globalDailyCap ?? "—"}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <dt className="text-muted-foreground">Currency</dt>
                                <dd className="font-medium text-foreground">{settings.data.currency || "USD"}</dd>
                            </div>
                        </dl>
                    ) : (
                        <p className="text-xs text-muted-foreground">Using engine defaults (no custom settings saved yet).</p>
                    )}
                    <div className="mt-3">
                        <Button type="button" variant="outline" size="sm" render={<Link href="/admin/monetization/settings" />}>
                            Open settings
                        </Button>
                    </div>
                </section>
            </div>
        </div>
    );
}