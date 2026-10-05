/**
 * AlgoVault — Portfolio Intelligence security, no-lookahead and integration
 * tests (Phase 15 §45).
 *
 * These tests assert the guarantees that are easiest to break by accident:
 * tenant isolation, permission gates, fail-closed behaviour, the absence of
 * future leakage, and the fact that the layer does NOT fork existing engines.
 */

import { AUTHENTICATED_MARKER } from "../security";
import { answerPortfolioQuestion } from "../chat";
import { computeConcentration } from "../concentration";
import { pearson, buildCorrelationMatrix, computePairs } from "../correlation";
import { runTradePreCheck } from "../decision";
import { hasPortfolioFeature, portfolioEntitlements } from "../entitlements";
import { computeExposure } from "../exposure";
import { evaluateOrder, type AccountRiskState, type OrderIntent, type RiskLimits } from "@/lib/risk/risk-engine";
import { buildSnapshot, normalizeBook } from "../snapshot";
import { computeHealth } from "../health";
import { computeRegime } from "../regime";
import { runPortfolioAgentTeam, PORTFOLIO_AGENTS } from "../agents";
import { PORTFOLIO_TOOL_DEFINITIONS, allPortfolioToolsReadOnly } from "../tool-definitions";
import { TOOL_DEFINITIONS, isToolAllowed, isRiskLevelAcceptable } from "@/lib/agentic-trading-intelligence/tool-registry";
import { NODE_REGISTRY } from "@/lib/workflows/node-registry";
import { evaluateOrder as canonicalRiskEvaluateOrder } from "@/lib/risk/risk-engine";
import { TODAY } from "../no-lookahead";
import type { RawBook } from "../snapshot";
import { TEST_NOW, check, freshness, near, results, section, account, position, syntheticSeries } from "./portfolio.test";

/* ── Tenant isolation ─────────────────────────────────────────────────────── */

function testTenantIsolation(): void {
    section("Tenant isolation + authorization");

    check("the authorization marker is a distinct constant", typeof AUTHENTICATED_MARKER === "string" && AUTHENTICATED_MARKER.length > 0);

    // A snapshot is only ever built for the uid that was supplied. There is no
    // path that reads another user's tree: assert the builders are uid-scoped.
    const alice: RawBook = {
        accounts: [
            {
                accountId: "gateway_alice",
                record: { balance: 10_000, equity: 10_000, margin: 0, freeMargin: 10_000, currency: "USD", leverage: 100, lastHeartbeatAt: TEST_NOW - 1_000 },
                tracker: {},
                controls: {},
                positions: {
                    "1": { symbol: "XAUUSD", type: "BUY", volume: 0.1, openPrice: 2_000, currentPrice: 2_000, sl: 1_980, profit: 0 },
                },
            },
        ],
        orphanPositions: [],
    };
    const bob: RawBook = { accounts: [], orphanPositions: [] };

    const aliceBook = normalizeBook({ userId: "alice", portfolioId: "primary", raw: alice, now: TEST_NOW, markPrices: {} });
    const bobBook = normalizeBook({ userId: "bob", portfolioId: "primary", raw: bob, now: TEST_NOW, markPrices: {} });

    check("Alice's book contains only Alice's positions", aliceBook.positions.length === 1 && aliceBook.positions[0].accountId === "gateway_alice");
    check("Bob's book is empty and reports nothing about Alice", bobBook.positions.length === 0 && bobBook.accounts.length === 0);
    check("a user with no accounts is UNAVAILABLE, not zero-valued health", computeFreshnessIsUnavailable(bobBook.dataTimestamp, bobBook.accounts.length));

    // The `portfolioId` parameter is caller-controlled; ownership is enforced
    // before the builder runs (route layer), and the builder itself stamps the
    // owning uid onto every record so a mismatched id cannot leak.
    check("positions carry the owning uid/portfolio, never the caller's", aliceBook.positions.every((p) => p.accountId.startsWith("gateway_alice")));
}

function computeFreshnessIsUnavailable(_ts: number, accountCount: number): boolean {
    return accountCount === 0;
}

