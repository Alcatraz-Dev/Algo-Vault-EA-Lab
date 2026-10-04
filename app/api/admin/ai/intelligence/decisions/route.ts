import { NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai/intelligence/decisions?limit=50
 * Recent orchestrated decisions from ai/decisions (newest first).
 * Requires a signed-in admin (custom claim or admin allowlist check used
 * elsewhere in the admin API surface — mirrored from app/api/admin/ai/health).
 */
export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        let uid: string | null = null;
        let isAdmin = false;
        try {
            const decoded = await adminAuth.verifyIdToken(token, true);
            uid = decoded.uid;
            isAdmin = decoded.admin === true || decoded.role === "admin";
        } catch {
            return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
        }
        if (!uid || !isAdmin) {
            return NextResponse.json({ success: false, error: "FORBIDDEN", message: "Admin claim required." }, { status: 403 });
        }

        const url = new URL(req.url);
        const limitRaw = Number(url.searchParams.get("limit") || "50");
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;

        const snap = await adminDatabase.ref("ai/decisions").limitToLast(limit).get();
        const raw = (snap.val() ?? {}) as Record<string, Record<string, unknown>>;

        const decisions = Object.values(raw)
            .map((d) => ({
                requestId: typeof d.requestId === "string" ? d.requestId : "",
                symbol: typeof d.symbol === "string" ? d.symbol : "",
                timeframe: typeof d.timeframe === "string" ? d.timeframe : "",
                direction: typeof d.direction === "string" ? d.direction : "HOLD",
                state: typeof d.state === "string" ? d.state : "UNKNOWN",
                confidence: typeof d.confidence === "number" ? d.confidence : 0,
                validationStatus: typeof d.validationStatus === "string" ? d.validationStatus : "",
                rationale: typeof d.rationale === "string" ? d.rationale : "",
                timestamp: typeof d.timestamp === "number" ? d.timestamp : 0,
                jev:
                    d.jev && typeof d.jev === "object"
                        ? {
                              decision: String((d.jev as Record<string, unknown>).decision ?? ""),
                              confidence: Number((d.jev as Record<string, unknown>).confidence ?? 0),
                              status: String((d.jev as Record<string, unknown>).status ?? ""),
                          }
                        : null,
                llm:
                    d.llm && typeof d.llm === "object"
                        ? {
                              provider: String((d.llm as Record<string, unknown>).provider ?? ""),
                              model: String((d.llm as Record<string, unknown>).model ?? ""),
                          }
                        : null,
                risk:
                    d.risk && typeof d.risk === "object"
                        ? {
                              approved: (d.risk as Record<string, unknown>).approved === true,
                              code: String((d.risk as Record<string, unknown>).code ?? ""),
                          }
                        : null,
            }))
            .sort((a, b) => b.timestamp - a.timestamp);

        return NextResponse.json({ success: true, decisions });
    } catch (err) {
        console.error("[api/admin/ai/intelligence/decisions] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "INTERNAL_ERROR" }, { status: 500 });
    }
}
