/**
 * Shared strategy DECISIONS (Phase 4).
 *
 * This module is the single implementation of "when does this strategy fire?".
 * The backtest loop, the forward/deployment signal generator, replay and paper
 * trading all call `evaluateEntry` — so a condition that is true in one
 * environment is true in every environment.
 *
 * Look-ahead policy: features come from `lib/strategy-lab/features.ts`, which
 * is causal (feature[i] depends only on candles[0..i], swing points are
 * confirmed with a lag). Entry evaluation only ever reads the feature at the
 * bar being evaluated or earlier.
 */

import { detectRegime } from "@/lib/analytics/market-regime";
import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type { CandleFeatures } from "@/lib/strategy-lab/features";
import { computeFeatures, featureAtOrBefore } from "@/lib/strategy-lab/features";
import type { Strategy, StrategyRule } from "@/lib/strategy-lab/types";
import type { TraceCondition } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Feature series
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureSeries {
    features: CandleFeatures[];
    candles: MarketCandle[];
}

export type SeriesMap = Partial<Record<Timeframe, FeatureSeries>>;

/** Build the causal feature series for every provided timeframe. */
export function buildSeriesMap(candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>): SeriesMap {
    const map: SeriesMap = {};
    for (const [tf, candles] of Object.entries(candlesByTF) as [Timeframe, MarketCandle[]][]) {
        if (!candles || candles.length === 0) continue;
        map[tf] = { features: computeFeatures(candles), candles };
    }
    return map;
}

