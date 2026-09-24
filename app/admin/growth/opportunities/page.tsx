"use client";

import { useMemo, useState } from "react";
import { Lightbulb, RefreshCw, Search, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { Select } from "@/components/ui/select";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { fmtRelative } from "@/components/growth/admin/format";
import { OPPORTUNITY_TYPES, type OpportunityType } from "@/lib/growth/opportunities/types";
import type { GrowthOpportunity } from "@/lib/growth/opportunities/types";

type FeedbackSummary = {
    analyticsAvailable?: boolean;
    unavailableSources?: string[];
};

type OpportunitiesResponse = {
    opportunities: GrowthOpportunity[];
    feedback?: FeedbackSummary;
    count?: number;
    source?: string;
};

const OPPORTUNITY_STATUSES = [
    "DETECTED",
    "QUALIFIED",
    "QUEUED",
    "APPROVAL_REQUIRED",
    "RUNNING",
    "COMPLETED",
    "REJECTED",
    "EXPIRED",
    "FAILED",
] as const;

const IMPACTS = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const;

const TYPE_LABELS: Record<OpportunityType, string> = {
    CONTENT_GAP: "Content gap",
    CONTENT_REFRESH: "Content refresh",
    CHANNEL_EXPANSION: "Channel expansion",
    CONVERSION_IMPROVEMENT: "Conversion improvement",
    AFFILIATE_OPPORTUNITY: "Affiliate opportunity",
    MARKETPLACE_PROMOTION: "Marketplace promotion",
    SEO_OPPORTUNITY: "SEO",
    MONETIZATION_OPPORTUNITY: "Monetization",
    FATIGUE: "Fatigue",
    EXPERIMENT: "Experiment",
};

const IMPACT_TONE: Record<(typeof IMPACTS)[number], string> = {
    HIGH: "border-destructive/30 bg-destructive/10 text-destructive-foreground",
    MEDIUM: "border-primary/30 bg-primary/10 text-primary",
    LOW: "border-border bg-muted/40 text-muted-foreground",
    UNKNOWN: "border-border bg-muted/40 text-muted-foreground",
};

function impactBadge(impact: string) {
    const tone = IMPACT_TONE[impact as (typeof IMPACTS)[number]] || IMPACT_TONE.UNKNOWN;
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{impact}</span>;
}

function confidenceText(c: number | null): string {
    if (c === null || c === undefined) return "Insufficient data";
    return `${Math.round(c * 100)}%`;
}

export default function OpportunitiesPage() {
    const { data, loading, error, refresh } = useAdminFetch<OpportunitiesResponse>("/api/growth/opportunities");

    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [impact, setImpact] = useState("");
    const [type, setType] = useState("");

    const opportunities = useMemo(() => {
        let rows = data?.opportunities || [];
        if (query.trim()) {
            const q = query.trim().toLowerCase();
            rows = rows.filter((o) => (o.title || "").toLowerCase().includes(q) || (o.description || "").toLowerCase().includes(q));
        }
        if (status) rows = rows.filter((o) => o.status === status);
        if (impact) rows = rows.filter((o) => o.impact === impact);
        if (type) rows = rows.filter((o) => o.type === type);
        return rows;
    }, [data, query, status, impact, type]);

    const isLoading = loading && !data;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Opportunities"
                subtitle="Real opportunity detection from stored content, events, placements, revenue and metrics — never simulated."
                actions={<RefreshButton onRefresh={refresh} loading={loading} />}
            />

            {data?.source && (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Detected from real stored data only ({data.source}). {data.count ?? data.opportunities.length} opportunity(ies) this scan.
                    {data.feedback?.analyticsAvailable === false &&
                        (data.feedback.unavailableSources?.length
                            ? ` Sources unavailable: ${data.feedback.unavailableSources.join(", ")}.`
                            : " Some analytics sources are unavailable.")}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1 sm:max-w-xs">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        aria-label="Search opportunities"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search title or description…"
                        className="pl-8"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="">All statuses</option>
                        {OPPORTUNITY_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </Select>
                    <Select aria-label="Filter by impact" value={impact} onChange={(e) => setImpact(e.target.value)}>
                        <option value="">All impacts</option>
                        {IMPACTS.map((i) => (
                            <option key={i} value={i}>{i}</option>
                        ))}
                    </Select>
                    <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
                        <option value="">All types</option>
                        {OPPORTUNITY_TYPES.map((t) => (
                            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                        ))}
                    </Select>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">{opportunities.length} result(s)</span>
            </div>

            {isLoading ? (
                <div className="space-y-2" role="status" aria-label="Loading opportunities">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-32" />
                    ))}
                </div>
            ) : error ? (
                <ErrorState
                    title="Couldn't load opportunities"
                    description={error}
                    action={<Button type="button" variant="outline" onClick={refresh}>Retry</Button>}
                />
            ) : opportunities.length === 0 ? (
                <EmptyState
                    icon={<Lightbulb size={18} />}
                    title={query || status || impact || type ? "No opportunities match your filters" : "No opportunities detected"}
                    description={
                        query || status || impact || type
                            ? "Clear the filters to see all detected opportunities."
                            : "Detection runs against stored content, events, placements, revenue and metrics. When the underlying data changes, new opportunities appear here."
                    }
                    action={
                        query || status || impact || type ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => { setQuery(""); setStatus(""); setImpact(""); setType(""); }}>
                                <RefreshCw /> Clear filters
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="space-y-3">
                    {opportunities.map((o) => (
                        <div key={o.id} className="rounded-lg border border-border bg-card p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                                        {o.title}
                                        <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                                            {TYPE_LABELS[o.type] || o.type}
                                        </span>
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">{o.description}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {impactBadge(o.impact)}
                                    <span className="text-xs font-medium text-foreground">{confidenceText(o.confidence)}</span>
                                </div>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div>
                                    <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        <Target size={10} /> Recommended action
                                    </p>
                                    <p className="text-xs text-foreground">{o.recommendedAction}</p>
                                </div>
                                <div>
                                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
                                    <ul className="space-y-0.5">
                                        {(o.evidence || []).map((e, i) => (
                                            <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-xs">{e.metric}</span>
                                                <span className="font-medium text-foreground">{String(e.value)}</span>
                                                <span className="truncate text-xs">({e.source})</span>
                                            </li>
                                        ))}
                                        {(o.evidence || []).length === 0 && <li className="text-xs text-muted-foreground">No evidence recorded.</li>}
                                    </ul>
                                </div>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5">status: {o.status}</span>
                                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5">source: {o.source}</span>
                                {o.createdAt && <span>detected {fmtRelative(o.createdAt)}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}