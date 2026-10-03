/**
 * Firebase Realtime Database access layer for AI Trading Teams.
 *
 * Follows the existing AlgoVault RTDB conventions (server-side admin SDK,
 * `undefined` deep-cleaning, per-user ownership paths). No Firestore.
 *
 * Paths:
 *   aiTradingTeams/{uid}/{teamId}          user teams
 *   aiTradingTeamTemplates/admin/{id}      admin-published templates
 *   userAIAgents/{uid}/{agentId}           user custom agents
 *   aiAgents/{agentId}                     admin-managed agent definitions
 *   aiAgentVersions/{agentId}/{version}    immutable version snapshots
 *   aiTeamRuns/{uid}/{runId}               team runs (server-written only)
 *   aiTeamRunIndex/{runId}                 admin monitoring index
 *   aiTeamMemory/{uid}/{teamId}            structured team memory
 *   aiAgentMetrics/{agentId}               aggregated agent metrics
 *   aiTeamRunControl/{uid}/{runId}         cancellation flags
 *   aiTeamEvents/{eventId}                 product analytics events
 *
 * Client writes are never required: every mutation goes through the API,
 * which enforces authentication, ownership, entitlement and schema validation.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { ServerValue } from "firebase-admin/database";
import type {
    AITradingTeam,
    AITeamAnalyticsEvent,
    AgentRunOutput,
    TeamAgentDefinition,
    TeamMemoryRecord,
    TeamRun,
    TeamRunSummary,
    TeamTemplate,
} from "./types";

const REF = (path: string) => {
    const ref = adminDatabase.ref(path);
    const proxy = Object.create(ref) as typeof ref;
    proxy.set = (value: unknown) => ref.set(deepClean(value));
    proxy.update = (value: unknown) => ref.update(deepClean(value) as Record<string, unknown>);
    return proxy;
};

function deepClean<T>(value: T): T {
    if (value === undefined) return null as unknown as T;
    if (Array.isArray(value)) return value.map((v) => deepClean(v)) as unknown as T;
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            out[key] = deepClean(val);
        }
        return out as T;
    }
    return value;
}

export const AI_TEAMS_PATHS = {
    teams: (uid: string) => `aiTradingTeams/${uid}`,
    team: (uid: string, teamId: string) => `aiTradingTeams/${uid}/${teamId}`,
    templates: () => `aiTradingTeamTemplates/admin`,
    template: (templateId: string) => `aiTradingTeamTemplates/admin/${templateId}`,
    customAgents: (uid: string) => `userAIAgents/${uid}`,
    customAgent: (uid: string, agentId: string) => `userAIAgents/${uid}/${agentId}`,
    agent: (agentId: string) => `aiAgents/${agentId}`,
    agents: () => `aiAgents`,
    agentVersion: (agentId: string, version: string) => `aiAgentVersions/${agentId}/${version}`,
    agentVersions: (agentId: string) => `aiAgentVersions/${agentId}`,
    runs: (uid: string) => `aiTeamRuns/${uid}`,
    run: (uid: string, runId: string) => `aiTeamRuns/${uid}/${runId}`,
    runIndex: (runId: string) => `aiTeamRunIndex/${runId}`,
    runIndexAll: () => `aiTeamRunIndex`,
    memory: (uid: string, teamId: string) => `aiTeamMemory/${uid}/${teamId}`,
    memoryAll: (uid: string) => `aiTeamMemory/${uid}`,
    metrics: (agentId: string) => `aiAgentMetrics/${agentId}`,
    metricsAll: () => `aiAgentMetrics`,
    control: (uid: string, runId: string) => `aiTeamRunControl/${uid}/${runId}`,
    events: () => `aiTeamEvents`,
};

export function isValidRecordId(id: string): boolean {
    return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── teams ──────────────────────────────────────────────────────────────────

export async function listTeams(uid: string): Promise<AITradingTeam[]> {
    const snap = await REF(AI_TEAMS_PATHS.teams(uid)).get();
    const data = (snap.val() || {}) as Record<string, AITradingTeam>;
    return Object.values(data).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function getTeam(uid: string, teamId: string): Promise<AITradingTeam | null> {
    if (!isValidRecordId(teamId)) return null;
    const snap = await REF(AI_TEAMS_PATHS.team(uid, teamId)).get();
    return (snap.val() || null) as AITradingTeam | null;
}

export async function saveTeam(team: AITradingTeam): Promise<void> {
    await REF(AI_TEAMS_PATHS.team(team.userId, team.id)).set(team);
}

export async function deleteTeam(uid: string, teamId: string): Promise<boolean> {
    if (!isValidRecordId(teamId)) return false;
    const snap = await REF(AI_TEAMS_PATHS.team(uid, teamId)).get();
    if (!snap.exists()) return false;
    await REF(AI_TEAMS_PATHS.team(uid, teamId)).remove();
    await REF(AI_TEAMS_PATHS.memoryAll(uid) + `/${teamId}`).remove();
    return true;
}

export function createTeamId(): string {
    return newId("team");
}

// ─── templates ──────────────────────────────────────────────────────────────

export async function listAdminTemplates(): Promise<TeamTemplate[]> {
    const snap = await REF(AI_TEAMS_PATHS.templates()).get();
    const data = (snap.val() || {}) as Record<string, TeamTemplate>;
    return Object.values(data).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function saveAdminTemplate(template: TeamTemplate): Promise<void> {
    await REF(AI_TEAMS_PATHS.template(template.id)).set({ ...template, scope: "admin", updatedAt: Date.now() });
}

export async function deleteAdminTemplate(templateId: string): Promise<boolean> {
    if (!isValidRecordId(templateId)) return false;
    const snap = await REF(AI_TEAMS_PATHS.template(templateId)).get();
    if (!snap.exists()) return false;
    await REF(AI_TEAMS_PATHS.template(templateId)).remove();
    return true;
}

// ─── agents ─────────────────────────────────────────────────────────────────

/** Admin-managed agent definitions (override or extend built-ins). */
export async function listAdminAgents(): Promise<TeamAgentDefinition[]> {
    const snap = await REF(AI_TEAMS_PATHS.agents()).get();
    const data = (snap.val() || {}) as Record<string, TeamAgentDefinition>;
    return Object.values(data);
}

