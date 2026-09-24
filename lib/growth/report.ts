/**
 * Growth Engine — report generation.
 *
 * Two layers:
 *  - Pure builders (computeReportMetrics / buildReportSections): given stored
 *    inputs they produce honest sections; sparse data renders "Insufficient
 *    data" — nothing is ever fabricated.
 *  - generateGrowthReport: reads the Realtime Database, computes metrics and
 *    persists to growthReports with an idempotent job claim + audit trail.
 */
import { COLLECTION_PATHS } from "./paths";
import { GrowthReport, ReportSection, GrowthEvent, RevenueEntry, AffiliateConversion } from "./types";
import { ReportInterval, GrowthSource } from "./constants";
import { ctr, cvr, rpm, pctChange, metricToString, RateResult } from "./metrics";

let _db: typeof import("./database") | null = null;
async function db(): Promise<typeof import("./database")> {
    if (!_db) _db = await import("./database");
    return _db;
}

// ─── Pure metrics computation ────────────────────────────────────────────────

export type ReportMetricsInput = {
    impressions: number;
    clicks: number;
    conversions: number;
    /** Real (non-estimated) revenue only. */
    revenue: number;
    campaignsActive?: number;
    tasksApproved?: number;
    tasksPublished?: number;
};

export type ReportMetrics = {
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    campaignsActive: number;
    tasksApproved: number;
    tasksPublished: number;
    insufficient: string[];
};

export function computeReportMetrics(input: ReportMetricsInput): ReportMetrics {
    const insufficient: string[] = [];
    if (input.impressions < 50) insufficient.push("impressions");
    if (input.clicks < 5) insufficient.push("clicks");
    if (input.revenue <= 0) insufficient.push("revenue");

    return {
        impressions: input.impressions,
        clicks: input.clicks,
        conversions: input.conversions,
        revenue: input.revenue,
        campaignsActive: input.campaignsActive ?? 0,
        tasksApproved: input.tasksApproved ?? 0,
        tasksPublished: input.tasksPublished ?? 0,
        insufficient,
    };
}

function ratioLine(rate: RateResult, label: string): { label: string; value: string; tone: "up" | "down" | "neutral" } {
    return { label, value: metricToString(rate, { digits: 2, suffix: "%" }), tone: rate && !rate.insufficient ? "neutral" : "neutral" };
}

/**
 * Builds the report sections from computed metrics. Pure — callers supply the
 * numbers (real values only). Never guesses.
 */
export function buildReportSections(metrics: ReportMetrics, interval: ReportInterval): ReportSection[] {
    const ctrRate = ctr(metrics.clicks, metrics.impressions);
    const cvrRate = cvr(metrics.conversions, metrics.clicks);
    const rpmValue = metrics.impressions > 0 ? rpm(metrics.revenue, metrics.impressions) : null;

    const sections: ReportSection[] = [
        {
            key: "traffic",
            title: "Traffic",
            metrics: [
                { label: "Impressions", value: String(metrics.impressions), tone: "neutral" },
                { label: "Clicks", value: String(metrics.clicks), tone: "neutral" },
                ratioLine(ctrRate, "Click-through rate"),
            ],
            narrative:
                metrics.insufficient.includes("impressions") || metrics.insufficient.includes("clicks")
                    ? "Insufficient data for a meaningful traffic read — more impressions are required before trends are reported."
                    : "Traffic metrics derived from recorded impressions/clicks only.",
        },
        {
            key: "revenue",
            title: "Monetization",
            metrics: [
                { label: "Real revenue", value: metricToString(metrics.revenue, { digits: 2, suffix: " USD" }), tone: "neutral" },
                { label: "RPM", value: rpmValue === null ? "Insufficient data" : `$${rpmValue.toFixed(2)}`, tone: "neutral" },
            ],
            narrative:
                metrics.insufficient.includes("revenue")
                    ? "No settled revenue recorded this period; only real confirmed amounts are reported."
                    : "Revenue is reported only from settled/confirmed entries (estimated entries excluded).",
        },
        {
            key: "conversions",
            title: "Conversions",
            metrics: [
                { label: "Conversions", value: String(metrics.conversions), tone: "neutral" },
                ratioLine(cvrRate, "Conversion rate"),
            ],
            narrative:
                metrics.conversions === 0
                    ? "No conversions recorded in this period."
                    : "Conversion counts are taken from attributed signups/conversions.",
        },
        {
            key: "operations",
            title: "Operations",
            metrics: [
                { label: "Active campaigns", value: String(metrics.campaignsActive), tone: "neutral" },
                { label: "Approved content", value: String(metrics.tasksApproved), tone: "neutral" },
                { label: "Published content", value: String(metrics.tasksPublished), tone: "neutral" },
            ],
            narrative: `Snapshot of growth operations over the ${interval.toLowerCase()} period.`,
        },
    ];

    return sections;
}

