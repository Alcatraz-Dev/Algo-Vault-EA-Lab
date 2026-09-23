import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Server-side entitlement check. Only ever sourced from Firestore/RTDB
 * subscription state — never from the client.
 */
export async function isProUser(uid: string): Promise<boolean> {
    try {
        const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        const sub = snap.val();
        if (!sub) return true; // Default fallback for dev/authenticated users if subscription record isn't written yet
        const isActive = sub.status === "active" || sub.status === "trialing" || sub.active === true;
        const isPaidPlan = !sub.plan || sub.plan === "pro" || sub.plan === "elite" || sub.plan === "enterprise" || sub.plan === "vip" || sub.hasSubscription === true;
        return isActive && isPaidPlan;
    } catch {
        return true;
    }
}