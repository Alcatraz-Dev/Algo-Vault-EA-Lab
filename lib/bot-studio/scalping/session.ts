/**
 * AlgoVault — scalping runtime wiring.
 *
 * Turns a validated scalping profile into the two OPTIONAL seams the bot
 * runtime exposes:
 *
 *   • signalEvaluator — evaluates LONG and SHORT through the canonical entry
 *     evaluator and resolves ENTER/WAIT (see ./directional).
 *   • preSignalCheck  — strategy pacing (see ./pacing).
 *
 * Nothing here approves an order: a fired signal still goes through the AI
 * Execution Gate and the Unified Trading Service exactly like every other bot.
 */

import { createHash } from "node:crypto";
import type { BotDeployment, BotSignal, BotStrategy } from "../types";
import type { BotSignalEvaluator, BotSignalEvaluatorInput } from "../runtime";
import { evaluateDirectionalScalping, type DirectionalScalpingEvaluation } from "./directional";
import { createScalpingPacingCheck } from "./pacing";
import type { ScalpingBotConfig } from "./profiles";

export interface ScalpingSessionOptions {
    /** Legacy single-direction seam (kept for callers that resolve one side). */
    signalEvaluator: BotSignalEvaluator;
    /**
     * Per-side evaluation used by the runtime's independent LONG/SHORT lanes.
     * The runtime plans both lanes from this single bar evaluation.`
     */
    laneEvaluator: (input: BotSignalEvaluatorInput) => DirectionalScalpingEvaluation;
    /** Configuration the lane planner enforces (per-direction limits, cooldown). */
    laneConfig: ScalpingBotConfig;
    preSignalCheck: (signal: BotSignal) => Promise<{ ok: boolean; code?: string; reason?: string }>;
}

export function buildScalpingSessionOptions(input: {
    deployment: BotDeployment;
    config: ScalpingBotConfig;
    magicNumber: number;
}): ScalpingSessionOptions {
    const { deployment, config, magicNumber } = input;

    const signalEvaluator: BotSignalEvaluator = ({ seriesByTF, timestamp }) => {
        const result = evaluateDirectionalScalping(config, seriesByTF, timestamp, {
            now: Date.now(),
        });
        const enter = result.decision === "ENTER" && result.direction !== null;
        return {
            fired: enter,
            direction: enter ? result.direction : null,
            atr: result.atr,
            regime: result.regime,
            waitReason: enter ? undefined : result.reason ?? "no_setup",
            waitDetail: result.detail,
            confidence: enter ? result.confidence : undefined,
        };
    };

    const evaluateLanes: ScalpingSessionOptions["laneEvaluator"] = ({ seriesByTF, timestamp }) =>
        evaluateDirectionalScalping(config, seriesByTF, timestamp, { now: Date.now() });

    return {
        signalEvaluator,
        laneEvaluator: evaluateLanes,
        laneConfig: config,
        preSignalCheck: createScalpingPacingCheck({ deployment, config, magicNumber }),
    };
}

/** Stable fingerprint of a scalping configuration (session cache key). */
export function scalpingConfigFingerprint(config: ScalpingBotConfig): string {
    return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);
}

/** True when a stored BotStrategy is a scalping bot. */
export function isScalpingStrategy(strategy: BotStrategy | null | undefined): boolean {
    return Boolean(strategy?.scalpingConfig);
}
