import { adminDatabase } from "@/lib/firebase-admin";

export { adminDatabase };
import {
    AgentContract,
    AgentExecutionRecord,
    AgentLogRecord,
    AgentOutput,
    AgentStatus,
    AgentUsageRecord,
    WorkflowContext,
    WorkflowDefinition,
    WorkflowExecutionRecord,
    WorkflowStepRecord,
} from "./types";

const REF = (path: string) => {
    const ref = adminDatabase.ref(path);
    const proxy = Object.create(ref) as typeof ref;
    // Firebase RTDB rejects `undefined` values in set/update payloads, but agent
    // outputs/contexts legitimately carry optional fields (e.g. evidence.value,
    // user.displayName). Deep-convert undefined → null so writes never crash.
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

// ─── Agent Registry ─────────────────────────────────────────────

export async function getAgentDefinition(id: string): Promise<AgentContract | null> {
    const snap = await REF(`agents/${id}`).get();
    return (snap.val() || null) as AgentContract | null;
}

export async function setAgentDefinition(agent: AgentContract): Promise<void> {
    await REF(`agents/${agent.id}`).set({
        ...agent,
        updatedAt: Date.now(),
    });
}

export async function getAllAgentDefinitions(): Promise<AgentContract[]> {
    const snap = await REF("agents").get();
    const data = (snap.val() || {}) as Record<string, AgentContract>;
    return Object.values(data);
}

export async function getActiveAgentDefinitions(): Promise<AgentContract[]> {
    const all = await getAllAgentDefinitions();
    return all.filter((a) => a.status === "active" || a.status === "testing");
}

// ─── Workflow Definitions ───────────────────────────────────────

export async function getWorkflowDefinition(id: string): Promise<WorkflowDefinition | null> {
    const snap = await REF(`workflows/${id}`).get();
    return (snap.val() || null) as WorkflowDefinition | null;
}

export async function setWorkflowDefinition(wf: WorkflowDefinition): Promise<void> {
    await REF(`workflows/${wf.id}`).set({
        ...wf,
        updatedAt: Date.now(),
    });
}

export async function getAllWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
    const snap = await REF("workflows").get();
    const data = (snap.val() || {}) as Record<string, WorkflowDefinition>;
    return Object.values(data);
}

// ─── Execution Records ──────────────────────────────────────────

export async function createExecution(execution: WorkflowExecutionRecord): Promise<void> {
    await REF(`workflowExecutions/${execution.id}`).set(execution);
}

export async function updateExecutionStatus(
    executionId: string,
    updates: Partial<Pick<WorkflowExecutionRecord, "status" | "finishedAt" | "durationMs" | "stepsCompleted" | "stepsFailed" | "agentsRun" | "finalOutput" | "errors" | "aiCalls" | "estimatedCostUsd">>
): Promise<void> {
    await REF(`workflowExecutions/${executionId}`).update(updates);
}

export async function getExecution(executionId: string): Promise<WorkflowExecutionRecord | null> {
    const snap = await REF(`workflowExecutions/${executionId}`).get();
    return (snap.val() || null) as WorkflowExecutionRecord | null;
}

export async function getUserExecutions(uid: string, limit = 50): Promise<WorkflowExecutionRecord[]> {
    const snap = await REF(`workflowExecutions`).orderByChild("userId").equalTo(uid).limitToLast(limit).get();
    const data = (snap.val() || {}) as Record<string, WorkflowExecutionRecord>;
    return Object.values(data).sort((a, b) => b.startedAt - a.startedAt);
}

export async function getExecutionTraces(executionId: string): Promise<{
    steps: WorkflowStepRecord[];
    agents: AgentExecutionRecord[];
}> {
    const [stepsSnap, agentsSnap] = await Promise.all([
        REF(`workflowSteps`).orderByChild("executionId").equalTo(executionId).get(),
        REF(`agentExecutions`).orderByChild("executionId").equalTo(executionId).get(),
    ]);
    const stepsData = (stepsSnap.val() || {}) as Record<string, WorkflowStepRecord>;
    const agentsData = (agentsSnap.val() || {}) as Record<string, AgentExecutionRecord>;
    return {
        steps: Object.values(stepsData).sort((a, b) => a.startedAt - b.startedAt),
        agents: Object.values(agentsData).sort((a, b) => a.startedAt - b.startedAt),
    };
}

