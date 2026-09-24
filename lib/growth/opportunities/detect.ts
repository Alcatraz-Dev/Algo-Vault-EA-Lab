/**
 * Growth Engine — real opportunity detection engine.
 *
 * Uses only existing stored data (metrics, events, content, revenue,
 * affiliate, placements, campaigns). Never invents sources or metrics.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "../constants";
import { GrowthOpportunity } from "./types";
import { genId } from "../database";

/** Stable fingerprint used to dedupe the same opportunity across scans. */
export function opportunityFingerprint(o: Pick<GrowthOpportunity, "type" | "source" | "title">): string {
    return [o.type, o.source, o.title].join("|").slice(0, 220);
}

export async function detectContentGap(): Promise<GrowthOpportunity[]> {
    const opportunities: GrowthOpportunity[] = [];
    try {
        const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.content).get();
        const data = snap.exists() ? snap.val() : {};
        const total = Object.keys(data).length;
        // If very few content items exist, detect a gap
        if (total < 3) {
            opportunities.push({
                id: genId("op_"),
                 type: "CONTENT_GAP",
                 source: "content_inventory",
                 title: "Content gap detected",
                 description: `Only ${total} marketing content items exist. More content would improve pipeline depth.`,
                 evidence: [{ metric: "content_items", value: total, source: GROWTH_COLLECTIONS.content }],
                 confidence: 0.65,
                 impact: "MEDIUM",
                 status: "DETECTED",
                 recommendedAction: "Generate educational content using existing pipeline",
                 createdAt: Date.now(),
                 updatedAt: Date.now(),
                 createdBy: "growth-engine",
            });
        }
    } catch {
        // Source unavailable — no fabricated opportunity
    }
    return opportunities;
}

export async function detectContentRefresh(): Promise<GrowthOpportunity[]> {
    const opportunities: GrowthOpportunity[] = [];
    try {
        const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.content).get();
        const data = snap.exists() ? snap.val() : {};
        const now = Date.now();
        for (const [id, val] of Object.entries(data as Record<string, any>)) {
            if (val?.updatedAt && (now - val.updatedAt) > 30 * 24 * 60 * 60 * 1000) {
                const title = val?.title || "Untitled";
                opportunities.push({
                    id: genId("op_"),
                    type: "CONTENT_REFRESH",
                    source: GROWTH_COLLECTIONS.content,
                    title: `Refresh opportunity: ${String(title).slice(0, 40)}`,
                    description: `Content item ${id} is older than 30 days. Consider a refresh or update.`,
                    evidence: [{ metric: "content_age_days", value: Math.round((now - val.updatedAt) / 86400000), period: "now", source: GROWTH_COLLECTIONS.content }],
                    confidence: 0.55,
                    impact: "LOW",
                    status: "DETECTED",
                    recommendedAction: "Run content refresh pipeline",
                     createdAt: now,
                     updatedAt: now,
                     createdBy: "growth-engine",
                });
            }
        }
    } catch {
        // Source unavailable — skip
    }
    return opportunities;
}

export async function detectFatigue(): Promise<GrowthOpportunity[]> {
    const opportunities: GrowthOpportunity[] = [];
    try {
        const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.events).get();
        const data = snap.exists() ? snap.val() : {};
        const impressions = Object.values(data).filter((e: any) => e?.type === "impression").length;
        // If impression events exist but are very high relative to content count, suggest fatigue/review
        const contentSnap = await adminDatabase.ref(GROWTH_COLLECTIONS.content).get();
        const contentCount = contentSnap.exists() ? Object.keys(contentSnap.val() || {}).length : 0;
        if (contentCount > 0 && impressions > contentCount * 10) {
            opportunities.push({
                id: genId("op_"),
                type: "FATIGUE",
                source: "growth_events",
                title: "Potential content/channel fatigue",
                description: `High impression-to-content ratio (${impressions} impressions / ${contentCount} content items) suggests review or diversification.`,
                evidence: [{ metric: "impressions", value: impressions, period: "all", source: GROWTH_COLLECTIONS.events }, { metric: "content_items", value: contentCount, period: "now", source: GROWTH_COLLECTIONS.content }],
                confidence: 0.45,
                impact: "MEDIUM",
                status: "DETECTED",
                recommendedAction: "Consider content refresh, new angles, or reduced frequency",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                createdBy: "growth-engine",
            });
        }
    } catch {
        // Unavailable — skip
    }
    return opportunities;
}

export async function detectMonetizationOpportunity(): Promise<GrowthOpportunity[]> {
    const opportunities: GrowthOpportunity[] = [];
    try {
        const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.placements).get();
        const placements = snap.exists() ? snap.val() : {};
        for (const [key, val] of Object.entries(placements) as [string, any][]) {
            if (val?.active !== true) continue;
            const placementKey = val?.key || key;
            // Simple opportunity: check if a placement is active but has no recent ads
            const adsSnap = await adminDatabase.ref(GROWTH_COLLECTIONS.ads).get();
            const ads = adsSnap.exists() ? adsSnap.val() : {};
            const relatedAds = Object.values(ads).filter((a: any) => (a?.placementKey === placementKey || a?.placementIds?.includes(key)) && a?.active === true);
            if (relatedAds.length === 0) {
                opportunities.push({
                    id: genId("op_"),
                    type: "MONETIZATION_OPPORTUNITY",
                    source: GROWTH_COLLECTIONS.placements,
                    title: `Monetization gap: ${String(placementKey || key)}`,
                    description: `Active placement ${String(placementKey || key)} has no active ads. Consider creating sponsored/native content.`,
                    evidence: [{ metric: "related_ads", value: 0, period: "now", source: GROWTH_COLLECTIONS.ads }, { metric: "placement_active", value: 1, period: "now", source: GROWTH_COLLECTIONS.placements }],
                    confidence: 0.7,
                    impact: "MEDIUM",
                    status: "DETECTED",
                    recommendedAction: "Create ad or sponsored content for placement",
                     createdAt: Date.now(),
                     updatedAt: Date.now(),
                     createdBy: "growth-engine",
                 });
            }
        }
    } catch {
        // Unavailable
    }
    return opportunities;
}

export async function detectSEOOpportunity(): Promise<GrowthOpportunity[]> {
    // Since no external search API is configured, this is a minimal placeholder
    // that reports UNAVAILABLE rather than inventing data
    return [{
        id: genId("op_"),
        type: "SEO_OPPORTUNITY",
        source: "internal_fallback",
        title: "SEO opportunity — data unavailable",
        description: "No external search data source is configured. When a real SEO/integration source is added, this opportunity will be computed from actual data.",
         evidence: [{ metric: "search_data_available", value: 0, period: "now", source: "unavailable" }],
         confidence: null,
         impact: "UNKNOWN",
         status: "DETECTED",
         recommendedAction: "Configure SEO/integration source for real opportunity detection",
         createdAt: Date.now(),
         updatedAt: Date.now(),
         createdBy: "growth-engine",
    }];
}

/** Main detection entry point that reads only real sources. */
export async function detectAllOpportunities(): Promise<GrowthOpportunity[]> {
    const results: GrowthOpportunity[] = [];
    const sources = await Promise.all([
        detectContentGap(),
        detectContentRefresh(),
        detectFatigue(),
        detectMonetizationOpportunity(),
        detectSEOOpportunity(),
    ]);
    for (const sourceResults of sources) {
        results.push(...sourceResults);
    }
    return results;
}