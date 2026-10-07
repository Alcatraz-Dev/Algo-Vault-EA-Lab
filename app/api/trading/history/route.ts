import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";
import type { TradingHistory } from "@/lib/trading/unified/domain";
import {
    handleUnifiedHistoryRequest,
    type UnifiedHistoryRequestDeps,
} from "@/lib/trading/unified/history";

export const runtime = "nodejs";

/**
 * GET /api/trading/history?accountId=…[&since=…]
 *
 * The Extension's Execution History (and any other history surface) reads
 * here instead of the legacy `/api/trading/orders` queue. READ ONLY: the
 * handler authenticates, resolves the userId from the verified token,
 * enforces account ownership server-side and delegates to the canonical
 * `UnifiedTradingService.getHistory()` + the immutable execution results.
 * It never executes anything, never enqueues a command and never mutates
 * execution state. The trading-license gate belongs to execution
 * (`POST /api/trading/execute`); reading your own history requires
 * authentication + ownership, same as the other trading read routes.
 */
const deps: UnifiedHistoryRequestDeps = {
    database: adminDatabase,
    authenticate: async (request) => {
        const token = await authenticate(request);
        return token ? { uid: token.uid } : null;
    },
    getHistory: async (userId, accountId, since) => {
        const service = createUnifiedTradingService();
        const result = await service.getHistory(userId, accountId, since);
        if (!result.ok) return result;
        // `service.getHistory` has no explicit return type, so its inferred
        // union carries `unknown` from the fail() branches — narrow once here
        // to the TradingResult<TradingHistory> the adapter contract guarantees.
        return { ok: true, value: result.value as TradingHistory };
    },
};

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
    return handleUnifiedHistoryRequest(request, deps);
}
