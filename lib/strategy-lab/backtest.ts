import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { detectRegime } from "@/lib/analytics/market-regime";
import {
    BacktestConfig,
    BacktestDiagnostics,
    BacktestResult,
    BacktestTrade,
    DataCoverage,
    EquityPoint,
    Strategy,
} from "./types";
import { computeMetrics } from "./metrics";
import {
    buildSeriesMap,
    evaluateEntry,
    evaluateRule,
    resolveFeatureAt,
    type SeriesMap,
} from "@/lib/strategy-engine/decisions";
import { StrategyEngine, createManualOnlyStrategy } from "@/lib/strategy-engine/engine";
import { SimulationAdapter } from "@/lib/strategy-engine/adapters";
import { resetOrderIds } from "@/lib/strategy-engine/orders";
import { cashValueForMove, legCosts, resetPositionIds, simSymbolSpec, type SimPosition } from "@/lib/strategy-engine/simulation";

// ─────────────────────────────────────────────────────────────────────────────
// Backtest engine — the BACKTEST execution environment of the canonical
// Strategy Engine (Phase 4).
//
// All strategy decisions (rules, gates, stops, sizing, exits, costs) live in
// lib/strategy-engine/* and are shared verbatim with replay, paper and the
// forward/deployment signal path. This module contributes only the parts that
// are specific to running a whole historical dataset: dataset features,
// regime pre-sampling, zero-trade diagnostics, coverage and legacy result
// shaping (BacktestResult / BacktestTrade).
//
// Execution model:
//   next_bar_open  → signal evaluated at bar[i] close, entry at bar[i+1] open.
//   same_bar_close → signal evaluated at bar[i] close, entry at bar[i] close.
//
// Cost model (per leg, documented SIMULATION ASSUMPTION):
//   spreadPips        → half-spread applied to entry + half to exit.
//   commissionPerLot  → flat per unit round-trip (charged on exit).
//   slippagePips      → adverse slippage on entry + exit.
//   Gaps              → stops/targets fill at the bar open when the market
//                       opened through them (gap-aware, never optimistic).
// ─────────────────────────────────────────────────────────────────────────────

export function defaultBacktestConfig(): BacktestConfig {
    return {
        initialBalance: 10_000,
        riskMode: "percent",
        riskPercent: 1,
        fixedLot: 0.01,
        spreadPips: 20,
        commissionPerLot: 7,
        slippagePips: 1,
        dailyLossLimitPct: 5,
        maxDrawdownPct: 20,
        maxPositions: 1,
        executionModel: "next_bar_open",
        swapPerNight: 0,
        from: 0,
        to: Number.MAX_SAFE_INTEGER,
    };
}

// ──────────── Shared signal evaluator (backtest + forward parity) ────────────

export type SignalEvaluation = {
    fired: boolean;
    conditions: string[];
    regime: string;
    session: string;
    atr: number;
    trend: string;
    candleIndex: number;
};

const NO_SIGNAL_EVAL: SignalEvaluation = {
    fired: false,
    conditions: [],
    regime: "transitional",
    session: "closed",
    atr: 0,
    trend: "neutral",
    candleIndex: -1,
};

/**
 * Evaluates a strategy against the LAST closed bar on the entry timeframe
 * (or at an explicit timestamp). Used by the forward tester / deployment
 * monitor so live signals run the EXACT same decision core as the backtest,
 * replay and paper engine.
 */
