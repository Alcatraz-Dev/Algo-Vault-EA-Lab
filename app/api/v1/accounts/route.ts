/**
 * GET /api/v1/accounts — the caller's broker accounts.
 *
 * Delivery only: authentication, scopes, rate limiting, request correlation,
 * usage metering and the error contract all come from the shared Intelligence
 * Cloud pipeline. Account truth comes from the canonical portfolio book.
 *
 * Ownership: the user id is the verified API key's explicit binding. It is
 * never read from the query string or body, so one key can never address
 * another user's accounts.
 */

import { runIntelligencePipeline } from "@/lib/intelligence-cloud/route";
import { requireKeyOwner } from "@/lib/intelligence-cloud/api-keys";
import { INTELLIGENCE_API_VERSION } from "@/lib/intelligence-cloud/contracts";
import {
    ACCOUNT_READ_SCOPE,
    loadAccountRead,
    projectAccounts,
} from "@/lib/intelligence-cloud/account-reads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    return runIntelligencePipeline({
        request,
        options: {
            requiredScope: ACCOUNT_READ_SCOPE,
            requireUserBinding: true,
            endpoint: "GET /v1/accounts",
            usageCategory: "api.request",
            apiVersion: INTELLIGENCE_API_VERSION,
        },
        run: async (_body, key) => {
            const userId = requireKeyOwner(key);
            const read = await loadAccountRead(userId);

            return {
                apiVersion: INTELLIGENCE_API_VERSION,
                accounts: projectAccounts(read.book),
                dataTimestamp: read.book.dataTimestamp,
                freshness: read.freshness,
                limitations: read.limitations,
            };
        },
    });
}
