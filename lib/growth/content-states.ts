/**
 * Growth Engine — marketing task state machine + duplicate-publish guard.
 *
 * Pure module. Task states follow the documented lifecycle:
 *   DRAFT → GENERATING → READY_FOR_REVIEW → APPROVED → SCHEDULED → PUBLISHED
 *   (side states: FAILED, REJECTED; publishable only from APPROVED/SCHEDULED)
 */
import { MARKETING_TASK_STATES, MarketingTaskState } from "./constants";
import { MARKETING_TASK_TRANSITIONS } from "./types";

export function isAllowedTransition(from: MarketingTaskState, to: MarketingTaskState): boolean {
    const allowed = MARKETING_TASK_TRANSITIONS[from];
    return Boolean(allowed && allowed.includes(to));
}

export function canTransition(from: MarketingTaskState, to: MarketingTaskState): { ok: boolean; reason?: string } {
    if (!MARKETING_TASK_STATES.includes(from) || !MARKETING_TASK_STATES.includes(to)) {
        return { ok: false, reason: "Unknown state." };
    }
    if (from === to) return { ok: true };
    if (!isAllowedTransition(from, to)) {
        return { ok: false, reason: `Invalid transition ${from} → ${to}.` };
    }
    return { ok: true };
}

/** States from which content may be published (never from DRAFT/GENERATING). */
export const PUBLISHABLE_STATES: readonly MarketingTaskState[] = ["APPROVED", "SCHEDULED"];

export function isPublishable(state: MarketingTaskState): boolean {
    return PUBLISHABLE_STATES.includes(state);
}

/**
 * Duplicate-publishing guard. Publishing must be idempotent: a task that is
 * already PUBLISHED (with a recorded publish entry for the channel) must not
 * be published again. Returns ok:false when a duplicate would be created.
 */
export function canPublish(task: {
    state: MarketingTaskState;
    publish?: { channel: string; externalId?: string; publishedAt: number; url?: string }[];
    publishAttempts?: { channel: string; at: number; ok: boolean; status?: string; error?: string }[];
}, channel: string): { ok: boolean; reason?: string } {
    if (task.state === "PUBLISHED") {
        const alreadyPublished = (task.publish || []).some((p) => p.channel === channel);
        if (alreadyPublished) {
            return { ok: false, reason: `Already published to ${channel}; refusing duplicate.` };
        }
    }
    if (!isPublishable(task.state)) {
        return { ok: false, reason: `Task state ${task.state} is not publishable.` };
    }
    const lastAttempt = (task.publishAttempts || []).filter((a) => a.channel === channel).at(-1);
    if (lastAttempt && lastAttempt.status === "SUCCESS") {
        return { ok: false, reason: `A successful publish attempt already exists for ${channel}.` };
    }
    return { ok: true };
}

/** Deterministic cap on how many publish attempts a task records per channel. */
export function approveForPublishing(state: MarketingTaskState): { ok: boolean; reason?: string } {
    if (state === "APPROVED" || state === "SCHEDULED") return { ok: true };
    return { ok: false, reason: `Task must be APPROVED or SCHEDULED before publishing (current: ${state}).` };
}