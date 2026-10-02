/**
 * AI Execution — expiry sweep.
 *
 * Plans are proposals with a finite validity window. Anything past `expiresAt`
 * that never reached SUBMITTED is CANCELLED (never executed late). Called by
 * the API routes on read and available for a future cron hook.
 *
 * Fail-safe: a sweep error never throws — the next sweep retries.
 */

import type { TradePlan } from "./types";
import { TERMINAL_PLAN_STATUSES } from "./types";
import { listPlans, updatePlan, writeAudit } from "./database";

export async function expireStalePlans(uid: string, now: number = Date.now()): Promise<number> {
    try {
        const plans = await listPlans(uid, 200);
        let expired = 0;
        for (const plan of plans) {
            if (TERMINAL_PLAN_STATUSES.includes(plan.status)) continue;
            if (["SUBMITTED", "OPEN", "MONITORING"].includes(plan.status)) continue;
            if (plan.expiresAt > now) continue;
            await updatePlan(uid, plan.id, { status: "CANCELLED", rejectionReason: "EXPIRED" });
            await writeAudit({
                userId: uid,
                action: "PLAN_EXPIRED",
                planId: plan.id,
                actor: "system",
                reason: "Plan validity window elapsed before execution.",
            });
            expired += 1;
        }
        return expired;
    } catch {
        return 0;
    }
}

/** True when a plan's status allows a transition into `next` (plan lifecycle). */
export function canTransitionPlan(current: TradePlan["status"], next: TradePlan["status"]): boolean {
    const allowed: Record<TradePlan["status"], TradePlan["status"][]> = {
        DRAFT: ["VALIDATING", "CANCELLED"],
        VALIDATING: ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"],
        PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
        APPROVED: ["SUBMITTED", "FAILED", "CANCELLED"],
        SUBMITTED: ["OPEN", "FAILED"],
        OPEN: ["MONITORING", "CLOSED"],
        MONITORING: ["CLOSED"],
        REJECTED: [],
        CLOSED: [],
        CANCELLED: [],
        FAILED: [],
    };
    return allowed[current]?.includes(next) ?? false;
}

/** Plan-status mapping of the Setup Memory lifecycle (traceability). */
export function planStageForSetupMemory(status: TradePlan["status"]): string {
    switch (status) {
        case "DRAFT":
        case "VALIDATING":
            return "TRADE_PLAN";
        case "PENDING_APPROVAL":
            return "WAITING_FOR_APPROVAL";
        case "APPROVED":
        case "SUBMITTED":
            return "AUTOMATION_PENDING_EXECUTION";
        case "OPEN":
        case "MONITORING":
            return "EXECUTED";
        case "CLOSED":
            return "CLOSED";
        default:
            return "INVALIDATED";
    }
}

export type { TradePlan };
