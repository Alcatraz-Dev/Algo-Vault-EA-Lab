import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";

export const runtime = "nodejs";

/**
 * GET /api/trading/execute/status?clientRequestId=…
 *
 * Read-only. Returns the stored outcome for one original request so the client
 * can reconcile an unresolved ACCEPTED or UNKNOWN outcome. It never dispatches
 * an execution. The lookup is scoped to the verified user.
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const clientRequestId = (request.nextUrl.searchParams.get("clientRequestId") ?? "").trim();
    if (!clientRequestId) {
        return NextResponse.json(
            { success: false, error: { code: "INVALID_REQUEST", message: "clientRequestId is required." } },
            { status: 400 }
        );
    }

    try {
        const service = createUnifiedTradingService();
        const result = await service.getExecutionStatus(token.uid, clientRequestId);
        if (!result) {
            return NextResponse.json(
                { success: false, error: { code: "NOT_FOUND", message: "No stored outcome for this request." } },
                { status: 404 }
            );
        }
        return NextResponse.json({
            success: true,
            pending: result.status === "ACCEPTED" || result.status === "UNKNOWN",
            result,
        });
    } catch (error) {
        console.error("[trading/execute/status GET]", error);
        return NextResponse.json(
            { success: false, error: { code: "UNKNOWN_PROVIDER_ERROR", message: "Status check failed." } },
            { status: 500 }
        );
    }
}
