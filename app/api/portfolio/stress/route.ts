import { NextRequest, NextResponse } from "next/server";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import { defaultScenarios, runStressTests } from "@/lib/portfolio/stress";
import { readRecentSnapshots } from "@/lib/portfolio/store";
import type { PortfolioStressTest } from "@/lib/portfolio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stored stress tests are capped so this read can never be unbounded. */
const MAX_STORED = 10;

/**
 * GET /api/portfolio/stress  (Pro)
 *
 * Runs (and records) deterministic portfolio stress scenarios against the live
 * book. Every scenario carries explicit HISTORICAL or SIMULATED provenance.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await authorizePortfolio(request);
        if (!auth.ok) return auth.response;

        const gate = requireFeature(auth.ctx.plan, "portfolio.stress");
        if (!gate.allowed) return gate.response;

        const portfolioId = resolvePortfolioId(auth.ctx, request.nextUrl.searchParams.get("portfolioId"));
        if (!portfolioId) {
            return NextResponse.json(
                { ok: false, error: "PORTFOLIO_NOT_FOUND", message: "You do not own this portfolio." },
                { status: 403 }
            );
        }

        const bundle = await buildPortfolioBundle({ userId: auth.ctx.uid, portfolioId });

        const stressTest = runStressTests({
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

        const stored = await readRecentSnapshots(auth.ctx.uid, portfolioId, MAX_STORED)
            .then((rows) => rows.filter((r) => r.trigger === "STRESS_TEST") as unknown as PortfolioStressTest[])
            .catch(() => []);

        return portfolioJson({
            ok: true,
            portfolioId,
            data: { current: stressTest, stored: stored.slice(0, MAX_STORED) },
            freshness: bundle.snapshot.freshness,
            limitations: stressTest.limitations,
        });
    } catch (error) {
        return portfolioError(error);
    }
}
