import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/health
 *
 * Portfolio health as nine explicit components with their own ratings and
 * reasons. Never collapsed into one opaque number on the wire.
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

        const bundle = await buildPortfolioBundle({ userId: auth.ctx.uid, portfolioId });
        const health = bundle.snapshot.health;

        return portfolioJson({
            ok: true,
            portfolioId,
            data: {
                overall: health.overall,
                components: health.components,
                worstComponents: health.worstComponents,
                unavailableComponents: health.unavailableComponents,
                regime: bundle.snapshot.regime,
                regimeState: bundle.snapshot.regimeState,
            },
            freshness: bundle.snapshot.freshness,
            limitations: health.limitations,
        });
    } catch (error) {
        return portfolioError(error);
    }
}
