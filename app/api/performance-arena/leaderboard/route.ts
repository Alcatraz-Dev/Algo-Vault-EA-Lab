import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../_shared";
import { getLeaderboard } from "@/lib/performance-arena/service";
import { isLeaderboardsEnabled } from "@/lib/performance-arena/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

// Auth: bearer token. Ranking is composite (return, drawdown, consistency,
// risk discipline, completion) — never raw profit. PRIVATE profiles are
// excluded before the snapshot is built; no balances or positions exposed.
export async function GET(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;
        if (!isLeaderboardsEnabled()) {
            return arenaJson({ error: "Leaderboards are currently disabled.", code: "LEADERBOARDS_DISABLED" }, 503);
        }
        const snapshot = await getLeaderboard();
        return arenaJson({ snapshot });
    } catch (error) {
        return arenaError(error, "Failed to load the leaderboard.");
    }
}
