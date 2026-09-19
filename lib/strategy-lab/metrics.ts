import { BacktestMetrics, BacktestTrade, EquityPoint } from "./types";

// Standard performance metrics computed from a trade list + equity curve.
// Used by the backtest engine, optimizer, validation, and forward tester so
// every number is comparable across the platform.

export function santized(v: number): number {
    return Number.isFinite(v) ? v : 0;
}

export function computeMetrics(
    trades: BacktestTrade[],
    equity: EquityPoint[],
    initialBalance: number
): BacktestMetrics {
    const netProfit = trades.reduce((s, t) => s + t.pnlGross, 0);
    const grossProfit = trades.filter((t) => t.pnlGross > 0).reduce((s, t) => s + t.pnlGross, 0);
    const grossLoss = Math.abs(trades.filter((t) => t.pnlGross < 0).reduce((s, t) => s + t.pnlGross, 0));

    const winning = trades.filter((t) => t.pnlGross > 0).length;
    const losing = trades.filter((t) => t.pnlGross < 0).length;
    const breakeven = trades.length - winning - losing;
    const winRate = trades.length > 0 ? (winning / trades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

    const winValues = trades.filter((t) => t.pnlGross > 0).map((t) => t.pnlGross);
    const lossValues = trades.filter((t) => t.pnlGross < 0).map((t) => t.pnlGross);
    const averageWin = winValues.length > 0 ? winValues.reduce((a, b) => a + b, 0) / winValues.length : 0;
    const averageLoss = lossValues.length > 0 ? lossValues.reduce((a, b) => a + b, 0) / lossValues.length : 0;
    const expectancy = trades.length > 0 ? netProfit / trades.length : 0;
    const expectancyR = trades.length > 0 ? trades.reduce((s, t) => s + t.profitR, 0) / trades.length : 0;

    const largestWin = trades.length > 0 ? Math.max(...trades.map((t) => t.pnlGross)) : 0;
    const largestLoss = trades.length > 0 ? Math.min(...trades.map((t) => t.pnlGross)) : 0;

    let maxDD = 0;
    let peak = initialBalance;
    let maxDDAbs = 0;
    for (const e of equity) {
        peak = Math.max(peak, e.balance);
        const dd = peak > 0 ? ((peak - e.balance) / peak) * 100 : 0;
        maxDD = Math.max(maxDD, dd);
        maxDDAbs = Math.max(maxDDAbs, peak - e.balance);
    }

    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let cw = 0;
    let cl = 0;
    for (const t of trades) {
        if (t.pnlGross > 0) { cw++; cl = 0; } else if (t.pnlGross < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
        maxConsecutiveWins = Math.max(maxConsecutiveWins, cw);
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, cl);
    }

    const avgDuration = trades.length > 0 ? trades.reduce((s, t) => s + t.durationMs, 0) / trades.length : 0;

    // Per-trade Sharpe-like metric on R multiples.
    let sharpeLike = 0;
    if (trades.length >= 2) {
        const rValues = trades.map((t) => t.profitR);
        const mean = rValues.reduce((a, b) => a + b, 0) / rValues.length;
        const variance = rValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rValues.length;
        const std = Math.sqrt(variance);
        if (std > 0) sharpeLike = (mean / std) * Math.sqrt(trades.length);
    }

    const finalBalance = initialBalance + netProfit;
    const returnPct = initialBalance > 0 ? (netProfit / initialBalance) * 100 : 0;
    const recoveryFactor = maxDDAbs > 0 ? netProfit / maxDDAbs : netProfit > 0 ? Number.POSITIVE_INFINITY : 0;

    const longs = trades.filter((t) => t.direction === "BUY");
    const shorts = trades.filter((t) => t.direction === "SELL");
    const longWinRate = longs.length > 0 ? (longs.filter((t) => t.pnlGross > 0).length / longs.length) * 100 : 0;
    const shortWinRate = shorts.length > 0 ? (shorts.filter((t) => t.pnlGross > 0).length / shorts.length) * 100 : 0;

    return {
        totalTrades: trades.length,
        winningTrades: winning,
        losingTrades: losing,
        breakevenTrades: breakeven,
        winRate: Number(winRate.toFixed(2)),
        netProfit: Number(netProfit.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        grossLoss: Number(grossLoss.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
        averageWin: Number(averageWin.toFixed(2)),
        averageLoss: Number(averageLoss.toFixed(2)),
        expectancy: Number(expectancy.toFixed(2)),
        expectancyR: Number(expectancyR.toFixed(3)),
        largestWin: Number(largestWin.toFixed(2)),
        largestLoss: Number(largestLoss.toFixed(2)),
        maxDrawdownPct: Number(maxDD.toFixed(2)),
        maxDrawdownAbs: Number(maxDDAbs.toFixed(2)),
        maxConsecutiveWins,
        maxConsecutiveLosses,
        averageTradeDurationMs: Number(avgDuration.toFixed(0)),
        returnPct: Number(returnPct.toFixed(2)),
        finalBalance: Number(finalBalance.toFixed(2)),
        sharpeLike: Number(sharpeLike.toFixed(3)),
        recoveryFactor: santized(recoveryFactor),
        buyHoldReturnPct: 0,
        longTrades: longs.length,
        shortTrades: shorts.length,
        longWinRate: Number(longWinRate.toFixed(2)),
        shortWinRate: Number(shortWinRate.toFixed(2)),
    };
}