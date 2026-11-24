/**
 * AlgoVault — bidirectional scalping lanes.
 *
 * One bot, two independently evaluated execution lanes (LONG and SHORT). Both
 * lanes run the SAME strategy configuration through the same feature pipeline;
 * they differ only in the side they trade. This module is the PLANNER: it
 * turns per-side signal evaluations into per-side entry intents and enforces
 * the rules that cannot be expressed by one side alone.
 *
 * Invariants:
 *   • A lane never discards the other lane's signal. If both qualify on the
 *     same bar, both are reported — the execution layer decides.
 *   • Account position accounting is authoritative. On a NETTING account an
 *     opposing entry would reduce or reverse the open position, so it is
 *     BLOCKED, never silently converted.
 *   • UNKNOWN accounting fails closed.
 *   • Per-direction position limits and cooldowns are independent.
 *   • Nothing here approves or submits an order. Every intent still passes the
 *     AI Execution Gate, the canonical Risk Engine and the Unified Trading
 *     Service, which share one account-level budget across both lanes.
 */

import {
    decideOpposingEntry,
    supportsIndependentOpposingPositions,
    type TradingPositionMode,
} from "@/lib/trading/position-mode";
import type { DirectionalScalpingEvaluation, ScalpingSideEvaluation } from "./directional";
import type { ScalpingBotConfig } from "./profiles";

export type ScalpingLaneId = "long" | "short";

/** Open positions per lane, as reported by the gateway (never invented). */
export interface LaneOpenPositions {
    long: number;
    short: number;
}

/** Direction-specific pacing state. */
export interface LanePacingState {
    /** Epoch ms before which this lane may not open a new position. */
    cooldownUntil?: number;
    lastEntryAt?: number | null;
}

export interface LanePacing {
    long?: LanePacingState;
    short?: LanePacingState;
}

export type LaneIntentStatus = "ENTER" | "WAIT" | "BLOCKED";

export type LaneWaitReason =
    | "direction_not_allowed"
    | "no_setup"
    | "low_confidence"
    | "conflicting_entry_rules"
    | "max_positions"
    | "cooldown"
    | "netting_blocked"
    | "unknown_position_mode";

export interface LaneIntent {
    side: ScalpingLaneId;
    status: LaneIntentStatus;
    /** Machine-readable reason; null when the lane may enter. */
    reason: LaneWaitReason | null;
    /** Human-readable explanation for the bot log / UI. */
    detail: string;
    /** Signal quality of this side (0 when it did not fire). */
    confidence: number;
    /** True only when this side may be submitted on this bar. */
    enter: boolean;
}

export interface DirectionalLanePlan {
    positionMode: TradingPositionMode;
    intents: { long: LaneIntent; short: LaneIntent };
    /** True when both lanes may enter on the same bar (hedging accounts). */
    simultaneous: boolean;
    /** Account-level explanation shown in the Trading Terminal. */
    detail: string;
}

export interface LanePlanInput {
    config: ScalpingBotConfig;
    /** Result of `evaluateDirectionalScalping` for the same bar. */
    evaluation: DirectionalScalpingEvaluation;
    /** Authoritative account accounting mode from MT5 metadata. */
    positionMode: TradingPositionMode;
    /** Open positions on this symbol, per lane. */
    open: LaneOpenPositions;
    /** Direction-specific pacing (cooldowns). */
    pacing?: LanePacing;
    /** Wall clock; defaults to the evaluation timestamp. */
    now?: number;
    /**
     * Maximum concurrent positions per lane. Defaults to the bot's own
     * `maxOpenPositions` (platform ceiling: one per instrument per lane).
     */
    maxPositionsPerDirection?: number;
}

function sideIntent(
    side: ScalpingLaneId,
    status: LaneIntentStatus,
    reason: LaneWaitReason | null,
    detail: string,
    confidence: number,
): LaneIntent {
    return { side, status, reason, detail, confidence, enter: status === "ENTER" };
}

/**
 * Evaluate one lane's eligibility given its signal state and account exposure.
 * Pure and side-agnostic; the caller supplies which side it is.
 */
