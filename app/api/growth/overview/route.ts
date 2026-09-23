
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { GrowthEvent, RevenueEntry, AffiliateConversion } from "@/lib/growth/types";

export async function getGrowthOverviewMetrics(adminToken: string) {
    try {
        const decoded = await adminAuth.verifyIdToken(adminToken);
        if (!decoded.admin && decoded.role !== "admin") {
            return { error: "Unauthorized" };
        }
    } catch {
        return { error: "Unauthorized" };
    }

    const [eventsSnap, revenueSnap, conversionsSnap, campaignsSnap, metricsSnap, placementsSnap] = await Promise.all([
        adminDatabase.ref(GROWTH_COLLECTIONS.events).get(),
        adminDatabase.ref(GROWTH_COLLECTIONS.revenue).get(),
        adminDatabase.ref(GROWTH_COLLECTIONS.affiliateConversions).get(),
        adminDatabase.ref(GROWTH_COLLECTIONS.campaigns).get(),
        adminDatabase.ref(GROWTH_COLLECTIONS.metrics).get(),
        adminDatabase.ref(GROWTH_COLLECTIONS.placements).get(),
    ]);

    const events = eventsSnap.exists() ? (eventsSnap.val() as Record<string, GrowthEvent>) : {};
    const revenue = revenueSnap.exists() ? (revenueSnap.val() as Record<string, RevenueEntry>) : {};
    const conversions = conversionsSnap.exists() ? (conversionsSnap.val() as Record<string, AffiliateConversion>) : {};
    const campaigns = campaignsSnap.exists() ? (campaignsSnap.val() as Record<string, unknown>) : {};
    const metricsList = metricsSnap.exists() ? (metricsSnap.val() as Record<string, unknown>) : {};
    const placements = placementsSnap.exists() ? (placementsSnap.val() as Record<string, unknown>) : {};

    let totalEvents = 0;
    let impressions = 0;
    let clicks = 0;
    let revenueTotal = 0;
    let revenueAds = 0;
    let revenueAffiliate = 0;
    let revenueSponsored = 0;
    const revenueSubscription = 0;
    const revenueMarketplace = 0;

    for (const e of Object.values(events)) {
        const ev = e as GrowthEvent;
        totalEvents++;
        if (ev.type === "impression") impressions++;
        if (ev.type === "click") clicks++;
    }

    let conversionCount = 0;
    let signupCount = 0;
    for (const c of Object.values(conversions)) {
        const cv = c as AffiliateConversion;
        conversionCount++;
        if (cv.type === "SIGNUP") signupCount++;
    }

    for (const r of Object.values(revenue)) {
        const rev = r as RevenueEntry;
        revenueTotal += (rev.amount || 0);
        switch (rev.type) {
            case "AD": revenueAds += (rev.amount || 0); break;
            case "AFFILIATE": revenueAffiliate += (rev.amount || 0); break;
            case "SPONSORED": revenueSponsored += (rev.amount || 0); break;
        }
    }

    for (const c of Object.values(conversions)) {
        const cv = c as AffiliateConversion;
        if (cv.type === "COMMISSION" && cv.commission) {
            revenueAffiliate += cv.commission;
        }
    }

    const campaignCount = Object.keys(campaigns).length;
    const activeCampaigns = Object.values(campaigns).filter((c: unknown) => {
        const rec = c as Record<string, unknown>;
        return rec.status === "ACTIVE";
    }).length;

    const metricCount = Object.keys(metricsList).length;
    const placementCount = Object.keys(placements).length;

    return {
        totalEvents,
        impressions,
        clicks,
        conversions: conversionCount,
        signups: signupCount,
        revenueTotal,
        revenueAds,
        revenueAffiliate,
        revenueSponsored,
        revenueSubscription,
        revenueMarketplace,
        campaignCount,
        activeCampaigns,
        metricCount,
        placementCount,
        insufficient: impressions < 50 || revenueTotal <= 0,
    };
}

export async function GET(request: NextRequest) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await getGrowthOverviewMetrics(token);
    if (result && typeof result === "object" && "error" in result) return NextResponse.json(result, { status: 403 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
