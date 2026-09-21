import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Client-side subscription check that delegates to a server endpoint.
 * Direct client-side Realtime DB reads of `users/${uid}/subscription` are
 * blocked by Firebase security rules, so the server (using the Admin SDK)
 * performs the lookup instead.
 */
export async function onSubscriptionChange(uid: string): Promise<{ hasSubscription: boolean; plan: string; status: string }> {
    try {
        const idToken = await auth.currentUser?.getIdToken();
        const headers: Record<string, string> = {};
        if (idToken) {
            headers.Authorization = `Bearer ${idToken}`;
        }
        const res = await fetch("/api/subscription-status", { headers });
        if (!res.ok) {
            return { hasSubscription: false, plan: "free", status: "none" };
        }
        const data = await res.json();
        return {
            hasSubscription: Boolean(data.hasSubscription),
            plan: data.plan || "free",
            status: data.status || "none",
        };
    } catch {
        return { hasSubscription: false, plan: "free", status: "none" };
    }
}

export async function getSubscriptionStatus(uid: string): Promise<{ plan: string; status: string; stripeSubscriptionId?: string }> {
    try {
        const idToken = await auth.currentUser?.getIdToken();
        const headers: Record<string, string> = {};
        if (idToken) {
            headers.Authorization = `Bearer ${idToken}`;
        }
        const res = await fetch("/api/subscription-status", { headers });
        if (!res.ok) {
            return { plan: "free", status: "none" };
        }
        const data = await res.json();
        return {
            plan: data.plan || "free",
            status: data.status || "none",
            stripeSubscriptionId: data.stripeSubscriptionId,
        };
    } catch {
        return { plan: "free", status: "none" };
    }
}

export function onAuthSubscription(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback);
}

export const DEVELOPER_PLANS = {
    dev_starter: { name: "Starter", price: 0, platformFee: 0.05 },
    dev_pro: { name: "Developer Pro", price: 19, platformFee: 0.02 },
    dev_enterprise: { name: "Enterprise", price: 49, platformFee: 0 },
};

export const DEVELOPER_PLAN_ORDER: string[] = ["dev_starter", "dev_pro", "dev_enterprise"];

export async function onDeveloperSubscriptionChange(uid: string): Promise<{
    hasSubscription: boolean;
    plan: string;
    status: string;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
}> {
    try {
        const idToken = await auth.currentUser?.getIdToken();
        const headers: Record<string, string> = {};
        if (idToken) {
            headers.Authorization = `Bearer ${idToken}`;
        }
        const url = `/api/subscription-status?subscriber=dev`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
            return { hasSubscription: false, plan: "dev_starter", status: "none" };
        }
        const data = await res.json();
        return {
            hasSubscription: Boolean(data.hasSubscription),
            plan: data.plan || "dev_starter",
            status: data.status || "none",
            stripeSubscriptionId: data.stripeSubscriptionId,
            stripeCustomerId: data.stripeCustomerId,
        };
    } catch {
        return { hasSubscription: false, plan: "dev_starter", status: "none" };
    }
}

export function checkDeveloperEligibility(userData: any, devSub: any): {
    canSell: boolean;
    isApproved: boolean;
    hasActiveSubscription: boolean;
    reason?: string;
} {
    const role = userData?.role || "";
    const isApproved = role === "admin" || userData?.developerApproved === true || userData?.developerStatus === "approved";
    const hasActiveSubscription = role === "admin" || (devSub?.status === "active" && Boolean(devSub?.plan));

    if (!isApproved) {
        return { canSell: false, isApproved: false, hasActiveSubscription, reason: "Developer account pending admin verification." };
    }
    if (!hasActiveSubscription) {
        return { canSell: false, isApproved: true, hasActiveSubscription: false, reason: "Active developer subscription required." };
    }
    return { canSell: true, isApproved: true, hasActiveSubscription: true };
}