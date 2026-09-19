import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Server-side entitlement check. Only ever sourced from Firestore/RTDB
 * subscription state — never from the client.
 */
export async function isProUser(uid: string): Promise<boolean> {
    try {
        const snap = await adminDatabase.ref(`users/${uid}/subscription`).get();
        const sub = snap.val();
        return sub?.status === "active" && (sub.plan === "pro" || sub.plan === "enterprise");
    } catch {
        return false;
    }
}