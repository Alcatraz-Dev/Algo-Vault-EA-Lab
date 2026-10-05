import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import { recordObservability } from "@/lib/portfolio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/correlation  (Pro)
 *
 * The deterministic correlation matrix and portfolio correlation risk.
 * Pairs that could not be computed honestly are returned as `null` with a
 * reason — never as zero, and never invented by an LLM.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.correlation");
        if (!gate.allowed) return gate.response;

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
            force: request.nextUrl.searchParams.get("refresh") === "1",
        });

        if (!bundle.matrix) {
            void recordObservability({
                portfolioId,
                userId: auth.ctx.uid,
                kind: "CORRELATION_FAILURE",
                createdAt: Date.now(),
                dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
                detail: `No correlation matrix could be computed for: ${bundle.unavailableSymbols.join(", ") || "held symbols"}.`,
            });
        }

        return portfolioJson({
            ok: true,
            portfolioId,
            data: {
                matrix: bundle.matrix
                    ? {
                          symbols: bundle.matrix.symbols,
                          timeframe: bundle.matrix.timeframe,
                          window: bundle.matrix.window,
                          method: bundle.matrix.method,
                          values: bundle.matrix.matrix,
                          pairs: bundle.matrix.pairs,
                          calculatedAt: bundle.matrix.calculatedAt,
                      }
                    : null,
                risk: bundle.snapshot.correlation,
                correlationRiskScore: bundle.snapshot.correlationRiskScore,
            },
            freshness: bundle.snapshot.freshness,
            limitations: [
                ...(bundle.matrix ? bundle.matrix.limitations : ["Correlation is UNAVAILABLE: no aligned price history for the held symbols. This is not reported as zero."]),
                ...bundle.limitations,
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
