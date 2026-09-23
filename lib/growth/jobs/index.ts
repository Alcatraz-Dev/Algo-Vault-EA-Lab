/**
 * Growth Engine — scheduled jobs.
 *
 * Every job is idempotent (claimJobKey) so cron invocations can never run a
 * job twice. Jobs only act on stored data and fail closed on errors.
 */
import { COLLECTION_PATHS } from "../paths";
import {
    adminDatabase,
    claimJobKey,
    createRecord,
    listCollection,
    writeGrowthAudit,
} from "../database";
import { generateGrowthReport, periodForInterval } from "../report";
import { runContentPipeline } from "../agents";
import { GrowthJob, MarketingTask, GrowthMetric, OptimizationRecommendation, AffiliateConversion } from "../types";
import { ReportInterval, RECOMMENDATION_KINDS, RECOMMENDATION_MODES } from "../constants";
import { ctr, rpm } from "../metrics";

export type JobHandlerResult = {
    summary: string;
    counts?: Record<string, number>;
    [key: string]: unknown;
};

export type GrowthJobRunnerInput = {
    type: string;
    jobKey: string;
    actor?: string;
    payload?: Record<string, unknown>;
    handler: () => Promise<JobHandlerResult>;
};

/** Runs one growth job with idempotency + audit. Never throws. */
export async function runGrowthJob(input: GrowthJobRunnerInput): Promise<{ ok: boolean; duplicate: boolean; result?: JobHandlerResult; error?: string; job?: GrowthJob }> {
    if (!(await claimJobKey(input.jobKey, 6 * 60 * 60 * 1000))) {
        return { ok: false, duplicate: true };
    }
    const actor = input.actor ?? "growth:job";
    const job: GrowthJob = {
        jobKey: input.jobKey,
        type: input.type,
        status: "RUNNING",
        payload: input.payload,
        startedAt: Date.now(),
        createdAt: Date.now(),
        createdBy: actor,
    };
    const ref = adminDatabase.ref(COLLECTION_PATHS.jobs).push();
    job.id = ref.key as string;
    await ref.set(job);

    try {
        const result = await input.handler();
        await ref.update({
            status: "COMPLETED",
            result,
            finishedAt: Date.now(),
        } as Partial<GrowthJob>);
        await writeGrowthAudit({ actor, action: "auto", targetType: "job", targetId: job.id, detail: { type: input.type, jobKey: input.jobKey, ok: true } });
        return { ok: true, duplicate: false, result, job: { ...job, status: "COMPLETED", result } };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Job failed.";
        await ref.update({ status: "FAILED", error: message, finishedAt: Date.now() } as Partial<GrowthJob>);
        await writeGrowthAudit({ actor, action: "auto", targetType: "job", targetId: job.id, detail: { type: input.type, jobKey: input.jobKey, ok: false, error: message } });
        return { ok: false, duplicate: false, error: message, job: { ...job, status: "FAILED", error: message } };
    }
}

// ─── Job definitions ─────────────────────────────────────────────────

export type GenerateReportsJobPayload = { interval: ReportInterval };

/** Daily/weekly/monthly growth report from stored data. */
export async function generateReportsJob(payload: GenerateReportsJobPayload, now = Date.now()): Promise<JobHandlerResult> {
    const interval = payload.interval ?? "WEEKLY";
    const period = periodForInterval(interval, now);
    const out = await generateGrowthReport({
        interval,
        periodStart: period.start,
        periodEnd: period.end,
        actor: "growth:job:reports",
        source: "SCHEDULED_JOB",
        jobKey: `report:${interval}:${period.key}`,
    });
    if (out.duplicate) return { summary: `Duplicate report for ${interval} ${period.key} — skipped.` };
    if (!out.report) return { summary: `Report generation for ${interval} ${period.key} produced no report.` };
    return { summary: `Generated ${interval} report for ${period.key}.`, reportId: out.report.id, period: period.key };
}

export type ContentGenerationJobPayload = {
    taskIds?: string[];
    /** Topics to create drafts for when no tasks exist. */
    topics?: { topic: string; type: string; channels: string[] }[];
};

/**
 * Runs the content pipeline for tasks waiting in DRAFT. Only DRAFT/FAILED
 * tasks with approval flow are eligible; the pipeline itself is idempotent.
 */
