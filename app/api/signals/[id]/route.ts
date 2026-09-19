import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal } from "@/lib/ai-signals/types";
import { isProUser } from "@/lib/ai-signals/access";
import { calculateSignalResult } from "@/lib/ai-signals/results";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await params;

        const signalSnap = await adminDatabase.ref(`aiSignals/${id}`).get();
        if (!signalSnap.exists()) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }

        const signal = signalSnap.val() as AISignal;

        const isPro = await isProUser(user.uid);
        if (signal.tier === "PRO" && !isPro) {
            return NextResponse.json({ error: "PRO signal — upgrade required" }, { status: 403 });
        }

        if (signal.result === "PENDING" && ["STOPPED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED", "EXPIRED", "CANCELLED"].includes(signal.status)) {
            const outcome = calculateSignalResult(signal);
            signal.result = outcome.result;
            signal.resultR = outcome.resultR;
            signal.profitPoints = outcome.profitPoints;
        }

        return NextResponse.json({ success: true, signal });
    } catch (err) {
        console.error("Signals [id] GET error:", err);
        return NextResponse.json({ error: "Failed to load signal" }, { status: 500 });
    }
}