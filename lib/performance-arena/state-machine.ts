// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — deterministic lifecycle state machine.
//
// Every status change in the arena goes through `applyTransition`. Invalid
// transitions throw before anything is persisted, and every accepted
// transition is described by an immutable ChallengeEvent payload.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChallengeStatus, ChallengeEvent } from "./types";

/** Explicit transition table. Nothing else is legal. */
const TRANSITIONS: Record<ChallengeStatus, readonly ChallengeStatus[]> = {
    DRAFT: ["AVAILABLE", "ARCHIVED"],
    AVAILABLE: ["DRAFT", "ACTIVE", "ARCHIVED"],
    // AVAILABLE → ACTIVE is the join transition for attempts; definitions
    // additionally allow DRAFT ⇄ AVAILABLE and ARCHIVED.
    ACTIVE: ["PAUSED", "PASSED", "FAILED", "EXPIRED", "CANCELLED"],
    PAUSED: ["ACTIVE", "CANCELLED", "FAILED", "EXPIRED"],
    PASSED: ["ARCHIVED"],
    FAILED: ["ARCHIVED"],
    EXPIRED: ["ARCHIVED"],
    CANCELLED: ["ARCHIVED"],
    ARCHIVED: [],
};

export class InvalidTransitionError extends Error {
    readonly code = "INVALID_STATE_TRANSITION";
    constructor(
        readonly from: ChallengeStatus,
        readonly to: ChallengeStatus
    ) {
        super(`Invalid challenge transition: ${from} → ${to}`);
        this.name = "InvalidTransitionError";
    }
}

export function canTransition(from: ChallengeStatus, to: ChallengeStatus): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: ChallengeStatus): readonly ChallengeStatus[] {
    return TRANSITIONS[from] ?? [];
}

export interface TransitionResult {
    from: ChallengeStatus;
    to: ChallengeStatus;
    changed: boolean;
    event: ChallengeEvent | null;
}

/**
 * Validate and describe a transition. Pure: returns the resulting event
 * payload; the caller persists it alongside the status change.
 */
export function applyTransition(params: {
    attemptId: string;
    from: ChallengeStatus;
    to: ChallengeStatus;
    timestamp: number;
    reason: string;
    eventId: string;
    actor?: string;
    payload?: Record<string, unknown>;
    /** Allow no-op when the status is already the target (idempotent joins). */
    allowNoop?: boolean;
}): TransitionResult {
    const { attemptId, from, to, timestamp, reason, eventId, actor, payload, allowNoop } = params;

    if (from === to) {
        if (allowNoop) return { from, to, changed: false, event: null };
        throw new InvalidTransitionError(from, to);
    }
    if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);

    const event: ChallengeEvent = {
        eventId,
        attemptId,
        type: "STATUS_CHANGE",
        severity: to === "FAILED" || to === "EXPIRED" ? "critical" : "info",
        message: `${from} → ${to}: ${reason}`,
        payload: { from, to, reason, actor: actor ?? "system", ...(payload ?? {}) },
        timestamp,
    };

    return { from, to, changed: true, event };
}
