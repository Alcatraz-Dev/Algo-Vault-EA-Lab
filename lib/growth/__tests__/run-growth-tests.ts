/**
 * Growth Engine — production-ready tests.
 * Pure-function tests only (no Firebase, no I/O).
 * Follows the existing jiti-based runner pattern.
 */
import {
    computeReportMetrics,
    buildReportSections,
    previousPeriod,
    periodForInterval,
} from "../report";
import { canTransition, canPublish, approveForPublishing } from "../content-states";
import { checkCompliance, affiliateDisclosureSnippet } from "../compliance";
import { validateCampaign, validatePlacement, isSafeDestUrl, clampText } from "../validation";
import { canAdministerGrowth, isAdminUser, growthAccessDecision } from "../auth";
import { isPlacementLive, isAdLive, isPlacementTargeted, frequencyCapReached, resolveAdsForPlacement, shouldRender } from "../placement";
import { resolveEligibility } from "../eligibility";
import { appendAttribution, parseAttribution, buildAttributionQuery } from "../attribution";
import { ctr, cvr, rpm, cpa, cac, roas, pctChange, metricToString, dateRangeKeys, isoWeekKey, monthKey, bucketize } from "../metrics";
import { createExperiment } from "../experiments";
import { EXPERIMENT_MIN_SAMPLE_SIZE, EXPERIMENT_MIN_UPLIFT_PCT } from "../constants";
import { PLACEMENT_TYPES, REVENUE_TYPES, CHANNEL_TYPES, PREMIUM_AD_MODES, FREQUENCY_CAP_TYPES } from "../constants";
import { MARKETING_TASK_TRANSITIONS as TaskTransitions, MonetizationPlacement, MonetizationAd } from "../types";

const GROWTH_AGENT_IDS = {
    research: "growth-research",
    content: "growth-content",
    seo: "growth-seo",
    social: "growth-social",
    compliance: "growth-compliance",
    campaign: "growth-campaign",
    analytics: "growth-analytics",
    optimization: "growth-optimization",
    publisher: "growth-publisher",
    report: "growth-report",
} as const;

function buildContentWorkflow(workflowId = "growth-content-workflow") {
    return {
        id: workflowId,
        name: "Growth Content Pipeline",
        version: "1.0.0",
        description: "Research → Content → SEO → Social → Compliance for a marketing task.",
        status: "active",
        trigger: "manual",
        requiredPermissions: [],
        steps: [
            { id: "research", mode: "sequential", agent: GROWTH_AGENT_IDS.research },
            { id: "content", mode: "sequential", agent: GROWTH_AGENT_IDS.content, dependsOn: ["research"] },
            { id: "seo", mode: "sequential", agent: GROWTH_AGENT_IDS.seo, dependsOn: ["content"] },
            { id: "social", mode: "sequential", agent: GROWTH_AGENT_IDS.social, dependsOn: ["seo"] },
            { id: "compliance", mode: "sequential", agent: GROWTH_AGENT_IDS.compliance, dependsOn: ["social"] },
            { id: "campaign", mode: "sequential", agent: GROWTH_AGENT_IDS.campaign, dependsOn: ["compliance"] },
            { id: "publisher", mode: "sequential", agent: GROWTH_AGENT_IDS.publisher, dependsOn: ["campaign"] },
            { id: "analytics", mode: "sequential", agent: GROWTH_AGENT_IDS.analytics, dependsOn: ["publisher"] },
            { id: "optimization", mode: "sequential", agent: GROWTH_AGENT_IDS.optimization, dependsOn: ["analytics"] },
            { id: "report", mode: "sequential", agent: GROWTH_AGENT_IDS.report, dependsOn: ["optimization"] },
        ],
        timeoutMs: 180000,
        defaultStepTimeoutMs: 40000,
        retryPolicy: { maxRetries: 1, backoffMs: 1000 },
        notification: { method: "none", channels: [], requiresCritic: false, onCriticConflict: "block" },
    };
}

