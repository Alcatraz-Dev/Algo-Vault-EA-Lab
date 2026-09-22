import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import {
    getAgentDefinition,
    getAllAgentDefinitions,
    getExecution,
    getExecutionTraces,
    getAgentLogs,
    setAgentDefinition,
    getActiveAgentDefinitions,
    getAllWorkflowDefinitions,
    adminDatabase,
} from "@/lib/agents/database";
import {
    orchestrate,
    validateDraft,
    generateFromPrompt,
    createWorkflow,
} from "@/lib/agents/orchestrator";
import { getActiveAgents } from "@/lib/agents/catalog";
import {
    WorkflowDefinition,
    AgentContract,
    WorkflowExecutionRecord,
} from "@/lib/agents/types";

import { registerBuiltInExecutors } from "@/lib/agents/workflow-engine";

async function requireAdmin(request: NextRequest): Promise<{ uid: string; token: Record<string, unknown> } | null> {
    const authHeader = request.headers.get("authorization");
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return null;
    try {
        // Verify the ID token — getUser() expects a UID, not a raw token.
        const decoded = await adminAuth.verifyIdToken(idToken);
        const isAdmin = decoded.admin === true || decoded.role === "admin";
        if (!isAdmin) return null;
        const claims = (decoded as Record<string, unknown>);
        return { uid: decoded.uid, token: claims };
    } catch {
        return null;
    }
}

// ─── GET /api/admin/agents ──────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const type = request.nextUrl.searchParams.get("type");
    if (type === "agent") {
        const agents = await getActiveAgents();
        return NextResponse.json({ agents });
    }

    const workflows = await getAllWorkflowDefinitions();
    return NextResponse.json({ workflows });
}

// ─── POST /api/admin/agents/workflow/validate ──────

export async function POST_workflows_validate(request: NextRequest): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    try {
        const body = await request.json();
        const { workflow } = body;
        if (!workflow || !workflow.id || !workflow.steps) {
            return NextResponse.json({ error: "Invalid workflow" }, { status: 400 });
        }

        const errors: string[] = [];
        if (!workflow.name) errors.push("name required");
        if (!workflow.trigger) errors.push("trigger required");
        if (!workflow.steps.length) errors.push("steps required");

        const stepIds = new Set<string>();
        for (const step of workflow.steps) {
            if (step.id) stepIds.add(step.id);
            else errors.push("Step missing id");
            if (step.mode === "parallel" && !Array.isArray(step.agents)) errors.push("Parallel step needs agents array");
            if (step.mode === "sequential" && !step.agent) errors.push("Sequential step needs agent");
        }

        for (const step of workflow.steps) {
            for (const dep of step.dependsOn || []) {
                if (!stepIds.has(dep)) errors.push(`Step ${step.id}: unknown dependency ${dep}`);
            }
        }

        return NextResponse.json({ valid: errors.length === 0, errors });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

// ─── POST /api/admin/agents/workflow ──────────────────

export async function POST_workflows_admin(request: NextRequest): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    try {
        const body = await request.json();
        const workflow: WorkflowDefinition = body;
        workflow.updatedAt = Date.now();
        workflow.status = workflow.status || "draft";
        await createWorkflow(workflow);
        return NextResponse.json({ created: true, workflowId: workflow.id });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}

// ─── GET /api/admin/agents/executions/:executionId ────────────

export async function GET_executions_admin(
    request: NextRequest,
    { params }: { params: { executionId: string } }
): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const execution = await getExecution(params.executionId);
    if (!execution) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(execution);
}

// ─── GET /api/admin/agents/traces/:executionId ─────────────

export async function GET_traces_admin(
    request: NextRequest,
    { params }: { params: { executionId: string } }
): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const { steps, agents } = await getExecutionTraces(params.executionId);
    return NextResponse.json({ steps, agents });
}

// ─── GET /api/admin/agents/logs/:executionId ───────────────────

export async function GET_logs_admin(
    request: NextRequest,
    { params }: { params: { executionId: string } }
): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const logs = await getAgentLogs(params.executionId);
    return NextResponse.json({ logs });
}

// ─── GET /api/admin/agents/dashboard ──────────────────

export async function GET_dashboard_stats(request: NextRequest): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const [agents, workflows] = await Promise.all([
        getActiveAgentDefinitions(),
        getAllWorkflowDefinitions(),
    ]);

    let recentExecutions: WorkflowExecutionRecord[] = [];
    try {
        const snap = await adminDatabase.ref("workflowExecutions").limitToLast(50).get();
        const data = (snap.val() || {}) as Record<string, WorkflowExecutionRecord>;
        recentExecutions = Object.values(data);
    } catch {
        // Continue with empty list
    }

    const activeCount = recentExecutions.filter((e) => e.status === "success").length;
    const failedCount = recentExecutions.filter((e) => e.status === "failed").length;

    return NextResponse.json({
        agents: { total: agents.length, active: agents.filter((a: AgentContract) => a.status === "active").length },
        workflows: { total: workflows.length, active: workflows.filter((w: WorkflowDefinition) => w.status === "active").length },
        executions: { recent: recentExecutions.length, success: activeCount, failed: failedCount },
    });
}

// ─── POST /api/admin/agents/orchestrate ──────────────

export async function POST_orchestrate_admin(request: NextRequest): Promise<NextResponse> {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    try {
        const body = await request.json();
        const result = await orchestrate({
            workflowId: body.workflowId,
            workflowVersion: body.workflowVersion,
            context: body.context || {},
            permissions: body.permissions,
            testOnly: true,
            timeoutMs: body.timeoutMs,
        });
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 400 });
    }
}