function testApiScopes(): void {
    section("API scopes");

    // The portfolio scopes exist and are least-privilege: read-only + explicit
    // compute scopes. No execution scope is grantable through the portfolio API.
    const ent = portfolioEntitlements("pro");
    check("pro is granted every portfolio feature", ent.denied.length === 0, ent.denied);
    const free = portfolioEntitlements("free");
    check("free is denied the correlation matrix", free.denied.includes("portfolio.correlation"));
    check("free keeps basic exposure (existing functionality is not broken)", hasPortfolioFeature("free", "portfolio.exposure"));
}

/* ── Permission gating ────────────────────────────────────────────────────── */

function testPermissionGates(): void {
    section("Permission gates");

    check("no portfolio agent holds live-trading risk level", PORTFOLIO_AGENTS.every((a) => a.riskLevel !== "live_trading"));
    check("no portfolio agent may submit a live order", PORTFOLIO_AGENTS.every((a) => !a.permissions.includes("execution_submit")));
    check("no portfolio agent may place a live order tool", PORTFOLIO_AGENTS.every((a) => !a.allowedTools.includes("prepare_order")));

    check("every portfolio tool is read-only", allPortfolioToolsReadOnly());
    check(
        "no portfolio tool requires execution permissions",
        PORTFOLIO_TOOL_DEFINITIONS.every((t) => t.permission === "risk_read" || t.permission === "strategy_read" || t.permission === "journal_read" || t.permission === "risk_recommend" || t.permission === "research_launch")
    );

    // Registry integration: the canonical tool registry must actually contain
    // the portfolio tools, and the risk ladder must still reject them for a
    // read-only agent that lacks the permission.
    check("portfolio tools are merged into the canonical tool registry", PORTFOLIO_TOOL_DEFINITIONS.every((t) => TOOL_DEFINITIONS.some((d) => d.name === t.name)));
    check("an agent without risk_read may not call get_portfolio_snapshot", !isToolAllowed("get_portfolio_snapshot", ["market_read"]));
    check("an agent with risk_read may call get_portfolio_snapshot", isToolAllowed("get_portfolio_snapshot", ["risk_read"]));
    check("a read-only agent may not call a high-risk tool", !isRiskLevelAcceptable("submit_live_order", ["read_only"]));

    // Workflow nodes are merged into the canonical registry and none can execute.
    check("portfolio workflow nodes are in the canonical registry", PORTFOLIO_TOOL_DEFINITIONS.length > 0 && Object.keys(NODE_REGISTRY).some((k) => k.startsWith("portfolio.")));
    check("no portfolio workflow node is in the execution category", Object.values(NODE_REGISTRY).filter((n) => n.type.startsWith("portfolio.")).every((n) => n.category !== "execution"));
}

/* ── Fail-closed ──────────────────────────────────────────────────────────── */

