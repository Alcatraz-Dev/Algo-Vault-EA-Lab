import { NextRequest } from "next/server";
import {
    authenticateTeams,
    badRequest,
    deny,
    flagDisabled,
    ok,
    readJson,
    unauthorized,
    serverError,
} from "../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isCustomAgentsEnabled, isAITeamsEnabled, featureFlagSnapshot } from "@/lib/ai-trading-teams/flags";
import { listCustomAgents, saveCustomAgent, createCustomAgentId } from "@/lib/ai-trading-teams/database";
import { validateCustomAgentInput } from "@/lib/ai-trading-teams/validation";
import { recordTeamEvent } from "@/lib/ai-trading-teams/database";
import type { TeamAgentDefinition } from "@/lib/ai-trading-teams/types";

/**
 * Custom agents (spec §16) — Pro only, feature-flagged, strict capability
 * boundaries. User-defined instructions execute inside the same tool
 * allow-list, output validation and evidence protocol as built-ins; they can
 * never grant themselves tools, data access or chief status.
 */
export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    if (!isCustomAgentsEnabled()) return ok({ agents: [], flags: featureFlagSnapshot() });

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    try {
        const agents = await listCustomAgents(auth.uid);
        return ok({ agents, flags: featureFlagSnapshot() });
    } catch (err) {
        console.error("[ai-trading-teams] custom agents list failed:", err);
        return serverError("Failed to load custom agents.");
    }
}

export async function POST(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    if (!isCustomAgentsEnabled()) {
        return Response.json(
            { error: "Custom agents are disabled by feature flag.", flags: featureFlagSnapshot() },
            { status: 423 },
        );
    }

    const auth = await authenticateTeams(request);
    if (!auth.uid) return unauthorized(auth.error);
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const body = await readJson(request);
    const validation = validateCustomAgentInput(body, auth.uid);
    if (!validation.valid || !validation.value) return badRequest("Invalid agent definition.", validation.errors);

    const agent: TeamAgentDefinition = {
        ...(validation.value as TeamAgentDefinition),
        id: createCustomAgentId(auth.uid),
        ownerUid: auth.uid,
        builtin: false,
        createdAt: Date.now(),
        createdBy: auth.uid,
    };

    try {
        const existing = await listCustomAgents(auth.uid);
        if (existing.length >= 10 && !auth.isAdmin) {
            return badRequest("Custom agent limit reached (10). Delete one to create another.");
        }
        await saveCustomAgent(agent);
        await recordTeamEvent({
            type: "custom_agent_created",
            userId: auth.uid,
            agentId: agent.id,
            meta: { category: agent.category, tools: agent.tools.length },
        });
        return ok({ agent }, { status: 201 });
    } catch (err) {
        console.error("[ai-trading-teams] custom agent create failed:", err);
        return serverError("Failed to create custom agent.");
    }
}