// ─── DB-bound report generation ──────────────────────────────────────────────

export type GenerateReportInput = {
    interval: ReportInterval;
    periodStart: number;
    periodEnd: number;
    actor?: string;
    source?: GrowthSource | string;
    title?: string;
    /** Set by scheduled jobs to guarantee one report per period. */
    jobKey?: string;
};

/** Previous period of the same length, used for deltas. */
export function previousPeriod(input: { periodStart: number; periodEnd: number }): { start: number; end: number } {
    const span = input.periodEnd - input.periodStart;
    return { start: input.periodStart - span, end: input.periodStart };
}

export function periodForInterval(interval: ReportInterval, now = Date.now()): { start: number; end: number; key: string } {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    if (interval === "DAILY") {
        const start = d.getTime();
        return { start, end: start + 24 * 60 * 60 * 1000, key: d.toISOString().slice(0, 10) };
    }
    if (interval === "WEEKLY") {
        const day = (d.getUTCDay() + 6) % 7;
        const start = d.getTime() - day * 24 * 60 * 60 * 1000;
        return { start, end: start + 7 * 24 * 60 * 60 * 1000, key: new Date(start).toISOString().slice(0, 10) };
    }
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return { start, end, key: new Date(start).toISOString().slice(0, 10) };
}

function scoped<T extends { createdAt?: number }>(items: T[], start: number, end: number): T[] {
    return items.filter((i) => {
        const ts = Number(i.createdAt || 0);
        return ts >= start && ts < end;
    });
}

type DbHelpers = {
    listCollection<T extends Record<string, unknown>>(path: string): Promise<T[]>;
};

async function collectMetrics(
    start: number,
    end: number,
    dbh: Pick<DbHelpers, "listCollection">,
): Promise<ReportMetrics> {
    const [events, revenue, conversions, campaigns, tasks] = await Promise.all([
        dbh.listCollection<GrowthEvent>(COLLECTION_PATHS.events),
        dbh.listCollection<RevenueEntry>(COLLECTION_PATHS.revenue),
        dbh.listCollection<AffiliateConversion>(COLLECTION_PATHS.affiliateConversions),
        dbh.listCollection<{ status: string }>(COLLECTION_PATHS.campaigns),
        dbh.listCollection<{ state: string }>(COLLECTION_PATHS.tasks),
    ]);

    const inScope = scoped(events, start, end);
    const impressions = inScope.filter((e) => e.type === "impression").length;
    const clicks = inScope.filter((e) => e.type === "click").length;

    const realRevenue = scoped(revenue, start, end).filter((r) => r.estimated !== true);
    const revenueSum = realRevenue.reduce((acc, r) => acc + Number(r.amount || 0), 0);

    const campaignsActive = campaigns.filter((c) => c.status === "ACTIVE").length;
    const approvedOrDone = tasks.filter((t) => ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(t.state)).length;
    const tasksPublished = tasks.filter((t) => t.state === "PUBLISHED").length;

    return computeReportMetrics({
        impressions,
        clicks,
        conversions: scoped(conversions, start, end).length,
        revenue: revenueSum,
        campaignsActive,
        tasksApproved: approvedOrDone,
        tasksPublished,
    });
}

