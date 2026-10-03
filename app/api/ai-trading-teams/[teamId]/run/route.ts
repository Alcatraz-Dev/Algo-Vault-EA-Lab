import { NextRequest, after } from "next/server";
import { authenticateTeams, badRequest, deny, flagDisabled, notFound, ok, readJson, serverError, unauthorized } from "../../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { getTeam, recordTeamEvent, saveRun } from "@/lib/ai-trading-teams/database";
import { validateRunMode, isValidId } from "@/lib/ai-trading-teams/validation";
import { executeTeamRun } from "@/lib/ai-trading-teams/execution";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limiter";
import type { AITradingTeam, TeamDataMode, TeamRun } from "@/lib/ai-trading-teams/types";

const MAX_CONCURRENT_RUNS_PER_USER = 3;
const MAX_RUNS_PER_HOUR = 20;

function newRunId(): string {
    return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * POST /api/ai-trading-teams/[teamId]/run
 *
 * Queues a team analysis. The run record is written immediately (so the UI can
 * subscribe to realtime progress on `aiTeamRuns/{uid}/{runId}`) and the actual
 * execution is scheduled with Next.js `after()` so the response returns fast
 * and the UI is never blocked.
 */
export async function POST(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const url = new URL(request.url);
    const teamId = url.pathname.split("/").filter(Boolean).slice(-2)[0] ?? "";
    if (!isValidId(teamId)) return badRequest("Invalid team id.");

    const team = await getTeam(auth.uid, teamId);
    if (!team) return notFound("Team not found.");
    if (team.status !== "active") return badRequest("Team is paused. Activate it before running an analysis.");

    // Rate limits: per-minute burst + hourly budget (cost control).
    const ip = getClientIp(request);
    const burst = checkRateLimit(`ai-teams-run:${auth.uid}:${ip}`, { max: 5, windowMs: 60_000 });
    if (!burst.success) return Response.json({ error: "Too many runs started. Wait a moment." }, { status: 429 });
    const hourly = checkRateLimit(`ai-teams-run-hour:${auth.uid}`, { max: MAX_RUNS_PER_HOUR, windowMs: 60 * 60_000 });
    if (!hourly.success) return Response.json({ error: "Hourly run budget reached. Try again later." }, { status: 429 });

    const body = await readJson(request);
    const modeValidation = validateRunMode({ mode: body.mode ?? "live", asOf: body.asOf });
    if (!modeValidation.valid) return badRequest("Invalid run mode.", modeValidation.errors);
    const { mode, asOf } = modeValidation.value as { mode: TeamDataMode; asOf: number | null };

    const request_text = String(body.request ?? "").trim().slice(0, 600);

    try {
        // Concurrency guard — read current run index for this user.
        const { listRuns } = await import("@/lib/ai-trading-teams/database");
        const recent = await listRuns(auth.uid, 20);
        const active = recent.filter((r) => r.status === "running" || r.status === "queued").length;
        if (active >= MAX_CONCURRENT_RUNS_PER_USER && !auth.isAdmin) {
            return Response.json(
                { error: `Concurrent run limit reached (${MAX_CONCURRENT_RUNS_PER_USER}).`, active },
                { status: 429 },
            );
        }

        const runId = newRunId();
        const now = Date.now();
        const run: TeamRun = {
            id: runId,
            userId: auth.uid,
            teamId: team.id,
            teamName: team.name,
            teamVersion: team.version,
            status: "queued",
            request: request_text || undefined,
            dataMode: mode,
            asOf,
            market: team.config.market,
            config: team.config,
            agentVersions: team.pinnedAgentVersions ?? {},
            startedAt: now,
            finishedAt: null,
            durationMs: null,
            waves: [],
            agentOutputs: {},
            skipped: [],
            timeline: [{ t: now, text: "Run queued.", kind: "info" }],
            consensus: null,
            synthesis: null,
            dossierMeta: null,
            budget: { agentsSelected: 0, agentsExecuted: 0, agentsSkipped: 0, aiCalls: 0, aiFailures: 0 },
            errors: [],
            createdAt: now,
        };

        await saveRun(run);
        await recordTeamEvent({
            type: "team_run_started",
            userId: auth.uid,
            teamId: team.id,
            runId,
            meta: { mode, market: team.config.market, style: team.config.style },
        });

        const uid = auth.uid;
        const pinnedTeam: AITradingTeam = team;
        after(async () => {
            await executeTeamRun({ uid, team: pinnedTeam, runId, request: request_text, dataMode: mode, asOf });
        });

        return ok({ runId, status: "queued", mode, asOf }, { status: 201 });
    } catch (err) {
        console.error("[ai-trading-teams] run start failed:", err);
        return serverError("Failed to start run.");
    }
}

/**
 * GET /api/ai-trading-teams/[teamId]/run — recent runs for one team.
 */
export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const url = new URL(request.url);
    const teamId = url.pathname.split("/").filter(Boolean).slice(-2)[0] ?? "";
    if (!isValidId(teamId)) return badRequest("Invalid team id.");

    try {
        const { listRuns } = await import("@/lib/ai-trading-teams/database");
        const runs = (await listRuns(auth.uid, 50)).filter((r) => r.teamId === teamId);
        return ok({ runs });
    } catch (err) {
        console.error("[ai-trading-teams] runs list failed:", err);
        return serverError("Failed to load runs.");
    }
}
