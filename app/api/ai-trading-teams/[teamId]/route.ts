import { NextRequest } from "next/server";
import {
    authenticateTeams,
    badRequest,
    deny,
    flagDisabled,
    notFound,
    ok,
    readJson,
    serverError,
    unauthorized,
} from "../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import {
    deleteTeam,
    getTeam,
    recordTeamEvent,
    saveTeam,
} from "@/lib/ai-trading-teams/database";
import { listAgentLibrary } from "@/lib/ai-trading-teams/agents";
import { validateAgentIdList, validateTeamConfig, isValidId } from "@/lib/ai-trading-teams/validation";
import type { AITradingTeam, TeamConfig } from "@/lib/ai-trading-teams/types";

async function loadTeam(request: NextRequest) {
    const auth = await authenticateTeams(request);
    if (!auth.uid) return { response: unauthorized(auth.error) };
    const url = new URL(request.url);
    const teamId = url.pathname.split("/").filter(Boolean).slice(-1)[0] ?? "";
    if (!isValidId(teamId)) return { response: badRequest("Invalid team id.") };
    const team = await getTeam(auth.uid, teamId);
    if (!team) {
        // Admins may inspect other users' teams for support purposes.
        if (!auth.isAdmin) return { response: notFound("Team not found.") };
        return { response: notFound("Team not found.") };
    }
    if (team.userId !== auth.uid && !auth.isAdmin) return { response: deny("You do not have access to this team.") };
    return { auth, team };
}

export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const loaded = await loadTeam(request);
    if ("response" in loaded) return loaded.response;
    const { auth, team } = loaded as { auth: { uid: string; isAdmin: boolean }; team: AITradingTeam };
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();
    return ok({ team });
}

export async function PATCH(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const loaded = await loadTeam(request);
    if ("response" in loaded) return loaded.response;
    const { auth, team } = loaded as { auth: { uid: string; isAdmin: boolean }; team: AITradingTeam };
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const body = await readJson(request);
    const updates: Partial<AITradingTeam> = {};

    if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 80);
        if (name.length < 3) return badRequest("Team name must be at least 3 characters.");
        updates.name = name;
    }
    if (body.description !== undefined) updates.description = String(body.description).slice(0, 600);

    if (body.config !== undefined) {
        const validation = validateTeamConfig(body.config);
        if (!validation.valid) return badRequest("Invalid team configuration.", validation.errors);
        updates.config = validation.value as TeamConfig;
    }

    if (body.agentIds !== undefined) {
        const validation = validateAgentIdList(body.agentIds);
        if (!validation.valid) return badRequest("Invalid agent selection.", validation.errors);
        const agentIds = validation.value as string[];
        const library = await listAgentLibrary(team.userId);
        const libraryIds = new Set(library.map((a) => a.id));
        const unresolved = agentIds.filter((id) => !libraryIds.has(id));
        if (unresolved.length) return badRequest("Unknown agent(s) in selection.", { unresolved });
        updates.agentIds = agentIds.includes("chief-analyst") ? agentIds : [...agentIds, "chief-analyst"];
        // Re-pin agent versions after membership changes.
        updates.pinnedAgentVersions = Object.fromEntries(
            library.filter((a) => updates.agentIds!.includes(a.id)).map((a) => [a.id, a.version]),
        );
    }

    if (body.status !== undefined) {
        if (!["active", "paused", "archived"].includes(String(body.status))) return badRequest("Invalid status.");
        updates.status = body.status as AITradingTeam["status"];
    }

    const updated: AITradingTeam = {
        ...team,
        ...updates,
        userId: team.userId, // ownership is immutable
        version: Object.keys(updates).length > 0 ? team.version + 1 : team.version,
        updatedAt: Date.now(),
    };

    try {
        await saveTeam(updated);
        await recordTeamEvent({
            type: "team_updated",
            userId: auth.uid,
            teamId: updated.id,
            meta: { fields: Object.keys(updates).join(","), version: updated.version },
        });
        return ok({ team: updated });
    } catch (err) {
        console.error("[ai-trading-teams] update failed:", err);
        return serverError("Failed to update team.");
    }
}

export async function DELETE(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const loaded = await loadTeam(request);
    if ("response" in loaded) return loaded.response;
    const { auth, team } = loaded as { auth: { uid: string; isAdmin: boolean }; team: AITradingTeam };
    try {
        const deleted = await deleteTeam(team.userId, team.id);
        if (!deleted) return notFound("Team not found.");
        await recordTeamEvent({ type: "team_deleted", userId: auth.uid, teamId: team.id });
        return ok({ deleted: true });
    } catch (err) {
        console.error("[ai-trading-teams] delete failed:", err);
        return serverError("Failed to delete team.");
    }
}