/**
 * Generates and persists a GrowthReport for a period. Idempotent via the
 * optional jobKey (scheduled runs pass one to avoid duplicates).
 */
export async function generateGrowthReport(input: GenerateReportInput): Promise<{ report: GrowthReport | null; duplicate: boolean; error?: string }> {
    const { adminDatabase, claimJobKey, createRecord, writeGrowthAudit, listCollection, updateRecord } = await db();
    const actor = input.actor ?? "growth:report";
    let claimed = true;
    if (input.jobKey) {
        claimed = await claimJobKey(input.jobKey, 60 * 60 * 1000);
        if (!claimed) return { report: null, duplicate: true };
    }

    const current = await collectMetrics(input.periodStart, input.periodEnd, { listCollection });
    const prev = await collectMetrics(previousPeriod(input).start, previousPeriod(input).end, { listCollection });

    const withDelta = (label: string, value: string, currentVal: number, prevVal: number) => {
        const delta = pctChange(currentVal, prevVal);
        return { label, value, delta: delta ?? undefined, tone: delta === null ? ("neutral" as const) : delta === 0 ? ("neutral" as const) : delta > 0 ? ("up" as const) : ("down" as const) };
    };

    const sections: ReportSection[] = buildReportSections(current, input.interval);
    // Overlay deltas on the headline metrics where data exists for both periods.
    sections[0].metrics = [
        withDelta("Impressions", String(current.impressions), current.impressions, prev.impressions),
        withDelta("Clicks", String(current.clicks), current.clicks, prev.clicks),
        ratioLine(ctr(current.clicks, current.impressions), "Click-through rate"),
    ];
    sections[1].metrics = [
        withDelta("Real revenue", metricToString(current.revenue, { digits: 2, suffix: " USD" }), current.revenue, prev.revenue),
        { label: "RPM", value: current.impressions > 0 ? `$${rpm(current.revenue, current.impressions)?.toFixed(2) ?? "—"}` : "Insufficient data", tone: "neutral" },
    ];

    const report = await createRecord<GrowthReport>(
        COLLECTION_PATHS.reports,
        {
            title:
                input.title ??
                `Growth report — ${new Date(input.periodStart).toISOString().slice(0, 10)} to ${new Date(input.periodEnd).toISOString().slice(0, 10)}`,
            interval: input.interval,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            sections,
            recommendations: current.insufficient.includes("revenue")
                ? undefined
                : [`${current.revenue.toFixed(2)} settle revenue recorded — review placements for further optimization.`],
            generatedBy: actor,
            source: input.source ?? "MANUAL",
        },
        actor
    );

    await updateRecord(COLLECTION_PATHS.reports, report.id, { status: "GENERATED" }, actor).catch(() => undefined);
    await writeGrowthAudit({
        actor,
        action: "report_generated",
        targetType: "growthReport",
        targetId: report.id,
        detail: { interval: input.interval, periodStart: input.periodStart, periodEnd: input.periodEnd },
    });

    return { report: { ...(report as GrowthReport), id: report.id }, duplicate: false };
}

export async function listGrowthReports(limit = 60): Promise<GrowthReport[]> {
    const { adminDatabase } = await db();
    const snap = await adminDatabase.ref(COLLECTION_PATHS.reports).get();
    const data = (snap.val() || {}) as Record<string, GrowthReport>;
    return Object.entries(data)
        .map(([id, val]) => ({ ...val, id: val.id ?? id }))
        .filter((r) => !r.id?.startsWith("_"))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, limit)
        .sort((a, b) => (b.periodEnd ?? 0) - (a.periodEnd ?? 0));
}