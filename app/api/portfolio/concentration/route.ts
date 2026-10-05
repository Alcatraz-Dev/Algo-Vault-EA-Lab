import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/concentration  (Pro)
 *
 * Concentration per axis with Herfindahl index, top share and effective number
 * of independent bets. Every score has a printed formula; none is an AI number.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.concentration");
        if (!gate.allowed) return gate.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const bundle = await buildPortfolioBundle({ userId: auth.ctx.uid, portfolioId });

        return portfolioJson({
            ok: true,
            portfolioId,
            data: bundle.snapshot.concentration,
            freshness: bundle.snapshot.freshness,
            limitations: bundle.snapshot.concentration.limitations,
        });
    } catch (error) {
        return portfolioError(error);
    }
}
