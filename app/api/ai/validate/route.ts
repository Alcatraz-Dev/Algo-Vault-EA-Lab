import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { runJevValidation, isJevEnabled, type MarketIntelligenceContext } from "@/lib/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/validate
 * Runs Jev structured validation over a compact market context. The client
 * supplies facts only — never credentials, never raw candles.
 *
 * Body: { context: MarketIntelligenceContext, direction: "BUY"|"SELL"|"HOLD", setupQuality?: number }
 */
export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        let uid: string | null = null;
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            uid = decoded.uid;
        } catch {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        if (!uid) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }

        if (!isJevEnabled()) {
            return NextResponse.json({ success: false, error: "JEV_DISABLED" }, { status: 404 });
        }

        const body = (await req.json().catch(() => null)) as
            | { context?: MarketIntelligenceContext; direction?: string; setupQuality?: number }
            | null;
        if (!body?.context || typeof body.context !== "object") {
            return NextResponse.json({ success: false, error: "INVALID_REQUEST", message: "context (MarketIntelligenceContext) is required." }, { status: 400 });
        }
        if (body.context.schema !== "mic-1") {
            return NextResponse.json({ success: false, error: "UNSUPPORTED_CONTEXT_SCHEMA" }, { status: 400 });
        }

        const rawDir = String(body.direction || "HOLD").toUpperCase();
        const direction = rawDir === "BUY" ? "BUY" : rawDir === "SELL" ? "SELL" : "HOLD";
        const setupQuality = typeof body.setupQuality === "number" && body.setupQuality >= 0 && body.setupQuality <= 1 ? body.setupQuality : undefined;

        const jev = await runJevValidation({
            ctx: body.context,
            direction,
            setupQuality,
            userId: uid,
            userTier: "pro",
        });

        return NextResponse.json({
            success: jev.validationStatus === "VALIDATED",
            jev: {
                decision: jev.decision,
                confidence: jev.confidence,
                answers: jev.answers,
                reasoningSummary: jev.reasoningSummary,
                validationStatus: jev.validationStatus,
                reason: jev.reason ?? null,
                provider: jev.provider,
                model: jev.model,
                latency: jev.latency,
                jevPolicyVersion: jev.jevPolicyVersion,
                timestamp: jev.timestamp,
            },
        });
    } catch (err) {
        console.error("[api/ai/validate] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
