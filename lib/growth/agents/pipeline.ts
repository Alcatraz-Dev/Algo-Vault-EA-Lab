/**
 * Growth Engine — marketing content pipeline.
 *
 * Runs the multi-agent pipeline (Research → Content → SEO → Social →
 * Compliance) through the *existing* workflow engine, then drives the
 * aiMarketingTasks/aiMarketingRuns state machine with idempotency, retries and
 * failure states.
 */
import { WorkflowDefinition, WorkflowContext } from "@/lib/agents/types";
import { ensureGrowthAgentsRegistered, GROWTH_AGENT_IDS } from "./contracts";
import { registerGrowthExecutors } from "./executors";
import { AIContentBlock, MarketingRun, MarketingTask } from "../types";
import { adminDatabase, claimJobKey, createRecord, genId, updateRecord, writeGrowthAudit } from "../database";
import { COLLECTION_PATHS } from "../paths";
import { canTransition, approveForPublishing, canPublish } from "../content-states";
import { getAdapter, publishWithTimeout } from "../channels";

let _workflowEngine: typeof import("@/lib/agents/workflow-engine") | null = null;
async function workflowEngine(): Promise<typeof import("@/lib/agents/workflow-engine")> {
    if (!_workflowEngine) _workflowEngine = await import("@/lib/agents/workflow-engine");
    return _workflowEngine;
}

let _initialized = false;
function ensureInitialized(): void {
    if (_initialized) return;
    _initialized = true;
    ensureGrowthAgentsRegistered();
    registerGrowthExecutors();
}

export type PipelineInput = {
    taskId: string;
    workflowId?: string;
    actor: string;
    force?: boolean;
};

/** The declarative content-generation workflow (single source of truth). */
export function buildContentWorkflow(workflowId = "growth-content-workflow"): WorkflowDefinition {
    return {
        id: workflowId,
        name: "Growth Content Pipeline",
        version: "1.0.0",
        description: "Research → Content → SEO → Social → Compliance for a marketing task.",
        status: "active",
        trigger: "manual",
        requiredPermissions: [],
        steps: [
            { id: "research", mode: "sequential", agent: GROWTH_AGENT_IDS.research },
            { id: "content", mode: "sequential", agent: GROWTH_AGENT_IDS.content, dependsOn: ["research"] },
            { id: "seo", mode: "sequential", agent: GROWTH_AGENT_IDS.seo, dependsOn: ["content"] },
            { id: "social", mode: "sequential", agent: GROWTH_AGENT_IDS.social, dependsOn: ["seo"] },
            { id: "compliance", mode: "sequential", agent: GROWTH_AGENT_IDS.compliance, dependsOn: ["social"] },
            { id: "campaign", mode: "sequential", agent: GROWTH_AGENT_IDS.campaign, dependsOn: ["compliance"] },
            { id: "publisher", mode: "sequential", agent: GROWTH_AGENT_IDS.publisher, dependsOn: ["campaign"] },
            { id: "analytics", mode: "sequential", agent: GROWTH_AGENT_IDS.analytics, dependsOn: ["publisher"] },
            { id: "optimization", mode: "sequential", agent: GROWTH_AGENT_IDS.optimization, dependsOn: ["analytics"] },
            { id: "report", mode: "sequential", agent: GROWTH_AGENT_IDS.report, dependsOn: ["optimization"] },
        ],
        timeoutMs: 180000,
        defaultStepTimeoutMs: 40000,
        retryPolicy: { maxRetries: 1, backoffMs: 1000 },
        notification: { method: "none", channels: [], requiresCritic: false, onCriticConflict: "block" },
    };
}

const MARKETING_WORKFLOWS: Record<string, WorkflowDefinition> = {
    "growth-content-workflow": buildContentWorkflow(),
};

export function getMarketingWorkflow(id: string): WorkflowDefinition | undefined {
    return MARKETING_WORKFLOWS[id];
}

export function getAllMarketingWorkflows(): WorkflowDefinition[] {
    return Object.values(MARKETING_WORKFLOWS);
}

/** Persists workflow definitions so they appear in the existing workflows UI. */
export async function ensureGrowthWorkflows(): Promise<void> {
    const { setWorkflowDefinition } = await import("@/lib/agents/database");
    for (const wf of Object.values(MARKETING_WORKFLOWS)) {
        await setWorkflowDefinition(wf).catch((err) => {
            console.error("[growth:workflows] failed to persist", wf.id, err);
        });
    }
}

export type PipelineResult = {
    ok: boolean;
    task: MarketingTask | null;
    run: MarketingRun;
    blockedByCompliance?: boolean;
    error?: string;
};

/**
 * Runs the content pipeline for a task. Idempotent: a task already in
 * GENERATING/READY_FOR_REVIEW is not re-run unless force=true.
 */
