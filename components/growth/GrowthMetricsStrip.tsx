"use client";

import { useEffect, useState } from "react";
import { metricToString } from "@/lib/growth/metrics";
import { auth } from "@/lib/firebase";
import {
    Eye,
    TrendingUp,
    Zap,
    Coins,
    DollarSign,
} from "lucide-react";

interface OverviewMetrics {
    totalEvents: number;
    impressions: number;
    clicks: number;
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
}

export default function GrowthMetricsStrip() {
    const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const user = auth.currentUser;
                if (!user) { setLoading(false); return; }
                const token = await user.getIdToken();
                const res = await fetch("/api/growth/overview", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && !data.error) setMetrics(data as OverviewMetrics);
                }
            } catch { /* noop */ }
            setLoading(false);
        }
        load();
    }, []);

    if (loading || !metrics) return null;
    if (metrics.insufficient) return null;

    const cards = [
        { title: "Impressions", value: metrics.impressions, icon: Eye },
        { title: "Clicks", value: metrics.clicks, icon: TrendingUp },
        { title: "Active", value: metrics.activeCampaigns, icon: Zap },
        { title: "Ad Rev", value: metrics.revenueAds, icon: Coins },
        { title: "Aff Rev", value: metrics.revenueAffiliate, icon: DollarSign },
    ];

    return (
        <div className="grid gap-3 sm:grid-cols-5">
            {cards.map((c) => (
                <div key={c.title} className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                        <c.icon size={12} />
                        <span className="text-[10px] uppercase tracking-wide">{c.title}</span>
                    </div>
                    <p className="text-sm font-semibold mt-1">
                        {metricToString({ value: c.value, numerator: c.value, denominator: 1, insufficient: false }, { digits: 0 })}
                    </p>
                </div>
            ))}
        </div>
    );
}