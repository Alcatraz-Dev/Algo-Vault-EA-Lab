import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal } from "@/lib/ai-signals/types";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const snap = await adminDatabase.ref(`users/${user.uid}/followedSignals`).get();

        if (!snap.exists()) {
            return NextResponse.json({ success: true, signals: [] });
        }

        const followedIds: Record<string, { followedAt: number }> = snap.val();
        const signalIds = Object.keys(followedIds);

        const signals: Array<AISignal & { followedAt: number }> = [];
        for (const id of signalIds) {
            const signalSnap = await adminDatabase.ref(`aiSignals/${id}`).get();
            if (signalSnap.exists()) {
                signals.push({
                    ...(signalSnap.val() as AISignal),
                    followedAt: followedIds[id].followedAt,
                });
            }
        }

        signals.sort((a, b) => b.followedAt - a.followedAt);

        return NextResponse.json({ success: true, signals });
    } catch (err) {
        console.error("AI Signals Follow GET error:", err);
        return NextResponse.json({ error: "Failed to load followed signals" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { signalId, action } = body;

        if (!signalId || !action) {
            return NextResponse.json({ error: "signalId and action required" }, { status: 400 });
        }

        if (action !== "follow" && action !== "unfollow") {
            return NextResponse.json({ error: "action must be 'follow' or 'unfollow'" }, { status: 400 });
        }

        const signalSnap = await adminDatabase.ref(`aiSignals/${signalId}`).get();
        if (!signalSnap.exists()) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }

        if (action === "follow") {
            const followData = {
                followedAt: Date.now(),
                userId: user.uid,
            };
            await adminDatabase.ref(`users/${user.uid}/followedSignals/${signalId}`).set(followData);
            // Reverse index so lifecycle notifications reach followers.
            await adminDatabase.ref(`signalFollowers/${signalId}/${user.uid}`).set(true);

            const currentSignal = signalSnap.val() as AISignal;
            await adminDatabase.ref(`aiSignals/${signalId}`).update({
                followCount: (currentSignal.followCount || 0) + 1,
            });

            return NextResponse.json({ success: true, action: "followed", signalId });
        } else {
            await adminDatabase.ref(`users/${user.uid}/followedSignals/${signalId}`).remove();
            await adminDatabase.ref(`signalFollowers/${signalId}/${user.uid}`).remove();

            const currentSignal = signalSnap.val() as AISignal;
            await adminDatabase.ref(`aiSignals/${signalId}`).update({
                followCount: Math.max(0, (currentSignal.followCount || 1) - 1),
            });

            return NextResponse.json({ success: true, action: "unfollowed", signalId });
        }
    } catch (err) {
        console.error("AI Signals Follow POST error:", err);
        return NextResponse.json({ error: "Failed to follow/unfollow signal" }, { status: 500 });
    }
}
