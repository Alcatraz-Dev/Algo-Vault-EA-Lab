import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import { computeAllocation, recommendAllocation } from "@/lib/portfolio/allocation";
import { defaultScenarios, runStressTests } from "@/lib/portfolio/stress";
import { runPortfolioAgentTeam } from "@/lib/portfolio/agents";
import { readLatestSnapshot } from "@/lib/portfolio/store";
import { runTradePreCheck } from "@/lib/portfolio/decision";
import { contractSizeOf } from "@/lib/portfolio/instruments";
import type { ProposedTrade } from "@/lib/portfolio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/portfolio/analyze  (Pro)
 *
 * Runs the deterministic portfolio agent team over the live book and returns
 * the structured brief. Optionally runs a portfolio trade pre-check for a
 * proposed trade. Every agent is read-only; nothing here moves capital.
 */
export async function POST(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.agents");
        if (!gate.allowed) return gate.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const body = (await request.json().catch(() => ({}))) as { trade?: ProposedTrade };
        const bundle = await buildPortfolioBundle({ userId: auth.ctx.uid, portfolioId });

        const allocation = computeAllocation({
            portfolioId,
            method: "RISK_PARITY",
            inputs: bundle.strategyIntelligence.strategies.map((s) => ({
                strategyId: s.strategyId,
                currentWeight: s.equityWeight,
                pnlContribution: s.unrealizedPnL,
                volatility: null,
                maxDrawdownPercent: s.maxDrawdownPercent,
                oosSharpe: s.oosSharpe,
                sampleSize: s.sampleSize,
                correlationToPortfolio: s.correlationToPortfolio,
                health: s.health,
                active: s.active,
            })),
            calculatedAt: Date.now(),
        });

        const recommendations = recommendAllocation(allocation, bundle.strategyIntelligence, { now: Date.now() });

        const stressResult = runStressTests({
            portfolioId,
            positions: bundle.snapshot.positions,
            accounts: bundle.snapshot.accounts,
            equity: bundle.snapshot.equity,
            scenarios: defaultScenarios(),
            riskBudgets: bundle.snapshot.riskBudgetUsage.map((u) => ({
                kind: u.kind,
                limitPercent: u.limitPercent,
                scopeKey: u.scopeKey,
            })),
            generatedAt: Date.now(),
            dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
        });

        const previous = await readLatestSnapshot(auth.ctx.uid, portfolioId).catch(() => null);

        const team = runPortfolioAgentTeam({
            snapshot: bundle.snapshot,
            strategyIntelligence: bundle.strategyIntelligence,
            previous: previous?.state ?? null,
            stressResult,
            allocation: recommendations,
            now: Date.now(),
        });

        const precheck = body.trade
            ? runTradePreCheck({
                  portfolioId,
                  trade: body.trade,
                  exposure: bundle.snapshot.exposure,
                  concentration: bundle.snapshot.concentration,
                  correlation: bundle.snapshot.correlation,
                  correlationMatrixSymbols: bundle.matrix?.symbols ?? null,
                  correlationMatrix: bundle.matrix?.matrix ?? null,
                  risk: bundle.snapshot.risk,
                  riskBudgetUsage: bundle.snapshot.riskBudgetUsage,
                  equity: bundle.snapshot.equity,
                  leverage: bundle.snapshot.leverage,
                  contractSize: contractSizeOf(body.trade.symbol),
                  positions: bundle.snapshot.positions,
                  allocation,
                  freshness: bundle.snapshot.freshness,
                  now: Date.now(),
                  contractSizeOf,
              })
            : null;

        return portfolioJson({
            ok: true,
            portfolioId,
            data: { team, precheck },
            freshness: bundle.snapshot.freshness,
            limitations: [...team.limitations, ...bundle.limitations],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
