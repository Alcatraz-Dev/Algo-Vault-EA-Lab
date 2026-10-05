import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import { computeAllocation, recommendAllocation } from "@/lib/portfolio/allocation";
import { recordObservability, writeAllocation, writeJournalEntry } from "@/lib/portfolio/store";
import type { AllocationMethod } from "@/lib/portfolio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS: AllocationMethod[] = [
    "EQUAL",
    "RISK_BASED",
    "VOLATILITY_ADJUSTED",
    "RISK_PARITY",
    "STRATEGY_BUDGET",
    "USER_DEFINED",
];

/**
 * POST /api/portfolio/allocation/recommend  (Pro)
 *
 * Produces capital allocation RECOMMENDATIONS. It never moves capital: every
 * recommendation carries `requiresApproval: true` and no execution payload, and
 * applying one still requires the user's explicit action plus the existing Risk
 * Engine and Execution Supervisor gates.
 */
export async function POST(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.allocation");
        if (!gate.allowed) return gate.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const body = (await request.json().catch(() => ({}))) as {
            method?: string;
            strategyBudgets?: Record<string, number>;
            userWeights?: Record<string, number>;
            persist?: boolean;
        };

        const method = (body.method ?? "RISK_PARITY").toUpperCase() as AllocationMethod;
        if (!METHODS.includes(method)) {
            return portfolioJson(
                { ok: false, error: "UNKNOWN_METHOD", message: `Allocation method "${method}" is not supported.` },
                400
            );
        }

        const bundle = await buildPortfolioBundle({ userId: auth.ctx.uid, portfolioId });
        if (bundle.strategyIntelligence.strategies.length === 0) {
            return portfolioJson(
                {
                    ok: true,
                    portfolioId,
                    data: { allocation: null, recommendations: [] },
                    limitations: [
                        "No strategies are attributed to this portfolio, so no allocation can be computed. This is not reported as an even split.",
                    ],
                },
                200
            );
        }

        const now = Date.now();
        const allocation = computeAllocation({
            portfolioId,
            method,
            strategyBudgets: body.strategyBudgets,
            userWeights: body.userWeights,
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
            calculatedAt: now,
        });

        const recommendations = recommendAllocation(allocation, bundle.strategyIntelligence, { now });

        if (body.persist !== false) {
            await writeAllocation(auth.ctx.uid, portfolioId, allocation);
            for (const r of recommendations) {
                await writeJournalEntry(auth.ctx.uid, portfolioId, {
                    portfolioId,
                    type: "ALLOCATION_RECOMMENDATION",
                    whatAlgoVaultRecommended: `${r.action} ${r.strategyId} to ${(r.targetWeight * 100).toFixed(1)}% (currently ${(r.currentWeight * 100).toFixed(1)}%). ${r.rationale.join(" ")}`,
                    whatTheUserDid: "Pending — recommendation generated, no action taken.",
                    whatHappenedAfter: null,
                    evidenceAtDecision: r.evidence.map((e) => ({
                        id: `${r.strategyId}:${e.metric}`,
                        kind: "CALCULATED",
                        source: "portfolio-allocation-engine",
                        detail: e.note,
                        value: e.observed,
                    })),
                    outcomeAssessment: "PENDING",
                    createdAt: now,
                    dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
                });
            }
        }

        void recordObservability({
            portfolioId,
            userId: auth.ctx.uid,
            kind: "ALLOCATION_RECOMMENDATION",
            createdAt: now,
            dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
            detail: `${recommendations.length} allocation recommendation(s) produced with method ${method}.`,
            metadata: { method, recommendations: recommendations.length },
        });

        return portfolioJson({
            ok: true,
            portfolioId,
            data: { allocation, recommendations },
            freshness: bundle.snapshot.freshness,
            limitations: [
                ...allocation.limitations,
                "Recommendations are advisory only. AlgoVault never moves live capital automatically.",
            ],
        });
    } catch (error) {
        return portfolioError(error);
    }
}
