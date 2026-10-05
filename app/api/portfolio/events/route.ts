import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, resolvePortfolioId } from "../_lib";
import { readEvents } from "@/lib/portfolio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/events
 *
 * The portfolio event stream (bounded read), carrying the freshness metadata
 * every event needs: eventCreatedAt / dataTimestamp / availableAt / confirmedAt.
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

        const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
        const events = await readEvents(auth.ctx.uid, portfolioId, Number.isFinite(limit) ? limit : 50);

        return portfolioJson({
            ok: true,
            portfolioId,
            data: { events },
            limitations: [
                "Events are read newest-first and bounded. Clients should treat `dataTimestamp` (not `eventCreatedAt`) as the age of the underlying datum.",
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
