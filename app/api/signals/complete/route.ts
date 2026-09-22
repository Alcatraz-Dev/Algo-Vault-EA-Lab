import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { calculateSignalResult } from "@/lib/ai-signals/results";
import { isProUser } from "@/lib/ai-signals/access";
import { AISignal, SignalResult } from "@/lib/ai-signals/types";

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const { signalId, result: manualResult } = body;

        if (!signalId) {
            return NextResponse.json({ error: "signalId is required" }, { status: 400 });
        }

        const signalSnap = await adminDatabase.ref(`aiSignals/${signalId}`).get();
        if (!signalSnap.exists()) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }

        const signal = signalSnap.val() as AISignal;

        const isPro = await isProUser(user.uid);
        if (signal.tier === "PRO" && !isPro) {
            return NextResponse.json({ error: "PRO signal — upgrade required" }, { status: 403 });
        }

        if (["COMPLETED", "CANCELLED", "EXPIRED", "STOPPED"].includes(signal.status)) {
            return NextResponse.json({ error: "Signal is already closed" }, { status: 400 });
        }

        const now = Date.now();
        const outcome = calculateSignalResult(signal);

        const result: SignalResult = manualResult && ["WIN", "LOSS", "BREAKEVEN"].includes(manualResult)
            ? manualResult
            : outcome.result;

        const updates: Partial<AISignal> = {
            status: "COMPLETED",
            result,
            resultR: outcome.resultR,
            profitPoints: outcome.profitPoints,
            completedAt: now,
            closedAt: now,
            updatedAt: now,
        };

        await adminDatabase.ref(`aiSignals/${signalId}`).update(updates);

        const event = {
            eventId: `COMPLETED_${Date.now()}`,
            signalId,
            eventType: "COMPLETED",
            price: signal.entry,
            timestamp: now,
            metadata: {
                result,
                resultR: outcome.resultR,
                profitPoints: outcome.profitPoints,
                manualResult: !!manualResult,
            },
        };
        await adminDatabase.ref(`signalEvents/${signalId}/${event.eventId}`).set(event);

        return NextResponse.json({
            success: true,
            signal: { ...signal, ...updates },
            result,
            resultR: outcome.resultR,
            profitPoints: outcome.profitPoints,
        });
    } catch (err: unknown) {
        console.error("Signal complete POST error:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to complete signal" }, { status: 500 });
    }
}