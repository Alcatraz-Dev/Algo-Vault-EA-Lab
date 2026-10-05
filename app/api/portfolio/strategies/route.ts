import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/strategies  (Pro)
 *
 * Strategy-to-portfolio intelligence: per-strategy exposure, drawdown, health,
 * OOS evidence, and the overlap matrix that catches strategies which are
 * individually healthy but fail together.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.strategies");
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
            data: bundle.strategyIntelligence,
            freshness: bundle.snapshot.freshness,
            limitations: bundle.strategyIntelligence.limitations,
        });
    } catch (error) {
        return portfolioError(error);
    }
}
