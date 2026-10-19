import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { accountOwnedBy } from "@/lib/trading/unified/history";

export const runtime = "nodejs";

/** Closed-trade rows may hold epoch seconds (MT5 deal times) or epoch ms. */
function toEpochMs(value: unknown): number {
    const n = Number(value) || 0;
    if (n <= 0) return 0;
    return n < 1e12 ? n * 1000 : n;
}

/**
 * GET /api/trading/closed-trades?accountId=…
 *
 * Read-only. Returns `trading_history/{uid}/{accountId}` through the admin SDK
 * so the Trade History tab does not depend on the client-side RTDB rules for
 * that path. Ownership is enforced server-side.
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const accountId = (new URL(request.url).searchParams.get("accountId") || "").trim();
    if (!accountId) {
        return NextResponse.json(
            { success: false, error: "accountId query parameter is required." },
            { status: 400 }
        );
    }
    if (/[\/.#$[\]]/.test(accountId)) {
        return NextResponse.json(
            { success: false, error: "accountId is not a valid account reference." },
            { status: 400 }
        );
    }

    try {
        const owned = await accountOwnedBy(adminDatabase, token.uid, accountId);
        if (!owned) {
            return NextResponse.json(
                { success: false, error: "Account not found or not owned by you." },
                { status: 404 }
            );
        }

        const snap = await adminDatabase.ref(`trading_history/${token.uid}/${accountId}`).get();
        const val = (snap.val() ?? {}) as Record<string, Record<string, unknown>>;
        const trades = Object.entries(val)
            .map(([ticket, raw]) => ({
                ticket,
                symbol: (raw.symbol as string | undefined) || "—",
                type: (raw.type as string | undefined) || "BUY",
                volume: Number(raw.volume) || 0,
                openPrice: Number(raw.openPrice) || 0,
                closePrice: Number(raw.closePrice) || 0,
                profit: Number(raw.profit) || 0,
                swap: Number(raw.swap) || 0,
                openedAt: toEpochMs(raw.openedAt),
                closedAt: toEpochMs(raw.closedAt),
                closeSource: (raw.closeSource as string | undefined) || "gateway_snapshot",
                priceMovePct:
                    raw.priceMovePct === undefined || raw.priceMovePct === null
                        ? null
                        : Number(raw.priceMovePct),
            }))
            .sort((a, b) => b.closedAt - a.closedAt);

        return NextResponse.json({ success: true, trades });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load closed trades.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
