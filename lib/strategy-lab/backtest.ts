import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { SYMBOL_SPECS } from "@/lib/ai-signals/symbol-specs";
import {
    BacktestConfig,
    BacktestDirection,
    BacktestResult,
    BacktestTrade,
    EquityPoint,
    ExitReason,
    Strategy,
    StrategyRule,
} from "./types";
import { computeFeatures, CandleFeatures, featureAtOrBefore } from "./features";
import { detectRegime } from "@/lib/analytics/market-regime";
import { computeMetrics } from "./metrics";
import { DataCoverage } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Backtest engine
//
// Deterministic, single-pass simulation on historical candles. All numbers
// come from the engine; the AI layer is never consulted here.
//
// Execution model:
//   next_bar_open  → signal evaluated at bar[i] close, entry at bar[i+1] open.
//   same_bar_close → signal evaluated at bar[i] close, entry at bar[i] close.
//
// Cost model (per leg):
//   spreadPips        → half-spread applied to entry + half to exit.
//   commissionPerLot  → flat per lot round-trip.
//   slippagePips      → adverse slippage on entry + exit.
// ─────────────────────────────────────────────────────────────────────────────

let tradeIdSeq = 0;
let ticketSeq = 100000;

function resetIds(): void {
    tradeIdSeq = 0;
    ticketSeq = 100000;
}

// ──────────── Rule evaluation ────────────────────────────────────────────────

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

