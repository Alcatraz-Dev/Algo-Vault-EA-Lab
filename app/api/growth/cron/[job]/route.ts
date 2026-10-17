"use server";

import { NextRequest, NextResponse } from "next/server";
import { runCronJob } from "@/lib/growth/jobs";
import type { CronJobName } from "@/lib/growth/jobs";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import { cronSecretsMatch, getConfiguredCronSecret } from "@/lib/security/cron-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
    try {
        const admin = await requireGrowthAdmin(request);

        if (!admin) {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }

        const { job } = await params;
        const body = await request.json().catch(() => ({}));
        const { payload, cronSecret } = body;

        // Fail closed: a cron job cannot run without CRON_SECRET configured.
        const expectedSecret = getConfiguredCronSecret();
        if (!expectedSecret) {
            return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
        }
        if (!cronSecretsMatch(cronSecret, expectedSecret)) {
            return NextResponse.json({ error: "Invalid cron secret" }, { status: 403 });
        }

        const result = await runCronJob(job as CronJobName, payload || {});
        return NextResponse.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Cron job failed.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
