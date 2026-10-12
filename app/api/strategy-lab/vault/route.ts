import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { checkAccess } from "@/lib/strategy-lab/license";
import { campaignStore } from "@/lib/ai/strategy-lab/campaign-storage";

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

/**
 * GET /api/strategy-lab/vault?campaignId=&symbol=&limit=&sort=score|createdAt
 *
 * Returns the caller's vaulted survivor passports. Each passport is a real
 * survivor of a breeding campaign: its equity curve, real backtest metrics,
 * dna, composite score and grade. Results are paginated (capped) and can be
 * filtered by campaign or symbol and sorted by score or recency.
 */
export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
        const access = await checkAccess(token.uid);
        if (!access.accessible) {
            return NextResponse.json({ error: "Strategy Lab access required.", access }, { status: 403, headers: corsHeaders });
        }

        const params = request.nextUrl.searchParams;
        const campaignId = params.get("campaignId") ?? undefined;
        const symbol = params.get("symbol");
        const limit = Number.parseInt(params.get("limit") ?? "25", 10);
        const sort = params.get("sort") === "score" ? "score" : "createdAt";

        let survivors = await campaignStore.listSurvivors(token.uid, {
            campaignId,
            limit: Number.isFinite(limit) ? limit : 25,
        });

        if (symbol) {
            survivors = survivors.filter((s) => s.symbol === symbol.toUpperCase());
        }

        if (sort === "score") {
            survivors = [...survivors].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        }

        return NextResponse.json(
            { survivors, count: survivors.length, sort },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: unknown) {
        console.error("[strategy-lab/vault GET]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load vault" },
            { status: 500, headers: corsHeaders }
        );
    }
}