export function evaluateStrategySignal(
    strategy: Strategy,
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    timestamp?: number
): SignalEvaluation {
    const seriesMap = buildSeriesMap(candlesByTF);
    const series = seriesMap[strategy.timeframes.setup];
    if (!series || series.candles.length === 0) return NO_SIGNAL_EVAL;

    let idx = series.candles.length - 1;
    if (timestamp !== undefined) {
        let lo = 0;
        let hi = series.candles.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (series.candles[mid].timestamp <= timestamp) { idx = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
    }
    if (idx < 0) return NO_SIGNAL_EVAL;

    const result = evaluateEntry({ strategy, seriesMap, index: idx });
    return {
        fired: result.fired,
        conditions: result.conditions,
        regime: result.regime,
        session: result.session,
        atr: result.atr,
        trend: result.trend,
        candleIndex: result.candleIndex,
    };
}

// ──────────── Zero-trade diagnostics ─────────────────────────────────────────

/**
 * Mirrors the main loop's gating order and counts, for every enabled
 * entry/confirmation rule, on how many bars it passes. Rules with zero passes
 * on considered bars are why a backtest can produce 0 trades — surfaced so the
 * UI can explain exactly that.
 */
function computeRuleDiagnostics(
    strategy: Strategy,
    seriesMap: SeriesMap,
    entryTF: Timeframe,
    regimeByBar: string[]
): BacktestDiagnostics {
    const primary = seriesMap[entryTF];
    const diagnostics: BacktestDiagnostics = {
        loopBars: primary?.candles.length ?? 0,
        sessionBars: 0,
        regimeBars: 0,
        rules: [],
        blockingRuleIds: [],
    };
    if (!primary) return diagnostics;

    const { candles, features } = primary;
    const enabledRules = [
        ...(strategy.entryRules ?? []).filter((r) => r.enabled),
        ...(strategy.confirmationRules ?? []).filter((r) => r.enabled),
    ];
    if (enabledRules.length === 0) return diagnostics;

    diagnostics.rules = enabledRules.map((r) => ({
        id: r.id,
        label: r.label,
        group: r.group,
        timeframe: r.timeframe ?? null,
        passes: 0,
        consideredBars: 0,
    }));

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const f = features[i];
        if ((strategy.filters?.daysOfWeek ?? []).length > 0 && !(strategy.filters?.daysOfWeek ?? []).includes(new Date(c.timestamp).getUTCDay())) continue;
        const allowedSessions = strategy.filters?.sessions ?? [];
        if (allowedSessions.length > 0 && f && (f.session === "closed" || !allowedSessions.includes(f.session))) continue;
        diagnostics.sessionBars++;
        if ((strategy.filters?.volatilityMinAtrPct ?? 0) > 0 && f && f.atrPct < (strategy.filters?.volatilityMinAtrPct ?? 0)) continue;
        if ((strategy.filters?.volatilityMaxAtrPct ?? 999) > 0 && f && f.atrPct > (strategy.filters?.volatilityMaxAtrPct ?? 999)) continue;
        if ((strategy.regimeFilter ?? []).length > 0 && f) {
            const currentRegime = regimeByBar[i] ?? "transitional";
            if (!(strategy.regimeFilter ?? []).includes(currentRegime as never)) continue;
        }
        diagnostics.regimeBars++;

        for (let ri = 0; ri < enabledRules.length; ri++) {
            const r = enabledRules[ri];
            const rf = resolveFeatureAt(seriesMap, r.timeframe, c.timestamp) ?? f;
            diagnostics.rules[ri].consideredBars++;
            if (evaluateRule(r, rf)) diagnostics.rules[ri].passes++;
        }
    }

    diagnostics.blockingRuleIds = diagnostics.rules
        .filter((r) => r.passes === 0 && r.consideredBars > 0)
        .map((r) => r.id);
    return diagnostics;
}

// ──────────── Backtest run ──────────────────────────────────────────────────