export async function cancelExecution(executionId: string): Promise<boolean> {
    const exec = await getExecution(executionId);
    if (!exec || exec.status !== "running") return false;
    await updateExecutionStatus(executionId, {
        status: "aborted",
        finishedAt: Date.now(),
        durationMs: Date.now() - exec.startedAt,
    });
    return true;
}

// ─── Workflow Steps ─────────────────────────────────────────────

export async function createStepRecord(step: WorkflowStepRecord): Promise<void> {
    await REF(`workflowSteps/${step.id}`).set(step);
}

export async function updateStepRecord(stepId: string, updates: Partial<WorkflowStepRecord>): Promise<void> {
    await REF(`workflowSteps/${stepId}`).update(updates);
}

// ─── Agent Executions ───────────────────────────────────────────

export async function createAgentExecution(execution: AgentExecutionRecord): Promise<void> {
    await REF(`agentExecutions/${execution.id}`).set(execution);
}

export async function updateAgentExecution(executionId: string, updates: Partial<AgentExecutionRecord>): Promise<void> {
    await REF(`agentExecutions/${executionId}`).update(updates);
}

// ─── Logs ───────────────────────────────────────────────────────

export async function writeAgentLog(log: AgentLogRecord): Promise<void> {
    await REF(`agentLogs/${log.id}`).set(log);
}

export async function getAgentLogs(executionId?: string, agentId?: string, limit = 100): Promise<AgentLogRecord[]> {
    let snap;
    if (executionId) {
        snap = await REF("agentLogs").orderByChild("executionId").equalTo(executionId).limitToLast(limit).get();
    } else if (agentId) {
        snap = await REF("agentLogs").orderByChild("agentId").equalTo(agentId).limitToLast(limit).get();
    } else {
        snap = await REF("agentLogs").limitToLast(limit).get();
    }
    const data = (snap.val() || {}) as Record<string, AgentLogRecord>;
    return Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Usage & Cost ────────────────────────────────────────────────

export async function recordUsage(usage: AgentUsageRecord): Promise<void> {
    await REF(`agentUsage/${usage.id}`).set(usage);
}

export async function getUsage(workflowId?: string, agentId?: string): Promise<AgentUsageRecord[]> {
    let snap;
    if (workflowId && agentId) {
        snap = await REF("agentUsage").orderByChild("workflowId").equalTo(workflowId).get();
    } else if (workflowId) {
        snap = await REF("agentUsage").orderByChild("workflowId").equalTo(workflowId).get();
    } else if (agentId) {
        snap = await REF("agentUsage").orderByChild("agentId").equalTo(agentId).get();
    } else {
        snap = await REF("agentUsage").limitToLast(200).get();
    }
    const data = (snap.val() || {}) as Record<string, AgentUsageRecord>;
    return Object.values(data);
}

// ─── Context (for agent memory) ─────────────────────────────────

export async function saveWorkflowContext(executionId: string, context: WorkflowContext): Promise<void> {
    const sanitized = JSON.parse(JSON.stringify(context));
    delete sanitized.agentOutputs;
    await REF(`workflowContexts/${executionId}`).set(sanitized);
}

export async function getWorkflowContext(executionId: string): Promise<WorkflowContext | null> {
    const snap = await REF(`workflowContexts/${executionId}`).get();
    return (snap.val() || null) as WorkflowContext | null;
}

// ─── Drafts (AI generated) ──────────────────────────────────────

export async function saveAgentDraft(draftId: string, draft: Record<string, unknown>): Promise<void> {
    await REF(`agentDrafts/${draftId}`).set({
        ...draft,
        updatedAt: Date.now(),
    });
}

export async function getAgentDraft(draftId: string): Promise<unknown | null> {
    const snap = await REF(`agentDrafts/${draftId}`).get();
    return (snap.val() || null);
}

// ─── Agent Generation Jobs ──────────────────────────────────────

export async function saveAgentGenerationJob(job: Record<string, unknown>): Promise<void> {
    await REF(`agentGenerationJobs/${job.id}`).set({
        ...job,
        updatedAt: Date.now(),
    });
}

export async function getAgentGenerationJob(jobId: string): Promise<unknown | null> {
    const snap = await REF(`agentGenerationJobs/${jobId}`).get();
    return (snap.val() || null);
}

export async function listAgentGenerationJobs(limit = 50): Promise<unknown[]> {
    const snap = await REF("agentGenerationJobs").orderByChild("createdAt").limitToLast(limit).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.values(data).sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
}
