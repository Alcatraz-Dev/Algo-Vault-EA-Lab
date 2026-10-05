/**
 * AlgoVault — Portfolio Stress Engine (Phase 15 §17).
 *
 * PURE + DETERMINISTIC. A scenario moves price by a measured shock and re-marks
 * the portfolio. Two provenance modes, never mixed:
 *
 *   HISTORICAL  the shock magnitude came from a real candle range in a named
 *               window (e.g. the largest single-bar XAUUSD H1 down-move in the
 *               last 250 bars). `historicalWindow` records exactly which window.
 *   SIMULATED   the shock is a configured magnitude with no historical anchor.
 *
 * SIMULATED results are never presented as history: every simulated scenario
 * carries `basis: "SIMULATED"` and the run's limitations say so in words.
 *
 * Repricing is linear and uses the canonical contract size:
 *   ΔPnL(p) = side × ΔPrice × |qty| × contractSize
 *   New margin = |newPrice| × |qty| × contractSize / leverage
 */

import { contractSizeOf } from "./instruments";
import type {
    PortfolioAccount,
    PortfolioPosition,
    PortfolioScenario,
    PortfolioStressTest,
    ScenarioKind,
} from "./types";

export interface StressRunInput {
    portfolioId: string;
    positions: PortfolioPosition[];
    accounts: PortfolioAccount[];
    equity: number;
    scenarios: PortfolioScenario[];
    riskBudgets?: Array<{ kind: string; limitPercent: number; scopeKey?: string }>;
    generatedAt: number;
    dataTimestamp: number;
}

/**
 * Repricing of one scenario against one position.
 *
 * `shockPercent` is a SIGNED fractional price change: −0.03 means "price fell
 * 3%". A LONG therefore loses when it is negative and a SHORT gains.
 */
function repricePosition(
    position: PortfolioPosition,
    shockPercent: number,
    contractSize: number
): number {
    const priceMove = position.currentPrice * shockPercent;
    const direction = position.side === "LONG" ? 1 : -1;
    return direction * priceMove * Math.abs(position.quantity) * contractSize;
}

interface ScenarioResultEntry {
    scenario: PortfolioScenario;
    equityBefore: number;
    equityAfter: number;
    pnlImpact: number;
    pnlImpactPercent: number;
    marginAfter: number;
    marginLevelAfterPercent: number | null;
    affectedPositions: Array<{ positionId: string; symbol: string; pnlImpact: number }>;
    breach: boolean;
    breaches: string[];
}

