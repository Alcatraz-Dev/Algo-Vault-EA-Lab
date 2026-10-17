import { NextRequest } from "next/server";
import { handleGrowthCronPost, handleScheduledGrowthJobGet } from "@/lib/growth/cron-dispatch";

/** Vercel Cron invokes scheduled paths with GET. Authorized by CRON_SECRET only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
    const { job } = await params;
    return handleScheduledGrowthJobGet(request, job);
}

/** Existing admin-authenticated POST contract (admin session + body cronSecret). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
    const { job } = await params;
    return handleGrowthCronPost(request, job);
}
