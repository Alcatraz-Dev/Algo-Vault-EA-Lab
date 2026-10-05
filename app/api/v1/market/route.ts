/**
 * GET /api/v1/market — canonical market intelligence.
 *
 * Thin delivery over the canonical facade; it contains no market logic.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { getIntelligence } from "@/lib/intelligence-cloud/intelligence";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence-cloud/contracts";
import type { IntelligenceRequest } from "@/lib/intelligence-cloud/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "market:read",
            requiredEntitlement: "market.intelligence",
            endpoint: "GET /v1/market",
            usageCategory: "market.data",
            apiVersion: INTELLIGENCE_API_VERSION,
            build: (intelligence) => ({
                apiVersion: intelligence.apiVersion,
                instrument: intelligence.instrument,
                marketState: intelligence.marketState,
                regime: intelligence.regime,
                limitations: intelligence.limitations,
                engineVersions: intelligence.engineVersions,
                dataTimestamp: intelligence.dataTimestamp,
                availableAt: intelligence.availableAt,
                dataLineage: intelligence.dataLineage,
                cost: intelligence.cost,
            }),
        },
        run: async (body) => {
            const intelligence = await getIntelligence(body as unknown as IntelligenceRequest);
            return { intelligence };
        },
    });
}

export async function POST(request: Request) {
    return GET(request);
}
