import { adminDatabase } from "@/lib/firebase-admin";
import {
    WorkflowDefinition,
    WorkflowStep,
    WorkflowStepMode,
    ConditionalBranch,
    WorkflowContext,
    AgentOutput,
    AgentExecutionRecord,
    WorkflowExecutionRecord,
    WorkflowStepRecord,
    ExecutionOutcome,
    AgentPermission,
    PermissionSet,
    AgentContract,
} from "./types";
import { getAgent, AGENT_BY_ID } from "./catalog";
import { createExecution, updateExecutionStatus, createStepRecord, createAgentExecution, updateAgentExecution, saveWorkflowContext, writeAgentLog, getAgentDefinition } from "./database";
import { failureOutput, successOutput, addEvidence } from "./implementations/shared";
import { notificationAgent } from "./notification-agent";

/** Executes a single agent implementation by ID, falling back to stub for unknown agents. */
type AgentExecutor = (
    record: AgentExecutionRecord,
    context: WorkflowContext
) => Promise<AgentOutput>;

const agentExecutors: Record<string, AgentExecutor> = {};

export function registerAgentExecutor(id: string, fn: AgentExecutor): void {
    agentExecutors[id] = fn;
}

// ─── Workflow Engine ────────────────────────────────────

export type EngineConfig = {
    /** Override: caller's effective permissions (plugin/extension/admin). */
    permissions?: PermissionSet;
    /** Admin sandbox mode: no personal data, test=True. */
    testOnly?: boolean;
    /** Max wall-clock ms for the whole workflow. */
    timeoutMs?: number;
};

export type EngineResult = {
    execution: WorkflowExecutionRecord;
    outputs: Record<string, AgentOutput>;
    finalOutput: ReturnType<typeof successOutput>;
    traces: { steps: WorkflowStepRecord[]; agents: AgentExecutionRecord[] };
};

function genId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function executeAgent(
    agentId: string,
    stepId: string,
    execution: WorkflowExecutionRecord,
    context: WorkflowContext,
    timeoutMs: number
): Promise<AgentOutput> {
    const agent = getAgent(agentId);
    if (!agent) {
        return failureOutput(agentId, `Unknown agent: ${agentId}`);
    }

    const agentRecord: AgentExecutionRecord = {
        id: genId("ae"),
        executionId: execution.id,
        stepId,
        workflowId: execution.workflowId,
        workflowVersion: execution.workflowVersion,
        agentId,
        agentVersion: agent.version,
        status: "success",
        startedAt: Date.now(),
        finishedAt: 0,
        durationMs: 0,
        retries: 0,
        output: null,
        aiUsed: agent.modelConfiguration.poweredBy === "hybrid",
    };

    try {
        const executor = agentExecutors[agentId];
        let output: AgentOutput;
        if (executor) {
            const result = await Promise.race([
                executor(agentRecord, context),
                delay(timeoutMs),
            ]);
            if (!result) {
                output = failureOutput(agentId, `Agent timed out after ${timeoutMs}ms.`);
            } else {
                output = result;
            }
        } else if (agentId === "notification") {
            const result = await Promise.race([
                notificationAgent(agentRecord, context),
                delay(timeoutMs),
            ]);
            if (!result) {
                output = failureOutput(agentId, `Notification agent timed out after ${timeoutMs}ms.`);
            } else {
                output = result;
            }
        } else {
            const result = await Promise.race([
                genericAgentExecutor(agent, agentRecord, context),
                delay(timeoutMs),
            ]);
            output = result || failureOutput(agentId, `Agent timed out after ${timeoutMs}ms.`);
        }

        agentRecord.finishedAt = Date.now();
        agentRecord.durationMs = agentRecord.finishedAt - agentRecord.startedAt;
        agentRecord.output = output;
        agentRecord.status = output.status;

        await createAgentExecution(agentRecord);
        await saveWorkflowContext(execution.id, context);
        return output;
    } catch (err) {
        agentRecord.finishedAt = Date.now();
        agentRecord.durationMs = agentRecord.finishedAt - agentRecord.startedAt;
        agentRecord.error = err instanceof Error ? err.message : "Unknown";
        agentRecord.status = "failed";
        await createAgentExecution(agentRecord);
        const fail = failureOutput(agentId, err instanceof Error ? err.message : "Unknown");
        await saveWorkflowContext(execution.id, context);
        return fail;
    }
}

