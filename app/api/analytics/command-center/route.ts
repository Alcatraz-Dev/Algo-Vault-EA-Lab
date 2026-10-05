import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import {
    computeFunnel,
    summarizeFunnel,
    computeFeatureAttribution,
    STAGE_EVENTS,
    FUNNEL_STAGES,
    type FunnelStage,
    type FeatureCorrelation,
} from "@/lib/product-analytics/funnel";
import { computeActivation } from "@/lib/product-analytics/activation";
import { isProductEventType, type ProductEventType } from "@/lib/product-analytics/events";
import { MEANINGFUL_EVENTS, computeStickiness } from "@/lib/product-analytics/retention";
import { reportUpgradeIntents, type UpgradeIntent } from "@/lib/product-analytics/upgrade-intent";
import {
    PRODUCT_EVENTS_COLLECTION,
    PRODUCT_USER_STATS_COLLECTION,
} from "@/lib/product-analytics/store";

/**
 * Growth Command Center — read model for admins.
 *
 * Every number here is computed from real stored records. When a metric cannot
 * be computed (no events yet, no Stripe data, a collection that does not
 * exist) the field is `null` and the UI renders "No data yet". Nothing is
 * estimated, back-filled, or seeded with a placeholder.
 */

export const dynamic = "force-dynamic";

type UserTypeRollups = Record<string, { count: number; lastAt: number }>;

/**
 * Activation for one user, derived from their per-type event rollups. Each type
 * contributes at most 3 occurrences, matching `computeActivation`.
 */
