import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/exposure
 *
 * Deterministic exposure: gross, net, and slices by symbol, asset class,
 * currency, direction, strategy and account. Free-tier accessible; the full
 * breakdown is a Pro capability.
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

        const bundle = await buildPortfolioBundle({
            userId: auth.ctx.uid,
            portfolioId,
            timeframe: (request.nextUrl.searchParams.get("timeframe") as never) ?? "H1",
        });

        const gate = requireFeature(auth.ctx.plan, "portfolio.exposure");
        if (!gate.allowed) return gate.response;

        const exposure = bundle.snapshot.exposure;
        const isPro = auth.ctx.plan !== "free";

        return portfolioJson({
            ok: true,
            portfolioId,
            data: {
                grossExposure: exposure.grossExposure,
                netExposure: exposure.netExposure,
                grossToEquity: exposure.grossToEquity,
                netToEquity: exposure.netToEquity,
                positionCount: exposure.positionCount,
                bySymbol: exposure.bySymbol,
                byDirection: exposure.byDirection,
                // Free sees symbol + direction only; the rest is Pro intelligence.
                byAssetClass: isPro ? exposure.byAssetClass : [],
                byCurrency: isPro ? exposure.byCurrency : [],
                byStrategy: isPro ? exposure.byStrategy : [],
                byAccount: isPro ? exposure.byAccount : [],
                supportedAssetClasses: exposure.supportedAssetClasses,
                unsupportedAssetClasses: exposure.unsupportedAssetClasses,
            },
            freshness: exposure.freshness,
            limitations: [
                ...(isPro ? [] : ["Asset-class, currency, strategy and account exposure breakdowns require Pro."]),
                ...exposure.limitations,
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
