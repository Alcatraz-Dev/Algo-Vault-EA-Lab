import { AIRouter, defaultRouter } from "@/lib/ai/router";
import {
    WorkflowDefinition,
    WorkflowContext,
    AgentOutput,
    AgentContract,
    PermissionSet,
    AgentPermission,
    AgentSpecDraft,
    AgentDraft,
    AgentGenerationJob,
} from "./types";
import { getAgent as _getAgent, getActiveAgents as _catalogActiveAgents, BUILT_IN_AGENTS } from "./catalog";
import {
    getWorkflowDefinition,
    setWorkflowDefinition,
    getAllAgentDefinitions,
    getAllWorkflowDefinitions,
    getAgentDefinition,
    setAgentDefinition,
    getAgentDraft,
    saveAgentDraft,
    getAgentLogs,
} from "./database";
import { executeWorkflow, registerBuiltInExecutors, EngineResult } from "./workflow-engine";
import {
    agentPermissionLabel,
    missingPermissions,
    sanitizeAgentPermissionSet,
} from "./permissions";
import { hasPermission } from "@/lib/plugins/permissions";

// Ensure built-in executors are registered on import
registerBuiltInExecutors();

export type OrchestratorInput = {
    workflowId: string;
    workflowVersion?: string;
    context: Partial<WorkflowContext>;
    permissions?: PermissionSet;
    testOnly?: boolean;
    timeoutMs?: number;
};

export type OrchestratorResult = EngineResult & {
    durationMs: number;
    status: string;
};

/**
 * Agent Orchestrator — the single entry point for all multi-agent intelligence.
 *
 * Plugins, extensions, the AI Studio, and admin all call through here.
 * It never allows direct agent execution bypassing the engine.
 */
export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
    const startedAt = Date.now();

    // Resolve workflow
    const workflow = await getWorkflowDefinition(input.workflowId);
    if (!workflow) {
        throw new Error(`Workflow not found: ${input.workflowId}`);
    }
    if (input.workflowVersion && workflow.version !== input.workflowVersion) {
        throw new Error(`Workflow version mismatch: requested ${input.workflowVersion}, have ${workflow.version}`);
    }
    if (workflow.status !== "active") {
        throw new Error(`Workflow ${workflow.id} is not active (status: ${workflow.status})`);
    }

    // Verify permissions
    const permissions = input.permissions || {};
    const missing = missingPermissions(workflow.requiredPermissions, permissions);
    if (missing.length > 0) {
        throw new Error(`Missing required permissions: ${missing.join(", ")}`);
    }

    const result = await executeWorkflow(workflow, input.context, {
        permissions,
        testOnly: input.testOnly,
        timeoutMs: input.timeoutMs,
    });

    return {
        ...result,
        durationMs: Date.now() - startedAt,
        status: result.execution.status,
    };
}

// ─── Agent Registry ──────────────────────────────────────────

export async function registerAgent(agent: AgentContract): Promise<void> {
    await setAgentDefinition(agent);
}

export async function getAllAgents(): Promise<AgentContract[]> {
    return getAllAgentDefinitions();
}

export async function getAgentById(id: string): Promise<AgentContract | null> {
    return getAgentDefinition(id);
}

export async function getActiveAgents(): Promise<AgentContract[]> {
    return getAllAgentDefinitions().then((all) => all.filter((a) => a.status === "active" || a.status === "testing"));
}

export function getBuiltInAgent(id: string): AgentContract | undefined {
    return BUILT_IN_AGENTS.find((a) => a.id === id);
}

// ─── Workflow Management ──────────────────────────────────────

export async function createWorkflow(wf: WorkflowDefinition): Promise<void> {
    await setWorkflowDefinition(wf);
}

export async function getWorkflow(id: string): Promise<WorkflowDefinition | null> {
    return getWorkflowDefinition(id);
}

export async function updateWorkflow(wf: WorkflowDefinition): Promise<void> {
    await setWorkflowDefinition(wf);
}

export async function getAllWorkflows(): Promise<WorkflowDefinition[]> {
    return getAllWorkflowDefinitions();
}

// ─── AI Generation Pipeline (spec §16) ────────────────────────

