import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson } from "./_lib";
import { buildPortfolioBundle, listPortfolios } from "@/lib/portfolio/service";
import { portfolioEntitlements } from "@/lib/portfolio/entitlements";
import { readObservability, readRecentSnapshots } from "@/lib/portfolio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio
 *
 * Lists the portfolios the caller owns with a compact summary each, plus the
 * caller's portfolio entitlements and the most recent observability records.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const [portfolios, observability] = await Promise.all([
            listPortfolios(auth.ctx.uid),
            readObservability(auth.ctx.uid, request.nextUrl.searchParams.get("portfolioId") ?? "primary", 10).catch(() => []),
        ]);

        const summaries = await Promise.all(
            portfolios.map(async (portfolio) => {
                const bundle = await buildPortfolioBundle({
                    userId: auth.ctx.uid,
                    portfolioId: portfolio.portfolioId,
                });
                const recent = await readRecentSnapshots(auth.ctx.uid, portfolio.portfolioId, 5);
                return {
                    portfolio,
                    summary: {
                        equity: bundle.snapshot.equity,
                        balance: bundle.snapshot.balance,
                        unrealizedPnL: bundle.snapshot.unrealizedPnL,
                        drawdownPercent: bundle.snapshot.risk.drawdownPercent,
                        grossExposure: bundle.snapshot.grossExposure,
                        netExposure: bundle.snapshot.netExposure,
                        positionCount: bundle.snapshot.positionCount,
                        accountCount: bundle.snapshot.accounts.length,
                        strategyCount: bundle.snapshot.strategyCount,
                        regime: bundle.snapshot.regime,
                        health: bundle.snapshot.health.overall,
                        freshness: bundle.snapshot.freshness.freshness,
                        dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
                    },
                    recentTriggers: recent.map((r) => ({ trigger: r.trigger, timestamp: r.timestamp })),
                    limitations: bundle.limitations,
                };
            })
        );

        const entitlements = portfolioEntitlements(auth.ctx.plan);

        return portfolioJson({
            ok: true,
            data: { portfolios: summaries },
            entitlements: { plan: entitlements.plan, denied: entitlements.denied },
            limitations: [
                "Portfolio summaries are computed server-side from broker-pushed records. Client-provided equity, PnL or exposure is never trusted.",
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
