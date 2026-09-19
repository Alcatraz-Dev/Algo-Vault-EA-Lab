import { AISignal, SignalResult, SignalStatus } from "./types";

/**
 * Deterministic signal result engine.
 *
 * Uses the immutable signal snapshot (entry/SL/TPs) and the existing
 * trade-management close model (defaults mirror TradeManagementDefaults:
 * 30/30/30 per target + 10% runner, break-even applied to the remainder
 * once TP1 is hit). Results are recomputable at any time from the stored
 * signal and its events; nothing here mutates the original record.
 *
 * This is NOT a second trade-management engine — it only turns the
 * already-recorded hits + the shared close model into an R-multiple outcome.
 */

export const SIGNAL_CLOSE_PROPORTIONS = {
    tp1: 0.3,
    tp2: 0.3,
    tp3: 0.3,
    runner: 0.1,
} as const;

export type SignalResultOutcome = {
    result: SignalResult;
    resultR: number;
    profitPoints: number;
    riskPoints: number;
};

const TERMINAL_NON_TRADED: SignalStatus[] = ["CANCELLED", "EXPIRED"];

function roundR(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function classify(resultR: number): SignalResult {
    if (resultR > 0.05) return "WIN";
    if (resultR < -0.05) return "LOSS";
    return "BREAKEVEN";
}

/**
 * Computes the R multiple for a single target.
 * R(target) = |target - entry| / |entry - sl|.
 */
export function targetR(
    entry: number,
    sl: number,
    target?: number
): number {
    if (!target) return 0;
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(target - entry);
    if (risk === 0) return 0;
    return reward / risk;
}

export function calculateSignalResult(signal: AISignal): SignalResultOutcome {
    const { status } = signal;

    if (TERMINAL_NON_TRADED.includes(status)) {
        return {
            result: status === "CANCELLED" ? "CANCELLED" : "EXPIRED",
            resultR: 0,
            profitPoints: 0,
            riskPoints: 0,
        };
    }

    const riskPoints = Math.abs(signal.entry - signal.stopLoss);
    if (riskPoints === 0) {
        return { result: "PENDING", resultR: 0, profitPoints: 0, riskPoints: 0 };
    }

    // Active / not yet resolved.
    const tradedEndStates: SignalStatus[] = ["STOPPED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED"];
    if (!tradedEndStates.includes(status)) {
        return { result: "PENDING", resultR: 0, profitPoints: 0, riskPoints };
    }

    const rTp1 = targetR(signal.entry, signal.stopLoss, signal.tp1);
    const rTp2 = targetR(signal.entry, signal.stopLoss, signal.tp2);
    const rTp3 = targetR(signal.entry, signal.stopLoss, signal.tp3);

    const tp1Hit = signal.tp1Hit || status === "TP1_HIT" || status === "TP2_HIT" || status === "TP3_HIT" || status === "RUNNER" || status === "COMPLETED";
    const tp2Hit = signal.tp2Hit || status === "TP2_HIT" || status === "TP3_HIT" || status === "RUNNER" || status === "COMPLETED";
    const tp3Hit = signal.tp3Hit || status === "TP3_HIT" || status === "RUNNER" || status === "COMPLETED";

    const { tp1: c1, tp2: c2, tp3: c3, runner: cr } = SIGNAL_CLOSE_PROPORTIONS;

    let resultR = 0;

    if (tp3Hit) {
        // All targets + runner closed at the last target (conservative).
        resultR = c1 * rTp1 + c2 * rTp2 + (c3 + cr) * rTp3;
    } else if (tp2Hit) {
        // TP1 + TP2 closed, remainder (30% + 10%) moved to break-even.
        resultR = c1 * rTp1 + c2 * rTp2;
    } else if (tp1Hit) {
        if (status === "STOPPED") {
            // TP1 closed, the rest was moved to break-even then stopped at BE.
            resultR = c1 * rTp1;
        } else {
            resultR = c1 * rTp1;
        }
    } else {
        // No target reached.
        resultR = -1;
    }

    const outcomeR = roundR(resultR);
    const profitPoints = roundR(outcomeR * riskPoints);

    return {
        result: classify(outcomeR),
        resultR: outcomeR,
        profitPoints,
        riskPoints,
    };
}