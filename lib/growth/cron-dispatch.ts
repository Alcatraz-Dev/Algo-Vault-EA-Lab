/**
 * Growth cron dispatch — shared by /api/growth/cron/[job] and
 * /api/growth/cron/marketing-agent.
 *
 * Two authorization contracts, deliberately different:
 *   - GET (Vercel Cron): the request must present the shared CRON_SECRET as
 *     `Authorization: Bearer` or `x-cron-secret` (lib/security/cron-auth.ts).
 *     No admin session is involved, because Vercel Cron cannot supply one.
 *   - POST (admin UI/operator contract): authorized by a verified Growth admin
 *     session. The browser never sends CRON_SECRET. A body `cronSecret` is
 *     optional; when supplied it must match. `marketing-agent` also accepts a
 *     presented secret, so scheduled and manual ticks both work.
 *
 * Both paths authenticate and validate the job name before any job runs. The
 * job runner is injectable so tests can exercise authorized paths without
 * executing real scheduled work or external calls.
 */

import { NextRequest, NextResponse } from "next/server";
import { runCronJob } from "@/lib/growth/jobs";
import type { CronJobName } from "@/lib/growth/jobs";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import {
    cronSecretsMatch,
    getConfiguredCronSecret,
    isCronRequest,
    presentedCronSecrets,
} from "@/lib/security/cron-auth";

/**
 * Jobs Vercel Cron invokes through `/api/growth/cron/[job]` (vercel.json).
 * tests/security/growth-cron-dispatch.test.ts asserts this list matches
 * vercel.json, so the allowlist cannot drift from the schedules.
 */
export const SCHEDULED_GROWTH_JOBS = [
    "reports",
    "content",
    "analysis",
    "affiliates",
    "optimization",
] as const satisfies readonly CronJobName[];

export type ScheduledGrowthJob = (typeof SCHEDULED_GROWTH_JOBS)[number];

export type CronJobRunner = (job: CronJobName, payload: Record<string, unknown>) => Promise<unknown>;

const defaultRunner: CronJobRunner = (job, payload) => runCronJob(job, payload);

export function isScheduledGrowthJob(job: string): job is ScheduledGrowthJob {
    return (SCHEDULED_GROWTH_JOBS as readonly string[]).includes(job);
}

/** 5-minute bucket: keeps sub-daily ticks deduplicated without blocking the next one. */
function currentFiveMinuteBucket(): string {
    return `t${Math.floor(Date.now() / (5 * 60 * 1000))}`;
}

function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
}

/** GET /api/growth/cron/[job] — Vercel Cron entrypoint for the scheduled jobs. */
export async function handleScheduledGrowthJobGet(
    request: NextRequest,
    job: string,
    runner: CronJobRunner = defaultRunner
): Promise<NextResponse> {
    try {
        // Fail closed: no secret configured means nothing runs.
        if (!getConfiguredCronSecret()) {
            return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
        }
        if (!isCronRequest(request)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!isScheduledGrowthJob(job)) {
            return NextResponse.json({ error: "Unknown cron job" }, { status: 404 });
        }
        const result = await runner(job, {});
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: errorMessage(err, "Cron job failed.") }, { status: 500 });
    }
}

/**
 * POST /api/growth/cron/[job] — admin-authenticated operator/UI contract.
 *
 * Authorization is the verified Growth admin session. A body `cronSecret` is
 * optional, kept for existing operator scripts; when supplied it must match
 * the configured secret. A bearer CRON_SECRET is NOT accepted here (see GET
 * for the scheduled path).
 */
export async function handleGrowthCronPost(
    request: NextRequest,
    job: string,
    runner: CronJobRunner = defaultRunner
): Promise<NextResponse> {
    try {
        const admin = await requireGrowthAdmin(request);

        if (!admin) {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { payload, cronSecret } = body;

        if (cronSecret !== undefined && cronSecret !== null) {
            const expected = getConfiguredCronSecret();
            if (!expected) {
                return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
            }
            if (!cronSecretsMatch(cronSecret, expected)) {
                return NextResponse.json({ error: "Invalid cron secret" }, { status: 403 });
            }
        }

        // Unknown job names are rejected by the job registry before any side effect.
        const result = await runner(job as CronJobName, payload || {});
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: errorMessage(err, "Cron job failed.") }, { status: 500 });
    }
}

/** GET /api/growth/cron/marketing-agent — Vercel Cron entrypoint (secret only). */
export async function handleMarketingAgentGet(
    request: NextRequest,
    runner: CronJobRunner = defaultRunner
): Promise<NextResponse> {
    try {
        if (!getConfiguredCronSecret()) {
            return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
        }
        if (!isCronRequest(request)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const result = await runner("marketing-agent", { bucket: currentFiveMinuteBucket() });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: errorMessage(err, "Marketing Agent tick failed.") }, { status: 500 });
    }
}

/** POST /api/growth/cron/marketing-agent — existing admin-or-secret contract, unchanged. */
export async function handleMarketingAgentPost(
    request: NextRequest,
    runner: CronJobRunner = defaultRunner
): Promise<NextResponse> {
    try {
        const body = (await request.json().catch(() => ({}))) as {
            payload?: Record<string, unknown>;
            cronSecret?: string;
            bucket?: string;
        };

        const expected = getConfiguredCronSecret();
        const secretMatches =
            presentedCronSecrets(request).some((c) => cronSecretsMatch(c, expected)) ||
            cronSecretsMatch(body.cronSecret, expected);
        const admin = await requireGrowthAdmin(request);

        if (!secretMatches && !admin) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const bucket = body.bucket || currentFiveMinuteBucket();
        const result = await runner("marketing-agent", { ...(body.payload ?? {}), bucket });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: errorMessage(err, "Marketing Agent tick failed.") }, { status: 500 });
    }
}
