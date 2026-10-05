/**
 * POST /api/intelligence/v2/market/state — legacy adapter.
 *
 * Phase 13 keeps `/api/v2` alive for existing clients, but it is now a thin
 * adapter over the same canonical facade that serves `/api/v1`. No intelligence
 * logic exists in this file, and no client behaviour changes.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { getIntelligence } from "@/lib/intelligence-cloud/intelligence";
import {
    INTELLIGENCE_API_VERSION,
    INTELLIGENCE_LEGACY_API_VERSION,
    type IntelligenceRequest,
} from "@/lib/intelligence-cloud/contracts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: "market:read",
            requiredEntitlement: "market.intelligence",
            endpoint: "GET /v1/market",
            usageCategory: "market.data",
            apiVersion: INTELLIGENCE_LEGACY_API_VERSION,
            build: (intelligence) => ({
                success: true,
                apiVersion: INTELLIGENCE_LEGACY_API_VERSION,
                contractVersion: INTELLIGENCE_API_VERSION,
                data: intelligence,
            }),
        },
        run: async (body) => {
            const intelligence = await getIntelligence(body as unknown as IntelligenceRequest);
            return { intelligence };
        },
    });
}
