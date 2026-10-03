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
} from "./_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import {
    createTeamId,
    listTeams,
    saveTeam,
    deleteTeam,
    getTeam,
    recordTeamEvent,
    saveMemory,
    emptyMemory,
} from "@/lib/ai-trading-teams/database";
import { listAgentLibrary } from "@/lib/ai-trading-teams/agents";
import { validateAgentIdList, validateTeamConfig, isValidId } from "@/lib/ai-trading-teams/validation";
import { getBuiltinTemplate } from "@/lib/ai-trading-teams/templates";
import { listAdminTemplates } from "@/lib/ai-trading-teams/database";
import type { AITradingTeam, TeamConfig } from "@/lib/ai-trading-teams/types";

const MAX_TEAMS_PER_USER = 20;

export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    try {
        const teams = await listTeams(auth.uid);
        return ok({ teams, hasPro: true });
    } catch (err) {
        console.error("[ai-trading-teams] list failed:", err);
        return serverError("Failed to load teams.");
    }
}

export async function POST(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const body = await readJson(request);

    const name = String(body.name ?? "").trim().slice(0, 80);
    if (name.length < 3) return badRequest("Team name must be at least 3 characters.");

    // Template instantiation (server-side resolution — never trusted from client).
    let configInput: unknown = body.config;
    let agentIdsInput: unknown = body.agentIds;
    const templateId = typeof body.templateId === "string" ? body.templateId : undefined;
    if (templateId) {
        const template =
            getBuiltinTemplate(templateId) ??
            (await listAdminTemplates()).find((t) => t.id === templateId);
        if (!template) return notFound("Template not found.");
        configInput = configInput ?? template.config;
        agentIdsInput = agentIdsInput ?? template.agentIds;
        await recordTeamEvent({ type: "template_used", userId: auth.uid, templateId, meta: { templateName: template.name } });
    }

    const configValidation = validateTeamConfig(configInput);
    if (!configValidation.valid) return badRequest("Invalid team configuration.", configValidation.errors);
    const config = configValidation.value as TeamConfig;

    const agentsValidation = validateAgentIdList(agentIdsInput);
    if (!agentsValidation.valid) return badRequest("Invalid agent selection.", agentsValidation.errors);
    const agentIds = agentsValidation.value as string[];

    try {
        const existing = await listTeams(auth.uid);
        if (existing.length >= MAX_TEAMS_PER_USER && !auth.isAdmin) {
            return badRequest(`Team limit reached (${MAX_TEAMS_PER_USER}). Delete a team to create another.`);
        }

        // Every requested agent must be resolvable for THIS user: built-in,
        // admin-published, or their own custom agent. Never arbitrary ids.
        const library = await listAgentLibrary(auth.uid);
        const libraryIds = new Set(library.map((a) => a.id));
        const unresolved = agentIds.filter((id) => !libraryIds.has(id));
        if (unresolved.length) {
            return badRequest("Unknown agent(s) in selection.", { unresolved });
        }

        const now = Date.now();
        const team: AITradingTeam = {
            id: createTeamId(),
            userId: auth.uid,
            name,
            description: String(body.description ?? "").trim().slice(0, 600),
            config,
            agentIds: agentIds.includes("chief-analyst") ? agentIds : [...agentIds, "chief-analyst"],
            pinnedAgentVersions: Object.fromEntries(
                library.filter((a) => agentIds.includes(a.id) || a.id === "chief-analyst").map((a) => [a.id, a.version]),
            ),
            status: "active",
            version: 1,
            ...(templateId ? { templateId } : {}),
            source: templateId ? "builtin-template" : "generated",
            createdAt: now,
            updatedAt: now,
        };

        await saveTeam(team);
        await saveMemory(emptyMemory(auth.uid, team.id));
        await recordTeamEvent({
            type: "team_created",
            userId: auth.uid,
            teamId: team.id,
            meta: { market: config.market, style: config.style, agents: team.agentIds.length, templateId: templateId ?? "" },
        });

        return ok(team, { status: 201 });
    } catch (err) {
        console.error("[ai-trading-teams] create failed:", err);
        return serverError("Failed to create team.");
    }
}

export async function DELETE(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const teamId = request.nextUrl.searchParams.get("teamId") ?? "";
    if (!isValidId(teamId)) return badRequest("Invalid team id.");
    const team = await getTeam(auth.uid, teamId);
    if (!team && !auth.isAdmin) return notFound("Team not found.");
    const ownerUid = team?.userId ?? auth.uid;
    const deleted = await deleteTeam(ownerUid, teamId);
    if (!deleted) return notFound("Team not found.");
    await recordTeamEvent({ type: "team_deleted", userId: auth.uid, teamId });
    return ok({ deleted: true });
}