export async function getAdminAgent(agentId: string): Promise<TeamAgentDefinition | null> {
    if (!isValidRecordId(agentId)) return null;
    const snap = await REF(AI_TEAMS_PATHS.agent(agentId)).get();
    return (snap.val() || null) as TeamAgentDefinition | null;
}

export async function saveAdminAgent(agent: TeamAgentDefinition): Promise<void> {
    await REF(AI_TEAMS_PATHS.agent(agent.id)).set({ ...agent, updatedAt: Date.now() });
    await snapshotAgentVersion(agent);
}

export async function deleteAdminAgent(agentId: string): Promise<boolean> {
    if (!isValidRecordId(agentId)) return false;
    const snap = await REF(AI_TEAMS_PATHS.agent(agentId)).get();
    if (!snap.exists()) return false;
    await REF(AI_TEAMS_PATHS.agent(agentId)).remove();
    return true;
}

export async function snapshotAgentVersion(agent: TeamAgentDefinition): Promise<void> {
    await REF(AI_TEAMS_PATHS.agentVersion(agent.id, agent.version)).set({
        ...agent,
        snapshotAt: Date.now(),
    });
}

export async function listAgentVersions(agentId: string): Promise<(TeamAgentDefinition & { snapshotAt?: number })[]> {
    if (!isValidRecordId(agentId)) return [];
    const snap = await REF(AI_TEAMS_PATHS.agentVersions(agentId)).get();
    const data = (snap.val() || {}) as Record<string, TeamAgentDefinition & { snapshotAt?: number }>;
    return Object.values(data).sort((a, b) => (b.snapshotAt ?? 0) - (a.snapshotAt ?? 0));
}

export async function getAgentVersion(agentId: string, version: string): Promise<TeamAgentDefinition | null> {
    if (!isValidRecordId(agentId) || !isValidRecordId(version)) return null;
    const snap = await REF(AI_TEAMS_PATHS.agentVersion(agentId, version)).get();
    return (snap.val() || null) as TeamAgentDefinition | null;
}

/** Increments a version like "1.0.0" → "1.0.1" for edits (spec §40). */
export { nextVersion } from "./versioning";

