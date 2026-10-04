import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ─── GET /api/trading/pending-orders ────────────────────────────────────────
//
// Read-only view of the MT5 pending (limit / stop) orders that the gateway EA
// already snapshots into `trading_orders/{uid}/{accountId}`. Used by the
// AlgoVault Pro Execution Bridge "PENDING ORDERS" panel. Nothing is derived or
// inferred here: rows are returned exactly as the gateway reported them.
// Auth: authenticated user; data is scoped to the caller's own uid.

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: "Unauthorized." },
            { status: 401, headers: corsHeaders }
        );
    }

    try {
        const url = new URL(request.url);
        const accountId = url.searchParams.get("accountId") || "";

        if (!accountId) {
            return NextResponse.json(
                { success: false, error: "accountId query parameter is required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const ordersSnap = await adminDatabase
            .ref(`trading_orders/${token.uid}/${accountId}`)
            .get();

        const data = ordersSnap.val() || {};
        const orders: Array<Record<string, unknown>> = [];

        for (const [ticket, raw] of Object.entries(data)) {
            if (!raw || typeof raw !== "object") continue;
            orders.push({ ...(raw as Record<string, unknown>), ticket });
        }

        return NextResponse.json({ success: true, orders }, { status: 200, headers: corsHeaders });
    } catch (error) {
        console.error("[trading/pending-orders GET]", error);
        return NextResponse.json(
            { success: false, error: "Failed to load pending orders." },
            { status: 500, headers: corsHeaders }
        );
    }
}