/** Feature of the given timeframe at or before `timestamp` — never after. */
export function resolveFeatureAt(
    seriesMap: SeriesMap,
    tf: Timeframe | undefined,
    timestamp: number
): CandleFeatures | null {
    if (!tf) return null;
    const series = seriesMap[tf];
    if (!series) return null;
    return featureAtOrBefore(series.features, timestamp);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule evaluation (extracted verbatim from the backtest engine so there is
// exactly one implementation of rule semantics)
// ─────────────────────────────────────────────────────────────────────────────

function compareStrings(op: StrategyRule["operator"], actual: string, value: string): boolean {
    switch (op) {
        case "eq": return actual === value;
        case "neq": return actual !== value;
        case "in": return actual === value;
        case "contains": return actual.includes(value);
        case "not_in": return actual !== value;
        default: return false;
    }
}

function compareStringsArray(op: StrategyRule["operator"], actual: string, values: string[]): boolean {
    switch (op) {
        case "in": return values.includes(actual);
        case "not_in": return !values.includes(actual);
        default: return false;
    }
}

function compareNumeric(op: StrategyRule["operator"], actual: number | null | undefined, value: number): boolean {
    if (actual === null || actual === undefined || Number.isNaN(actual)) return false;
    switch (op) {
        case "gte": return actual >= value;
        case "lte": return actual <= value;
        case "gt": return actual > value;
        case "lt": return actual < value;
        case "eq": return Math.abs(actual - value) < 0.0001;
        case "neq": return Math.abs(actual - value) >= 0.0001;
        default: return false;
    }
}

/** Evaluate a single rule against a causal feature snapshot. */
export function evaluateRule(rule: StrategyRule, feats: CandleFeatures | null): boolean {
    if (!rule.enabled) return true;
    if (!feats) return false;
    let ok = false;

    switch (rule.group) {
        case "trend": {
            ok = compareStrings(rule.operator, feats.trend, String(rule.value));
            break;
        }
        case "liquidity": {
            if (typeof rule.value === "number") {
                ok = compareNumeric(rule.operator, feats.lastSweepBarsAgo, rule.value as number);
            } else if (Array.isArray(rule.value)) {
                ok = compareStringsArray(rule.operator, feats.lastSweep?.side ?? "none", rule.value as string[]);
            } else {
                ok = compareStrings(rule.operator, feats.lastSweep?.side ?? "none", String(rule.value));
            }
            break;
        }
        case "structure": {
            const val = String(rule.value);
            const s = feats.choch?.direction;
            const bos = feats.bos?.direction;
            switch (val) {
                case "choch_bullish": ok = s === "bullish"; break;
                case "choch_bearish": ok = s === "bearish"; break;
                case "bos_bullish": ok = bos === "bullish"; break;
                case "bos_bearish": ok = bos === "bearish"; break;
                case "hh": ok = feats.higherHigh; break;
                case "hl": ok = feats.higherLow; break;
                case "lh": ok = feats.lowerHigh; break;
                case "ll": ok = feats.lowerLow; break;
                default: ok = false;
            }
            break;
        }
        case "fvg": {
            if (typeof rule.value === "number") {
                ok = compareNumeric(rule.operator, feats.fvgBarsAgo, rule.value as number);
            } else if (Array.isArray(rule.value)) {
                const dir = feats.fvgDirection ?? "none";
                ok = (rule.value as string[]).includes(dir);
            } else {
                ok = compareStrings(rule.operator, feats.fvgDirection ?? "none", String(rule.value));
            }
            break;
        }
        case "order_block": {
            ok = compareStrings(rule.operator, feats.obDirection ?? "none", String(rule.value));
            break;
        }
        case "session": {
            if (Array.isArray(rule.value)) {
                ok = compareStringsArray(rule.operator, feats.session, rule.value as string[]);
            } else {
                ok = compareStrings(rule.operator, feats.session, String(rule.value));
            }
            break;
        }
        case "volatility": {
            if (typeof rule.value === "string" && (rule.value === "high" || rule.value === "low" || rule.value === "normal" || rule.value === "extreme")) {
                ok = compareStrings(rule.operator, feats.volState, rule.value);
            } else {
                ok = compareNumeric(rule.operator, feats.atrPct, Number(rule.value));
            }
            break;
        }
        case "price_action": {
            const val = String(rule.value);
            switch (val) {
                case "breakout_high": ok = feats.breakoutHigh; break;
                case "breakout_low": ok = feats.breakoutLow; break;
                default: ok = false;
            }
            break;
        }
        case "confirmation": {
            const val = String(rule.value);
            switch (val) {
                case "momentum_positive": ok = feats.momentumPct > 0; break;
                case "momentum_negative": ok = feats.momentumPct < 0; break;
                case "close_above_ema": ok = feats.close >= feats.ema20; break;
                case "close_below_ema": ok = feats.close <= feats.ema20; break;
                default: ok = false;
            }
            break;
        }
        case "indicator": {
            const name = rule.indicator ?? "";
            switch (name) {
                case "rsi":
                    ok = compareNumeric(rule.operator, feats.rsi, Number(rule.value));
                    break;
                case "ema_cross": {
                    const val = String(rule.value);
                    if (val === "ema20_above_ema50") ok = feats.ema20 > feats.ema50;
                    else if (val === "ema20_below_ema50") ok = feats.ema20 < feats.ema50;
                    else ok = false;
                    break;
                }
                case "close_vs_ema20": {
                    const val = String(rule.value);
                    if (val === "above") ok = feats.close > feats.ema20;
                    else if (val === "below") ok = feats.close < feats.ema20;
                    else ok = false;
                    break;
                }
                case "atr": {
                    ok = compareNumeric(rule.operator, feats.atr, Number(rule.value));
                    break;
                }
                default:
                    ok = false;
            }
            break;
        }
        default: ok = true;
    }

    if (rule.negate) ok = !ok;
    return ok;
}

// Group rules: AND across groups, OR within a group when groupLogic is OR.
export function evaluateRules(
    rules: StrategyRule[],
    resolve: (rule: StrategyRule) => CandleFeatures | null
): boolean {
    const enabled = rules.filter((r) => r.enabled);
    if (enabled.length === 0) return true;

    const groups = new Map<string, StrategyRule[]>();
    for (const r of enabled) {
        const key = r.group;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
    }

    for (const [, groupRules] of groups) {
        const groupResults = groupRules.map((r) => evaluateRule(r, resolve(r)));
        const anyOr = groupRules.some((r) => r.groupLogic === "OR");
        if (anyOr) {
            if (!groupResults.some(Boolean)) return false;
        } else {
            if (!groupResults.every(Boolean)) return false;
        }
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry gate — the ONE place strategy entry conditions + filters are applied
// ─────────────────────────────────────────────────────────────────────────────

export interface EntryGateState {
    openPositions?: number;
    /** Bars: entries are blocked while index < cooldownUntil. */
    cooldownUntil?: number;
    tradesToday?: number;
}

export interface EntryEvaluation {
    fired: boolean;
    /** Name of the first gate/condition that blocked the entry, else null. */
    blockedBy: string | null;
    conditions: string[];
    conditionTrace: TraceCondition[];
    regime: string;
    session: string;
    atr: number;
    trend: string;
    candleIndex: number;
}

export interface EvaluateEntryInput {
    strategy: Strategy;
    seriesMap: SeriesMap;
    /** Index inside the strategy's setup timeframe series. */
    index: number;
    /** Precomputed regime per bar (backtest stride-sampling), if available. */
    regimeByBar?: string[];
    /** On-the-fly regime resolver (forward/live path). */
    regimeResolver?: (index: number) => string;
    state?: EntryGateState;
}

const NO_SIGNAL = (session: string, atr: number, trend: string, idx: number): EntryEvaluation => ({
    fired: false,
    blockedBy: "no_data",
    conditions: [],
    conditionTrace: [],
    regime: "transitional",
    session,
    atr,
    trend,
    candleIndex: idx,
});

/**
 * Full entry decision at bar `index` of the setup timeframe.
 *
 * Gate order (all must pass): day-of-week → session → volatility → regime →
 * max positions → cooldown → max trades/day → entry rules → confirmation rules.
 * Every gate is reported in `conditionTrace` so the debug mode can show WHY a
 * trade did or did not fire.
 */
export function evaluateEntry(input: EvaluateEntryInput): EntryEvaluation {
    const { strategy, seriesMap, index, regimeByBar, state } = input;
    const primary = seriesMap[strategy.timeframes.setup];
    if (!primary || index < 0 || index >= primary.candles.length) {
        return NO_SIGNAL("", 0, "neutral", index);
    }

    const primaryCandles = primary.candles;
    const c = primaryCandles[index];
    const f = primary.features[index] ?? null;
    const trace: TraceCondition[] = [];

    const session = f?.session ?? "";
    const atr = f?.atr ?? 0;
    const trend = f?.trend ?? "neutral";

    const fail = (blockedBy: string): EntryEvaluation => ({
        fired: false,
        blockedBy,
        conditions: [],
        conditionTrace: trace,
        regime: regimeValue(),
        session,
        atr,
        trend,
        candleIndex: index,
    });

    function regimeValue(): string {
        if (strategy.regimeFilter.length === 0) return "transitional";
        if (regimeByBar) return regimeByBar[index] ?? "transitional";
        if (input.regimeResolver) return input.regimeResolver(index);
        try {
            const start = Math.max(0, index - 119);
            return detectRegime(primaryCandles.slice(start, index + 1), strategy.timeframes.setup).regime;
        } catch {
            return "transitional";
        }
    }

    // ── Day of week ──
    const day = new Date(c.timestamp).getUTCDay();
    const dayOk =
        strategy.filters.daysOfWeek.length === 0 || strategy.filters.daysOfWeek.includes(day);
    trace.push({ label: "Day of week", detail: String(day), passed: dayOk });
    if (!dayOk) return fail("day_of_week");

    // ── Session ──
    const sessionOk =
        strategy.filters.sessions.length === 0 ||
        (f !== null && (strategy.filters.sessions as string[]).includes(f.session));
    trace.push({ label: "Session", detail: session, passed: sessionOk });
    if (!sessionOk) return fail("session");

    // ── Volatility band ──
    let volOk = true;
    let volDetail = "";
    if (f) {
        if (strategy.filters.volatilityMinAtrPct > 0 && f.atrPct < strategy.filters.volatilityMinAtrPct) {
            volOk = false;
            volDetail = `atrPct ${f.atrPct.toFixed(3)} < min ${strategy.filters.volatilityMinAtrPct}`;
        }
        if (strategy.filters.volatilityMaxAtrPct > 0 && f.atrPct > strategy.filters.volatilityMaxAtrPct) {
            volOk = false;
            volDetail = `atrPct ${f.atrPct.toFixed(3)} > max ${strategy.filters.volatilityMaxAtrPct}`;
        }
        if (!volDetail) volDetail = `atrPct ${f.atrPct.toFixed(3)}`;
    }
    trace.push({ label: "Volatility", detail: volDetail, passed: volOk });
    if (!volOk) return fail("volatility");

    // ── Regime ──
    let regime = "transitional";
    let regimeOk = true;
    if (strategy.regimeFilter.length > 0) {
        regime = regimeValue();
        regimeOk = strategy.regimeFilter.includes(regime as never);
        trace.push({ label: "Regime", detail: regime, passed: regimeOk });
        if (!regimeOk) return fail("regime");
    }

    // ── Position / pacing gates (stateful; skipped when no state supplied) ──
    if (state) {
        // Pacing gates mirror Strategy Lab semantics exactly: 0 blocks all
        // entries (it is a hard cap, not "unlimited").
        const maxPos = strategy.risk.maxPositions;
        const positionsOk = (state.openPositions ?? 0) < maxPos;
        trace.push({ label: "Max positions", detail: `${state.openPositions ?? 0}/${maxPos}`, passed: positionsOk });
        if (!positionsOk) return fail("max_positions");

        if (state.cooldownUntil !== undefined && index < state.cooldownUntil) {
            trace.push({ label: "Cooldown", detail: `until bar ${state.cooldownUntil}`, passed: false });
            return fail("cooldown");
        }

        const tradesToday = state.tradesToday ?? 0;
        const maxTrades = strategy.filters.maxTradesPerDay;
        const tradesOk = tradesToday < maxTrades;
        trace.push({ label: "Max trades/day", detail: `${tradesToday}/${maxTrades}`, passed: tradesOk });
        if (!tradesOk) return fail("max_trades_per_day");
    }

    // ── Entry rules (each rule resolves to its own timeframe, at or before c) ──
    const resolve = (rule: StrategyRule): CandleFeatures | null =>
        resolveFeatureAt(seriesMap, rule.timeframe, c.timestamp) ?? f;

    const entryEnabled = strategy.entryRules.filter((r) => r.enabled);
    let entryOk = true;
    for (const r of entryEnabled) {
        const rf = resolve(r);
        const passed = evaluateRule(r, rf);
        trace.push({ label: r.label, detail: ruleDetail(r, rf), passed });
        if (!passed) entryOk = false;
    }
    if (!entryOk) return fail("entry_rules");

    // ── Confirmation rules ──
    const confEnabled = strategy.confirmationRules.filter((r) => r.enabled);
    let confOk = true;
    for (const r of confEnabled) {
        const cf = resolve(r);
        const passed = evaluateRule(r, cf);
        trace.push({ label: r.label, detail: ruleDetail(r, cf), passed });
        if (!passed) confOk = false;
    }
    if (!confOk) return fail("confirmation_rules");

    const conditions = [
        ...entryEnabled.map((r) => r.label),
        ...confEnabled.map((r) => r.label),
    ];

    return {
        fired: true,
        blockedBy: null,
        conditions,
        conditionTrace: trace,
        regime: regimeValue(),
        session,
        atr,
        trend,
        candleIndex: index,
    };
}

function ruleDetail(rule: StrategyRule, feats: CandleFeatures | null): string {
    if (!feats) return "no data";
    switch (rule.group) {
        case "indicator":
            if (rule.indicator === "rsi") return `RSI ${feats.rsi === null ? "n/a" : feats.rsi.toFixed(1)} ${rule.operator} ${rule.value}`;
            if (rule.indicator === "ema_cross") return `EMA20 ${feats.ema20.toFixed(2)} vs EMA50 ${feats.ema50.toFixed(2)}`;
            if (rule.indicator === "atr") return `ATR ${feats.atr.toFixed(2)} ${rule.operator} ${rule.value}`;
            break;
        case "structure": {
            const dir = feats.bos?.direction ?? "none";
            return `BOS ${dir}`;
        }
        case "trend": return `trend ${feats.trend}`;
        case "session": return `session ${feats.session}`;
        case "volatility": return `atrPct ${feats.atrPct.toFixed(3)}`;
        default: break;
    }
    return `${String(rule.value)}`;
}