async function genericAgentExecutor(
    agent: AgentContract,
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const ctx = context as WorkflowContext & { _agentInputs?: Record<string, unknown> };
    const input = ctx._agentInputs?.[agent.id] || {};
    return successOutput({
        agentId: agent.id,
        summary: `Agent ${agent.name} executed.`,
        confidence: 0.5,
        findings: [{ id: "generic", title: "Executed", detail: `Agent ${agent.id} ran successfully.` }],
        evidence: [{ id: "ev_generic", dataUsed: `agent:${agent.id}`, note: "generic execution" }],
        dataUsed: [`agent:${agent.id}`],
        nextStep: "",
        metadata: { input },
    });
}

// ─── Main Engine ────────────────────────────────────────

export async function executeWorkflow(
    workflow: WorkflowDefinition,
    initialContext: Partial<WorkflowContext>,
    config: EngineConfig = {}
): Promise<EngineResult> {
    const executionId = genId("wf_exec");
    const now = Date.now();
    const permissions = config.permissions || {};
    const timeoutMs = config.timeoutMs || workflow.timeoutMs || 120_000;

    const execution: WorkflowExecutionRecord = {
        id: executionId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        userId: initialContext.user?.uid || null,
        trigger: initialContext.user?.context ? "manual" : "manual",
        status: "running",
        startedAt: now,
        finishedAt: 0,
        durationMs: 0,
        stepsTotal: workflow.steps.length,
        stepsCompleted: 0,
        stepsFailed: 0,
        agentsRun: 0,
        symbols: [],
        finalOutput: null,
        errors: [],
        aiCalls: 0,
        estimatedCostUsd: 0,
        testOnly: config.testOnly || false,
    };

    await createExecution(execution);

    // Build shared context
    const context: WorkflowContext = {
        user: {
            uid: initialContext.user?.uid || null,
            displayName: initialContext.user?.displayName,
            context: initialContext.user?.context,
            contextId: initialContext.user?.contextId,
        },
        market: initialContext.market || {},
        history: initialContext.history || { trades: [], positions: [], botCount: 0, symbols: [] },
        risk: initialContext.risk || { drawdownPercent: 0, exposureRatio: 0, positionCount: 0, correlatedExposure: 0, symbols: [] },
        news: initialContext.news || { incoming: [], relevant: [] },
        strategy: initialContext.strategy || {},
        variables: {},
        flags: [],
        agentOutputs: {},
        config: initialContext.config || {},
    };

    // Resolve permissions check
    const requiredPermissions: AgentPermission[] = workflow.requiredPermissions || [];
    const missingPerms = requiredPermissions.filter((p) => {
        const agent = getAgent(wfAgentForPermission(p));
        return agent?.requiredPermissions.includes(p) && permissions[p] !== true;
    });
    // Also check workflow-level permissions
    const wfPermsMissing = requiredPermissions.filter((p) => permissions[p] !== true);

    if (wfPermsMissing.length > 0) {
        execution.status = "failed";
        execution.finishedAt = Date.now();
        execution.durationMs = execution.finishedAt - execution.startedAt;
        execution.errors = [`Permission denied: ${wfPermsMissing.join(", ")}`];
        await updateExecutionStatus(executionId, {
            status: execution.status,
            finishedAt: execution.finishedAt,
            durationMs: execution.durationMs,
            errors: execution.errors,
        });
        throw new Error(`Permission denied: ${wfPermsMissing.join(", ")}`);
    }

    // Execute steps sequentially (supporting parallel groups within)
    const stepRecords: WorkflowStepRecord[] = [];
    const outputs: Record<string, AgentOutput> = {};
    let completedCount = 0;
    let failedCount = 0;
    const agentsRunCount = 0;

    for (const step of workflow.steps) {
        const stepRecord = await executeStep(
            step, workflow, execution, context, outputs, permissions, timeoutMs
        );
        stepRecords.push(stepRecord);
        await createStepRecord(stepRecord);

        if (stepRecord.status === "completed") {
            completedCount++;
        } else {
            failedCount++;
        }
        execution.stepsCompleted = completedCount;
        execution.stepsFailed = failedCount;
        execution.agentsRun = agentsRunCount;
        await updateExecutionStatus(executionId, {
            stepsCompleted: execution.stepsCompleted,
            stepsFailed: execution.stepsFailed,
            agentsRun: execution.agentsRun,
        });
    }

    // Finalize
    execution.status = "success";
    if (failedCount > 0) execution.status = "partial";
    execution.finishedAt = Date.now();
    execution.durationMs = execution.finishedAt - execution.startedAt;

    // Set symbol tracking
    execution.symbols = Object.keys(context.market);

    // Build final output from the synthesis agent if available
    let finalOutput = successOutput({
        agentId: "synthesis",
        summary: "Workflow completed.",
        confidence: 0.5,
        findings: [{ id: "wf_done", title: "Done", detail: "Workflow finished." }],
        evidence: [],
        dataUsed: [],
        nextStep: "",
    });

    if (outputs["synthesis"]) {
        finalOutput = outputs["synthesis"];
    } else if (context.agentOutputs["synthesis"]) {
        finalOutput = context.agentOutputs["synthesis"] as AgentOutput;
    }

    await updateExecutionStatus(executionId, {
        status: execution.status,
        finishedAt: execution.finishedAt,
        durationMs: execution.durationMs,
        finalOutput: finalOutput as unknown as WorkflowExecutionRecord["finalOutput"],
        aiCalls: execution.aiCalls,
        estimatedCostUsd: execution.estimatedCostUsd,
    });

    return {
        execution,
        outputs,
        finalOutput,
        traces: {
            steps: stepRecords,
            agents: Object.values(context.agentOutputs).map((o) => {
                // Return agent outputs as traces
                return {
                    id: genId("ae"),
                    executionId,
                    stepId: "",
                    workflowId: workflow.id,
                    workflowVersion: workflow.version,
                    agentId: o.agentId,
                    agentVersion: "",
                    status: o.status,
                    startedAt: now,
                    finishedAt: now + (o.confidence * 100),
                    durationMs: Math.round(o.confidence * 500),
                    retries: 0,
                    output: o,
                    aiUsed: o.aiEnhanced || false,
                } as AgentExecutionRecord;
            }),
        },
    };
}

