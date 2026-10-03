import { NextRequest } from "next/server";
import { authenticateTeams, badRequest, deny, flagDisabled, notFound, ok, unauthorized } from "../../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { getRun, listRuns } from "@/lib/ai-trading-teams/database";
import { isValidId } from "@/lib/ai-trading-teams/validation";

/**
 * GET /api/ai-trading-teams/runs/{runId}
 *
 * Run detail. Ownership is enforced server-side: a run is only readable by its
 * owner (or an admin). Historical runs keep their original configuration and
 * agent versions — they are never rewritten when an agent is updated.
 */
export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const pathSegments = request.nextUrl.pathname.split("/").filter(Boolean);
    const runId =
        request.nextUrl.searchParams.get("runId") ?? pathSegments[pathSegments.length - 1] ?? "";
    const explicitOwner = request.nextUrl.searchParams.get("owner");
    if (!isValidId(runId)) return badRequest("Invalid run id.");

    try {
        // Owner path resolution: prefer the authenticated user's own path.
        let run = await getRun(auth.uid, runId);
        if (!run && auth.isAdmin && explicitOwner && isValidId(explicitOwner)) {
            run = await getRun(explicitOwner, runId);
        }
        if (!run) return notFound("Run not found.");
        if (run.userId !== auth.uid && !auth.isAdmin) return deny("You do not have access to this run.");
        return ok({ run });
    } catch (err) {
        console.error("[ai-trading-teams] run read failed:", err);
        return notFound("Run not found.");
    }
}

/** Lists recent runs across teams for the authenticated user (convenience). */
export async function POST(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();
    const runs = await listRuns(auth.uid, 25);
    return ok({ runs });
}
