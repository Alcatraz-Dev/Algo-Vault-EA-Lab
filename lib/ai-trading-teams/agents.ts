/**
 * Agent definition resolution — merges the three agent sources into the single
 * library a team run executes against:
 *
 *   1. built-ins (this repository, `agent-library.ts`)
 *   2. admin-managed definitions/overrides (`aiAgents/{id}`)
 *   3. the user's custom agents (`userAIAgents/{uid}`)
 *
 * Admin definitions override built-ins of the same id (admin factory wins),
 * and pinned version snapshots are preferred when present so a team keeps the
 * agent configuration it was created with (spec §40).
 */

import { BUILTIN_TEAM_AGENTS, CHIEF_AGENT_ID, getBuiltinTeamAgent } from "./agent-library";
import {
    getAdminAgent,
    getAgentVersion,
    getCustomAgent,
    listAdminAgents,
    listCustomAgents,
} from "./database";
import type { AITradingTeam, TeamAgentDefinition } from "./types";

export interface ResolvedAgents {
    agents: TeamAgentDefinition[];
    missing: { agentId: string; reason: string }[];
}

async function resolveOne(
    uid: string,
    agentId: string,
    pinnedVersions?: Record<string, string>,
): Promise<TeamAgentDefinition | null> {
    // Pinned version snapshot wins (preserves historical configuration).
    const pinned = pinnedVersions?.[agentId];
    if (pinned) {
        const snapshot = await getAgentVersion(agentId, pinned);
        if (snapshot) return { ...snapshot, builtin: snapshot.builtin ?? getBuiltinTeamAgent(agentId) !== undefined };
    }

    const custom = await getCustomAgent(uid, agentId);
    if (custom) return { ...custom, builtin: false };

    const admin = await getAdminAgent(agentId);
    if (admin) return admin;

    return getBuiltinTeamAgent(agentId) ?? null;
}

/** Resolves every agent id on a team (for run execution). */
export async function resolveTeamAgents(team: AITradingTeam): Promise<ResolvedAgents> {
    const agents: TeamAgentDefinition[] = [];
    const missing: { agentId: string; reason: string }[] = [];
    const seen = new Set<string>();

    const ids = [...team.agentIds];
    if (!ids.includes(CHIEF_AGENT_ID) && !ids.some((id) => id === "chief-analyst")) {
        // Teams always get a Chief Analyst — synthesis is mandatory.
        ids.push(CHIEF_AGENT_ID);
    }

    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const agent = await resolveOne(team.userId, id, team.pinnedAgentVersions);
        if (!agent) {
            missing.push({ agentId: id, reason: "Agent definition not found." });
            continue;
        }
        if (agent.enabled === false) {
            missing.push({ agentId: id, reason: "Agent disabled by administrator." });
            continue;
        }
        agents.push(agent);
    }

    return { agents, missing };
}

/** Full library for the UI: built-ins + admin overrides + user custom agents. */
export async function listAgentLibrary(uid: string): Promise<TeamAgentDefinition[]> {
    const [adminAgents, customAgents] = await Promise.all([listAdminAgents(), listCustomAgents(uid)]);
    const byId = new Map<string, TeamAgentDefinition>();
    for (const builtin of BUILTIN_TEAM_AGENTS) byId.set(builtin.id, builtin);
    for (const admin of adminAgents) byId.set(admin.id, admin);
    for (const custom of customAgents) byId.set(custom.id, { ...custom, builtin: false });

    const order = BUILTIN_TEAM_AGENTS.map((a) => a.id);
    return Array.from(byId.values()).sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });
}
