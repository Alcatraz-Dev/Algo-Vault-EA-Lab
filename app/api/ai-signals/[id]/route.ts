import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal, SignalEvent, SignalTimelineEvent } from "@/lib/ai-signals/types";
import { calculateSignalResult } from "@/lib/ai-signals/results";
import { isProUser } from "@/lib/ai-signals/access";

// Stored lifecycle events use `eventType` (see SignalEvent); the timeline UI
// renders `SignalTimelineEvent.type`. Map the raw record (either shape) into
// the timeline shape so eventConfig() never sees an unknown type.
function mapEventToTimeline(raw: Record<string, unknown>): SignalTimelineEvent {
    const timestamp = Number(raw.timestamp || 0);
    const id = String(raw.eventId || raw.id || `evt_${timestamp}`);
    const eventType = String(raw.eventType || raw.type || "STATUS_CHANGE");

    let type: SignalTimelineEvent["type"] = "STATUS_CHANGE";
    switch (eventType) {
        case "CREATED":
        case "SETUP_DETECTED":
            type = "SETUP_DETECTED";
            break;
        case "READY":
        case "STATUS_CHANGE":
            type = "STATUS_CHANGE";
            break;
        case "ENTRY_REACHED":
        case "ENTRY_TRIGGERED":
            type = "ENTRY_TRIGGERED";
            break;
        case "TP1_HIT":
            type = "TP1_HIT";
            break;
        case "TP2_HIT":
            type = "TP2_HIT";
            break;
        case "TP3_HIT":
            type = "TP3_HIT";
            break;
        case "STOP_LOSS_HIT":
        case "SL_HIT":
            type = "SL_HIT";
            break;
        case "EXPIRED":
        case "SIGNAL_EXPIRED":
            type = "SIGNAL_EXPIRED";
            break;
        case "CANCELLED":
        case "SIGNAL_INVALIDATED":
            type = "SIGNAL_INVALIDATED";
            break;
        case "COMPLETED":
        case "BE_RECOMMENDED":
        case "MANAGEMENT_UPDATE":
            type = "MANAGEMENT_UPDATE";
            break;
    }

    const message = String(
        raw.message ||
            (() => {
                switch (eventType) {
                    case "CREATED": return "Setup detected on this symbol.";
                    case "READY": return "Signal is ready — watching for entry confirmation.";
                    case "ENTRY_REACHED": return "Entry price reached.";
                    case "TP1_HIT": return "Take profit 1 hit.";
                    case "TP2_HIT": return "Take profit 2 hit.";
                    case "TP3_HIT": return "Take profit 3 hit.";
                    case "STOP_LOSS_HIT": return "Stop loss hit — trade closed.";
                    case "EXPIRED": return "Signal expired.";
                    case "COMPLETED": return "Signal completed.";
                    case "CANCELLED": return "Signal cancelled.";
                    case "BE_RECOMMENDED": return "Break-even recommended.";
                    default: return "Signal status updated.";
                }
            })()
    );

    return { id, timestamp, type, message, metadata: raw.metadata as Record<string, unknown> | undefined };
}

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

        // Server-side tier guard: PRO signals (M1) are only readable by
        // active Pro/Enterprise users.
        const isPro = await isProUser(user.uid);
        if (signal.tier === "PRO" && !isPro) {
            return NextResponse.json({ error: "PRO signal — upgrade required" }, { status: 403 });
        }

        // Deterministic result fallback for signals recorded before results
        // were computed at write time.
        if (signal.result === "PENDING" && ["STOPPED", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "COMPLETED", "EXPIRED", "CANCELLED"].includes(signal.status)) {
            const outcome = calculateSignalResult(signal);
            signal.result = outcome.result;
            signal.resultR = outcome.resultR;
            signal.profitPoints = outcome.profitPoints;
        }

        const eventsSnap = await adminDatabase.ref(`signalEvents/${id}`).get();
        const events: SignalTimelineEvent[] = [];
        eventsSnap.forEach((child) => {
            const raw = child.val();
            if (!raw) return;
            events.push(mapEventToTimeline(raw));
        });
        events.sort((a, b) => b.timestamp - a.timestamp);

        return NextResponse.json({ success: true, signal, events });
    } catch (err) {
        console.error("AI Signal [id] GET error:", err);
        return NextResponse.json({ error: "Failed to load signal" }, { status: 500 });
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await params;
        const body = await request.json();
        const { status, statusMessage } = body;

        const signalSnap = await adminDatabase.ref(`aiSignals/${id}`).get();
        if (!signalSnap.exists()) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }

        const signal = signalSnap.val() as AISignal;

        if (status && status !== "CANCELLED") {
            return NextResponse.json({ error: "Only CANCELLED status is allowed" }, { status: 400 });
        }

        if (signal.status === "CANCELLED") {
            return NextResponse.json({ error: "Signal is already cancelled" }, { status: 400 });
        }

        if (signal.status === "EXPIRED" || signal.status === "STOPPED" || signal.status === "COMPLETED") {
            return NextResponse.json({ error: "Cannot cancel a completed signal" }, { status: 400 });
        }

        const updates: Partial<AISignal> = {
            status: "CANCELLED",
            statusMessage: statusMessage || "Cancelled by user",
            result: "CANCELLED",
            resultR: 0,
            profitPoints: 0,
            completedAt: Date.now(),
            updatedAt: Date.now(),
        };

        await adminDatabase.ref(`aiSignals/${id}`).update(updates);

        const event: SignalTimelineEvent = {
            id: `${id}_CANCELLED_${Date.now()}`,
            timestamp: Date.now(),
            type: "STATUS_CHANGE",
            message: statusMessage || "Signal cancelled by user",
        };
        await adminDatabase.ref(`signalEvents/${id}/${event.id}`).set(event);

        return NextResponse.json({ success: true, signal: { ...signal, ...updates } });
    } catch (err) {
        console.error("AI Signal [id] PUT error:", err);
        return NextResponse.json({ error: "Failed to update signal" }, { status: 500 });
    }
}
