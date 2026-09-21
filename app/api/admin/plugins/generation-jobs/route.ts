import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { serverError, unauthorized } from "@/lib/plugins/api-helpers";
import { listGenerationJobs } from "@/lib/plugins/database";

export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);
        if (!admin) return unauthorized();
        const jobs = await listGenerationJobs();
        return NextResponse.json({ success: true, jobs });
    } catch (err) {
        return serverError(err);
    }
}

export const dynamic = "force-dynamic";