// ─── custom agents ──────────────────────────────────────────────────────────

export async function listCustomAgents(uid: string): Promise<TeamAgentDefinition[]> {
    const snap = await REF(AI_TEAMS_PATHS.customAgents(uid)).get();
    const data = (snap.val() || {}) as Record<string, TeamAgentDefinition>;
    return Object.values(data).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getCustomAgent(uid: string, agentId: string): Promise<TeamAgentDefinition | null> {
    if (!isValidRecordId(agentId)) return null;
    const snap = await REF(AI_TEAMS_PATHS.customAgent(uid, agentId)).get();
    return (snap.val() || null) as TeamAgentDefinition | null;
}

export async function saveCustomAgent(agent: TeamAgentDefinition): Promise<void> {
    if (!agent.ownerUid) throw new Error("Custom agent requires an owner.");
    await REF(AI_TEAMS_PATHS.customAgent(agent.ownerUid, agent.id)).set({ ...agent, updatedAt: Date.now() });
}

export async function deleteCustomAgent(uid: string, agentId: string): Promise<boolean> {
    if (!isValidRecordId(agentId)) return false;
    const snap = await REF(AI_TEAMS_PATHS.customAgent(uid, agentId)).get();
    if (!snap.exists()) return false;
    await REF(AI_TEAMS_PATHS.customAgent(uid, agentId)).remove();
    return true;
}

export function createCustomAgentId(uid: string): string {
    const suffix = Math.random().toString(36).slice(2, 9);
    return `custom_${uid.slice(0, 10)}_${suffix}`.slice(0, 60);
}

// ─── runs ───────────────────────────────────────────────────────────────────

export async function saveRun(run: TeamRun): Promise<void> {
    await REF(AI_TEAMS_PATHS.run(run.userId, run.id)).set(run);
    await REF(AI_TEAMS_PATHS.runIndex(run.id)).set({
        userId: run.userId,
        teamId: run.teamId,
        teamName: run.teamName,
        status: run.status,
        market: run.market,
        mode: run.dataMode,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        durationMs: run.durationMs ?? null,
        agentCount: Object.keys(run.agentOutputs).length,
        setupState: run.synthesis?.setupState ?? null,
    });
}

/** Incremental progress write while a run executes (drives the live UI). */
export async function patchRun(uid: string, runId: string, patch: Partial<TeamRun>): Promise<void> {
    if (!isValidRecordId(runId)) return;
    await REF(AI_TEAMS_PATHS.run(uid, runId)).update(patch as Record<string, unknown>);
}

export async function getRun(uid: string, runId: string): Promise<TeamRun | null> {
    if (!isValidRecordId(runId)) return null;
    const snap = await REF(AI_TEAMS_PATHS.run(uid, runId)).get();
    return (snap.val() || null) as TeamRun | null;
}

export async function listRuns(uid: string, limit = 50): Promise<TeamRunSummary[]> {
    const snap = await REF(AI_TEAMS_PATHS.runs(uid)).limitToLast(limit).get();
    const data = (snap.val() || {}) as Record<string, TeamRun>;
    return Object.values(data)
        .map((run) => ({
            id: run.id,
            teamId: run.teamId,
            teamName: run.teamName,
            status: run.status,
            market: run.market,
            dataMode: run.dataMode,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt ?? null,
            durationMs: run.durationMs ?? null,
            setupState: run.synthesis?.setupState ?? null,
            agentVersions: run.agentVersions ?? {},
        }))
        .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/** Admin monitoring index — deliberately minimal, no analysis payloads. */
export async function listRunIndex(limit = 100): Promise<Record<string, unknown>[]> {
    const snap = await REF(AI_TEAMS_PATHS.runIndexAll()).limitToLast(limit).get();
    const data = (snap.val() || {}) as Record<string, Record<string, unknown>>;
    return Object.entries(data).map(([id, value]) => ({ id, ...value }));
}

export async function requestRunCancellation(uid: string, runId: string): Promise<void> {
    if (!isValidRecordId(runId)) return;
    await REF(AI_TEAMS_PATHS.control(uid, runId)).set({ cancelled: true, at: Date.now() });
}

export async function isRunCancelled(uid: string, runId: string): Promise<boolean> {
    if (!isValidRecordId(runId)) return false;
    const snap = await REF(AI_TEAMS_PATHS.control(uid, runId)).get();
    const val = snap.val() as { cancelled?: boolean } | null;
    return val?.cancelled === true;
}

export async function clearRunControl(uid: string, runId: string): Promise<void> {
    if (!isValidRecordId(runId)) return;
    await REF(AI_TEAMS_PATHS.control(uid, runId)).remove();
}

// ─── memory ─────────────────────────────────────────────────────────────────

export async function getMemory(uid: string, teamId: string): Promise<TeamMemoryRecord | null> {
    if (!isValidRecordId(teamId)) return null;
    const snap = await REF(AI_TEAMS_PATHS.memory(uid, teamId)).get();
    return (snap.val() || null) as TeamMemoryRecord | null;
}

export async function saveMemory(memory: TeamMemoryRecord): Promise<void> {
    await REF(AI_TEAMS_PATHS.memory(memory.userId, memory.teamId)).set(memory);
}

export async function clearMemory(uid: string, teamId: string): Promise<void> {
    if (!isValidRecordId(teamId)) return;
    await REF(AI_TEAMS_PATHS.memory(uid, teamId)).remove();
}

export function emptyMemory(userId: string, teamId: string): TeamMemoryRecord {
    return {
        teamId,
        userId,
        updatedAt: Date.now(),
        preferences: {},
        preferredMarkets: [],
        preferredTimeframes: [],
        strategyPreferences: [],
        previousResearch: [],
        validatedSetups: [],
        rejectedSetups: [],
        agentPerformance: {},
    };
}

// ─── metrics ────────────────────────────────────────────────────────────────

export interface AgentMetricSnapshot {
    agentId: string;
    runs: number;
    completed: number;
    failed: number;
    totalDurationMs: number;
    avgConfidenceSum: number;
    lastRunAt: number;
    errors: number;
}

/** Fire-and-forget metric update after a run. Never throws into the run path. */
export async function recordAgentMetrics(outputs: AgentRunOutput[], at: number): Promise<void> {
    const updates: Record<string, unknown> = {};
    for (const output of outputs) {
        if (!output.agentId) continue;
        const path = AI_TEAMS_PATHS.metrics(output.agentId);
        updates[`${path}/agentId`] = output.agentId;
        updates[`${path}/runs`] = ServerValue.increment(1);
        updates[`${path}/totalDurationMs`] = ServerValue.increment(output.durationMs ?? 0);
        updates[`${path}/avgConfidenceSum`] = ServerValue.increment(output.confidence ?? 0);
        updates[`${path}/lastRunAt`] = at;
        if (output.status === "completed") {
            updates[`${path}/completed`] = ServerValue.increment(1);
        } else if (output.status === "failed") {
            updates[`${path}/failed`] = ServerValue.increment(1);
            updates[`${path}/errors`] = ServerValue.increment(1);
        }
    }
    if (Object.keys(updates).length === 0) return;
    await adminDatabase.ref().update(deepClean(updates));
}

export async function getAgentMetrics(): Promise<Record<string, AgentMetricSnapshot>> {
    const snap = await REF(AI_TEAMS_PATHS.metricsAll()).get();
    return (snap.val() || {}) as Record<string, AgentMetricSnapshot>;
}

// ─── product analytics events ───────────────────────────────────────────────

/**
 * Appends a product analytics event to the existing Firebase RTDB
 * (no new analytics platform). Failures never affect the calling flow.
 */
export async function recordTeamEvent(event: Omit<AITeamAnalyticsEvent, "id" | "at"> & { at?: number }): Promise<void> {
    try {
        const id = newId("evt");
        await REF(`${AI_TEAMS_PATHS.events()}/${id}`).set({
            ...event,
            id,
            at: event.at ?? Date.now(),
        });
    } catch (err) {
        console.warn("[ai-trading-teams] analytics event failed:", err);
    }
}

export async function listTeamEvents(limit = 200): Promise<AITeamAnalyticsEvent[]> {
    const snap = await REF(AI_TEAMS_PATHS.events()).limitToLast(limit).get();
    const data = (snap.val() || {}) as Record<string, AITeamAnalyticsEvent>;
    return Object.values(data).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}