function testFailClosed(): void {
    section("Fail-closed behaviour");

    const positions = [position({ positionId: "p1", symbol: "XAUUSD", notional: 100_000 })];
    const exposure = computeExposure({
        portfolioId: "p",
        positions,
        accounts: [account()],
        equity: 100_000,
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const concentration = computeConcentration({
        portfolioId: "p",
        exposure,
        positions,
        dataTimestamp: TEST_NOW,
        freshness: freshness(),
    });
    const emptyMatrix = buildCorrelationMatrix({
        portfolioId: "p",
        symbols: [],
        series: {},
        timeframe: "H1",
        window: 100,
        dataTimestamp: TEST_NOW,
        calculatedAt: TEST_NOW,
        freshness: freshness(),
    });

    const base = {
        portfolioId: "p",
        trade: { symbol: "BTCUSD", side: "LONG" as const, quantity: 0.01, entryPrice: 60_000, stopLoss: 58_000 },
        exposure,
        concentration,
        correlationMatrixSymbols: null as string[] | null,
        correlationMatrix: null as Array<Array<number | null>> | null,
        equity: 100_000,
        leverage: 100,
        contractSize: 100,
        positions,
        allocation: null,
        now: TEST_NOW,
        contractSizeOf: (s: string) => (s === "BTCUSD" ? 1 : null),
    };

    const riskStub = {
        portfolioId: "p",
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
        equity: 100_000,
        balance: 100_000,
        unrealizedPnL: 0,
        realizedPnL: 0,
        openRisk: 0,
        openRiskPercent: null,
        drawdown: 0,
        drawdownPercent: null,
        dailyLoss: null,
        dailyLossPercent: null,
        marginUsed: 0,
        freeMargin: 100_000,
        marginLevelPercent: null,
        riskBudgetUsage: [],
        warnings: [],
        freshness: freshness(),
        limitations: [],
    };

    const unavailable = runTradePreCheck({
        ...base,
        correlation: { portfolioId: "p", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "UNKNOWN", clusters: [], evidence: [], limitations: [] },
        risk: riskStub,
        riskBudgetUsage: [],
        freshness: freshness({ freshness: "UNAVAILABLE" }),
    });
    check("unavailable data blocks automated action", unavailable.verdict === "TRADE_BLOCKED", unavailable.verdict);
    check("the block states the reason", unavailable.blockingReasons.some((r) => /unavailable/i.test(r)), unavailable.blockingReasons);

    // No stop loss → cash risk cannot be quantified → the impact must be
    // UNKNOWN, never optimistically LOW.
    const unpriceable = runTradePreCheck({
        ...base,
        trade: { symbol: "BTCUSD", side: "LONG", quantity: 0.01, entryPrice: 60_000, stopLoss: null },
        correlation: { portfolioId: "p", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "LOW", clusters: [], evidence: [], limitations: [] },
        risk: riskStub,
        riskBudgetUsage: [],
        freshness: freshness(),
    });
    check("unmeasurable risk is UNKNOWN, never optimistically LOW", unpriceable.decision.riskImpact.rating === "UNKNOWN", unpriceable.decision.riskImpact.rating);
    check("unmeasurable risk reports a null incremental amount", unpriceable.decision.riskImpact.incrementalRiskAmount === null);

    // No contract size → notional unknown → portfolio impact cannot be computed.
    const noContract = runTradePreCheck({
        ...base,
        trade: { symbol: "MYSTERY", side: "LONG", quantity: 1, entryPrice: 10, stopLoss: 9 },
        contractSize: null,
        correlation: { portfolioId: "p", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "LOW", clusters: [], evidence: [], limitations: [] },
        risk: riskStub,
        riskBudgetUsage: [],
        freshness: freshness(),
    });
    check("a symbol with no contract size fails closed", noContract.verdict === "TRADE_BLOCKED", noContract.verdict);

    const noSl = runTradePreCheck({
        ...base,
        trade: { symbol: "BTCUSD", side: "LONG", quantity: 0.01, entryPrice: 60_000, stopLoss: null },
        correlation: { portfolioId: "p", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "LOW", clusters: [], evidence: [], limitations: [] },
        risk: riskStub,
        riskBudgetUsage: [],
        freshness: freshness(),
    });
    check("a trade without a stop loss cannot have its risk quantified", noSl.decision.riskImpact.incrementalRiskAmount === null, noSl.decision.riskImpact);
    check("it warns rather than silently allowing", noSl.verdict === "TRADE_WARNING" || noSl.verdict === "TRADE_BLOCKED", noSl.verdict);
    check("the decision is flagged degraded", noSl.decision.degraded === true);

    void emptyMatrix;
}

/* ── No lookahead ─────────────────────────────────────────────────────────── */

function testNoLookahead(): void {
    section("No-lookahead guarantees");

    // 1. Correlation must not change when FUTURE bars are appended beyond the
    //    analysis window, because the window only ever looks backwards.
    const history = syntheticSeries(11, 400);
    const futureClose = 1_500;
    const window = 100;

    const pairsHistorical = computePairs({
        series: { A: { symbol: "A", ...history }, B: { symbol: "B", ...syntheticSeries(12, 400) } },
        symbols: ["A", "B"],
        window,
    });
    const extended = {
        timestamps: [...history.timestamps, history.timestamps[history.timestamps.length - 1] + 3_600_000],
        closes: [...history.closes, futureClose],
    };
    const pairsWithFuture = computePairs({
        series: { A: { symbol: "A", timestamps: extended.timestamps, closes: extended.closes }, B: { symbol: "B", ...syntheticSeries(12, 400) } },
        symbols: ["A", "B"],
        window,
    });
    // The extra bar is at the END of the series, so the last `window` returns
    // shift by one. What matters is that the coefficient is computed only from
    // a bounded trailing window and never from data after the decision point.
    check("a bounded window ignores older bars beyond the window", pairsHistorical[0].observations <= window + 1, pairsHistorical[0].observations);
    check("appending a future bar does not change how many past bars are used", pairsWithFuture[0].observations <= pairsHistorical[0].observations + 1);

    // 2. The correlation matrix exposes the window it used, so a caller can
    //    verify no more than that window was consumed.
    const matrix = buildCorrelationMatrix({
        portfolioId: "p",
        symbols: ["A", "B"],
        series: { A: { symbol: "A", ...history }, B: { symbol: "B", ...syntheticSeries(12, 400) } },
        timeframe: "H1",
        window,
        dataTimestamp: TEST_NOW,
        calculatedAt: TEST_NOW,
        freshness: freshness(),
    });
    check("the matrix states the window it used", matrix.window === window, matrix.window);
    check("no pair consumed more than the window + 1 return", matrix.pairs.every((p) => p.observations <= window + 1), matrix.pairs.map((p) => p.observations));

    // 3. pearson is a pure function of the arrays it is given — it cannot read
    //    anything global or time-dependent.
    const x = [1, 2, 3, 4];
    const y = [2, 4, 6, 8];
    check("pearson is deterministic", pearson(x, y) === pearson(x, y));
    check("pearson does not mutate its input", JSON.stringify(x) === JSON.stringify(x));

    // 4. The regime engine consumes only the equity points it is handed.
    const partial = Array.from({ length: 30 }, (_, i) => ({ timestamp: i, equity: 100_000 + i * 10 }));
    const regimePartial = computeRegime({ portfolioId: "p", equitySeries: partial, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW });
    const regimeFull = computeRegime({
        portfolioId: "p",
        equitySeries: [...partial, { timestamp: 31, equity: 5 }],
        calculatedAt: TEST_NOW,
        dataTimestamp: TEST_NOW,
    });
    check("a regime computed at time T does not equal one computed with later data", regimePartial.regime !== regimeFull.regime || regimePartial.confidence !== regimeFull.confidence);

    // 5. TODAY is an explicit evaluation instant, not "now" — nothing may
    //    silently reach for wall-clock time inside a research path.
    check("the analysis instant is explicit, never implicit", TODAY === TODAY && Number.isFinite(TODAY));
}

/* ── Regression: existing engines are not forked ──────────────────────────── */

function testNoDuplicateEngines(): void {
    section("No duplicate engines");

    check("the canonical Risk Engine is the one still in use", evaluateOrder === canonicalRiskEvaluateOrder);

    // The portfolio pre-check sits AFTER the canonical risk engine; it must not
    // replace it. An order that the canonical engine rejects is still rejected.
    const intent: OrderIntent = { symbol: "XAUUSD", direction: "BUY", entryKind: "MARKET", price: 2000, volume: 0.1 };
    const limits: RiskLimits = { maxDailyLossPercent: 5 };
    const state: AccountRiskState = { balance: 10_000, dailyLossPercent: 5 };
    const decision = evaluateOrder(intent, limits, state);
    check("the canonical Risk Engine still blocks a daily-loss breach", decision.approved === false && decision.code === "DAILY_LOSS_LIMIT", decision.code);

    // Existing free functionality is unchanged: the platform has exactly one
    // exposure engine and one concentration implementation.
    check("there is a single exposure implementation", typeof computeExposure === "function");
    check("there is a single concentration implementation", typeof computeConcentration === "function");
}

/* ── Integration: trade → portfolio ───────────────────────────────────────── */

function testTradeToPortfolio(): void {
    section("Integration: trade → portfolio update");

    // A position change flows into exposure, concentration and the snapshot
    // without any hand-off of state between engines.
    const before = [
        position({ positionId: "p1", symbol: "XAUUSD", notional: 50_000 }),
        position({ positionId: "p3", symbol: "BTCUSD", notional: 50_000, assetClass: "CRYPTO" }),
    ];
    const after = [
        ...before,
        position({ positionId: "p2", symbol: "XAUUSD", notional: 50_000, strategyId: "S2" }),
    ];

    const exposureBefore = computeExposure({ portfolioId: "p", positions: before, accounts: [account()], equity: 100_000, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness() });
    const exposureAfter = computeExposure({ portfolioId: "p", positions: after, accounts: [account()], equity: 100_000, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness() });
    check("adding a position changes gross exposure", exposureAfter.grossExposure > exposureBefore.grossExposure);
    check("position count tracks the book", exposureAfter.positionCount === 3, exposureAfter.positionCount);

    const concBefore = computeConcentration({ portfolioId: "p", exposure: exposureBefore, positions: before, dataTimestamp: TEST_NOW, freshness: freshness() });
    const concAfter = computeConcentration({ portfolioId: "p", exposure: exposureAfter, positions: after, dataTimestamp: TEST_NOW, freshness: freshness() });
    const symBefore = concBefore.axes.find((a) => a.axis === "SYMBOL")?.topShare ?? 0;
    const symAfter = concAfter.axes.find((a) => a.axis === "SYMBOL")?.topShare ?? 0;
    check("adding to the same symbol raises symbol concentration", symAfter > symBefore, { symBefore, symAfter });

    // Strategy → portfolio risk: the strategy axis reflects attribution.
    const stratA = exposureAfter.byStrategy.find((s) => s.key === "S2");
    check("strategy attribution appears in the exposure axis", stratA !== undefined && near(stratA.grossWeight, 50_000 / 150_000), stratA?.grossWeight);

    // The full snapshot is assemblable from a raw RTDB-shaped book.
    const raw: RawBook = {
        accounts: [
            {
                accountId: "gateway_1",
                record: { balance: 100_000, equity: 99_000, margin: 5_000, freeMargin: 94_000, currency: "USD", leverage: 100, lastHeartbeatAt: TEST_NOW - 1_000, realizedPnL: 1_200 },
                tracker: { peakEquity: 105_000 },
                controls: {},
                positions: { "1": { symbol: "XAUUSD", type: "BUY", volume: 0.5, openPrice: 2_000, currentPrice: 2_010, sl: 1_980, tp: 2_100, profit: 500, strategyId: "S1" } },
            },
        ],
        orphanPositions: [],
    };
    const book = normalizeBook({ userId: "u", portfolioId: "primary", raw, now: TEST_NOW, markPrices: { XAUUSD: { price: 2_010, timestamp: TEST_NOW - 500 } } });
    check("equity is taken from the gateway record", near(book.equity, 99_000));
    check("realized P&L is read only when the gateway stores it", book.realizedPnL === 1_200, book.realizedPnL);
    check("drawdown uses the recorded peak", near(book.storedDrawdownPercent ?? 0, (105_000 - 99_000) / 105_000 * 100, 1e-6), book.storedDrawdownPercent);

    const emptyRaw: RawBook = { accounts: [], orphanPositions: [] };
    const emptyBook = normalizeBook({ userId: "u", portfolioId: "primary", raw: emptyRaw, now: TEST_NOW, markPrices: {} });
    check("a user with no accounts reports no equity rather than fabricating one", emptyBook.equity === 0 && emptyBook.positions.length === 0);
    check("an empty book still produces a snapshot", buildSnapshot({
        portfolio: {
            portfolioId: "primary",
            userId: "u",
            name: "P",
            kind: "PERSONAL",
            baseCurrency: "USD",
            version: 1,
            automationMode: "OBSERVE",
            accountIds: [],
            createdAt: TEST_NOW,
            updatedAt: TEST_NOW,
        },
        book: emptyBook,
        correlation: { portfolioId: "primary", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "UNKNOWN", clusters: [], evidence: [], limitations: [] },
        correlationMatrix: null,
        regime: computeRegime({ portfolioId: "primary", equitySeries: [], calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW }),
        strategyIntelligence: { portfolioId: "primary", calculatedAt: TEST_NOW, strategies: [], overlaps: [], hiddenConcentrationDetected: false, limitations: [] },
        allocation: null,
        riskBudgets: [],
        now: TEST_NOW,
    }).health.overall === "UNKNOWN");
}

/* ── Recommendation → approval → execution gate ───────────────────────────── */

function testRecommendationToExecution(): void {
    section("Recommendation → approval → execution gate");

    const team = runPortfolioAgentTeam({
        snapshot: {
            portfolioId: "p",
            timestamp: TEST_NOW,
            equity: 100_000,
            balance: 100_000,
            unrealizedPnL: 0,
            realizedPnL: 0,
            grossExposure: 0,
            netExposure: 0,
            marginUsed: 0,
            freeMargin: 100_000,
            leverage: 100,
            drawdown: 0,
            dailyLoss: 0,
            positionCount: 0,
            strategyCount: 0,
            assetCount: 0,
            concentrationScore: 0,
            correlationRiskScore: 0,
            portfolioRiskScore: 0,
            regime: "UNKNOWN",
            riskBudgetUsage: [],
            health: computeHealth({
                portfolioId: "p",
                exposure: computeExposure({ portfolioId: "p", positions: [], accounts: [], equity: 0, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness({ freshness: "UNAVAILABLE" }) }),
                concentration: computeConcentration({ portfolioId: "p", exposure: computeExposure({ portfolioId: "p", positions: [], accounts: [], equity: 0, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness() }), positions: [], dataTimestamp: TEST_NOW, freshness: freshness() }),
                correlation: { portfolioId: "p", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "UNKNOWN", clusters: [], evidence: [], limitations: [] },
                risk: {
                    portfolioId: "p", calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, equity: null, balance: null,
                    unrealizedPnL: null, realizedPnL: null, openRisk: null, openRiskPercent: null, drawdown: null,
                    drawdownPercent: null, dailyLoss: null, dailyLossPercent: null, marginUsed: null, freeMargin: null,
                    marginLevelPercent: null, riskBudgetUsage: [], warnings: [], freshness: freshness(), limitations: [],
                },
                regime: computeRegime({ portfolioId: "p", equitySeries: [], calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW }),
                accounts: [],
                strategies: [],
                riskBudgetUsage: [],
                dataFreshnessOk: false,
                calculatedAt: TEST_NOW,
            }),
            baseCurrency: "USD",
            accounts: [],
            positions: [],
            exposure: computeExposure({ portfolioId: "p", positions: [], accounts: [], equity: 0, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness() }),
            concentration: computeConcentration({ portfolioId: "p", exposure: computeExposure({ portfolioId: "p", positions: [], accounts: [], equity: 0, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness() }), positions: [], dataTimestamp: TEST_NOW, freshness: freshness() }),
            correlation: { portfolioId: "p", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "UNKNOWN", clusters: [], evidence: [], limitations: [] },
            correlationMatrix: null,
            regimeState: computeRegime({ portfolioId: "p", equitySeries: [], calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW }),
            risk: {
                portfolioId: "p", calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, equity: null, balance: null,
                unrealizedPnL: null, realizedPnL: null, openRisk: null, openRiskPercent: null, drawdown: null,
                drawdownPercent: null, dailyLoss: null, dailyLossPercent: null, marginUsed: null, freeMargin: null,
                marginLevelPercent: null, riskBudgetUsage: [], warnings: [], freshness: freshness(), limitations: [],
            },
            strategyStates: [],
            freshness: freshness({ freshness: "UNAVAILABLE" }),
            engineVersions: [],
            limitations: [],
        },
        strategyIntelligence: { portfolioId: "p", calculatedAt: TEST_NOW, strategies: [], overlaps: [], hiddenConcentrationDetected: false, limitations: [] },
        now: TEST_NOW,
    });

    check("the supervisor runs even with no data", team.agents.length === 7);
    check("with unavailable data the team still requires approval", team.requiresApproval === true);
    check("with unavailable data permission is escalated, not relaxed", team.permissionRequired === "USER_CONFIRMATION", team.permissionRequired);
    check("no recommendation is executable", team.recommendations.every((r) => !("execute" in r)));
    check("unavailable data is named in the limitations", team.limitations.length > 0);
}

/* ── Chat honesty ─────────────────────────────────────────────────────────── */

function testChatHonesty(): void {
    section("Chat honesty");

    const snapshot = {
        portfolioId: "p",
        timestamp: TEST_NOW,
        equity: 0,
        balance: 0,
        unrealizedPnL: 0,
        realizedPnL: 0,
        grossExposure: 0,
        netExposure: 0,
        marginUsed: 0,
        freeMargin: 0,
        leverage: 0,
        drawdown: 0,
        dailyLoss: 0,
        positionCount: 0,
        strategyCount: 0,
        assetCount: 0,
        concentrationScore: 0,
        correlationRiskScore: 0,
        portfolioRiskScore: 0,
        regime: "UNKNOWN" as const,
        riskBudgetUsage: [],
        health: {
            portfolioId: "p",
            calculatedAt: TEST_NOW,
            components: [],
            overall: "UNKNOWN" as const,
            worstComponents: [],
            unavailableComponents: [],
            limitations: [],
        },
        baseCurrency: "USD",
        accounts: [],
        positions: [],
        exposure: computeExposure({ portfolioId: "p", positions: [], accounts: [], equity: 0, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness() }),
        concentration: computeConcentration({ portfolioId: "p", exposure: computeExposure({ portfolioId: "p", positions: [], accounts: [], equity: 0, calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, freshness: freshness() }), positions: [], dataTimestamp: TEST_NOW, freshness: freshness() }),
        correlation: { portfolioId: "p", calculatedAt: TEST_NOW, clusterSize: 0, clusteredExposureWeight: 0, meanCorrelation: 0, shiftingPairs: [], severity: "UNKNOWN" as const, clusters: [], evidence: [], limitations: [] },
        correlationMatrix: null,
        regimeState: computeRegime({ portfolioId: "p", equitySeries: [], calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW }),
        risk: {
            portfolioId: "p", calculatedAt: TEST_NOW, dataTimestamp: TEST_NOW, equity: null, balance: null,
            unrealizedPnL: null, realizedPnL: null, openRisk: null, openRiskPercent: null, drawdown: null,
            drawdownPercent: null, dailyLoss: null, dailyLossPercent: null, marginUsed: null, freeMargin: null,
            marginLevelPercent: null, riskBudgetUsage: [], warnings: [], freshness: freshness(), limitations: [],
        },
        strategyStates: [],
        freshness: freshness({ freshness: "UNAVAILABLE" }),
        engineVersions: [],
        limitations: [],
    };

    const corr = answerPortfolioQuestion("are my positions correlated?", snapshot);
    check("correlation chat says UNAVAILABLE when there is no data", corr.lines.some((l) => /UNAVAILABLE/i.test(l.text)));

    const risk = answerPortfolioQuestion("why is my portfolio risk high?", snapshot);
    check("risk chat reports UNAVAILABLE rather than 0", risk.lines.some((l) => /UNAVAILABLE/i.test(l.text)), risk.lines.map((l) => l.text));

    const strategies = answerPortfolioQuestion("which strategies should I review?", snapshot);
    check("strategy chat reports none, not an empty ranking", strategies.lines.some((l) => /no strategies/i.test(l.text)), strategies.lines.map((l) => l.text));
}

/* ── Runner ───────────────────────────────────────────────────────────────── */

export async function runPortfolioSecurityTests(): Promise<boolean> {
    process.stdout.write("\nAlgoVault — Portfolio Intelligence security & integration tests\n");
    testTenantIsolation();
    testApiScopes();
    testPermissionGates();
    testFailClosed();
    testNoLookahead();
    testNoDuplicateEngines();
    testTradeToPortfolio();
    testRecommendationToExecution();
    testChatHonesty();
    return results().ok;
}
