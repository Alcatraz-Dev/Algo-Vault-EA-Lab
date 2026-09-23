import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, unauthorized } from "@/lib/plugins/api-helpers";
import { listAgentGenerationJobs } from "@/lib/agents/database";

export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const jobs = await listAgentGenerationJobs(50);
        return NextResponse.json({ success: true, jobs });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";