function compareNumeric(op: StrategyRule["operator"], actual: number | null, value: number): boolean {
    if (actual === null) return false;
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

function evaluateRule(rule: StrategyRule, feats: CandleFeatures | null): boolean {
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
            if (typeof rule.value === "string" && (rule.value === "high" || rule.value === "low" || rule.value === "normal")) {
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
        default: ok = true;
    }

    if (rule.negate) ok = !ok;
    return ok;
}

// Group rules: AND across groups, OR within same group if groupLogic is OR.
// The resolver returns the feature snapshot for a rule's designated timeframe.
function evaluateRules(
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

// ──────────── Feature resolution ─────────────────────────────────────────────

interface FeatureSeries {
    features: CandleFeatures[];
    candles: MarketCandle[];
}

function getFeaturesAt(
    seriesMap: Partial<Record<Timeframe, FeatureSeries>>,
    tf: Timeframe | undefined,
    timestamp: number
): CandleFeatures | null {
    if (!tf) return null;
    const series = seriesMap[tf];
    if (!series) return null;
    return featureAtOrBefore(series.features, timestamp);
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

/**
 * Evaluates a strategy against the LAST closed bar on the entry timeframe.
 * Used by the forward tester / deployment monitor so live signals follow the
 * exact same rule machinery as the backtest.
 */
export function evaluateStrategySignal(
    strategy: Strategy,
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    timestamp?: number
): SignalEvaluation {
    const seriesMap: Partial<Record<Timeframe, FeatureSeries>> = {};
    for (const [tf, candles] of Object.entries(candlesByTF) as [Timeframe, MarketCandle[]][]) {
        seriesMap[tf] = { features: computeFeatures(candles), candles };
    }

    const entryTF = strategy.timeframes.setup;
    const series = seriesMap[entryTF];
    if (!series) return { fired: false, conditions: [], regime: "transitional", session: "closed", atr: 0, trend: "neutral", candleIndex: -1 };

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
    if (idx < 0) return { fired: false, conditions: [], regime: "transitional", session: "closed", atr: 0, trend: "neutral", candleIndex: -1 };

    const c = series.candles[idx];
    const f = series.features[idx];
    const allEntryRulesOk = evaluateRules(strategy.entryRules, (cr) =>
        getFeaturesAt(seriesMap, cr.timeframe, c.timestamp) ?? f
    );
    const confEnabled = strategy.confirmationRules.filter((r) => r.enabled);
    let confOk = true;
    for (const cr of confEnabled) {
        const cf = getFeaturesAt(seriesMap, cr.timeframe, c.timestamp) ?? f;
        if (!evaluateRule(cr, cf)) { confOk = false; break; }
    }

    // Filters
    const day = new Date(c.timestamp).getDay();
    if (strategy.filters.daysOfWeek.length > 0 && !strategy.filters.daysOfWeek.includes(day)) {
        return { fired: false, conditions: [], regime: "transitional", session: f?.session ?? "", atr: f?.atr ?? 0, trend: f?.trend ?? "neutral", candleIndex: idx };
    }
    if (strategy.filters.sessions.length > 0 && f && !(strategy.filters.sessions as string[]).includes(f.session)) {
        return { fired: false, conditions: [], regime: "transitional", session: f?.session ?? "", atr: f?.atr ?? 0, trend: f?.trend ?? "neutral", candleIndex: idx };
    }
    if (f) {
        if (strategy.filters.volatilityMinAtrPct > 0 && f.atrPct < strategy.filters.volatilityMinAtrPct) {
            return { fired: false, conditions: [], regime: "transitional", session: f.session, atr: f.atr, trend: f.trend, candleIndex: idx };
        }
        if (strategy.filters.volatilityMaxAtrPct > 0 && f.atrPct > strategy.filters.volatilityMaxAtrPct) {
            return { fired: false, conditions: [], regime: "transitional", session: f.session, atr: f.atr, trend: f.trend, candleIndex: idx };
        }
    }

    let regime = "transitional";
    if (strategy.regimeFilter.length > 0 && f) {
        try {
            const start = Math.max(0, idx - 119);
            regime = detectRegime(series.candles.slice(start, idx + 1), entryTF).regime;
        } catch {
            regime = "transitional";
        }
        if (!strategy.regimeFilter.includes(regime as never)) {
            return { fired: false, conditions: [], regime, session: f?.session ?? "", atr: f?.atr ?? 0, trend: f?.trend ?? "neutral", candleIndex: idx };
        }
    }

    const fired = allEntryRulesOk && confOk;
    const conditions = fired
        ? [...strategy.entryRules.filter((r) => r.enabled).map((r) => r.label),
           ...confEnabled.map((r) => r.label)]
        : [];

    return {
        fired,
        conditions,
        regime,
        session: f?.session ?? "",
        atr: f?.atr ?? 0,
        trend: f?.trend ?? "neutral",
        candleIndex: idx,
    };
}

// ──────────── Position simulation ────────────────────────────────────────────

interface OpenPosition {
    id: string;
    ticket: number;
    direction: BacktestDirection;
    volume: number;
    remainingVolume: number;
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    openedAt: number;
    openBarIndex: number;
    regime: string;
    session: string;
    initialRiskPrice: number;
    entryCost: number;
    trailingActive: boolean;
    tp1Hit: boolean;
    tp2Hit: boolean;
    closedChunks: { pnl: number; volume: number; reason: ExitReason; price: number; barsHeld: number }[];
}

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

export function backtestStrategy(
    strategy: Strategy,
    symbol: SupportedSymbol,
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    config: BacktestConfig,
    from: number,
    to: number
): BacktestResult {
    resetIds();

    const spec = SYMBOL_SPECS[symbol] ?? { pipSize: 0.01, contractSize: 100, typicalSpread: 0.20 };
    const contractSize = spec.contractSize ?? 100;

    // Build feature series for each timeframe
    const seriesMap: Partial<Record<Timeframe, FeatureSeries>> = {};
    for (const [tf, candles] of Object.entries(candlesByTF) as [Timeframe, MarketCandle[]][]) {
        const features = computeFeatures(candles);
        seriesMap[tf] = { features, candles };
    }

    // Use entry timeframe as the primary loop
    const entryTF = strategy.timeframes.setup;
    const primary = seriesMap[entryTF];
    if (!primary) {
        return emptyResult(strategy, symbol, config, from, to);
    }

    const { candles, features } = primary;

    // Precompute regime per bar (stride-sampled on the entry timeframe) so the
    // regimeFilter matches how the live deployment labels regimes.
    const regimeByBar: string[] = new Array(candles.length).fill("transitional");
    const needRegime = strategy.regimeFilter.length > 0;
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

    let balance = config.initialBalance;
    let peak = balance;
    let dailyPnl = 0;
    let lastTradingDay: string | null = null;
    let cooldownUntil = -1;
    let tradesToday = 0;
    const openPositions: OpenPosition[] = [];
    const closedTrades: BacktestTrade[] = [];
    const equityPoints: EquityPoint[] = [];

    const isLong = strategy.direction === "long";

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const f = features[i];
        const cts = new Date(c.timestamp).toISOString().split("T")[0];

        // Daily reset
        if (cts !== lastTradingDay) {
            lastTradingDay = cts;
            dailyPnl = 0;
            tradesToday = 0;
            cooldownUntil = -1;
        }

        // Calculate unrealized P&L for equity tracking
        let unrealized = 0;
        for (const pos of openPositions) {
            const markPrice = c.close;
            const priceMove = pos.direction === "BUY"
                ? (markPrice - pos.entry)
                : (pos.entry - markPrice);
            unrealized += priceMove * pos.remainingVolume * contractSize;
        }

        const totalEquity = balance + unrealized;
        peak = Math.max(peak, totalEquity);
        const ddAbs = peak > totalEquity ? peak - totalEquity : 0;
        const ddPct = peak > 0 ? (ddAbs / peak) * 100 : 0;

        equityPoints.push({
            time: c.timestamp,
            balance: Number(balance.toFixed(2)),
            equity: Number(totalEquity.toFixed(2)),
            drawdownPct: Number(ddPct.toFixed(2)),
            drawdownAbs: Number(ddAbs.toFixed(2)),
        });

        // ── Check drawdown limit ──
        if (strategy.risk.maxDrawdownPct > 0 && peak > 0) {
            const currentDD = ((peak - totalEquity) / peak) * 100;
            if (currentDD >= strategy.risk.maxDrawdownPct) {
                closeAllPositions("drawdown_limit", i);
                continue;
            }
        }

        // ── Process open positions (SL / TP / trailing) ──
        for (let p = openPositions.length - 1; p >= 0; p--) {
            const pos = openPositions[p];
            const bar = candles[i];

            // Check stops first (conservative: stop before TP on same bar)
            let stopped = false;
            if (pos.direction === "BUY") {
                if (bar.low <= pos.sl) {
                    closePosition(p, pos.sl, "sl", i);
                    stopped = true;
                }
            } else {
                if (bar.high >= pos.sl) {
                    closePosition(p, pos.sl, "sl", i);
                    stopped = true;
                }
            }

            if (stopped) continue;

            // Trailing stop
            if (pos.trailingActive && pos.tp3 > 0) {
                if (pos.direction === "BUY") {
                    const trailSl = bar.close - strategy.takeProfit.trailingStopAtr * (f?.atr ?? 0);
                    if (trailSl > pos.sl) {
                        pos.sl = Number(trailSl.toFixed(2));
                    }
                    if (bar.low <= pos.sl) {
                        closePosition(p, pos.sl, "trailing", i);
                        continue;
                    }
                } else {
                    const trailSl = bar.close + strategy.takeProfit.trailingStopAtr * (f?.atr ?? 0);
                    if (trailSl < pos.sl) {
                        pos.sl = Number(trailSl.toFixed(2));
                    }
                    if (bar.high >= pos.sl) {
                        closePosition(p, pos.sl, "trailing", i);
                        continue;
                    }
                }
            }

            // TP1
            if (!pos.tp1Hit && pos.tp1 > 0) {
                if (pos.direction === "BUY" && bar.high >= pos.tp1) {
                    hitTp(pos, pos.tp1, "tp1", i);
                } else if (pos.direction === "SELL" && bar.low <= pos.tp1) {
                    hitTp(pos, pos.tp1, "tp1", i);
                }
            }

            // TP2
            if (pos.tp1Hit && !pos.tp2Hit && pos.tp2 > 0) {
                if (pos.direction === "BUY" && bar.high >= pos.tp2) {
                    hitTp(pos, pos.tp2, "tp2", i);
                } else if (pos.direction === "SELL" && bar.low <= pos.tp2) {
                    hitTp(pos, pos.tp2, "tp2", i);
                }
            }

            // TP3 (full close)
            if (pos.tp1Hit && pos.tp2Hit && pos.tp3 > 0) {
                if (pos.direction === "BUY" && bar.high >= pos.tp3) {
                    closePosition(p, pos.tp3, "tp3", i);
                } else if (pos.direction === "SELL" && bar.low <= pos.tp3) {
                    closePosition(p, pos.tp3, "tp3", i);
                }
            }
        }

        // ── End-of-data check ──
        if (i === candles.length - 1) {
            closeAllPositions("end_of_data", i);
        }

        // ── Daily loss limit ──
        if (strategy.risk.dailyLossLimitPct > 0 && balance > 0) {
            if (dailyPnl < -(balance * strategy.risk.dailyLossLimitPct / 100)) {
                closeAllPositions("daily_loss_limit", i);
                continue;
            }
        }

        // ── Max positions ──
        if (openPositions.length >= strategy.risk.maxPositions) continue;

        // ── Cooldown ──
        if (i < cooldownUntil) continue;

        // ── Max trades per day ──
        if (tradesToday >= strategy.filters.maxTradesPerDay) continue;

        // ── Session filter ──
        if (strategy.filters.sessions.length > 0 && f && !(strategy.filters.sessions as string[]).includes(f.session)) continue;

        // ── Volatility filter ──
        if (f) {
            if (strategy.filters.volatilityMinAtrPct > 0 && f.atrPct < strategy.filters.volatilityMinAtrPct) continue;
            if (strategy.filters.volatilityMaxAtrPct > 0 && f.atrPct > strategy.filters.volatilityMaxAtrPct) continue;
        }

        // ── Regime filter ──
        if (strategy.regimeFilter.length > 0 && f) {
            const currentRegime = regimeByBar[i] ?? "transitional";
            if (!strategy.regimeFilter.includes(currentRegime as never)) continue;
        }

        // ── Evaluate entry rules — each rule resolves to its own timeframe ──
        const allEntryRulesOk = evaluateRules(strategy.entryRules, (cr) =>
            getFeaturesAt(seriesMap, cr.timeframe, c.timestamp) ?? f
        );
        if (!allEntryRulesOk) continue;

        // Confirmation rules with timeframe resolution
        const confEnabled = strategy.confirmationRules.filter((r) => r.enabled);
        let confOk = true;
        for (const cr of confEnabled) {
            const cf = getFeaturesAt(seriesMap, cr.timeframe, c.timestamp) ?? f;
            if (!evaluateRule(cr, cf)) { confOk = false; break; }
        }
        if (!confOk) continue;

        // ── Signal confirmed → compute entry SL/TP ──
        const entryBar = candles[i + 1];
        if (!entryBar) continue;

        const entryPrice = strategy.executionModel === "next_bar_open"
            ? entryBar.open
            : entryBar.close;

        const atr = f?.atr ?? candles[i].high - candles[i].low;

        let sl: number;
        if (strategy.stopLoss.mode === "atr") {
            sl = isLong
                ? entryPrice - strategy.stopLoss.atrMultiple * atr
                : entryPrice + strategy.stopLoss.atrMultiple * atr;
        } else {
            sl = isLong
                ? entryPrice - strategy.stopLoss.levelOffset
                : entryPrice + strategy.stopLoss.levelOffset;
        }
        sl = Number(sl.toFixed(2));

        const riskPrice = Math.abs(entryPrice - sl);
        if (riskPrice <= 0) continue;

        const tp1 = isLong
            ? entryPrice + strategy.takeProfit.r1 * riskPrice
            : entryPrice - strategy.takeProfit.r1 * riskPrice;
        const tp2 = isLong
            ? entryPrice + strategy.takeProfit.r2 * riskPrice
            : entryPrice - strategy.takeProfit.r2 * riskPrice;
        const tp3 = isLong
            ? entryPrice + strategy.takeProfit.r3 * riskPrice
            : entryPrice - strategy.takeProfit.r3 * riskPrice;

        // Volume sizing
        let volume: number;
        if (strategy.risk.mode === "percent") {
            const riskAmount = balance * (strategy.risk.riskPercent / 100);
            volume = riskAmount / (riskPrice * contractSize);
        } else {
            volume = strategy.risk.fixedLot;
        }
        volume = Math.round(volume * 100) / 100;
        if (volume <= 0) continue;

        // Entry-leg cost (half-spread + slippage) charged once per position.
        const entryCost = config.spreadPips * spec.pipSize * volume * contractSize +
            config.slippagePips * spec.pipSize * volume * contractSize;

        tradeIdSeq++;
        ticketSeq++;

        const pos: OpenPosition = {
            id: `bt-${tradeIdSeq}`,
            ticket: ticketSeq,
            direction: isLong ? "BUY" : "SELL",
            volume,
            remainingVolume: volume,
            entry: Number(entryPrice.toFixed(2)),
            sl,
            tp1: Number(tp1.toFixed(2)),
            tp2: Number(tp2.toFixed(2)),
            tp3: Number(tp3.toFixed(2)),
            openedAt: entryBar.timestamp,
            openBarIndex: i + 1,
            regime: regimeByBar[i + 1] ?? regimeByBar[i] ?? "transitional",
            session: f?.session ?? "unknown",
            initialRiskPrice: riskPrice,
            entryCost,
            trailingActive: false,
            tp1Hit: false,
            tp2Hit: false,
            closedChunks: [],
        };
        openPositions.push(pos);
        tradesToday++;
        cooldownUntil = i + strategy.filters.cooldownCandles;
    }

    // ── Helpers ──

    function hitTp(pos: OpenPosition, price: number, reason: "tp1" | "tp2" | "tp3", barIdx: number): void {
        const partialPct = reason === "tp1"
            ? (strategy.takeProfit.partialCloses.find((p) => p.atR === strategy.takeProfit.r1)?.closePercent ?? 0)
            : reason === "tp2"
                ? (strategy.takeProfit.partialCloses.find((p) => p.atR === strategy.takeProfit.r2)?.closePercent ?? 0)
                : 1;

        const closeVol = Math.round(pos.remainingVolume * (partialPct / 100) * 100) / 100;
        if (closeVol <= 0) return;

        const priceMove = pos.direction === "BUY" ? (price - pos.entry) : (pos.entry - price);
        const pnl = priceMove * closeVol * contractSize;
        const exitSlip = config.slippagePips * spec.pipSize * closeVol * contractSize;
        const exitSpread = config.spreadPips * spec.pipSize * closeVol * contractSize;
        const commission = config.commissionPerLot * closeVol * contractSize;

        pos.closedChunks.push({
            pnl: pnl - exitSlip - exitSpread - commission,
            volume: closeVol,
            reason,
            price,
            barsHeld: barIdx - pos.openBarIndex,
        });

        pos.remainingVolume = Math.round((pos.remainingVolume - closeVol) * 100) / 100;

        if (reason === "tp1") {
            pos.tp1Hit = true;
            if (strategy.takeProfit.moveBeAfterTp1) pos.sl = pos.entry;
        } else if (reason === "tp2") {
            pos.tp2Hit = true;
            if (strategy.takeProfit.lockAfterTp2) pos.sl = pos.tp1;
        } else if (reason === "tp3") {
            pos.trailingActive = false;
        }

        // If trailing enabled and TP3 target reached, start trailing
        if (reason === "tp3" && strategy.takeProfit.trailingEnabled) {
            pos.trailingActive = true;
            pos.tp3 = 0;
            return;
        }

        if (pos.remainingVolume <= 0) {
            const idx = openPositions.indexOf(pos);
            if (idx !== -1) openPositions.splice(idx, 1);
            finalizePosition(pos, barIdx);
        }
    }

    function closePosition(idx: number, price: number, reason: ExitReason, barIdx: number): void {
        const pos = openPositions[idx];
        openPositions.splice(idx, 1);

        if (pos.remainingVolume > 0) {
            const priceMove = pos.direction === "BUY" ? (price - pos.entry) : (pos.entry - price);
            const pnl = priceMove * pos.remainingVolume * contractSize;
            const exitSlip = config.slippagePips * spec.pipSize * pos.remainingVolume * contractSize;
            const exitSpread = config.spreadPips * spec.pipSize * pos.remainingVolume * contractSize;
            const commission = config.commissionPerLot * pos.remainingVolume * contractSize;

            pos.closedChunks.push({
                pnl: pnl - exitSlip - exitSpread - commission,
                volume: pos.remainingVolume,
                reason,
                price,
                barsHeld: barIdx - pos.openBarIndex,
            });
            pos.remainingVolume = 0;
        }

        finalizePosition(pos, barIdx);
    }

    function closeAllPositions(reason: ExitReason, barIdx: number): void {
        while (openPositions.length > 0) {
            closePosition(0, candles[barIdx].close, reason, barIdx);
        }
    }

    function finalizePosition(pos: OpenPosition, barIdx: number): void {
        const totalPnl = pos.closedChunks.reduce((s, ch) => s + ch.pnl, 0) - pos.entryCost;
        const totalVolume = pos.volume;
        const riskPnl = totalPnl / (pos.initialRiskPrice * totalVolume * contractSize);
        const lastChunk = pos.closedChunks[pos.closedChunks.length - 1];
        const exitReason = lastChunk?.reason ?? "end_of_data";

        const bt: BacktestTrade = {
            id: pos.id,
            ticket: pos.ticket,
            openBarIndex: pos.openBarIndex,
            closeBarIndex: barIdx,
            openedAt: pos.openedAt,
            closedAt: candles[barIdx].timestamp,
            symbol,
            direction: pos.direction,
            volume: pos.volume,
            entry: pos.entry,
            sl: pos.sl,
            tp1: pos.tp1,
            tp2: pos.tp2,
            tp3: pos.tp3,
            exit: lastChunk?.price ?? pos.entry,
            exitReason,
            profit: Number(totalPnl.toFixed(2)),
            profitR: Number(riskPnl.toFixed(3)),
            durationMs: candles[barIdx].timestamp - pos.openedAt,
            regime: pos.regime,
            session: pos.session,
            spreadCost: config.spreadPips * spec.pipSize * pos.volume * contractSize * 2,
            commission: config.commissionPerLot * pos.volume * contractSize,
            slippageCost: config.slippagePips * spec.pipSize * pos.volume * contractSize * 2,
            pnlGross: Number(totalPnl.toFixed(2)),
        };

        closedTrades.push(bt);
        balance += totalPnl;
        dailyPnl += totalPnl;
    }

    // Run final pass to close any still-open (should be empty but safety)
    closeAllPositions("end_of_data", candles.length - 1);

    const metrics = computeMetrics(closedTrades, equityPoints, config.initialBalance);

    // Buy-and-hold return
    if (candles.length >= 2) {
        metrics.buyHoldReturnPct = Number(((candles[candles.length - 1].close / candles[0].close - 1) * 100).toFixed(2));
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
        trades: closedTrades,
        equity: equityPoints,
        coverage,
        symbols: [symbol],
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
        fullyCoversRequest: availableFrom <= from,
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
    };
}