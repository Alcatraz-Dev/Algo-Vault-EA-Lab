/**
 * GET /api/v1/analytics — aggregate account analytics for the caller.
 *
 * Every total is derived from the canonical normalised book, not recomputed
 * ad hoc per route. Figures the gateway does not persist (realized P&L, open
 * risk without stop losses) are returned as null with an explicit limitation
 * rather than as a flattering zero.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { requireKeyOwner } from "@/lib/intelligence-cloud/api-keys";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence-cloud/contracts";
import {
    ACCOUNT_READ_SCOPE,
    buildAccountAnalytics,
    loadAccountRead,
} from "@/lib/intelligence-cloud/account-reads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: ACCOUNT_READ_SCOPE,
            requireUserBinding: true,
            endpoint: "GET /v1/analytics",
            usageCategory: "api.request",
            apiVersion: INTELLIGENCE_API_VERSION,
        },
        run: async (_body, key) => {
            const userId = requireKeyOwner(key);
            const read = await loadAccountRead(userId);
            const analytics = buildAccountAnalytics(read.book);

            return {
                apiVersion: INTELLIGENCE_API_VERSION,
                analytics,
                dataTimestamp: read.book.dataTimestamp,
                freshness: read.freshness,
                limitations: Array.from(
                    new Set([...read.limitations, ...analytics.limitations])
                ),
            };
        },
    });
}
