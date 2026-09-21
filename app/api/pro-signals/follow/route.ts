import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getAdminSubscriptionStatus } from "@/lib/subscription-server";
import type { ProSignal } from "@/features/telegram-signals/types";

type FollowAction = "follow" | "unfollow";

type LocatedSignal = {
    signal: ProSignal;
    path: string;
};

async function locateSignal(uid: string, signalId: string): Promise<LocatedSignal | null> {
    const userSignal = await adminDatabase.ref(`telegramSignals/${uid}/${signalId}`).get();
    if (userSignal.exists()) {
        return { signal: userSignal.val() as ProSignal, path: `telegramSignals/${uid}/${signalId}` };
    }

    const systemSignal = await adminDatabase.ref(`telegramSignals/system/${signalId}`).get();
    if (systemSignal.exists()) {
        return { signal: systemSignal.val() as ProSignal, path: `telegramSignals/system/${signalId}` };
    }

    return null;
}

async function getFollowCount(signalId: string): Promise<number> {
    const followers = await adminDatabase.ref(`proSignalFollowers/${signalId}`).get();
    if (!followers.exists()) return 0;
    return Object.keys(followers.val() as Record<string, true>).length;
}

async function updateFollowCount(path: string, signalId: string): Promise<number> {
    const followCount = await getFollowCount(signalId);
    await adminDatabase.ref(path).update({ followCount });
    return followCount;
}

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const subStatus = await getAdminSubscriptionStatus(user.uid);
        if (!subStatus.hasSubscription && user.role !== "admin") {
            return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
        }

        const followed = await adminDatabase.ref(`users/${user.uid}/followedProSignals`).get();
        const followedIds = followed.exists()
            ? Object.keys(followed.val() as Record<string, { followedAt: number }>)
            : [];

        return NextResponse.json({ success: true, followedIds });
    } catch (err) {
        console.error("[GET /api/pro-signals/follow]", err);
        return NextResponse.json({ error: "Failed to load followed signals" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const subStatus = await getAdminSubscriptionStatus(user.uid);
        if (!subStatus.hasSubscription && user.role !== "admin") {
            return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { signalId, action } = body as { signalId?: unknown; action?: unknown };

        if (typeof signalId !== "string" || !signalId) {
            return NextResponse.json({ error: "signalId is required" }, { status: 400 });
        }

        if (action !== "follow" && action !== "unfollow") {
            return NextResponse.json({ error: "action must be 'follow' or 'unfollow'" }, { status: 400 });
        }

        const located = await locateSignal(user.uid, signalId);
        if (!located) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }

        const followRef = adminDatabase.ref(`users/${user.uid}/followedProSignals/${signalId}`);
        const followerRef = adminDatabase.ref(`proSignalFollowers/${signalId}/${user.uid}`);
        const alreadyFollowing = (await followRef.get()).exists();

        if (action === "follow") {
            if (!alreadyFollowing) {
                await Promise.all([
                    followRef.set({ followedAt: Date.now(), userId: user.uid }),
                    followerRef.set(true),
                ]);
            }

            const followCount = await updateFollowCount(located.path, signalId);
            return NextResponse.json({
                success: true,
                action: "followed",
                followed: true,
                signalId,
                followCount,
            });
        }

        if (alreadyFollowing) {
            await Promise.all([followRef.remove(), followerRef.remove()]);
        }

        const followCount = await updateFollowCount(located.path, signalId);
        return NextResponse.json({
            success: true,
            action: "unfollowed",
            followed: false,
            signalId,
            followCount,
        });
    } catch (err) {
        console.error("[POST /api/pro-signals/follow]", err);
        return NextResponse.json({ error: "Failed to update signal follow state" }, { status: 500 });
    }
}
