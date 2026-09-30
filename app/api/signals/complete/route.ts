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

        // Did the trade ever actually enter? Manually completing a signal that
        // never triggered is a cancellation, not a trade: the results engine
        // would otherwise resolve COMPLETED+no-TP-hits as a full +1R WIN and
        // inflate the win rate.
        const enteredStatuses = ["ENTRY_TRIGGERED", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER"];
        const hadEntered = enteredStatuses.includes(signal.status) || signal.tp1Hit === true || signal.tp2Hit === true || signal.tp3Hit === true;

        if (!manualResult && !hadEntered) {
            const updates: Partial<AISignal> = {
                status: "CANCELLED",
                result: "CANCELLED",
                resultR: 0,
                profitPoints: 0,
                completedAt: now,
                closedAt: now,
                updatedAt: now,
            };
            await adminDatabase.ref(`aiSignals/${signalId}`).update(updates);

            const event = {
                eventId: `CANCELLED_${now}`,
                signalId,
                eventType: "CANCELLED",
                price: signal.currentPrice || signal.entry,
                timestamp: now,
                metadata: { reason: "manual_close_before_entry" },
            };
            await adminDatabase.ref(`signalEvents/${signalId}/${event.eventId}`).set(event);

            return NextResponse.json({
                success: true,
                signal: { ...signal, ...updates },
                result: "CANCELLED",
                resultR: 0,
                profitPoints: 0,
                cancelledBeforeEntry: true,
            });
        }

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