export function backtestStrategy(
    rawStrategy: Strategy,
    symbol: SupportedSymbol,
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    config: BacktestConfig,
    from: number,
    to: number,
    entryWindow?: { from: number; to: number }
): BacktestResult {
    // Normalise partial / legacy definitions so required arrays/objects exist.
    const base = createManualOnlyStrategy(symbol, rawStrategy.timeframes?.setup ?? "M15");
    const tf = Object.assign({}, base.timeframes, rawStrategy.timeframes || {}, {
        macro: rawStrategy.timeframes?.macro ?? base.timeframes.macro,
        structure: rawStrategy.timeframes?.structure ?? base.timeframes.structure,
        setup: rawStrategy.timeframes?.setup ?? base.timeframes.setup,
        entry: rawStrategy.timeframes?.entry ?? base.timeframes.entry,
    });
    const sl = Object.assign({}, base.stopLoss, rawStrategy.stopLoss || {}, {
        mode: (rawStrategy.stopLoss?.mode as Strategy["stopLoss"]["mode"]) ?? base.stopLoss.mode,
        atrMultiple: rawStrategy.stopLoss?.atrMultiple ?? base.stopLoss.atrMultiple,
        levelOffset: rawStrategy.stopLoss?.levelOffset ?? base.stopLoss.levelOffset,
        useSwing: rawStrategy.stopLoss?.useSwing ?? base.stopLoss.useSwing,
    });
    const tp = Object.assign({}, base.takeProfit, rawStrategy.takeProfit || {}, {
        mode: (rawStrategy.takeProfit?.mode as Strategy["takeProfit"]["mode"]) ?? base.takeProfit.mode,
        r1: rawStrategy.takeProfit?.r1 ?? base.takeProfit.r1,
        r2: rawStrategy.takeProfit?.r2 ?? base.takeProfit.r2,
        r3: rawStrategy.takeProfit?.r3 ?? base.takeProfit.r3,
        fixedDistance: rawStrategy.takeProfit?.fixedDistance ?? base.takeProfit.fixedDistance,
        partialCloses: rawStrategy.takeProfit?.partialCloses ?? base.takeProfit.partialCloses,
        moveBeAfterTp1: rawStrategy.takeProfit?.moveBeAfterTp1 ?? base.takeProfit.moveBeAfterTp1,
        lockAfterTp2: rawStrategy.takeProfit?.lockAfterTp2 ?? base.takeProfit.lockAfterTp2,
        trailingEnabled: rawStrategy.takeProfit?.trailingEnabled ?? base.takeProfit.trailingEnabled,
        trailingStopAtr: rawStrategy.takeProfit?.trailingStopAtr ?? base.takeProfit.trailingStopAtr,
    });
    const risk = Object.assign({}, base.risk, rawStrategy.risk || {}, {
        mode: (rawStrategy.risk?.mode as Strategy["risk"]["mode"]) ?? base.risk.mode,
        riskPercent: rawStrategy.risk?.riskPercent ?? base.risk.riskPercent,
        fixedLot: rawStrategy.risk?.fixedLot ?? base.risk.fixedLot,
        maxPositions: rawStrategy.risk?.maxPositions ?? base.risk.maxPositions,
        dailyLossLimitPct: rawStrategy.risk?.dailyLossLimitPct ?? base.risk.dailyLossLimitPct,
        maxDrawdownPct: rawStrategy.risk?.maxDrawdownPct ?? base.risk.maxDrawdownPct,
    });
    const filt = Object.assign({}, base.filters, rawStrategy.filters || {}, {
        sessions: rawStrategy.filters?.sessions ?? base.filters.sessions,
        daysOfWeek: rawStrategy.filters?.daysOfWeek ?? base.filters.daysOfWeek,
        volatilityMinAtrPct: rawStrategy.filters?.volatilityMinAtrPct ?? base.filters.volatilityMinAtrPct,
        volatilityMaxAtrPct: rawStrategy.filters?.volatilityMaxAtrPct ?? base.filters.volatilityMaxAtrPct,
        maxTradesPerDay: rawStrategy.filters?.maxTradesPerDay ?? base.filters.maxTradesPerDay,
        cooldownCandles: rawStrategy.filters?.cooldownCandles ?? base.filters.cooldownCandles,
    });
    const cst = Object.assign({}, base.costs, rawStrategy.costs || {}, {
        spreadPips: rawStrategy.costs?.spreadPips ?? base.costs.spreadPips,
        commissionPerLot: rawStrategy.costs?.commissionPerLot ?? base.costs.commissionPerLot,
        slippagePips: rawStrategy.costs?.slippagePips ?? base.costs.slippagePips,
    });
    const wp = Object.assign({}, base.whyp, rawStrategy.whyp || {}, {
        discovered: rawStrategy.whyp?.discovered ?? base.whyp.discovered,
        conditionsSelected: rawStrategy.whyp?.conditionsSelected ?? base.whyp.conditionsSelected,
        occurrenceFrequency: rawStrategy.whyp?.occurrenceFrequency ?? base.whyp.occurrenceFrequency,
        historicalPerformance: rawStrategy.whyp?.historicalPerformance ?? base.whyp.historicalPerformance,
        weaknesses: rawStrategy.whyp?.weaknesses ?? base.whyp.weaknesses,
        poorRegimes: rawStrategy.whyp?.poorRegimes ?? base.whyp.poorRegimes,
        generatedByProvider: rawStrategy.whyp?.generatedByProvider ?? base.whyp.generatedByProvider,
    });
    const s = Object.assign(
        {} as Strategy,
        base,
        rawStrategy,
        {
            id: rawStrategy.id ?? base.id,
            name: rawStrategy.name ?? base.name,
            description: rawStrategy.description ?? base.description,
            asset: rawStrategy.asset ?? base.asset,
            direction: (rawStrategy.direction as Strategy["direction"]) ?? base.direction,
            timeframes: tf,
            regimeFilter: rawStrategy.regimeFilter ?? base.regimeFilter,
            entryRules: rawStrategy.entryRules ?? base.entryRules,
            confirmationRules: rawStrategy.confirmationRules ?? base.confirmationRules,
            stopLoss: sl,
            takeProfit: tp,
            risk: risk,
            filters: filt,
            executionModel: (rawStrategy.executionModel as Strategy["executionModel"]) ?? base.executionModel,
            costs: cst,
            sourcePatternId: rawStrategy.sourcePatternId ?? base.sourcePatternId,
            whyp: wp,
            version: rawStrategy.version ?? base.version,
            created: rawStrategy.created ?? base.created,
            updated: rawStrategy.updated ?? base.updated,
        }
    );
    resetPositionIds();
    resetOrderIds();
    const strategy = s; // normalized definition

    const spec = simSymbolSpec(symbol);
    const seriesMap = buildSeriesMap(candlesByTF);

    const entryTF = strategy.timeframes.setup;
    const primary = seriesMap[entryTF];
    if (!primary) {
        return emptyResult(strategy, symbol, config, from, to);
    }
    const { candles, features } = primary;

    // Precompute regime per bar (stride-sampled on the entry timeframe) so the
    // regimeFilter matches how the live deployment labels regimes.
    const regimeByBar: string[] = new Array(candles.length).fill("transitional");
    const needRegime = (strategy.regimeFilter ?? []).length > 0;
    if (needRegime) {
        for (let i = 0; i < candles.length; i += 4) {
            try {
                const start = Math.max(0, i - 119);
                regimeByBar[i] = detectRegime(candles.slice(start, i + 1), entryTF).regime;
            } catch {
                regimeByBar[i] = "transitional";
            }
        }
        for (let i = 1; i < candles.length; i++) {
            if (i % 4 !== 0) regimeByBar[i] = regimeByBar[i - 1];
        }
    }

    const diagnostics = computeRuleDiagnostics(strategy, seriesMap, entryTF, regimeByBar);

    // ── Drive the canonical engine bar by bar ──
    const engine = new StrategyEngine({
        strategy,
        symbol,
        timeframe: entryTF,
        environment: "backtest",
        adapter: new SimulationAdapter({
            symbol,
            executionModel: strategy.executionModel,
            environment: "backtest",
            spreadPips: config.spreadPips,
            slippagePips: config.slippagePips,
            commissionPerLot: config.commissionPerLot,
            spec,
        }),
        costs: {
            spreadPips: config.spreadPips,
            slippagePips: config.slippagePips,
            commissionPerLot: config.commissionPerLot,
        },
        spec,
        regimeByBar,
        entryWindow,
        initialBalance: config.initialBalance,
    });
    const executionEnd = entryWindow
        ? candles.findIndex((candle) => candle.timestamp > entryWindow.to)
        : -1;
    const executionLength = executionEnd < 0 ? candles.length : executionEnd;
    const executionCandles = candles.slice(0, executionLength);
    engine.loadSeries(executionCandles, features.slice(0, executionLength));

    const equityPoints: EquityPoint[] = [];
    const closed: SimPosition[] = [];
    for (let i = 0; i < executionCandles.length; i++) {
        const result = engine.onCandleClose(i);
        equityPoints.push(result.equityPoint);
        closed.push(...result.closed);
    }

    const trades: BacktestTrade[] = closed
        .map((pos) => simPositionToTrade(pos, symbol, config, spec))
        .filter((trade) => !entryWindow || (trade.openedAt >= entryWindow.from && trade.openedAt <= entryWindow.to));
    const inRangeEquity = equityPoints.filter((point) => point.time >= from && point.time <= to);

    const metrics = computeMetrics(trades, inRangeEquity, config.initialBalance);
    const rangeCandles = candles.filter((candle) => candle.timestamp >= from && candle.timestamp <= to);
    if (rangeCandles.length >= 2) {
        metrics.buyHoldReturnPct = Number(((rangeCandles[rangeCandles.length - 1].close / rangeCandles[0].close - 1) * 100).toFixed(2));
    }

    const coverage = computeCoverage(candles, from, to, entryTF);

    return {
        id: `bt-${strategy.id}-${Date.now()}`,
        symbol,
        strategyId: strategy.id,
        strategyName: strategy.name,
        timeframe: entryTF,
        generatedAt: Date.now(),
        config,
        metrics,
        trades,
        equity: inRangeEquity,
        coverage,
        symbols: [symbol],
        diagnostics,
    };
}

