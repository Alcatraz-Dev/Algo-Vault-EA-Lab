/**
 * GET /api/v1/research/{jobId} — inspect a real research job.
 *
 * Tenant isolation: the tenant comes from the verified API key, never from the
 * URL or a query parameter, so a job id cannot be read across tenants.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readBearerToken } from "@/lib/intelligence-cloud/route";
import { authenticateWithScope } from "@/lib/intelligence-cloud/api-keys";
import { getJob } from "@/lib/intelligence-cloud/jobs";
import { toErrorBody, IntelligenceError } from "@/lib/intelligence-cloud/errors";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence-cloud/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
    const requestId = request.headers.get("x-request-id") ?? `req_${randomUUID()}`;
    try {
        const key = await authenticateWithScope(readBearerToken(request), "research:read");
        const { jobId } = await context.params;

        const job = await getJob(key.tenantId, jobId);
        if (!job) throw new IntelligenceError("RESOURCE_NOT_FOUND", "Research job not found.");

        const response = NextResponse.json(
            {
                job,
                apiVersion: INTELLIGENCE_API_VERSION,
                requestId,
                limitations: [
                    "Progress reflects work observed by the research runner; it is not an estimate of completion time.",
                ],
            },
            { status: 200 }
        );
        response.headers.set("x-request-id", requestId);
        return response;
    } catch (error) {
        const status = error instanceof IntelligenceError ? error.status : 500;
        const response = NextResponse.json(toErrorBody(error, requestId), { status });
        response.headers.set("x-request-id", requestId);
        return response;
    }
}
