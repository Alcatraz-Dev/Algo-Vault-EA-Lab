import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import { PORTFOLIO_AGENTS, runPortfolioAgentTeam, DEFAULT_PORTFOLIO_AGENT_PERMISSION } from "@/lib/portfolio/agents";
import { computeAllocation, recommendAllocation } from "@/lib/portfolio/allocation";
import { defaultScenarios, runStressTests } from "@/lib/portfolio/stress";
import { recordObservability } from "@/lib/portfolio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/agents  (Pro)
 *
 * Lists the portfolio agent definitions and, when `?run=1`, executes the
 * read-only agent team against the live book.
 */
export async function GET(request: NextRequest) {
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

        if (request.nextUrl.searchParams.get("run") !== "1") {
            return portfolioJson({
                ok: true,
                portfolioId,
                data: {
                    agents: PORTFOLIO_AGENTS.map((a) => ({
                        id: a.id,
                        name: a.name,
                        version: a.version,
                        capabilities: a.capabilities,
                        allowedTools: a.allowedTools,
                        permissions: a.permissions,
                        riskLevel: a.riskLevel,
                    })),
                    defaultPermission: DEFAULT_PORTFOLIO_AGENT_PERMISSION,
                },
                limitations: [
                    "Every portfolio agent runs read-only by default. Applying a recommendation requires explicit approval and the existing Risk Engine + Execution Supervisor gates.",
                ],
            });
        }

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

        const team = runPortfolioAgentTeam({
            snapshot: bundle.snapshot,
            strategyIntelligence: bundle.strategyIntelligence,
            stressResult,
            allocation: recommendations,
            now: Date.now(),
        });

        void recordObservability({
            portfolioId,
            userId: auth.ctx.uid,
            kind: "AGENT_FAILURE",
            createdAt: Date.now(),
            dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
            detail: `${team.agents.length} portfolio agents executed.`,
            metadata: {
                agents: team.agents.length,
                failed: team.agents.filter((a) => a.status === "failed").length,
            },
        });

        return portfolioJson({
            ok: true,
            portfolioId,
            data: { team },
            freshness: bundle.snapshot.freshness,
            limitations: team.limitations,
        });
    } catch (error) {
        return portfolioError(error);
    }
}
