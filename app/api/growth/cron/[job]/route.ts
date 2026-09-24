"use server";

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { runCronJob } from "@/lib/growth/jobs";
import type { CronJobName } from "@/lib/growth/jobs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
    try {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

        if (!token) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin && decoded.role !== "admin") {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }

        const { job } = await params;
        const body = await request.json().catch(() => ({}));
        const { payload, cronSecret } = body;

        // Verify cron secret.
        const expectedSecret = process.env.CRON_SECRET;
        if (expectedSecret && cronSecret !== expectedSecret) {
            return NextResponse.json({ error: "Invalid cron secret" }, { status: 403 });
        }

        const result = await runCronJob(job as CronJobName, payload || {});
        return NextResponse.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Cron job failed.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