function planLane(
    side: ScalpingLaneId,
    evaluation: ScalpingSideEvaluation,
    input: LanePlanInput,
): LaneIntent {
    const { config, positionMode, open, pacing, now } = input;

    if (!evaluation.evaluated) {
        return sideIntent(
            side,
            "WAIT",
            "direction_not_allowed",
            `The bot is configured for ${config.direction === "long_only" ? "long-only" : "short-only"} trading, so the ${side} lane is not evaluated.`,
            evaluation.confidence,
        );
    }

    if (!evaluation.fired) {
        const reason: LaneWaitReason =
            evaluation.blockedBy === "confidence"
                ? "low_confidence"
                : evaluation.blockedBy === "session" || evaluation.blockedBy === "entry_rules"
                  ? "no_setup"
                  : "no_setup";
        return sideIntent(
            side,
            "WAIT",
            reason,
            `No ${side} setup on this bar (blocked by ${evaluation.blockedBy ?? "entry_rules"}).`,
            evaluation.confidence,
        );
    }

    const maxPerDirection = Math.max(1, Math.floor(input.maxPositionsPerDirection ?? config.maxOpenPositions));
    const openSameSide = side === "long" ? open.long : open.short;
    if (openSameSide >= maxPerDirection) {
        return sideIntent(
            side,
            "BLOCKED",
            "max_positions",
            `${side} already has ${openSameSide} open position(s); the per-direction limit is ${maxPerDirection}.`,
            evaluation.confidence,
        );
    }

    const clock = now ?? input.evaluation.barTimestamp;
    const cooldownUntil = (side === "long" ? pacing?.long : pacing?.short)?.cooldownUntil;
    if (typeof cooldownUntil === "number" && clock < cooldownUntil) {
        return sideIntent(
            side,
            "BLOCKED",
            "cooldown",
            `The ${side} lane is cooling down until ${new Date(cooldownUntil).toISOString()}.`,
            evaluation.confidence,
        );
    }

    const opposing = decideOpposingEntry({
        mode: positionMode,
        side,
        openLong: open.long,
        openShort: open.short,
    });

    if (!opposing.allowed) {
        return sideIntent(
            side,
            "BLOCKED",
            opposing.policy === "netting_blocked" ? "netting_blocked" : "unknown_position_mode",
            opposing.reason,
            evaluation.confidence,
        );
    }

    return sideIntent(
        side,
        "ENTER",
        null,
        `${side} entry permitted (confidence ${evaluation.confidence.toFixed(2)}).`,
        evaluation.confidence,
    );
}

/**
 * Plan both lanes for one closed bar.
 *
 * On a hedging account the two lanes are fully independent: either, both or
 * neither may enter. On a netting (or unknown) account, two qualifying lanes
 * are a genuine conflict — the planner blocks BOTH rather than picking one,
 * because picking would silently drop a signal the strategy produced.
 */
export function planDirectionalLanes(input: LanePlanInput): DirectionalLanePlan {
    const { evaluation, positionMode } = input;

    const long = planLane("long", evaluation.sides.long, input);
    const short = planLane("short", evaluation.sides.short, input);

    const bothWantEntry = long.enter && short.enter;
    const hedging = supportsIndependentOpposingPositions(positionMode);

    if (bothWantEntry && !hedging) {
        const reason: LaneWaitReason =
            positionMode === "NETTING" ? "netting_blocked" : "unknown_position_mode";
        const detail =
            positionMode === "NETTING"
                ? "Both directions qualified, but this is a netting account: only one net position per symbol is possible, so neither entry is submitted."
                : "Both directions qualified, but the account's position accounting mode is unknown, so neither entry is submitted.";

        return {
            positionMode,
            intents: {
                long: sideIntent("long", "BLOCKED", reason, detail, long.confidence),
                short: sideIntent("short", "BLOCKED", reason, detail, short.confidence),
            },
            simultaneous: false,
            detail,
        };
    }

    const simultaneous = hedging && long.enter && short.enter;
    const entering = [long, short].filter((intent) => intent.enter).map((intent) => intent.side);

    const detail = simultaneous
        ? "Long and short both qualified on a hedging account — both entries are submitted independently."
        : entering.length > 0
          ? `${entering.join(" + ")} qualified; the other lane is waiting.`
          : "Neither lane qualifies for entry on this bar.";

    return { positionMode, intents: { long, short }, simultaneous, detail };
}

/**
 * Aggregate the bot's public state from its two lanes.
 *
 * The aggregate never hides a lane: an overall RUNNING bot can still report
 * "LONG: POSITION OPEN · SHORT: WAITING FOR SIGNAL".
 */
export interface LaneSummary {
    long: { status: "POSITION_OPEN" | "SIGNAL_READY" | "WAITING" | "BLOCKED"; openPositions: number };
    short: { status: "POSITION_OPEN" | "SIGNAL_READY" | "WAITING" | "BLOCKED"; openPositions: number };
    /** True only when the account can actually hold both sides at once. */
    canHoldBothDirections: boolean;
}

export function summarizeLanes(plan: DirectionalLanePlan, open: LaneOpenPositions): LaneSummary {
    const statusFor = (intent: LaneIntent, openCount: number): LaneSummary["long"]["status"] =>
        openCount > 0 ? "POSITION_OPEN" : intent.enter ? "SIGNAL_READY" : intent.status === "BLOCKED" ? "BLOCKED" : "WAITING";

    return {
        long: { status: statusFor(plan.intents.long, open.long), openPositions: open.long },
        short: { status: statusFor(plan.intents.short, open.short), openPositions: open.short },
        canHoldBothDirections: supportsIndependentOpposingPositions(plan.positionMode),
    };
}
