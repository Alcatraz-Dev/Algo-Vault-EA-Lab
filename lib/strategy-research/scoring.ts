// ─────────────────────────────────────────────────────────────────────────────
// Transparent research scoring + overfitting/instability detection.
//
// The score is a deterministic blend of MEASURED factors only (profit factor,
// drawdown, OOS degradation, walk-forward stability, Monte Carlo tail,
// robustness grade, sample size). It is a research ranking aid, NOT a
// performance prediction and NOT investment advice. Verdicts come straight
// from the existing engines' outputs.
// ─────────────────────────────────────────────────────────────────────────────

import type {
    CandidateEvaluation,
    CandidateLifecycle,
    RejectionReason,
    ResearchCandidate,
    ResearchMissionSpec,
    ResearchScore,
} from "./types";

export const SURVIVOR_THRESHOLD = 55;

const clamp01 = (v: number) => Math.max(0, Math.min(100, v));

export interface OverfitSignals {
    overfit: boolean;
    unstable: boolean;
    signals: string[];
}

/**
 * Detects overfitting / instability from existing engine outputs:
 *   • IS vs OOS divergence (validation.degradation)
 *   • fragile validation verdict
 *   • walk-forward instability
 *   • Monte Carlo pessimistic tail vs reported metrics
 *   • robustness factor spread
 */
export function detectOverfitting(evaluation: CandidateEvaluation | null): OverfitSignals {
    const signals: string[] = [];
    if (!evaluation || !evaluation.backtest) return { overfit: false, unstable: true, signals: ["No backtest evidence."] };

    let overfit = false;
    let unstable = false;

    const v = evaluation.validation?.outcome;
    if (v) {
        if (v.degradation.overall >= 12) {
            overfit = true;
            signals.push(`OOS degradation ${v.degradation.overall.toFixed(1)} ≥ 12 (in-sample edge did not persist).`);
        }
        if (v.verdict === "fragile") {
            overfit = true;
            signals.push("Validation verdict: fragile.");
        }
        if (v.walkForward.enabled && v.walkForward.windows.length > 0 && !v.walkForward.stable) {
            unstable = true;
            signals.push("Walk-forward windows unstable across time.");
        }
        if (v.inSample.metrics.totalTrades > 0 && v.outOfSample.metrics.totalTrades === 0) {
            unstable = true;
            signals.push("Out-of-sample window produced zero trades.");
        }
    } else {
        unstable = true;
        signals.push("No OOS validation available.");
    }

    const mc = evaluation.monteCarlo?.summary;
    if (mc && mc.profitProbability !== null && mc.profitProbability < 0.35) {
        overfit = true;
        signals.push(`Monte Carlo profit probability ${(mc.profitProbability * 100).toFixed(0)}% < 35%.`);
    }

    const r = evaluation.robustness;
    if (r && r.grade === "D") {
        overfit = true;
        signals.push("Robustness grade D.");
    }

    return { overfit, unstable, signals };
}

