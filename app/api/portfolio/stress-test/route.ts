import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { authorizePortfolio, portfolioError, portfolioJson, requireFeature, resolvePortfolioId } from "../_lib";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import {
    buildScenario,
    defaultScenarios,
    historicalWorstBarMove,
    runStressTests,
    type HistoricalShockSource,
} from "@/lib/portfolio/stress";
import { fetchDeepHistoryPage } from "@/lib/market-data/twelvedata/candle-bridge";
import { normalizeSymbolInput } from "@/lib/market-data/twelvedata/symbol-map";
import { recordObservability, writeImmutableSnapshot, writeStressTest } from "@/lib/portfolio/store";
import type { PortfolioScenario, ScenarioKind } from "@/lib/portfolio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scenario kinds a caller may request by name. */
const REQUESTABLE: ScenarioKind[] = [
    "VOLATILITY_EXPANSION",
    "SPREAD_WIDENING",
    "SLIPPAGE_INCREASE",
    "CORRELATION_SPIKE",
    "MARKET_GAP",
    "DRAWDOWN_SHOCK",
    "ADVERSE_TREND",
    "LIQUIDITY_REDUCTION",
];

/**
 * POST /api/portfolio/stress-test  (Pro)
 *
 * Runs a named scenario against the live book. When real OHLC candles are
 * available for the largest holding, the shock is measured from history and
 * labelled HISTORICAL with the exact window; otherwise the scenario is
 * explicitly labelled SIMULATED. A simulated result is never presented as a
 * historical fact.
 */
export async function POST(request: NextRequest) {
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

        const body = (await request.json().catch(() => ({}))) as {
            kind?: string;
            shockPercent?: number;
            anchorSymbol?: string;
            persist?: boolean;
        };

        const bundle = await buildPortfolioBundle({ userId: auth.ctx.uid, portfolioId });
        if (bundle.snapshot.positions.length === 0) {
            return portfolioJson(
                {
                    ok: false,
                    error: "NO_OPEN_POSITIONS",
                    message: "Portfolio has no open positions — a stress test would be a no-op.",
                },
                409
            );
        }

        const kind = (body.kind ?? "ADVERSE_TREND").toUpperCase() as ScenarioKind;
        if (!REQUESTABLE.includes(kind)) {
            return portfolioJson(
                { ok: false, error: "UNKNOWN_SCENARIO", message: `Scenario "${kind}" is not supported.` },
                400
            );
        }

        const preset = defaultScenarios().find((s) => s.kind === kind);
        const anchorSymbol = body.anchorSymbol ?? bundle.snapshot.exposure.bySymbol[0]?.key;
        let scenario: PortfolioScenario = buildScenario({
            scenarioId: `${kind.toLowerCase()}-${Date.now()}`,
            kind,
            name: preset?.name ?? `${kind.replace(/_/g, " ").toLowerCase()} scenario`,
            parameters:
                typeof body.shockPercent === "number" && Number.isFinite(body.shockPercent)
                    ? { defaultShockPercent: body.shockPercent }
                    : preset?.parameters ?? { defaultShockPercent: -0.05 },
            methodology: preset?.methodology ?? "Custom shock applied uniformly to open positions.",
        });

        if (anchorSymbol) {
            const historical = await anchorToHistory(anchorSymbol);
            if (historical) {
                scenario = {
                    ...scenario,
                    basis: "HISTORICAL",
                    historicalWindow: {
                        from: historical.from,
                        to: historical.to,
                        symbol: anchorSymbol,
                        source: "market-data-engine:candles",
                    },
                    parameters: { ...scenario.parameters, defaultShockPercent: historical.shockPercent },
                    methodology:
                        `Worst single-bar adverse move of ${anchorSymbol} H1 measured from ${historical.count} real candles ` +
                        `between ${new Date(historical.from).toISOString()} and ${new Date(historical.to).toISOString()} ` +
                        `(intrabar open→close move; peak wick excursion is not modelled).`,
                };
            }
        }

        const stressTest = runStressTests({
            portfolioId,
            positions: bundle.snapshot.positions,
            accounts: bundle.snapshot.accounts,
            equity: bundle.snapshot.equity,
            scenarios: [scenario],
            riskBudgets: bundle.snapshot.riskBudgetUsage.map((u) => ({
                kind: u.kind,
                limitPercent: u.limitPercent,
                scopeKey: u.scopeKey,
            })),
            generatedAt: Date.now(),
            dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
        });

        if (body.persist !== false) {
            await writeStressTest(auth.ctx.uid, portfolioId, stressTest);
            await writeImmutableSnapshot({
                userId: auth.ctx.uid,
                portfolio: bundle.portfolio,
                trigger: "STRESS_TEST",
                snapshot: bundle.snapshot,
                riskBudgets: [],
                allocation: null,
                now: Date.now(),
            });
        }

        void recordObservability({
            portfolioId,
            userId: auth.ctx.uid,
            kind: "STRESS_JOB",
            createdAt: Date.now(),
            dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
            detail: `Stress test ${scenario.scenarioId} (${scenario.basis}) executed.`,
            metadata: { basis: scenario.basis, kind },
        });

        return portfolioJson({
            ok: true,
            portfolioId,
            data: stressTest,
            freshness: bundle.snapshot.freshness,
            limitations: stressTest.limitations,
        });
    } catch (error) {
        return portfolioError(error);
    }
}

function largestHoldingSymbol(bundle: { snapshot: { exposure: { bySymbol: Array<{ key: string }> } } }): string | undefined {
    return bundle.snapshot.exposure.bySymbol[0]?.key;
}

/** Measure the worst real single-bar adverse move from actual OHLC candles. */
async function anchorToHistory(
    symbol: string
): Promise<{ shockPercent: number; from: number; to: number; count: number } | null> {
    const normalized = normalizeSymbolInput(symbol);
    if (!normalized) return null;
    const candles = await fetchDeepHistoryPage(normalized, "H1", { limit: 250 }).catch(() => null);
    if (!candles || candles.length < 20) return null;
    const source: HistoricalShockSource = {
        symbol: normalized,
        timeframe: "H1",
        candles: candles.map((c) => ({
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        })),
    };
    return historicalWorstBarMove(source);
}
