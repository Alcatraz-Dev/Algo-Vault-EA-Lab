import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ref, get } from "firebase/database";
import { database } from "@/lib/firebase";

export async function onSubscriptionChange(uid: string): Promise<{ hasSubscription: boolean; plan: string; status: string }> {
  const snap = await get(ref(database, `users/${uid}/subscription`));
  const sub = snap.val();
  if (sub?.status === "active" && (sub?.plan === "pro" || sub?.plan === "enterprise")) {
    return { hasSubscription: true, plan: sub.plan, status: sub.status };
  }
  return { hasSubscription: false, plan: "free", status: "none" };
}

export async function getSubscriptionStatus(uid: string): Promise<{ plan: string; status: string; stripeSubscriptionId?: string }> {
  const snap = await get(ref(database, `users/${uid}/subscription`));
  const sub = snap.val();
  if (sub) {
    return { plan: sub.plan, status: sub.status, stripeSubscriptionId: sub.stripeSubscriptionId };
  }
  return { plan: "free", status: "none" };
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
    const snap = await get(ref(database, `users/${uid}/developerSubscription`));
    const sub = snap.val();
    if (sub?.status === "active" && sub?.plan) {
        return {
            hasSubscription: true,
            plan: sub.plan,
            status: sub.status,
            stripeSubscriptionId: sub.stripeSubscriptionId,
            stripeCustomerId: sub.stripeCustomerId,
        };
    }
    return { hasSubscription: false, plan: "dev_starter", status: "none" };
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