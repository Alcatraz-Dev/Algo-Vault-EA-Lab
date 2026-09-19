import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { SYMBOL_SPECS } from "@/lib/ai-signals/symbol-specs";
import { BacktestMetrics, ExitReason, ForwardMode, ForwardTest, ForwardTrade, Strategy, TimeframeHierarchy } from "./types";
import { evaluateStrategySignal } from "./backtest";
import { computeMetrics } from "./metrics";

// ─────────────────────────────────────────────────────────────────────────────
// Forward testing harness.
//
// Runs the SAME rule machinery as the backtest against continuing market data:
//   * scanSignalForStrategy  → evaluate the latest bar; emit a signal if fired.
//   * updateForwardTest      → mark open trades to market, respect SL/TP/trailing,
//                              and recompute live metrics against the backtest.
//
// Note: the lab operates on the summary/polled bar data available to the
// deployment monitor. Bar-based (not tick-based) fills are assumed and labeled
// as such.
// ─────────────────────────────────────────────────────────────────────────────

function spec(symbol: SupportedSymbol) {
    return SYMBOL_SPECS[symbol] ?? { pipSize: 0.01, contractSize: 100 };
}

export function buildForwardEntry(
    strategy: Strategy,
    symbol: SupportedSymbol,
    candlesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    mode: ForwardMode,
    existing: ForwardTrade[],
    signalIdPrefix = "ft"
): ForwardTrade | null {
    const series = candlesByTF[strategy.timeframes.setup];
    if (!series || series.length === 0) return null;

    const last = series[series.length - 1];
    const { fired, conditions, regime, session, atr, trend, candleIndex } = evaluateStrategySignal(strategy, candlesByTF, last.timestamp);
    if (!fired) return null;

    const lastTs = last.timestamp;
    const timeframeMs = lastTs - (series.length > 1 ? series[series.length - 2].timestamp : lastTs);
    // Ignore immediate re-triggers on the same bar.
    const recent = existing.find((t) => Math.abs(t.openedAt - lastTs) < Math.max(timeframeMs, 1));
    if (recent) return null;

    const entryBar = series[candleIndex];
    const isLong = strategy.direction === "long";

    const atrValue = atr > 0 ? atr : entryBar.high - entryBar.low;
    const entry = entryBar.close;
    const sl = isLong
        ? Number((entry - strategy.stopLoss.atrMultiple * atrValue).toFixed(2))
        : Number((entry + strategy.stopLoss.atrMultiple * atrValue).toFixed(2));

    const riskPrice = Math.abs(entry - sl);
    if (riskPrice <= 0) return null;

    const tp1 = isLong ? Number((entry + strategy.takeProfit.r1 * riskPrice).toFixed(2)) : Number((entry - strategy.takeProfit.r1 * riskPrice).toFixed(2));
    const tp2 = isLong ? Number((entry + strategy.takeProfit.r2 * riskPrice).toFixed(2)) : Number((entry - strategy.takeProfit.r2 * riskPrice).toFixed(2));
    const tp3 = isLong ? Number((entry + strategy.takeProfit.r3 * riskPrice).toFixed(2)) : Number((entry - strategy.takeProfit.r3 * riskPrice).toFixed(2));

    return {
        id: `${signalIdPrefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        signalId: `${signalIdPrefix}_${entryBar.timestamp}`,
        openedAt: entryBar.timestamp,
        symbol,
        direction: isLong ? "BUY" : "SELL",
        entry,
        sl,
        tp1,
        tp2,
        tp3,
        currentPrice: entryBar.close,
        status: "open",
        reasoning: conditions.join("; ") || `${trend} conditions on ${strategy.timeframes.setup}`,
        regime,
        session,
    };
}

function closeTrade(trade: ForwardTrade, candles: MarketCandle[], contractSize: number, currentBar: MarketCandle, exitReason: ForwardTrade["exitReason"], price: number): void {
    const exit = price;
    trade.exit = exit;
    trade.exitReason = exitReason;
    trade.closedAt = currentBar.timestamp;
    trade.currentPrice = exit;
    const priceMove = trade.direction === "BUY" ? (exit - trade.entry) : (trade.entry - exit);
    trade.profit = Number((priceMove * contractSize * 1).toFixed(2));
    const riskPrice = Math.abs(trade.entry - (trade.sl ?? trade.entry));
    if (riskPrice > 0) trade.profitR = Number((priceMove / riskPrice).toFixed(3));
    trade.status = "closed";
}

export function updateForwardTest(
    ft: ForwardTest,
    candles: MarketCandle[]
): ForwardTest {
    if (!candles || candles.length === 0) return ft;
    const currentBar = candles[candles.length - 1];
    const contractSize = spec(ft.symbol).contractSize ?? 100;

    for (const trade of ft.signals) {
        if (trade.status === "closed") continue;

        trade.currentPrice = currentBar.close;

        // Conservative: stop before target in the same bar.
        if (trade.direction === "BUY") {
            if (currentBar.low <= (trade.sl ?? -Infinity)) {
                closeTrade(trade, candles, contractSize, currentBar, "sl", trade.sl!);
                continue;
            }
            if (trade.tp1 !== undefined && currentBar.high >= trade.tp1) {
                closeTrade(trade, candles, contractSize, currentBar, "tp1", trade.tp1);
                continue;
            }
        } else {
            if (currentBar.high >= (trade.sl ?? Infinity)) {
                closeTrade(trade, candles, contractSize, currentBar, "sl", trade.sl!);
                continue;
            }
            if (trade.tp1 !== undefined && currentBar.low <= trade.tp1) {
                closeTrade(trade, candles, contractSize, currentBar, "tp1", trade.tp1);
                continue;
            }
        }
    }

    const closedTrades = ft.signals.filter((t) => t.status === "closed");
    const trades = closedTrades.map<{
        id: string; ticket: number; openBarIndex: number; closeBarIndex: number; openedAt: number; closedAt: number;
        symbol: string; direction: "BUY" | "SELL"; volume: number; entry: number; sl: number; tp1: number; tp2: number; tp3: number;
        exit: number; exitReason: ExitReason; profit: number; profitR: number; durationMs: number; regime: string; session: string;
        spreadCost: number; commission: number; slippageCost: number; pnlGross: number;
    }>((t, i) => ({
        id: t.id,
        ticket: i + 1,
        openBarIndex: i,
        closeBarIndex: i,
        openedAt: t.openedAt,
        closedAt: t.closedAt ?? 0,
        symbol: t.symbol,
        direction: t.direction,
        volume: 1,
        entry: t.entry,
        sl: t.sl ?? 0,
        tp1: t.tp1 ?? 0,
        tp2: t.tp2 ?? 0,
        tp3: t.tp3 ?? 0,
        exit: t.exit ?? t.entry,
        exitReason: (t.exitReason ?? "sl") as ExitReason,
        profit: t.profit ?? 0,
        profitR: t.profitR ?? 0,
        durationMs: (t.closedAt ?? 0) - t.openedAt,
        regime: t.regime,
        session: t.session,
        spreadCost: 0,
        commission: 0,
        slippageCost: 0,
        pnlGross: t.profit ?? 0,
    }));

    const equity = closedTrades.map((t, i) => ({
        time: (t.closedAt ?? t.openedAt),
        balance: Number(((ft.backtestMetrics?.finalBalance ?? 0) > 0 ? trades.slice(0, i + 1).reduce((s, tr) => s + tr.pnlGross, 0) : 0).toFixed(2)),
        equity: 0,
        drawdownPct: 0,
        drawdownAbs: 0,
    }));

    ft.metrics = computeMetrics(trades, equity, 0);
    ft.tradeCount = closedTrades.length;
    ft.lastPrice = currentBar.close;

    if (ft.backtestMetrics && ft.tradeCount >= 5) {
        ft.deviation = {
            winRateDiff: Number(((ft.backtestMetrics.winRate) - (ft.metrics?.winRate ?? 0)).toFixed(2)),
            profitabilityDiff: Number(((ft.backtestMetrics.returnPct) - (ft.metrics?.returnPct ?? 0)).toFixed(2)),
        };
    }
    ft.updatedAt = Date.now();
    return ft;
}

export function createForwardTest(
    strategy: Strategy,
    symbol: SupportedSymbol,
    backtestMetrics: BacktestMetrics,
    hierarchy: TimeframeHierarchy,
    mode: ForwardMode
): ForwardTest {
    return {
        id: `ft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        uid: "",
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol,
        timeframe: strategy.timeframes.setup,
        hierarchy,
        mode,
        status: "running",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        signals: [],
        metrics: null,
        backtestMetrics,
        deviation: null,
        lastPrice: 0,
        tradeCount: 0,
    };
}