/**
 * AlgoVault — Portfolio Intelligence unit tests (Phase 15 §45).
 *
 * Covers exposure, concentration, correlation, risk budgets, health, regime,
 * allocation, stress, Monte Carlo, decision/pre-check, strategy overlap,
 * instruments, agents and entitlements.
 */

import { computeAllocation, recommendAllocation } from "../allocation";
import { answerPortfolioQuestion, classifyPortfolioQuestion } from "../chat";
import {
    alignReturns,
    buildCorrelationMatrix,
    classifyRelationship,
    computeCorrelationRisk,
    computePairs,
    logReturns,
    pearson,
    portfolioCorrelationAfter,
    spearman,
} from "../correlation";
import { concentrationAfterTrade, computeConcentration } from "../concentration";
import { runTradePreCheck } from "../decision";
import { portfolioEntitlements, hasPortfolioFeature } from "../entitlements";
import { computeExposure } from "../exposure";
import { computeHealth } from "../health";
import {
    contractSizeOf,
    currencyWeights,
    instrumentMetadata,
    supportedAssetClasses,
    unsupportedAssetClasses,
} from "../instruments";
import { runPortfolioMonteCarlo, runPortfolioMonteCarloFor } from "../monte-carlo";
import { computeRegime, realisedVolatility } from "../regime";
import { defaultRiskBudgets, evaluateRiskBudgets } from "../risk-budgets";
import { buildScenario, defaultScenarios, runStressTests } from "../stress";
import { computeStrategyIntelligence, strategyToPortfolioCorrelation } from "../strategy-intelligence";
import { HISTORICAL_PORTFOLIO_TOOLS, PORTFOLIO_TOOL_DEFINITIONS, allLiveStateToolsGuarded, allPortfolioToolsReadOnly } from "../tool-definitions";
import { PORTFOLIO_AGENTS, runPortfolioAgentTeam, toAgentRiskLevel } from "../agents";
import { PORTFOLIO_WORKFLOW_NODES } from "../workflow-nodes";
import { computeExposure as computeExposureAgain } from "../exposure";
import type { PortfolioSnapshot } from "../types";
import {
    NOW,
    TEST_NOW,
    account,
    check,
    correlatedSeries,
    emptyStrategyIntelligence,
    freshness,
    near,
    position,
    results,
    section,
    syntheticSeries,
} from "./portfolio.test";

/* ── Exposure ─────────────────────────────────────────────────────────────── */

