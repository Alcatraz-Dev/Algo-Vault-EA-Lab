/**
 * GET /api/v1/positions — the caller's open positions.
 *
 * Optional `?accountId=` narrows the result. It is a FILTER over the book
 * already loaded for the key's user binding, never an ownership selector: an
 * account belonging to another user cannot appear, and an unknown id is a
 * 404 rather than an ambiguous empty list.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { requireKeyOwner } from "@/lib/intelligence-cloud/api-keys";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence-cloud/contracts";
import {
    ACCOUNT_READ_SCOPE,
    loadAccountRead,
    projectPositions,
    requireVisibleAccount,
    selectPositions,
} from "@/lib/intelligence-cloud/account-reads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: ACCOUNT_READ_SCOPE,
            requireUserBinding: true,
            endpoint: "GET /v1/positions",
            usageCategory: "api.request",
            apiVersion: INTELLIGENCE_API_VERSION,
        },
        run: async (body, key) => {
            const userId = requireKeyOwner(key);
            const accountId =
                typeof body.accountId === "string" ? body.accountId.trim() : "";

            const read = await loadAccountRead(userId);
            if (accountId) requireVisibleAccount(read.book, accountId);

            const positions = selectPositions(read.book, accountId || undefined);

            return {
                apiVersion: INTELLIGENCE_API_VERSION,
                accountId: accountId || null,
                positions: projectPositions({ positions }),
                dataTimestamp: read.book.dataTimestamp,
                freshness: read.freshness,
                limitations: read.limitations,
            };
        },
    });
}