// ─── Step Execution ─────────────────────────────────────

async function executeStep(
    step: WorkflowStep,
    workflow: WorkflowDefinition,
    execution: WorkflowExecutionRecord,
    context: WorkflowContext,
    outputs: Record<string, AgentOutput>,
    permissions: Record<string, boolean>,
    timeoutMs: number,
): Promise<WorkflowStepRecord> {
    const now = Date.now();

    // Evaluate conditional branches before executing
    for (const branch of workflow.branches || []) {
        const matched = evaluateBranch(branch, context);
        if (matched) {
            if (branch.action === "abort") {
                const record: WorkflowStepRecord = {
                    id: genId("ws"),
                    executionId: execution.id,
                    stepId: step.id,
                    mode: "sequential",
                    agentIds: [],
                    status: "aborted",
                    startedAt: now,
                    finishedAt: Date.now(),
                    durationMs: Date.now() - now,
                    condition: { matched: true, action: "abort", reason: branch.reason },
                };
                await createStepRecord(record);
                return record;
            } else if (branch.action === "markFlag") {
                context.flags.push(branch.flag || branch.id);
                const record: WorkflowStepRecord = {
                    id: genId("ws"),
                    executionId: execution.id,
                    stepId: step.id,
                    mode: "sequential",
                    agentIds: [],
                    status: "completed",
                    startedAt: now,
                    finishedAt: Date.now(),
                    durationMs: Date.now() - now,
                    condition: { matched: true, action: "markFlag", reason: branch.reason },
                };
                await createStepRecord(record);
                return record;
            }
            // skipTo - handled by the loop iteration check
        }
    }

    if (step.mode === "parallel") {
        return await executeParallelStep(step, workflow, execution, context, outputs, permissions, timeoutMs, now);
    }
    return await executeSequentialStep(step, workflow, execution, context, outputs, permissions, timeoutMs, now);
}

