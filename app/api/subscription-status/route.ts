import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSubPath(uid: string, subscriber: string) {
    return subscriber === "dev"
        ? `users/${uid}/developerSubscription`
        : `users/${uid}/subscription`;
}

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const subscriber = request.nextUrl.searchParams.get("subscriber") || "pro";
        const subPath = getSubPath(uid, subscriber);

        const snap = await adminDatabase.ref(subPath).get();
        const sub = snap.val();

        if (sub?.status === "active" && (sub?.plan === "pro" || sub?.plan === "enterprise" || sub?.plan === "dev_pro" || sub?.plan === "dev_enterprise")) {
            return NextResponse.json({
                hasSubscription: true,
                plan: sub.plan,
                status: sub.status,
                stripeSubscriptionId: sub.stripeSubscriptionId,
                stripeCustomerId: sub.stripeCustomerId,
                currentPeriodEnd: sub.currentPeriodEnd,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                createdAt: sub.createdAt,
                updatedAt: sub.updatedAt,
            });
        }

        return NextResponse.json({ hasSubscription: false, plan: "free", status: "none" });
    } catch (err: unknown) {
        console.error("[GET /api/subscription-status]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}