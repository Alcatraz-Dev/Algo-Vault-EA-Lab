import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../_shared";
import { getAttemptState } from "@/lib/performance-arena/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token; the store path is owner-scoped so a foreign attemptId
// simply 404s. All numbers are computed server-side on this fetch — the
// response is a read-only projection, never an input to accounting.
export async function GET(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;
        const state = await getAttemptState(auth.uid, attemptId);
        return arenaJson(state);
    } catch (error) {
        return arenaError(error, "Failed to load the challenge.");
    }
}
