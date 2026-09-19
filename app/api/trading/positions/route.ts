import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ─── GET /api/trading/positions ─────────────────────────────────────────────

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

        const positionsSnap = await adminDatabase
            .ref(`trading_positions/${token.uid}/${accountId}`)
            .get();

        const data = positionsSnap.val() || {};
        const positions: Array<Record<string, unknown>> = [];

        for (const [ticket, raw] of Object.entries(data)) {
            if (!raw || typeof raw !== "object") continue;
            positions.push({ ...(raw as Record<string, unknown>), ticket });
        }

        return NextResponse.json({ positions }, { status: 200, headers: corsHeaders });
    } catch (error) {
        console.error("[trading/positions GET]", error);
        return NextResponse.json(
            { success: false, error: "Failed to load positions." },
            { status: 500, headers: corsHeaders }
        );
    }
}