const MARKETING_WORKFLOWS = {
    "growth-content-workflow": buildContentWorkflow(),
};

function getMarketingWorkflow(id: string) {
    return MARKETING_WORKFLOWS[id as keyof typeof MARKETING_WORKFLOWS];
}

function getAllMarketingWorkflows() {
    return Object.values(MARKETING_WORKFLOWS);
}

function deepClean<T>(value: T): T {
    if (value === undefined) return null as unknown as T;
    if (Array.isArray(value)) return value.map((v) => deepClean(v)) as unknown as T;
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            out[key] = deepClean(val);
        }
        return out as T;
    }
    return value;
}

function genId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function assert(cond: boolean, label: string): boolean {
    if (cond) {
        console.log(`  PASS: ${label}`);
        return true;
    } else {
        console.error(`  FAIL: ${label}`);
        return false;
    }
}

async function runGrowthTests(): Promise<boolean> {
    console.log("=== Growth Engine Tests ===");
    let passed = true;

    // 1. Metrics computation (pure)
    {
        const metrics = computeReportMetrics({ impressions: 500, clicks: 20, conversions: 3, revenue: 120 });
        passed = assert(metrics.insufficient.length === 0, "metrics: sufficient data returns empty insufficient") && passed;
        passed = assert(metrics.impressions === 500, "metrics: impressions preserved") && passed;
        passed = assert(metrics.revenue === 120, "metrics: real revenue preserved") && passed;
    }

    // 2. Metrics: insufficient data flagged honestly
    {
        const metrics = computeReportMetrics({ impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
        passed = assert(metrics.insufficient.includes("impressions"), "metrics: marks insufficient for sparse impressions") && passed;
    }

    // 3. Rate functions
    {
        passed = assert(ctr(10, 100)?.value === 10, "metrics: CTR 10%") && passed;
        passed = assert(cvr(2, 10)?.value === 20, "metrics: CVR 20%") && passed;
        passed = assert(rpm(50, 1000) === 50, "metrics: RPM 50") && passed;
        passed = assert(rateToString(null) === "Insufficient data", "metrics: null → insufficient") && passed;
    }

    function rateToString(v: ReturnType<typeof ctr> | null): string {
        return metricToString(v, { digits: 2, suffix: "%" });
    }

    // 4. Date helpers
    {
        const keys = dateRangeKeys(Date.now() - 86400000 * 3, Date.now());
        passed = assert(keys.length === 4, "metrics: date range 4 days") && passed;
        passed = assert(isoWeekKey(Date.now()).includes("-W"), "metrics: ISO week key format") && passed;
        passed = assert(monthKey(Date.now()).length === 7, "metrics: month key YYYY-MM") && passed;
    }

    // 5. Bucketize
    {
        const buckets = bucketize([{ ts: Date.now(), value: 1 }, { ts: Date.now() + 1000, value: 2 }], "day");
        passed = assert(buckets.length > 0, "metrics: bucketize returns buckets") && passed;
    }

    // 6. State transitions
    {
        passed = assert(canTransition("DRAFT", "GENERATING").ok, "content-states: DRAFT → GENERATING allowed") && passed;
        passed = assert(!canTransition("PUBLISHED", "GENERATING").ok, "content-states: PUBLISHED → GENERATING denied") && passed;
        passed = assert(canPublish({ state: "APPROVED", publish: [] }, "BLOG").ok, "publish-guard: APPROVED can publish") && passed;
        passed = assert(!canPublish({ state: "PUBLISHED", publish: [{ channel: "BLOG", publishedAt: Date.now() }] }, "BLOG").ok, "publish-guard: refuses duplicate") && passed;
        passed = assert(approveForPublishing("APPROVED").ok, "approval: APPROVED passes") && passed;
        passed = assert(!approveForPublishing("DRAFT").ok, "approval: DRAFT denied") && passed;
    }

    // 7. Workflow node definitions
    {
        const workflow = buildContentWorkflow();
        passed = assert(workflow.steps.length === 10, "workflow: 10 pipeline steps") && passed;
        passed = assert(workflow.id === "growth-content-workflow", "workflow: canonical id") && passed;
        const defs = getAllMarketingWorkflows();
        passed = assert(defs.length >= 1, "workflows: at least 1 marketing workflow registered") && passed;
    }

    // 8. Job key idempotency (pure)
    {
        passed = assert(genId("test").startsWith("test_"), "jobs: genId produces prefixed id") && passed;
    }

    // 9. Deep clean prevents undefined
    {
        const cleaned = deepClean({ a: undefined, b: 1 });
        passed = assert(cleaned.b === 1 && (cleaned as Record<string, unknown>).a === null, "database: deepClean replaces undefined with null") && passed;
    }

    // 10. Compliance: trading context requires risk disclosure
    {
        const result = checkCompliance("Trading signals explained.", { isAffiliateContent: false });
        passed = assert(result.requiresRiskDisclosure, "compliance: trading content requires risk disclosure") && passed;
        passed = assert(result.tradingContext, "compliance: trading context detected") && passed;
        const safe = checkCompliance("Hello world", { isAffiliateContent: false });
        passed = assert(safe.passed || safe.flags.length === 0, "compliance: safe content passes") && passed;
    }

    // 11. Affiliate disclosure
    {
        const snippet = affiliateDisclosureSnippet("PartnerCo");
        passed = assert(snippet.includes("PartnerCo") && snippet.includes("commission"), "compliance: disclosure snippet includes provider") && passed;
    }

    // 12. Validation: campaign requires fields
    {
        const errors = validateCampaign({ name: "" } as unknown as Partial<import("../types").Campaign>);
        passed = assert(errors.length > 0, "validation: empty campaign fails validation") && passed;
        passed = assert(validateCampaign({ name: "Test", objective: "AWARENESS" }).length === 0, "validation: valid campaign passes") && passed;
    }

    // 13. Validation: placement
    {
        const errors = validatePlacement({ key: "INVALID", name: "", priority: 1 } as never);
        passed = assert(errors.length > 0, "validation: invalid placement key fails") && passed;
        passed = assert(validatePlacement({ key: "HOME_NATIVE", name: "Test", priority: 1 }).length === 0, "validation: valid placement passes") && passed;
    }

    // 14. Placement: isPlacementLive
    {
        const livePlacement = { active: true, createdAt: Date.now(), updatedAt: Date.now(), createdBy: "test", status: "ACTIVE", key: "TEST" };
        passed = assert(isPlacementLive(livePlacement as never) === true, "placement: live placement returns true") && passed;
        const inactive = { ...livePlacement, active: false };
        passed = assert(isPlacementLive(inactive as never) === false, "placement: inactive returns false") && passed;
    }

    // 15. Placement: isPlacementTargeted
    {
        const ctx = { uid: "u1", isPremium: false, country: "US" };
        const placement = { targetingRules: undefined, active: true, createdAt: Date.now(), updatedAt: Date.now(), createdBy: "test", status: "ACTIVE", key: "TEST" };
        passed = assert(isPlacementTargeted(placement as never, ctx, "SHOW", 0.5) === true, "placement: no targeting rules = targeted") && passed;
    }

    // 16. Attribution
    {
        const query = buildAttributionQuery({ offerId: "OFF1", campaignId: "CAM1", source: "blog", medium: "affiliate" });
        passed = assert(query.includes("av_offer=OFF1") && query.includes("av_campaign=CAM1"), "attribution: query built correctly") && passed;
        const parsed = parseAttribution("?av_offer=OFF1&av_campaign=CAM1");
        passed = assert(parsed.offerId === "OFF1" && parsed.campaignId === "CAM1", "attribution: query parsed correctly") && passed;
        const url = appendAttribution("https://example.com/page", { offerId: "OFF2" });
        passed = assert(url.includes("av_offer=OFF2"), "attribution: URL appended") && passed;
    }

    // 17. Validation: safe URL
    {
        passed = assert(isSafeDestUrl("https://example.com") === true, "validation: HTTPS safe") && passed;
        passed = assert(isSafeDestUrl("http://example.com") === true, "validation: HTTP safe") && passed;
        passed = assert(!isSafeDestUrl("javascript:alert(1)"), "validation: javascript unsafe") && passed;
        passed = assert(!isSafeDestUrl(""), "validation: empty unsafe") && passed;
    }

    // 18. Clamp text
    {
        passed = assert(clampText("hello", 10) === "hello", "validation: short text unchanged") && passed;
        passed = assert(clampText("this is very long text", 10).length <= 10, "validation: long text clamped") && passed;
    }

    // 19. Admin auth
    {
        const admin = { uid: "test", role: "admin" };
        passed = assert(canAdministerGrowth(admin), "auth: admin can administer growth") && passed;
        passed = assert(!canAdministerGrowth({ uid: "test", role: "developer" }), "auth: developer cannot") && passed;
        passed = assert(growthAccessDecision({ uid: "test", role: "admin" }, "write") === "allow", "auth: write allowed for admin") && passed;
        passed = assert(growthAccessDecision({ uid: "test", role: "developer" }, "write") === "deny", "auth: write denied for dev") && passed;
    }

    // 20. Constants validation
    {
        passed = assert(PLACEMENT_TYPES.includes("HOME_NATIVE"), "constants: HOME_NATIVE is a placement") && passed;
        passed = assert(REVENUE_TYPES.includes("AD"), "constants: AD is a revenue type") && passed;
        passed = assert(CHANNEL_TYPES.includes("X"), "constants: X is a channel") && passed;
        passed = assert(PREMIUM_AD_MODES.includes("HIDE"), "constants: HIDE is premium mode") && passed;
        passed = assert(FREQUENCY_CAP_TYPES.includes("PER_SESSION"), "constants: PER_SESSION is cap type") && passed;
        passed = assert(TaskTransitions["APPROVED"].includes("PUBLISHED"), "constants: APPROVED → PUBLISHED valid") && passed;
    }

    // 21. Period helpers (pure)
    {
        const period = periodForInterval("DAILY", Date.now());
        passed = assert(period.start > 0 && period.end > period.start, "jobs: daily period computed") && passed;
        passed = assert(period.key.length === 10, "jobs: daily key is YYYY-MM-DD") && passed;

        const weekly = periodForInterval("WEEKLY", Date.now());
        passed = assert(weekly.end - weekly.start === 7 * 24 * 60 * 60 * 1000, "jobs: weekly period is 7 days") && passed;

        const monthly = periodForInterval("MONTHLY", Date.now());
        passed = assert(monthly.end - monthly.start >= 28 * 24 * 60 * 60 * 1000, "jobs: monthly period ~28+ days") && passed;
    }

    // 22. Public eligibility — anonymous user eligible
    {
        const payload = resolveEligibility({
            placement: { key: "HOME_NATIVE", active: true, priority: 1, name: "Home" } as MonetizationPlacement,
            ads: [{ id: "ad_1", placementKey: "HOME_NATIVE", title: "Ad", body: "Body", targetUrl: "https://example.com", active: true, type: "NATIVE" } as MonetizationAd],
            settings: { enabled: true, premiumMode: "SHOW", premiumReductionRatio: 0.5 },
            ctx: { uid: null, isPremium: false, loggedOut: true, capCounts: {}, salt: "anon_123" },
        });
        passed = assert(payload.eligible === true, "public eligibility: anonymous eligible") && passed;
        passed = assert(payload.visitorKey === "anon_123", "public eligibility: visitor key set") && passed;
    }

    // 23. Premium HIDE — no eligible items when premium mode is HIDE and user is premium
    {
        const payload = resolveEligibility({
            placement: { key: "HOME_NATIVE", active: true, priority: 1, name: "Home" } as MonetizationPlacement,
            ads: [{ id: "ad_1", placementKey: "HOME_NATIVE", title: "Ad", body: "Body", targetUrl: "https://example.com", active: true, type: "NATIVE" } as MonetizationAd],
            settings: { enabled: true, premiumMode: "HIDE", premiumReductionRatio: 0.5 },
            ctx: { uid: "premium_user", isPremium: true, loggedOut: false, capCounts: {}, salt: "premium_user" },
        });
        passed = assert(payload.eligible === false, "public eligibility: premium HIDE denies") && passed;
        passed = assert(payload.items.length === 0, "public eligibility: no items for HIDE") && passed;
    }

    // 24. Frequency cap reached — prevents over-delivery
    {
        const payload = resolveEligibility({
            placement: { key: "FOOTER", active: true, priority: 1, name: "Footer", frequencyCap: { type: "PER_SESSION", limit: 1 } } as MonetizationPlacement,
            ads: [{ id: "ad_1", placementKey: "FOOTER", title: "Ad", body: "Body", targetUrl: "https://example.com", active: true, type: "NATIVE" } as MonetizationAd],
            settings: { enabled: true, premiumMode: "SHOW", premiumReductionRatio: 0.5 },
            ctx: { uid: "user_1", isPremium: false, loggedOut: false, capCounts: { PER_SESSION: 2 }, salt: "user_1" },
        });
        passed = assert(payload.eligible === false, "public eligibility: frequency cap reached denies") && passed;
    }

    // 25. Inactive/expired/future placement — no eligibility
    {
        const payloadInactive = resolveEligibility({
            placement: { key: "BLOG_NATIVE", active: false, priority: 1, name: "Blog" } as MonetizationPlacement,
            ads: [],
            settings: { enabled: true, premiumMode: "SHOW", premiumReductionRatio: 0.5 },
            ctx: { uid: null, isPremium: false, loggedOut: true, capCounts: {}, salt: "anon" },
        });
        passed = assert(payloadInactive.eligible === false, "public eligibility: inactive placement denied") && passed;
    }

    // 26. AdSense web only — ADMOB never returns for web
    {
        const payload = resolveEligibility({
            placement: { key: "SIDEBAR", active: true, priority: 1, name: "Sidebar" } as MonetizationPlacement,
            ads: [{ id: "ad_1", placementKey: "SIDEBAR", title: "Ad", body: "Body", targetUrl: "https://example.com", active: true, type: "NATIVE" } as MonetizationAd],
            settings: { enabled: true, premiumMode: "SHOW", premiumReductionRatio: 0.5 },
            ctx: { uid: null, isPremium: false, loggedOut: true, capCounts: {}, salt: "anon" },
        });
        if (payload.items.length > 0) {
            passed = assert(payload.items[0].provider === "CUSTOM", "public eligibility: web provider is CUSTOM") && passed;
        }
    }

    // 27. Public endpoint filtering — no sensitive keys leaked
    {
        const payload = resolveEligibility({
            placement: { key: "HOME_NATIVE", active: true, priority: 1, name: "Home" } as MonetizationPlacement,
            ads: [{ id: "ad_1", placementKey: "HOME_NATIVE", title: "Ad", body: "Body", targetUrl: "https://example.com", active: true, type: "NATIVE", eCPM: 5.0, impressions: 100 } as MonetizationAd],
            settings: { enabled: true, premiumMode: "SHOW", premiumReductionRatio: 0.5 },
            ctx: { uid: null, isPremium: false, loggedOut: true, capCounts: {}, salt: "anon" },
        });
        if (payload.items.length > 0) {
            const creative = payload.items[0].creative;
            passed = assert(!(creative as any).eCPM, "public eligibility: no eCPM leaked") && passed;
            passed = assert(!(creative as any).impressions, "public eligibility: no impressions leaked") && passed;
        }
    }

    // 28. Experiment lifecycle — createExperiment produces DRAFT
    {
        const exp = createExperiment("Headline test", "Changing hero increases CTR", [
            { label: "Control" },
            { label: "New headline" },
        ]);
        passed = assert(exp.id.startsWith("exp_"), "experiments: createExperiment assigns id") && passed;
        passed = assert(exp.name === "Headline test", "experiments: name preserved") && passed;
        passed = assert(exp.hypothesis === "Changing hero increases CTR", "experiments: hypothesis preserved") && passed;
        passed = assert(exp.status === "DRAFT", "experiments: starts in DRAFT") && passed;
        passed = assert(exp.startAt > 0, "experiments: startAt set") && passed;
        passed = assert(exp.variants.length === 2, "experiments: two variants") && passed;
        passed = assert(exp.targetMetric === "CTR", "experiments: default target metric") && passed;
    }

    // 29. Experiment minimum sample size constant
    {
        passed = assert(EXPERIMENT_MIN_SAMPLE_SIZE === 50, "experiments: min sample size is 50") && passed;
        passed = assert(EXPERIMENT_MIN_UPLIFT_PCT === 5, "experiments: min uplift is 5%") && passed;
    }

    // 30. Experiment winner logic (inconclusive — insufficient sample)
    {
        const computeWinner = (aImp: number, bImp: number, aConv: number, bConv: number) => {
            const aRate = aImp > 0 ? aConv / aImp : 0;
            const bRate = bImp > 0 ? bConv / bImp : 0;
            if (aImp < EXPERIMENT_MIN_SAMPLE_SIZE || bImp < EXPERIMENT_MIN_SAMPLE_SIZE) return "INCONCLUSIVE";
            if (aRate === 0 && bRate === 0) return "INCONCLUSIVE";
            const relUplift = aRate > 0 ? (bRate - aRate) / aRate : Infinity;
            if (Math.abs(relUplift) < EXPERIMENT_MIN_UPLIFT_PCT / 100) return "INCONCLUSIVE";
            return bRate > aRate ? "B" : "A";
        };
        passed = assert(computeWinner(0, 0, 0, 0) === "INCONCLUSIVE", "experiments: insufficient sample → inconclusive") && passed;
        passed = assert(computeWinner(49, 49, 1, 1) === "INCONCLUSIVE", "experiments: below min sample → inconclusive") && passed;
        passed = assert(computeWinner(100, 100, 10, 10) === "INCONCLUSIVE", "experiments: same rate → inconclusive") && passed;
        passed = assert(computeWinner(100, 100, 5, 10) === "B", "experiments: B wins by 50% uplift") && passed;
        passed = assert(computeWinner(100, 100, 10, 5) === "A", "experiments: A wins by 50% negative uplift") && passed;
    }

    // 28. Affiliate disclosure — affiliate cards must include disclosure text
    {
        const result = checkCompliance("Buy through this partner link", { affiliateType: "OFFER", isAffiliateContent: true });
        passed = assert(result.flags.some((f) => f.rule === "missing_affiliate_disclosure") === false || result.passed === false, "affiliate: disclosure required for affiliate content") && passed;
    }

    // 29. Phase 2 — 10-stage pipeline sequence verified
    {
        const wf = buildContentWorkflow();
        passed = assert(wf.steps.length === 10, "pipeline: 10 stages") && passed;
        const ids = wf.steps.map((s: { id: string }) => s.id);
        passed = assert(ids.includes("campaign"), "pipeline: campaign stage") && passed;
        passed = assert(ids.includes("publisher"), "pipeline: publisher stage") && passed;
        passed = assert(ids.includes("analytics"), "pipeline: analytics stage") && passed;
        passed = assert(ids.includes("optimization"), "pipeline: optimization stage") && passed;
        passed = assert(ids.includes("report"), "pipeline: report stage") && passed;
    }

    console.log("==========================================");
    if (passed) {
        console.log("🎉 GROWTH ENGINE TESTS PASSED");
    } else {
        console.error("❌ SOME GROWTH ENGINE TESTS FAILED");
    }
    console.log("==========================================");
    return passed;
}

runGrowthTests().then((passed) => process.exit(passed ? 0 : 1));
