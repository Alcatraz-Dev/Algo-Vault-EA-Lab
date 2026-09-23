/**
 * Growth Engine — server-side premium/subscription check.
 *
 * Reuses the existing subscription source of truth:
 * users/{uid}/subscription with status=active and plan in (pro, enterprise).
 * Also accepts developer subscriptions (dev_pro, dev_enterprise) for parity
 * with the existing subscription-status route.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "./constants";

const PLANS = new Set(["pro", "enterprise", "dev_pro", "dev_enterprise"]);

export async function isPremiumUser(uid: string): Promise<boolean> {
    try {
        const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        const sub = snap.val();
        if (sub?.status === "active" && PLANS.has(sub?.plan)) {
            return true;
        }
    } catch {
        // Fail closed: if we cannot read subscription, treat as free
    }
    return false;
}
