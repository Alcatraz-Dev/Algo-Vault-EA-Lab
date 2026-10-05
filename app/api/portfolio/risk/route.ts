import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/risk
 *
 * Deterministic portfolio risk: open risk, drawdown, daily loss, margin level,
 * risk-budget utilization and active warnings.
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

        const risk = bundle.snapshot.risk;
        const health = bundle.snapshot.health;

        return portfolioJson({
            ok: true,
            portfolioId,
            data: {
                equity: risk.equity,
                balance: risk.balance,
                unrealizedPnL: risk.unrealizedPnL,
                realizedPnL: risk.realizedPnL,
                openRisk: risk.openRisk,
                openRiskPercent: risk.openRiskPercent,
                drawdown: risk.drawdown,
                drawdownPercent: risk.drawdownPercent,
                dailyLoss: risk.dailyLoss,
                dailyLossPercent: risk.dailyLossPercent,
                marginUsed: risk.marginUsed,
                freeMargin: risk.freeMargin,
                marginLevelPercent: risk.marginLevelPercent,
                riskBudgetUsage: risk.riskBudgetUsage,
                warnings: risk.warnings,
                portfolioRiskScore: bundle.snapshot.portfolioRiskScore,
                healthComponents: health.components,
            },
            freshness: risk.freshness,
            limitations: risk.limitations,
        });
    } catch (error) {
        return portfolioError(error);
    }
}
