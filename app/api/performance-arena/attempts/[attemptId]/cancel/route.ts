import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../../_shared";
import { cancelAttempt } from "@/lib/performance-arena/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token, owner-scoped; cancellation goes through the state
// machine (invalid transitions throw before anything is persisted).
export async function POST(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;
        const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
        const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : "Cancelled by user.";
        const attempt = await cancelAttempt(auth.uid, attemptId, reason);
        return arenaJson({ attempt });
    } catch (error) {
        return arenaError(error, "Failed to cancel the challenge.");
    }
}
