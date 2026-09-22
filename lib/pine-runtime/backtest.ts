import type { Candle } from "@/components/tradingview/TradingChart/types";
import { executePine } from "./runtime";
import type { PineExecutionResult, StrategyTrade } from "./types";
import { computeMetrics } from "@/lib/strategy-lab/metrics";
import type { BacktestMetrics, EquityPoint, BacktestTrade, ExitReason, BacktestDirection } from "@/lib/strategy-lab/types";
import type { Timeframe, MarketCandle } from "@/lib/market-data/types";
import { SYMBOL_SPECS } from "@/lib/ai-signals/symbol-specs";

export type PineBacktestConfig = {
    initialBalance: number;
    commissionPerLot: number;
    slippagePips: number;
    spreadPips: number;
};

export type PineBacktestTrade = {
    id: string;
    symbol: string;
    direction: "long" | "short";
    entry: number;
    exit: number;
    sl: number;
    tp: number;
    profit: number;
    profitPercent: number;
    entryBar: number;
    exitBar: number;
    entryTime: number;
    exitTime: number;
    exitReason: string;
    size: number;
};

export type PineBacktestResult = {
    id: string;
    symbol: string;
    strategyName: string;
    timeframe: string;
    generatedAt: number;
    config: PineBacktestConfig;
    metrics: BacktestMetrics;
    trades: PineBacktestTrade[];
    equity: EquityPoint[];
    barCount: number;
};

export const DEFAULT_PINE_BACKTEST_CONFIG: PineBacktestConfig = {
    initialBalance: 10_000,
    commissionPerLot: 7,
    slippagePips: 1,
    spreadPips: 20,
};

const EXIT_REASON_MAP: Record<string, ExitReason> = {
    manual: "mandatory_exit",
    tp: "tp1",
    sl: "sl",
    end_of_data: "end_of_data",
};

function mapExitReason(reason: string): ExitReason {
    return EXIT_REASON_MAP[reason] ?? "end_of_data";
}

function computeEquityCurve(
    trades: StrategyTrade[],
    candles: Candle[],
    initialBalance: number
): EquityPoint[] {
    const points: EquityPoint[] = [];
    let balance = initialBalance;
    let peak = initialBalance;

    for (let i = 0; i < candles.length; i++) {
        let unrealized = 0;
        for (const t of trades) {
            if (t.exitBar !== undefined && t.exitBar <= i) continue;
            const markPrice = candles[i].close;
            const priceMove = t.direction === "long"
                ? (markPrice - t.entryPrice)
                : (t.entryPrice - markPrice);
            unrealized += priceMove * (t.size || 1);
        }

        const totalEquity = balance + unrealized;
        peak = Math.max(peak, totalEquity);
        const ddAbs = peak > totalEquity ? peak - totalEquity : 0;
        const ddPct = peak > 0 ? (ddAbs / peak) * 100 : 0;

        const closedToday = trades.filter(
            (t) => t.exitBar === i
        );
        for (const t of closedToday) {
            balance += t.pnl || 0;
        }

        points.push({
            time: candles[i].time,
            balance: Number(balance.toFixed(2)),
            equity: Number(totalEquity.toFixed(2)),
            drawdownPct: Number(ddPct.toFixed(2)),
            drawdownAbs: Number(ddAbs.toFixed(2)),
        });
    }

    return points;
}