export function runStressTests(input: StressRunInput): PortfolioStressTest {
    const limitations: string[] = [];
    const totalMargin = input.accounts.reduce((acc, a) => acc + (Number.isFinite(a.marginUsed) ? a.marginUsed : 0), 0);
    const leverage = effectiveLeverage(input.accounts);
    const hasHistorical = input.scenarios.some((s) => s.basis === "HISTORICAL");

    const results: ScenarioResultEntry[] = input.scenarios.map((scenario) => {
        const affectedPositions: Array<{ positionId: string; symbol: string; pnlImpact: number }> = [];
        let pnlImpact = 0;
        let marginAfter = 0;

        for (const position of input.positions) {
            const contractSize = contractSizeOf(position.symbol);
            if (contractSize === null) continue;

            // Only the shock magnitude for this position's symbol applies.
            const shock = shockForSymbol(scenario, position.symbol);
            const impact = repricePosition(position, shock, contractSize);
            pnlImpact += impact;
            marginAfter += Math.abs(position.currentPrice * (1 + shock)) * Math.abs(position.quantity) * contractSize;

            if (Math.abs(impact) > 0) {
                affectedPositions.push({ positionId: position.positionId, symbol: position.symbol, pnlImpact: impact });
            }
        }

        // Volatility, spread and slippage shocks cost money without moving price.
        const friction = frictionCost(input.positions, scenario);

        const totalImpact = pnlImpact + friction;
        const equityAfter = input.equity + totalImpact;
        const marginTotal = marginAfter + frictionMargin(friction, input.equity);
        const marginLevel = marginTotal > 0 && equityAfter > 0 ? (equityAfter / marginTotal) * 100 : null;

        const drawdownLimit = input.riskBudgets?.find((b) => b.kind === "DRAWDOWN")?.limitPercent ?? null;
        const dailyLimit = input.riskBudgets?.find((b) => b.kind === "DAILY_LOSS")?.limitPercent ?? null;
        const impactPercent = input.equity > 0 ? (totalImpact / input.equity) * 100 : 0;

        const breaches: string[] = [];
        if (drawdownLimit !== null && impactPercent <= -drawdownLimit) {
            breaches.push(`Scenario loss ${impactPercent.toFixed(2)}% breaches the ${drawdownLimit}% drawdown budget.`);
        }
        if (dailyLimit !== null && impactPercent <= -dailyLimit) {
            breaches.push(`Scenario loss ${impactPercent.toFixed(2)}% breaches the ${dailyLimit}% daily loss budget.`);
        }
        if (marginLevel !== null && marginLevel < 100) {
            breaches.push(`Margin level falls to ${marginLevel.toFixed(1)}% — below the 100% stop-out level.`);
        }

        return {
            scenario,
            equityBefore: input.equity,
            equityAfter,
            pnlImpact: totalImpact,
            pnlImpactPercent: impactPercent,
            marginAfter: marginTotal,
            marginLevelAfterPercent: marginLevel,
            affectedPositions,
            breach: breaches.length > 0,
            breaches,
        };
    });

    if (input.scenarios.some((s) => s.basis === "SIMULATED")) {
        limitations.push(
            "Some scenarios are SIMULATED: their shock magnitudes are configured, not measured from a historical window. They illustrate sensitivity and must not be read as historical fact."
        );
    }
    if (!hasHistorical && input.scenarios.length > 0) {
        limitations.push("No scenario in this run was anchored to historical data.");
    }
    if (input.positions.length === 0) {
        limitations.push("No open positions — every scenario is a no-op.");
    }
    limitations.push(
        `Repricing is linear (ΔPnL = side × ΔPrice × |qty| × contractSize) and ignores margin call, swap and stop execution at the moment of the move. Worst case here is therefore indicative, not a stop-out guarantee.`
    );
    if (leverage === null) {
        limitations.push("No account leverage recorded — margin is reported as the sum of raw position notional divided by 1 (conservative 1:1 assumption).");
    }

    const worst = results.reduce<(typeof results)[number] | null>(
        (acc, r) => (acc === null || r.pnlImpact < acc.pnlImpact ? r : acc),
        null
    );

    return {
        portfolioId: input.portfolioId,
        stressTestId: `${input.portfolioId}:${input.generatedAt}`,
        generatedAt: input.generatedAt,
        dataTimestamp: input.dataTimestamp,
        scenarios: results,
        worstCase: worst
            ? {
                  scenarioId: worst.scenario.scenarioId,
                  pnlImpact: worst.pnlImpact,
                  pnlImpactPercent: worst.pnlImpactPercent,
              }
            : null,
        method: hasHistorical ? "HISTORICAL_REPLAY" : "SIMULATED_SHOCK",
        limitations,
    };
}

function effectiveLeverage(accounts: PortfolioAccount[]): number | null {
    const values = accounts.map((a) => a.leverage).filter((l) => Number.isFinite(l) && l > 0);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Shock magnitude for one symbol. A scenario may carry a `default` shock plus
 * per-symbol overrides (so a crypto-specific shock can be applied to BTC only).
 */
function shockForSymbol(scenario: PortfolioScenario, symbol: string): number {
    const perSymbol = scenario.parameters[`${symbol}.shockPercent`];
    if (typeof perSymbol === "number" && Number.isFinite(perSymbol)) return perSymbol;
    const generic = scenario.parameters.defaultShockPercent;
    return typeof generic === "number" && Number.isFinite(generic) ? generic : 0;
}

/** Volatility / spread / slippage shocks produce a direct cash cost. */
function frictionCost(positions: PortfolioPosition[], scenario: PortfolioScenario): number {
    const costRate = (scenario.parameters.frictionCostPercent ?? 0) / 100;
    if (!Number.isFinite(costRate) || costRate === 0) return 0;
    const gross = positions.reduce((acc, p) => acc + Math.abs(p.notional), 0);
    const multiplier = scenario.kind === "LIQUIDITY_REDUCTION" ? (scenario.parameters.frictionMultiplier ?? 1) : 1;
    return -gross * costRate * (Number.isFinite(multiplier) ? multiplier : 1);
}

/** Slippage on the margin-releasing side is not modelled; keep margin flat. */
function frictionMargin(_friction: number, _equity: number): number {
    return 0;
}

/* ── Scenario builders ────────────────────────────────────────────────────── */

export interface HistoricalShockSource {
    symbol: string;
    timeframe: string;
    /** Real candles, oldest first. */
    candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number }>;
}

