import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { listSurvivors } from "@/lib/strategy-research/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

// Auth: owner-scoped bearer token. Read-only evidence surface used by the
// Scalping Terminal ("Research Similar Strategies") and Workflow Logic —
// never mutates signals.
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const uid = token.uid;

        const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
        const limit = Math.min(50, Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get("limit")) || 20)));

        const survivors = await listSurvivors(uid, {
            symbol: symbol || undefined,
            limit,
        });

        return NextResponse.json({ survivors, count: survivors.length }, { status: 200, headers: corsHeaders });
    } catch (err: unknown) {
        console.error("[strategy-research/survivors GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to list survivors" },
            { status: 500, headers: corsHeaders }
        );
    }
}