/** Convert a canonical engine position into the legacy BacktestTrade shape. */
function simPositionToTrade(
    pos: SimPosition,
    symbol: SupportedSymbol,
    config: BacktestConfig,
    spec: ReturnType<typeof simSymbolSpec>
): BacktestTrade {
    const lastChunk = pos.chunks[pos.chunks.length - 1];
    const riskDenominator = cashValueForMove(pos.initialRisk, pos.quantity, spec);
    const profitR = riskDenominator > 0 ? pos.realizedPnL / riskDenominator : 0;

    return {
        id: `bt-${pos.id.replace(/^pos-/, "")}`,
        ticket: pos.ticket,
        openBarIndex: pos.openBarIndex,
        closeBarIndex: pos.closeBarIndex,
        openedAt: pos.openedAt,
        closedAt: pos.closedAt ?? pos.updatedAt,
        symbol,
        direction: pos.side === "LONG" ? "BUY" : "SELL",
        volume: pos.quantity,
        entry: pos.entryPrice,
        sl: Number.isFinite(pos.stopLoss) ? pos.stopLoss : pos.entryPrice,
        tp1: pos.tp1,
        tp2: pos.tp2,
        tp3: pos.tp3,
        exit: lastChunk?.price ?? pos.entryPrice,
        exitReason: lastChunk?.reason ?? "end_of_data",
        profit: pos.realizedPnL,
        profitR: Number(profitR.toFixed(3)),
        durationMs: (pos.closedAt ?? pos.updatedAt) - pos.openedAt,
        regime: pos.regime,
        session: pos.session,
        spreadCost: Number((2 * legCosts(pos.quantity, spec, { ...config, slippagePips: 0, commissionPerLot: 0 }).spread).toFixed(2)),
        commission: Number(legCosts(pos.quantity, spec, { ...config, spreadPips: 0, slippagePips: 0 }).commission.toFixed(2)),
        slippageCost: Number((2 * legCosts(pos.quantity, spec, { ...config, spreadPips: 0, commissionPerLot: 0 }).slippage).toFixed(2)),
        pnlGross: pos.realizedPnL,
    };
}