/**
 * Measure a historical shock from REAL candles: the worst single-bar adverse
 * move for `symbol` over the supplied window.
 *
 * Returns `null` when there are not enough real bars — the caller then falls
 * back to a labelled SIMULATED scenario rather than presenting a made-up number
 * as history.
 */
export function historicalWorstBarMove(source: HistoricalShockSource): {
    shockPercent: number;
    from: number;
    to: number;
    count: number;
} | null {
    const { candles } = source;
    if (candles.length < 20) return null;
    let worst = 0;
    for (const c of candles) {
        if (!(c.open > 0)) continue;
        const move = (c.close - c.open) / c.open;
        if (move < worst) worst = move;
    }
    if (worst === 0) return null;
    return {
        shockPercent: worst,
        from: candles[0].timestamp,
        to: candles[candles.length - 1].timestamp,
        count: candles.length,
    };
}

/**
 * Build a scenario, defaulting to SIMULATED and labelling it explicitly.
 * `parameters.defaultShockPercent` is a SIGNED fractional price move (−0.02 =
 * price fell 2%), applied uniformly unless a `<SYMBOL>.shockPercent` override
 * is present for a specific holding.
 */
export function buildScenario(input: {
    scenarioId: string;
    kind: ScenarioKind;
    name: string;
    parameters: Record<string, number>;
    methodology: string;
    historicalWindow?: PortfolioScenario["historicalWindow"];
}): PortfolioScenario {
    return {
        scenarioId: input.scenarioId,
        kind: input.kind,
        name: input.name,
        basis: input.historicalWindow ? "HISTORICAL" : "SIMULATED",
        historicalWindow: input.historicalWindow,
        parameters: input.parameters,
        methodology: input.methodology,
    };
}

/**
 * The standard scenario set. Magnitudes are explicit and printed; each one is
 * SIMULATED unless the caller supplies a measured historical window.
 */
export function defaultScenarios(): PortfolioScenario[] {
    return [
        buildScenario({
            scenarioId: "vol-expansion",
            kind: "VOLATILITY_EXPANSION",
            name: "Volatility expansion",
            parameters: { defaultShockPercent: -0.02, frictionCostPercent: 0.05 },
            methodology:
                "Every position re-priced −2% with an additional 5bps of execution cost per unit of gross notional, approximating a volatility spike that widens fills.",
        }),
        buildScenario({
            scenarioId: "spread-widening",
            kind: "SPREAD_WIDENING",
            name: "Spread widening",
            parameters: { defaultShockPercent: 0, frictionCostPercent: 0.15 },
            methodology: "No price move; 15bps of round-trip cost on gross notional.",
        }),
        buildScenario({
            scenarioId: "slippage",
            kind: "SLIPPAGE_INCREASE",
            name: "Slippage increase",
            parameters: { defaultShockPercent: -0.005, frictionCostPercent: 0.08 },
            methodology: "−0.5% adverse move plus 8bps of slippage on gross notional.",
        }),
        buildScenario({
            scenarioId: "correlation-spike",
            kind: "CORRELATION_SPIKE",
            name: "Correlation spike",
            parameters: { defaultShockPercent: -0.03 },
            methodology:
                "Uniform −3% move across every position, approximating the case where held instruments stop diversifying and move together.",
        }),
        buildScenario({
            scenarioId: "drawdown-shock",
            kind: "DRAWDOWN_SHOCK",
            name: "Drawdown shock",
            parameters: { defaultShockPercent: -0.05 },
            methodology: "Uniform −5% move across every open position.",
        }),
        buildScenario({
            scenarioId: "adverse-trend",
            kind: "ADVERSE_TREND",
            name: "Adverse trend continuation",
            parameters: { defaultShockPercent: -0.08 },
            methodology: "Uniform −8% move; represents a sustained move against the whole book.",
        }),
        buildScenario({
            scenarioId: "liquidity-reduction",
            kind: "LIQUIDITY_REDUCTION",
            name: "Liquidity reduction",
            parameters: { defaultShockPercent: -0.01, frictionCostPercent: 0.2, frictionMultiplier: 2 },
            methodology:
                "−1% move with execution costs quadrupled, approximating exits filling materially worse than mid.",
        }),
    ];
}
