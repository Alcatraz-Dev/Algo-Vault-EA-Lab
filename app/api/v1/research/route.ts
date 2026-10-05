/**
 * POST /api/v1/research — submit an asynchronous research job.
 *
 * The job is persisted to RTDB before the response is sent, so a client that
 * polls `GET /api/v1/research/{jobId}` is always looking at a real record.
 * Nothing about the job's future is predicted here.
 */

import { NextResponse } from "next/server";
import { readBearerToken } from "@/lib/intelligence-cloud/route";
import { authenticateWithScope } from "@/lib/intelligence-cloud/api-keys";
import { enqueueResearchJob } from "@/lib/intelligence-cloud/jobs";
import { toErrorBody, IntelligenceError } from "@/lib/intelligence-cloud/errors";
import { recordAudit } from "@/lib/intelligence-cloud/audit";
import { loadTenantForRequest } from "@/lib/intelligence-cloud/tenant-lookup";
import { INTELLIGENCE_API_VERSION, type ResearchJobType } from "@/lib/intelligence-cloud/contracts";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const JOB_TYPES: ResearchJobType[] = ["backtest", "walk-forward", "monte-carlo", "oos"];

export async function POST(request: Request) {
    const requestId = request.headers.get("x-request-id") ?? `req_${randomUUID()}`;
    try {
        const key = await authenticateWithScope(readBearerToken(request), "research:write");
        const tenant = await loadTenantForRequest(key.tenantId);

        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body) throw new IntelligenceError("INVALID_REQUEST", "The request body is not valid JSON.");

        const type = String(body.type ?? "");
        if (!JOB_TYPES.includes(type as ResearchJobType)) {
            throw new IntelligenceError("INVALID_REQUEST", `Unsupported research type: ${type || "(missing)"}.`, {
                details: [{ field: "type", issue: `must be one of ${JOB_TYPES.join(", ")}` }],
            });
        }
        const symbol = String(body.symbol ?? "").trim().toUpperCase();
        const timeframe = String(body.timeframe ?? "").trim().toUpperCase();
        if (!symbol || !timeframe) {
            throw new IntelligenceError("INVALID_REQUEST", "symbol and timeframe are required.", {
                details: [
                    ...(symbol ? [] : [{ field: "symbol", issue: "required" }]),
                    ...(timeframe ? [] : [{ field: "timeframe", issue: "required" }]),
                ],
            });
        }

        const job = await enqueueResearchJob({
            tenantId: key.tenantId,
            userId: key.keyId,
            plan: tenant.plan,
            request: {
                type: type as ResearchJobType,
                symbol,
                timeframe,
                strategyDefinition: body.strategyDefinition,
                config: body.config as Record<string, unknown> | undefined,
            },
        });

        await recordAudit({
            tenantId: key.tenantId,
            action: "RESEARCH_JOB_CREATED",
            actorId: key.keyId,
            requestId,
            detail: { jobId: job.jobId, type, symbol, timeframe },
        });

        const response = NextResponse.json(
            { job, apiVersion: INTELLIGENCE_API_VERSION, requestId },
            { status: 202 }
        );
        response.headers.set("x-request-id", requestId);
        return response;
    } catch (error) {
        const body = toErrorBody(error, requestId);
        const status = error instanceof IntelligenceError ? error.status : 500;
        const response = NextResponse.json(body, { status });
        response.headers.set("x-request-id", requestId);
        return response;
    }
}