function computeCoverage(candles: MarketCandle[], from: number, to: number, timeframe: Timeframe): DataCoverage {
    const inRange = candles.filter((c) => c.timestamp >= from && c.timestamp <= to);
    const availableFrom = inRange.length > 0 ? inRange[0].timestamp : 0;
    return {
        timeframe,
        availableBars: inRange.length,
        requestedFrom: from,
        requestedTo: to,
        availableFrom,
        availableTo: inRange.length > 0 ? inRange[inRange.length - 1].timestamp : 0,
        fullyCoversRequest:
            inRange.length > 0 && availableFrom <= from && inRange[inRange.length - 1].timestamp >= to,
        spanDays: candles.length > 0 ? (candles[candles.length - 1].timestamp - candles[0].timestamp) / 86_400_000 : 0,
        source: "biquote",
        maxSourceBars: candles.length,
    };
}

function emptyResult(strategy: Strategy, symbol: SupportedSymbol, config: BacktestConfig, from: number, to: number): BacktestResult {
    return {
        id: `bt-${strategy.id}-${Date.now()}`,
        symbol,
        strategyId: strategy.id,
        strategyName: strategy.name,
        timeframe: strategy.timeframes.setup,
        generatedAt: Date.now(),
        config,
        metrics: computeMetrics([], [], config.initialBalance),
        trades: [],
        equity: [],
        coverage: {
            timeframe: strategy.timeframes.setup,
            availableBars: 0,
            requestedFrom: from,
            requestedTo: to,
            availableFrom: 0,
            availableTo: 0,
            fullyCoversRequest: false,
            spanDays: (to - from) / 86_400_000,
            source: "biquote",
            maxSourceBars: 0,
        },
        symbols: [symbol],
        diagnostics: { loopBars: 0, sessionBars: 0, regimeBars: 0, rules: [], blockingRuleIds: [] },
    };
}
