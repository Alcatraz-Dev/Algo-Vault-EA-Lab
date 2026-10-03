import { NextRequest } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { isAgentFactoryEnabled } from "@/lib/ai-trading-teams/flags";
import { listAdminAgents, saveAdminAgent, recordTeamEvent } from "@/lib/ai-trading-teams/database";
import { BUILTIN_TEAM_AGENTS } from "@/lib/ai-trading-teams/agent-library";
import { validateAgentDefinition } from "@/lib/ai-trading-teams/validation";
import { listAgentLibrary } from "@/lib/ai-trading-teams/agents";

function factoryDisabled(): Response {
    return Response.json(
        { error: "Admin AI Agent Factory is disabled by feature flag (AI_ADMIN_AGENT_FACTORY_ENABLED)." },
        { status: 423 },
    );
}

/**
 * GET /api/admin/ai-agents
 * Full agent registry: built-ins merged with admin-managed definitions,
 * plus version counts. Admin-only (existing admin auth helper).
 */
export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });

    try {
        const adminAgents = await listAdminAgents();
        const versions: Record<string, number> = {};
        for (const agent of adminAgents) {
            const { listAgentVersions } = await import("@/lib/ai-trading-teams/database");
            const list = await listAgentVersions(agent.id);
            versions[agent.id] = list.length;
        }
        const byId = new Map<string, unknown>();
        for (const builtin of BUILTIN_TEAM_AGENTS) {
            byId.set(builtin.id, { ...builtin, overridden: false });
        }
        for (const agent of adminAgents) {
            byId.set(agent.id, { ...agent, overridden: true });
        }
        return Response.json({
            agents: Array.from(byId.values()),
            adminAgents,
            versions,
        });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to load agents.") }, { status: 500 });
    }
}

/**
 * POST /api/admin/ai-agents
 * Create (or override) an agent definition. Versioned: every write snapshots
 * into `aiAgentVersions/{id}/{version}` for rollback.
 */
export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });
    if (!isAgentFactoryEnabled()) return factoryDisabled();

    try {
        const body = await request.json().catch(() => ({}));
        const validation = validateAgentDefinition(body, { custom: false });
        if (!validation.valid || !validation.value) {
            return Response.json({ error: "Invalid agent definition", details: validation.errors }, { status: 400 });
        }

        const agent = {
            ...(validation.value as import("@/lib/ai-trading-teams/types").TeamAgentDefinition),
            builtin: false,
            createdAt: Date.now(),
            createdBy: admin.uid,
            updatedAt: Date.now(),
        };

        await saveAdminAgent(agent);
        await recordTeamEvent({ type: "agent_created", userId: admin.uid, agentId: agent.id, meta: { version: agent.version } });
        return Response.json({ agent }, { status: 201 });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to create agent.") }, { status: 500 });
    }
}

/** Exposed for the admin UI: which library would a user see right now. */
export async function PUT(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) return Response.json({ error: "Admin access required." }, { status: 403 });
    try {
        const body = await request.json().catch(() => ({}));
        const uid = typeof body.userId === "string" && body.userId ? body.userId : admin.uid;
        const library = await listAgentLibrary(uid);
        return Response.json({ library });
    } catch (err) {
        return Response.json({ error: errMessage(err, "Failed to resolve library.") }, { status: 500 });
    }
}
