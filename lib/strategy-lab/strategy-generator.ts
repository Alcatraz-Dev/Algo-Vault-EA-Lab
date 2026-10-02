import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { AnalysisPeriod, AnalysisResult, DEFAULT_HIERARCHY, Pattern, PatternKind, Strategy, TimeframeHierarchy, TrendState } from "./types";
import { backtestStrategy, defaultBacktestConfig } from "./backtest";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { describeStrategyWithFallback } from "@/lib/ai";
import { analyzeMarket } from "./analysis";

// ─────────────────────────────────────────────────────────────────────────────
// Strategy generator.
//
// Turns a statistically-measured pattern into a structured, editable Strategy.
// All parameters (SL/TP/risk/filters/costs) are derived from real market stats;
// the AI provider only writes the narrative fields.
// ─────────────────────────────────────────────────────────────────────────────

let strategySeq = 0;

function newId(prefix: string): string {
    strategySeq++;
    return `${prefix}_${Date.now().toString(36)}_${strategySeq}`;
}

function uid(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function buildRules(
    kind: PatternKind,
    direction: "long" | "short",
    hierarchy: TimeframeHierarchy,
    trendByTf: Partial<Record<Timeframe, TrendState>> = {}
): { rules: Strategy["entryRules"]; retargets: string[] } {
    const bullish = direction === "long";
    const d = bullish ? "bullish" : "bearish";
    const notD = bullish ? "bearish" : "bullish";
    const setupTf = hierarchy.structure;
    const macroTf = hierarchy.macro;
    const loopTf = hierarchy.setup; // timeframe the backtest engine loops on
    const retargets: string[] = [];

    const rules: Strategy["entryRules"] = [];

    const add = (group: Strategy["entryRules"][number]["group"], label: string,
        value: string | number | string[], operator: Strategy["entryRules"][number]["operator"] = "eq",
        timeframe?: Timeframe, groupLogic: "AND" | "OR" = "AND") => {
        rules.push({
            id: uid(),
            enabled: true,
            group,
            label,
            operator,
            timeframe,
            value,
            negate: false,
            groupLogic,
        });
    };

    // Measured trend on a timeframe (bullish/bearish only — ranging/transition
    // are not hard contradictions for an alignment rule).
    const measuredTrend = (tf: Timeframe): "bullish" | "bearish" | null => {
        const s = trendByTf[tf];
        return s === "bullish" || s === "bearish" ? s : null;
    };

    // Hard "trade WITH the trend on TF X" rules must never contradict the trend
    // actually measured on that timeframe. The signal direction comes from the
    // short-window analysis/pattern; if the macro/structure timeframe opposes
    // it, demanding alignment there makes the strategy mathematically untradeable
    // (0 trades on every backtest). In that case pin the alignment rule to the
    // setup timeframe — where the signal was actually measured — instead.
    const addTrendAlignment = (label: string, tf: Timeframe) => {
        const m = measuredTrend(tf);
        if (m && m !== d) {
            add("trend", `${label} (measured on ${loopTf})`, d, "eq", loopTf);
            retargets.push(`"${label}" was pinned to ${loopTf}: ${tf} trend measured ${m}, opposing the ${direction} signal — an opposing-trend alignment rule could never fire.`);
            return;
        }
        add("trend", label, d, "eq", tf);
    };

    switch (kind) {
        case "liquidity_sweep_reversal": {
            add("liquidity", `Sweep of ${bullish ? "buy-side" : "sell-side"} liquidity`, d, "eq", setupTf);
            add("liquidity", `Sweep occurred within the last 3 bars`, 3, "lte", setupTf);
            add("trend", `Trend is not ${notD}`, notD, "neq", setupTf);
            add("structure", bullish ? "Bullish FVG present" : "Bearish FVG present", d, "eq", setupTf);
            break;
        }
        case "breakout_retest": {
            add("price_action", bullish ? "Break of structure high" : "Break of structure low", bullish ? "breakout_high" : "breakout_low", "eq", setupTf);
            add("trend", `Trend supports continuation`, notD, "neq", setupTf);
            add("structure", bullish ? "Higher high" : "Lower low", bullish ? "hh" : "ll", "eq", setupTf);
            break;
        }
        case "trend_continuation": {
            addTrendAlignment(`EMA structure ${d}`, macroTf);
            add("confirmation", bullish ? "Positive momentum" : "Negative momentum", bullish ? "momentum_positive" : "momentum_negative", "eq", setupTf);
            add("structure", bullish ? "Higher highs" : "Lower highs", bullish ? "hh" : "lh", "eq", setupTf);
            add("structure", bullish ? "Higher lows" : "Lower lows", bullish ? "hl" : "ll", "eq", setupTf);
            break;
        }
        case "fvg_reaction": {
            add("fvg", `${d === "bullish" ? "Bullish" : "Bearish"} FVG present`, d, "eq", setupTf);
            add("fvg", `FVG formed within last 4 bars`, 4, "lte", setupTf);
            add("trend", `Trend is not ${notD}`, notD, "neq", macroTf);
            break;
        }
        case "order_block_reaction": {
            add("order_block", `${d === "bullish" ? "Bullish" : "Bearish"} order block`, d, "eq", setupTf);
            add("trend", `Trend is not ${notD}`, notD, "neq", macroTf);
            break;
        }
        case "session_breakout": {
            add("price_action", bullish ? "Break of structure high" : "Break of structure low", bullish ? "breakout_high" : "breakout_low", "eq", setupTf);
            add("session", "Session in liquid windows", ["london", "new_york", "overlap"], "in");
            add("trend", `Trend is not ${notD}`, notD, "neq", macroTf);
            break;
        }
        case "volatility_expansion": {
            add("volatility", "Minimum ATR expansion", bullish ? "high" : "high", "eq", setupTf);
            add("confirmation", bullish ? "Positive momentum" : "Negative momentum", bullish ? "momentum_positive" : "momentum_negative", "eq", setupTf);
            addTrendAlignment(`Trend aligns with direction`, macroTf);
            break;
        }
        case "mean_reversion": {
            // "Neutral on macro" almost never holds on higher timeframes; pin it
            // to the loop timeframe when the macro trend is measurably directional.
            const m = measuredTrend(macroTf);
            if (m) {
                add("trend", `Neutral regime (measured on ${loopTf})`, "neutral", "eq", loopTf);
                retargets.push(`"Neutral regime" was pinned to ${loopTf}: ${macroTf} trend measured ${m}, so a neutral-macro precondition would block every bar.`);
            } else {
                add("trend", "Neutral regime", "neutral", "eq", macroTf);
            }
            add("confirmation", bullish ? "Oversold condition" : "Overbought condition", bullish ? "momentum_negative" : "momentum_positive", "eq", setupTf);
            add("structure", bullish ? "Near swing low" : "Near swing high", bullish ? "hl" : "lh", "eq", setupTf);
            break;
        }
        case "momentum_continuation": {
            addTrendAlignment(`EMA structure ${d}`, macroTf);
            add("confirmation", bullish ? "Strong positive momentum" : "Strong negative momentum", bullish ? "momentum_positive" : "momentum_negative", "eq", setupTf);
            add("price_action", "Recent breakout", bullish ? "breakout_high" : "breakout_low", "eq", setupTf);
            add("structure", bullish ? "Higher high" : "Lower low", bullish ? "hh" : "ll", "eq", setupTf);
            break;
        }
    }

    return { rules, retargets };
}

function cooldownForTf(tf: Timeframe): number {
    switch (tf) {
        case "M15": return 3;
        case "M30": return 4;
        case "H1": return 4;
        case "H4": return 3;
        case "D1": return 2;
        default: return 5;
    }
}

function bestSessionOf(pattern: Pattern | null): Array<"asian" | "london" | "new_york" | "overlap"> {
    if (!pattern) return ["london", "new_york"];
    return ["london", "new_york", "overlap"];
}

function defaultCosts(symbol: SupportedSymbol) {
    const spec = getSymbolSpec(symbol);
    const pipSize = spec?.pipSize ?? 0.01;
    const typicalSpreadPrice = spec?.typicalSpread ?? 0;
    const spreadPips = typicalSpreadPrice > 0 ? Number((typicalSpreadPrice / pipSize).toFixed(1)) : 10;
    const commissionPerLot = spec?.category === "indices" || spec?.category === "crypto" ? 2 : 4;
    return { spreadPips: Math.max(1, spreadPips), commissionPerLot, slippagePips: 1 };
}

export async function generateStrategy(
    symbol: SupportedSymbol,
    period: AnalysisPeriod,
    hierarchy: TimeframeHierarchy,
    pattern: Pattern | null,
    analysisDirection: "long" | "short",
    analysis: Awaited<ReturnType<typeof analyzeMarket>> | null
): Promise<Strategy> {
    const direction = pattern ? pattern.direction : analysisDirection;
    const setupTf = hierarchy.setup ?? DEFAULT_HIERARCHY.setup;
    const costs = defaultCosts(symbol);
    const patternName = pattern?.name ?? `${direction === "long" ? "Momentum" : "Reversal"} Continuation`;
    const macroTrend = analysis?.byTimeframe[hierarchy.macro]?.trend;
    const regime = macroTrend?.regime?.toLowerCase() ?? "transitional";
    const volatility = analysis?.byTimeframe[setupTf]?.volatility?.state ?? "normal";
    const bestSession = bestSessionOf(pattern)[0];

    // Measured trend per timeframe, used to keep generated rules coherent with
    // the signal direction (see addTrendAlignment in buildRules).
    const trendByTf: Partial<Record<Timeframe, TrendState>> = {};
    for (const [tf, res] of Object.entries(analysis?.byTimeframe ?? {}) as [Timeframe, AnalysisResult | undefined][]) {
        if (res?.trend?.state) trendByTf[tf] = res.trend.state;
    }

    const { rules: entryRules, retargets } = buildRules(pattern?.kind ?? "trend_continuation", direction, hierarchy, trendByTf);

    // The regimeFilter is evaluated by the engine on the SETUP timeframe (the
    // backtest loop TF), so derive it from the regime measured there — not from
    // the macro regime, which regularly disagrees and zeroes out every bar.
    const loopRegime =
        analysis?.byTimeframe[setupTf]?.trend?.regime?.toLowerCase()
        ?? analysis?.byTimeframe[hierarchy.structure]?.trend?.regime?.toLowerCase()
        ?? regime;
    const isRangeRegime = loopRegime === "ranging" || loopRegime === "low_volatility" || loopRegime === "transitional";
    const regimeFilter = isRangeRegime
        ? (["ranging", "low_volatility", "transitional"] as Strategy["regimeFilter"])
        : direction === "long"
            ? (["trending_bullish", "breakout", "high_volatility"] as Strategy["regimeFilter"])
            : (["trending_bearish", "breakout", "high_volatility"] as Strategy["regimeFilter"]);

    const strategy: Strategy = {
        id: newId("strategy"),
        name: `${symbol} ${direction === "long" ? "Long" : "Short"} — ${patternName}`,
        description: "",
        asset: symbol,
        direction,
        timeframes: hierarchy,
        regimeFilter,
        entryRules,
        confirmationRules: [],
        stopLoss: { mode: "atr", atrMultiple: 1.5, levelOffset: 0, useSwing: false },
        takeProfit: {
            mode: "r",
            r1: 1,
            r2: 2,
            r3: 3,
            fixedDistance: 0,
            partialCloses: [
                { atR: 1, closePercent: 33 },
                { atR: 2, closePercent: 33 },
            ],
            moveBeAfterTp1: true,
            lockAfterTp2: true,
            trailingEnabled: false,
            trailingStopAtr: 1,
        },
        risk: { mode: "percent", riskPercent: 1, fixedLot: 0.01, maxPositions: 1, dailyLossLimitPct: 3, maxDrawdownPct: 20 },
        filters: {
            sessions: bestSessionOf(pattern),
            daysOfWeek: [1, 2, 3, 4, 5],
            volatilityMinAtrPct: 0,
            volatilityMaxAtrPct: 0,
            maxTradesPerDay: 2,
            cooldownCandles: cooldownForTf(setupTf),
        },
        executionModel: "next_bar_open",
        costs,
        sourcePatternId: pattern?.id ?? null,
        whyp: {
            discovered: pattern?.description ?? "",
            conditionsSelected: entryRules.map((r) => r.label).join(", "),
            occurrenceFrequency: pattern?.stats ? `${pattern.stats.occurrences} occurrences on ${period.toLowerCase()} of data` : "",
            historicalPerformance: pattern?.stats
                ? `${pattern.stats.winRate}% win rate, ${pattern.stats.averageR}R average over ${pattern.stats.occurrences} matches`
                : "",
            weaknesses: pattern?.stats && pattern.stats.maxDrawdownPct > 10 ? `Max drawdown on matched setups was ${pattern.stats.maxDrawdownPct}%.` : "",
            poorRegimes: volatility === "low" ? "Historical evidence thins during low-volatility regimes." : "",
            generatedByProvider: "",
        },
        version: "1.0.0",
        created: Date.now(),
        updated: Date.now(),
    };

    // ── Feasibility pass: prove the strategy can actually fire ──────────────
    // Rules that each pass individually can still have an AND-conjunction that
    // never co-occurs in the (short) window the feed provides — the strategy
    // would then produce 0 trades on every backtest. Run the real engine on the
    // analysis candles; while nothing fires, disable the most restrictive
    // enabled entry rule (lowest pass rate on considered bars) and re-run.
    // Every relaxation is recorded in whyp so the user sees exactly what was
    // relaxed and why. The engine stays the single source of truth.
    if (analysis) {
        try {
            const candlesByTF: Partial<Record<Timeframe, import("@/lib/market-data/types").MarketCandle[]>> = {};
            for (const [tf, res] of Object.entries(analysis.byTimeframe) as [Timeframe, AnalysisResult | undefined][]) {
                if (res?.candleSeries?.length) candlesByTF[tf] = res.candleSeries;
            }
            if ((candlesByTF[hierarchy.setup]?.length ?? 0) > 10) {
                const feasibilityConfig = defaultBacktestConfig();
                const relaxations: string[] = [];
                for (let attempt = 0; attempt < 6; attempt++) {
                    const probe = backtestStrategy(strategy, symbol, candlesByTF, feasibilityConfig, 0, Number.MAX_SAFE_INTEGER);
                    if (probe.metrics.totalTrades > 0) break;

                    const diag = probe.diagnostics;
                    const enabled = strategy.entryRules.filter((r) => r.enabled);
                    if (!diag || enabled.length <= 1) break;

                    // Most restrictive rule first: zero passes is a hard blocker;
                    // otherwise the rarest-passing rule kills the conjunction.
                    const rates = diag.rules
                        .filter((r) => enabled.some((e) => e.id === r.id))
                        .map((r) => ({ id: r.id, label: r.label, rate: r.consideredBars > 0 ? r.passes / r.consideredBars : 0, passes: r.passes }));
                    if (rates.length === 0) break;
                    rates.sort((a, b) => (a.passes - b.passes) || (a.rate - b.rate));
                    const weakest = strategy.entryRules.find((r) => r.id === rates[0].id);
                    if (!weakest) break;
                    weakest.enabled = false;
                    relaxations.push(`"${weakest.label}" was disabled: over the available ${probe.coverage.availableBars}-bar window the remaining rules never co-occurred, so the strategy could not fire at all.`);
                }
                if (relaxations.length > 0) {
                    retargets.push(...relaxations);
                }
            }
        } catch {
            // feasibility probing must never block generation
        }
    }

    strategy.entryRules = entryRules.filter((r) => r.enabled);
    strategy.whyp.conditionsSelected = strategy.entryRules.map((r) => r.label).join(", ");

    // AI narrative layer (with guaranteed local fallback).
    const narrative = await describeStrategyWithFallback({
        asset: symbol,
        period,
        timeframe: setupTf,
        hierarchy: {
            macro: hierarchy.macro,
            structure: hierarchy.structure,
            setup: hierarchy.setup,
            entry: hierarchy.entry,
        },
        direction,
        patternName,
        patternKind: pattern?.kind ?? "trend_continuation",
        conditions: strategy.entryRules.map((r) => r.label),
        regime,
        volatility,
        bestSession,
        bestDay: "weekday",
        stats: {
            occurrences: pattern?.stats?.occurrences ?? 0,
            winRate: pattern?.stats?.winRate ?? 0,
            averageR: pattern?.stats?.averageR ?? 0,
            maxDrawdownPct: pattern?.stats?.maxDrawdownPct ?? 0,
            profitFactor: pattern?.stats?.profitFactor ?? 0,
            maxLossStreak: pattern?.stats?.maxLossStreak ?? 0,
        },
    });

    strategy.name = narrative.name || strategy.name;
    strategy.description = narrative.description;
    strategy.whyp.discovered = narrative.why || strategy.whyp.discovered;
    strategy.whyp.weaknesses = narrative.risks || strategy.whyp.weaknesses;
    strategy.whyp.poorRegimes = narrative.weakRegimes || strategy.whyp.poorRegimes;
    strategy.whyp.generatedByProvider = narrative.generatedBy;

    if (retargets.length > 0) {
        const note = `Rule coherence pass: ${retargets.join(" ")}`;
        strategy.whyp.weaknesses = [strategy.whyp.weaknesses, note].filter(Boolean).join(" ");
    }

    return strategy;
}

export type GeneratedStrategy = Strategy;