async function executeSequentialStep(
    step: WorkflowStep & { mode: "sequential" },
    workflow: WorkflowDefinition,
    execution: WorkflowExecutionRecord,
    context: WorkflowContext,
    outputs: Record<string, AgentOutput>,
    permissions: Record<string, boolean>,
    timeoutMs: number,
    startedAt: number
): Promise<WorkflowStepRecord> {
    const agentId = step.agent;
    const agent = getAgent(agentId);

    if (!agent) {
        const record: WorkflowStepRecord = {
            id: genId("ws"),
            executionId: execution.id,
            stepId: step.id,
            mode: "sequential",
            agentIds: [agentId],
            status: "failed",
            startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            error: `Unknown agent: ${agentId}`,
        };
        await createStepRecord(record);
        // Every step must leave an output record (matching the parallel path),
        // so consumers always find a per-step entry — even for failed steps.
        outputs[step.id] = failureOutput(agentId, `Unknown agent: ${agentId}`);
        return record;
    }

    // Check agent permissions
    const agentPermsMissing = agent.requiredPermissions.filter((p) => permissions[p] !== true);
    if (agentPermsMissing.length > 0) {
        const record: WorkflowStepRecord = {
            id: genId("ws"),
            executionId: execution.id,
            stepId: step.id,
            mode: "sequential",
            agentIds: [agentId],
            status: "failed",
            startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            error: `Permission denied: ${agentPermsMissing.join(", ")}`,
        };
        await createStepRecord(record);
        return record;
    }

    const output = await executeAgent(agentId, step.id, execution, context, step.timeoutMs || timeoutMs || workflow.defaultStepTimeoutMs || 30000);
    outputs[step.id] = output;
    context.agentOutputs[agentId] = output;
    execution.aiCalls += output.aiEnhanced ? 1 : 0;

    const record: WorkflowStepRecord = {
        id: genId("ws"),
        executionId: execution.id,
        stepId: step.id,
        mode: "sequential",
        agentIds: [agentId],
        status: output.status === "failed" ? "failed" : "completed",
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
    };
    await createStepRecord(record);
    return record;
}

async function executeParallelStep(
    step: WorkflowStep & { mode: "parallel" },
    workflow: WorkflowDefinition,
    execution: WorkflowExecutionRecord,
    context: WorkflowContext,
    outputs: Record<string, AgentOutput>,
    permissions: Record<string, boolean>,
    timeoutMs: number,
    startedAt: number
): Promise<WorkflowStepRecord> {
    const results = await Promise.all(
        step.agents.map(async (agentId) => {
            const agent = getAgent(agentId);
            if (!agent) {
                return { agentId, output: failureOutput(agentId, `Unknown agent: ${agentId}`) };
            }
            const agentPermsMissing = agent.requiredPermissions.filter((p) => permissions[p] !== true);
            if (agentPermsMissing.length > 0) {
                return { agentId, output: failureOutput(agentId, `Permission denied: ${agentPermsMissing.join(", ")}`) };
            }
            const output = await executeAgent(agentId, step.id, execution, context, timeoutMs || workflow.defaultStepTimeoutMs || 30000);
            return { agentId, output };
        })
    );

    const agentIds: string[] = [];
    let allFailed = true;
    for (const { agentId, output } of results) {
        outputs[agentId] = output;
        context.agentOutputs[agentId] = output;
        execution.aiCalls += output.aiEnhanced ? 1 : 0;
        agentIds.push(agentId);
        if (output.status !== "failed") allFailed = false;
    }

    const record: WorkflowStepRecord = {
        id: genId("ws"),
        executionId: execution.id,
        stepId: step.id,
        mode: "parallel",
        agentIds,
        status: allFailed ? "failed" : "completed",
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
    };
    await createStepRecord(record);
    return record;
}

