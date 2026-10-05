import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { createUnifiedTradingService, providerCatalog } from "@/lib/trading/unified/server";
import { httpStatusForTradingError } from "@/lib/trading/unified/errors";
import { unifiedTradingFlagSnapshot } from "@/lib/trading/feature-flags";
import { listUnifiedAccounts } from "@/lib/trading/unified/store";

export const runtime = "nodejs";

/**
 * GET /api/trading/accounts
 *
 * Provider-neutral account list for the authenticated user. Returns the
 * unified projection plus the provider catalog, so the UI can show which
 * connectors exist and which are still "Coming Soon" without a second call.
 *
 * Never returns broker credentials — only ids, broker/server names and
 * account metrics.
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const service = createUnifiedTradingService();
        const accounts = await listUnifiedAccounts(token.uid);

        const live = await Promise.all(
            accounts.map(async (record) => {
                const result = await service.getAccount(token.uid, record.id);
                return result.ok ? result.value : null;
            })
        );

        return NextResponse.json({
            success: true,
            providers: providerCatalog(),
            flags: unifiedTradingFlagSnapshot(),
            accounts: live.filter((account) => account !== null),
            // The projection may hold accounts whose provider read failed
            // (deleted records). Surfacing the raw count keeps the UI honest
            // instead of silently shrinking the list.
            projectedCount: accounts.length,
        });
    } catch (error) {
        console.error("[trading/accounts GET]", error);
        return NextResponse.json({ error: "Failed to load trading accounts." }, { status: 500 });
    }
}

/** GET /api/trading/accounts?accountId=... → normalized connection state. */
export async function PUT(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const body = await request.json().catch(() => ({})) as { accountId?: string };
        const accountId = String(body.accountId ?? "").trim();
        if (!accountId) {
            return NextResponse.json({ error: "accountId is required." }, { status: 400 });
        }

        const service = createUnifiedTradingService();
        const result = await service.getConnection(token.uid, accountId);
        if (!result.ok) {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: httpStatusForTradingError(result.error) }
            );
        }
        return NextResponse.json({ success: true, connection: result.value });
    } catch (error) {
        console.error("[trading/accounts PUT]", error);
        return NextResponse.json({ error: "Failed to load the connection state." }, { status: 500 });
    }
}