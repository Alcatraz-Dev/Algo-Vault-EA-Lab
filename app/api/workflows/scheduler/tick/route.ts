import { NextRequest } from "next/server";
import { runDueScheduledWorkflows } from "@/lib/workflows/scheduler";
import { isCronRequest } from "@/lib/security/cron-auth";

/**
 * Workflow scheduler tick. Authenticated only by the shared CRON_SECRET,
 * presented as `Authorization: Bearer` or `x-cron-secret` (see
 * lib/security/cron-auth.ts). Query-string secrets are never accepted, and an
 * unset CRON_SECRET fails closed.
 */
export async function GET(request: NextRequest) {
    if (!isCronRequest(request)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const summary = await runDueScheduledWorkflows();
    return Response.json(summary);
}

export async function POST(request: NextRequest) {
    return GET(request);
}