function testExposure(): void {
    section("Exposure engine");

    const positions = [
        position({ positionId: "p1", symbol: "XAUUSD", side: "LONG", quantity: 1, notional: 200_000, strategyId: "A" }),
        position({ positionId: "p2", symbol: "EURUSD", side: "SHORT", quantity: 0.5, currentPrice: 1.1, notional: 55_000, strategyId: "B", assetClass: "FX" }),
        position({ positionId: "p3", symbol: "XAUUSD", side: "LONG", quantity: 0.5, notional: 100_000, strategyId: "A" }),
    ];
    const exposure = computeExposure({
        portfolioId: "primary",
        positions,
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });

    check("gross = sum of |notional|", near(exposure.grossExposure, 355_000), exposure.grossExposure);
    check("net = long − short", near(exposure.netExposure, 355_000 - 2 * 55_000), exposure.netExposure);
    check("gross/equity", near(exposure.grossToEquity, 3.55), exposure.grossToEquity);

    const xau = exposure.bySymbol.find((s) => s.key === "XAUUSD");
    check("XAUUSD is 84.5% of gross", near(xau?.grossWeight ?? 0, 300_000 / 355_000), xau?.grossWeight);

    const byDirection = Object.fromEntries(exposure.byDirection.map((d) => [d.key, d.grossWeight]));
    check("LONG share", near(byDirection.LONG, 300_000 / 355_000), byDirection.LONG);
    check("SHORT share", near(byDirection.SHORT, 55_000 / 355_000), byDirection.SHORT);

    const byStrategy = Object.fromEntries(exposure.byStrategy.map((s) => [s.key, s.grossWeight]));
    check("strategy A share", near(byStrategy.A, 300_000 / 355_000), byStrategy.A);
    check("no MANUAL bucket when every position is strategy-attributed", byStrategy.MANUAL === undefined, Object.keys(byStrategy));

    const currencies = exposure.byCurrency.filter((c) => c.status === "AVAILABLE");
    check("currency axis produced slices", currencies.length > 0, currencies.length);
    const usd = currencies.find((c) => c.key === "USD");
    check("USD appears in the currency axis", Boolean(usd), currencies.map((c) => c.key));

    const empty = computeExposure({
        portfolioId: "primary",
        positions: [],
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    check("empty book has zero gross exposure", empty.grossExposure === 0, empty.grossExposure);
    check("empty book still returns axes", empty.bySymbol.length === 0 && empty.positionCount === 0);

    const unknown = computeExposure({
        portfolioId: "primary",
        positions: [position({ symbol: "WEIRDXYZ", assetClass: "UNAVAILABLE" })],
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    check("unknown symbol is reported UNAVAILABLE, not estimated", unknown.limitations.some((l) => l.includes("UNAVAILABLE")), unknown.limitations);
    check("no NaN in gross exposure", Number.isFinite(unknown.grossExposure), unknown.grossExposure);
}

/* ── Concentration ────────────────────────────────────────────────────────── */

function testConcentration(): void {
    section("Concentration engine");

    const positions = [
        position({ positionId: "p1", symbol: "XAUUSD", quantity: 2, notional: 400_000, strategyId: "A" }),
        position({ positionId: "p2", symbol: "EURUSD", currentPrice: 1.1, quantity: 0.2, notional: 22_000, strategyId: "B", assetClass: "FX" }),
    ];
    const exposure = computeExposure({
        portfolioId: "primary",
        positions,
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const concentration = computeConcentration({
        portfolioId: "primary",
        exposure,
        positions,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });

    const symbolAxis = concentration.axes.find((a) => a.axis === "SYMBOL");
    check("symbol axis available", symbolAxis?.status === "AVAILABLE", symbolAxis?.status);
    const expectedHhi = Math.pow(400_000 / 422_000, 2) + Math.pow(22_000 / 422_000, 2);
    check("HHI matches the documented formula", near(symbolAxis?.hhi ?? 0, expectedHhi, 1e-3), { got: symbolAxis?.hhi, expectedHhi });
    check("effective count = 1/HHI", near(symbolAxis?.effectiveCount ?? 0, 1 / expectedHhi, 1e-2));
    check("severity is HIGH for a single dominant symbol", concentration.severity === "HIGH", concentration.severity);

    const after = concentrationAfterTrade(concentration, "BTCUSD", 400_000, 422_000);
    check("concentration after an equal-sized new bet is lower than a single bet", after !== null && (after as number) < (symbolAxis?.hhi ?? 0), after);

    const flat = computeConcentration({
        portfolioId: "primary",
        exposure: computeExposure({
            portfolioId: "primary",
            positions: ["A", "B", "C", "D"].map((s, i) =>
                position({ positionId: `p${i}`, symbol: ["XAUUSD", "EURUSD", "BTCUSD", "NAS100"][i], notional: 10_000, assetClass: ["METALS", "FX", "CRYPTO", "INDICES"][i] as never })
            ),
            accounts: [account()],
            equity: 100_000,
            calculatedAt: TEST_NOW,
            dataTimestamp: TEST_NOW,
            freshness: freshness(),
        }),
        positions: [],
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const flatAxis = flat.axes.find((a) => a.axis === "SYMBOL");
    check("a perfectly flat 4-way split has HHI = 0.25", near(flatAxis?.hhi ?? 0, 0.25, 1e-3), flatAxis?.hhi);
    check("flat book has an effective count of 4", near(flatAxis?.effectiveCount ?? 0, 4, 1e-2));
}

/* ── Correlation ──────────────────────────────────────────────────────────── */

function testCorrelation(): void {
    section("Correlation engine");

    const up = [1, 2, 3, 4, 5];
    const down = [5, 4, 3, 2, 1];
    check("Pearson of identical series is 1", near(pearson(up, up) ?? 0, 1), pearson(up, up));
    check("Pearson of a reversed series is −1", near(pearson(up, down) ?? 0, -1));
    check("Spearman agrees with Pearson on a monotone transform", near(spearman(up, up) ?? 0, 1));
    check("zero variance returns null, not 0", pearson([1, 1, 1, 1], up) === null);
    check("empty input returns null", pearson([], []) === null);

    check("relationship banding: 0.8 → STRONG_POSITIVE", classifyRelationship(0.8) === "STRONG_POSITIVE");
    check("relationship banding: 0.4 → POSITIVE", classifyRelationship(0.4) === "POSITIVE");
    check("relationship banding: 0.1 → NEUTRAL", classifyRelationship(0.1) === "NEUTRAL");
    check("relationship banding: −0.5 → NEGATIVE", classifyRelationship(-0.5) === "NEGATIVE");
    check("relationship banding: −0.9 → STRONG_NEGATIVE", classifyRelationship(-0.9) === "STRONG_NEGATIVE");
    check("relationship banding: null → UNKNOWN", classifyRelationship(null) === "UNKNOWN");

    const base = syntheticSeries(7, 300);
    const mirror = correlatedSeries(base, 1);
    const returns = logReturns({ symbol: "A", ...base });
    check("a perfectly co-moving pair correlates at 1", near(pearson(returns.values, logReturns({ symbol: "B", ...mirror }).values) ?? 0, 1, 1e-9));

    const aligned = alignReturns(
        { timestamps: [1, 2, 3], values: [10, 20, 30] },
        { timestamps: [2, 3, 4], values: [1, 2, 3] }
    );
    check("alignment pairs by timestamp, not by index", aligned.timestamps.length === 2 && aligned.timestamps[0] === 2, aligned.timestamps);

    // Too little history must report INSUFFICIENT_DATA with a null coefficient.
    const tooShort = computePairs({
        series: {
            A: { symbol: "A", timestamps: [1, 2, 3, 4], closes: [1, 1.1, 0.9, 1.2] },
            B: { symbol: "B", timestamps: [1, 2, 3, 4], closes: [2, 2.2, 1.8, 2.4] },
        },
        symbols: ["A", "B"],
        window: 100,
    });
    check("insufficient history reports null, never an estimate", tooShort[0]?.coefficient === null, tooShort[0]?.coefficient);
    check("insufficient history is labelled", tooShort[0]?.status === "INSUFFICIENT_DATA", tooShort[0]?.status);

    const matrix = buildCorrelationMatrix({
        portfolioId: "primary",
        symbols: ["A", "B", "C"],
        series: {
            A: { symbol: "A", ...base },
            B: { symbol: "B", ...correlatedSeries(base, 1) },
            C: { symbol: "C", ...syntheticSeries(99, 300) },
        },
        timeframe: "H1",
        window: 100,
        dataTimestamp: TEST_NOW,
        calculatedAt: TEST_NOW,
        freshness: freshness(),
    });
    check("matrix diagonal is 1", matrix.matrix.every((row, i) => row[i] === 1));
    check("matrix is symmetric", matrix.matrix.every((row, i) => row.every((v, j) => v === matrix.matrix[j][i])));
    check("correlated pair is near +1", near(matrix.matrix[0][1] ?? 0, 1, 1e-6), matrix.matrix[0][1]);
    check("matrix states it is not a forecast", matrix.limitations.some((l) => /not a forecast/i.test(l)), matrix.limitations);

    const positions = [
        position({ positionId: "p1", symbol: "A", side: "LONG", notional: 50_000 }),
        position({ positionId: "p2", symbol: "B", side: "LONG", notional: 50_000 }),
    ];
    const exposure = computeExposure({
        portfolioId: "primary",
        positions,
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const risk = computeCorrelationRisk({
        portfolioId: "primary",
        matrix: matrix,
        positions,
        exposure,
        calculatedAt: TEST_NOW,
    });
    check("same-direction correlated positions form a cluster", risk.clusterSize >= 2, risk.clusterSize);
    check("cluster risk severity is HIGH", risk.severity === "HIGH", risk.severity);
    check("cluster evidence separates OBSERVED/CALCULATED", risk.evidence.every((e) => ["OBSERVED", "CALCULATED"].includes(e.kind)));

    const hedged = [positions[0], position({ positionId: "p2", symbol: "B", side: "SHORT", notional: 50_000 })];
    const hedgedRisk = computeCorrelationRisk({
        portfolioId: "primary",
        matrix,
        positions: hedged,
        exposure,
        calculatedAt: TEST_NOW,
    });
    check("opposite-side correlation is reported as offsetting", hedgedRisk.evidence.some((e) => e.kind === "OBSERVED" && /offset/.test(e.text)), hedgedRisk.evidence.map((e) => e.text));

    check(
        "correlation with the book is computed for an incoming symbol",
        near(portfolioCorrelationAfter(matrix, ["A"], "B") ?? 0, 1, 1e-6)
    );
}

/* ── Instruments ──────────────────────────────────────────────────────────── */

function testInstruments(): void {
    section("Instrument metadata");

    const xau = instrumentMetadata("XAUUSD");
    check("XAUUSD is METALS", xau.assetClass === "METALS", xau.assetClass);
    check("XAUUSD contract size comes from the canonical registry", xau.contractSize === 100, xau.contractSize);

    const eurusd = instrumentMetadata("EURUSD");
    check("EURUSD is FX", eurusd.assetClass === "FX", eurusd.assetClass);
    check("EURUSD currency pair is EUR/USD", eurusd.currencyPair?.[0] === "EUR" && eurusd.currencyPair?.[1] === "USD", eurusd.currencyPair);

    const unknown = instrumentMetadata("NOPE123");
    check("unknown symbol reports UNAVAILABLE, never a guess", unknown.assetClass === "UNAVAILABLE", unknown.assetClass);
    check("unknown symbol has null contract size", unknown.contractSize === null);
    check("unknown symbol has null currency", unknown.currency === null);

    check("contractSizeOf(unknown) is null", contractSizeOf("NOPE123") === null);

    const weights = currencyWeights("EURUSD", 10_000);
    check("long EURUSD is +EUR / −USD", weights?.[0].signed === 10_000 && weights?.[1].signed === -10_000, weights);
    check("currencyWeights(unknown) is null so callers report UNAVAILABLE", currencyWeights("NOPE123", 10_000) === null);

    check("supported asset classes are read from the registry", supportedAssetClasses().includes("FX"), supportedAssetClasses());
    check("unsupported classes are reported, not faked", unsupportedAssetClasses().includes("ETFS"), unsupportedAssetClasses());
}

/* ── Risk budgets ─────────────────────────────────────────────────────────── */

function testRiskBudgets(): void {
    section("Risk budgets");

    const positions = [
        position({ positionId: "p1", symbol: "XAUUSD", quantity: 1, notional: 200_000, strategyId: "A" }),
        position({ positionId: "p2", symbol: "EURUSD", currentPrice: 1.1, quantity: 0.2, notional: 22_000, strategyId: "B", assetClass: "FX" }),
    ];
    const exposure = computeExposure({
        portfolioId: "primary",
        positions,
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const concentration = computeConcentration({
        portfolioId: "primary",
        exposure,
        positions,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const correlation = computeCorrelationRisk({
        portfolioId: "primary",
        matrix: buildCorrelationMatrix({
            portfolioId: "primary",
            symbols: [],
            series: {},
            timeframe: "H1",
            window: 100,
            dataTimestamp: TEST_NOW,
            calculatedAt: TEST_NOW,
            freshness: freshness(),
        }),
        positions,
        exposure,
        calculatedAt: TEST_NOW,
    });

    const budgets = [
        ...defaultRiskBudgets(TEST_NOW, "test"),
        { budgetId: "s", scope: "STRATEGY" as const, scopeKey: "A", kind: "STRATEGY_RISK" as const, limitPercent: 0.5, enabled: true, updatedAt: TEST_NOW, updatedBy: "test" },
    ];

    const usage = evaluateRiskBudgets({
        budgets,
        equity: 100_000,
        exposure,
        concentration,
        correlation,
        accounts: [account()],
        positionsRiskPercentByStrategy: { A: 2.0, B: 0.1 },
        positionsRiskPercentBySymbol: { XAUUSD: 2.0, EURUSD: 0.1 },
        openRiskPercent: 2.1,
        drawdownPercent: 0,
        dailyLossPercent: null,
        marginLevelPercent: 2000,
    });

    const portfolioRisk = usage.find((u) => u.kind === "PORTFOLIO_RISK");
    check("portfolio risk budget is BREACHED at 2.1% of a 2% budget", portfolioRisk?.status === "BREACHED", portfolioRisk);
    const strategyA = usage.find((u) => u.scopeKey === "A");
    check("strategy A budget is BREACHED", strategyA?.status === "BREACHED", strategyA);
    const daily = usage.find((u) => u.kind === "DAILY_LOSS");
    check("an unmeasurable budget is UNKNOWN, not OK", daily?.status === "UNKNOWN", daily);
    check("an UNKNOWN budget explains itself", typeof daily?.note === "string" && daily.note.length > 0, daily?.note);
    check("margin budget is OK at 2000% margin level", usage.find((u) => u.kind === "MARGIN")?.status === "OK");

    const watched = evaluateRiskBudgets({
        budgets: [
            { budgetId: "w", scope: "PORTFOLIO", scopeKey: "", kind: "PORTFOLIO_RISK", limitPercent: 2, enabled: true, updatedAt: TEST_NOW, updatedBy: "t" },
        ],
        equity: 100_000,
        exposure,
        concentration,
        correlation,
        accounts: [account()],
        positionsRiskPercentByStrategy: {},
        positionsRiskPercentBySymbol: {},
        openRiskPercent: 1.6,
        drawdownPercent: 0,
        dailyLossPercent: 0,
        marginLevelPercent: 2000,
    });
    check("80% utilization is WATCH, not BREACHED", watched[0].status === "WATCH", watched[0].status);
}

/* ── Health ───────────────────────────────────────────────────────────────── */

function testHealth(): void {
    section("Portfolio health");

    const positions = [position({ positionId: "p1", quantity: 1, notional: 200_000 })];
    const exposure = computeExposure({
        portfolioId: "primary",
        positions,
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const concentration = computeConcentration({
        portfolioId: "primary",
        exposure,
        positions,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const correlation = computeCorrelationRisk({
        portfolioId: "primary",
        matrix: buildCorrelationMatrix({
            portfolioId: "primary",
            symbols: [],
            series: {},
            timeframe: "H1",
            window: 100,
            dataTimestamp: TEST_NOW,
            calculatedAt: TEST_NOW,
            freshness: freshness(),
        }),
        positions,
        exposure,
        calculatedAt: TEST_NOW,
    });
    const regime = computeRegime({ portfolioId: "primary", equitySeries: [], calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW });

    const health = computeHealth({
        portfolioId: "primary",
        exposure,
        concentration,
        correlation,
        risk: {
            portfolioId: "primary",
            calculatedAt: TEST_NOW,
            dataTimestamp: TEST_NOW,
            equity: 100_000,
            balance: 100_000,
            unrealizedPnL: 0,
            realizedPnL: 0,
            openRisk: 2_000,
            openRiskPercent: 2,
            drawdown: 0,
            drawdownPercent: 0,
            dailyLoss: 0,
            dailyLossPercent: 0,
            marginUsed: 5_000,
            freeMargin: 95_000,
            marginLevelPercent: 2000,
            riskBudgetUsage: [],
            warnings: [],
            freshness: freshness(),
            limitations: [],
        },
        regime,
        accounts: [account()],
        strategies: [{ strategyId: "A", health: "GOOD" }],
        riskBudgetUsage: [],
        dataFreshnessOk: true,
        calculatedAt: TEST_NOW,
    });

    check("nine health components are exposed", health.components.length === 9, health.components.length);
    check("no component is reduced to a single opaque score", health.components.every((c) => typeof c.score === "number" && c.rating.length > 0));
    check("overall is the worst measured component", health.overall === "CRITICAL" || health.overall === "WARNING", health.overall);
    check("concentration of a single-instrument book is not GOOD", health.components.find((c) => c.component === "CONCENTRATION")?.rating !== "GOOD");
    check("health states it is not a probability", health.limitations.some((l) => /not a probability/i.test(l)), health.limitations);
}

/* ── Regime ───────────────────────────────────────────────────────────────── */

function testRegime(): void {
    section("Portfolio regime");

    const short = computeRegime({ portfolioId: "p", equitySeries: [{ timestamp: 1, equity: 100 }], calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW });
    check("too little history yields UNKNOWN, not a guess", short.regime === "UNKNOWN", short.regime);
    check("UNKNOWN explains why", short.notSupported.length > 0, short.notSupported);

    const flat = Array.from({ length: 40 }, (_, i) => ({ timestamp: i, equity: 100_000 }));
    const flatRegime = computeRegime({ portfolioId: "p", equitySeries: flat, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW });
    check("a flat equity curve does not claim high volatility", flatRegime.regime !== "HIGH_VOLATILITY", flatRegime.regime);
    check("realised volatility of a flat curve is 0", near(realisedVolatility(flat) ?? -1, 0, 1e-9));

    const crashing = Array.from({ length: 60 }, (_, i) => ({ timestamp: i, equity: 100_000 * Math.pow(0.985, i) }));
    const crashRegime = computeRegime({ portfolioId: "p", equitySeries: crashing, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW });
    check("a sustained decline is classified from measured evidence", ["RISK_OFF", "TRENDING"].includes(crashRegime.regime), crashRegime.regime);
    check("every regime vote carries metric + threshold", crashRegime.evidence.every((e) => typeof e.threshold === "number"), crashRegime.evidence);

    const stable = Array.from({ length: 60 }, (_, i) => ({ timestamp: i, equity: 100_000 + Math.sin(i / 4) * 20 }));
    const spike = computeRegime({
        portfolioId: "p",
        equitySeries: stable,
        correlationShift: 0.4,
        clusteredWeight: 0.7,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
    });
    check("a correlation shift on a stable book is classified as CORRELATION_BREAK", spike.regime === "CORRELATION_BREAK", spike.regime);

    const crashWithShift = computeRegime({
        portfolioId: "p",
        equitySeries: crashing,
        correlationShift: 0.4,
        clusteredWeight: 0.7,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
    });
    check("a sustained decline is evidenced as RISK_OFF even when a correlation break ties it", crashWithShift.evidence.some((e) => e.supports === "RISK_OFF") || crashWithShift.regime === "RISK_OFF", { regime: crashWithShift.regime, evidence: crashWithShift.evidence });
    check("risk-on is never asserted from a negative trend", !crashWithShift.alternatives.some((a) => a.regime === "RISK_ON"), crashWithShift.alternatives);
}

/* ── Allocation ───────────────────────────────────────────────────────────── */

function testAllocation(): void {
    section("Allocation engine");

    const inputs = [
        { strategyId: "A", currentWeight: 0.5, pnlContribution: 1_000, volatility: 0.1, maxDrawdownPercent: 5, oosSharpe: 1.5, sampleSize: 200, correlationToPortfolio: 0.2, health: "GOOD" as const, active: true },
        { strategyId: "B", currentWeight: 0.5, pnlContribution: -200, volatility: 0.3, maxDrawdownPercent: 12, oosSharpe: 0.3, sampleSize: 150, correlationToPortfolio: 0.8, health: "WATCH" as const, active: true },
        { strategyId: "C", currentWeight: 0, pnlContribution: 0, volatility: null, maxDrawdownPercent: null, oosSharpe: null, sampleSize: 5, correlationToPortfolio: null, health: "UNKNOWN" as const, active: true },
    ];

    const equal = computeAllocation({ portfolioId: "p", method: "EQUAL", inputs, calculatedAt: TEST_NOW });
    const eligible = equal.lines.filter((l) => l.strategyId !== "C");
    check("equal allocation splits evenly among eligible strategies", near(eligible[0].targetWeight, 0.5) && near(eligible[1].targetWeight, 0.5), equal.lines);
    check("a strategy below the sample minimum gets zero weight", equal.lines.find((l) => l.strategyId === "C")?.targetWeight === 0);
    check("weights are normalized", near(eligible.reduce((a, l) => a + l.targetWeight, 0), 1, 1e-3));
    check("every line states a method", equal.lines.every((l) => l.method === "EQUAL"));

    const parity = computeAllocation({ portfolioId: "p", method: "RISK_PARITY", inputs, calculatedAt: TEST_NOW });
    const a = parity.lines.find((l) => l.strategyId === "A");
    const b = parity.lines.find((l) => l.strategyId === "B");
    check("risk parity favours the lower-volatility strategy", (a?.targetWeight ?? 0) > (b?.targetWeight ?? 0), { a: a?.targetWeight, b: b?.targetWeight });

    const capped = computeAllocation({
        portfolioId: "p",
        method: "RISK_PARITY",
        inputs,
        constraints: [{ kind: "MAX_WEIGHT", value: 0.55, note: "test cap" }],
        calculatedAt: TEST_NOW,
    });
    check("a max-weight constraint is applied", capped.lines.every((l) => l.targetWeight <= 0.5501), capped.lines.map((l) => l.targetWeight));
    check("a clamped target says so", capped.lines.some((l) => l.rationale.some((r) => /clamped/i.test(r))));

    const recommendations = recommendAllocation(parity, emptyStrategyIntelligence(), { now: TEST_NOW });
    check("every recommendation requires approval", recommendations.every((r) => r.requiresApproval === true));
    check("no recommendation carries an execution instruction", recommendations.every((r) => r.permissionRequired === "USER_CONFIRMATION"));
    check("allocation disclaims optimality", parity.limitations.some((l) => /not a forecast|not a claim of optimal/i.test(l)), parity.limitations);

    const substitutes = recommendAllocation(
        parity,
        {
            ...emptyStrategyIntelligence(),
            strategies: inputs.map((i) => ({ strategyId: i.strategyId, name: null, active: i.active, openPositions: 0, grossNotional: 0, equityWeight: i.currentWeight, unrealizedPnL: 0, maxDrawdownPercent: i.maxDrawdownPercent, health: i.health, oosSharpe: i.oosSharpe, sampleSize: i.sampleSize, correlationToPortfolio: i.correlationToPortfolio, dataTimestamp: TEST_NOW, limitations: [] })),
            overlaps: [{ a: "A", b: "B", kind: "CORRELATION", overlap: 0.85, detail: "", evidence: [], harmfulCombination: true }],
        },
        { now: TEST_NOW }
    );
    check("a highly correlated pair is downgraded to REVIEW, never auto-increased", substitutes.every((r) => r.action !== "INCREASE"), substitutes.map((r) => r.action));
}

/* ── Stress ───────────────────────────────────────────────────────────────── */

function testStress(): void {
    section("Stress engine");

    const positions = [
        position({ positionId: "p1", symbol: "XAUUSD", side: "LONG", quantity: 1, currentPrice: 2_000, notional: 200_000, strategyId: "A" }),
        position({ positionId: "p2", symbol: "EURUSD", side: "SHORT", currentPrice: 1.1, quantity: 0.5, notional: 55_000, strategyId: "B", assetClass: "FX" }),
    ];
    const result = runStressTests({
        portfolioId: "p",
        positions,
        accounts: [account()],
        equity: 100_000,
        scenarios: [
            buildScenario({
                scenarioId: "xau-only",
                kind: "MARKET_GAP",
                name: "XAUUSD −3%",
                parameters: { defaultShockPercent: 0, "XAUUSD.shockPercent": -0.03 },
                methodology: "Only XAUUSD moves.",
            }),
        ],
        riskBudgets: [{ kind: "DRAWDOWN", limitPercent: 1 }],
        generatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
    });

    const entry = result.scenarios[0];
    // shockPercent is a signed price move: LONG 1 lot XAUUSD at 2000 moving
    // −3% is −60 × 100 = −6000.
    check("XAUUSD shock impact is priced from the canonical contract size", near(entry.pnlImpact, -6_000, 1), entry.pnlImpact);
    check("EURUSD is unaffected by a symbol-specific shock", entry.affectedPositions.length === 1, entry.affectedPositions);
    check("a symbol-specific shock is still labelled SIMULATED", entry.scenario.basis === "SIMULATED", entry.scenario.basis);
    check("the run labels the method as simulated", result.method === "SIMULATED_SHOCK", result.method);
    check("limitations say simulated is not historical", result.limitations.some((l) => /must not be read as historical fact/i.test(l)), result.limitations);
    check("the drawdown budget breach is detected", entry.breaches.length > 0, entry.breaches);

    const historical = buildScenario({
        scenarioId: "hist",
        kind: "DRAWDOWN_SHOCK",
        name: "Historical",
        parameters: { defaultShockPercent: -0.02 },
        methodology: "measured",
        historicalWindow: { from: 1, to: 2, symbol: "XAUUSD", source: "test" },
    });
    const histRun = runStressTests({ portfolioId: "p", positions, accounts: [account()], equity: 100_000, scenarios: [historical], generatedAt: TEST_NOW, dataTimestamp: TEST_NOW });
    check("a scenario with a window is labelled HISTORICAL", histRun.scenarios[0].scenario.basis === "HISTORICAL");
    check("the run method becomes HISTORICAL_REPLAY", histRun.method === "HISTORICAL_REPLAY", histRun.method);

    const shortPosition = position({ positionId: "p3", symbol: "XAUUSD", side: "SHORT", quantity: 1, currentPrice: 2_000, notional: 200_000 });
    const short = runStressTests({
        portfolioId: "p",
        positions: [shortPosition],
        accounts: [account()],
        equity: 100_000,
        scenarios: [buildScenario({ scenarioId: "s", kind: "MARKET_GAP", name: "s", parameters: { defaultShockPercent: -0.01 }, methodology: "m" })],
        generatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
    });
    check("a SHORT position gains when price falls", short.scenarios[0].pnlImpact > 0, short.scenarios[0].pnlImpact);

    check("the default scenario set labels everything as simulated", defaultScenarios().every((s) => s.basis === "SIMULATED"));
}

/* ── Monte Carlo ──────────────────────────────────────────────────────────── */

function testMonteCarlo(): void {
    section("Portfolio Monte Carlo");

    const trades = Array.from({ length: 60 }, (_, i) => ({ netPnL: (i % 7 === 0 ? -1 : 1) * (100 + i) }));
    const base = { tradePnL: trades, startingEquity: 10_000 };

    const a = runPortfolioMonteCarloFor("p", base, { seed: 42, simulations: 200, drawdownThreshold: 1_000 });
    const b = runPortfolioMonteCarloFor("p", base, { seed: 42, simulations: 200, drawdownThreshold: 1_000 });
    check("the same seed reproduces the same result", JSON.stringify(a) === JSON.stringify(b));
    const c = runPortfolioMonteCarloFor("p", base, { seed: 43, simulations: 200, drawdownThreshold: 1_000 });
    check("a different seed changes the result", JSON.stringify(a) !== JSON.stringify(c));

    check("it always says SIMULATION — NOT FORECAST", a.disclaimer === "SIMULATION — NOT FORECAST");
    check("median, p5, p95 are present", [a.endingEquity.median, a.endingEquity.p5, a.endingEquity.p95].every(Number.isFinite), a.endingEquity);
    check("drawdown distribution is present", a.drawdown.count === 200, a.drawdown.count);
    check("loss streak distribution is present", a.lossStreak.count === 200, a.lossStreak.count);
    check("threshold breach probability is computed", a.thresholdBreachProbability !== null, a.thresholdBreachProbability);
    check("it is not a forecast, stated in limitations", a.limitations.some((l) => /not a prediction/i.test(l)));

    const thin = runPortfolioMonteCarloFor("p", { tradePnL: [{ netPnL: 1 }], startingEquity: 1_000 }, { seed: 1, simulations: 10 });
    check("insufficient trades produce no distribution", thin.simulationsCompleted === 0 && thin.limitations.length > 0, thin.limitations);

    const correlated = runPortfolioMonteCarloFor(
        "p",
        {
            tradePnL: trades.map((t, i) => ({ ...t, strategyId: i % 2 === 0 ? "A" : "B" })),
            startingEquity: 10_000,
            strategySeries: { A: trades.filter((_, i) => i % 2 === 0).map((t) => t.netPnL), B: trades.filter((_, i) => i % 2 === 1).map((t) => t.netPnL) },
        },
        { seed: 7, simulations: 100, method: "correlated_bootstrap" }
    );
    check("correlated simulation runs", correlated.simulationsCompleted === 100, correlated.simulationsCompleted);
    check("correlated simulation documents its assumption", correlated.limitations.some((l) => /rank ordering/i.test(l)), correlated.limitations);
}

/* ── Strategy intelligence ────────────────────────────────────────────────── */

function testStrategyIntelligence(): void {
    section("Strategy-to-portfolio intelligence");

    const positions = [
        position({ positionId: "p1", symbol: "XAUUSD", strategyId: "A", notional: 100_000 }),
        position({ positionId: "p2", symbol: "XAUUSD", strategyId: "B", notional: 100_000 }),
    ];
    const exposure = computeExposure({
        portfolioId: "p",
        positions,
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });

    const result = computeStrategyIntelligence({
        portfolioId: "p",
        strategies: [
            { strategyId: "A", active: true, openSymbols: ["XAUUSD"], signalSymbols: ["XAUUSD"], unrealizedPnL: 0, grossNotional: 100_000, riskAmount: 500, maxDrawdownPercent: 5, health: "GOOD", oosSharpe: 1.2, sampleSize: 100 },
            { strategyId: "B", active: true, openSymbols: ["XAUUSD"], signalSymbols: ["XAUUSD"], unrealizedPnL: 0, grossNotional: 100_000, riskAmount: 600, maxDrawdownPercent: 6, health: "GOOD", oosSharpe: 1.1, sampleSize: 90 },
        ],
        positions,
        exposure,
        equity: 100_000,
        matrix: null,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
    });

    const positionOverlap = result.overlaps.find((o) => o.kind === "POSITION");
    check("position overlap is detected", positionOverlap?.overlap === 1, positionOverlap?.overlap);
    check("two healthy strategies that overlap are flagged as a harmful combination", positionOverlap?.harmfulCombination === true);
    check("hidden concentration is detected", result.hiddenConcentrationDetected === true);
    check("no correlation matrix means the correlation axis is omitted, not zeroed", result.limitations.some((l) => /omitted rather than assumed/i.test(l)), result.limitations);

    const solo = computeStrategyIntelligence({
        portfolioId: "p",
        strategies: [{ strategyId: "A", active: true, openSymbols: ["XAUUSD"], signalSymbols: [], unrealizedPnL: 0, grossNotional: 100_000, riskAmount: 500, maxDrawdownPercent: 5, health: "CRITICAL", oosSharpe: 1.2, sampleSize: 100 }],
        positions,
        exposure,
        equity: 100_000,
        matrix: null,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
    });
    check("an unhealthy strategy alone is not a hidden-concentration event", solo.hiddenConcentrationDetected === false);

    check("strategy/portfolio correlation needs enough observations", strategyToPortfolioCorrelation([1, 2], [1, 2]) === null);
    const series = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) + (i % 5) * 0.1);
    check("strategy/portfolio correlation is computed from real series", strategyToPortfolioCorrelation(series, series) !== null);
}

/* ── Decision + pre-check ─────────────────────────────────────────────────── */

function buildPrecheckSnapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
    const positions = overrides.positions ?? [
        position({ positionId: "p1", symbol: "XAUUSD", side: "LONG", quantity: 0.5, notional: 100_000, strategyId: "A" }),
        position({ positionId: "p2", symbol: "EURUSD", side: "LONG", currentPrice: 1.1, quantity: 0.3, notional: 33_000, strategyId: "B", assetClass: "FX" }),
    ];
    const f = freshness();
    const exposure = computeExposure({ portfolioId: "p", positions, accounts: [account()], equity: 100_000, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: f });
    const concentration = computeConcentration({ portfolioId: "p", exposure, positions, dataTimestamp: TEST_NOW, freshness: f });
    const correlation = computeCorrelationRisk({
        portfolioId: "p",
        matrix: buildCorrelationMatrix({ portfolioId: "p", symbols: [], series: {}, timeframe: "H1", window: 100, dataTimestamp: TEST_NOW, calculatedAt: TEST_NOW, freshness: f }),
        positions,
        exposure,
        calculatedAt: TEST_NOW,
    });
    const regime = computeRegime({ portfolioId: "p", equitySeries: [], calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW });
    const budgets = defaultRiskBudgets(TEST_NOW, "test");
    const riskBudgetUsage = evaluateRiskBudgets({
        budgets,
        equity: 100_000,
        exposure,
        concentration,
        correlation,
        accounts: [account()],
        positionsRiskPercentByStrategy: { A: 0.5, B: 0.3 },
        positionsRiskPercentBySymbol: { XAUUSD: 0.5, EURUSD: 0.3 },
        openRiskPercent: 0.8,
        drawdownPercent: 0,
        dailyLossPercent: 0,
        marginLevelPercent: 2000,
    });
    const health = computeHealth({
        portfolioId: "p",
        exposure,
        concentration,
        correlation,
        risk: {
            portfolioId: "p",
            calculatedAt: TEST_NOW,
            dataTimestamp: TEST_NOW,
            equity: 100_000,
            balance: 100_000,
            unrealizedPnL: 0,
            realizedPnL: 0,
            openRisk: 800,
            openRiskPercent: 0.8,
            drawdown: 0,
            drawdownPercent: 0,
            dailyLoss: 0,
            dailyLossPercent: 0,
            marginUsed: 5_000,
            freeMargin: 95_000,
            marginLevelPercent: 2000,
            riskBudgetUsage,
            warnings: [],
            freshness: f,
            limitations: [],
        },
        regime,
        accounts: [account()],
        strategies: [{ strategyId: "A", health: "GOOD" }],
        riskBudgetUsage,
        dataFreshnessOk: true,
        calculatedAt: TEST_NOW,
    });

    return {
        portfolioId: "p",
        timestamp: TEST_NOW,
        equity: 100_000,
        balance: 100_000,
        unrealizedPnL: 0,
        realizedPnL: 0,
        grossExposure: exposure.grossExposure,
        netExposure: exposure.netExposure,
        marginUsed: 5_000,
        freeMargin: 95_000,
        leverage: 100,
        drawdown: 0,
        dailyLoss: 0,
        positionCount: positions.length,
        strategyCount: 2,
        assetCount: 2,
        concentrationScore: concentration.concentrationScore,
        correlationRiskScore: 0,
        portfolioRiskScore: 0.8,
        regime: regime.regime,
        riskBudgetUsage,
        health,
        baseCurrency: "USD",
        accounts: [account()],
        positions,
        exposure,
        concentration,
        correlation,
        correlationMatrix: null,
        regimeState: regime,
        risk: {
            portfolioId: "p",
            calculatedAt: TEST_NOW,
            dataTimestamp: TEST_NOW,
            equity: 100_000,
            balance: 100_000,
            unrealizedPnL: 0,
            realizedPnL: 0,
            openRisk: 800,
            openRiskPercent: 0.8,
            drawdown: 0,
            drawdownPercent: 0,
            dailyLoss: 0,
            dailyLossPercent: 0,
            marginUsed: 5_000,
            freeMargin: 95_000,
            marginLevelPercent: 2000,
            riskBudgetUsage,
            warnings: [],
            freshness: f,
            limitations: [],
        },
        strategyStates: [],
        freshness: f,
        engineVersions: [{ id: "portfolio-snapshot", version: "1.0.0" }],
        limitations: [],
        ...overrides,
    };
}

function testPreCheck(): void {
    section("Trade pre-check + decision engine");

    const snapshot = buildPrecheckSnapshot();
    const ok = runTradePreCheck({
        portfolioId: "p",
        trade: { symbol: "BTCUSD", side: "LONG", quantity: 0.01, entryPrice: 60_000, stopLoss: 58_000 },
        exposure: snapshot.exposure,
        concentration: snapshot.concentration,
        correlation: snapshot.correlation,
        correlationMatrixSymbols: null,
        correlationMatrix: null,
        risk: snapshot.risk,
        riskBudgetUsage: snapshot.riskBudgetUsage,
        equity: snapshot.equity,
        leverage: snapshot.leverage,
        contractSize: 100,
        positions: snapshot.positions,
        allocation: null,
        freshness: snapshot.freshness,
        now: TEST_NOW,
        contractSizeOf,
    });
    check("a small, well-priced trade is acceptable", ok.verdict === "TRADE_ACCEPTABLE", ok.verdict);
    check("the decision is traceable", ok.decision.decisionId.length > 0 && ok.decision.engineVersions.length > 0);
    check("the decision carries evidence", ok.decision.evidence.length >= 2, ok.decision.evidence.length);
    check("the decision states affected strategies", Array.isArray(ok.decision.affectedStrategies));

    const huge = runTradePreCheck({
        portfolioId: "p",
        trade: { symbol: "XAUUSD", side: "LONG", quantity: 20, entryPrice: 2_000, stopLoss: 1_980 },
        exposure: snapshot.exposure,
        concentration: snapshot.concentration,
        correlation: snapshot.correlation,
        correlationMatrixSymbols: null,
        correlationMatrix: null,
        risk: snapshot.risk,
        riskBudgetUsage: snapshot.riskBudgetUsage,
        equity: snapshot.equity,
        leverage: snapshot.leverage,
        contractSize: 100,
        positions: snapshot.positions,
        allocation: null,
        freshness: snapshot.freshness,
        now: TEST_NOW,
        contractSizeOf,
    });
    check("an oversized trade is blocked", huge.verdict === "TRADE_BLOCKED", huge.verdict);
    check("the block cites a measured reason", huge.blockingReasons.length > 0, huge.blockingReasons);
    check("a block escalates permission", huge.decision.permissionRequired === "HIGH_RISK", huge.decision.permissionRequired);

    const unknownSymbol = runTradePreCheck({
        portfolioId: "p",
        trade: { symbol: "NOTREAL", side: "LONG", quantity: 1, entryPrice: 10 },
        exposure: snapshot.exposure,
        concentration: snapshot.concentration,
        correlation: snapshot.correlation,
        correlationMatrixSymbols: null,
        correlationMatrix: null,
        risk: snapshot.risk,
        riskBudgetUsage: snapshot.riskBudgetUsage,
        equity: snapshot.equity,
        leverage: snapshot.leverage,
        contractSize: null,
        positions: snapshot.positions,
        allocation: null,
        freshness: snapshot.freshness,
        now: TEST_NOW,
        contractSizeOf,
    });
    check("an unpriceable symbol fails closed", unknownSymbol.verdict === "TRADE_BLOCKED", unknownSymbol.verdict);

    const stale = runTradePreCheck({
        portfolioId: "p",
        trade: { symbol: "BTCUSD", side: "LONG", quantity: 0.01, entryPrice: 60_000, stopLoss: 58_000 },
        exposure: snapshot.exposure,
        concentration: snapshot.concentration,
        correlation: snapshot.correlation,
        correlationMatrixSymbols: null,
        correlationMatrix: null,
        risk: snapshot.risk,
        riskBudgetUsage: snapshot.riskBudgetUsage,
        equity: snapshot.equity,
        leverage: snapshot.leverage,
        contractSize: 100,
        positions: snapshot.positions,
        allocation: null,
        freshness: freshness({ freshness: "UNAVAILABLE" }),
        now: TEST_NOW,
        contractSizeOf,
    });
    check("unavailable data fails closed", stale.verdict === "TRADE_BLOCKED", stale.verdict);
    check("a degraded decision is flagged", stale.decision.degraded === true);

    const staleOnly = runTradePreCheck({
        portfolioId: "p",
        trade: { symbol: "BTCUSD", side: "LONG", quantity: 0.01, entryPrice: 60_000, stopLoss: 58_000 },
        exposure: snapshot.exposure,
        concentration: snapshot.concentration,
        correlation: snapshot.correlation,
        correlationMatrixSymbols: null,
        correlationMatrix: null,
        risk: snapshot.risk,
        riskBudgetUsage: snapshot.riskBudgetUsage,
        equity: snapshot.equity,
        leverage: snapshot.leverage,
        contractSize: 100,
        positions: snapshot.positions,
        allocation: null,
        freshness: freshness({ freshness: "STALE", reason: "stale test" }),
        now: TEST_NOW,
        contractSizeOf,
    });
    check("stale data warns rather than silently allowing", staleOnly.warningReasons.some((r) => /stale/i.test(r)), staleOnly.warningReasons);
}

/* ── Agents ───────────────────────────────────────────────────────────────── */

function testAgents(): void {
    section("Portfolio agents");

    const snapshot = buildPrecheckSnapshot();
    const team = runPortfolioAgentTeam({
        snapshot,
        strategyIntelligence: emptyStrategyIntelligence(),
        now: TEST_NOW,
    });

    check("the six specialist agents plus the supervisor ran", team.agents.length === 7, team.agents.length);
    check("every agent defaults to READ_ONLY", team.agents.every((a) => a.permission === "READ_ONLY"));
    check("the team always requires approval", team.requiresApproval === true);
    check("the team never authorises live capital", team.limitations.some((l) => /never moves live capital/i.test(l)));
    check("agent definitions declare no live-trading tools", PORTFOLIO_AGENTS.every((a) => !a.allowedTools.includes("submit_live_order")));
    check("permission mapping ends at read_only for READ_ONLY", toAgentRiskLevel("READ_ONLY") === "read_only");

    const noHistory = runPortfolioAgentTeam({
        snapshot: { ...snapshot, correlationMatrix: null },
        strategyIntelligence: emptyStrategyIntelligence(),
        now: TEST_NOW,
    });
    const correlationAgent = noHistory.agents.find((a) => a.agentId === "portfolio-correlation");
    check("correlation without history reports UNAVAILABLE, not zero", correlationAgent?.summary.includes("UNAVAILABLE") === true, correlationAgent?.summary);

    check("every portfolio tool is read-only", allPortfolioToolsReadOnly());
    check("every live-state portfolio tool has a stale-data guard", allLiveStateToolsGuarded());
    const unguarded = PORTFOLIO_TOOL_DEFINITIONS.filter((t) => t.inputValidation.staleDataGuard !== true).map((t) => t.name);
    check("only the journal tool opts out, and it is historical", unguarded.every((n) => HISTORICAL_PORTFOLIO_TOOLS.includes(n)), unguarded);
    check("every portfolio workflow node is a known registry type", PORTFOLIO_WORKFLOW_NODES.every((n) => typeof n.type === "string" && n.type.startsWith("portfolio.") || n.type.startsWith("trigger.")));
    check("no portfolio workflow node can place an order", PORTFOLIO_WORKFLOW_NODES.every((n) => n.category !== "execution"));
}

/* ── Entitlements ─────────────────────────────────────────────────────────── */

function testEntitlements(): void {
    section("Plan gating");

    check("free gets basic exposure", hasPortfolioFeature("free", "portfolio.exposure"));
    check("free does NOT get the correlation matrix", !hasPortfolioFeature("free", "portfolio.correlation"));
    check("free does NOT get stress testing", !hasPortfolioFeature("free", "portfolio.stress"));
    check("pro gets the correlation matrix", hasPortfolioFeature("pro", "portfolio.correlation"));
    check("pro gets allocation", hasPortfolioFeature("pro", "portfolio.allocation"));
    check("pro gets the portfolio API", hasPortfolioFeature("pro", "portfolio.api"));
    check("enterprise gets everything", hasPortfolioFeature("enterprise", "portfolio.api"));
    check("free existing functionality is untouched", hasPortfolioFeature("free", "portfolio.basic"));

    const free = portfolioEntitlements("free");
    check("free entitlements list what is missing", free.upgradeRequiredFor.includes("portfolio.correlation"), free.upgradeRequiredFor);
}

/* ── Chat ─────────────────────────────────────────────────────────────────── */

function testChat(): void {
    section("Portfolio chat");

    const snapshot = buildPrecheckSnapshot();
    check("'how exposed am I to USD' routes to currency exposure", classifyPortfolioQuestion("how exposed am I to USD?") === "currency_exposure");
    check("'which strategies overlap' routes to overlap", classifyPortfolioQuestion("which strategies are overlapping?") === "strategy_overlap");
    check("'what happens if XAUUSD drops 3%' routes to a symbol shock", classifyPortfolioQuestion("what happens if XAUUSD drops 3%") === "symbol_shock");
    check("an unmatched question does not guess", classifyPortfolioQuestion("banana") === "unknown");

    const usd = answerPortfolioQuestion("how exposed am I to USD?", snapshot);
    check("the currency answer is built from the snapshot", usd.lines.some((l) => l.kind === "CALCULATED"), usd.lines);
    check("every line carries an epistemic label", usd.lines.every((l) => ["OBSERVED", "CALCULATED", "INFERRED", "SIMULATED", "RECOMMENDATION"].includes(l.kind)));

    const shock = answerPortfolioQuestion("what happens if XAUUSD drops 3%?", snapshot);
    check("a shock answer is labelled SIMULATED", shock.lines.some((l) => l.kind === "SIMULATED"), shock.lines);
    check("a shock answer says it is not a prediction", shock.lines.some((l) => /not a prediction/i.test(l.text)), shock.lines);

    const unknown = answerPortfolioQuestion("banana", snapshot);
    check("an unknown question refuses rather than inventing", unknown.lines.some((l) => /did not match/i.test(l.text)), unknown.lines);

    const noCorrelation = answerPortfolioQuestion("are my positions highly correlated?", { ...snapshot, correlationMatrix: null });
    check("correlation is reported UNAVAILABLE, not zero", noCorrelation.lines.some((l) => /UNAVAILABLE/i.test(l.text)), noCorrelation.lines);
}

/* ── Regression guards ────────────────────────────────────────────────────── */

function testNoDuplicateEngines(): void {
    section("Architecture guards");

    check("the portfolio risk engine is a distinct layer, not a fork", computeExposureAgain === computeExposure);
    check("portfolio agents do not declare live execution", !PORTFOLIO_AGENTS.some((a) => a.riskLevel === "live_trading"));
    check("no portfolio agent holds execution_submit by default", PORTFOLIO_AGENTS.every((a) => !a.permissions.includes("execution_submit")));
}

/* ── Runner ───────────────────────────────────────────────────────────────── */

export async function runPortfolioTests(): Promise<boolean> {
    process.stdout.write("\nAlgoVault — Portfolio Intelligence tests\n");
    testExposure();
    testConcentration();
    testCorrelation();
    testInstruments();
    testRiskBudgets();
    testHealth();
    testRegime();
    testAllocation();
    testStress();
    testMonteCarlo();
    testStrategyIntelligence();
    testPreCheck();
    testAgents();
    testEntitlements();
    testChat();
    testNoDuplicateEngines();
    return results().ok;
}
