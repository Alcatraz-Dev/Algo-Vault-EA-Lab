import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getUnifiedRouter, isUnifiedIntelligenceEnabled } from "@/lib/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/health
 * Live provider health for authenticated users (terminal panels + admin).
 * Facts only: circuit state, latency EMA, success rate, last error code.
 */
export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        try {
            await adminAuth.verifyIdToken(token);
        } catch {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }

        const router = getUnifiedRouter();
        return NextResponse.json({
            success: true,
            enabled: isUnifiedIntelligenceEnabled(),
            providers: router.healthSnapshots(),
        });
    } catch (err) {
        console.error("[api/ai/health] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
