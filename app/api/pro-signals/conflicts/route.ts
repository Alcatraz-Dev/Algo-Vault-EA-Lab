import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getProSignals } from "@/features/telegram-signals/signals/signal-engine";
import { detectSignalConflicts } from "@/features/telegram-signals/conflict/conflict-detector";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const signals = await getProSignals(uid);
        const conflicts = detectSignalConflicts(signals);

        return NextResponse.json({
            success: true,
            conflicts,
        });
    } catch (err: unknown) {
        console.error("[GET /api/pro-signals/conflicts]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