export async function generateFromPrompt(
    prompt: string,
    createdBy: string,
    kind: "agent" | "workflow" = "agent"
): Promise<AgentGenerationJob> {
    const job: AgentGenerationJob = {
        id: `gen_${Date.now().toString(36)}`,
        kind,
        prompt,
        status: "generating",
        createdBy,
        createdAt: Date.now(),
        finishedAt: null,
    };

    try {
        // Generate a draft using the AI router
        const systemPrompt = kind === "agent"
            ? "You are an AlgoVault Agent designer. Generate a valid AgentContract JSON object based on the user's description. Include: id, name, version, role, description, capabilities, requiredPermissions, inputSchema, outputSchema, systemInstructions, tools, modelConfiguration, timeoutMs, retryPolicy, validationRules, status. NEVER include forbidden permissions: trading_execution, order_placement, account_credentials, payment_information, database_access, arbitrary_server_execution."
            : "You are an AlgoVault Workflow designer. Generate a valid WorkflowDefinition JSON object based on the user's description. Include: id, name, version, trigger, requiredPermissions, steps (with mode: sequential or parallel, dependencies, onFailure policies), branches (conditional logic), timeoutMs, notification settings. NEVER include forbidden permissions.";

        const raw = await defaultRouter.generateStructured(
            prompt,
            kind === "agent" ? "AgentContract" : "WorkflowDefinition",
            systemPrompt
        );

        const draftId = `draft_${Date.now().toString(36)}`;
        const validation = validateDraft(raw, kind);

        const draft: AgentDraft = {
            id: draftId,
            kind,
            name: kind === "agent" ? (raw as AgentContract).name || "Generated Agent" : (raw as WorkflowDefinition).name || "Generated Workflow",
            displayName: kind === "agent" ? (raw as AgentContract).name || "Generated Agent" : (raw as WorkflowDefinition).name || "Generated Workflow",
            description: kind === "agent" ? (raw as AgentContract).description || "" : (raw as WorkflowDefinition).description || "",
            spec: {
                kind,
                agent: kind === "agent" ? raw as AgentContract : undefined,
                workflow: kind === "workflow" ? raw as WorkflowDefinition : undefined,
                capabilities: [],
                testCases: [],
                unsupportedCapabilities: validation.unsupported,
            },
            validation: {
                schema: validation.schema,
                permissions: validation.permissions,
                security: validation.security,
                workflow: validation.workflow,
                sandbox: false,
                tests: false,
            },
            validationMessages: validation.messages,
            status: validation.passed ? "generated" : "rejected",
            createdBy,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await saveAgentDraft(draftId, draft);
        job.status = "done";
        job.draftId = draftId;
    } catch (err) {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : "Generation failed";
    }

    job.finishedAt = Date.now();
    return job;
}

type ValidationResult = {
    schema: boolean;
    permissions: boolean;
    security: boolean;
    workflow: boolean;
    passed: boolean;
    messages: string[];
    unsupported: { required: string; suggestedImplementation: string }[];
};

const FORBIDDEN_AGENT_PERMS: string[] = [
    "trading_execution", "order_placement", "account_credentials",
    "payment_information", "database_access", "arbitrary_server_execution",
];

const FORBIDDEN_WORKFLOW_PERMS: string[] = [
    "trading_execution", "order_placement", "account_credentials",
    "payment_information", "database_access", "arbitrary_server_execution",
];

export function validateDraft(raw: unknown, kind: "agent" | "workflow"): ValidationResult {
    const messages: string[] = [];
    let schema = false;
    let permissions = false;
    let security = false;
    let workflow = false;

    if (!raw || typeof raw !== "object") {
        messages.push("Generated output is not a valid object.");
        return { schema: false, permissions: false, security: false, workflow: false, passed: false, messages, unsupported: [] };
    }

    const obj = raw as Record<string, unknown>;

    // Schema validation
    if (kind === "agent") {
        const required = ["id", "name", "version", "role", "description", "capabilities", "requiredPermissions", "inputSchema", "outputSchema", "systemInstructions", "timeoutMs", "retryPolicy", "validationRules"];
        schema = required.every((f) => f in obj);
        if (!schema) messages.push("Agent contract missing required fields.");

        // Permissions validation
        const perms = obj.requiredPermissions as string[] || [];
        const forbidden = perms.filter((p) => FORBIDDEN_AGENT_PERMS.includes(p));
        if (forbidden.length > 0) {
            messages.push(`Forbidden permissions requested: ${forbidden.join(", ")}`);
        } else {
            permissions = true;
        }

        // Security: check for code injection patterns
        const serialized = JSON.stringify(raw).toLowerCase();
        const dangerous = ["eval(", "function(", "child_process", "process.env", "require("];
        security = !dangerous.some((d) => serialized.includes(d));
        if (!security) messages.push("Generated content contains disallowed patterns.");
    } else {
        const required = ["id", "name", "version", "trigger", "requiredPermissions", "steps"];
        schema = required.every((f) => f in obj);
        if (!schema) messages.push("Workflow definition missing required fields.");

        const perms = obj.requiredPermissions as string[] || [];
        const forbidden = perms.filter((p) => FORBIDDEN_WORKFLOW_PERMS.includes(p));
        if (forbidden.length > 0) {
            messages.push(`Forbidden permissions requested: ${forbidden.join(", ")}`);
        } else {
            permissions = true;
        }

        // Workflow step validation
        const steps = obj.steps as Array<Record<string, unknown>> || [];
        let validSteps = true;
        for (const step of steps) {
            if (step.mode === "parallel") {
                if (!Array.isArray(step.agents)) validSteps = false;
            } else {
                if (!step.agent) validSteps = false;
            }
        }
        workflow = validSteps;
        if (!workflow) messages.push("Workflow has invalid step definitions.");

        // Security
        const serialized = JSON.stringify(raw).toLowerCase();
        const dangerous = ["eval(", "function(", "child_process", "process.env", "require("];
        security = !dangerous.some((d) => serialized.includes(d));
        if (!security) messages.push("Generated content contains disallowed patterns.");
    }

    const passed = schema && permissions && security && workflow;
    return { schema, permissions, security, workflow, passed, messages, unsupported: [] };
}
