"use client";

import { useMemo, useState } from "react";
import { ExternalLink, ImageOff, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtCurrency, fmtNumber } from "@/components/growth/admin/format";
import { AD_TYPES, PLACEMENT_LABELS, PlacementType } from "@/lib/growth/constants";

type AdRow = {
    id?: string;
    title: string;
    body?: string;
    imageUrl?: string;
    ctaLabel?: string;
    targetUrl: string;
    type: string;
    advertiser?: string;
    disclosure?: string;
    eCPM?: number;
    currency?: string;
    priority?: number;
    active: boolean;
    placementKey?: string;
    impressions?: number;
    clicks?: number;
    createdAt?: number;
};

const AD_TYPE_LABELS: Record<string, string> = { NATIVE: "Native", BANNER: "Banner", SPONSORED_CARD: "Sponsored card" };

export default function AdminAdsPage() {
    const ads = useAdminFetch<AdRow[]>("/api/growth/ads");
    const [q, setQ] = useState("");
    const [type, setType] = useState("");

    const filtered = useMemo(() => {
        let rows = ads.data || [];
        if (type) rows = rows.filter((a) => a.type === type);
        if (q.trim()) {
            const needle = q.trim().toLowerCase();
            rows = rows.filter((a) => (a.title || "").toLowerCase().includes(needle) || (a.advertiser || "").toLowerCase().includes(needle));
        }
        return rows;
    }, [ads.data, q, type]);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Ads"
                subtitle="Advertisements registered in the ad inventory."
                actions={<RefreshButton onRefresh={ads.refresh} loading={ads.loading} />}
            />

            <div className="flex flex-wrap items-center gap-2">
                <input
                    aria-label="Search ads"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search title or advertiser…"
                    className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <select aria-label="Filter by ad type" value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                    <option value="">All types</option>
                    {AD_TYPES.map((t) => (
                        <option key={t} value={t}>{AD_TYPE_LABELS[t] || t}</option>
                    ))}
                </select>
                <span className="ml-auto text-xs text-muted-foreground">{filtered.length} ad(s)</span>
            </div>

            {ads.loading ? (
                <div className="space-y-2" role="status" aria-label="Loading ads">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-16" />
                    ))}
                </div>
            ) : ads.error ? (
                <ErrorState
                    title="Couldn't load ads"
                    description={ads.error}
                    action={<Button type="button" variant="outline" onClick={ads.refresh}>Retry</Button>}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={<Megaphone size={18} />}
                    title={q || type ? "No ads match" : "No ads registered"}
                    description={
                        q || type
                            ? "Try another search or filter."
                            : "Ads are registered through the ad inventory (placement engine / API). When an ad exists it appears here with its target and status."
                    }
                />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <Table className="min-w-[920px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Ad</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Placement</TableHead>
                                <TableHead>Advertiser</TableHead>
                                <TableHead>eCPM (estimate)</TableHead>
                                <TableHead>Impressions</TableHead>
                                <TableHead>Clicks</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Target</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((a) => (
                                <TableRow key={a.id || a.title}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            {a.imageUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={a.imageUrl} alt="" className="h-9 w-9 rounded object-cover" />
                                            ) : (
                                                <span className="flex h-9 w-9 items-center justify-center rounded bg-muted text-muted-foreground">
                                                    <ImageOff size={14} />
                                                </span>
                                            )}
                                            <div>
                                                <p className="font-medium text-foreground">{a.title}</p>
                                                {a.disclosure && <p className="max-w-xs truncate text-xs text-muted-foreground">{a.disclosure}</p>}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="text-xs normal-case">{AD_TYPE_LABELS[a.type] || a.type}</Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {a.placementKey ? PLACEMENT_LABELS[a.placementKey as PlacementType] || a.placementKey : "—"}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{a.advertiser || "—"}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {a.eCPM != null ? (
                                            <span>
                                                {fmtCurrency(a.eCPM, a.currency || "USD")}
                                                <span className="ml-1 rounded bg-warning-muted px-1 py-0.5 text-xs text-warning-foreground">est.</span>
                                            </span>
                                        ) : (
                                            "—"
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{fmtNumber(a.impressions ?? 0)}</TableCell>
                                    <TableCell className="text-muted-foreground">{fmtNumber(a.clicks ?? 0)}</TableCell>
                                    <TableCell>
                                        <GrowthStatusBadge kind="placement" value={a.active ? "ACTIVE" : "INACTIVE"} />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button type="button" variant="ghost" size="xs" render={<a href={a.targetUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ad target for ${a.title}`} />}>
                                            <ExternalLink />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-medium text-foreground">About this list</h2>
                <p className="text-xs text-muted-foreground">
                    eCPM values are labelled estimates used for planning — they are never summed into confirmed revenue. Impressions and clicks are
                    the counters recorded by the real placement engine. Ads here are inventory; whether one renders is decided at runtime by the
                    placement engine (placement matching, frequency caps, targeting). AdMob has no web rendering path at all.
                </p>
            </div>
        </div>
    );
}