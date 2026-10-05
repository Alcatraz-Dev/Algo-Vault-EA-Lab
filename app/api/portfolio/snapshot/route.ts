import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle, DEFAULT_PORTFOLIO_ID } from "@/lib/portfolio/service";
import { recordObservability } from "@/lib/portfolio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/snapshot
 *
 * The canonical deterministic portfolio snapshot — the authoritative input to
 * every portfolio intelligence surface. Read-only; never trusts client-supplied
 * equity, PnL, exposure or margin.
 */
export async function GET(request: NextRequest) {
    const started = Date.now();
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
            force: request.nextUrl.searchParams.get("refresh") === "1",
        });

        void recordObservability({
            portfolioId,
            userId: auth.ctx.uid,
            kind: "SNAPSHOT_LATENCY",
            createdAt: Date.now(),
            dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
            durationMs: Date.now() - started,
            detail: `Portfolio snapshot built for ${portfolioId}.`,
            metadata: {
                positionCount: bundle.snapshot.positionCount,
                accountCount: bundle.snapshot.accounts.length,
                freshness: bundle.snapshot.freshness.freshness,
            },
        });

        return portfolioJson({
            ok: true,
            portfolioId,
            data: bundle.snapshot,
            freshness: bundle.snapshot.freshness,
            limitations: [...bundle.snapshot.limitations, ...bundle.limitations],
        });
    } catch (error) {
        return portfolioError(error);
    }
}

/** GET /api/portfolio/snapshot?portfolioId=…&refresh=1 */
export async function HEAD(request: NextRequest) {
    return GET(request);
}

export { DEFAULT_PORTFOLIO_ID };
