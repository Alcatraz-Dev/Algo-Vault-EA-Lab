"use client";

import { useState, useEffect } from "react";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { PageHeader } from "@/components/ui/page-header";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { GrowthOpportunity } from "@/lib/growth/opportunities/types";

export default function OpportunitiesPage() {
    const { data, loading, error, refresh } = useAdminFetch<{ opportunities: GrowthOpportunity[] }>("/api/growth/opportunities");
    return (
        <div>
            <PageHeader title="Growth Opportunities" subtitle="Real opportunity detection from stored data" />
            <div className="mb-4 flex gap-2"><RefreshButton onRefresh={refresh} loading={loading} /></div>
            {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="space-y-3">
                {data?.opportunities?.map((o) => (
                    <div key={o.id} className="rounded-xl border border-border bg-card p-3 text-xs">
                        <div className="font-semibold">{o.title || o.id}</div>
                        <div className="text-muted-foreground">Type: {o.type} | Status: {o.status} | Confidence: {o.confidence !== null ? (o.confidence * 100).toFixed(0) + "%" : "N/A"}</div>
                        <div className="text-muted-foreground">Evidence: {o.evidence?.length ?? 0} items</div>
                        <div className="text-muted-foreground">Source: {o.source}</div>
                        <div className="text-muted-foreground">Recommended: {o.recommendedAction}</div>
                    </div>
                ))}
                {!loading && (!data?.opportunities || data.opportunities.length === 0) && (
                    <p className="text-xs text-muted-foreground">No opportunities detected from available data.</p>
                )}
            </div>
        </div>
    );
}