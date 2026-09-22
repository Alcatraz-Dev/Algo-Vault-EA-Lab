import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { adminDatabase } from "@/lib/firebase-admin";
import { getAdminSubscriptionStatus } from "@/lib/subscription-server";
import type { ProSignal, SignalEvent } from "@/features/telegram-signals/types";

function mapProEventToTimeline(raw: Record<string, unknown>) {
    const timestamp = Number(raw.timestamp || 0);
    const id = String(raw.id || raw.eventId || `evt_${timestamp}`);
    const eventType = String(raw.type || raw.eventType || "UNKNOWN");

    let type: string = eventType;
    let message = String(raw.message || "");

    switch (eventType) {
        case "CREATED":
            type = "SETUP_DETECTED";
            message = message || "Signal created from Telegram message.";
            break;
        case "PENDING_ENTRY":
            type = "STATUS_CHANGE";
            message = message || "Signal pending entry.";
            break;
        case "ENTRY_TRIGGERED":
            type = "ENTRY_TRIGGERED";
            message = message || "Entry price triggered.";
            break;
        case "TP1_HIT":
        case "TP2_HIT":
        case "TP3_HIT":
        case "TP4_HIT":
        case "TP5_OPEN_RUNNER":
            type = eventType;
            message = message || `Take profit ${eventType.replace("_", " ")} hit.`;
            break;
        case "BE_PROFIT_LOCK":
            type = "BE_RECOMMENDED";
            message = message || "Break-even lock activated.";
            break;
        case "HIT_SL":
        case "STOPPED":
            type = "SL_HIT";
            message = message || "Stop loss hit — trade closed.";
            break;
        case "CLOSE_SIGNAL":
        case "CLOSED":
            type = "COMPLETED";
            message = message || "Signal closed.";
            break;
        case "CANCEL":
        case "CANCELLED":
            type = "SIGNAL_INVALIDATED";
            message = message || "Signal cancelled.";
            break;
        case "EXPIRE":
        case "EXPIRED":
            type = "SIGNAL_EXPIRED";
            message = message || "Signal expired.";
            break;
        case "MOVE_BE":
        case "MOVE_SL":
            type = "MANAGEMENT_UPDATE";
            message = message || "Signal management updated.";
            break;
    }

    return {
        id,
        timestamp,
        type,
        message,
        metadata: raw.metadata as Record<string, unknown> | undefined,
    };
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const subStatus = await getAdminSubscriptionStatus(uid);
        if (!subStatus.hasSubscription && decodedToken.role !== "admin") {
            return NextResponse.json(
                { error: "Pro subscription required", hasPro: false },
                { status: 403 }
            );
        }

        const { id } = await params;

        // Check user's signals first
        const signalSnap = await adminDatabase.ref(`telegramSignals/${uid}/${id}`).get();
        let signal: ProSignal | null = signalSnap.exists() ? (signalSnap.val() as ProSignal) : null;

        // If not found in user's signals, check system/broadcast signals
        if (!signal) {
            const systemSnap = await adminDatabase.ref(`telegramSignals/system/${id}`).get();
            if (systemSnap.exists()) {
                signal = systemSnap.val() as ProSignal;
            }
        }

        if (!signal) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }

        const followedSignal = await adminDatabase
            .ref(`users/${uid}/followedProSignals/${id}`)
            .get();
        const followersSnap = await adminDatabase.ref(`proSignalFollowers/${id}`).get();
        const followerCount = followersSnap.exists()
            ? Object.keys(followersSnap.val() as Record<string, true>).length
            : 0;

        // Fetch events from the signal's events array (already embedded)
        const events = signal.events || [];

        // Also check for additional events in the signalEvents node
        const eventsSnap = await adminDatabase.ref(`signalEvents/${id}`).get();
        const extraEvents: SignalEvent[] = [];
        eventsSnap.forEach((child) => {
            const raw = child.val();
            if (!raw) return;
            extraEvents.push(raw as SignalEvent);
        });

        // Merge and sort events by timestamp
        const allEvents = [...events, ...extraEvents].sort((a, b) => b.timestamp - a.timestamp);
        const timelineEvents = allEvents.map((e) => mapProEventToTimeline(e as unknown as Record<string, unknown>));

        // Normalize takeProfits for easier frontend consumption
        const tp1 = signal.takeProfits.find((t) => t.index === 1)?.price ?? null;
        const tp2 = signal.takeProfits.find((t) => t.index === 2)?.price ?? null;
        const tp3 = signal.takeProfits.find((t) => t.index === 3)?.price ?? null;
        const tp4 = signal.takeProfits.find((t) => t.index === 4)?.price ?? null;
        const tp5 = signal.takeProfits.find((t) => t.index === 5)?.price ?? null;

        // Calculate risk:reward
        const riskReward = signal.stopLoss !== 0 && signal.entry !== 0 && tp1
            ? Number((Math.abs(signal.entry - signal.stopLoss) / Math.abs(signal.entry - tp1)).toFixed(2))
            : 0;

        // Map Pro signal status to display-friendly status
        const statusMap: Record<string, string> = {
            CREATED: "NEW",
            PENDING_ENTRY: "READY",
            ENTRY_TRIGGERED: "ACTIVE",
            TP1_HIT: "TP1_HIT",
            BE_PROFIT_LOCK: "RUNNER",
            TP2_HIT: "TP2_HIT",
            TP3_HIT: "TP3_HIT",
            TP4_HIT: "TP4_HIT",
            TP5_OPEN_RUNNER: "RUNNER",
            CLOSED: "COMPLETED",
            STOPPED: "STOPPED",
            EXPIRED: "EXPIRED",
            CANCELLED: "CANCELLED",
            NEEDS_REVIEW: "READY",
            INVALID: "CANCELLED",
            UNKNOWN: "WATCH",
        };

        // Build normalized signal for frontend
        const normalizedSignal = {
            ...signal,
            tp1,
            tp2,
            tp3,
            tp4,
            tp5,
            riskReward,
            displayStatus: statusMap[signal.status] || signal.status,
            tier: "PRO" as const,
            category: signal.symbol.toUpperCase().includes("XAU") || signal.symbol.toUpperCase().includes("GOLD")
                ? "gold"
                : signal.symbol.toUpperCase().includes("BTC") || signal.symbol.toUpperCase().includes("ETH")
                    ? "crypto"
                    : signal.symbol.toUpperCase().includes("US30") || signal.symbol.toUpperCase().includes("NAS") || signal.symbol.toUpperCase().includes("SPX")
                        ? "indices"
                        : "forex",
            suggestedRiskPercent: 1,
            followCount: followerCount,
            isFollowed: followedSignal.exists(),
            tradeCount: 0,
            confidence: signal.parserMetadata?.confidence ?? 0,
            analysis: {},
            confidenceBreakdown: {
                trendAlignment: { score: signal.parserMetadata?.confidence ?? 0, max: 100, detail: "" },
                marketStructure: { score: 0, max: 100, detail: "" },
                liquidity: { score: 0, max: 100, detail: "" },
                momentum: { score: 0, max: 100, detail: "" },
                volume: { score: 0, max: 100, detail: "" },
                orderFlow: { score: 0, max: 100, detail: "" },
                entryConfirmation: { score: signal.parserMetadata?.confidence ?? 0, max: 100, detail: "" },
                total: signal.parserMetadata?.confidence ?? 0,
            },
        };

        return NextResponse.json({ success: true, signal: normalizedSignal, events: timelineEvents });
    } catch (err) {
        console.error("[GET /api/pro-signals/[id]]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load signal" },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const subStatus = await getAdminSubscriptionStatus(uid);
        if (!subStatus.hasSubscription && decodedToken.role !== "admin") {
            return NextResponse.json(
                { error: "Pro subscription required", hasPro: false },
                { status: 403 }
            );
        }

        const { id } = await params;
        const body = await request.json();
        const { action, reason } = body;

        if (!action) {
            return NextResponse.json({ error: "Action is required" }, { status: 400 });
        }

        // Check user's signals first
        const signalSnap = await adminDatabase.ref(`telegramSignals/${uid}/${id}`).get();
        let signal: ProSignal | null = signalSnap.exists() ? (signalSnap.val() as ProSignal) : null;

        if (!signal) {
            const systemSnap = await adminDatabase.ref(`telegramSignals/system/${id}`).get();
            if (systemSnap.exists()) {
                signal = systemSnap.val() as ProSignal;
            }
        }

        if (!signal) {
            return NextResponse.json({ error: "Signal not found" }, { status: 404 });
        }

        // Map action to state machine event
        let eventType: string;
        const eventData: any = { reason };

        switch (action) {
            case "close":
                eventType = "CLOSE_SIGNAL";
                break;
            case "cancel":
                eventType = "CANCEL";
                break;
            case "move_be":
                eventType = "MOVE_BE";
                break;
            case "hit_sl":
                eventType = "HIT_SL";
                break;
            case "expire":
                eventType = "EXPIRE";
                break;
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }

        // Apply state transition using the existing state machine
        const { transitionSignalState } = await import("@/features/telegram-signals/lifecycle/state-machine");
        const { saveProSignal } = await import("@/features/telegram-signals/signals/signal-engine");

        const transition = transitionSignalState(signal, eventType as any, eventData);

        if (!transition.transitioned) {
            return NextResponse.json({ error: "No state transition occurred" }, { status: 400 });
        }

        // Save updated signal
        await saveProSignal(uid, transition.updatedSignal);

        return NextResponse.json({
            success: true,
            signal: transition.updatedSignal,
            event: transition.newEvent,
        });
    } catch (err) {
        console.error("[PATCH /api/pro-signals/[id]]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to update signal" },
            { status: 500 }
        );
    }
}