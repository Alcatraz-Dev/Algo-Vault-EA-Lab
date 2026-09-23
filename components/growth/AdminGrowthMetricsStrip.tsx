"use client";

import { useEffect, useState } from "react";
import { Activity, Users, TrendingUp, DollarSign, CreditCard, Zap } from "lucide-react";
import { metricToString } from "@/lib/growth/metrics";
import { auth } from "@/lib/firebase";

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

export default function AdminGrowthMetricsStrip() {
    const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const user = auth.currentUser;
                if (!user) return;
                const token = await user.getIdToken();
                const res = await fetch("/api/growth/overview", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && !data.error) setMetrics(data as OverviewMetrics);
                }
            } catch { /* noop */ }
        }
        load();
    }, []);

    if (!metrics) return null;

    const items = [
        { label: "Traffic", value: metricToString({ value: metrics.impressions, numerator: metrics.impressions, denominator: 1, insufficient: metrics.insufficient }, { digits: 0, suffix: " views" }) },
        { label: "Conversion", value: metricToString({ value: metrics.clicks, numerator: metrics.clicks, denominator: Math.max(metrics.impressions, 1), insufficient: metrics.insufficient }, { digits: 1, suffix: "%" }) },
        { label: "Campaign Rev", value: metricToString({ value: metrics.revenueTotal, numerator: metrics.revenueTotal, denominator: 1, insufficient: metrics.insufficient }, { digits: 2, suffix: " USD" }) },
        { label: "Affiliate Rev", value: metricToString({ value: metrics.revenueAffiliate, numerator: metrics.revenueAffiliate, denominator: 1, insufficient: metrics.insufficient }, { digits: 2, suffix: " USD" }) },
        { label: "Ad Rev", value: metricToString({ value: metrics.revenueAds, numerator: metrics.revenueAds, denominator: 1, insufficient: metrics.insufficient }, { digits: 2, suffix: " USD" }) },
        { label: "Content", value: String(metrics.metricCount) },
    ];

    return (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {items.map((item) => {
                const Icon =
                    item.label.includes("Traffic") ? Activity :
                    item.label.includes("Conversion") ? TrendingUp :
                    item.label.includes("Campaign") ? DollarSign :
                    item.label.includes("Affiliate") ? CreditCard :
                    item.label.includes("Ad") ? Zap : Users;
                return (
                    <div key={item.label} className="rounded-xl border border-border bg-muted/30 p-3">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Icon size={12} />
                            <p className="text-[10px] uppercase tracking-wide">{item.label}</p>
                        </div>
                        <p className="text-sm font-semibold mt-1">{item.value}</p>
                    </div>
                );
            })}
        </div>
    );
}