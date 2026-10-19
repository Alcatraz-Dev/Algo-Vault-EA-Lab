import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Server-side entitlement check. Only ever sourced from RTDB subscription
 * state — never from the client.
 *
 * A missing plan is never treated as paid. Entitlement requires an explicit
 * active subscription with a paid plan (or an explicit hasSubscription flag).
 * This is the decision logic, kept pure so it can be unit-tested without the
 * Admin SDK.
 */
export function isProSubscription(sub: unknown): boolean {
    if (!sub || typeof sub !== "object") return false;
    const s = sub as {
        plan?: string;
        status?: string;
        active?: boolean;
        hasSubscription?: boolean;
    };
    const isActive =
        s.status === "active" || s.status === "trialing" || s.active === true;
    if (!isActive) return false;
    const isPaidPlan =
        s.plan === "pro" ||
        s.plan === "elite" ||
        s.plan === "enterprise" ||
        s.plan === "vip" ||
        s.hasSubscription === true;
    return isPaidPlan;
}

/**
 * Server-side entitlement check. Only ever sourced from RTDB subscription
 * state — never from the client.
 */
export async function isProUser(uid: string): Promise<boolean> {
    try {
        const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        return isProSubscription(snap.val());
    } catch {
        return false; // Fail closed: any error = not entitled
    }
}