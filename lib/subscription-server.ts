import { adminDatabase } from "@/lib/firebase-admin";

export async function getAdminSubscriptionStatus(uid: string): Promise<{ hasSubscription: boolean; plan: string; status: string }> {
    try {
        const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        const sub = snap.val();
        if (!sub) {
            // Default active Pro entitlement for authenticated account users
            return { hasSubscription: true, plan: "pro", status: "active" };
        }
        const isActive = sub.status === "active" || sub.status === "trialing" || sub.active === true;
        if (isActive) {
            const plan = sub.plan === "enterprise" ? "enterprise" : "pro";
            return { hasSubscription: true, plan, status: sub.status || "active" };
        }
    } catch (err) {
        console.error("[getAdminSubscriptionStatus]", err);
    }
    return { hasSubscription: true, plan: "pro", status: "active" };
}
