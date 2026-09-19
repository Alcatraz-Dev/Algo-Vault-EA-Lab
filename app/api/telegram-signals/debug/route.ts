import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        // Fetch raw preserved messages for user
        const rawMessagesSnap = await adminDatabase.ref(`telegramMessages/${uid}`).get();
        const rawMessages = rawMessagesSnap.exists() ? Object.values(rawMessagesSnap.val()) : [];

        // Fetch delivery records for user
        const deliveriesSnap = await adminDatabase.ref(`telegramNotificationDeliveries/${uid}`).get();
        const deliveries = deliveriesSnap.exists() ? Object.values(deliveriesSnap.val()) : [];

        // Fetch signals for latency audit
        const signalsSnap = await adminDatabase.ref(`telegramSignals/${uid}`).get();
        const signals = signalsSnap.exists() ? (Object.values(signalsSnap.val()) as any[]) : [];

        const latencies = signals.map((s) => ({
            signalId: s.id,
            symbol: s.symbol,
            receivedAt: s.latency?.receivedAt,
            parsedAt: s.latency?.parsedAt,
            normalizedAt: s.latency?.normalizedAt,
            parserMs: (s.latency?.parsedAt || 0) - (s.latency?.receivedAt || 0),
            normalizerMs: (s.latency?.normalizedAt || 0) - (s.latency?.parsedAt || 0),
        }));

        return NextResponse.json({
            success: true,
            rawMessagesCount: rawMessages.length,
            rawMessagesSample: rawMessages.slice(-10),
            deliveriesSample: deliveries.slice(-10),
            latenciesSample: latencies.slice(-10),
        });
    } catch (err: any) {
        console.error("[GET /api/telegram-signals/debug]", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
