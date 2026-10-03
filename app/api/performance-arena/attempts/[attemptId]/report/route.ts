import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../../../_shared";
import { buildReport, ArenaError } from "@/lib/performance-arena/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token, owner-scoped. Report is derived from persisted result +
// trade history; generated only for settled attempts (404/409 otherwise).
export async function GET(request: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        const { attemptId } = await params;
        const report = await buildReport(auth.uid, attemptId);
        if (!report) {
            throw new ArenaError(409, "NOT_SETTLED", "This challenge has not settled yet — the report is generated at settlement.");
        }
        return arenaJson({ report });
    } catch (error) {
        return arenaError(error, "Failed to build the report.");
    }
}
