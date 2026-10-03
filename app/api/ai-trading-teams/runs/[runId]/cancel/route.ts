import { NextRequest } from "next/server";
import { authenticateTeams, badRequest, deny, flagDisabled, notFound, ok, unauthorized } from "../../../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { getRun, requestRunCancellation, recordTeamEvent } from "@/lib/ai-trading-teams/database";
import { isValidId } from "@/lib/ai-trading-teams/validation";

/**
 * POST /api/ai-trading-teams/runs/{runId}/cancel
 *
 * Sets a cancellation flag the orchestrator checks cooperatively between
 * agents, so an in-flight run stops at the next safe boundary instead of
 * burning more AI budget.
 */
export async function POST(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const runId = parts[parts.length - 2] ?? "";
    if (!isValidId(runId)) return badRequest("Invalid run id.");

    try {
        const run = await getRun(auth.uid, runId);
        if (!run) return notFound("Run not found.");
        if (run.userId !== auth.uid && !auth.isAdmin) return deny("You do not have access to this run.");
        if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
            return ok({ cancelled: false, status: run.status, reason: "Run already finished." });
        }

        await requestRunCancellation(auth.uid, runId);
        await recordTeamEvent({ type: "team_run_cancelled", userId: auth.uid, teamId: run.teamId, runId });
        return ok({ cancelled: true, status: "cancelling" });
    } catch (err) {
        console.error("[ai-trading-teams] cancel failed:", err);
        return badRequest("Failed to cancel run.");
    }
}
