import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, resolvePortfolioId } from "../_lib";
import { readRecentDecisions } from "@/lib/portfolio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/decisions
 *
 * The recorded, auditable portfolio decision log (bounded read).
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
        const decisions = await readRecentDecisions(auth.ctx.uid, portfolioId, Number.isFinite(limit) ? limit : 25);

        return portfolioJson({
            ok: true,
            portfolioId,
            data: { decisions },
            limitations: [
                "Portfolio decisions are append-only records. Hindsight never rewrites a historical decision; outcomes are assessed on separate entries.",
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
