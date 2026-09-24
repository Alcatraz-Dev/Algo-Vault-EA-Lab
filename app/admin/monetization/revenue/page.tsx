"use client";

import { useMemo, useState } from "react";
import { Coins, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtCurrency, fmtDateTime, fmtRelative } from "@/components/growth/admin/format";
import { REVENUE_LABELS, REVENUE_TYPES, RevenueType } from "@/lib/growth/constants";

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
    note?: string;
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

const RANGE_MS: Record<string, number> = { all: 0, "30": 30 * 86_400_000, "90": 90 * 86_400_000 };

export default function AdminRevenuePage() {
    const revenue = useAdminFetch<RevenuePayload>("/api/growth/revenue");
    const [range, setRange] = useState<"all" | "30" | "90">("all");
    const [type, setType] = useState<string>("");
    // Stable "now" for revenue windows; refreshed on range change (never mid-render).
    const [now, setNow] = useState(() => Date.now());

    const changeRange = (r: "all" | "30" | "90") => {
        setRange(r);
        setNow(Date.now());
    };

    const scoped = useMemo(() => {
        const cutoff = RANGE_MS[range];
        let rows = revenue.data?.entries || [];
        rows = rows.filter((e) => !cutoff || (e.recordedAt || 0) >= now - cutoff);
        if (type) rows = rows.filter((e) => e.type === type);
        rows = [...rows].sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

        const sum = (t: RevenueType) => rows.filter((e) => e.type === t).reduce((acc, e) => acc + Number(e.amount || 0), 0);
        const total = rows.reduce((acc, e) => acc + Number(e.amount || 0), 0);
        const estimated = rows.filter((e) => e.estimated).reduce((acc, e) => acc + Number(e.amount || 0), 0);
        return {
            rows,
            total,
            estimated,
            byType: Object.fromEntries(REVENUE_TYPES.map((t) => [t, sum(t)])) as Record<RevenueType, number>,
        };
    }, [revenue.data, range, type, now]);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Revenue"
                subtitle="Every recorded revenue entry, grouped by type."
                actions={
                    <>
                        <select
                            aria-label="Date range"
                            value={range}
                            onChange={(e) => changeRange(e.target.value as "all" | "30" | "90")}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <option value="all">All time</option>
                            <option value="30">Last 30 days</option>
                            <option value="90">Last 90 days</option>
                        </select>
                        <RefreshButton onRefresh={revenue.refresh} loading={revenue.loading} />
                    </>
                }
            />

            {revenue.loading ? (
                <div className="space-y-4" role="status" aria-label="Loading revenue">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-24" />
                        ))}
                    </div>
                    <Skeleton className="h-64" />
                </div>
            ) : revenue.error ? (
                <ErrorState
                    title="Couldn't load revenue"
                    description={revenue.error}
                    action={<Button type="button" variant="outline" onClick={revenue.refresh}>Retry</Button>}
                />
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        <MetricCard label={`Total · ${range === "all" ? "all time" : `${range}d`}`} value={fmtCurrency(scoped.total)} icon={<Wallet size={16} />} />
                        <MetricCard label={REVENUE_LABELS.AD} value={fmtCurrency(scoped.byType.AD)} icon={<Coins size={16} />} />
                        <MetricCard label={REVENUE_LABELS.AFFILIATE} value={fmtCurrency(scoped.byType.AFFILIATE)} icon={<Coins size={16} />} />
                        <MetricCard label={REVENUE_LABELS.SPONSORED} value={fmtCurrency(scoped.byType.SPONSORED)} icon={<Coins size={16} />} />
                        <MetricCard label={REVENUE_LABELS.SUBSCRIPTION} value={fmtCurrency(scoped.byType.SUBSCRIPTION)} icon={<Coins size={16} />} />
                        <MetricCard label={REVENUE_LABELS.MARKETPLACE} value={fmtCurrency(scoped.byType.MARKETPLACE)} icon={<Coins size={16} />} />
                    </div>

                    {scoped.estimated > 0 && (
                        <p className="text-xs text-warning">
                            Estimated portion in this view: {fmtCurrency(scoped.estimated)} — derived from eCPM/contracts, never presented as confirmed revenue.
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <select aria-label="Filter by revenue type" value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                            <option value="">All types</option>
                            {REVENUE_TYPES.map((t) => (
                                <option key={t} value={t}>{REVENUE_LABELS[t]}</option>
                            ))}
                        </select>
                        <span className="ml-auto text-xs text-muted-foreground">{scoped.rows.length} record(s)</span>
                    </div>

                    {scoped.rows.length === 0 ? (
                        <EmptyState
                            icon={<Wallet size={18} />}
                            title={type || range !== "all" ? "No revenue in this view" : "No revenue recorded"}
                            description={
                                "Only real recorded entries are displayed — ad network payouts, affiliate conversions, sponsored contracts, subscriptions and marketplace sales. Nothing is estimated to fill this table."
                            }
                        />
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <Table className="min-w-[680px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Amount</TableHead>
                                        <TableHead>Recorded</TableHead>
                                        <TableHead>Source</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {scoped.rows.map((e, i) => (
                                        <TableRow key={e.id || i}>
                                            <TableCell>
                                                <GrowthStatusBadge kind="revenue" value={e.type} />
                                            </TableCell>
                                            <TableCell className="font-semibold text-foreground">
                                                {fmtCurrency(e.amount, e.currency || "USD")}
                                                {e.estimated && (
                                                    <span className="ml-2 rounded bg-warning-muted px-1.5 py-0.5 align-middle text-xs font-normal text-warning-foreground">estimate</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">{fmtDateTime(e.recordedAt)}</TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {e.note || (e.offerId ? `Offer ${e.offerId.slice(-6)}` : e.campaignId ? `Campaign ${e.campaignId.slice(-6)}` : e.placementKey || "—")}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">{fmtRelative(e.recordedAt)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}