export function backtestPine(
    source: string,
    candles: Candle[],
    symbol: string,
    timeframe: Timeframe,
    config: Partial<PineBacktestConfig> = {}
): PineBacktestResult {
    const cfg: PineBacktestConfig = { ...DEFAULT_PINE_BACKTEST_CONFIG, ...config };
    const symbolStr = symbol.replace(/^(FX:|XAU:|INDEX:)/, "");

    const result: PineExecutionResult = executePine(source, candles, symbol, timeframe);

    let strategyTrades: StrategyTrade[] = [];
    if (result.strategy) {
        strategyTrades = result.strategy.closed_trades;
    }

    // Canonical cost model (mirrors the Strategy Lab engine, without the
    // contractSize factor — Pine trade size is the engine's unit of size):
    //   entry/exit round-trip spread (once) + slippage (both sides) + flat
    //   commission per lot. Applied as a flat PnL reduction per trade.
    const spec = SYMBOL_SPECS[symbolStr] ?? { pipSize: 0.01, contractSize: 100, typicalSpread: 0.20 };
    const unitCostPerUnit =
        cfg.spreadPips * spec.pipSize +
        cfg.slippagePips * spec.pipSize * 2 +
        cfg.commissionPerLot;

    const costedTrades = strategyTrades.map((t): StrategyTrade => {
        const cost = unitCostPerUnit * (t.size || 1);
        const netPnl = (t.pnl ?? 0) - cost;
        return {
            ...t,
            pnl: netPnl,
            pnlPercent: t.entryPrice > 0 ? (netPnl / t.entryPrice) * 100 : 0,
        };
    });

    const pineTrades: PineBacktestTrade[] = costedTrades.map((t) => ({
        id: t.id,
        symbol: symbolStr,
        direction: t.direction,
        entry: t.entryPrice,
        exit: t.exitPrice ?? t.entryPrice,
        sl: 0,
        tp: 0,
        profit: t.pnl ?? 0,
        profitPercent: t.pnlPercent ?? 0,
        entryBar: t.entryBar,
        exitBar: t.exitBar ?? t.entryBar,
        entryTime: candles[t.entryBar]?.time ?? 0,
        exitTime: t.exitBar !== undefined
            ? (candles[t.exitBar]?.time ?? 0)
            : (candles[t.entryBar]?.time ?? 0),
        exitReason: t.exitReason ?? "manual",
        size: t.size,
    }));

    const metricsTrades: BacktestTrade[] = costedTrades.map((t): BacktestTrade => ({
        id: t.id,
        ticket: 0,
        openBarIndex: t.entryBar,
        closeBarIndex: t.exitBar ?? t.entryBar,
        openedAt: candles[t.entryBar]?.time ?? 0,
        closedAt: t.exitBar !== undefined
            ? (candles[t.exitBar]?.time ?? 0)
            : (candles[t.entryBar]?.time ?? 0),
        symbol: symbolStr,
        direction: t.direction === "long" ? ("BUY" as BacktestDirection) : ("SELL" as BacktestDirection),
        volume: t.size,
        entry: t.entryPrice,
        sl: 0,
        tp1: 0,
        tp2: 0,
        tp3: 0,
        exit: t.exitPrice ?? t.entryPrice,
        exitReason: mapExitReason(t.exitReason ?? "manual"),
        profit: t.pnl ?? 0,
        profitR: 0,
        durationMs: t.exitBar !== undefined
            ? ((candles[t.exitBar]?.time ?? 0) - (candles[t.entryBar]?.time ?? 0))
            : 0,
        regime: "n/a",
        session: "n/a",
        spreadCost: cfg.spreadPips * spec.pipSize * t.size,
        commission: cfg.commissionPerLot * t.size,
        slippageCost: cfg.slippagePips * spec.pipSize * 2 * t.size,
        pnlGross: t.pnl ?? 0,
    }));

    const equityPoints = computeEquityCurve(costedTrades, candles, cfg.initialBalance);
    const metrics = computeMetrics(metricsTrades, equityPoints, cfg.initialBalance);

    if (candles.length >= 2) {
        metrics.buyHoldReturnPct = Number(
            ((candles[candles.length - 1].close / candles[0].close - 1) * 100).toFixed(2)
        );
    }

    return {
        id: `pine-bt-${Date.now().toString(36)}`,
        symbol: symbolStr,
        strategyName: result.title || "Pine Strategy",
        timeframe: timeframe.toString(),
        generatedAt: Date.now(),
        config: cfg,
        metrics,
        trades: pineTrades,
        equity: equityPoints,
        barCount: candles.length,
    };
}

function toPineCandles(marketCandles: MarketCandle[]): Candle[] {
    return marketCandles.map((c) => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
    }));
}

export { toPineCandles };