export async function contentGenerationJob(payload: ContentGenerationJobPayload, actor = "growth:job:content"): Promise<JobHandlerResult> {
    const all = await listCollection<MarketingTask>(COLLECTION_PATHS.tasks);
    const candidates = all.filter(
        (t) => (payload.taskIds ? payload.taskIds.includes(t.id) : true) && (t.state === "DRAFT" || t.state === "FAILED")
    );

    // Create drafts for requested topics if the admin asked for them.
    for (const topic of payload.topics ?? []) {
        const { createMarketingTaskDraft } = await import("../agents");
        await createMarketingTaskDraft({
            type: topic.type,
            topic: topic.topic,
            channels: topic.channels,
            actor,
            approvalRequired: true,
        });
    }
    // Refresh after draft creation.
    const refreshed = payload.topics?.length ? await listCollection<MarketingTask>(COLLECTION_PATHS.tasks) : all;

    let generated = 0;
    let failed = 0;
    const usedIds = new Set<string>(payload.taskIds ?? []);
    const scoped = refreshed.filter(
        (t) => (usedIds.size ? usedIds.has(t.id) : true) && (t.state === "DRAFT" || t.state === "FAILED")
    );

    for (const task of scoped.slice(0, 10)) {
        const { ok } = await runContentPipeline({ taskId: task.id, actor });
        if (ok) generated += 1;
        else failed += 1;
    }
    return {
        summary: `Content generation: ${generated} task(s) generated, ${failed} failed.`,
        counts: { generated, failed },
    };
}

export type CampaignAnalysisJobPayload = { periodStart: number; periodEnd: number };

/** Writes a GrowthMetric snapshot (aggregates) for the period. */
export async function campaignAnalysisJob(payload: CampaignAnalysisJobPayload, interval: ReportInterval = "WEEKLY"): Promise<JobHandlerResult> {
    const { periodStart: start, periodEnd: end } = payload;
    const [events, revenue, conversions] = await Promise.all([
        listCollection<{ type: string; createdAt: number }>(COLLECTION_PATHS.events),
        listCollection<{ amount: number; estimated?: boolean; createdAt: number }>(COLLECTION_PATHS.revenue),
        listCollection<{ createdAt: number }>(COLLECTION_PATHS.affiliateConversions),
    ]);
    const scoped = <T extends { createdAt: number }>(items: T[]) => items.filter((i) => i.createdAt >= start && i.createdAt <= end);
    const impressions = scoped(events.filter((e) => e.type === "impression")).length;
    const clicks = scoped(events.filter((e) => e.type === "click")).length;
    const conversionsCount = scoped(conversions).length;
    const realRevenue = scoped(revenue).filter((r) => r.estimated !== true).reduce((acc, r) => acc + Number(r.amount || 0), 0);

    const metrics: Record<string, number> = { impressions, clicks, conversions: conversionsCount, revenue: realRevenue };
    const ctrValue = ctr(clicks, impressions);
    if (ctrValue && !ctrValue.insufficient) metrics.ctr = ctrValue.value;
    const rpmValue = rpm(realRevenue, impressions);
    if (rpmValue !== null) metrics.rpm = rpmValue;

    const period = periodForInterval(interval, end);
    const metric: GrowthMetric = {
        period: period.key,
        interval,
        metrics,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: "growth:job:analysis",
        status: "RECORDED",
        source: "SCHEDULED_JOB",
    };
    await createRecord<GrowthMetric>(COLLECTION_PATHS.metrics, metric, "growth:job:analysis");
    return { summary: `Analytics snapshot for ${period.key}: ${impressions} impressions, ${realRevenue} revenue.`, counts: { impressions, clicks, conversions: conversionsCount, revenue: realRevenue } };
}

/**
 * Affiliate reconciliation: recompute per-offer counters from raw events and
 * conversions so the dashboard never shows drift. Idempotent (sets absolute
 * values from source data).
 */
export async function affiliateReconciliationJob(): Promise<JobHandlerResult> {
    const [clicks, conversions, offers] = await Promise.all([
        listCollection<{ offerId?: string }>(COLLECTION_PATHS.affiliateClicks),
        listCollection<AffiliateConversion>(COLLECTION_PATHS.affiliateConversions),
        listCollection<{ id?: string }>(COLLECTION_PATHS.affiliateOffers),
    ]);

    const counts = new Map<string, { clicks: number; conversions: number }>();
    for (const c of clicks) {
        if (!c.offerId) continue;
        const entry = counts.get(c.offerId) ?? { clicks: 0, conversions: 0 };
        entry.clicks += 1;
        counts.set(c.offerId, entry);
    }
    for (const c of conversions) {
        const entry = counts.get(c.offerId) ?? { clicks: 0, conversions: 0 };
        entry.conversions += 1;
        counts.set(c.offerId, entry);
    }

    let reconciled = 0;
    const updates: Record<string, { clicks: number; conversions: number }> = {};
    for (const offer of offers) {
        const entry = counts.get(offer.id) ?? { clicks: 0, conversions: 0 };
        updates[`${COLLECTION_PATHS.affiliateOffers}/${offer.id}`] = entry;
        reconciled += 1;
    }
    if (reconciled > 0) {
        await adminDatabase.ref().update(updates as Record<string, unknown>);
    }
    return { summary: `Reconciled ${reconciled} affiliate offer(s).`, counts: { reconciled } };
}