export async function runContentPipeline(input: PipelineInput): Promise<PipelineResult> {
    const { taskId, actor, force } = input;
    const runId = genId("run");

    // Idempotency: only one pipeline run per task may be active at a time.
    const jobKey = `content_pipeline:${taskId}`;
    if (!force && !(await claimJobKey(jobKey, 10 * 60 * 1000))) {
        const existingRun = await currentRunForTask(taskId);
        return {
            ok: false,
            task: await getTask(taskId),
            run: existingRun || { id: runId, status: "QUEUED", createdAt: Date.now(), updatedAt: Date.now(), createdBy: actor, stage: "QUEUED" },
            error: "A pipeline run for this task is already in progress.",
        };
    }

    const task = await getTask(taskId);
    if (!task) {
        return {
            ok: false,
            task: null,
            run: { id: runId, status: "FAILED", createdAt: Date.now(), updatedAt: Date.now(), createdBy: actor, stage: "FAILED", error: "Task not found." },
            error: "Task not found.",
        };
    }

    // State gate: only DRAFT and FAILED (retry) may enter generation.
    const transitionOk = canTransition(task.state, "GENERATING");
    if (!transitionOk.ok && !force) {
        return {
            ok: false,
            task,
            run: { id: runId, status: "FAILED", createdAt: Date.now(), updatedAt: Date.now(), createdBy: actor, stage: "FAILED", error: transitionOk.reason },
            error: transitionOk.reason,
        };
    }

    const now = Date.now();
    const run: MarketingRun = {
        id: runId,
        taskId,
        campaignId: task.campaignId,
        stage: "RUNNING",
        status: "RUNNING",
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        startedAt: now,
    };
    await adminDatabase.ref(`${COLLECTION_PATHS.runs}/${runId}`).set(run);
    await updateRecord(COLLECTION_PATHS.tasks, taskId, { state: "GENERATING" }, actor);

    const config: Record<string, unknown> = {
        taskId,
        topic: task.topic,
        type: task.type,
        channels: task.channels,
        tone: task.tone,
        language: task.language,
        objective: task.objective,
        campaignId: task.campaignId,
        audience: task.audience,
        title: task.title,
        affiliateContent: task.type === "AFFILIATE_CONTENT",
        offerId: task.metadata?.offerId,
    };

    const context: WorkflowContext = {
        user: { uid: actor, context: "admin" },
        market: {},
        history: { trades: [], positions: [], botCount: 0, symbols: [] },
        risk: { drawdownPercent: 0, exposureRatio: 0, positionCount: 0, correlatedExposure: 0, symbols: [] },
        news: { incoming: [], relevant: [] },
        strategy: {},
        variables: {},
        flags: [],
        agentOutputs: {},
        config,
    };

    try {
        const workflow = getMarketingWorkflow(input.workflowId || "growth-content-workflow") || buildContentWorkflow(input.workflowId);
        const { executeWorkflow } = await workflowEngine();
        const result = await executeWorkflow(workflow, context, { permissions: {}, timeoutMs: 180000 });

        const compliance = result.outputs["compliance"] || result.outputs["growth-compliance"];
        const complianceMeta = (compliance?.metadata || {}) as { passed?: boolean; blocked?: boolean; flags?: unknown; requiresRiskDisclosure?: boolean; riskDisclosurePresent?: boolean; tradingContext?: boolean };

        if (complianceMeta.blocked || complianceMeta.passed === false) {
            const failReason = `Compliance block: content did not pass the compliance review.`;
            await updateRecord(COLLECTION_PATHS.tasks, taskId, { state: "FAILED", rejectReason: failReason }, actor);
            await adminDatabase.ref(`${COLLECTION_PATHS.runs}/${runId}`).update({
                stage: "BLOCKED",
                status: "BLOCKED",
                blockedByCompliance: true,
                finishedAt: Date.now(),
                updatedAt: Date.now(),
                error: failReason,
            });
            await writeGrowthAudit({ actor, action: "publish_blocked", targetType: "marketingTask", targetId: taskId, detail: { reason: failReason, flags: complianceMeta.flags } });
            return { ok: false, task: await getTask(taskId), run: { ...run, stage: "BLOCKED", status: "BLOCKED", blockedByCompliance: true }, blockedByCompliance: true, error: failReason };
        }

        const contentBlocks = (result.outputs["content"]?.metadata?.contentBlocks || {}) as Record<string, AIContentBlock>;
        const socialVariants = (result.outputs["social"]?.metadata?.variants || {}) as Record<string, string>;
        const mainBlocks = { ...contentBlocks };
        for (const [channel, variant] of Object.entries(socialVariants)) {
            mainBlocks[channel] = { format: "text", value: variant };
        }

        await updateRecord(
            COLLECTION_PATHS.tasks,
            taskId,
            {
                state: "READY_FOR_REVIEW",
                generatedContent: mainBlocks,
                compliance: {
                    passed: true,
                    flags: (complianceMeta.flags || []) as { rule: string; label: string; severity: string; matches: string[] }[],
                    riskDisclosureRequired: Boolean(complianceMeta.requiresRiskDisclosure),
                    riskDisclosurePresent: Boolean(complianceMeta.riskDisclosurePresent),
                },
                reviewNotes: String(result.outputs["content"]?.metadata?.reviewNotes || "Generated content — review before publishing."),
                runId,
            },
            actor
        );
        await adminDatabase.ref(`${COLLECTION_PATHS.runs}/${runId}`).update({
            stage: "COMPLETED",
            status: "COMPLETED",
            finishedAt: Date.now(),
            updatedAt: Date.now(),
            stepsCompleted: ["research", "content", "seo", "social", "compliance"],
        });
        await writeGrowthAudit({ actor, action: "content_generated", targetType: "marketingTask", targetId: taskId, detail: { workflow: workflow.id, runId } });

        return { ok: true, task: await getTask(taskId), run: { ...run, stage: "COMPLETED", status: "COMPLETED" } };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Pipeline failed.";
        await updateRecord(COLLECTION_PATHS.tasks, taskId, { state: "FAILED", rejectReason: message }, actor);
        await adminDatabase.ref(`${COLLECTION_PATHS.runs}/${runId}`).update({
            stage: "FAILED",
            status: "FAILED",
            finishedAt: Date.now(),
            updatedAt: Date.now(),
            error: message,
        });
        return { ok: false, task: await getTask(taskId), run: { ...run, stage: "FAILED", status: "FAILED", error: message }, error: message };
    }
}

