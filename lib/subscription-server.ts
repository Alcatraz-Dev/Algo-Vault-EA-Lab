import { adminDatabase } from "@/lib/firebase-admin";

export async function getAdminSubscriptionStatus(uid: string): Promise<{ hasSubscription: boolean; plan: string; status: string }> {
    try {
        const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        const sub = snap.val();
        if (sub?.status === "active" && (sub?.plan === "pro" || sub?.plan === "enterprise")) {
            return { hasSubscription: true, plan: sub.plan, status: sub.status };
        }
    } catch (err) {
        console.error("[getAdminSubscriptionStatus]", err);
    }
    return { hasSubscription: false, plan: "free", status: "none" };
}
