import { NextRequest } from "next/server";
import { authenticateTeams, deny, flagDisabled, ok, unauthorized, serverError } from "../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { listRuns } from "@/lib/ai-trading-teams/database";

/**
 * GET /api/ai-trading-teams/runs — the user's team run history.
 * Ownership is enforced by the per-user path plus a server-side entitlement check.
 */
export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    try {
        const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 50) || 50));
        const runs = await listRuns(auth.uid, limit);
        return ok({ runs });
    } catch (err) {
        console.error("[ai-trading-teams] runs failed:", err);
        return serverError("Failed to load runs.");
    }
}