/** Deterministic 0–100 research score from measured factors only. */
export function scoreCandidate(
    evaluation: CandidateEvaluation | null,
    spec: ResearchMissionSpec
): { score: ResearchScore | null; rejection: RejectionReason | null; notes: string[] } {
    const notes: string[] = [];
    if (!evaluation || !evaluation.backtest) {
        return { score: null, rejection: "compile_failed", notes: ["No backtest evaluation available."] };
    }
    const m = evaluation.backtest.metrics;

    // Insufficient sample → not rankable, not rejected as overfit.
    if (m.totalTrades < 10) {
        return {
            score: null,
            rejection: "insufficient_trades",
            notes: [`Only ${m.totalTrades} trades — below the 10-trade minimum for ranking.`],
        };
    }

    const overfitSignals = detectOverfitting(evaluation);
    if (overfitSignals.overfit) {
        return { score: null, rejection: "overfit_detected", notes: overfitSignals.signals };
    }

    // ── Factors (all measured) ──
    const profitFactor = clamp01(((m.profitFactor ?? 0) - 0.8) / 0.9 * 100); // 0.8→0, 1.7→100
    const drawdown = clamp01(100 - (m.maxDrawdownPct / (spec.riskProfile === "conservative" ? 15 : spec.riskProfile === "aggressive" ? 30 : 20)) * 100);
    const consistency = clamp01(((m.winRate - 30) / 30) * 100);
    const sampleSize = clamp01((m.totalTrades / 100) * 100);

    const v = evaluation.validation?.outcome ?? null;
    const outOfSample = v ? clamp01(100 - v.degradation.overall * 5) : 0;
    const walkForward =
        v && v.walkForward.enabled
            ? v.walkForward.windows.length > 0
                ? v.walkForward.stabilityScore
                : 0
            : spec.requireWalkForward
                ? 0
                : 50;
    const mc = evaluation.monteCarlo?.summary;
    const monteCarlo =
        mc && mc.profitProbability !== null
            ? clamp01(mc.profitProbability * 100)
            : mc && mc.simulations === 0
                ? 0
                : spec.requireMonteCarlo
                    ? 50
                    : 50;
    const robustness = evaluation.robustness ? evaluation.robustness.score : 0;

    if (spec.requireOOS && !v) notes.push("OOS required by the mission but unavailable.");
    if (spec.requireWalkForward && walkForward === 0) notes.push("Walk-forward required by the mission but unstable/absent.");

    const total = Math.round(
        profitFactor * 0.2 +
        drawdown * 0.15 +
        consistency * 0.1 +
        outOfSample * 0.2 +
        walkForward * 0.1 +
        monteCarlo * 0.1 +
        robustness * 0.1 +
        sampleSize * 0.05
    );

    const verdict: ResearchScore["verdict"] = total >= SURVIVOR_THRESHOLD ? "strong" : total >= 40 ? "acceptable" : total >= 25 ? "weak" : "rejected";

    if (overfitSignals.unstable) notes.push(...overfitSignals.signals);
    notes.push("Research ranking only — not a performance prediction and not investment advice.");

    return {
        score: {
            total,
            factors: {
                profitFactor: Math.round(profitFactor),
                drawdown: Math.round(drawdown),
                consistency: Math.round(consistency),
                outOfSample: Math.round(outOfSample),
                walkForward: Math.round(walkForward),
                monteCarlo: Math.round(monteCarlo),
                robustness: Math.round(robustness),
                sampleSize: Math.round(sampleSize),
            },
            verdict,
            notes: notes.slice(0, 8),
        },
        rejection: null,
        notes,
    };
}

/** Lifecycle + rejection decision for a fully evaluated candidate. */
export function decideLifecycle(
    candidate: ResearchCandidate,
    spec: ResearchMissionSpec
): { lifecycle: CandidateLifecycle; rejectedReason: RejectionReason | null; notes: string[] } {
    if (candidate.compilation && !candidate.compilation.valid) {
        return { lifecycle: "rejected", rejectedReason: "compile_failed", notes: candidate.compilation.errors };
    }
    if (!candidate.evaluation || !candidate.evaluation.backtest) {
        return { lifecycle: "compiled", rejectedReason: null, notes: [] };
    }
    const { score, rejection, notes } = scoreCandidate(candidate.evaluation, spec);
    if (rejection) {
        return { lifecycle: "rejected", rejectedReason: rejection, notes };
    }
    const total = score?.total ?? 0;

    if (spec.requireOOS && !candidate.evaluation.validation) {
        return { lifecycle: "validated", rejectedReason: "oos_failed", notes: ["OOS validation required but missing."] };
    }
    if (spec.requireWalkForward && candidate.evaluation.validation && candidate.evaluation.validation.outcome.walkForward.enabled) {
        if (!candidate.evaluation.validation.outcome.walkForward.stable) {
            return { lifecycle: "validated", rejectedReason: "walk_forward_unstable", notes: ["Walk-forward windows unstable."] };
        }
    }
    if (spec.requireMonteCarlo && candidate.evaluation.monteCarlo) {
        const mc = candidate.evaluation.monteCarlo.summary;
        if (mc.simulations === 0 && mc.sourceTradeCount < 2) {
            return { lifecycle: "stress_tested", rejectedReason: "monte_carlo_fragile", notes: mc.limitations };
        }
    }
    if (total < SURVIVOR_THRESHOLD) {
        return { lifecycle: "ranked", rejectedReason: "below_score_threshold", notes: [`Score ${total} below survivor threshold ${SURVIVOR_THRESHOLD}.`] };
    }
    return { lifecycle: "survivor", rejectedReason: null, notes: notes.length > 0 ? notes : ["Passed all required validation stages."] };
}
