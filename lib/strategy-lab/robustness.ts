import { BacktestMetrics, OptimizationOutcome, RobustnessScore, ValidationOutcome } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Robustness score.
//
// Combines metrics from the backtest, out-of-sample validation and grid-search
// optimization stability into a single 0-100 score with a letter grade.
//
//   A  ≥ 75,  B  ≥ 55,  C  ≥ 35,  D  < 35
//
// The score is intentionally conservative. A strategy with strong backtest
// numbers but heavy degradation out-of-sample scores poorly.
// ─────────────────────────────────────────────────────────────────────────────

export function computeRobustness(
    backtestMetrics: BacktestMetrics | null,
    validation: ValidationOutcome | null,
    optimization: OptimizationOutcome | null
): RobustnessScore {
    const notes: string[] = [];

    // 1. Trade consistency — win rate oriented.
    let consistency = 0;
    if (backtestMetrics && backtestMetrics.totalTrades > 0) {
        const winRate = backtestMetrics.winRate;
        consistency = winRate >= 40 ? 90 : winRate >= 30 ? 65 : winRate >= 20 ? 40 : 20;
        if (winRate < 20) notes.push("Win rate is very low; check whether the setup actually has an edge.");
    } else {
        notes.push("No backtest trades recorded — robustness cannot be scored on consistency.");
    }

    // 2. Drawdown control.
    let drawdown = 0;
    if (backtestMetrics && backtestMetrics.totalTrades > 0) {
        drawdown = backtestMetrics.maxDrawdownPct <= 10 ? 90 : backtestMetrics.maxDrawdownPct <= 20 ? 70 : backtestMetrics.maxDrawdownPct <= 35 ? 45 : 20;
        if (backtestMetrics.maxDrawdownPct > 35) notes.push("Maximum drawdown exceeds 35% — position sizing should be reduced.");
    } else {
        drawdown = 25;
        notes.push("No drawdown data available.");
    }

    // 3. Profit factor.
    let profitFactor = 0;
    if (backtestMetrics && backtestMetrics.totalTrades > 0) {
        const pf = backtestMetrics.profitFactor;
        profitFactor = pf >= 1.5 ? 90 : pf >= 1.2 ? 70 : pf >= 1 ? 50 : pf >= 0.8 ? 25 : 10;
        if (pf < 1) notes.push("Profit factor below 1.0 — the strategy is not profitable on historical data.");
    } else {
        profitFactor = 25;
        notes.push("No profit factor data available.");
    }

    // 4. Sample size.
    let sampleSize = 0;
    if (backtestMetrics && backtestMetrics.totalTrades > 0) {
        const trades = backtestMetrics.totalTrades;
        sampleSize = trades >= 200 ? 90 : trades >= 100 ? 70 : trades >= 50 ? 50 : trades >= 20 ? 30 : 10;
        if (trades < 50) notes.push("Fewer than 50 backtest trades — the edge may be statistical noise.");
    } else {
        sampleSize = 10;
        notes.push("No sample available.");
    }

    // 5. Out-of-sample behavior.
    let outOfSample = 0;
    if (validation) {
        const oos = validation.outOfSample.metrics;
        const is = validation.inSample.metrics;
        if (oos && is) {
            const deg = validation.degradation.overall;
            outOfSample = deg < 5 ? 90 : deg < 10 ? 70 : deg < 18 ? 45 : 20;
            if (deg >= 18) notes.push("OOS performance degrades sharply versus in-sample — be skeptical of backtest results.");
            else if (deg < 5) notes.push("Out-of-sample results closely match in-sample — encouraging.");
        }
        // Walk-forward stability
        if (validation.walkForward.enabled && validation.walkForward.windows.length > 0) {
            if (validation.walkForward.stable) notes.push("Walk-forward windows were stable.");
            else notes.push("Walk-forward windows showed instability across time.");
        }
    } else {
        outOfSample = 0;
        notes.push("No out-of-sample validation run — run validation before trusting the strategy.");
    }

    // 6. Parameter sensitivity from optimization grid.
    let parameterSensitivity = 0;
    if (optimization && optimization.results.length > 0) {
        const scores = optimization.results.map((r) => r.score);
        const top = scores.slice(0, Math.max(3, Math.floor(scores.length * 0.25)));
        const bottom = scores.slice(-Math.max(3, Math.floor(scores.length * 0.25)));
        const avgTop = top.reduce((a, b) => a + b, 0) / top.length;
        const avgBottom = bottom.reduce((a, b) => a + b, 0) / bottom.length;
        const spread = avgTop - avgBottom;
        parameterSensitivity = spread < 10 ? 90 : spread < 20 ? 70 : spread < 35 ? 45 : 20;
        if (spread > 25) notes.push("Results are very sensitive to parameter changes — the strategy may overfit.");
    } else {
        parameterSensitivity = 30;
        notes.push("No optimization runs available — parameter sensitivity unknown.");
    }

    // 7. Losing streaks.
    let losingStreaks = 0;
    if (backtestMetrics && backtestMetrics.maxConsecutiveLosses > 0) {
        losingStreaks = backtestMetrics.maxConsecutiveLosses <= 3 ? 90 : backtestMetrics.maxConsecutiveLosses <= 5 ? 70 : backtestMetrics.maxConsecutiveLosses <= 8 ? 45 : 20;
        if (backtestMetrics.maxConsecutiveLosses > 8) notes.push(`Long losing streak (${backtestMetrics.maxConsecutiveLosses}) — psychologically demanding to trade.`);
    } else {
        losingStreaks = 30;
    }

    // Aggregate with equal weights.
    const baseScore =
        consistency * 0.15 +
        drawdown * 0.15 +
        profitFactor * 0.15 +
        sampleSize * 0.10 +
        outOfSample * 0.20 +
        parameterSensitivity * 0.15 +
        losingStreaks * 0.10;

    // Behind-factor deduction when OOS/WF disagree with backtest.
    let score = baseScore;
    if (validation && validation.verdict === "fragile") score -= 20;

    score = Math.max(0, Math.min(100, Math.round(score)));

    const grade: RobustnessScore["grade"] = score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D";

    return {
        score,
        grade,
        factors: {
            consistency: Number(consistency.toFixed(1)),
            drawdown: Number(drawdown.toFixed(1)),
            profitFactor: Number(profitFactor.toFixed(1)),
            sampleSize: Number(sampleSize.toFixed(1)),
            outOfSample: Number(outOfSample.toFixed(1)),
            parameterSensitivity: Number(parameterSensitivity.toFixed(1)),
            losingStreaks: Number(losingStreaks.toFixed(1)),
        },
        notes: Array.from(new Set(notes)).slice(0, 8),
    };
}