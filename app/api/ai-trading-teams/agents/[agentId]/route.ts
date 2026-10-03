import { NextRequest } from "next/server";
import { authenticateTeams, badRequest, deny, flagDisabled, notFound, ok, readJson, unauthorized } from "../../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isCustomAgentsEnabled, isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { deleteCustomAgent, getCustomAgent, saveCustomAgent, recordTeamEvent } from "@/lib/ai-trading-teams/database";
import { validateCustomAgentInput, isValidId } from "@/lib/ai-trading-teams/validation";
import type { TeamAgentDefinition } from "@/lib/ai-trading-teams/types";

async function resolve(request: NextRequest) {
    const auth = await authenticateTeams(request);
    if (!auth.uid) return { response: unauthorized(auth.error) };
    if (!isAITeamsEnabled()) return { response: flagDisabled() };
    if (!isCustomAgentsEnabled()) return { response: flagDisabled() };
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return { response: deny() };
    const agentId = request.nextUrl.searchParams.get("agentId") ?? "";
    if (!isValidId(agentId)) return { response: badRequest("Invalid agent id.") };
    const agent = await getCustomAgent(auth.uid, agentId);
    if (!agent) return { response: notFound("Custom agent not found.") };
    if (agent.ownerUid && agent.ownerUid !== auth.uid && !auth.isAdmin) {
        return { response: deny("You do not have access to this agent.") };
    }
    return { auth, agent };
}

export async function GET(request: NextRequest) {
    const resolved = await resolve(request);
    if ("response" in resolved) return resolved.response;
    return ok({ agent: (resolved as { agent: unknown }).agent });
}

export async function PATCH(request: NextRequest) {
    const resolved = await resolve(request);
    if ("response" in resolved) return resolved.response;
    const { auth, agent } = resolved as { auth: { uid: string }; agent: TeamAgentDefinition };

    const body = await readJson(request);
    const validation = validateCustomAgentInput({ ...agent, ...body, id: agent.id }, auth.uid);
    if (!validation.valid || !validation.value) return badRequest("Invalid agent definition.", validation.errors);

    const updated: TeamAgentDefinition = {
        ...(validation.value as TeamAgentDefinition),
        id: agent.id,
        ownerUid: agent.ownerUid ?? auth.uid,
        builtin: false,
        createdAt: agent.createdAt ?? Date.now(),
        createdBy: agent.createdBy ?? auth.uid,
        updatedAt: Date.now(),
    };
    await saveCustomAgent(updated);
    return ok({ agent: updated });
}

export async function DELETE(request: NextRequest) {
    const resolved = await resolve(request);
    if ("response" in resolved) return resolved.response;
    const { auth, agent } = resolved as { auth: { uid: string }; agent: TeamAgentDefinition };
    const deleted = await deleteCustomAgent(agent.ownerUid ?? auth.uid, agent.id);
    if (!deleted) return notFound("Custom agent not found.");
    await recordTeamEvent({ type: "custom_agent_deleted", userId: auth.uid, agentId: agent.id });
    return ok({ deleted: true });
}
