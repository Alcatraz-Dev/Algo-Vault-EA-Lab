import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getAdminSubscriptionStatus } from "@/lib/subscription-server";
import { getProSignals, processIncomingTelegramMessage } from "@/features/telegram-signals/signals/signal-engine";

export async function GET(request: NextRequest) {
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
                { error: "Pro subscription required to access AlgoVault Pro Signals", hasPro: false },
                { status: 403 }
            );
        }

        const signals = await getProSignals(uid);

        const normalizedSignals = signals.map((signal) => {
            const tp1 = signal.takeProfits.find((t) => t.index === 1)?.price ?? null;
            const tp2 = signal.takeProfits.find((t) => t.index === 2)?.price ?? null;
            const tp3 = signal.takeProfits.find((t) => t.index === 3)?.price ?? null;

            return {
                ...signal,
                tp1,
                tp2,
                tp3,
                followCount: signal.followCount ?? 0,
            };
        });

        return NextResponse.json({
            success: true,
            hasPro: true,
            signals: normalizedSignals,
        });
    } catch (err: unknown) {
        console.error("[GET /api/pro-signals]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const body = await request.json().catch(() => ({}));
        const { rawText, sourceMetadata, broadcast } = body;

        if (!rawText) {
            return NextResponse.json({ error: "rawText is required" }, { status: 400 });
        }

        const isSystemBroadcast = Boolean(broadcast) && decodedToken.role === "admin";

        const result = await processIncomingTelegramMessage({
            userId: isSystemBroadcast ? "system" : uid,
            rawText,
            sourceMetadata: sourceMetadata || {
                sourceId: "admin_portal",
                sourceType: "telegram_channel",
                channelName: "AlgoVault Pro Signals",
            },
            broadcast: isSystemBroadcast,
        });

        return NextResponse.json(result);
    } catch (err: unknown) {
        console.error("[POST /api/pro-signals]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const { searchParams } = new URL(request.url);
        const signalId = searchParams.get("signalId");
        const clearAll = searchParams.get("clearAll");

        const { deleteProSignal, clearProSignals } = await import("@/features/telegram-signals/signals/signal-engine");

        if (clearAll === "true") {
            await clearProSignals(uid);
            if (decodedToken.role === "admin") {
                await clearProSignals("system");
            }
            return NextResponse.json({ success: true, message: "All signals cleared." });
        }

        if (!signalId) {
            return NextResponse.json({ error: "signalId parameter is required" }, { status: 400 });
        }

        await deleteProSignal(uid, signalId);
        if (decodedToken.role === "admin") {
            await deleteProSignal("system", signalId);
        }

        return NextResponse.json({ success: true, message: "Signal deleted successfully." });
    } catch (err: unknown) {
        console.error("[DELETE /api/pro-signals]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}