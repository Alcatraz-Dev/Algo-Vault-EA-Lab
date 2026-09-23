import { NextRequest } from "next/server";
import { runDueScheduledWorkflows } from "@/lib/workflows/scheduler";
import { getGlobalSettings } from "@/lib/workflows/database";

export async function GET(request: NextRequest) {
    // Gate with a shared secret from env (mirrors /api/plugins/runtime/tick pattern).
    const secret = request.nextUrl.searchParams.get("secret") ?? request.headers.get("x-cron-secret") ?? "";
    const expected = process.env.CRON_SECRET;
    if (!expected || secret !== expected) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const summary = await runDueScheduledWorkflows();
    return Response.json(summary);
}

export async function POST(request: NextRequest) {
    return GET(request);
}