// ─── Branch Evaluation ──────────────────────────────────

function evaluateBranch(branch: ConditionalBranch, context: WorkflowContext): boolean {
    const value = resolveSource(branch.source, context);
    if (value === undefined || value === null) return false;
    switch (branch.operator) {
        case "eq": return String(value) === String(branch.value);
        case "neq": return String(value) !== String(branch.value);
        case "gt": return Number(value) > Number(branch.value || 0);
        case "gte": return Number(value) >= Number(branch.value || 0);
        case "lt": return Number(value) < Number(branch.value || 0);
        case "lte": return Number(value) <= Number(branch.value || 0);
        default: return false;
    }
}

function resolveSource(source: string, context: WorkflowContext): unknown {
    if (source.startsWith("flags.")) {
        const flag = source.slice(6);
        return context.flags.includes(flag);
    }
    if (source.startsWith("outputs.")) {
        const parts = source.split(".");
        if (parts.length >= 3) {
            const agentId = parts[1];
            const field = parts.slice(2).join(".");
            const output = context.agentOutputs[agentId];
            if (!output) return undefined;
            return (output as Record<string, unknown>)[field];
        }
    }
    if (source.startsWith("variables.")) {
        return (context.variables as Record<string, unknown>)[source.slice(10)];
    }
    if (source.startsWith("metadata.")) {
        return (context.config as Record<string, unknown>)[source.slice(9)];
    }
    return undefined;
}

function wfAgentForPermission(p: AgentPermission): string {
    const map: Record<AgentPermission, string> = {
        market_data: "market-scout",
        historical_data: "pattern-discovery",
        strategy_data: "strategy-matcher",
        trading_history: "strategy-matcher",
        portfolio_data: "risk-analyst",
        risk_data: "risk-analyst",
        news_data: "news-agent",
        ai_analysis: "synthesis",
        notifications: "notification",
        telegram: "notification",
        discord: "notification",
        webhook: "notification",
    };
    return map[p] || "synthesis";
}

// ─── Register built-in executors ────────────────────────

import { marketScout, marketContextAgent, volatilityAgent, structureAgent } from "./implementations/market";
import { strategyMatcher, patternDiscovery } from "./implementations/strategy";
import { riskAnalyst } from "./implementations/risk";
import { newsAgent } from "./implementations/news";
import { criticAgent } from "./implementations/critic";
import { verificationAgent } from "./implementations/verification";
import { synthesizer } from "./implementations/synthesis";

export function registerBuiltInExecutors(): void {
    registerAgentExecutor("market-scout", marketScout);
    registerAgentExecutor("market-context", marketContextAgent);
    registerAgentExecutor("volatility-agent", volatilityAgent);
    registerAgentExecutor("structure-agent", structureAgent);
    registerAgentExecutor("strategy-matcher", strategyMatcher);
    registerAgentExecutor("pattern-discovery", patternDiscovery);
    registerAgentExecutor("risk-analyst", riskAnalyst);
    registerAgentExecutor("news-agent", newsAgent);
    registerAgentExecutor("critic", criticAgent);
    registerAgentExecutor("verification", verificationAgent);
    registerAgentExecutor("synthesis", synthesizer);
}

registerBuiltInExecutors();