function isActivated(types: UserTypeRollups): boolean {
    const typeList: ProductEventType[] = [];
    for (const [type, v] of Object.entries(types)) {
        if (!isProductEventType(type)) continue;
        for (let i = 0; i < Math.min(v?.count ?? 0, 3); i++) typeList.push(type);
    }
    return typeList.length > 0 && computeActivation(typeList).activated;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SCAN = 5000;

type CommandCenterPayload = {
    generatedAt: number;
    windowDays: number;
    totals: {
        visitors: number | null;
        signups: number | null;
        activatedUsers: number | null;
        proUsers: number | null;
    };
    funnel: ReturnType<typeof computeFunnel>;
    summary: ReturnType<typeof summarizeFunnel>;
    activation: {
        ratePct: number | null;
        insufficient: boolean;
    };
    retention: {
        wau: number;
        mau: number;
        ratioPct: number | null;
    };
    featureAttribution: FeatureCorrelation[];
    upgradeIntents: ReturnType<typeof reportUpgradeIntents>;
    dataQuality: {
        eventsScanned: number;
        scannedTruncated: boolean;
        hasProductEvents: boolean;
    };
};

export async function GET(request: NextRequest) {
    const admin = await requireGrowthAdmin(request);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const windowDaysParam = Number(request.nextUrl.searchParams.get("days"));
    const windowDays = Number.isFinite(windowDaysParam) && windowDaysParam > 0 ? Math.min(windowDaysParam, 90) : 30;
    const now = Date.now();
    const windowStart = now - windowDays * DAY_MS;

    try {
        const [eventsSnap, userStatsSnap, upgradeSnap] = await Promise.all([
            adminDatabase.ref(PRODUCT_EVENTS_COLLECTION).get(),
            adminDatabase.ref(PRODUCT_USER_STATS_COLLECTION).get(),
            adminDatabase.ref("upgradeIntents").get(),
        ]);

        const rawEvents = (eventsSnap.val() ?? {}) as Record<string, Record<string, unknown>>;
        const eventList = Object.entries(rawEvents)
            .filter(([id]) => !id.startsWith("_"))
            .map(([, v]) => v)
            .slice(-MAX_SCAN);

        const hasProductEvents = eventList.length > 0;

        // ── Distinct users per funnel stage, from real events ──────────────
        const stageUsers: Partial<Record<FunnelStage, number>> = {};
        const stageSets = new Map<FunnelStage, Set<string>>(
            FUNNEL_STAGES.map((s) => [s, new Set<string>()])
        );
        const wauSet = new Set<string>();
        const mauSet = new Set<string>();
        // `day:anonId` pairs, so the VISITOR stage counts distinct browsers
        // rather than distinct page views.
        const visitorDays = new Set<string>();

        for (const event of eventList) {
            const type = event.type as string;
            const uid = (event.uid as string) ?? null;
            const anonId = (event.anonId as string) ?? null;
            const occurredAt = Number(event.occurredAt) || 0;
            const day = (event.day as string) ?? new Date(occurredAt).toISOString().slice(0, 10);
            if (!isProductEventType(type)) continue;

            for (const stage of FUNNEL_STAGES) {
                if (STAGE_EVENTS[stage].includes(type) && uid) stageSets.get(stage)!.add(uid);
            }

            if (MEANINGFUL_EVENTS.includes(type) && uid) {
                if (occurredAt >= now - 7 * DAY_MS) wauSet.add(uid);
                if (occurredAt >= now - 30 * DAY_MS) mauSet.add(uid);
            }

            if (!uid && anonId) visitorDays.add(`${day}:${anonId}`);
        }

        // Every stage is filled from the event scan. ACTIVATED is overwritten
        // below by the rollup-derived count, which is authoritative because it
        // applies the workflow gate (browsing alone does not activate).
        for (const [stage, set] of stageSets) {
            if (set.size > 0) stageUsers[stage] = set.size;
        }
        // VISITOR is counted as distinct anonymous identities observed in-window.
        const visitors = new Set([...visitorDays].filter((k) => new Date(k.slice(0, 10)).getTime() >= windowStart)).size;
        if (visitors > 0) stageUsers.VISITOR = visitors;
        // Subscribers come from the funnel's PRO stage (SUBSCRIPTION_STARTED).
        const proUsers = stageUsers.PRO ?? 0;

        // ── Activation, computed from per-user event rollups ───────────────
        const userStats = (userStatsSnap.val() ?? {}) as Record<string, { types?: Record<string, { count: number; lastAt: number }> }>;
        let activatedUsers = 0;
        for (const stats of Object.values(userStats)) {
            const types = stats?.types ?? {};
            if (Object.keys(types).length === 0) continue;
            if (isActivated(types)) activatedUsers++;
        }
        const signupUsers = stageUsers.SIGNUP ?? 0;
        const activationRatePct = signupUsers > 0 ? (activatedUsers / signupUsers) * 100 : null;
        // Align the funnel's ACTIVATED stage with the rollup-derived count,
        // which is the authoritative source (it applies the workflow gate).
        if (activatedUsers > 0) {
            stageUsers.ACTIVATED = activatedUsers;
        }
        const finalFunnel = computeFunnel({ stageUsers });
        const finalSummary = summarizeFunnel({ stageUsers });

        // ── Feature ↔ Pro correlation ──────────────────────────────────────
        // CORRELATION, NOT CAUSATION: this compares activation+upgrade rates
        // between users who touched a workflow and users who did not.
        const FEATURE_EVENTS: Record<string, ProductEventType[]> = {
            "Strategy Research": ["RESEARCH_COMPLETED", "ROBUSTNESS_RUN", "RESEARCH_STARTED"],
            "AI Market Analyst": ["AI_ANALYSIS_COMPLETED", "AI_ANALYSIS_STARTED"],
            "Backtesting": ["STRATEGY_BACKTESTED"],
            "Smart Money": ["SMART_MONEY_VIEWED", "SETUP_CREATED"],
            "Trade Journal": ["JOURNAL_REVIEWED"],
            "Basic Chart": ["CHART_OPENED"],
        };
        const totalUsers = Object.keys(userStats).length;
        const featureAttribution: FeatureCorrelation[] = Object.entries(FEATURE_EVENTS).map(([feature, events]) => {
            let featureUsers = 0;
            let featureConverted = 0;
            for (const stats of Object.values(userStats)) {
                const types = stats?.types ?? {};
                const used = events.some((e) => (types[e]?.count ?? 0) > 0);
                if (!used) continue;
                featureUsers++;
                if (isActivated(types)) featureConverted++;
            }
            return computeFeatureAttribution({
                feature,
                featureUsers,
                featureConverted,
                totalProUsers: proUsers,
                totalUsers,
            });
        });

        // ── Upgrade intents ────────────────────────────────────────────────
        const rawIntents = (upgradeSnap.val() ?? {}) as Record<string, UpgradeIntent>;
        const intents = Object.entries(rawIntents)
            .filter(([id]) => !id.startsWith("_"))
            .map(([, v]) => v)
            .filter((i) => Number(i?.createdAt) >= windowStart);

        const payload: CommandCenterPayload = {
            generatedAt: now,
            windowDays,
            totals: {
                visitors: visitors > 0 ? visitors : null,
                signups: signupUsers > 0 ? signupUsers : null,
                activatedUsers: activatedUsers > 0 ? activatedUsers : null,
                proUsers: proUsers > 0 ? proUsers : null,
            },
            funnel: finalFunnel,
            summary: finalSummary,
            activation: {
                ratePct: activationRatePct,
                insufficient: signupUsers < 20,
            },
            retention: computeStickiness(wauSet.size, mauSet.size),
            featureAttribution,
            upgradeIntents: reportUpgradeIntents(intents),
            dataQuality: {
                eventsScanned: eventList.length,
                scannedTruncated: Object.keys(rawEvents).length > MAX_SCAN,
                hasProductEvents,
            },
        };

        return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
        console.error("[command-center] failed", err);
        return NextResponse.json({ error: "Failed to load growth data" }, { status: 500 });
    }
}