async function getTask(taskId: string): Promise<MarketingTask | null> {
    const snap = await adminDatabase.ref(`${COLLECTION_PATHS.tasks}/${taskId}`).get();
    return snap.exists() ? (snap.val() as MarketingTask) : null;
}

async function currentRunForTask(taskId: string): Promise<MarketingRun | null> {
    const snap = await adminDatabase.ref(COLLECTION_PATHS.runs).orderByChild("taskId").equalTo(taskId).limitToLast(1).get();
    const data = snap.val() as Record<string, MarketingRun> | null;
    if (!data) return null;
    const entries = Object.values(data);
    return entries[entries.length - 1] || null;
}

/** Publish an approved task to one channel via its adapter (idempotent). */
export async function publishTaskToChannel(task: MarketingTask, channel: Parameters<typeof getAdapter>[0], actor: string): Promise<{ ok: boolean; reason?: string; publishedAt?: number; externalId?: string }> {
    const gate = canPublish(task, channel);
    if (!gate.ok) return { ok: false, reason: gate.reason };

    const content = task.generatedContent?.[channel]?.value || task.generatedContent?.main?.value || "";
    if (!content) return { ok: false, reason: "No content available for this channel." };

    const adapter = getAdapter(channel);
    const attempt: {
        channel: Parameters<typeof getAdapter>[0];
        at: number;
        ok: boolean;
        status: "NOT_CONFIGURED" | "SUCCESS" | "FAILED" | "BLOCKED";
        error: string;
    } = { channel, at: Date.now(), ok: false, status: "FAILED", error: "" };
    const result = await publishWithTimeout(adapter, {
        title: task.title,
        text: content,
        url: task.metadata?.url as string | undefined,
        metadata: { taskId: task.id, runId: task.runId },
    });

    if (result.ok) {
        attempt.ok = true;
        attempt.status = "SUCCESS";
        const publish = [
            ...(task.publish || []),
            { channel, externalId: result.externalId, publishedAt: result.publishedAt, url: result.url },
        ];
        await updateRecord(COLLECTION_PATHS.tasks, task.id as string, { state: "PUBLISHED", publish }, actor);
        await writeGrowthAudit({ actor, action: "content_published", targetType: "marketingTask", targetId: task.id, detail: { channel, externalId: result.externalId } });
        return { ok: true, publishedAt: result.publishedAt, externalId: result.externalId };
    }

    attempt.status = result.state === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
    attempt.error = result.reason;
    await updateRecord(COLLECTION_PATHS.tasks, task.id as string, {
        publishAttempts: [...(task.publishAttempts || []), attempt],
    }, actor);
    return { ok: false, reason: result.reason };
}

/** Create a draft marketing task. */
export async function createMarketingTaskDraft(input: {
    type: string;
    topic: string;
    channels: string[];
    title?: string;
    objective?: string;
    audience?: string;
    tone?: string;
    language?: string;
    campaignId?: string;
    approvalRequired?: boolean;
    offerId?: string;
    actor: string;
}): Promise<MarketingTask> {
    const now = Date.now();
    const ref = adminDatabase.ref(COLLECTION_PATHS.tasks).push();
    const id = ref.key as string;
    const task: MarketingTask = {
        id,
        type: input.type as MarketingTask["type"],
        topic: input.topic,
        channels: input.channels as MarketingTask["channels"],
        title: input.title || input.topic,
        objective: input.objective,
        audience: input.audience,
        tone: input.tone,
        language: input.language,
        campaignId: input.campaignId,
        state: "DRAFT",
        approvalRequired: input.approvalRequired ?? true,
        createdAt: now,
        updatedAt: now,
        createdBy: input.actor,
        status: "DRAFT",
        metadata: input.offerId ? { offerId: input.offerId } : undefined,
    };
    await ref.set(task);
    await writeGrowthAudit({ actor: input.actor, action: "task_state_changed", targetType: "marketingTask", targetId: id, detail: { to: "DRAFT", type: task.type } });
    return task;
}

export { approveForPublishing, canPublish };