export type OptimizationAnalysisJobPayload = { periodStart: number; periodEnd: number; mode?: "RECOMMENDATION_ONLY" | "AUTO_OPTIMIZE" };

/** Persists optimization recommendations computed from real KPI history. */
export async function optimizationAnalysisJob(payload: OptimizationAnalysisJobPayload): Promise<JobHandlerResult> {
    const metrics = await listCollection<GrowthMetric>(COLLECTION_PATHS.metrics);
    const relevant = metrics
        .filter((m) => {
            const key = m.period;
            // Only metrics whose bucket falls inside the requested window.
            return key >= new Date(payload.periodStart).toISOString().slice(0, 10) && key <= new Date(payload.periodEnd).toISOString().slice(0, 10);
        })
        .slice(0, 12);

    const totals = { impressions: 0, clicks: 0, revenue: 0 };
    for (const m of relevant) {
        totals.impressions += m.metrics?.impressions ?? 0;
        totals.clicks += m.metrics?.clicks ?? 0;
        totals.revenue += m.metrics?.revenue ?? 0;
    }

    const sampleSize = totals.impressions;
    const recommendations: Partial<OptimizationRecommendation>[] = [];
    if (sampleSize >= 50) {
        recommendations.push({
            kind: "CONTENT_TOPIC",
            title: "Continue with best-performing content formats",
            description: "Historical engagement was driven by the formats used across recent campaigns.",
            rationale: `Based on ${totals.impressions} impressions and ${totals.clicks} clicks in the window.`,
            status: "PENDING",
            mode: (payload.mode ?? "RECOMMENDATION_ONLY") as OptimizationRecommendation["mode"],
            safeToAutoApply: true,
            data: { periodStart: payload.periodStart, periodEnd: payload.periodEnd, sampleSize },
        });
    }
    if (totals.revenue > 0) {
        recommendations.push({
            kind: "MONETIZATION_PLACEMENT",
            title: "Review placement mix for higher-RPM surfaces",
            description: "Revenue is being recorded; re-evaluate which placements drive the most RPM.",
            rationale: `Revenue ${totals.revenue.toFixed(2)} recorded in window.`,
            status: "PENDING",
            mode: (payload.mode ?? "RECOMMENDATION_ONLY") as OptimizationRecommendation["mode"],
            safeToAutoApply: true,
            data: { periodStart: payload.periodStart, periodEnd: payload.periodEnd, sampleSize },
        });
    }

    let created = 0;
    for (const rec of recommendations) {
        await createRecord<OptimizationRecommendation>(
            COLLECTION_PATHS.recommendations,
            { ...(rec as OptimizationRecommendation) } as OptimizationRecommendation,
            "growth:job:optimization"
        );
        created += 1;
    }
    return { summary: `${created} optimization recommendation(s) written (sample size ${sampleSize}).`, counts: { created, sampleSize } };
}

// ─── Cron entrypoints ────────────────────────────────────────────────────────

export type CronJobName = "reports" | "content" | "analysis" | "affiliates" | "optimization";

const CRON_HANDLERS: Record<CronJobName, (payload: Record<string, unknown>, now: number) => Promise<JobHandlerResult>> = {
    reports: (payload, now) => generateReportsJob({ interval: (payload.interval as ReportInterval) ?? "WEEKLY" }, now),
    content: (payload) => contentGenerationJob({ taskIds: payload.taskIds as string[] | undefined, topics: payload.topics as ContentGenerationJobPayload["topics"] }),
    analysis: (payload) => campaignAnalysisJob({ periodStart: Number(payload.periodStart || 0), periodEnd: Number(payload.periodEnd || Date.now()) }),
    affiliates: () => affiliateReconciliationJob(),
    optimization: (payload) => optimizationAnalysisJob({ periodStart: Number(payload.periodStart || 0), periodEnd: Number(payload.periodEnd || Date.now()), mode: (payload.mode as OptimizationAnalysisJobPayload["mode"]) ?? "RECOMMENDATION_ONLY" }),
};

/**
 * Public cron entrypoint used by /api/growth/cron/[job]. Fail-closed: unknown
 * job names are rejected; each run is idempotent.
 */
export async function runCronJob(job: CronJobName, payload: Record<string, unknown> = {}, now = Date.now()): Promise<{ ok: boolean; duplicate?: boolean; result?: JobHandlerResult; error?: string }> {
    if (!(job in CRON_HANDLERS)) return { ok: false, error: `Unknown cron job: ${job}` };
    const handler = CRON_HANDLERS[job];
    // Deterministic daily bucket so re-triggered crons are deduped.
    const jobKey = `cron:${job}:${new Date(now).toISOString().slice(0, 10)}`;
    return runGrowthJob({
        type: `cron_${job}`,
        jobKey,
        actor: "vercel-cron",
        payload: { ...payload, job },
        handler: () => handler(payload ?? {}, now),
    });
}